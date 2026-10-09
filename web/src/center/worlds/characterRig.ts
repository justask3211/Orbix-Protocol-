/** Shared rig topology with shorter mascot legs. Only actor presentation is retargeted. */
import {Vector3,type SkinnedMesh} from 'three'
import {clone} from 'three/addons/utils/SkeletonUtils.js'
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js'
const cache=new WeakMap<GLTF,Map<number,GLTF>>()
export function characterRig(gltf:GLTF,id:string):GLTF {
  const scale=id==='turtle'?.62:id==='cat'?.76:.82
  const variants=cache.get(gltf)??new Map<number,GLTF>();cache.set(gltf,variants)
  const existing=variants.get(scale);if(existing)return existing
  const scene=clone(gltf.scene) as GLTF['scene'];scene.updateMatrixWorld(true)
  const before=scene.getObjectByName('foot_l')!.getWorldPosition(new Vector3()).y
  for(const side of ['l','r'])for(const name of ['calf','foot'])scene.getObjectByName(`${name}_${side}`)!.position.multiplyScalar(scale)
  scene.updateMatrixWorld(true)
  const drop=scene.getObjectByName('foot_l')!.getWorldPosition(new Vector3()).y-before
  scene.getObjectByName('pelvis')!.position.y-=drop;scene.updateMatrixWorld(true)
  const skeletons=new Set<SkinnedMesh['skeleton']>();scene.traverse(o=>{if((o as SkinnedMesh).isSkinnedMesh)skeletons.add((o as SkinnedMesh).skeleton)})
  for(const skeleton of skeletons){
    // SkeletonUtils clones share the inverse array. Detach it before rebinding proportions.
    skeleton.boneInverses=skeleton.boneInverses.map(matrix=>matrix.clone())
    skeleton.calculateInverses()
  }
  const animations=gltf.animations.map(original=>{const clip=original.clone();for(const track of clip.tracks)if(track.name==='pelvis.position')for(let i=1;i<track.values.length;i+=3)track.values[i]-=drop;return clip})
  const result={...gltf,scene,animations};variants.set(scale,result);return result
}
