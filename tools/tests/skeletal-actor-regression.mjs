/* Actual GLTF/mixer regression for animation binding and StrictMode effect rehearsal.
 * Run: node tools/tests/skeletal-actor-regression.mjs
 * The texture bitmap fixture replaces decoding only; no renderer/FPS claims are made.
 */
import {buildCuteCharacter} from './original-character-regression.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
import { fileURLToPath } from 'node:url'
import * as THREE from '../../web/node_modules/three/build/three.module.js'
import { GLTFLoader } from '../../web/node_modules/three/examples/jsm/loaders/GLTFLoader.js'
import * as skeletonUtils from '../../web/node_modules/three/examples/jsm/utils/SkeletonUtils.js'
import { transformSync } from '../../web/node_modules/rolldown/dist/utils-index.mjs'

globalThis.self = globalThis
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} })
globalThis.ProgressEvent = class { constructor(type, values) { this.type = type; Object.assign(this, values) } }
const root = new URL('../../', import.meta.url)
async function model(name) {
  const data = fs.readFileSync(new URL(`web/public/center-models/${name}`, root))
  return await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '')
}
const [full, lod] = await Promise.all([model('orbix-ranger.glb'), model('orbix-ranger-lod.glb')])
const styleCode=transformSync('style.ts',fs.readFileSync(new URL('web/src/center/worlds/cartoonStyle.ts',root),'utf8'),{target:'es2022'}).code.replace(/\bexport\s+/g,'')
const styles=new Function(styleCode+'\nreturn {CARTOON_SUITS,CARTOON_TEAMS,CARTOON_PROPORTIONS,cartoonFinish};')()
const frames = [], effects = []
const jsx = (type, props) => {
  if (type === 'group') {
    const group = new THREE.Group()
    for (const child of Array.isArray(props.children) ? props.children : [props.children]) if (child?.props?.object || child?.object) group.add(child.props?.object || child.object)
    if (props.ref) props.ref.current = group
  }
  return { type, props, object: props.ref?.current }
}
const modules = {
  react: { useMemo: fn => fn(), useEffect: fn => effects.push(fn), useRef: current => ({ current }) },
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
  '@react-three/fiber': { useFrame: fn => frames.push(fn), useLoader() { throw new Error('Unexpected fixture loader') } },
  three: THREE,
  'three/addons/loaders/GLTFLoader.js': { GLTFLoader },
  'three/addons/utils/SkeletonUtils.js': skeletonUtils,
  './CuteCharacter': {buildCuteCharacter},
  './terrain': { stateGround: () => 0 },
  './motion': require('./motion-regression.cjs'),
  './ItemMeshes': {HeldItems:()=>null},
  './cartoonStyle': styles,
}
const filename = fileURLToPath(new URL('web/src/center/worlds/SkeletalActors.tsx', root))
const result = transformSync(filename, fs.readFileSync(filename, 'utf8'), { jsx: { runtime: 'automatic' }, target: 'es2022' })
assert.deepEqual(result.errors, [])
const source = result.code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g, (_, names, name) => `const {${names.replace(/\bas\b/g, ':')}} = require(${JSON.stringify(name)});`).replace(/\bexport\s+(?:default\s+)?(?=(?:function|const|class)\b)/g, '').replaceAll('import.meta.env.BASE_URL', '"/center/"')
const { RigActor, PoseMotion, makeRig, releaseRig, selectAction } = new Function('require', `${source}\nreturn {RigActor,PoseMotion,makeRig,releaseRig,selectAction};`)(name => { if (!(name in modules)) throw new Error(`Unexpected import: ${name}`); return modules[name] })

