// Run against wrangler dev with test-only secrets, never a remote deployment.
import assert from 'node:assert/strict'
import {createHmac,createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import WebSocket from 'ws'
const base=process.env.ORBIX_WORKER_URL||'http://127.0.0.1:8787'
assert.equal(new URL(base).hostname,'127.0.0.1','This smoke test is local-only')
const v=JSON.parse(readFileSync(new URL('./auth-vector.json',import.meta.url),'utf8'))
const mac=s=>createHmac('sha256',v.secret).update(s).digest('hex')
const now=()=>Math.floor(Date.now()/1000)
const signedHeaders=(body,nonce='c'.repeat(32))=>{const timestamp=now();return {'content-type':'application/json','X-Orbix-Time':String(timestamp),'X-Orbix-Nonce':nonce,'X-Orbix-Signature':mac(`orbix/provision/v1\n${v.path}\n${timestamp}\n${nonce}\n${createHash('sha256').update(body).digest('hex')}`)}}
const health=await (await fetch(base+'/multiplayer/health')).json();assert.equal(health.ready,false)
assert.equal((await fetch(base+v.path,{method:'POST',body:v.body})).status,401)
let result=await fetch(base+v.path,{method:'POST',headers:signedHeaders(v.body),body:v.body})
// An already-used nonce can occur on a repeated local test run; use a fresh one.
if(result.status!==200)result=await fetch(base+v.path,{method:'POST',headers:signedHeaders(v.body,createHash('sha256').update(String(Date.now())).digest('hex').slice(0,32)),body:v.body})
assert.equal(result.status,200,await result.clone().text());assert.equal((await result.json()).ready,false)
const changes=JSON.stringify({...JSON.parse(v.body),seed:'e'.repeat(64)})
assert.equal((await fetch(base+v.path,{method:'POST',headers:signedHeaders(changes,'d'.repeat(32)),body:changes})).status,409)
const claims={v:1,iss:'orbix-center',aud:'orbix-multiplayer',sub:v.wallet,room:v.room,round:v.round,role:'player',iat:now(),exp:now()+120,nonce:createHash('sha256').update(String(Date.now())).digest('hex').slice(0,32)}
const payload=Buffer.from(JSON.stringify(claims)).toString('base64url'),ticket=payload+'.'+mac(payload)
const endpoint=base.replace('http','ws')+'/multiplayer/v1/ws/rooms/'+v.room
const connect=()=>new WebSocket(endpoint,{origin:base})
const receive=(ws)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('WebSocket timeout')),5000);ws.once('message',raw=>{clearTimeout(timer);resolve(JSON.parse(String(raw)))});ws.once('error',reject)})
const ws=connect(),frames=[];ws.on('message',raw=>frames.push(JSON.parse(String(raw))))
await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)})
ws.send(JSON.stringify({type:'session.hello',ticket}))
await new Promise(r=>setTimeout(r,100))
assert.equal(frames[0].type,'session.ready');assert.equal(frames[0].status,'transport-only')
assert.equal(frames[1].payload.code,'ENGINE_PORT_PENDING')
const next=receive(ws);ws.send(JSON.stringify({type:'action',payload:{kind:'move',inputSeq:1,dx:1}}));assert.equal((await next).type,'action.rejected')
const pong=receive(ws);ws.send(JSON.stringify({type:'connection.ping'}));assert.equal((await pong).type,'connection.pong')
const other=connect();await new Promise((r,j)=>{other.once('open',r);other.once('error',j)})
const rejected=receive(other);other.send(JSON.stringify({type:'session.hello',ticket}));assert.equal((await rejected).payload.code,'TICKET_REPLAY')
other.close();ws.close()
const shell=await fetch(base+'/center/rooms/'+v.room,{headers:{Accept:'text/html'}})
assert.equal(shell.status,200);assert.match(shell.headers.get('content-type'),/text\/html/)
console.log('PASS: actual local Worker + SQLite DO provisioning, tamper/replay, v1 WebSocket, fail-closed action and frontend shell')
