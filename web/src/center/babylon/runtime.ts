import {Engine,Scene,TransformNode,MeshBuilder,SceneInstrumentation,type InstantiatedEntries} from './api'
import {enableCapsulePhysics} from './physics'
import {FollowRig} from './camera'
import {CharacterAssets} from './assets'
import {BabylonActor} from './actor'
import {MotionTrack,type MotionPose} from './motion'
import {SunnydropEnvironment,material} from './environment'
import {WorldObjects,prop} from './objects'
import {FirstPersonFeedback} from './feedback'
import {number,type BabylonProps,type LoadStage,type FrameStats,type Body} from './types'

type ActorSlot={identity:string;generation:number;track:MotionTrack;pose:MotionPose;actor?:BabylonActor;pending?:Promise<void>}
type Callbacks={stage:(stage:LoadStage)=>void;error:(error:unknown)=>void;metrics:(stats:FrameStats)=>void}
export class BabylonRuntime {
  readonly engine: Engine
  readonly scene: Scene
  readonly assets: CharacterAssets
  readonly camera: FollowRig
  private environment?: SunnydropEnvironment
  private objects?: WorldObjects
  private hands?: FirstPersonFeedback
  private actors=new Map<string,ActorSlot>()
  private instrumentation: SceneInstrumentation
  private props: BabylonProps
  private disposed=false
  private ready=false
  private started=false
  private frames:number[]=[]
  private lastFrame=0
  private lastReport=0
  private round: unknown
  private laneItems=new Map<string,TransformNode>()
  private lanePlayer?:TransformNode
  private laneClock={elapsed:-1,received:0}
  private observer: ResizeObserver
  private clock={server:0,received:0}
  private dpr: number
  private scaleSamples:number[]=[]
  private warmupAt=performance.now()
  private debug?: Record<string,any>
  constructor(canvas:HTMLCanvasElement,props:BabylonProps,private callbacks:Callbacks) {
    this.props=props
    this.dpr=Math.min(window.devicePixelRatio||1,props.quality==='fast'?1:props.quality==='sharp'?2:1.5)
    this.engine=new Engine(canvas,true,{preserveDrawingBuffer:false,stencil:true,powerPreference:'high-performance',adaptToDeviceRatio:false})
    this.engine.setHardwareScalingLevel(1/this.dpr)
    this.scene=new Scene(this.engine);this.scene.useRightHandedSystem=true
    this.assets=new CharacterAssets(this.scene)
    this.camera=new FollowRig(this.scene,mesh=>this.environment?.collisions.has(mesh)??false)
    this.instrumentation=new SceneInstrumentation(this.scene);this.instrumentation.captureFrameTime=true;this.instrumentation.captureRenderTime=true;this.instrumentation.capturePhysicsTime=true
    this.observer=new ResizeObserver(()=>this.engine.resize());this.observer.observe(canvas)
    this.engine.onContextLostObservable.add(()=>callbacks.error(new Error('The graphics context was lost. Retry to reconnect the world.')))
    if(import.meta.env.DEV||new URLSearchParams(location.search).has('evidence')){
      this.debug={runtime:this,scene:this.scene,engine:'Babylon.js 9.30.0',physics:'Havok 1.3.14',ready:false,frames:this.frames,stats:null,stage:'engine',actors:this.actors,disposed:false,loadMs:0}
      Object.assign(window,{orbixBabylon:this.debug})
    }
    document.addEventListener('visibilitychange',this.visibility)
  }
  update(props:BabylonProps) {this.props=props}
  private stage(stage: LoadStage){this.callbacks.stage(stage);if(this.debug)this.debug.stage=stage}
  async start() {
    this.stage('physics');await enableCapsulePhysics(this.scene)
    if(this.disposed)return
    this.environment=new SunnydropEnvironment(this.scene,this.props.state,this.props.quality??'balanced')
    this.objects=new WorldObjects(this.scene,this.environment)
    this.hands=new FirstPersonFeedback(this.scene,this.camera.first)
    if(this.props.state.arena){
      this.stage('characters');this.syncActors()
      await Promise.all([...this.actors.values()].map(slot=>slot.pending))
    }else this.createLanes()
    if(this.disposed)return
    this.stage('shaders')
    this.engine.resize()
    this.renderFrame(false)
    await this.scene.whenReadyAsync()
    if(this.disposed)return
    // Warm actual skinned/PBR/shadow passes before exposing play, not a timer.
    this.scene.render()
    this.lastFrame=0
    this.started=true;this.engine.runRenderLoop(this.loop)
  }
  private syncActors() {
    const state=this.props.state
    if(this.round!==state.roundId){for(const slot of this.actors.values())slot.actor?.dispose();this.actors.clear();this.round=state.roundId}
    const entries=Object.entries(state.bodies??{}).slice(0,50) as [string,Body][]
    // Server privacy settings are reflected in the shared props/body state.
    const visible=new Set(this.props.players)
    const active=new Set<string>()
    for(const [who,body]of entries){
      if(state._hidePlayers&&who!==this.props.me&&!visible.has(who))continue
      active.add(who)
      const identity=`${body.character??'blob'}:${JSON.stringify(body.cosmetics??{})}`,local=who===this.props.me
      let slot=this.actors.get(who)
      if(slot?.identity===identity)continue
      if(slot){slot.generation++;slot.actor?.dispose()}
      slot={identity,generation:(slot?.generation??0)+1,track:new MotionTrack(),pose:{x:number(body.x),y:number(body.y),z:number(body.z),yaw:number(body.yaw),moving:0}}
      this.actors.set(who,slot)
      const current=slot
      current.pending=this.assets.load(body.character??'blob',!local||this.props.quality==='fast').then(container=>{
        if(this.disposed||this.actors.get(who)!==current)return
        const entries:InstantiatedEntries=container.instantiateModelsToScene(name=>name,true,{doNotInstantiate:true})
        current.actor=new BabylonActor(this.scene,entries,who,local,this.environment!,body)
      }).catch(error=>{if(!this.disposed&&this.actors.get(who)===current)this.callbacks.error(error)})
    }
    for(const [who,slot]of this.actors)if(!active.has(who)){slot.actor?.dispose();this.actors.delete(who)}
  }
  private createLanes() {
    const state=this.props.state,lanes=number(state.lanes,5)
    for(let i=0;i<lanes;i++){
      const path=MeshBuilder.CreateBox(`catch-lane-${i}`,{width:1.4,height:.06,depth:14},this.scene);path.position.set((i-(lanes-1)/2)*2,.12,0);path.material=material(this.scene,`lane-${i}`,i%2?'#bdc8a2':'#dbd1ac');path.isPickable=true
      path.metadata={lane:i}
    }
    this.lanePlayer=new TransformNode('server-confirmed-paddle',this.scene)
    const paddle=MeshBuilder.CreateBox('paddle',{width:1.35,height:.22,depth:.8},this.scene);paddle.parent=this.lanePlayer;paddle.material=material(this.scene,'paddle-paint','#efb577');paddle.isPickable=false
    this.scene.onPointerObservable.add(info=>{
      if(info.type!==1||this.props.state.finished||this.props.state._canAct===false)return
      const metadata=info.pickInfo?.pickedMesh?.metadata
      if(typeof metadata?.lane==='number')this.props.onLane?.(metadata.lane)
      if(typeof metadata?.spawn==='number')this.props.onCatch?.(metadata.spawn)
    })
  }
  private updateLanes(now:number,dt:number) {
    const state=this.props.state,lanes=number(state.lanes,5),active=new Set<string>()
    if(this.laneClock.elapsed!==number(state.nowMs))this.laneClock={elapsed:number(state.nowMs),received:now}
    const elapsed=this.laneClock.elapsed+(state.finished?0:Math.min(250,now-this.laneClock.received)),caught=new Set(state.caughtIndices?.[this.props.me]??[])
    const myLane=number(state.lanesNow?.[this.props.me],Math.floor(lanes/2))
    if(this.lanePlayer)this.lanePlayer.position.set((myLane-(lanes-1)/2)*2,.5,5.5)
    for(const spawn of state.recent??[]){
      const age=elapsed-number(spawn.atMs)
      if(age< -1500||age>number(state.catchWindowMs,1000)||caught.has(spawn.index))continue
      const key=String(spawn.index);active.add(key)
      let item=this.laneItems.get(key)
      if(!item){item=prop(this.scene,spawn.points<0?'bomb':'coin',`lane-token-${key}`);for(const mesh of item.getChildMeshes()){mesh.isPickable=true;mesh.metadata={spawn:spawn.index}}this.laneItems.set(key,item)}
      item.position.set((number(spawn.lane)-(lanes-1)/2)*2,.75+Math.max(0,-age)*.006,5.5)
      item.rotation.y=this.props.reducedMotion?0:now*.002
    }
    for(const[key,item]of this.laneItems)if(!active.has(key)){item.dispose(false,true);this.laneItems.delete(key)}
    this.camera.update({x:0,y:0,z:5,yaw:Math.PI,moving:0}, {yaw:Math.PI,pitch:.38,mode:'third'},dt,Boolean(this.props.reducedMotion))
  }
  private renderFrame(record:boolean) {
    if(this.disposed||document.hidden)return
    const now=performance.now(),raw=this.lastFrame?now-this.lastFrame:16.7,dt=Math.min(raw/1000,.06)
    this.lastFrame=now
    const {state,inputRef,cameraRef,me,reducedMotion}=this.props
    if(this.clock.server!==number(state.serverTimeMs)){this.clock={server:number(state.serverTimeMs),received:now}}
    const serverNow=this.clock.server+Math.min(250,now-this.clock.received)
    if(state.arena){
      this.syncActors()
      for(const[who,slot]of this.actors){
        const body=state.bodies?.[who];if(!body)continue
        const input=who===me?inputRef?.current:undefined
        slot.track.receive(body,state,now,input);slot.track.update(slot.pose,state,now,dt,input)
        slot.actor?.update(body,state,slot.pose,serverNow,dt,Boolean(reducedMotion),cameraRef?.current.mode==='first',Boolean(input?.sprint??body.sprinting))
      }
      const follow=this.actors.get(me)??this.actors.values().next().value
      if(follow)this.camera.update(follow.pose,cameraRef?.current,dt,Boolean(reducedMotion))
      this.hands?.update(state.bodies?.[me],serverNow,now,Boolean(reducedMotion),cameraRef?.current.mode==='first')
      this.environment?.updateCover(state);this.objects?.update(state,now,dt,Boolean(reducedMotion))
    }else this.updateLanes(now,dt)
    this.scene.render()
    if(!this.ready){
      const snapshot=!state.arena||Object.keys(state.bodies??{}).length>0
      const loaded=[...this.actors.values()].every(slot=>!!slot.actor)
      if(record&&snapshot&&loaded&&this.scene.isReady()){this.ready=true;this.stage('ready');if(this.debug){this.debug.ready=true;this.debug.loadMs=now-this.warmupAt}}
      else if(record&&loaded)this.stage('snapshot')
    }
    if(record&&this.ready){
      this.frames.push(raw);if(this.frames.length>600)this.frames.shift()
      this.scaleSamples.push(raw);if(this.scaleSamples.length>90)this.scaleSamples.shift()
      if(now-this.lastReport>=1500){
        const sorted=this.frames.slice().sort((a,b)=>a-b),p50=sorted[Math.floor(sorted.length*.5)]??raw,p95=sorted[Math.floor(sorted.length*.95)]??raw
        const stats:FrameStats={samples:sorted.length,p50,p95,fps:Math.round(1000/Math.max(1,p50)),calls:this.instrumentation.drawCallsCounter.current,triangles:this.scene.getActiveIndices()/3,meshes:this.scene.meshes.length,dpr:this.dpr,renderMs:this.instrumentation.renderTimeCounter.current,physicsMs:this.instrumentation.physicsTimeCounter.current}
        this.callbacks.metrics(stats);if(this.debug)this.debug.stats=stats
        // Resolution hysteresis includes slow frames; never drops telemetry outliers.
        if(this.scaleSamples.length>=20&&p95>55&&this.dpr>.65){this.dpr=Math.max(.65,this.dpr-.15);this.engine.setHardwareScalingLevel(1/this.dpr);this.engine.resize();this.scaleSamples=[]}
        this.lastReport=now
      }
    }
  }
  private loop=()=>{try{this.renderFrame(true)}catch(error){this.engine.stopRenderLoop(this.loop);this.callbacks.error(error)}}
  private visibility=()=>{this.lastFrame=0;if(document.hidden)this.engine.stopRenderLoop(this.loop);else if(!this.disposed&&this.started)this.engine.runRenderLoop(this.loop)}
  dispose() {
    if(this.disposed)return
    this.disposed=true;this.engine.stopRenderLoop();document.removeEventListener('visibilitychange',this.visibility);this.observer.disconnect()
    for(const slot of this.actors.values())slot.actor?.dispose();this.actors.clear();this.objects?.dispose();this.hands?.dispose();this.assets.dispose()
    for(const item of this.laneItems.values())item.dispose(false,true);this.laneItems.clear()
    this.camera.dispose();this.instrumentation.dispose();this.scene.dispose();this.engine.dispose()
    if(this.debug){this.debug.disposed=true;this.debug.ready=false}
  }
}
