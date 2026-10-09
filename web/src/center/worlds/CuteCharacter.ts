import {characterRig} from './characterRig'
import {locomotion} from './locomotion'
/** Original procedural meshes on the existing CC0 skeleton. All 20 in-place clips bind unchanged. */
import {BufferAttribute,BufferGeometry,BoxGeometry,ConeGeometry,CylinderGeometry,CatmullRomCurve3,TubeGeometry,Material,Matrix4,MeshStandardMaterial,Quaternion,SkinnedMesh,SphereGeometry,Vector3} from 'three'
import {clone} from 'three/addons/utils/SkeletonUtils.js'
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js'
import {characterInfo,type Appearance} from '../characters'
import {cartoonFinish} from './cartoonStyle'

export function buildCuteCharacter(gltf:GLTF, appearance:Appearance={}, distant=false) {
  const info=characterInfo(appearance.character), template=characterRig(gltf,info.id)
  const scene=clone(template.scene);scene.updateMatrixWorld(true)
  let source:SkinnedMesh|undefined
  scene.traverse(object=>{if((object as SkinnedMesh).isSkinnedMesh){source??=object as SkinnedMesh;object.visible=false}})
  if(!source)throw new Error('Character skeleton unavailable')
  const skeleton=source.skeleton, id=info.id, cosmetics=appearance.cosmetics??{}
  const outfit=({coral:'#f99a92',mint:'#8adbc4',lilac:'#bdacf0',dress:'#e99cc6'} as Record<string,string>)[cosmetics.outfit??'']??info.color
  const palette=id==='cat'?[(cosmetics.outfit&&cosmetics.outfit!=='default'?outfit:'#8b745c'),'#b6a28d','#fff1d5','#3c302b','#82b4a5']:id==='turtle'?[outfit,'#647b40','#f2dfab','#303a27','#b59458']:[outfit,info.color,'#fff6df','#303348','#f4b65f']
  const materials=palette.map(color=>{const m=new MeshStandardMaterial({color});cartoonFinish(m);return m})
  if(id==='cat'||id==='cat-blob'){
    for(const index of id==='cat'?[1]:[0,1]){
      const material=materials[index],baseCompile=material.onBeforeCompile
      material.roughness=.98
      material.onBeforeCompile=(shader,renderer)=>{
        baseCompile.call(material,shader,renderer)
        shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 orbixFurPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\norbixFurPosition = position;')
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 orbixFurPosition;').replace('#include <color_fragment>',`#include <color_fragment>
          float grain = fract(sin(dot(floor(orbixFurPosition * 190.0),vec3(12.9898,78.233,37.719))) * 43758.5453);
          float tailStripe = orbixFurPosition.z < -0.34 ? smoothstep(0.35,0.60,sin(orbixFurPosition.y*45.0)) : 0.0;
          diffuseColor.rgb *= 1.0-tailStripe*0.38;
          float fibers = sin(orbixFurPosition.y * 310.0 + sin(orbixFurPosition.x * 100.0)*1.6);
          diffuseColor.rgb *= 0.91 + grain * 0.12 + fibers * 0.035;`)
        shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`float furRim = pow(1.0-abs(dot(normal,normalize(vViewPosition))),3.0); outgoingLight += diffuseColor.rgb * furRim * 0.20;\n#include <opaque_fragment>`)
      }
      material.customProgramCacheKey=()=> 'orbix-stylized-fur-v1'
    }
  }
  const positions:number[]=[],normals:number[]=[],indices:number[]=[],weights:number[]=[],skins:number[]=[],groups:{start:number;count:number;materialIndex:number}[]=[]
  const points=new Map(skeleton.bones.map(bone=>[bone.name,bone.getWorldPosition(new Vector3()).applyMatrix4(new Matrix4().copy(scene.matrixWorld).invert())]))
  const segments=distant?8:16, rings=distant?5:10
  const part=(bone:string,center:Vector3,size:[number,number,number],material=0,shape='round',rotation?:Quaternion)=>{
    const geometry=shape==='box'?new BoxGeometry(1,1,1):shape==='ear'?new BufferGeometry().setAttribute('position',new BufferAttribute(new Float32Array([-.5,-.5,.5,.5,-.5,.5,0,.5,0,-.5,-.5,-.5,.5,-.5,-.5,0,.5,-.2]),3)).setIndex([0,1,2,4,3,5,3,0,2,3,2,5,1,4,5,1,5,2,3,4,1,3,1,0]):shape==='scute'?new CylinderGeometry(.5,.5,1,6).rotateX(Math.PI/2):shape==='tail'?new TubeGeometry(new CatmullRomCurve3([new Vector3(0,0,0),new Vector3(.12,.12,-.18),new Vector3(.32,.32,-.30),new Vector3(.40,.51,-.24),new Vector3(.30,.62,-.12)]),distant?10:28,.10,distant?6:10,false):shape==='cone'?new ConeGeometry(.5,1,segments):shape==='cylinder'?new CylinderGeometry(.5,.5,1,segments):new SphereGeometry(.5,segments,rings)
    if(shape==='ear')geometry.computeVertexNormals()
    if(shape==='softbox'){const p=geometry.getAttribute('position');for(let i=0;i<p.count;i++){const round=(v:number)=>Math.sign(v)*Math.pow(Math.abs(v)*2,.42)*.5;p.setXYZ(i,round(p.getX(i)),round(p.getY(i)),round(p.getZ(i)))}geometry.computeVertexNormals()}
    geometry.scale(...size);if(rotation)geometry.applyQuaternion(rotation);geometry.translate(center.x,center.y,center.z)
    const offset=positions.length/3,p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),skin=Math.max(0,skeleton.bones.findIndex(b=>b.name===bone)),start=indices.length
    for(let v=0;v<p.count;v++){positions.push(p.getX(v),p.getY(v),p.getZ(v));normals.push(n.getX(v),n.getY(v),n.getZ(v));skins.push(skin,0,0,0);weights.push(1,0,0,0)}
    for(let v=0;v<(geometry.index?.count??0);v++)indices.push(offset+geometry.index!.getX(v))
    groups.push({start,count:indices.length-start,materialIndex:material});geometry.dispose()
  }
  const at=(bone:string,offset:[number,number,number]=[0,0,0])=>(points.get(bone)??points.get('pelvis')!).clone().add(new Vector3(...offset))
  const limb=(bone:string,end:string,radius:number)=>{const a=at(bone),b=at(end),q=new Quaternion().setFromUnitVectors(new Vector3(0,1,0),b.clone().sub(a).normalize());part(bone,a.add(b).multiplyScalar(.5),[radius,a.distanceTo(b)*2+radius*.5,radius],id==='cat'?(bone.startsWith('lowerarm')?1:bone.startsWith('thigh')||bone.startsWith('calf')?3:0):0,id==='toy-robot'?'softbox':'round',q)}
  const chunky=['blob','cat-blob','pancake','marshmallow'].includes(id)
  const bodySize:[number,number,number]=id==='cat'?[.75,.84,.63]:id==='turtle'?[.88,1.04,.65]:id==='pancake'?[1.03,.30,.74]:id==='marshmallow'?[.82,.66,.61]:id==='toy-robot'?[.78,.63,.48]:chunky?[.88,.72,.65]:[.68,.76,.52]
  part('spine_01',at('spine_01',[0,.11,0]),bodySize,0,['toy-robot','marshmallow'].includes(id)?'softbox':'round')
  const headSize:[number,number,number]=id==='cat'?[.90,.78,.72]:id==='turtle'?[.80,.68,.70]:id==='duckling'?[.72,.68,.65]:id==='pancake'?[.86,.35,.64]:id==='knight'?[.56,.55,.53]:chunky?[.85,.73,.69]:[.73,.74,.64]
  part('Head',at('Head',[0,.04,.035]),headSize,1,['toy-robot','marshmallow'].includes(id)?'softbox':'round')
  for(const side of ['l','r']){
    limb(`upperarm_${side}`,`lowerarm_${side}`,.19);limb(`lowerarm_${side}`,`hand_${side}`,.17)
    part(`hand_${side}`,at(`hand_${side}`),[id==='turtle'?.30:.25,.24,.27],id==='cat'?1:2)
    limb(`thigh_${side}`,`calf_${side}`,.24);limb(`calf_${side}`,`foot_${side}`,.20)
    part(`foot_${side}`,at(`foot_${side}`,[0,-.005,.07]),[id==='turtle'?.40:.34,.22,.42],id==='duckling'?4:id==='cat'?1:0)
  }
  if(id==='cat-blob')for(const x of [-.24,.24])part('Head',at('Head',[x,.36,0]),[.25,.34,.20],1,'ear')
  if(id==='duckling')part('Head',at('Head',[0,-.045,.33]),[.26,.12,.29],4)
  if(id==='knight'){part('Head',at('Head',[0,.10,.04]),[.82,.82,.73],0);part('Head',at('Head',[0,.08,.398]),[.63,.24,.065],3,'softbox');part('Head',at('Head',[0,.44,-.03]),[.10,.34,.26],4)}
  if(id==='astronaut'){part('Head',at('Head',[0,.09,.075]),[.89,.91,.80],2);part('Head',at('Head',[0,.09,.40]),[.66,.53,.16],3);part('spine_01',at('spine_01',[0,.12,.30]),[.30,.25,.04],4,'box')}
  if(id==='toy-robot'){part('Head',at('Head',[0,.42,0]),[.045,.30,.045],3,'cylinder');part('Head',at('Head',[0,.57,0]),[.12,.12,.12],4);part('spine_01',at('spine_01',[0,.12,.26]),[.36,.29,.05],2,'box')}
  if(id==='pancake'){for(const y of [-.19,.19])part('spine_01',at('spine_01',[0,.11+y,0]),[1,.16,.72],1,'cylinder');part('Head',at('Head',[0,.21,0]),[.23,.08,.24],4,'box')}
  if(id==='jelly-ninja'){part('Head',at('Head',[0,.03,.30]),[.69,.24,.065],3,'softbox');part('Head',at('Head',[.36,.10,-.15]),[.44,.12,.12],4)}
  if(id==='sprout'){part('Head',at('Head',[0,.42,0]),[.06,.35,.06],0,'cylinder');for(const x of [-.15,.15])part('Head',at('Head',[x,.48,0]),[.39,.13,.24],1)}
  if(id==='marshmallow')part('spine_01',at('spine_01',[0,-.12,.32]),[.81,.13,.06],4,'box')
  if(id==='cat'){
    // Original tabby: padded cheeks, pointed ears, forehead stripes, curled tail and cloth vest.
    for(const side of [-1,1]){
      const tilt=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-side*.20)
      part('Head',at('Head',[side*.30,.46,.015]),[.33,.43,.27],1,'ear',tilt)
      part('Head',at('Head',[side*.30,.46,.11]),[.18,.26,.045],2,'ear',tilt)
      for(let i=0;i<3;i++)part('Head',at('Head',[side*(.36+i*.018),-.01-i*.065,.08]),[.17,.105,.19],1,'cone',new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-side*1.2))
      for(let i=0;i<2;i++)part('Head',at('Head',[side*(.25+i*.09),.05-i*.075,.272]),[.13,.047,.055],3,'round',new Quaternion().setFromAxisAngle(new Vector3(0,0,1),side*.40))
    }
    for(const x of [-.11,0,.11])part('Head',at('Head',[x,.31,.255]),[.045,.14,.025],3)
    part('pelvis',at('pelvis',[.08,.0,-.30]),[1,1,1],1,'tail')
    part('spine_01',at('spine_01',[0,.10,.30]),[.51,.57,.065],2)
    part('spine_01',at('spine_01',[0,-.13,.02]),[.79,.09,.65],3)
    part('spine_01',at('spine_01',[0,-.13,.353]),[.15,.13,.045],4,'softbox')
    part('neck_01',at('neck_01',[0,-.025,.05]),[.57,.15,.55],4)
    part('spine_01',at('spine_01',[.16,.22,.335]),[.25,.30,.07],4,'cone')
  }
  if(id==='turtle'){
    // Domed shell, raised scutes and rim on the back, segmented cream plastron in front.
    part('spine_01',at('spine_01',[0,.08,-.25]),[1.04,1.12,.70],1)
    part('spine_01',at('spine_01',[0,.07,-.28]),[1.09,1.16,.32],4)
    part('spine_01',at('spine_01',[0,.08,-.35]),[.98,1.06,.56],1)
    const cells=[[0,.08],...Array.from({length:6},(_,i)=>[Math.cos(i*Math.PI/3)*.32,.08+Math.sin(i*Math.PI/3)*.34])]
    for(const [x,y] of cells){
      const dome=Math.sqrt(Math.max(.05,1-(x/.52)**2-((y-.08)/.56)**2)),z=-.35-dome*.28
      const normal=new Vector3(x/(.52*.52),(y-.08)/(.56*.56),-dome/.28).normalize(),rotation=new Quaternion().setFromUnitVectors(new Vector3(0,0,1),normal)
      part('spine_01',at('spine_01',[x,y,z]),[.37,.39,.06],4,'scute',rotation)
      part('spine_01',at('spine_01',[x+normal.x*.032,y+normal.y*.032,z+normal.z*.032]),[.32,.34,.04],1,'scute',rotation)
    }
    part('spine_01',at('spine_01',[0,.07,.30]),[.67,.83,.11],2)
    for(let i=0;i<3;i++)part('spine_01',at('spine_01',[0,.27-i*.19,.354]),[.57,.019,.018],4)
    part('spine_01',at('spine_01',[0,.07,.356]),[.018,.66,.016],4)
    part('pelvis',at('pelvis',[0,-.14,-.46]),[.20,.23,.35],0,'cone',new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-1.2))
    for(const side of ['l','r'])for(const x of [-.10,0,.10])part(`foot_${side}`,at(`foot_${side}`,[x,-.012,.245]),[.07,.045,.08],2)
  }
  // Readable layered eyes and soft muzzle, on the surface rather than hidden inside boxes.
  const faceZ=id==='knight'?.435:id==='astronaut'?.47:headSize[2]*.46+.035
  const eyeY=id==='pancake'?.07:.115,eyeX=id==='cat'||id==='turtle'?.185:.145
  for(const x of [-eyeX,eyeX]){
    part('Head',at('Head',[x,eyeY,faceZ]),[.17,.21,.055],2)
    part('Head',at('Head',[x,eyeY+.001,faceZ+.024]),[.133,.172,.040],id==='cat'?4:3)
    part('Head',at('Head',[x,eyeY+.001,faceZ+.045]),[.067,.128,.021],3)
    if(!distant && ['cat','turtle','cat-blob','duckling'].includes(id))part('Head',at('Head',[x,eyeY+.156,faceZ-.040]),[.15,.032,.027],3,'round',new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.sign(x)*-.15))
    if(!distant){part('Head',at('Head',[x-.025,eyeY+.037,faceZ+.062]),[.031,.040,.013],2);part('Head',at('Head',[x+.016,eyeY-.034,faceZ+.061]),[.014,.017,.010],2)}
  }
  if(!['knight','astronaut','duckling'].includes(id)){
    if(id==='cat'||id==='cat-blob'){
      for(const x of [-.074,.074])part('Head',at('Head',[x,-.032,faceZ+.015]),[.22,.145,.13],2)
      part('Head',at('Head',[0,.003,faceZ+.090]),[.08,.053,.034],3,'ear',new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI))
      if(!distant)for(const side of [-1,1])for(let i=0;i<3;i++)part('Head',at('Head',[side*.23,-.021-i*.031,faceZ+.044]),[.13,.008,.01],3,'round',new Quaternion().setFromAxisAngle(new Vector3(0,0,1),side*(i-1)*.13))
    }else part('Head',at('Head',[0,-.03,faceZ-.02]),[.24,.15,.10],2)
    part('Head',at('Head',[0,-.096,faceZ+.044]),[.11,.040,.021],3)
  }
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
  return {scene,animations:locomotion(template).clips,gaitSpeeds:locomotion(template).speeds,materials:materials as Material[],geometry,release(){if(released)return;released=true;geometry.dispose();materials.forEach(m=>m.dispose());skeleton.dispose()}}
}
