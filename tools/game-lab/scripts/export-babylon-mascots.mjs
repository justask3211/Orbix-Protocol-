// Offline interchange only: existing original mascot geometry + existing CC0 rig/clips.
// No Three.js module is imported by the Babylon runtime.
import fs from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {GLTFLoader} from '../../../web/node_modules/three/examples/jsm/loaders/GLTFLoader.js'
import {GLTFExporter} from '../../../web/node_modules/three/examples/jsm/exporters/GLTFExporter.js'
import {buildCuteCharacter} from '../../tests/original-character-regression.mjs'
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {dedup, prune, resample, weld, quantize} from '@gltf-transform/functions'

globalThis.self = globalThis
globalThis.ProgressEvent = class {}
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(value => { this.result = value; this.onloadend?.() }) }
  readAsDataURL(blob) { blob.arrayBuffer().then(value => { this.result = `data:${blob.type};base64,${Buffer.from(value).toString('base64')}`; this.onloadend?.() }) }
}
const source = 'web/public/center-models/orbix-ranger.glb'
const bytes = await fs.readFile(source)
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
const ids = ['cat','turtle','blob','knight','cat-blob','duckling','astronaut','toy-robot','pancake','jelly-ninja','sprout','marshmallow']
const destination = 'web/public/center-models/babylon-mascots'
await fs.mkdir(destination, {recursive:true})
const assets = []
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
for (const id of ids) for (const distant of [false, true]) {
  const owned = buildCuteCharacter(gltf, {character:id}, distant)
  const exported = await new GLTFExporter().parseAsync(owned.scene, {binary:true, onlyVisible:true, animations:owned.animations})
  const document = await io.readBinary(new Uint8Array(exported))
  await document.transform(dedup(), prune(), resample(), weld(), quantize({quantizePosition:14,quantizeNormal:10,quantizeTexcoord:12,quantizeWeight:8}))
  const buffer = Buffer.from(await io.writeBinary(document))
  const file = `${id}${distant ? '-lod' : ''}.glb`
  await fs.writeFile(`${destination}/${file}`, buffer)
  assets.push({file, bytes:buffer.length, sha256:createHash('sha256').update(buffer).digest('hex'), clips:owned.animations.map(clip=>clip.name), triangles:owned.geometry.index.count/3})
  owned.release()
}
await fs.writeFile(`${destination}/manifest.json`, JSON.stringify({date:'2026-10-10',source,sourceSha256:createHash('sha256').update(bytes).digest('hex'),license:'Original Orbix procedural geometry; existing Quaternius-derived CC0 skeleton and clips. No downloaded art.',generator:'tools/game-lab/scripts/export-babylon-mascots.mjs',notes:'Shader-only fur is recreated as PBR; GLB retains original palette, proportion retargeting and 20 in-place clips. Cosmetic accessories are attached by Babylon at runtime.',assets}, null, 2)+'\n')
console.log(`Exported ${assets.length} original/CC0 rigged mascot GLBs, ${assets.reduce((sum,a)=>sum+a.bytes,0)} bytes`)
