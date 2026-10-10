/* Two real admitted users, existing RoomSocket protocol and verified preview result.
 * Disposable local keys are kept in memory and never written to evidence. */
const {chromium}=require(process.env.ORBIX_PLAYWRIGHT_MODULE||'/tmp/orbix-browser-tools/node_modules/playwright')
const {generatePrivateKey,privateKeyToAccount}=require('../../web/node_modules/viem/accounts')
const assert=require('node:assert/strict'),fs=require('node:fs/promises')
const base=process.env.ORBIX_BASE_URL||'http://127.0.0.1:8099',dir='tools/tests/evidence/babylon'
;(async()=>{
 const call=async(path,body,token)=>{const r=await fetch(base+'/api/center/v1'+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});assert(r.ok,await r.clone().text());return r.json()}
 const users=[]
 for(const character of ['cat','turtle']){const key=generatePrivateKey(),account=privateKeyToAccount(key),nonce=await call('/auth/nonce',{address:account.address}),auth=await call('/auth/verify',{address:account.address,nonce:nonce.nonce,signature:await account.signMessage({message:nonce.message})});await call('/profile/character',{character,cosmetics:{}},auth.token);users.push({key,account,token:auth.token})}
 const [host,peer]=users,config={templateId:'token-catch',name:'Babylon parity verification',visibility:'public',mode:'preview',rules:{templateId:'token-catch',arena_mode:true,world_version:4,duration_seconds:60,spawn_per_second:2,lanes:5,loot_budget:100,airdrop_count:2,loot_chunk:10,win_threshold:1},admission:{player_cap:2,min_ready_to_start:2},access:{vault_mode:'simulated',required_amount:0,joiner_fee:0},rewards:{kind:'preview-points',slots:[{rank:1,points:100}]}}
 const room=await call('/rooms',{config,intentNonce:crypto.randomUUID()},host.token),rid=room.roomId
 for(const user of users){await call(`/rooms/${rid}/join`,{},user.token);await call(`/rooms/${rid}/ready`,{ready:true},user.token)}
 const peerTicket=(await call(`/rooms/${rid}/join`,{},peer.token)).ticket,peerSocket=new WebSocket(base.replace('http','ws')+`/api/center/v1/ws/rooms/${rid}`)
 await new Promise((resolve,reject)=>{peerSocket.onopen=()=>peerSocket.send(JSON.stringify({type:'session.hello',ticket:peerTicket}));peerSocket.onmessage=event=>{if(JSON.parse(event.data).type==='session.ready')resolve()};peerSocket.onerror=reject})
 const browser=await chromium.launch({args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 try{
  const page=await browser.newPage({viewport:{width:1280,height:850}}),errors=[],received=[],sent=[]
  page.on('pageerror',e=>errors.push(e.message))
  page.on('websocket',socket=>{socket.on('framereceived',event=>{try{received.push(JSON.parse(event.payload))}catch{}});socket.on('framesent',event=>{try{sent.push(JSON.parse(event.payload))}catch{}})})
  await page.addInitScript(({key,token})=>{
   localStorage.setItem('orbix.wallet.key',key);localStorage.setItem('orbix.wallet.kind','generated');localStorage.setItem('orbix.session.token',token)
   const Native=window.WebSocket;window.testRoomSockets=[];window.WebSocket=class extends Native{constructor(...args){super(...args);if(String(args[0]).includes('/ws/rooms/'))window.testRoomSockets.push(this)}}
  },{key:host.key,token:host.token})
  await page.goto(`${base}/center/rooms/${rid}?evidence`,{waitUntil:'domcontentloaded'})
  // Registration screens require an explicit reconnect even for an already
  // admitted wallet; auto-rejoin applies after a round is running.
  await page.getByRole('button',{name:'Reconnect to room',exact:true}).click({timeout:30000})
  await page.waitForFunction(()=>window.testRoomSockets.length&&window.testRoomSockets.at(-1).readyState===1,{},{timeout:60000})
  console.log('Host and peer WebSockets authenticated')
  await call(`/rooms/${rid}/start`,{},host.token)
  await page.waitForFunction(()=>window.orbixBabylon?.ready,{},{timeout:90000})
  console.log('Default Babylon room renderer ready')
  assert.equal(await page.locator('.ow-world').getAttribute('data-renderer'),'babylon')
  const before=await call(`/rooms/${rid}`,undefined,host.token),round=before.roundId
  await page.locator('.gp-arena').focus();await page.keyboard.down('w');await page.waitForTimeout(350);await page.keyboard.press('Space');await page.keyboard.up('w');await page.waitForTimeout(600);await page.keyboard.press('r');await page.waitForTimeout(600)
  assert(sent.some(frame=>frame.type==='action'&&frame.payload.kind==='move'&&Number.isFinite(frame.payload.seq)))
  assert(sent.some(frame=>frame.type==='action'&&frame.payload.kind==='jump'));assert(sent.some(frame=>frame.type==='action'&&frame.payload.kind==='dodge'))
  // Arenas acknowledge movement through body inputSeq in the 10 Hz snapshot,
  // unlike classic games' action.ack messages. Test the existing wire contract.
  const me=host.account.address.toLowerCase(),lastInput=sent.filter(frame=>frame.type==='action'&&frame.payload.kind==='move').at(-1).payload.seq
  const bodyFrom=frame=>frame.payload?.bodies?.[me]??frame.payload?.bodyDelta?.[me]??frame.state?.bodies?.[me]
  const deadline=Date.now()+5000
  while(Date.now()<deadline&&!received.some(frame=>Number(bodyFrom(frame)?.inputSeq)>=lastInput))await new Promise(resolve=>setTimeout(resolve,25))
  assert(received.some(frame=>Number(bodyFrom(frame)?.inputSeq)>=lastInput),'Movement inputSeq must be acknowledged by authoritative snapshots')
  assert(received.some(frame=>Number(bodyFrom(frame)?.jumpReadyAt)>0),'Published jump acceptance')
  assert(received.some(frame=>Number(bodyFrom(frame)?.dodgeReadyAt)>0),'Published dodge acceptance')
  assert(received.some(frame=>frame.type==='game.patch'||frame.type==='room.snapshot'))
  // Close the actual browser socket; the unchanged RoomSocket obtains a new
  // ticket, restores the current snapshot and re-enables the shared controls.
  const readyCount=received.filter(frame=>frame.type==='session.ready').length
  await page.evaluate(()=>window.testRoomSockets.at(-1).close())
  await page.waitForFunction(()=>window.testRoomSockets.length>=2&&window.testRoomSockets.at(-1).readyState===1,{},{timeout:15000})
  await page.waitForTimeout(700);assert(received.filter(frame=>frame.type==='session.ready').length>readyCount)
  await page.screenshot({path:`${dir}/live-room.png`,timeout:90000})
  await page.getByRole('region',{name:'Round results',exact:true}).waitFor({timeout:90000})
  assert(received.some(frame=>frame.type==='game.settled'||frame.type==='settlement'||frame.type.includes('settle')),'Result must come from the server settlement frame')
  const after=await call(`/rooms/${rid}`,undefined,host.token)
  await page.screenshot({path:`${dir}/result.png`,timeout:90000})
  // Finished results remain available independently of a host rematch.
  await call(`/rooms/${rid}/rematch`,{},host.token)
  const next=await call(`/rooms/${rid}`,undefined,host.token);assert.notEqual(next.roundId,round)
  const history=await call(`/rooms/${rid}/history`,undefined,host.token)
  assert(JSON.stringify(history).includes(round));assert.deepEqual(errors,[])
  await fs.writeFile(`${dir}/room.json`,JSON.stringify({date:'2026-10-10',renderer:'Default Babylon Token Catch, production build; Chromium SwiftShader',realUsers:2,webSocket:true,inputKinds:[...new Set(sent.filter(frame=>frame.type==='action').map(frame=>frame.payload.kind))],inputSequenced:true,inputSeqAcknowledged:true,jumpAccepted:true,dodgeAccepted:true,receivedTypes:[...new Set(received.map(frame=>frame.type))],reconnect:true,serverFinish:after.status,rematchFreshRound:true,previousRoundInHistory:true,pageErrors:errors,rewards:'Preview only; no wallet sends, token transfers or funded payout claim'},null,2)+'\n')
  console.log('PASS: Babylon real room input/ack/snapshot, reconnect, server results and rematch history')
 }finally{peerSocket.close();await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
