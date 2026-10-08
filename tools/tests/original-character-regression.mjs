import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as THREE from '../../web/node_modules/three/build/three.module.js'
import {GLTFLoader} from '../../web/node_modules/three/examples/jsm/loaders/GLTFLoader.js'
import {clone} from '../../web/node_modules/three/examples/jsm/utils/SkeletonUtils.js'
import {transformSync} from '../../web/node_modules/rolldown/dist/utils-index.mjs'
const read=(file)=>fs.readFileSync(file,'utf8')
const compile=(file)=>transformSync(file,read(file),{target:'es2022'}).code.replace(/import[^;]*;/g,'').replace(/\bexport\s+/g,'')
const catalog=new Function(compile('web/src/center/characters.ts')+'\nreturn {CHARACTERS,characterInfo};')()
const styles=new Function(compile('web/src/center/worlds/cartoonStyle.ts')+'\nreturn {cartoonFinish};')()
export const buildCuteCharacter=new Function('THREE','clone','characterInfo','cartoonFinish',`const {${Object.keys(THREE).join(',')}}=THREE;\n`+compile('web/src/center/worlds/CuteCharacter.ts')+'\nreturn buildCuteCharacter;')(THREE,clone,catalog.characterInfo,styles.cartoonFinish)
export const characterInfo=catalog.characterInfo
if(process.argv[1].endsWith('original-character-regression.mjs')){
 globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});globalThis.ProgressEvent=class{}
 const bytes=fs.readFileSync('web/public/center-models/orbix-ranger-lod.glb')
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
 assert.equal(gltf.animations.length,20)
 const signatures=new Set();let totalTriangles=0
 for(const info of catalog.CHARACTERS){
  const full=buildCuteCharacter(gltf,{character:info.id,cosmetics:{hat:'crown',glasses:'round',accessory:'scarf',outfit:'dress'}}),lod=buildCuteCharacter(gltf,{character:info.id},true)
  let mesh;full.scene.traverse(o=>{if(o.name.startsWith('OrbixOriginal_'))mesh=o})
  assert(mesh?.isSkinnedMesh);assert(full.geometry.groups.length<=5)
  assert(lod.geometry.index.count<full.geometry.index.count)
  signatures.add(full.geometry.getAttribute('position').array.toString())
  for(const clip of gltf.animations){const mixer=new THREE.AnimationMixer(full.scene);mixer.clipAction(clip).play();mixer.update(Math.min(.3,clip.duration/2));full.scene.updateMatrixWorld(true);mesh.skeleton.update();const p=new THREE.Vector3().fromBufferAttribute(full.geometry.getAttribute('position'),0);mesh.applyBoneTransform(0,p);assert(p.toArray().every(Number.isFinite),`${info.id}: ${clip.name}`);mixer.stopAllAction();mixer.uncacheRoot(full.scene)}
  let disposed=0;full.geometry.addEventListener('dispose',()=>disposed++);full.release();full.release();assert.equal(disposed,1)
  totalTriangles+=full.geometry.index.count/3;lod.release()
 }
 assert.equal(signatures.size,10,'Ten geometrically distinct silhouettes')
 console.log(`Ten original characters × 20 clips passed, full/LOD, five palette groups, finite skinning and idempotent cleanup. Mean customized triangles: ${totalTriangles/10}.`)
}
