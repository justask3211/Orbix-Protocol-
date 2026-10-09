/* Local authenticated UI + authoritative expiry. No wallet transactions. */
const {chromium}=require(process.env.ORBIX_PLAYWRIGHT_MODULE||'/tmp/orbix-browser-tools/node_modules/playwright')
const {generatePrivateKey,privateKeyToAccount}=require('../../web/node_modules/viem/accounts')
const assert=require('node:assert/strict')
const base=process.env.ORBIX_BASE_URL||'http://127.0.0.1:8099',prefix='/api/center/v1'
;(async()=>{
 const key=generatePrivateKey(),account=privateKeyToAccount(key)
 const call=async(path,body,token)=>{const r=await fetch(base+prefix+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});assert(r.ok,await r.clone().text());return r.json()}
 const nonce=await call('/auth/nonce',{address:account.address}),auth=await call('/auth/verify',{address:account.address,nonce:nonce.nonce,signature:await account.signMessage({message:nonce.message})})
 await call('/wallet/vault/deposit',{amount:1000},auth.token)
 const browser=await chromium.launch({args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 try{
 const page=await browser.newPage({viewport:{width:1000,height:900}}),errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(({key,token})=>{localStorage.setItem('orbix.wallet.key',key);localStorage.setItem('orbix.wallet.kind','generated');localStorage.setItem('orbix.session.token',token)},{key,token:auth.token})
 await page.goto(base+'/center/create/number-hunt')
 await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click()
 const picker=page.getByRole('group',{name:'Explore reward types'})
 await picker.getByRole('button',{name:/Waitlist form/}).click()
 await page.getByLabel('Who sees Waitlist form?').selectOption('anyone')
 await page.getByLabel('Message to recipient').fill('Tell us where to contact you.')
 await page.getByRole('button',{name:'Add field',exact:true}).click();await page.getByLabel('Optional short text field 1').fill('Name')
 await picker.getByRole('button',{name:/Q&A form/}).click()
 await page.getByLabel('Who sees Q&A form?').selectOption('anyone');await page.getByLabel('Question 1',{exact:true}).fill('What did you enjoy?')
 await page.getByRole('button',{name:'Add question',exact:true}).click();await page.getByLabel('Question 2',{exact:true}).fill('What should improve?')
 await page.screenshot({path:'/tmp/orbix-p-forms-wizard.png'})
 let published
 page.on('response',async r=>{if(r.url().endsWith(prefix+'/rooms')&&r.request().method()==='POST'){const data=await r.json();if(data.roomId)published=data}})
 await page.getByRole('button',{name:'Publish room',exact:true}).click()
 await page.waitForURL(/\/center\/rooms\//)
 await page.waitForFunction(()=>document.querySelector('h1'))
 assert(published)
 const detail=await call('/rooms/'+published.roomId,undefined,auth.token)
 assert.equal(detail.config.rewards.kind,'waitlist-form');assert.equal(detail.config.rewards.forms.length,2);assert.equal(detail.config.rewards.slots.length,0)
 // A second room finishes after 15 seconds, using the real server scheduler.
 const config={...detail.config,name:'Form browser expiry',rules:{...detail.config.rules,duration_seconds:15},admission:{player_cap:2,min_ready_to_start:1},access:{vault_mode:'simulated',required_amount:0,joiner_fee:0}}
 const room=await call('/rooms',{config,intentNonce:crypto.randomUUID()},auth.token),rid=room.roomId
 await call(`/rooms/${rid}/join`,{},auth.token);await call(`/rooms/${rid}/ready`,{ready:true},auth.token);await call(`/rooms/${rid}/start`,{},auth.token)
 await page.goto(base+'/center/rooms/'+rid)
 const waitlist=page.getByRole('dialog',{name:'Waitlist form',exact:true})
 await waitlist.waitFor({timeout:35000})
 assert.equal((await waitlist.getByLabel('EVM wallet address').inputValue()).toLowerCase(),account.address.toLowerCase())
 await waitlist.getByLabel('Name',{exact:true}).fill('Browser tester');await waitlist.getByRole('button',{name:'Submit response',exact:true}).click();await waitlist.getByText('Response saved',{exact:true}).waitFor();await waitlist.getByRole('button',{name:'Done',exact:true}).click()
 const qa=page.getByRole('dialog',{name:'Q&A form',exact:true});await qa.waitFor();await qa.getByLabel('What did you enjoy?').fill('Private browser answer');await qa.getByLabel('What should improve?').fill('Character detail');await qa.getByRole('button',{name:'Submit response',exact:true}).click();await qa.getByText('Response saved',{exact:true}).waitFor();await qa.getByRole('button',{name:'Done',exact:true}).click()
 await page.getByRole('button',{name:/Q&A form · View responses/}).click()
 const responses=page.getByRole('dialog',{name:'Q&A form responses',exact:true});await responses.getByText(/Private browser answer/).waitFor();await responses.screenshot({path:'/tmp/orbix-p-private-responses.png'});await responses.getByRole('button',{name:'Close responses'}).click()
 const rows=await call(`/rooms/${rid}/qa-form`,undefined,auth.token);assert.equal(rows.count,1)
 assert.deepEqual(errors,[])
 console.log('PASS: picker, builders, publish, server expiry, sequential forms, wallet prefill, submissions, creator responses; zero JS errors.')
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
