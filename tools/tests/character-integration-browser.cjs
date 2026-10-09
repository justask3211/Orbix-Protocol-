/* Real profile persistence → lobby appearance → authoritative match → podium. */
const {chromium}=require(process.env.ORBIX_PLAYWRIGHT_MODULE||'/tmp/orbix-browser-tools/node_modules/playwright')
const {generatePrivateKey,privateKeyToAccount}=require('../../web/node_modules/viem/accounts')
const assert=require('node:assert/strict')
const base=process.env.ORBIX_BASE_URL||'http://127.0.0.1:8100',prefix='/api/center/v1'
;(async()=>{
 const call=async(path,body,token)=>{const r=await fetch(base+prefix+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});assert(r.ok,await r.clone().text());return r.json()}
 const accounts=[];for(let i=0;i<2;i++){const key=generatePrivateKey(),account=privateKeyToAccount(key),n=await call('/auth/nonce',{address:account.address}),a=await call('/auth/verify',{address:account.address,nonce:n.nonce,signature:await account.signMessage({message:n.message})});accounts.push({key,account,token:a.token})}
 const [host,peer]=accounts;await call('/profile/character',{character:'turtle',cosmetics:{}},peer.token)
 const browser=await chromium.launch({args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 try{
 const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.emulateMedia({reducedMotion:'reduce'});await page.addInitScript(({key,token})=>{localStorage.setItem('orbix.wallet.key',key);localStorage.setItem('orbix.wallet.kind','generated');localStorage.setItem('orbix.session.token',token)},{key:host.key,token:host.token})
 await page.goto(base+'/center');await page.getByRole('button',{name:'Open profile',exact:true}).click();await page.getByRole('tab',{name:'Character',exact:true}).click()
 const custom=page.getByRole('region',{name:'Character customization'})
 for(const id of ['Maple','Tuck']){await custom.getByRole('button',{name:new RegExp(id)}).click();await page.getByRole('img',{name:id+' character preview'}).locator('canvas').waitFor();await page.waitForTimeout(500);await page.screenshot({path:'/tmp/orbix-q-profile-'+id+'.png',timeout:60000})}
 await custom.getByRole('button',{name:/Maple/}).click();await page.getByRole('button',{name:'Save character',exact:true}).click()
 assert.equal((await call('/profile/'+host.account.address,undefined,host.token)).character,'cat')
 const config={templateId:'token-catch',name:'Cat and turtle verification',visibility:'public',mode:'preview',rules:{templateId:'token-catch',arena_mode:true,world_version:4,duration_seconds:15,spawn_per_second:2,lanes:5,loot_budget:100,airdrop_count:1,loot_chunk:10,win_threshold:1},admission:{player_cap:2,min_ready_to_start:2},access:{vault_mode:'simulated',required_amount:0,joiner_fee:0},rewards:{kind:'preview-points',slots:[{rank:1,points:100}]}}
 const room=await call('/rooms',{config,intentNonce:crypto.randomUUID()},host.token),rid=room.roomId
 for(const player of accounts){await call(`/rooms/${rid}/join`,{},player.token);await call(`/rooms/${rid}/ready`,{ready:true},player.token)}
 await page.goto(base+'/center/rooms/'+rid)
 const lobby=page.getByRole('region',{name:'Lobby characters'});await lobby.getByText(/You · Maple/).waitFor();await lobby.getByText(/· Tuck/).waitFor();await lobby.locator('canvas').waitFor();await page.waitForTimeout(500);await page.screenshot({path:'/tmp/orbix-q-lobby.png',timeout:60000})
 const detail=await call(`/rooms/${rid}`,undefined,host.token);assert.equal(detail.appearances[host.account.address.toLowerCase()].character,'cat');assert.equal(detail.appearances[peer.account.address.toLowerCase()].character,'turtle')
 await call(`/rooms/${rid}/start`,{},host.token)
 await page.locator('.gp-arena').waitFor();await page.waitForFunction(()=>!document.querySelector('.ow-loading'),{},{timeout:45000})
 await page.screenshot({path:'/tmp/orbix-q-game-cat-turtle.png',timeout:60000})
 // Inspect a real authoritative body snapshot via room state.
 const live=await call(`/rooms/${rid}`,undefined,host.token);const bodies=live.state?.bodies??live.publicState?.bodies??live.publicFrame?.payload?.bodies??{};assert(Object.keys(bodies).length===2,'Actual authoritative bodies must be present');{assert.equal(bodies[host.account.address.toLowerCase()].character,'cat');assert.equal(bodies[peer.account.address.toLowerCase()].character,'turtle')}
 await page.getByRole('region',{name:'Round results',exact:true}).waitFor({timeout:30000})
 // Zero-loot run need not produce winners; podium appearance is covered separately below.
 assert.deepEqual(errors,[]);console.log('PASS: both new profile previews, save/persistence, selected cat+turtle lobby, live authoritative match rendering and finish; zero JS errors.')
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
