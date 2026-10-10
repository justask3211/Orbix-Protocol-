import {useEffect,useMemo,useRef} from 'react'
import {useFrame,useLoader,useThree} from '@react-three/fiber'
import {AnimationMixer,Group} from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {buildCuteCharacter} from './CuteCharacter'
import type {Appearance} from '../characters'
/** Shared immutable round appearance; at most four detailed actors per tabletop. */
export function SeatedMascot({appearance,position,rotation=0,pose='OrbixSeatedIdle',progress=0,reduced=false}:{appearance:Appearance;position:[number,number,number];rotation?:number;pose?:string;progress?:number;reduced?:boolean}){
 const gltf=useLoader(GLTFLoader,`${import.meta.env.BASE_URL}center-models/orbix-ranger-lod.glb`)
 const owned=useMemo(()=>buildCuteCharacter(gltf,appearance),[gltf,appearance.character,JSON.stringify(appearance.cosmetics)])
 const animationUntil=useRef(0)
 const lifetime=useMemo(()=>({mounted:false}),[owned])
 const mixer=useMemo(()=>new AnimationMixer(owned.scene),[owned]),group=useRef<Group>(null),invalidate=useThree(s=>s.invalidate)
 useEffect(()=>{const clip=owned.animations.find(c=>c.name===pose)??owned.animations.find(c=>c.name==='OrbixSeatedIdle');if(clip){animationUntil.current=performance.now()+Math.max(0,1.2-progress)*1000;mixer.stopAllAction();mixer.clipAction(clip).play();mixer.update(reduced?0:Math.max(0,Math.min(progress,1.2)));invalidate()}},[owned,mixer,pose,progress,reduced,invalidate])
 useEffect(()=>{lifetime.mounted=true;return()=>{lifetime.mounted=false;queueMicrotask(()=>{if(!lifetime.mounted){mixer.stopAllAction();mixer.uncacheRoot(owned.scene);owned.release()}})}},[owned,mixer,lifetime])
 useFrame((_,delta)=>{if(!reduced&&pose!=='OrbixSeatedIdle'&&performance.now()<animationUntil.current){mixer.update(Math.min(delta,.05));invalidate()}})
 return <group ref={group} position={position} rotation={[0,rotation,0]} scale={.85}><primitive object={owned.scene} dispose={null}/></group>
}
