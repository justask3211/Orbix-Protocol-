import assert from 'node:assert/strict'
import fs from 'node:fs'
import {execFileSync} from 'node:child_process'
import {transformSync} from '../../web/node_modules/rolldown/dist/utils-index.mjs'
const source=fs.readFileSync('web/src/center/worlds/terrain.ts','utf8')
const result=transformSync('terrain.ts',source,{target:'es2022'})
assert.equal(result.errors.length,0)
const {terrainHeight}=await import('data:text/javascript;base64,'+Buffer.from(result.code).toString('base64'))
const coords=[]
for(const theme of ['island','guardian','courtyard'])for(let i=0;i<201;i++)coords.push([Math.sin(i*2.1)*70,Math.cos(i*1.7)*70,theme])
coords.push([0,0,'island'],[5,0,'island'],[11,0,'guardian'],[16,0,'guardian'],[25,0,'island'])
const python=process.env.ORBIX_TEST_PYTHON
assert.ok(python,'Set ORBIX_TEST_PYTHON')
const expected=JSON.parse(execFileSync(python,['-c','import json,sys; from center.games.terrain import terrain_height; print(json.dumps([terrain_height(*p) for p in json.load(sys.stdin)]))'],{input:JSON.stringify(coords),encoding:'utf8'}))
let error=0
coords.forEach((p,i)=>{const d=Math.abs(terrainHeight(...p)-expected[i]);error=Math.max(error,d);assert.ok(d<1e-12,JSON.stringify(p))})
console.log(`${coords.length} cross-language terrain samples passed; maximum height difference ${error}`)
