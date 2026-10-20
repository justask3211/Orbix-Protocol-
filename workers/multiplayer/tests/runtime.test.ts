import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {decodeFrame,FixedStepClock,InputWindow} from '../src/protocol.ts'
import {adapters,TEMPLATE_IDS,validateBootstrap} from '../src/engines.ts'
import {verifyTicket,verifyProvision,hmac} from '../src/security.ts'
const vector=JSON.parse(readFileSync(new URL('./auth-vector.json',import.meta.url),'utf8'))

test('Python capabilities verify in Workers crypto; room, round, expiry and tamper cannot cross',async()=>{
  const claims=await verifyTicket(vector.ticket,vector.secret,vector.room,vector.round,1000)
  assert.equal(claims.sub,vector.wallet)
  await assert.rejects(verifyTicket(vector.ticket,vector.secret,'b'.repeat(16),vector.round,1000))
  await assert.rejects(verifyTicket(vector.ticket,vector.secret,vector.room,'b'.repeat(32),1000))
  await assert.rejects(verifyTicket(vector.ticket,vector.secret,vector.room,vector.round,1120))
  await assert.rejects(verifyTicket(vector.ticket+'a',vector.secret,vector.room,vector.round,1000))
  await assert.rejects(verifyTicket(vector.ticket,'wrong-secret'.repeat(5),vector.room,vector.round,1000))
  const parts=vector.ticket.split('.');const c=JSON.parse(atob(parts[0]));c.exp=2000
  const payload=btoa(JSON.stringify(c)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  await assert.rejects(verifyTicket(payload+'.'+await hmac(vector.secret,payload),vector.secret,vector.room,vector.round,1000))
})
test('Python provisioning signatures bind path, body, nonce and time',async()=>{
  const request=new Request('https://edge.test'+vector.path,{method:'POST',headers:vector.headers,body:vector.body})
  assert.equal((await verifyProvision(request,vector.body,vector.secret,1000)).nonce,'b'.repeat(32))
  await assert.rejects(verifyProvision(request,vector.body+' ',vector.secret,1000))
  await assert.rejects(verifyProvision(request,vector.body,vector.secret,1031))
  await assert.rejects(verifyProvision(new Request('https://edge.test/other',{headers:vector.headers}),vector.body,vector.secret,1000))
})
test('v1 frames preserve inputs; malformed, binary and oversized frames fail',()=>{
  assert.equal(decodeFrame(JSON.stringify({type:'session.hello',ticket:vector.ticket})).type,'session.hello')
  assert.equal(decodeFrame(JSON.stringify({type:'action',payload:{kind:'move',inputSeq:3,dx:1,dz:0}})).payload?.inputSeq,3)
  for(const raw of ['{','[]','null','1','{"type":"unknown"}','{"type":"action","payload":[]}','{"type":"room.sync","seq":-1}',' '.repeat(8193),new ArrayBuffer(8)])assert.throws(()=>decodeFrame(raw))
})
test('30Hz clock is bounded and requires recovery after an interruption',()=>{
  const c=new FixedStepClock(0)
  for(let i=1;i<=100;i++)c.advance(i*10)
  assert.equal(c.tick,30)
  assert.throws(()=>c.advance(2000),/RECOVERY/)
  assert.throws(()=>c.advance(-1),/RECOVERY/)
})
test('inputs deduplicate and bound bursts',()=>{
  const w=new InputWindow()
  assert.equal(w.accept(1,0),null);assert.equal(w.accept(1,0),'STALE_INPUT')
  for(let i=2;i<=60;i++)assert.equal(w.accept(i,0),null)
  assert.equal(w.accept(61,0),'RATE_LIMITED');assert.equal(w.accept(61,34),null)
  assert.equal(w.accept(Number.NaN,100),'STALE_INPUT')
})
test('all three V4 engine slots fail closed until authoritative ports ship',()=>{
  const b=validateBootstrap(JSON.parse(vector.body),vector.room)
  for(const template of TEMPLATE_IDS){assert.equal(adapters[template].ready,false);assert.throws(()=>adapters[template].create({...b,config:{...b.config,template_id:template}}),/ENGINE_PORT_PENDING/)}
  assert.throws(()=>validateBootstrap({...b,participants:[b.participants[0],b.participants[0]]},vector.room))
  assert.throws(()=>validateBootstrap({...b,config:{template_id:'number-hunt',rules:{world_version:4}}},vector.room))
})
