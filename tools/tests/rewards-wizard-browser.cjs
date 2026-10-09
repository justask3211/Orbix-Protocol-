/* Real local API/auth plus mocked read-only collection. No live wallet transactions. */
const {chromium}=require(process.env.ORBIX_PLAYWRIGHT_MODULE||'/tmp/orbix-browser-tools/node_modules/playwright')
const {generatePrivateKey,privateKeyToAccount}=require('../../web/node_modules/viem/accounts')
const {encodeAbiParameters,toFunctionSelector}=require('../../web/node_modules/viem')
const assert=require('node:assert/strict')
const base=process.env.ORBIX_BASE_URL||'http://127.0.0.1:8099'
;(async()=>{
 const key=generatePrivateKey(),account=privateKeyToAccount(key)
 const api=async(path,body)=>{const r=await fetch(base+'/api/center/v1'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert(r.ok,await r.clone().text());return r.json()}
 const nonce=await api('/auth/nonce',{address:account.address}),auth=await api('/auth/verify',{address:account.address,nonce:nonce.nonce,signature:await account.signMessage({message:nonce.message})})
 const browser=await chromium.launch({args:['--no-sandbox']})
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 const owner=encodeAbiParameters([{type:'address'}],[account.address]),word=n=>encodeAbiParameters([{type:'uint256'}],[BigInt(n)])
 const metadata=encodeAbiParameters([{type:'string'}],['data:application/json;base64,'+Buffer.from(JSON.stringify({name:'Original test NFT'})).toString('base64')])
 await page.addInitScript(({key,token,address,owner,two,seven,nine,metadata,selectors})=>{
  localStorage.setItem('orbix.wallet.key',key);localStorage.setItem('orbix.wallet.kind','generated');localStorage.setItem('orbix.session.token',token)
  window.mockSends=0;window.ethereum={request:async({method,params})=>{
   if(method==='eth_chainId')return '0xb626';if(method==='eth_requestAccounts')return [address]
   if(method==='eth_sendTransaction'){window.mockSends++;throw Error('No transactions permitted in browser regression')}
   if(method==='eth_call'){const data=params[0].data;if(data.startsWith(selectors.balance))return two;if(data.startsWith(selectors.enumerate))return BigInt('0x'+data.slice(-64))===0n?seven:nine;if(data.startsWith(selectors.owner))return owner;if(data.startsWith(selectors.uri))return metadata;return '0x'}
   throw Error(method)
  }}
 },{key,token:auth.token,address:account.address,owner,two:word(2),seven:word(7),nine:word(9),metadata,selectors:{balance:toFunctionSelector('balanceOf(address)'),enumerate:toFunctionSelector('tokenOfOwnerByIndex(address,uint256)'),owner:toFunctionSelector('ownerOf(uint256)'),uri:toFunctionSelector('tokenURI(uint256)')}})
 await page.goto(base+'/center/create/combat-duel')
 await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click()
 await page.getByRole('checkbox',{name:'Fund real testnet rewards',exact:true}).check()
 await page.getByLabel('Reward type',{exact:true}).selectOption('erc721')
 await page.getByLabel('Token / collection contract',{exact:true}).fill('0x'+'ab'.repeat(20))
 await page.getByRole('button',{name:'Read my held NFTs',exact:true}).click()
 await page.getByText('2 held NFTs verified.',{exact:true}).waitFor()
 const picker=page.getByRole('region',{name:'NFT selector'})
 await picker.getByRole('checkbox').nth(0).check();await picker.getByRole('checkbox').nth(1).check()
 await page.getByText('NFT #7 → winner rank 1',{exact:true}).waitFor();await page.getByText('NFT #9 → winner rank 2',{exact:true}).waitFor()
 assert.equal(await page.getByLabel('Prize slots',{exact:true}).inputValue(),'2')
 await page.getByLabel('Claim mode',{exact:true}).selectOption('merkle')
 await page.getByLabel('Fixed recipient wallets (one per selected NFT or slot)').fill(account.address+'\n0x'+'cd'.repeat(20))
 await page.getByRole('region',{name:'Funded reward settings'}).screenshot({path:'/tmp/orbix-mno-nft-wizard.png'})
 await page.getByLabel('Reward type',{exact:true}).selectOption('waitlist-drop')
 await page.getByLabel('Source waitlist room ID',{exact:true}).fill('missing-room')
 await page.getByRole('button',{name:'Distribute to this waitlist',exact:true}).click()
 await page.getByRole('region',{name:'Funded reward settings'}).getByText(/no such room/i).waitFor()
 await page.getByLabel('Reward type',{exact:true}).selectOption('eth')
 await page.getByLabel('Claim mode',{exact:true}).selectOption('open')
 await page.getByRole('button',{name:'Publish room',exact:true}).click()
 await page.getByText(/disabled on this preview deployment|not available yet|funded rewards are disabled/i).first().waitFor()
 assert.equal(await page.getByLabel('Claim deadline (local time)').isDisabled(),false,'Failed prepare must leave settings editable')
 assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).some(k=>k.startsWith('orbix-reward-publication:'))),false)
 assert.equal(await page.evaluate(()=>window.mockSends),0)
 assert.deepEqual(errors,[])
 console.log('PASS: authenticated mobile wizard, NFT enumeration, multiple ID selection and assignments, fixed recipients, owner-only waitlist error; zero wallet sends and zero JS errors.')
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