for (const model of [full,lod]) for (const character of Object.keys(styles.CARTOON_SUITS)) {
  const owned=makeRig(model,character,'team-2')
  owned.scene.traverse(object=>{
    if(!object.isMesh || !object.visible)return
    for(const material of Array.isArray(object.material)?object.material:[object.material]){
      if(!['Orbix_Suit','Orbix_Armor','Orbix_Accent'].includes(material.name))continue
      assert.equal(material.map,null,'Only owned clothing drops the tactical texture')
      assert.equal(material.roughness,.92)
      assert.equal(material.metalness,.02)
      const tint=material.name==='Orbix_Suit'?styles.CARTOON_SUITS[character].suit:material.name==='Orbix_Armor'?styles.CARTOON_SUITS[character].armor:styles.CARTOON_TEAMS[1]
      assert.equal(material.color.getHexString(),tint.slice(1),'Cosmetic and team tint rules survive for both LODs')
    }
  })
  selectAction(owned,'Run','lower',false,'',.5)
  selectAction(owned,'Run','lower',false,'',.9)
  assert.equal(owned.actions.get('Run:lower').getEffectiveTimeScale(),.9,'Cadence changes without resetting the selected action')
  owned.actions.get('Run:lower').time=.2
  selectAction(owned,'Run','upper',false,'',.9)
  assert.equal(owned.actions.get('Run:upper').time,.2,'Locomotion layers share phase')
  releaseRig(owned)
}
const body = { x: 0, y: 0, z: 0, yaw: 0, hp: 100, onGround: true, character: 'fox', weapon: 'hands', moving: false }, state = { bodies: { player: body }, serverTimeMs: 10000, worldVersion: 4, tick: 0 }
const props = { state, game: 'token-catch', me: 'player', players: ['player'], poses: new Map([['player', { x: 0, y: 0, z: 0, yaw: 0, moving: 0 }]]), inputRef: { current: { dx: 0, dz: 0, active: true, sprint: false, yaw: 0 } }, cameraRef: { current: { mode: 'third' } }, handOutputs: new Map() }
PoseMotion(props)
RigActor({ ...props, who: 'player', body, full, lod })
const actorSetup = effects[effects.length - 1]
const firstCleanup = actorSetup(); firstCleanup(); const finalCleanup = actorSetup()
await Promise.resolve() // StrictMode cleanup must not invalidate the retained actions.
const camera = new THREE.PerspectiveCamera(58, 1.5, .08, 180); camera.position.set(0, 2, 5); camera.lookAt(0, 1, 0); camera.updateMatrixWorld()
const bindQuaternion = full.scene.getObjectByName('upperarm_r').quaternion.clone()
for (let frame = 0; frame < 45; frame++) { state.serverTimeMs += 1000 / 60; state.tick++; for (const update of frames) update({ camera }, 1 / 60) }
assert.equal(props.poses.get('player').moving, 0, 'Zero movement intent must remain idle')
const hand = props.handOutputs.get('player')?.right
assert.ok(hand, 'Visible actor must publish its animated wrist')
assert.ok(props.handOutputs.get('player')?.left, 'Left wrist is retained for the actual shield')
let arm = hand
while (arm && arm.name !== 'upperarm_r') arm = arm.parent
assert.ok(arm && arm.quaternion.angleTo(bindQuaternion) > .1, 'Idle animation must leave the bind/T pose after StrictMode rehearsal')
let actorRoot = hand
while (actorRoot.parent) actorRoot = actorRoot.parent
const leg = actorRoot.getObjectByName('thigh_r'), idleLeg = leg.quaternion.clone()
body.lastAttackAt = state.serverTimeMs; body.lastAttackStyle = 'kick'; body.lastAttackWeapon = 'hands'; body.combo = 1
for (let frame = 0; frame < 10; frame++) { state.serverTimeMs += 1000 / 60; state.tick++; for (const update of frames) update({ camera }, 1 / 60) }
assert.ok(full.animations.some(clip => clip.name === 'Kick'), 'An actual authored Kick clip is required')
assert.ok(leg.quaternion.angleTo(idleLeg) > .05, 'Accepted kick must animate the actual right thigh')
assert.ok(props.handOutputs.get('player'), 'Animated wrist remains available during combat')
assert.equal(full.scene.getObjectByName('upperarm_r').quaternion.angleTo(bindQuaternion), 0, 'Cached source skeleton must remain unmodified')
finalCleanup(); await Promise.resolve()
assert.equal(props.handOutputs.has('player'), false, 'Genuine unmount releases the actor attachment')
process.stdout.write('Skeletal regression passed: actual GLTF binding, StrictMode animation survival, idle input, Kick availability and unmount cleanup.\n')
