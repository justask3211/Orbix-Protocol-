import {test} from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {V4Engine,StreamRNG,type Dict} from '../src/v4.ts'
const python=spawnSync('python',['tests/python_vectors.py'],{encoding:'utf8',maxBuffer:20*1024*1024})
assert.equal(python.status,0,python.stderr)
const cases=JSON.parse(python.stdout)
function same(a:any,b:any,path='root'){
 if(typeof a==='number'&&typeof b==='number')assert.ok(Math.abs(a-b)<1e-6,`${path}: ${a} != ${b}`)
 else if(Array.isArray(a)){assert.equal(a.length,b?.length,path);a.forEach((v,i)=>same(v,b[i],`${path}[${i}]`))}
 else if(a&&typeof a==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(b??{}).sort(),path);for(const k in a)same(a[k],b[k],path+'.'+k)}
 else assert.equal(a,b,path)
}
for(const [i,c] of cases.entries())test(`Python V4 parity ${c.template} scenario ${i%3}: full sim, protocol state, RNG and restore`,()=>{
 let e=new V4Engine(c.template,c.rules,c.seed,c.initial);e.characters=c.characters
 for(const [j,event] of c.events.entries()){
  if(event.action){const result=e.act(event.who,event.action,event.at);assert.equal(result.accepted,event.accepted,`${j} ${JSON.stringify(event)}`);assert.equal(result.error??null,event.error)}else e.advance(event.at)
  if(j===1000){e=new V4Engine(c.template,c.rules,c.seed,e.checkpoint());e.characters=c.characters}
 }
 same(e.checkpoint(),c.expected);same(e.publicState(),c.public);assert.deepEqual([...e.eligible()].sort(),c.eligible)
})
test('forged positions, nonfinite directions, duplicate sequences and expired leases',()=>{
 const c=cases[0],e=new V4Engine(c.template,c.rules,c.seed,c.initial),who=c.initial.participants[0],x=e.s.bodies[who].x
 assert.equal(e.act(who,{kind:'move',dx:NaN,dz:0,seq:1},1000).error,'INVALID_DIRECTION')
 assert.equal(e.act(who,{kind:'move',dx:1,dz:0,seq:1,x:1000,score:999},1000).accepted,true)
 assert.equal(e.act(who,{kind:'move',dx:1,dz:0,seq:1},1000.1).error,'STALE_INPUT')
 for(let t=1;t<=30;t++)e.advance(1000+t/30)
 assert.ok(e.s.bodies[who].x-x<1.3);assert.equal(e.s.bodies[who].score,0)
})
