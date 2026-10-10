import {buildCuteCharacter} from './original-character-regression.mjs'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import * as THREE from '../../web/node_modules/three/build/three.module.js'
import {GLTFLoader} from '../../web/node_modules/three/examples/jsm/loaders/GLTFLoader.js'
globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});globalThis.ProgressEvent=class{}
const bytes=fs.readFileSync('web/public/center-models/orbix-ranger-lod.glb'),gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
const ids=['cat','turtle','blob','knight','cat-blob','duckling','astronaut','toy-robot','pancake','jelly-ninja','sprout','marshmallow']
const catalog=JSON.parse(fs.readFileSync('center/cosmetics_catalog.json'))
let maximum=0,lodMaximum=0,checks=0
for(const character of ids)for(const outfit of catalog.options.outfit){
 const owned=buildCuteCharacter(gltf,{character,cosmetics:{outfit}}),lod=buildCuteCharacter(gltf,{character,cosmetics:{outfit}},true)
 const uv=owned.geometry.getAttribute('uv');assert.equal(uv.count,owned.geometry.getAttribute('position').count);assert([...uv.array].every(Number.isFinite))
 if(outfit!=='default'){
  const main=owned.materials.find(m=>m.name==='cloth_main');assert(main.map&&main.map.colorSpace===THREE.SRGBColorSpace);assert.equal(main.map.image.width,1024)
  assert.equal(lod.materials.find(m=>m.name==='cloth_main').map.image.width,512)
  let disposed=0;main.map.addEventListener('dispose',()=>disposed++);owned.release();assert.equal(disposed,0,'Actor never disposes shared cloth')
 }
 assert(owned.animations.some(c=>c.name==='OrbixSeatedIdle'))
 for(const clip of owned.animations){const m=new THREE.AnimationMixer(lod.scene);m.clipAction(clip).play();m.update(.3);lod.scene.updateMatrixWorld(true);let mesh;lod.scene.traverse(o=>{if(o.name.startsWith('OrbixOriginal_'))mesh=o});for(let i=0;i<mesh.geometry.getAttribute('position').count;i+=43){const p=new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'),i);mesh.applyBoneTransform(i,p);assert(p.toArray().every(Number.isFinite))}m.stopAllAction();m.uncacheRoot(lod.scene);checks++}
 maximum=Math.max(maximum,owned.geometry.index.count/3);lodMaximum=Math.max(lodMaximum,lod.geometry.index.count/3)
 owned.release();lod.release()
}
assert(maximum<=20000);assert(lodMaximum<=5000)
console.log({checks,maximum,lodMaximum,catalogVersion:catalog.version})
