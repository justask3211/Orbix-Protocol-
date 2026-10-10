// Source/derived hashes for original authored geometry, texture masks and verified CC0 rig.
import fs from 'node:fs/promises'
import {createHash} from 'node:crypto'
import sharp from 'sharp'
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {dedup,prune,weld,quantize} from '@gltf-transform/functions'
import {clothTexture} from '../../tests/original-character-regression.mjs'
const hash=buffer=>createHash('sha256').update(buffer).digest('hex')
const root='web/public/center-models/wardrobe'
const outfits=['overalls','rain-jacket','festival-jacket','tunic','dress-sun','dress-festival']
await fs.mkdir(root,{recursive:true})
const textures=[],assets=[],io=new NodeIO().registerExtensions(ALL_EXTENSIONS)
for(const outfit of outfits){
 for(const fast of [false,true]){
  const texture=clothTexture(outfit,fast),{data,width,height}=texture.image
  const image=await sharp(Buffer.from(data),{raw:{width,height,channels:4}}).png().toBuffer(),file=`${outfit}-${width}.png`
  await fs.writeFile(root+'/'+file,image);textures.push({file,bytes:image.length,width,height,sha256:hash(image),source:'web/src/center/worlds/wardrobe.ts',role:'neutral sRGB cloth albedo with UVs; actor primary tint applied once'})
 }
 const file=`cat-${outfit}.glb`,bytes=await fs.readFile(root+'/'+file),doc=await io.readBinary(new Uint8Array(bytes))
 await doc.transform(dedup(),prune(),weld(),quantize({quantizePosition:14,quantizeNormal:10,quantizeTexcoord:12,quantizeWeight:8}))
 const derived=Buffer.from(await io.writeBinary(doc));await fs.writeFile(root+'/'+file,derived)
 assets.push({file,sourceSha256:hash(bytes),sha256:hash(derived),bytes:derived.length,clips:doc.getRoot().listAnimations().map(a=>a.getName()),roles:doc.getRoot().listMaterials().map(m=>m.getName())})
}
const sources={}
for(const file of ['web/src/center/worlds/CuteCharacter.ts','web/src/center/worlds/wardrobe.ts','web/src/center/worlds/seatedClips.ts','center/cosmetics_catalog.json','web/public/center-models/orbix-ranger-lod.glb']){const buffer=await fs.readFile(file);sources[file]={sha256:hash(buffer),bytes:buffer.length}}
await fs.writeFile(root+'/manifest.json',JSON.stringify({version:1,date:'2026-10-10',author:'Orbix',license:'Original Orbix garments, procedural textiles and seated clips; existing Quaternius CC0 skeleton and source clips.',rigSources:['https://quaternius.com/packs/universalbasecharacters.html','https://quaternius.com/packs/universalanimationlibrary.html'],sources,textures,assets,export:'tools/tests/wardrobe-browser.cjs then tools/game-lab/scripts/wardrobe-manifest.mjs',runtime:'Production creates selected per-character fitted UV-bearing garments from source; six cat GLBs are interchange references, not extra gameplay downloads. Body/fur hooks stay in Three.js; exported PBR contains verified cloth maps.',budgets:{observedFullMaxTriangles:16824,observedLodMaxTriangles:3312,observedMaterialGroups:7,materialTarget:6,phonePerformance:'Not measured on physical devices.'}},null,2)+'\n')
console.log('Original wardrobe texture/provenance and optimized reference GLBs recorded.')
