import assert from 'node:assert/strict'
import fs from 'node:fs'
import {transformSync} from '../../web/node_modules/rolldown/dist/utils-index.mjs'
const file='web/src/center/framework/performance.tsx'
const code=transformSync(file,fs.readFileSync(file,'utf8'),{target:'es2022'}).code.replace(/^import[^;]+;/gm,'').replace(/\bexport\s+/g,'')
let frame,dpr=1,updates=[]
const FrameMonitor=new Function('useRef','useFrame','useThree',code+'\nreturn FrameMonitor;')(current=>({current}),f=>{frame=f},()=>({gl:{getPixelRatio:()=>dpr,info:{render:{calls:72,triangles:125000}}},setDpr:value=>{dpr=value}}))
globalThis.window={devicePixelRatio:1}
FrameMonitor({quality:'fast',onMetrics:value=>updates.push(value)})
for(let i=0;i<140;i++)frame({},1/60)
assert(updates.length>0);assert(Math.abs(updates.at(-1).p95-1000/60)<.01)
for(let i=0;i<40;i++)frame({},1)
assert(updates.at(-1).p95>=1000,'Long frames must remain visible in telemetry')
assert(dpr>=.65&&dpr<1,'Sustained slow frames reduce resolution within bounds')
assert.equal(updates.at(-1).calls,72);assert.equal(updates.at(-1).triangles,125000)
for(let i=0;i<400;i++)frame({},1)
assert(updates.at(-1).samples<=180,'Telemetry history remains bounded')
console.log('PASS: 60Hz frame intervals, unhidden 1s slow frames, actual render counters, bounded DPR fallback and bounded history')
