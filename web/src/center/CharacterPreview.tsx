import {Suspense,useEffect,useMemo,useRef,useState} from 'react'
import {Canvas,useFrame,useLoader} from '@react-three/fiber'
import {AnimationMixer,type Group} from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {buildCuteCharacter} from './worlds/CuteCharacter'
import {characterInfo,type Appearance} from './characters'
function Model({appearance,rotate,reduced}:{appearance:Appearance;rotate:number;reduced:boolean}){
  const gltf=useLoader(GLTFLoader,`${import.meta.env.BASE_URL}center-models/orbix-ranger-lod.glb`)
  const owned=useMemo(()=>buildCuteCharacter(gltf,appearance),[gltf,appearance.character,JSON.stringify(appearance.cosmetics)])
  const lifetime=useMemo(()=>({mounted:false}),[owned])
  const mixer=useMemo(()=>(()=>{const m=new AnimationMixer(owned.scene),idle=owned.animations.find(c=>c.name==='Idle');if(idle){m.clipAction(idle).play();m.update(.35)}return m})(),[owned]),group=useRef<Group>(null)
  useEffect(()=>{const idle=owned.animations.find(clip=>clip.name==='Idle');if(idle){mixer.clipAction(idle).play();mixer.update(.35)}lifetime.mounted=true;return()=>{lifetime.mounted=false;queueMicrotask(()=>{if(!lifetime.mounted){mixer.stopAllAction();mixer.uncacheRoot(owned.scene);owned.release()}})}},[owned,mixer,gltf,lifetime])
  useFrame((_,dt)=>{if(group.current)group.current.rotation.y=rotate+(reduced?0:performance.now()*.00035);if(!reduced)mixer.update(Math.min(dt,.06))})
  return <group ref={group}><primitive object={owned.scene} dispose={null}/></group>
}
export default function CharacterPreview({appearance}:{appearance:Appearance}){
 const [reduced,setReduced]=useState(false),[rotate,setRotate]=useState(0)
 useEffect(()=>{const q=matchMedia('(prefers-reduced-motion: reduce)'),update=()=>setReduced(q.matches);update();q.addEventListener('change',update);return()=>q.removeEventListener('change',update)},[])
 return <div className="pf-character-preview" role="img" aria-label={`${characterInfo(appearance.character).name} character preview`}><Canvas frameloop={reduced?'demand':'always'} camera={{position:[0,1.35,3.7],fov:38}} dpr={[1,1.5]} gl={{alpha:true,powerPreference:'low-power'}} onCreated={({camera})=>camera.lookAt(0,1,0)} fallback={<span>3D preview is unavailable. Character selection still works.</span>}><ambientLight intensity={1.8}/><directionalLight position={[3,5,4]} intensity={2.5}/><Suspense fallback={null}><Model appearance={appearance} reduced={reduced} rotate={rotate}/></Suspense></Canvas><button type="button" className="btn-ghost" onClick={()=>setRotate(v=>v+Math.PI/4)}>Rotate preview</button></div>
}
