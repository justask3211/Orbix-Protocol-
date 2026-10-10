/* Development-only deterministic render fixture; excluded from production entry graph. */
import { Suspense, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useFrame } from '@react-three/fiber'
import { ACESFilmicToneMapping } from 'three'
import ArenaWorld from '../worlds/ArenaWorld'
import FieldLighting from '../worlds/FieldLighting'

import {state,cameraRef} from './reviewState'
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
