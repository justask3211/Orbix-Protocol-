const assert = require('node:assert/strict')
const fs = require('node:fs')
const { transformSync } = require('../../web/node_modules/rolldown/dist/utils-index.mjs')
const source = fs.readFileSync('web/src/center/ProfileImage.tsx', 'utf8')
const start = source.indexOf('export async function resizeAndCompress')
const end = source.indexOf('export function ProfileImageUpload')
const result = transformSync('image.ts', 'const MAX_DIM=256, MAX_QUALITY=.85;\n' + source.slice(start, end), { target: 'es2022' })
const resize = new Function(result.code.replace('export ', '') + '\nreturn resizeAndCompress;')()
let crop, revoked = 0, canvasAvailable = true, exported = new Blob(['webp'], {type:'image/webp'})
global.Image = class { naturalWidth=600; naturalHeight=400; set src(value) { queueMicrotask(() => this.onload()) } }
global.URL = {createObjectURL: () => 'blob:test', revokeObjectURL: () => revoked++}
global.document = {createElement: () => ({getContext: () => canvasAvailable ? {drawImage: (...args) => crop=args.slice(1)} : null, toBlob: cb => cb(exported)})}
;(async () => {
  await resize({})
  assert.deepEqual(crop, [100,0,400,400,0,0,256,256])
  exported = null
  await assert.rejects(resize({}), /export/)
  canvasAvailable = false
  await assert.rejects(resize({}), /canvas/)
  assert.equal(revoked, 3)
  process.stdout.write('Avatar crop, null export, unavailable canvas and URL cleanup passed.\n')
})().catch(error => { console.error(error); process.exitCode=1 })
