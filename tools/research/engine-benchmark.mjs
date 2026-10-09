// Run after installing candidates in ORBIX_ANALYSIS_MODULES; nothing is added to production.
import fs from 'node:fs/promises'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {gzipSync} from 'node:zlib'
import {performance} from 'node:perf_hooks'
const root=process.env.ORBIX_ANALYSIS_MODULES||'/tmp/orbix-engine-analysis'
const require=createRequire(root+'/package.json'), load=async name=>import(pathToFileURL(require.resolve(name)).href)
const {build}=await load('esbuild'),result={environment:{node:process.version,platform:process.platform,arch:process.arch,fixture:'40 static boxes + floor + 50 dynamic spheres; 120 warmup, 600 timed steps at 60Hz; CPU only, no rendering, not device evidence'},bundles:[],steps:[]}
for(const name of ['@babylonjs/core','playcanvas','@dimforge/rapier3d-compat','cannon-es','jolt-physics']){
 const pkg=JSON.parse(await fs.readFile(root+'/node_modules/'+name+'/package.json','utf8'))
 const bundled=await build({stdin:{contents:`import * as engine from '${name}';globalThis.engine=engine`,resolveDir:root},bundle:true,minify:true,platform:'browser',format:'esm',write:false,external:['node:*','fs','path','url','module']})
 const data=bundled.outputFiles[0].contents
 result.bundles.push({package:name,version:pkg.version,license:pkg.license,bytes:data.length,gzipBytes:gzipSync(data).length,scope:'full public API; not a minimal tree-shaken scene'})
}
function time(name,step,dispose){for(let i=0;i<120;i++)step();const samples=[];for(let i=0;i<600;i++){const begin=performance.now();step();samples.push(performance.now()-begin)}samples.sort((a,b)=>a-b);result.steps.push({name,p50Ms:samples[300],p95Ms:samples[570],maxMs:samples[599]});dispose()}
const R=(await load('@dimforge/rapier3d-compat')).default
await R.init();const w=new R.World({x:0,y:-9.81,z:0});w.timestep=1/60
w.createCollider(R.ColliderDesc.cuboid(24,.5,24).setTranslation(0,-.5,0))
for(let i=0;i<40;i++)w.createCollider(R.ColliderDesc.cuboid(.8,.8,.8).setTranslation((i%8-4)*4,.8,(Math.floor(i/8)-2)*4))
for(let i=0;i<50;i++){const b=w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation((i%10-5)*1.2,3+Math.floor(i/10)*1.2,1));w.createCollider(R.ColliderDesc.ball(.3),b)}
time('Rapier',()=>w.step(),()=>w.free())
const C=await load('cannon-es'),cw=new C.World({gravity:new C.Vec3(0,-9.81,0)})
cw.broadphase=new C.SAPBroadphase(cw)
cw.addBody(new C.Body({mass:0,shape:new C.Box(new C.Vec3(24,.5,24)),position:new C.Vec3(0,-.5,0)}))
for(let i=0;i<40;i++)cw.addBody(new C.Body({mass:0,shape:new C.Box(new C.Vec3(.8,.8,.8)),position:new C.Vec3((i%8-4)*4,.8,(Math.floor(i/8)-2)*4)}))
for(let i=0;i<50;i++)cw.addBody(new C.Body({mass:1,shape:new C.Sphere(.3),position:new C.Vec3((i%10-5)*1.2,3+Math.floor(i/10)*1.2,1)}))
time('cannon-es/SAP',()=>cw.step(1/60),()=>{})
const J=await (await load('jolt-physics')).default(),settings=new J.JoltSettings()
const filter=new J.ObjectLayerPairFilterTable(2);filter.EnableCollision(0,1);filter.EnableCollision(1,1)
const broad=new J.BroadPhaseLayerInterfaceTable(2,2);broad.MapObjectToBroadPhaseLayer(0,new J.BroadPhaseLayer(0));broad.MapObjectToBroadPhaseLayer(1,new J.BroadPhaseLayer(1))
settings.mObjectLayerPairFilter=filter;settings.mBroadPhaseLayerInterface=broad;settings.mObjectVsBroadPhaseLayerFilter=new J.ObjectVsBroadPhaseLayerFilterTable(broad,2,filter,2)
const jolt=new J.JoltInterface(settings),bi=jolt.GetPhysicsSystem().GetBodyInterface();J.destroy(settings)
function add(shape,x,y,z,dynamic){const pos=new J.RVec3(x,y,z),q=new J.Quat(0,0,0,1),s=new J.BodyCreationSettings(shape,pos,q,dynamic?J.EMotionType_Dynamic:J.EMotionType_Static,dynamic?1:0);const b=bi.CreateBody(s);bi.AddBody(b.GetID(),dynamic?J.EActivation_Activate:J.EActivation_DontActivate);J.destroy(s);J.destroy(pos);J.destroy(q)}
add(new J.BoxShape(new J.Vec3(24,.5,24),.05),0,-.5,0,false)
for(let i=0;i<40;i++)add(new J.BoxShape(new J.Vec3(.8,.8,.8),.05),(i%8-4)*4,.8,(Math.floor(i/8)-2)*4,false)
for(let i=0;i<50;i++)add(new J.SphereShape(.3),(i%10-5)*1.2,3+Math.floor(i/10)*1.2,1,true)
time('Jolt',()=>jolt.Step(1/60,1),()=>J.destroy(jolt))
await fs.mkdir('docs/research/evidence',{recursive:true});await fs.writeFile('docs/research/evidence/engine-benchmark.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
