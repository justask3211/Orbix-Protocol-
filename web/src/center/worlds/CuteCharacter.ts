/** Original procedural meshes on the existing CC0 skeleton. All 20 in-place clips bind unchanged. */
import {BufferAttribute,BufferGeometry,BoxGeometry,ConeGeometry,CylinderGeometry,Material,Matrix4,MeshStandardMaterial,Quaternion,SkinnedMesh,SphereGeometry,Vector3} from 'three'
import {clone} from 'three/addons/utils/SkeletonUtils.js'
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js'
import {characterInfo,type Appearance} from '../characters'
import {cartoonFinish} from './cartoonStyle'

export function buildCuteCharacter(gltf:GLTF, appearance:Appearance={}, distant=false) {
  const scene=clone(gltf.scene);scene.updateMatrixWorld(true)
  let source:SkinnedMesh|undefined
  scene.traverse(object=>{if((object as SkinnedMesh).isSkinnedMesh){source??=object as SkinnedMesh;object.visible=false}})
  if(!source)throw new Error('Character skeleton unavailable')
  const skeleton=source.skeleton, info=characterInfo(appearance.character), id=info.id, cosmetics=appearance.cosmetics??{}
  const outfit=({coral:'#f99a92',mint:'#8adbc4',lilac:'#bdacf0',dress:'#e99cc6'} as Record<string,string>)[cosmetics.outfit??'']??info.color
  const materials=[outfit,info.color,'#fff6df','#303348','#f4b65f'].map(color=>{const m=new MeshStandardMaterial({color});cartoonFinish(m);return m})
  const positions:number[]=[],normals:number[]=[],indices:number[]=[],weights:number[]=[],skins:number[]=[],groups:{start:number;count:number;materialIndex:number}[]=[]
  const points=new Map(skeleton.bones.map(bone=>[bone.name,bone.getWorldPosition(new Vector3()).applyMatrix4(new Matrix4().copy(scene.matrixWorld).invert())]))
  const segments=distant?6:12, rings=distant?4:8
  const part=(bone:string,center:Vector3,size:[number,number,number],material=0,shape='round',rotation?:Quaternion)=>{
    const geometry=shape==='box'?new BoxGeometry(1,1,1):shape==='cone'?new ConeGeometry(.5,1,segments):shape==='cylinder'?new CylinderGeometry(.5,.5,1,segments):new SphereGeometry(.5,segments,rings)
    geometry.scale(...size);if(rotation)geometry.applyQuaternion(rotation);geometry.translate(center.x,center.y,center.z)
    const offset=positions.length/3,p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),skin=Math.max(0,skeleton.bones.findIndex(b=>b.name===bone)),start=indices.length
    for(let v=0;v<p.count;v++){positions.push(p.getX(v),p.getY(v),p.getZ(v));normals.push(n.getX(v),n.getY(v),n.getZ(v));skins.push(skin,0,0,0);weights.push(1,0,0,0)}
    for(let v=0;v<(geometry.index?.count??0);v++)indices.push(offset+geometry.index!.getX(v))
    groups.push({start,count:indices.length-start,materialIndex:material});geometry.dispose()
  }
  const at=(bone:string,offset:[number,number,number]=[0,0,0])=>(points.get(bone)??points.get('pelvis')!).clone().add(new Vector3(...offset))
  const limb=(bone:string,end:string,radius:number)=>{const a=at(bone),b=at(end),q=new Quaternion().setFromUnitVectors(new Vector3(0,1,0),b.clone().sub(a).normalize());part(bone,a.add(b).multiplyScalar(.5),[radius,a.distanceTo(b)*2+radius*.5,radius],0,id==='toy-robot'?'box':'round',q)}
  const chunky=['blob','cat-blob','pancake','marshmallow'].includes(id)
  const bodySize:[number,number,number]=id==='pancake'?[1.03,.30,.74]:id==='marshmallow'?[.82,.66,.61]:id==='toy-robot'?[.78,.63,.48]:chunky?[.88,.72,.65]:[.68,.76,.52]
  part('spine_01',at('spine_01',[0,.11,0]),bodySize,0,['toy-robot','marshmallow'].includes(id)?'box':'round')
  const headSize:[number,number,number]=id==='duckling'?[.62,.59,.58]:id==='pancake'?[.71,.24,.55]:id==='knight'?[.56,.55,.53]:chunky?[.74,.62,.58]:[.59,.66,.53]
  part('Head',at('Head',[0,.04,.035]),headSize,1,['toy-robot','marshmallow'].includes(id)?'box':'round')
  for(const side of ['l','r']){
    limb(`upperarm_${side}`,`lowerarm_${side}`,.19);limb(`lowerarm_${side}`,`hand_${side}`,.17)
    part(`hand_${side}`,at(`hand_${side}`),[.23,.22,.23],2)
    limb(`thigh_${side}`,`calf_${side}`,.24);limb(`calf_${side}`,`foot_${side}`,.20)
    part(`foot_${side}`,at(`foot_${side}`,[0,-.005,.07]),[.31,.19,.38],id==='duckling'?4:0)
  }
  // Faces stay attached to the head, so combat/jump/celebration clips drive every variant.
  for(const x of [-.12,.12]){part('Head',at('Head',[x,.09,headSize[2]*.49]),[.055,.085,.035],3);if(!distant)part('Head',at('Head',[x-.009,.112,headSize[2]*.52]),[.018,.021,.012],2)}
  part('Head',at('Head',[0,-.05,headSize[2]*.50]),[.085,.028,.025],3)
  if(id==='cat-blob')for(const x of [-.24,.24])part('Head',at('Head',[x,.36,0]),[.24,.32,.20],1,'cone')
  if(id==='duckling')part('Head',at('Head',[0,-.045,.33]),[.26,.12,.29],4)
  if(id==='knight'){part('Head',at('Head',[0,.10,.04]),[.66,.62,.60],0);part('Head',at('Head',[0,.08,.345]),[.42,.12,.055],3,'box');part('Head',at('Head',[0,.44,-.03]),[.10,.34,.26],4)}
  if(id==='astronaut'){part('Head',at('Head',[0,.09,.075]),[.72,.74,.65],2);part('Head',at('Head',[0,.09,.32]),[.54,.43,.18],3);part('spine_01',at('spine_01',[0,.12,.30]),[.30,.25,.04],4,'box')}
  if(id==='toy-robot'){part('Head',at('Head',[0,.42,0]),[.045,.30,.045],3,'cylinder');part('Head',at('Head',[0,.57,0]),[.12,.12,.12],4);part('spine_01',at('spine_01',[0,.12,.26]),[.36,.29,.05],2,'box')}
  if(id==='pancake'){for(const y of [-.19,.19])part('spine_01',at('spine_01',[0,.11+y,0]),[1,.16,.72],1,'cylinder');part('Head',at('Head',[0,.21,0]),[.23,.08,.24],4,'box')}
  if(id==='jelly-ninja'){part('Head',at('Head',[0,.03,.30]),[.56,.19,.05],3,'box');part('Head',at('Head',[.36,.10,-.15]),[.44,.12,.12],4)}
  if(id==='sprout'){part('Head',at('Head',[0,.42,0]),[.06,.35,.06],0,'cylinder');for(const x of [-.15,.15])part('Head',at('Head',[x,.48,0]),[.39,.13,.24],1)}
  if(id==='marshmallow')part('spine_01',at('spine_01',[0,-.12,.32]),[.81,.13,.06],4,'box')
  if(cosmetics.hat==='cap')part('Head',at('Head',[0,.39,.09]),[.70,.16,.70],0)
  if(cosmetics.hat==='crown')for(const x of [-.24,0,.24])part('Head',at('Head',[x,.42,.02]),[.18,.28,.16],4,'cone')
  if(cosmetics.hat==='bow')for(const x of [-.12,.12])part('Head',at('Head',[x,.38,.10]),[.27,.20,.12],4)
  if(cosmetics.glasses==='round')for(const x of [-.12,.12]){part('Head',at('Head',[x,.09,.38]),[.20,.20,.045],3);part('Head',at('Head',[x,.09,.408]),[.15,.15,.018],2)}
  if(cosmetics.glasses==='visor')part('Head',at('Head',[0,.09,.38]),[.55,.18,.07],3,'box')
  if(cosmetics.outfit==='dress')part('pelvis',at('pelvis',[0,-.04,0]),[.95,.46,.72],0,'cone',new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI))
  if(cosmetics.accessory==='scarf')part('neck_01',at('neck_01',[0,-.03,.025]),[.48,.15,.49],4)
  if(cosmetics.accessory==='backpack')part('spine_01',at('spine_01',[0,.12,-.37]),[.44,.49,.26],4,'box')
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(new Float32Array(positions),3));geometry.setAttribute('normal',new BufferAttribute(new Float32Array(normals),3));geometry.setAttribute('skinIndex',new BufferAttribute(new Uint16Array(skins),4));geometry.setAttribute('skinWeight',new BufferAttribute(new Float32Array(weights),4));geometry.setIndex(indices)
  // Group by palette region: at most five draw calls, regardless of part count.
  const ordered:number[]=[]
  for(let material=0;material<materials.length;material++){
    const start=ordered.length
    for(const group of groups)if(group.materialIndex===material)ordered.push(...indices.slice(group.start,group.start+group.count))
    if(ordered.length>start)geometry.addGroup(start,ordered.length-start,material)
  }
  geometry.setIndex(ordered)
  const mesh=new SkinnedMesh(geometry,materials);mesh.name=`OrbixOriginal_${id}`;mesh.bind(skeleton,new Matrix4());mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;scene.add(mesh)
  let released=false
  return {scene,materials:materials as Material[],geometry,release(){if(released)return;released=true;geometry.dispose();materials.forEach(m=>m.dispose());skeleton.dispose()}}
}
