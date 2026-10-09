import {Engine,Scene,Vector3,MeshBuilder,HemisphericLight,ArcRotateCamera,PhysicsShapeType} from '../../../web/src/center/babylon/api'
import {enableCapsulePhysics,staticCollider,CapsuleMotor} from '../../../web/src/center/babylon/physics'
const canvas = document.getElementById('game') as HTMLCanvasElement
const engine = new Engine(canvas,true), scene = new Scene(engine)
const camera = new ArcRotateCamera('camera',-Math.PI/2,1.1,10,new Vector3(0,1,0),scene)
camera.attachControl(canvas,true)
new HemisphericLight('sky',new Vector3(0,1,0),scene)
await enableCapsulePhysics(scene)
const floor = MeshBuilder.CreateBox('floor',{width:20,height:.2,depth:20},scene);floor.position.y=-.1;staticCollider(floor,scene)
const step=MeshBuilder.CreateBox('step',{width:3,height:.24,depth:2},scene);step.position.set(2,.12,0);staticCollider(step,scene)
const slope=MeshBuilder.CreateBox('slope',{width:3,height:.2,depth:6},scene);slope.position.set(-3,.65,0);slope.rotation.x=.24;staticCollider(slope,scene)
const model=MeshBuilder.CreateCapsule('capsule',{height:1.6,radius:.32},scene)
const motor=new CapsuleMotor(scene,new Vector3(0,0,3)),keys=new Set<string>()
window.onkeydown=e=>{keys.add(e.key.toLowerCase());if(e.key===' ')e.preventDefault()};window.onkeyup=e=>keys.delete(e.key.toLowerCase());window.onblur=()=>keys.clear()
Object.assign(window,{orbixCapsulePrototype:{engine:'Babylon.js 9.30.0',physics:'Havok 1.3.14',motor,scene,shape:PhysicsShapeType.CAPSULE}})
engine.runRenderLoop(()=>{const feet=motor.freeMove(Number(keys.has('d'))-Number(keys.has('a')),Number(keys.has('s'))-Number(keys.has('w')),keys.has('shift'),keys.has(' '),engine.getDeltaTime()/1000);model.position.copyFrom(feet).y+=.8;scene.render()})
window.onresize=()=>engine.resize()
