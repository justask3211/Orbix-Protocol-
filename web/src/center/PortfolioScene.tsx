import { Component, Suspense, useState, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { SeatedMascot } from './worlds/SeatedActors'
import type { StageProps } from './stages'

const PALETTES: Record<string, string[]> = {
  'closest-call': ['#ffb543', '#28c7b7', '#4168e8', '#fff3d5'],
  'word-forge': ['#6758dc', '#ff8748', '#ffd36a', '#fff8e6'],
  'prism-lines': ['#49dbbe', '#7a4fd0', '#ff7b72', '#fff6e1'],
  'relic-auction': ['#f4b743', '#d75bb4', '#39c7a0', '#29355c'],
  'atlas-quest': ['#3ba9ee', '#8ad66b', '#ff8460', '#fff1c9'],
}
class SceneBoundary extends Component<{children:ReactNode}, {failed:boolean}> {
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  render(){return this.state.failed?<p className="pf-scene-fallback">Use the diagram and controls below.</p>:this.props.children}
}
class MascotBoundary extends Component<{children:ReactNode}, {failed:boolean}> {
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  render(){return this.state.failed?null:this.props.children}
}
function Props({game,state}:{game:string;state:StageProps['state']}) {
  const colors=PALETTES[game], challenge=state.challenge ?? {}
  if(game==='closest-call') return <>
    {challenge.scene_kind==='jar-count'&&<mesh position={[0,1.7,0]}><cylinderGeometry args={[1.5,1.5,3,24,1,true]}/><meshStandardMaterial color="#c6f4f4" transparent opacity={.17} depthWrite={false}/></mesh>}
    {(challenge.display?.objects??[]).map((o:any,i:number)=><mesh key={i} position={[(o.x-50)/40,.35+o.y/40,(i%3-1)*.35]}><sphereGeometry args={[.11,8,6]}/><meshStandardMaterial color={colors[o.tone]}/></mesh>)}
    <mesh position={[2,.85,0]}><boxGeometry args={[.18,1.7,.18]}/><meshStandardMaterial color={colors[2]}/></mesh>
  </>
  if(game==='word-forge')return <>{String(challenge.rack??'').split('').map((_,i)=><mesh key={i} position={[(i-3.5)*.46,.45,0]} rotation={[0,.1*(i%2),0]}><boxGeometry args={[.4,.4,.4]}/><meshStandardMaterial color={colors[i%3]} roughness={.65}/></mesh>)}<mesh position={[0,1,-1]}><boxGeometry args={[2,1.5,.5]}/><meshStandardMaterial color="#af8b45" metalness={.45} roughness={.45}/></mesh></>
  if(game==='prism-lines')return <>{(state.board??[]).flatMap((row:any[],r:number)=>row.map((who,c)=><mesh key={`${r}-${c}`} position={[(c-(state.columns-1)/2)*.5,.35+(state.rows-1-r)*.48,0]} rotation={[0,0,Math.PI/4]}><octahedronGeometry args={[.24]}/><meshStandardMaterial color={who?colors[state.players.indexOf(who)%2]:'#e7dfce'} roughness={.3} metalness={.1}/></mesh>))}<mesh position={[0,.2,0]}><boxGeometry args={[state.columns*.55,.2,.65]}/><meshStandardMaterial color={colors[2]}/></mesh></>
  if(game==='relic-auction')return <><mesh position={[0,.55,0]}><cylinderGeometry args={[1.3,1.5,.6,24]}/><meshStandardMaterial color="#96724f"/></mesh><mesh position={[0,1.5,0]}>{challenge.prop==='compass'?<torusGeometry args={[.55,.16,12,24]}/>:challenge.prop==='idol'?<octahedronGeometry args={[.7]}/>:<latheGeometry args={[[{x:.2,y:0},{x:.6,y:.3},{x:.65,y:.8},{x:.25,y:1.2},{x:.3,y:1.4}] as any,24]}/>}<meshStandardMaterial color={challenge.colour==='jade'?colors[2]:challenge.colour==='violet'?colors[1]:colors[0]} roughness={.4} metalness={.2}/></mesh></>
  return <><mesh position={[0,1.1,0]}><sphereGeometry args={[.9,24,16]}/><meshStandardMaterial color={colors[0]}/></mesh><mesh position={[0,1.1,0]} rotation={[.2,0,.3]}><torusGeometry args={[1.03,.045,8,48]}/><meshStandardMaterial color="#c4a45b" metalness={.5}/></mesh><mesh position={[0,.15,0]}><cylinderGeometry args={[.6,.75,.2,24]}/><meshStandardMaterial color="#a78552"/></mesh></>
}
export function PortfolioScene({game,state,players}:{game:string;state:StageProps['state'];players:string[]}) {
  const [rotation,setRotation]=useState(0),colors=PALETTES[game]
  const reduced=typeof window!=='undefined'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return <div className="pf-scene"><SceneBoundary><Canvas frameloop="demand" dpr={[1,1.5]} camera={{position:[0,4,8],fov:42}} gl={{antialias:true}}>
    <color attach="background" args={[colors[3]]}/><ambientLight intensity={1.4}/><directionalLight position={[3,7,4]} intensity={2}/>
    <group rotation={[0,rotation,0]}><mesh position={[0,-.1,0]}><cylinderGeometry args={[3.8,3.4,.2,32]}/><meshStandardMaterial color={colors[0]} roughness={.85}/></mesh><Props game={game} state={state}/>
      <MascotBoundary><Suspense fallback={null}>{players.slice(0,4).map((who,i)=><SeatedMascot key={who} appearance={state._appearances?.[who]??{character:['cat','turtle','toy-robot','sprout'][i]}} position={[(i-1.5)*1.5,0,-1.8]} reduced={reduced}/>)}</Suspense></MascotBoundary>
    </group>
  </Canvas></SceneBoundary><label className="pf-rotate">Inspect exhibit<input aria-label="Rotate exhibit locally" type="range" min="-0.5" max="0.5" step="0.05" value={rotation} onChange={e=>setRotation(Number(e.target.value))}/></label></div>
}
export const ClosestCallScene=(p:Omit<Parameters<typeof PortfolioScene>[0],'game'>)=><PortfolioScene {...p} game="closest-call"/>
export const WordForgeScene=(p:Omit<Parameters<typeof PortfolioScene>[0],'game'>)=><PortfolioScene {...p} game="word-forge"/>
export const PrismLinesScene=(p:Omit<Parameters<typeof PortfolioScene>[0],'game'>)=><PortfolioScene {...p} game="prism-lines"/>
export const RelicAuctionScene=(p:Omit<Parameters<typeof PortfolioScene>[0],'game'>)=><PortfolioScene {...p} game="relic-auction"/>
export const AtlasQuestScene=(p:Omit<Parameters<typeof PortfolioScene>[0],'game'>)=><PortfolioScene {...p} game="atlas-quest"/>
