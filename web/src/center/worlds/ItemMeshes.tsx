import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { InstancedBufferAttribute, InstancedMesh, MeshStandardMaterial, Object3D, Quaternion, Vector3 } from 'three'
import type { GameWorldProps } from './GameWorld'
import { ITEM_KINDS, itemKind, makeItemGeometry, type ItemKind } from './ItemAssets'
const num = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
export type GripBones = { right?: Object3D; left?: Object3D }

function useItems(dissolve = false) {
  const assets = useMemo(() => {
    const geometries = Object.fromEntries(ITEM_KINDS.map(kind => [kind,makeItemGeometry(kind)])) as Record<ItemKind, ReturnType<typeof makeItemGeometry>>
    const material = new MeshStandardMaterial({vertexColors:true,roughness:.6,metalness:.08})
    if (dissolve) {
      material.onBeforeCompile = shader => {
        shader.vertexShader = 'attribute float itemFade; varying float vItemFade; varying vec3 vItemLocal;\n' + shader.vertexShader
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvItemFade = itemFade; vItemLocal = position;')
        shader.fragmentShader = 'varying float vItemFade; varying vec3 vItemLocal;\n' + shader.fragmentShader
        shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>',`#include <dithering_fragment>
          float grain = fract(sin(dot(floor(vItemLocal * 35.0),vec3(12.9898,78.233,39.425))) * 43758.5453);
          if (vItemFade > 0.0 && grain < vItemFade) discard;
          if (vItemFade > 0.0 && grain < vItemFade + 0.08) gl_FragColor.rgb = vec3(1.0,0.87,0.48);`)
      }
      material.customProgramCacheKey = () => 'orbix-item-dissolve-v1'
      for (const geometry of Object.values(geometries)) geometry.setAttribute('itemFade',new InstancedBufferAttribute(new Float32Array(450),1))
    }
    return {geometries,material,mounted:false}
  },[dissolve])
  useEffect(() => { assets.mounted=true; return () => {assets.mounted=false;queueMicrotask(()=>{if(!assets.mounted){Object.values(assets.geometries).forEach(g=>g.dispose());assets.material.dispose()}})} },[assets])
  return assets
}

/** Held items follow the actual animated wrist axes; the rig's local +Y points down its fingers. */
export function HeldItems({ hands, ...props }: GameWorldProps & {hands:Map<string,GripBones>}) {
  const assets=useItems(), meshes=useRef(new Map<ItemKind,InstancedMesh>()), transform=useMemo(()=>new Object3D(),[]), position=useMemo(()=>new Vector3(),[]), quaternion=useMemo(()=>new Quaternion(),[])
  useFrame(()=>{
    const counts = new Map<ItemKind,number>(), now=num(props.state.serverTimeMs,Date.now())
    for(const [who,body] of Object.entries(props.state.bodies??{}) as [string,Record<string,any>][]) {
      if(num(body.hp,100)<=0||num(body.respawnAt)>now||who===props.me&&props.cameraRef?.current.mode==='first')continue
      const grip=hands.get(who)
      const attach=(kind:ItemKind,bone?:Object3D)=>{
        const mesh=meshes.current.get(kind),index=counts.get(kind)??0
        if(!bone||!mesh||index>=50)return
        bone.getWorldPosition(position);bone.getWorldQuaternion(quaternion)
        transform.position.copy(position);transform.quaternion.copy(quaternion)
        // Gun +Z barrel becomes hand +Y. Shield +Z faces away from the forearm.
        if(kind==='gun')transform.rotateX(-Math.PI/2)
        if(kind==='shield'){transform.rotateY(Math.PI/2);transform.translateZ(.04)}
        transform.scale.setScalar(kind==='shield'?.8:1);transform.updateMatrix();mesh.setMatrixAt(index,transform.matrix);counts.set(kind,index+1)
      }
      if(['gun','sword','spear'].includes(body.weapon))attach(body.weapon,grip?.right)
      if(num(body.shieldUntil)>now)attach('shield',grip?.left)
    }
    for(const [kind,mesh] of meshes.current){mesh.count=counts.get(kind)??0;mesh.instanceMatrix.needsUpdate=true}
  },-1.4)
  return <>{(['shield','gun','sword','spear'] as ItemKind[]).map(kind=><instancedMesh key={kind} ref={mesh=>{if(mesh)meshes.current.set(kind,mesh);else meshes.current.delete(kind)}} args={[assets.geometries[kind],assets.material,50]} frustumCulled={false} castShadow dispose={null}/>)}</>
}

type VisualDrop = {drop:Record<string,any>;born:number;collected?:number}
/** Removal by authority alone triggers the dissolve. Reconnect/reset discards old cosmetics. */
export default function ItemPickups({state,reducedMotion}:Pick<GameWorldProps,'state'|'reducedMotion'>) {
  const assets=useItems(true), meshes=useRef(new Map<ItemKind,InstancedMesh>()), visuals=useRef(new Map<string,VisualDrop>()), round=useRef(state.roundId),received=useRef({at:performance.now(),server:num(state.nowMs)})
  const transform=useMemo(()=>new Object3D(),[])
  useFrame(({clock})=>{
    const time=performance.now()
    if(round.current!==state.roundId){visuals.current.clear();round.current=state.roundId}
    if(received.current.server!==num(state.nowMs))received.current={at:time,server:num(state.nowMs)}
    const now=num(state.nowMs)+(state.finished?0:Math.min(250,time-received.current.at)),present=new Set<string>()
    for(const drop of (state.drops??[]).slice(0,450)) {
      present.add(drop.id)
      if(!visuals.current.has(drop.id))visuals.current.set(drop.id,{drop,born:time})
      else visuals.current.get(drop.id)!.drop=drop
    }
    const counts=new Map<ItemKind,number>()
    for(const [id,item] of visuals.current){
      if(!present.has(id)&&item.collected===undefined)item.collected=time
      const fade=item.collected===undefined?0:reducedMotion?1:Math.min(1,(time-item.collected)/320)
      if(fade>=1||now>num(item.drop.expiresAt,Infinity)){visuals.current.delete(id);continue}
      const drop=item.drop,kind=itemKind(drop.kind),mesh=meshes.current.get(kind),index=counts.get(kind)??0
      if(!mesh||index>=450||now<num(drop.spawnAt))continue
      const falling=1-Math.min(1,(now-num(drop.spawnAt))/Math.max(1,num(drop.landAt)-num(drop.spawnAt)))
      const pop=reducedMotion?1:Math.min(1,(time-item.born)/180),size=(.65+.35*Math.sin(pop*Math.PI/2))*(1+Math.sin(fade*Math.PI)*.3)
      transform.position.set(num(drop.x),num(drop.y)+.45+falling*7+(reducedMotion?0:Math.sin(clock.elapsedTime*2+num(drop.x))*.065)+fade*.4,num(drop.z))
      transform.rotation.set(kind==='sword'||kind==='spear'?0:.12,reducedMotion?.25:clock.elapsedTime*.9+num(drop.z),0)
      transform.scale.setScalar(size*(kind==='spear'?.55:kind==='sword'?.7:1));transform.updateMatrix();mesh.setMatrixAt(index,transform.matrix)
      const attribute=assets.geometries[kind].getAttribute('itemFade');attribute.setX(index,fade);attribute.needsUpdate=true;counts.set(kind,index+1)
    }
    for(const [kind,mesh] of meshes.current){mesh.count=counts.get(kind)??0;mesh.instanceMatrix.needsUpdate=true}
  })
  return <>{ITEM_KINDS.map(kind=><instancedMesh key={kind} ref={mesh=>{if(mesh)meshes.current.set(kind,mesh);else meshes.current.delete(kind)}} args={[assets.geometries[kind],assets.material,450]} frustumCulled={false} dispose={null}/>)}</>
}
