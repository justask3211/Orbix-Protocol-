import assert from 'node:assert/strict'
import fs from 'node:fs'
import {performance} from 'node:perf_hooks'
import {frameworkModule} from './framework-fixture.mjs'
const {AnimationFSM}=frameworkModule('animation'),{HealthTrack}=frameworkModule('health'),{SurfaceQueries}=frameworkModule('surface'),{clipBoom,MovementResponse}=frameworkModule('camera'),{Vector3}=frameworkModule('three')
const fsm=new AnimationFSM(),state={roundId:'round',tick:0},body={hp:100,onGround:true,lastAttackAt:0,weapon:'hands',combo:1}
assert.equal(fsm.update(body,state,10000,0,false).lower.name,'Idle')
body.lastAttackAt=10010;let a=fsm.update(body,state,10010,5,false);assert.equal(a.lower.name,'Run');assert.equal(a.upper.name,'PunchJab')
a=fsm.update(body,state,10180,5,false);assert(a.contact&&a.contactEntered);assert(!fsm.update(body,state,10190,5,false).contactEntered,'Window emits once for identical event')
body.hp=80;a=fsm.update(body,state,10200,5,false);assert.equal(a.upper.name,'Hit')
body.lastAttackAt=10201;assert.equal(fsm.update(body,state,10201,5,false).upper.name,'Hit','Lower priority cannot cancel hit')
body.hp=0;assert.equal(fsm.update(body,state,10202,5,false).upper.name,'Death')
body.hp=100;assert.equal(fsm.update(body,{roundId:'new',tick:0},11000,0,false).upper.name,'Idle','New round must clear event state')
const health=new HealthTrack();assert.equal(health.observe(100,'a',0,0),0);assert.equal(health.observe(80,'a',10,0),20);assert.equal(health.observe(80,'a',20,0),0);assert.equal(health.observe(0,'a',30,5000),80,'Lethal confirmed damage still displays');assert.equal(health.observe(100,'b',40,0),0)
const surface=new SurfaceQueries(),queryState={obstacles:[{x:0,z:2,width:3,depth:.05,height:3,baseY:0}],crates:[]}
surface.update(queryState);const target=new Vector3(0,1,0),camera=new Vector3(0,1,5)
assert(clipBoom(surface,target,camera)<.4,'Thin cover cannot be skipped by fixed sample steps');assert(camera.z<2)
const inside=new Vector3(0,1,2);clipBoom(surface,target,inside);assert(inside.z<2,'Post-easing collision also clips')
assert.equal(surface.ground({...queryState},0,2,3),3)
surface.update({obstacles:[],crates:[]});assert.equal(surface.world.bodies.length,0);surface.dispose()
const response=new MovementResponse();response.update(0,0,0,1/60);assert(response.update(.08,0,0,1/60).x>0);assert.equal(response.update(100,0,0,1/60).x,0,'Teleport clears lead')
// Measure the actual adopted workload: 10 camera rays vs 40 static colliders, no crowd solver.
surface.update({obstacles:Array.from({length:40},(_,i)=>({x:(i%8-4)*4,z:(Math.floor(i/8)-2)*4,width:2,depth:2,height:2,baseY:0}))})
const samples=[];for(let i=0;i<1100;i++){const start=performance.now();camera.set(0,1,5);clipBoom(surface,target,camera);camera.set(0,1,5);clipBoom(surface,target,camera);if(i>=100)samples.push(performance.now()-start)}samples.sort((a,b)=>a-b)
fs.writeFileSync('tools/tests/evidence/rst/queries.json',JSON.stringify({samples:samples.length,p50Ms:samples[500],p95Ms:samples[950],colliders:40,raysPerFrame:10,environment:'Node Linux x64; static cannon-es queries, excludes render/GPU'},null,2));surface.dispose()
console.log('PASS: FSM priority/expiry/contact dedup, round/health reset, lethal damage, thin-wall camera collision, bounded lead and collider disposal; query p95',samples[950])

const {FootPlant}=frameworkModule('feet'),{Object3D}=frameworkModule('three')
const rig=new Object3D();for(const side of ['l','r']){const thigh=new Object3D(),knee=new Object3D(),foot=new Object3D();thigh.name=`thigh_${side}`;knee.name=`calf_${side}`;foot.name=`foot_${side}`;thigh.position.set(side==='l'?-.15:.15,1,0);knee.position.y=-.5;foot.position.y=-.5;rig.add(thigh);thigh.add(knee);knee.add(foot)}rig.updateMatrixWorld(true)
const feet=new FootPlant(rig);feet.update(rig,0,false,true,()=>.2);rig.updateMatrixWorld(true)
for(const side of ['l','r']){const ankle=rig.getObjectByName(`foot_${side}`).getWorldPosition(new Vector3());assert(Number.isFinite(ankle.y));assert(ankle.y>.1&&ankle.y<.3,'Bounded foot correction reaches surface without moving root')}
assert.equal(rig.position.y,0);feet.reset();console.log('PASS: two-bone foot contact is finite, bounded and leaves motion root unchanged')
