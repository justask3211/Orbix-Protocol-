import {Suspense,useEffect,useMemo,useState} from 'react'
import {Canvas,useFrame,useLoader} from '@react-three/fiber'
import {AnimationMixer} from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {buildCuteCharacter} from './worlds/CuteCharacter'
import {characterInfo,type Appearance} from './characters'
function Guest({appearance,index,total,reduced}:{appearance:Appearance;index:number;total:number;reduced:boolean}) {
  const gltf=useLoader(GLTFLoader,`${import.meta.env.BASE_URL}center-models/orbix-ranger-lod.glb`)
  const owned=useMemo(()=>{const character=buildCuteCharacter(gltf,appearance);const mixer=new AnimationMixer(character.scene),idle=character.animations.find(c=>c.name==='Idle');if(idle){mixer.clipAction(idle).play();mixer.update(.35)}return {...character,mixer,mounted:false}},[gltf,appearance.character,JSON.stringify(appearance.cosmetics)])
  useEffect(()=>{owned.mounted=true;const idle=owned.animations.find(c=>c.name==='Idle');if(idle){owned.mixer.clipAction(idle).play();owned.mixer.update(.35)}return()=>{owned.mounted=false;queueMicrotask(()=>{if(!owned.mounted){owned.mixer.stopAllAction();owned.mixer.uncacheRoot(owned.scene);owned.release()}})}},[owned])
  useFrame((_,dt)=>{if(!reduced)owned.mixer.update(Math.min(dt,.06))})
  return <group position={[(index-(total-1)/2)*1.4,0,0]} rotation={[0,-.10,0]}><primitive object={owned.scene} dispose={null}/><mesh rotation={[-Math.PI/2,0,0]} position={[0,.004,0]}><circleGeometry args={[.50,24]}/><meshStandardMaterial color={characterInfo(appearance.character).color} roughness={1}/></mesh></group>
}
export default function CharacterLobby({players,appearances,me}:{players:string[];appearances:Record<string,Appearance>;me:string}) {
  const [reduced,setReduced]=useState(false)
  useEffect(()=>{const q=matchMedia('(prefers-reduced-motion: reduce)'),update=()=>setReduced(q.matches);update();q.addEventListener('change',update);return()=>q.removeEventListener('change',update)},[setReduced])
  const ordered=[...players].sort((a,b)=>Number(b===me)-Number(a===me)).slice(0,6),width=Math.max(4.0,ordered.length*1.25)
  return <section className="ct-character-lobby" aria-label="Lobby characters"><h3>Your crew</h3>{!ordered.length?<p>Join the room to see your character here.</p>:<><Canvas frameloop={reduced?'demand':'always'} camera={{position:[0,1.6,width],fov:35}} dpr={[1,1.5]} gl={{alpha:true,powerPreference:'low-power'}} onCreated={({camera})=>camera.lookAt(0,.75,0)} fallback={<p>3D preview unavailable. Your selected character is still saved.</p>}><ambientLight intensity={1.6}/><directionalLight position={[3,4,5]} intensity={2.8}/><directionalLight position={[-3,2,-2]} intensity={1.2}/><Suspense fallback={null}>{ordered.map((who,i)=><Guest key={who} appearance={appearances[who]??{}} index={i} total={ordered.length} reduced={reduced}/>)}</Suspense></Canvas><div className="ct-lobby-names">{ordered.map(who=><span key={who}>{who===me?'You':`${who.slice(0,6)}…${who.slice(-4)}`} · {characterInfo(appearances[who]?.character).name}</span>)}</div>{players.length>6&&<p>+{players.length-6} players in the roster</p>}</>}</section>
}
