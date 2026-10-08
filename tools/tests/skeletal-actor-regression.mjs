/* Actual GLTF/mixer regression for animation binding and StrictMode effect rehearsal.
 * Run: node tools/tests/skeletal-actor-regression.mjs
 * The texture bitmap fixture replaces decoding only; no renderer/FPS claims are made.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
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
const frames = [], effects = []
const jsx = (type, props) => {
  if (type === 'group') {
    const group = new THREE.Group()
    for (const child of Array.isArray(props.children) ? props.children : [props.children]) if (child?.props?.object) group.add(child.props.object)
    if (props.ref) props.ref.current = group
  }
  return { type, props }
}
const modules = {
  react: { useMemo: fn => fn(), useEffect: fn => effects.push(fn), useRef: current => ({ current }) },
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
  '@react-three/fiber': { useFrame: fn => frames.push(fn), useLoader() { throw new Error('Unexpected fixture loader') } },
  three: THREE,
  'three/addons/loaders/GLTFLoader.js': { GLTFLoader },
  'three/addons/utils/SkeletonUtils.js': skeletonUtils,
  './terrain': { stateGround: () => 0 },
}
const filename = fileURLToPath(new URL('web/src/center/worlds/SkeletalActors.tsx', root))
const result = transformSync(filename, fs.readFileSync(filename, 'utf8'), { jsx: { runtime: 'automatic' }, target: 'es2022' })
assert.deepEqual(result.errors, [])
const source = result.code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g, (_, names, name) => `const {${names.replace(/\bas\b/g, ':')}} = require(${JSON.stringify(name)});`).replace(/\bexport\s+(?:default\s+)?(?=(?:function|const|class)\b)/g, '').replaceAll('import.meta.env.BASE_URL', '"/center/"')
const { RigActor, PoseMotion } = new Function('require', `${source}\nreturn {RigActor,PoseMotion};`)(name => { if (!(name in modules)) throw new Error(`Unexpected import: ${name}`); return modules[name] })

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
const hand = props.handOutputs.get('player')
assert.ok(hand, 'Visible actor must publish its animated wrist')
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
