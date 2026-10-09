/* Local real-backend regression. Requires a disposable CENTER_DB and a built Center.
 * ORBIX_PLAYWRIGHT_MODULE=/path/to/playwright ORBIX_BASE_URL=http://127.0.0.1:8109 node tools/tests/wallet-waitlist-browser.cjs
 * Generated test keys are never printed. Injected provider hardware is simulated.
 */
const {chromium}=require(process.env.ORBIX_PLAYWRIGHT_MODULE || '../game-lab/node_modules/playwright')
const assert=require('node:assert/strict')
const fs=require('node:fs/promises')
const {privateKeyToAccount,generatePrivateKey}=require('../../web/node_modules/viem/accounts')
const base=process.env.ORBIX_BASE_URL || 'http://127.0.0.1:8109'
const api=base+'/api/center/v1'
async function request(path,token,body){const response=await fetch(api+path,{method:body===undefined?'GET':'POST',headers:{...(token?{authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});assert(response.ok,`Local API failed ${path}: ${response.status} ${await response.clone().text()}`);return response.json()}
async function auth(account){const nonce=await request('/auth/nonce',null,{address:account.address});const signature=await account.signMessage({message:nonce.message});return (await request('/auth/verify',null,{address:account.address,nonce:nonce.nonce,signature})).token}
;(async()=>{
const browser=await chromium.launch({args:['--no-sandbox']})
try{
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',permissions:['clipboard-read','clipboard-write']})
 const page=await context.newPage(),errors=[],posted=[]
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{posted.push(r.url()+' '+JSON.stringify(r.headers())+' '+(r.postData()||''))})
 await page.goto(base+'/center');await page.locator('.ct-wallet-connect').click()
 const modal=page.getByRole('dialog',{name:'Connect a wallet',exact:true});await modal.waitFor()
 assert(await modal.getByRole('button',{name:/WalletConnect QR/}).isDisabled(),'Missing relay configuration should be honest')
 assert(await modal.evaluate(e=>e.getBoundingClientRect().right<=innerWidth && e.getBoundingClientRect().left>=0),'Modal must fit 390px')
 assert.equal(await modal.evaluate(e=>getComputedStyle(e).animationName),'none')
 for(const selector of ['h3','.wl-sub']){
  const ratio=await modal.locator(selector).evaluate(e=>{
   const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number)
   const luminance=values=>values.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0)
   const fg=luminance(rgb(getComputedStyle(e).color)),bg=luminance(rgb(getComputedStyle(e.closest('.wl-modal')).backgroundColor))
   return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)
  });assert(ratio>=4.5,`Modal text contrast ${selector}: ${ratio}`)
 }

 await modal.screenshot({path:'/tmp/orbix-gh-wallet-390.png'})
 await modal.getByRole('button',{name:/Generate new wallet/}).click()
 const key=await modal.locator('.wl-key').innerText()
 const account=privateKeyToAccount(key),address=account.address
 await modal.getByRole('button',{name:'Copy key',exact:true}).click()
 await modal.getByRole('button',{name:'I saved it — continue',exact:true}).click()
 await page.locator('.ct-signout').waitFor()
 let token=await page.evaluate(()=>localStorage.getItem('orbix.session.token'))
 assert(token);assert.equal(await page.locator('.ct-wallet-account').getAttribute('title'),address)
 await request('/profile',token,{name:'Recovery Pilot',bio:'Local G/H regression',hue:147,showAddress:true})
 const image=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const c=canvas.getContext('2d');c.fillStyle='#ff704b';c.fillRect(0,0,128,128);return canvas.toDataURL('image/png')})
 await request('/profile/image',token,{image})
 await page.reload();await page.locator('.ct-topbar').getByText('Recovery Pilot',{exact:true}).waitFor()
 await page.locator('.ct-topbar img[alt="Profile"]').waitFor()
 await page.getByRole('button',{name:'Disconnect wallet',exact:true}).click()
 assert.equal(await page.evaluate(()=>localStorage.getItem('orbix.session.token')),null)
 // Logout, then restore through the actual recovery form in the same browser.
 await page.locator('.ct-wallet-connect').click();await page.getByRole('button',{name:/Recover with key/}).click()
 const input=page.getByLabel('Saved private key',{exact:true})
 await input.fill('0x'+'0'.repeat(64));assert(await page.getByRole('button',{name:'Recover and sign in',exact:true}).isDisabled())
 await input.fill(key);await page.getByRole('button',{name:'Recover and sign in',exact:true}).click()
 await page.locator('.ct-signout').waitFor();assert.equal(await page.locator('.ct-wallet-account').getAttribute('title'),address)
 await page.locator('.ct-topbar').getByText('Recovery Pilot',{exact:true}).waitFor();await page.locator('.ct-topbar img[alt="Profile"]').waitFor()
 // Prove recovery on a fresh device/storage, including the existing server profile.
 await page.evaluate(()=>localStorage.clear());await page.reload();await page.locator('.ct-wallet-connect').click();await page.getByRole('button',{name:/Recover with key/}).click();await page.getByLabel('Saved private key',{exact:true}).fill(key);await page.getByRole('button',{name:'Recover and sign in',exact:true}).click()
 await page.locator('.ct-topbar').getByText('Recovery Pilot',{exact:true}).waitFor();await page.locator('.ct-topbar img[alt="Profile"]').waitFor()
 token=await page.evaluate(()=>localStorage.getItem('orbix.session.token'))
 assert.equal(await page.locator('.ct-wallet-account').getAttribute('title'),address)
 const restoredProfile=await request('/profile/'+address)
 assert.equal(restoredProfile.bio,'Local G/H regression');assert.equal(restoredProfile.hue,147)
 assert(!posted.some(body=>body.includes(key)),'Recovery key must never appear in any posted request')
 // The actual wizard exposes the opt-in and optional creator message at step 4.
 await page.goto(base+'/center/create/number-hunt');await page.getByRole('button',{name:'4 Fees & rewards',exact:true}).click()
 const optIn=page.getByRole('checkbox',{name:'Wallet waitlist — free, no funds involved',exact:true});await optIn.check()
 await page.getByLabel('Optional message to players',{exact:false}).fill('Local creator message: next-event list only.')
 assert.equal(await page.getByLabel('Optional message to players',{exact:false}).getAttribute('maxlength'),'280')
 // A real scheduled match with two participants, neither a winner: no manual finish fixture.
 await request('/wallet/vault/deposit',token,{amount:1000})
 const config={templateId:'number-hunt',name:'G H browser match',visibility:'public',mode:'preview',rules:{templateId:'number-hunt',digits:4,min:1111,max:9999,guess_budget:3,duration_seconds:15,hints:'off',target_count:1,win_mode:'first-hit',guess_cooldown_ms:300},admission:{player_cap:2,min_ready_to_start:2},access:{vault_mode:'simulated',required_amount:0,joiner_fee:0},rewards:{kind:'preview-points',slots:[]},waitlist:{enabled:true,message:'Local creator message: next-event list only.'}}
 const created=await request('/rooms',token,{config,intentNonce:crypto.randomUUID()}),rid=created.roomId
 const other=privateKeyToAccount(generatePrivateKey()),otherToken=await auth(other)
 for(const t of [token,otherToken]){await request(`/rooms/${rid}/join`,t,{});await request(`/rooms/${rid}/ready`,t,{ready:true})}
 await request(`/rooms/${rid}/start`,token,{})
 assert.equal((await request(`/rooms/${rid}/waitlist`,token)).count,0)
 await page.goto(base+`/center/rooms/${rid}`)
 const popup=page.getByRole('dialog',{name:'Join the wallet waitlist',exact:true})
 await popup.waitFor({timeout:35000})
 assert.equal((await request(`/rooms/${rid}/waitlist`,token)).count,0,'No automatic collection at finish')
 assert.equal(await popup.getByLabel('EVM wallet address',{exact:true}).inputValue(),address)
 await popup.getByText(config.waitlist.message,{exact:true}).waitFor()
 await popup.getByRole('button',{name:'Maybe later',exact:true}).click()
 await page.getByRole('button',{name:'Join wallet waitlist',exact:true}).click()
 const arbitrary='0x'+'cd'.repeat(20)
 await popup.getByLabel('EVM wallet address',{exact:true}).fill('invalid');assert(await popup.getByRole('button',{name:'Submit address',exact:true}).isDisabled())
 await popup.getByLabel('EVM wallet address',{exact:true}).fill(arbitrary);await popup.getByRole('button',{name:'Submit address',exact:true}).click();await popup.getByText('Address saved',{exact:true}).waitFor()
 await popup.screenshot({path:'/tmp/orbix-gh-waitlist-390.png'});await popup.getByRole('button',{name:'Done',exact:true}).click()
 await page.getByRole('button',{name:/View waitlist/}).click()
 const collected=page.getByRole('dialog',{name:'Collected wallet waitlist',exact:true})
 await collected.getByText('1 submissions · 1 unique addresses',{exact:true}).waitFor()
 await collected.getByRole('button',{name:'Copy all addresses',exact:true}).click()
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),arbitrary)
 const downloadPromise=page.waitForEvent('download');await collected.getByRole('button',{name:'Download CSV',exact:true}).click();const download=await downloadPromise
 const csv=await fs.readFile(await download.path(),'utf8');assert(csv.includes(arbitrary)&&csv.includes(address.toLowerCase()));assert(csv.startsWith('wallet,player,timestamp'))
 await request(`/rooms/${rid}/waitlist`,otherToken,{wallet:arbitrary})
 await collected.getByRole('button',{name:'Refresh list',exact:true}).click();await collected.getByText('2 submissions · 1 unique addresses',{exact:true}).waitFor()
 await collected.getByRole('button',{name:'Close collected waitlist',exact:true}).click()
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px page overflow')
 assert.deepEqual(errors,[])
 console.log('PASS: real backend generation → logout → recovery and fresh-device recovery preserve address, topbar name and avatar; key absent from POST bodies; 390px reduced-motion modal; wizard opt-in; actual timed match; explicit non-winner waitlist, prefill, arbitrary address, dismiss/reopen, copy-all and real CSV export.')
 await context.close()
 // Two installed extension providers are simulated; signatures are verified by the real backend.
 const injected=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'})
 const fixture=privateKeyToAccount(generatePrivateKey()),p=await injected.newPage()
 await p.exposeFunction('__signFixture',async hex=>fixture.signMessage({message:Buffer.from(hex.slice(2),'hex').toString('utf8')}))
 await p.addInitScript(address=>{
  const listeners=new Map()
  const provider={isTrustWallet:true,request:async({method,params})=>{if(method==='eth_requestAccounts')return [address];if(method==='personal_sign')return window.__signFixture(params[0]);throw Error(method)},on:(event,fn)=>listeners.set(event,fn),removeListener:(event)=>listeners.delete(event)}
  window.ethereum=provider;window.__walletChanged=()=>listeners.get('accountsChanged')?.([])
  window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{uuid:'trust-fixture',name:'Trust Wallet',rdns:'com.trustwallet.app',icon:'https://never-fetch.example/icon.svg'},provider}})))
 },fixture.address)
 const icons=[];p.on('request',r=>{if(r.url().includes('never-fetch'))icons.push(r.url())})
 await p.goto(base+'/center');await p.locator('.ct-wallet-connect').click();await p.getByRole('button',{name:/Trust Wallet.*Detected/}).click();await p.locator('.ct-signout').waitFor();assert.equal(await p.locator('.ct-wallet-account').getAttribute('title'),fixture.address)
 await p.evaluate(()=>window.__walletChanged());await p.locator('.ct-wallet-connect').waitFor();assert.equal(await p.evaluate(()=>localStorage.getItem('orbix.session.token')),null);assert.equal(icons.length,0)
 console.log('PASS: mocked EIP-6963 Trust extension signs against real backend; account-change invalidates session; provider icon URL is never fetched. Live extension hardware and WalletConnect pairing remain unproven.')
 await injected.close()
}finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
