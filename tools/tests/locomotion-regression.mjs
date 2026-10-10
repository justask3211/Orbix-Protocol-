/* Actual production mixer and skinned rig. Planted-foot velocity, layer selection,
 * LOD transitions and expired combat, for every character. No device FPS claims. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {makeRig,selectAction,releaseRig,full,lod,THREE} from './skeletal-actor-regression.mjs'
import {transformSync} from '../../web/node_modules/rolldown/dist/utils-index.mjs'
const code=transformSync('catalog.ts',fs.readFileSync('web/src/center/characters.ts','utf8'),{target:'es2022'}).code.replace(/import[^;]*;/g,'').replace(/\bexport\s+/g,'')
const {CHARACTERS}=new Function('catalog',code+'\nreturn {CHARACTERS};')(JSON.parse(fs.readFileSync('center/cosmetics_catalog.json')))
const evidence=[]
for(const model of [full,lod])for(const info of CHARACTERS){
 const rig=makeRig(model,info.id,'team-1'),parent=new THREE.Group();parent.scale.set(1.15,.96,1.12);parent.add(rig.scene)
 for(const [name,speed] of [['Walk',1],['Run',5],['Sprint',8]]){
  const rate=speed/(rig.gaitSpeeds[name]*1.12),clip=rig.actions.get(`${name}:lower`).getClip()
  // Deliberately leave a clamped punch on the upper layer, then return to movement.
  selectAction(rig,'PunchCross','upper',true,'accepted-hit');rig.mixer.update(1.2)
  selectAction(rig,name,'lower',false,'',rate);selectAction(rig,name,'upper',false,'',rate);rig.mixer.update(.2)
  for(const [key,action] of rig.actions)if(/Punch|Kick|SwordAttack|PistolShoot/.test(key))assert(!action.isScheduled()||action.getEffectiveWeight()===0||!action.enabled,`${info.id}: combat leaks into ${name}`)
  assert(rig.current.lower.startsWith(`${name}:lower:`)&&rig.current.upper.startsWith(`${name}:upper:`))
  const lower=rig.actions.get(`${name}:lower`),upper=rig.actions.get(`${name}:upper`)
  lower.time=upper.time=0;rig.mixer.update(0);parent.updateMatrixWorld(true)
  const foot=rig.scene.getObjectByName('foot_l'),dt=clip.duration/64/rate,velocities=[];let previous=foot.getWorldPosition(new THREE.Vector3())
  for(let frame=1;frame<32;frame++){rig.mixer.update(dt);parent.updateMatrixWorld(true);const next=foot.getWorldPosition(new THREE.Vector3());velocities.push((previous.z-next.z)/dt);previous=next}
  velocities.sort((a,b)=>a-b);const measured=velocities[Math.floor(velocities.length/2)],error=Math.abs(measured-speed)/speed
  assert(error<.06,`${info.id} ${name}: requested ${speed}, planted foot ${measured}`)
  assert(Math.abs(lower.time-upper.time)<1e-6,'Both gait layers must share phase')
  const root=rig.scene.getObjectByName('root');assert(Math.abs(root.position.x)<1e-5&&Math.abs(root.position.z)<1e-5,'No controller/root-motion fight')
  evidence.push({character:info.id,lod:model===lod,clip:name,worldSpeed:speed,footSpeed:measured,relativeError:error,combatWeight:0})
 }
 selectAction(rig,'Idle','lower',false,'');selectAction(rig,'Idle','upper',false,'');rig.mixer.update(.3)
 const arm=rig.scene.getObjectByName('upperarm_r'),bind=model.scene.getObjectByName('upperarm_r').quaternion
 assert(arm.quaternion.angleTo(bind)>.1,'Idle must not expose T pose')
 const chest=rig.scene.getObjectByName('spine_01'),first=chest.getWorldPosition(new THREE.Vector3());rig.mixer.update(.7);parent.updateMatrixWorld(true);assert(first.distanceTo(chest.getWorldPosition(new THREE.Vector3()))>1e-5,'Idle breathing must animate')
 releaseRig(rig)
}
fs.writeFileSync('/tmp/orbix-q-locomotion.json',JSON.stringify(evidence,null,2))
console.log(`PASS: ${evidence.length} actual mixer/gait cases; all characters and LODs, no combat weight, synchronized layers, planted-foot cadence within 6%.`)
