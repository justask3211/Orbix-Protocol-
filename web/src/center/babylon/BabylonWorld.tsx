import {useEffect,useRef,useState} from 'react'
import type {GameWorldProps,WorldQuality} from '../worlds/GameWorld'
import type {BabylonRuntime} from './runtime'
import {STAGES,type LoadStage,type FrameStats} from './types'
import '../worlds/worlds.css'
import './babylon.css'

/** Engine ownership is confined to this canvas effect. Existing DOM input, HUD,
 * signed results, rematch and reward/claim components stay shared. */
export default function BabylonWorld(props:GameWorldProps) {
  const canvas=useRef<HTMLCanvasElement>(null),runtime=useRef<BabylonRuntime|null>(null),latest=useRef(props)
  latest.current=props
  const [stage,setStage]=useState<LoadStage>('engine'),[error,setError]=useState<string|null>(null),[attempt,setAttempt]=useState(0)
  const [quality,setQuality]=useState<WorldQuality>(()=>matchMedia('(max-width:799px), (pointer:coarse)').matches?'fast':'balanced')
  const [metrics,setMetrics]=useState<FrameStats|null>(null)
  const [motion,setMotion]=useState(()=>matchMedia('(prefers-reduced-motion:reduce)').matches)
  const reduced=props.reducedMotion??motion
  const worldKey=`${props.me}:${props.state.roundId??''}:${Boolean(props.state.arena)}:${props.state.terrain?.kind??'flat'}:${props.state.terrain?.theme??''}`
  useEffect(()=>{const query=matchMedia('(prefers-reduced-motion:reduce)'),change=()=>setMotion(query.matches);query.addEventListener('change',change);return()=>query.removeEventListener('change',change)},[])
  useEffect(()=>{
    let active=true,owned:BabylonRuntime|undefined
    setStage('engine');setError(null);setMetrics(null)
    void import('./runtime').then(async({BabylonRuntime})=>{
      if(!active||!canvas.current)return
      owned=new BabylonRuntime(canvas.current,{...latest.current,quality,reducedMotion:latest.current.reducedMotion??motion},{stage:value=>{if(active)setStage(value)},error:failure=>{if(active)setError(failure instanceof Error?failure.message:'The world could not load.')},metrics:value=>{if(active)setMetrics(value)}})
      runtime.current=owned;await owned.start()
    }).catch(failure=>{if(active)setError(failure instanceof Error?failure.message:'The world could not load.')})
    return()=>{active=false;owned?.dispose();runtime.current=null}
  // High-rate body snapshots keep the scene. A new round or terrain descriptor
  // owns fresh colliders, including host rematches between flat and field-v1.
  },[quality,attempt,worldKey])
  useEffect(()=>{runtime.current?.update({...props,quality,reducedMotion:reduced})},[props,quality,reduced])
  return <section className="ow-world ow-token-catch ow-perspective-world ob-world" data-renderer="babylon" aria-label="Sunnydrop Outpost 3D game environment">
    <div className="ow-world-title"><span className="ow-world-dot" aria-hidden/><span>Sunnydrop Outpost</span><small>{metrics?`${metrics.fps} FPS`:'TOKEN CATCH'}</small>{metrics&&<details className="ow-performance"><summary aria-label="Frame performance">{Math.round(metrics.p95)} ms p95</summary><div><strong>Frame intervals</strong><span>p50 {metrics.p50.toFixed(1)} ms · p95 {metrics.p95.toFixed(1)} ms</span><span>{metrics.samples} samples · {metrics.calls} draw calls</span><span>{Math.round(metrics.triangles).toLocaleString()} triangles · DPR {metrics.dpr.toFixed(2)}</span><span>{metrics.p95<=33.3?'Within the 30 FPS frame target':'Above the 30 FPS frame target'}</span></div></details>}<label className="ow-quality">Graphics<select value={quality} onChange={event=>setQuality(event.target.value as WorldQuality)}><option value="fast">Fast</option><option value="balanced">Balanced</option><option value="sharp">Sharp</option></select></label></div>
    <div className="ow-canvas-wrap"><canvas ref={canvas} aria-label="Token Catch game world"/>
      {stage!=='ready'&&!error&&<div className="ow-loading ow-loading-assets ob-loading" role="status"><span className="ow-loading-mascot" aria-hidden>✦</span><strong>Preparing Sunnydrop…</strong><span>{STAGES[stage]}</span><ol aria-label="Loading stages">{(['engine','physics','characters','shaders','snapshot']as const).map((item,index)=><li key={item} className={item===stage?'is-current':''}><i aria-hidden>{index+1}</i>{['Renderer','Contacts','Characters','First frame','World sync'][index]}</li>)}</ol></div>}
      {error&&<div className="ow-fallback" role="alert"><strong>Sunnydrop could not load</strong><p>{error}</p><button className="btn-ghost" onClick={()=>setAttempt(value=>value+1)}>Retry 3D view</button></div>}
      {stage==='ready'&&!error&&<div className="ow-scene-caption" aria-hidden><span>{props.state.finished?'ROUND COMPLETE':'SUNNYDROP · SUPPLY RUN'}</span><span>{props.state.arena?'MOVE · LOOK · JUMP · LOOT':'MOVE · CATCH'}</span></div>}
    </div><p className="ow-world-note">Run to supply drops, inspect their loot and collect your share. Watch for bombs and rival players.</p>
  </section>
}
