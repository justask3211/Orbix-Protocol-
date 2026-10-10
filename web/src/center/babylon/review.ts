/* Development-only controlled fixture; production entry never imports this. */
import {BabylonRuntime} from './runtime'
import {state,cameraRef} from '../framework/reviewState'
import {Scene,Vector3,MeshBuilder} from './api'
import {CapsuleMotor,enableCapsulePhysics,staticCollider} from './physics'
let snapshot={...state},runtime:BabylonRuntime|undefined
const fixture={state:snapshot,update:(patch:Record<string,any>)=>{snapshot={...snapshot,...patch};fixture.state=snapshot;runtime?.update(props())},mount:async(value:boolean)=>{
  runtime?.dispose();runtime=undefined
  if(value){runtime=new BabylonRuntime(document.getElementById('world')as HTMLCanvasElement,props(),{stage:()=>{},error:error=>{throw error},metrics:()=>{},autoScale:false});await runtime.start()}
},physics:async()=>{
  const scene=new Scene(runtime!.engine);await enableCapsulePhysics(scene)
  try{
    const floor=MeshBuilder.CreateBox('physics-test-floor',{width:30,height:.2,depth:30},scene);floor.position.y=-.1;staticCollider(floor,scene)
    const step=MeshBuilder.CreateBox('low-step',{width:1,height:.15,depth:2},scene);step.position.set(0,.075,0);staticCollider(step,scene)
    const wall=MeshBuilder.CreateBox('wall',{width:1,height:2,depth:2},scene);wall.position.set(4,1,0);staticCollider(wall,scene)
    const motor=new CapsuleMotor(scene,new Vector3(-2,0,0));let maxHeight=0,position=Vector3.Zero()
    for(let i=0;i<120;i++){position=motor.freeMove(1,0,false,false,1/60);maxHeight=Math.max(maxHeight,position.y)}
    const result={x:position.x,y:position.y,maxHeight,stepHeight:motor.capsule.maxStepHeight,slopeCosine:motor.capsule.maxSlopeCosine}
    motor.dispose();return result
  }finally{scene.dispose()}
}}
const props=()=>({game:'token-catch' as const,state:snapshot,me:'local',players:['local','friend'],cameraRef,quality:'fast' as const,reducedMotion:true})
Object.assign(window,{orbixBabylonReview:fixture})
void fixture.mount(true)
