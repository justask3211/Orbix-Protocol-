/* Development-only deterministic render fixture; excluded from production entry graph. */
import { Suspense, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useFrame } from '@react-three/fiber'
import { ACESFilmicToneMapping } from 'three'
import ArenaWorld from '../worlds/ArenaWorld'
import FieldLighting from '../worlds/FieldLighting'
import { terrainHeight } from '../worlds/terrain'

const height = (x: number, z: number) => terrainHeight(x, z, 'island')
const body = (x: number, z: number, character: string) => ({ x, z, y: height(x,z), yaw: Math.PI, hp:100,maxHp:100,speed:5,onGround:true,groundHeight:height(x,z),character,weapon:'hands',inputSeq:0 })
const state: Record<string, any> = {roundId:'review',worldVersion:4,arena:true,terrain:{kind:'field-v1',theme:'island'},bounds:{width:40,depth:40},serverTimeMs:10000,nowMs:1000,tick:0,
  bodies:{local:body(-3,10,'cat'),friend:body(0,7,'turtle')},
  obstacles:[[-9,-7,4,2,1.2],[9,7,4,2,1.2],[-10,9,2,3,2.4],[10,-9,2,3,2.4],[-4,-12,4,2,2.8],[4,12,4,2,2.8]].map(([x,z,width,depth,height],i)=>({id:`cover-${i}`,x,z,width,depth,height,baseY:globalThis.Number.isFinite(x)?terrainHeight(x,z,'island'):0,kind:i>3?'bunker':'cover'})),
  crates:[{id:'crate-1',x:-7,z:5,y:height(-7,5),hp:40}],airdrops:[{id:'supply',x:-1,z:5,y:height(-1,5),spawnAt:0,landAt:1,opened:false}],
  drops:[{id:'coin',x:-2,z:7,y:height(-2,7),spawnAt:0,landAt:1,kind:'coin',value:5}],events:[],projectiles:[]}
const cameraRef = {current:{yaw:Math.PI,pitch:.15,mode:'third' as const}}
const stats = {ready:false,frames:[] as number[],calls:0,triangles:0,geometries:0,textures:0}
Object.assign(window,{orbixReview:{state,stats}})
function Monitor(){useFrame(({gl},dt)=>{if(stats.ready){stats.frames.push(dt*1000);stats.calls=gl.info.render.calls;stats.triangles=gl.info.render.triangles;stats.geometries=gl.info.memory.geometries;stats.textures=gl.info.memory.textures;if(stats.frames.length>600)stats.frames.shift()}},-3);return null}
function Fixture() {
  const [snapshot, setSnapshot] = useState(state), [mounted, setMounted] = useState(true)
  Object.assign(window, { orbixReview: { state: snapshot, stats, update: (patch: Record<string, any>) => setSnapshot(old => ({ ...old, ...patch })), mount: (value: boolean) => setMounted(value) } })
  return <Canvas dpr={1} shadows={false} camera={{fov:58,near:.08,far:180}} gl={{antialias:true,toneMapping:ACESFilmicToneMapping,toneMappingExposure:1.05}}>
    <color attach="background" args={['#e4dfcf']}/><fog attach="fog" args={['#e4dfcf',38,120]}/><FieldLighting game="token-catch" shadows={false}/><Monitor/>
    {mounted && <Suspense fallback={null}><ArenaWorld state={snapshot} game="token-catch" me="local" players={['local','friend']} cameraRef={cameraRef} reducedMotion={true} onAssetsReady={()=>{stats.ready=true}}/></Suspense>}
  </Canvas>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
