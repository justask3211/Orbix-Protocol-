/* Live Worker + new Center API through a temporary verification tunnel.
 * No private keys, session tokens, edge tickets or bridge secrets enter evidence.
 */
const {chromium}=require(process.env.ORBIX_PLAYWRIGHT_MODULE||'/tmp/orbix-browser-tools/node_modules/playwright')
const {generatePrivateKey,privateKeyToAccount}=require('../../web/node_modules/viem/accounts')
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),WebSocket=require('../../workers/multiplayer/node_modules/ws')
const base=process.env.ORBIX_BASE_URL||'http://127.0.0.1:8123',dir='tools/tests/evidence/cloudflare'
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
;(async()=>{
 await fs.mkdir(dir,{recursive:true})
 const call=async(path,body,token)=>{const r=await fetch(base+'/api/center/v1'+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});assert(r.ok,await r.clone().text());return r.json()}
 const users=[]
 for(let i=0;i<2;i++){const key=generatePrivateKey(),account=privateKeyToAccount(key),nonce=await call('/auth/nonce',{address:account.address}),auth=await call('/auth/verify',{address:account.address,nonce:nonce.nonce,signature:await account.signMessage({message:nonce.message})});users.push({key,account,token:auth.token})}
 const [host,peer]=users,me=host.account.address.toLowerCase()
 const config={templateId:'token-catch',name:'Cloudflare live canary verification',visibility:'public',mode:'preview',rules:{templateId:'token-catch',arena_mode:true,world_version:4,duration_seconds:60,spawn_per_second:2,lanes:3,loot_budget:100,airdrop_count:4,loot_chunk:10,hazard_chance_pct:0,gun_spawn_chance_pct:0,win_threshold:1},admission:{player_cap:2,min_ready_to_start:2},access:{vault_mode:'simulated',required_amount:0,joiner_fee:0},rewards:{kind:'preview-points',slots:[{rank:1,points:100}]}}
 const room=await call('/rooms',{config,intentNonce:crypto.randomUUID()},host.token),rid=room.roomId
 for(const u of users){await call(`/rooms/${rid}/join`,{},u.token);await call(`/rooms/${rid}/ready`,{ready:true},u.token)}
 assert.equal((await call(`/rooms/${rid}`,undefined,host.token)).hostType,'cloudflare')
 let peerSocket;const peerFrames=[]
 const browser=await chromium.launch({args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],consoleErrors=[],received=[],sent=[],urls=[]
  let state=null
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())})
  page.on('websocket',socket=>{urls.push(socket.url());socket.on('framereceived',event=>{try{const f=JSON.parse(event.payload);received.push({at:Date.now(),...f});if(socket.url().includes('workers.dev')&&(f.payload?.bodies||f.state?.bodies))state=f.payload?.bodies?f.payload:f.state}catch{}});socket.on('framesent',event=>{try{const f=JSON.parse(event.payload);if(f.type==='action')sent.push(f)}catch{}})})
  await page.addInitScript(({key,token})=>{localStorage.setItem('orbix.wallet.key',key);localStorage.setItem('orbix.wallet.kind','generated');localStorage.setItem('orbix.session.token',token);const Native=window.WebSocket;window.qaSockets=[];window.WebSocket=class extends Native{constructor(...args){super(...args);window.qaSockets.push(this)}}},{key:host.key,token:host.token})
  await page.goto(`${base}/center/rooms/${rid}`,{waitUntil:'domcontentloaded'})
  await page.getByRole('button',{name:'Reconnect to room',exact:true}).click({timeout:30000})
  await page.waitForTimeout(500)
  await call(`/rooms/${rid}/start`,{},host.token)
  await page.waitForFunction(()=>window.qaSockets.some(s=>s.url.includes('workers.dev')&&s.readyState===1),{},{timeout:30000})
  console.log('Live Cloudflare socket connected')
  const {transport}=await call(`/rooms/${rid}/multiplayer-ticket`,{},peer.token)
  peerSocket=new WebSocket(transport.websocketUrl,{origin:base});peerSocket.on('message',raw=>peerFrames.push(JSON.parse(String(raw))))
  await new Promise((resolve,reject)=>{peerSocket.once('open',resolve);peerSocket.once('error',reject)})
  peerSocket.send(JSON.stringify({type:'session.hello',ticket:transport.ticket}))
  await wait(600);assert(peerFrames.some(f=>f.type==='session.ready'))
  peerSocket.send(JSON.stringify({type:'action',payload:{kind:'move',seq:1,dx:0,dz:0}}))
  const initialEdges=urls.filter(u=>u.includes('workers.dev')).length
  await page.evaluate(()=>window.qaSockets.findLast(s=>s.url.includes('workers.dev')&&s.readyState===1).close(1000,'verification reconnect'))
  await page.waitForFunction(()=>window.qaSockets.filter(s=>s.url.includes('workers.dev')).length>=2&&window.qaSockets.some(s=>s.url.includes('workers.dev')&&s.readyState===1),{},{timeout:15000})
  assert(urls.filter(u=>u.includes('workers.dev')).length>initialEdges)
  console.log('Second player connected; browser reconnect obtained a fresh ticket')
  await page.locator('.ow-canvas-wrap canvas').waitFor({state:'visible',timeout:30000})
  await page.locator('.ow-loading-assets').waitFor({state:'hidden',timeout:30000})
  console.log('Production Three.js renderer ready')
  await page.locator('.gp-arena').focus();await page.keyboard.down('w');await page.waitForTimeout(350);await page.keyboard.press('Space');await page.keyboard.up('w');await page.waitForTimeout(600);await page.keyboard.press('r');await page.waitForTimeout(600)
  assert(sent.some(f=>f.payload.kind==='move'));assert(sent.some(f=>f.payload.kind==='jump'));assert(sent.some(f=>f.payload.kind==='dodge'))
  const capture=async name=>{const c=await page.context().newCDPSession(page);const {data}=await c.send('Page.captureScreenshot',{format:'png',fromSurface:false});await fs.writeFile(`${dir}/${name}.png`,Buffer.from(data,'base64'));await c.detach()}
  const mobileLayout=await page.evaluate(()=>{const e=document.querySelector('.ct-native-game'),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,gameOnTop:!!document.elementFromPoint(30,30)?.closest('.ct-native-game'),overflow:document.documentElement.scrollWidth>innerWidth}})
  assert(mobileLayout.gameOnTop&&mobileLayout.x===0&&mobileLayout.y===0&&mobileLayout.width===390&&!mobileLayout.overflow,JSON.stringify(mobileLayout))
  const mobileCapture=capture('mobile-live')
  console.log('Live mobile screenshot requested')
  await page.waitForTimeout(100)
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px page overflow')

  let seq=Date.now(),opened=false,looted=false
  const send=async payload=>page.evaluate(payload=>{const s=window.qaSockets.findLast(s=>s.url.includes('workers.dev')&&s.readyState===1);s?.send(JSON.stringify({type:'action',payload}))},payload)
  // Navigate around published colliders, using only server snapshots and normalized inputs.
  function waypoint(b,target,s){const step=1,key=(x,z)=>`${x},${z}`,start=[Math.round(b.x),Math.round(b.z)],queue=[start],parents=new Map([[key(...start),null]]);let goal=null
   const blocked=(x,z)=>Math.abs(x)>19||Math.abs(z)>19||s.crates.some(c=>c.hp>0&&Math.abs(x-c.x)<1.1&&Math.abs(z-c.z)<1.1)||s.obstacles.some(o=>Math.abs(x-o.x)<o.width/2+.65&&Math.abs(z-o.z)<o.depth/2+.65)
   for(let i=0;i<queue.length;i++){const [x,z]=queue[i];if(Math.hypot(x-target.x,z-target.z)<1.5){goal=[x,z];break}for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const n=[x+dx*step,z+dz*step],k=key(...n);if(!parents.has(k)&&!blocked(...n)){parents.set(k,[x,z]);queue.push(n)}}}
   if(!goal)return target;let prev=goal;while(parents.get(key(...prev))&&key(...parents.get(key(...prev)))!==key(...start))prev=parents.get(key(...prev));return {x:prev[0],z:prev[1]}}
  const until=Date.now()+65000
  while(Date.now()<until&&!state?.finished){if(!state?.bodies?.[me]){await wait(100);continue}const b=state.bodies[me],drop=state.airdrops.find(c=>!c.opened)||state.airdrops[0];if(!drop){await wait(100);continue}
   const coins=state.drops.filter(d=>d.kind==='coin'),target=coins.length?coins.sort((a,c)=>Math.hypot(a.x-b.x,a.z-b.z)-Math.hypot(c.x-b.x,c.z-b.z))[0]:drop
   const dist=Math.hypot(target.x-b.x,target.z-b.z)
   if(dist>2.2){const w=waypoint(b,target,state),dx=w.x-b.x,dz=w.z-b.z,n=Math.max(1,Math.hypot(dx,dz));await send({kind:'move',seq:++seq,dx:dx/n,dz:dz/n,yaw:Math.atan2(dx,dz),sprint:true})}
   else{await send({kind:'move',seq:++seq,dx:0,dz:0});if(coins.length){await send({kind:'loot',dropId:target.id});looted=true}else if(drop.landAt<=state.nowMs&&!drop.opened){await send({kind:'open_airdrop',dropId:drop.id});opened=true}}
   await wait(125)
  }
  const settleUntil=Date.now()+45000
  while(Date.now()<settleUntil&&!received.some(f=>f.type==='settlement.finalized'))await wait(100)
  await page.getByRole('region',{name:'Round results',exact:true}).waitFor({timeout:10000})
  const after=await call(`/rooms/${rid}`,undefined,host.token),round=after.roundId
  assert(received.some(f=>f.type==='settlement.finalized'),'Railway verified settlement returned')
  assert(opened&&looted,'Actual open/loot actions sent')
  const final=received.findLast(f=>f.type==='game.patch'&&f.payload?.finished)?.payload??state
  assert(Number(final.scores[me])>0,'Authoritative collected score')
  assert(after.settlement?.payload||after.settlement,'REST result visible')
  await mobileCapture
  await capture('mobile-results');await wait(300)
  assert(peerFrames.some(f=>f.type==='action.ack'));assert(peerFrames.some(f=>f.type==='game.patch'&&f.payload?.finished))
  const patches=received.filter(f=>f.type==='game.patch'&&f.payload?.tick>0),first=patches[5],last=patches.at(-6),seconds=(last.payload.serverTimeMs-first.payload.serverTimeMs)/1000
  const intervals=patches.slice(1).map((f,i)=>f.at-patches[i].at).sort((a,b)=>a-b)
  const summary={verifiedAt:new Date().toISOString(),backend:'updated local Center API reached through temporary named Cloudflare tunnel; NOT deployed Railway',worker:'https://multiplayer.justask3211.workers.dev',roomId:rid,roundId:round,hostType:after.hostType,status:after.status,simHz:(last.payload.tick-first.payload.tick)/seconds,broadcastHz:(patches.length-11)/seconds,patchIntervalP50Ms:intervals[Math.floor(intervals.length*.5)],patchIntervalP95Ms:intervals[Math.floor(intervals.length*.95)],frames:received.length,actions:sent.length,score:final.scores[me],consoleErrors,pageErrors:errors,viewports:[390],mobileLayout,connectedPlayers:2,freshTicketReconnect:true,peerFinalScore:peerFrames.findLast(f=>f.type==='game.patch'&&f.payload?.finished)?.payload.scores[me],settlementSeen:true,websocketHosts:urls.map(u=>new URL(u).host)}
  assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[])
  await fs.writeFile(`${dir}/live-round.json`,JSON.stringify(summary,null,2)+'\n')
  console.log(JSON.stringify(summary,null,2))
 }finally{peerSocket?.close();await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)})
