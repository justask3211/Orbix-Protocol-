// Run against wrangler dev with EDGE_TICKET_SECRET/PROVISION_SECRET set to auth-vector.secret.
import assert from 'node:assert/strict'
import {createHmac,createHash,randomBytes} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import WebSocket from 'ws'
const base=process.env.ORBIX_WORKER_URL||'http://127.0.0.1:8787'
assert.equal(new URL(base).hostname,'127.0.0.1','Local-only smoke test')
const v=JSON.parse(readFileSync(new URL('./auth-vector.json',import.meta.url),'utf8'))
const cases=JSON.parse(spawnSync('python',['tests/python_vectors.py'],{encoding:'utf8',maxBuffer:20*1024*1024}).stdout),c=cases[0]
const bootstrap={...JSON.parse(v.body),roomId:randomBytes(8).toString('hex'),roundId:randomBytes(16).toString('hex'),snapshot:c.initial,characters:c.characters,seed:c.seed,participants:c.initial.participants,config:{template_id:c.template,rules:c.rules}}
bootstrap.snapshot.started_at=bootstrap.snapshot.last_tick=Date.now()/1000
const path=`/internal/rooms/${bootstrap.roomId}/provision`,body=JSON.stringify(bootstrap)
const mac=s=>createHmac('sha256',v.secret).update(s).digest('hex')
const now=()=>Math.floor(Date.now()/1000)
const signedHeaders=body=>{const timestamp=now(),nonce=randomBytes(16).toString('hex');return {'content-type':'application/json','X-Orbix-Time':String(timestamp),'X-Orbix-Nonce':nonce,'X-Orbix-Signature':mac(`orbix/provision/v1\n${path}\n${timestamp}\n${nonce}\n${createHash('sha256').update(body).digest('hex')}`)}}
assert.equal((await (await fetch(base+'/multiplayer/health')).json()).ready,true)
assert.equal((await fetch(base+path,{method:'POST',body})).status,401)
const result=await fetch(base+path,{method:'POST',headers:signedHeaders(body),body});assert.equal(result.status,200,await result.clone().text())
const changes=JSON.stringify({...bootstrap,seed:'e'.repeat(64)})
assert.equal((await fetch(base+path,{method:'POST',headers:signedHeaders(changes),body:changes})).status,409)
const claims={v:1,iss:'orbix-center',aud:'orbix-multiplayer',sub:bootstrap.participants[0],room:bootstrap.roomId,round:bootstrap.roundId,role:'player',iat:now(),exp:now()+120,nonce:randomBytes(16).toString('hex')}
const payload=Buffer.from(JSON.stringify(claims)).toString('base64url'),ticket=payload+'.'+mac(payload),endpoint=base.replace('http','ws')+'/multiplayer/v1/ws/rooms/'+bootstrap.roomId
const connect=()=>new WebSocket(endpoint,{origin:base})
const ws=connect(),frames=[];ws.on('message',raw=>frames.push(JSON.parse(String(raw))))
const waitFor=async fn=>{const end=Date.now()+5000;while(Date.now()<end){const out=fn();if(out)return out;await new Promise(r=>setTimeout(r,20))}throw Error('Frame timeout')}
await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j)});ws.send(JSON.stringify({type:'session.hello',ticket}))
const ready=await waitFor(()=>frames.find(f=>f.type==='session.ready'));assert.equal(ready.status,'running')
ws.send(JSON.stringify({type:'action',payload:{kind:'move',seq:1,dx:1,dz:0}}))
await waitFor(()=>frames.find(f=>f.type==='action.ack'))
await waitFor(()=>frames.find(f=>f.type==='game.patch'&&f.payload.bodies[claims.sub].inputSeq===1))
ws.send(JSON.stringify({type:'action',payload:{kind:'move',seq:1,dx:1,dz:0}}))
await waitFor(()=>frames.find(f=>f.type==='action.rejected'&&f.payload.error==='STALE_INPUT'))
const other=connect(),replay=[];other.on('message',raw=>replay.push(JSON.parse(String(raw))));await new Promise((r,j)=>{other.once('open',r);other.once('error',j)})
other.send(JSON.stringify({type:'session.hello',ticket}));await waitFor(()=>replay.find(f=>f.payload?.code==='TICKET_REPLAY'))
const watch=connect(),watchFrames=[];watch.on('message',raw=>watchFrames.push(JSON.parse(String(raw))))
await new Promise((r,j)=>{watch.once('open',r);watch.once('error',j)})
const spectatorClaims={...claims,sub:'0x'+'33'.repeat(20),role:'spectator',nonce:randomBytes(16).toString('hex')}
const spectatorPayload=Buffer.from(JSON.stringify(spectatorClaims)).toString('base64url')
watch.send(JSON.stringify({type:'session.hello',ticket:spectatorPayload+'.'+mac(spectatorPayload)}))
await waitFor(()=>watchFrames.find(f=>f.type==='session.ready'))
await waitFor(()=>watchFrames.find(f=>f.type==='game.patch'))
watch.send(JSON.stringify({type:'action',payload:{kind:'move',seq:1,dx:1,dz:0}}))
await waitFor(()=>watchFrames.find(f=>f.type==='action.rejected'&&f.payload.error==='NOT_PLAYER'))
const controlPath=`/internal/rooms/${bootstrap.roomId}/control`,controlBody=JSON.stringify({roundId:bootstrap.roundId,suspended:[spectatorClaims.sub],settings:{}})
const timestamp=now(),nonce=randomBytes(16).toString('hex')
const closed=new Promise(resolve=>watch.once('close',code=>resolve(code)))
const control=await fetch(base+controlPath,{method:'POST',body:controlBody,headers:{'content-type':'application/json','X-Orbix-Time':String(timestamp),'X-Orbix-Nonce':nonce,'X-Orbix-Signature':mac(`orbix/provision/v1\n${controlPath}\n${timestamp}\n${nonce}\n${createHash('sha256').update(controlBody).digest('hex')}`)}})
assert.equal(control.status,200,await control.clone().text());assert.equal(await closed,4403)
other.close();ws.close()
console.log('PASS: actual workerd + SQLite DO immutable bootstrap, ticket replay, gameplay, input acknowledgements, stale inputs, simulation broadcasts and read-only spectator admission and suspension')
