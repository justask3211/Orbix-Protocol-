/* SDK/relay fixture only. Start Vite with a disposable nonempty
 * VITE_WALLETCONNECT_PROJECT_ID; run against a disposable real Center backend.
 * ORBIX_PLAYWRIGHT_MODULE=/path/to/playwright ORBIX_DEV_URL=http://127.0.0.1:5199 ORBIX_API_URL=http://127.0.0.1:8109 node tools/tests/walletconnect-browser.cjs
 * This does not prove a live WalletConnect relay or mobile-wallet pairing.
 */
const {chromium}=require(process.env.ORBIX_PLAYWRIGHT_MODULE || '../game-lab/node_modules/playwright')
const {generatePrivateKey,privateKeyToAccount}=require('../../web/node_modules/viem/accounts')
const assert=require('node:assert/strict')
const dev=process.env.ORBIX_DEV_URL || 'http://127.0.0.1:5199',api=process.env.ORBIX_API_URL || 'http://127.0.0.1:8109'
;(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),page=await context.newPage(),account=privateKeyToAccount(generatePrivateKey()),errors=[]
 page.on('pageerror',e=>errors.push(e.message));await page.exposeFunction('__signQr',hex=>account.signMessage({message:Buffer.from(hex.slice(2),'hex').toString('utf8')}))
 await page.addInitScript(address=>{window.__qrAddress=address;window.__qrCalls=[]},account.address)
 await page.route('**/api/center/**',async route=>{const u=new URL(route.request().url());const response=await route.fetch({url:api+u.pathname+u.search});await route.fulfill({response})})
 await page.route('**/.vite/deps/@walletconnect_ethereum-provider.js*',route=>route.fulfill({contentType:'application/javascript',body:`
  const listeners=new Map();let rejectPair,chain='0x1';
  const provider={signer:{abortPairingAttempt(){window.__cancelled=(window.__cancelled||0)+1;rejectPair?.(new Error('cancelled'));}},
    on(event,fn){listeners.set(event,fn)},removeListener(event){listeners.delete(event)},
    enable(){return new Promise((resolve,reject)=>{rejectPair=reject;window.__approveQr=()=>resolve([window.__qrAddress]);listeners.get('display_uri')?.('wc:'+ '12'.repeat(32)+'@2?relay-protocol=irn&symKey='+'34'.repeat(32));})},
    async request({method,params}){window.__qrCalls.push(method);if(method==='personal_sign')return window.__signQr(params[0]);if(method==='eth_requestAccounts')return [window.__qrAddress];if(method==='eth_chainId')return chain;if(method==='wallet_switchEthereumChain'){chain=params[0].chainId;return null}throw Error(method)}};
  window.__qrProvider=provider;window.__qrListeners=listeners;
  export const EthereumProvider={async init(options){if(options.showQrModal!==false)throw Error('Must use the local SVG QR view');return provider}};
 `}))
 await page.goto(dev+'/center/');await page.locator('.ct-wallet-connect').click();const dialog=page.getByRole('dialog',{name:'Connect a wallet',exact:true})
 await dialog.getByRole('button',{name:/WalletConnect QR/}).click();await page.getByRole('img',{name:'WalletConnect connection QR code',exact:true}).waitFor()
 assert.equal(await dialog.locator('.wl-qr path').count(),1);assert.equal(await dialog.locator('img').count(),0)
 await dialog.getByRole('button',{name:'Cancel QR connection',exact:true}).click();await dialog.getByRole('button',{name:/WalletConnect QR/}).waitFor()
 await page.waitForFunction(()=>window.__cancelled===1 && window.__qrListeners.size===0)
 assert.equal(await page.evaluate(()=>localStorage.getItem('orbix.session.token')),null)
 await dialog.getByRole('button',{name:/WalletConnect QR/}).click();await page.getByRole('img',{name:'WalletConnect connection QR code',exact:true}).waitFor();await dialog.screenshot({path:'/tmp/orbix-gh-qr-390.png'})
 assert(await dialog.evaluate(e=>e.getBoundingClientRect().right<=innerWidth && e.scrollWidth<=e.clientWidth))
 await page.evaluate(()=>window.__approveQr());await page.locator('.ct-signout').waitFor();assert.equal(await page.locator('.ct-wallet-account').getAttribute('title'),account.address)
 const same=await page.evaluate(async address=>{const {rewardWallet}=await import('/center/src/center/rewardWallet.ts');return (await rewardWallet(address))===window.__qrProvider},account.address)
 assert(same,'Contract actions must use the signed-in QR provider')
 const calls=await page.evaluate(()=>window.__qrCalls);assert(calls.includes('personal_sign'));assert(!calls.includes('eth_sendTransaction'))
 assert.equal(await page.evaluate(()=>window.__qrListeners.has('display_uri')),false)
 assert.deepEqual(errors,[])
 console.log('PASS (mock SDK/relay, real signature backend): local SVG QR at 390px, cancellation cleanup, retry, WalletConnect sign-in, selected QR provider routed into existing contract checks, no transaction during sign-in. Live relay and physical wallet pairing unproven.')
 await context.close()
}finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1})
