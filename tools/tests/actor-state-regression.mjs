/* Exercise RigActor's actual state machine, rather than choosing clips directly. */
import assert from 'node:assert/strict'
import {RigActor,frames,effects,full,lod,camera} from './skeletal-actor-regression.mjs'
const ids=['cat','turtle','blob','knight','cat-blob','duckling','astronaut','toy-robot','pancake','jelly-ninja','sprout','marshmallow']
let checks=0
for(const character of ids){
 const body={x:0,y:0,z:0,hp:100,yaw:0,onGround:true,character,weapon:'hands',lastAttackAt:0},pose={x:0,y:0,z:0,yaw:0,moving:0,speed:0},state={bodies:{player:body},serverTimeMs:10000,tick:0,roundId:'test',worldVersion:4}
 const props={state,game:'token-catch',me:'player',players:['player'],poses:new Map([['player',pose]]),inputRef:{current:{dx:0,dz:0,active:true,sprint:false,yaw:0}},cameraRef:{current:{mode:'third'}},handOutputs:new Map(),reducedMotion:true,who:'player',body,full,lod}
 RigActor(props);const setup=effects.at(-1),cleanup=setup(),update=frames.at(-1)
 const tick=(n=12)=>{for(let i=0;i<n;i++){state.serverTimeMs+=1000/60;state.tick++;update({camera},1/60)}}
 const layers=()=>{let node=props.handOutputs.get('player')?.right;while(node&&!node.userData.animationLayers)node=node.parent;assert(node,'Actor must retain rendered rig diagnostics');return node.userData.animationLayers}
 for(const [clip,speed] of [['Idle',0],['Walk',1],['Run',5],['Sprint',8]]){pose.speed=speed;pose.moving=speed?1:0;body.sprinting=clip==='Sprint';tick();assert.equal(layers().lower.clip,clip+':lower');assert.equal(layers().upper.clip,clip+':upper');checks++}
 body.lastAttackAt=state.serverTimeMs;body.lastAttackStyle='heavy';tick(1);assert.equal(layers().upper.clip,'PunchCross:upper');assert.equal(layers().lower.clip,'Sprint:lower');checks++
 tick(36);assert.equal(layers().upper.clip,'Sprint:upper');checks++
 body.onGround=false;pose.speed=0;pose.moving=0;tick(1);assert.equal(layers().lower.clip,'JumpStart:lower');tick(20);assert.equal(layers().lower.clip,'JumpLoop:lower');checks+=2
 body.onGround=true;tick(1);assert.equal(layers().lower.clip,'JumpLand:lower');tick(12);assert.equal(layers().upper.clip,'Idle:upper');checks+=2
 state.finished=true;tick();assert.equal(layers().upper.clip,'Idle:upper');checks++
 props.reducedMotion=true;tick(1);let bone=props.handOutputs.get('player').right;while(bone.name!=='spine_01')bone=bone.parent;const frozen=bone.quaternion.clone();tick(30);assert(bone.quaternion.angleTo(frozen)<1e-6,'Reduced motion freezes decorative idle');checks++
 cleanup();await Promise.resolve()
}
console.log(`PASS: ${checks} real RigActor state selections for all 12 characters, locomotion, accepted combat, expiry, jumping, landing and finish.`)
