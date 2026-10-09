// Browser-only reward fixtures. Never sends funding or claim transactions.
const {chromium}=require(process.env.ORBIX_PLAYWRIGHT_MODULE || 'playwright');const assert=require('node:assert/strict')
const base=process.env.ORBIX_PHASE_F_BASE_URL || 'http://127.0.0.1:5173'
;(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox']});const evidence=[]
 try{
 for(const width of [1200,390,320]){
 const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(()=>{localStorage.setItem('orbix.wallet.key','0x'+'ab'.repeat(32));localStorage.setItem('orbix.wallet.kind','generated')})
 await page.goto(`${base}/center/create/number-hunt`,{waitUntil:'domcontentloaded'})
 await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click()
 await page.getByLabel('Fund real testnet rewards').check()
 await page.getByLabel('Token / collection contract').fill('0x'+'cd'.repeat(20));await page.getByLabel('Per-winner amount (base units)',{exact:true}).fill('1000000000000000000')
 await page.getByLabel('Winner reward preview').waitFor();assert.equal(await page.getByLabel('Funded reward lifecycle').locator('li').count(),5)
 await page.getByLabel('Reward type',{exact:true}).selectOption('erc721');await page.getByLabel('Per-winner amount (base units)',{exact:true}).fill('1');await page.getByLabel('NFT token ID',{exact:true}).fill('8');
 await page.getByLabel('Reward type',{exact:true}).selectOption('erc20');await page.getByLabel('Per-winner amount (base units)',{exact:true}).fill('1000');
 await page.getByLabel('Claim mode',{exact:true}).selectOption('code');assert(await page.getByLabel('Winner reward preview').innerText().then(t=>t.includes('claimByCode')))
 await page.getByLabel('Reward type',{exact:true}).selectOption('erc1155');await page.getByLabel('NFT token ID',{exact:true}).fill('12')
 await page.getByLabel('Claim mode',{exact:true}).selectOption('merkle');await page.getByLabel('Fixed recipient wallets (one per rank)').fill('0x'+'ef'.repeat(20));assert(await page.getByLabel('Winner reward preview').innerText().then(t=>t.includes('claimByMerkle')))
 await page.getByLabel('Claim mode',{exact:true}).selectOption('open');assert(await page.getByLabel('Winner reward preview').innerText().then(t=>t.includes('claimOpen')))
 await page.getByLabel('Reward type',{exact:true}).selectOption('key');await page.getByRole('alert').filter({hasText:'Private-key rewards require'}).waitFor()
 await page.getByLabel('Reward type',{exact:true}).selectOption('eth');await page.getByLabel('Claim mode',{exact:true}).selectOption('auto');await page.getByLabel('Per-winner amount (wei)',{exact:true}).fill('1000')
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Wizard overflow ${width}`)
 await page.getByRole('button',{name:'Open profile',exact:true}).click();await page.getByRole('tab',{name:'My rewards',exact:true}).click()
 const me=await page.evaluate(()=>localStorage.getItem('orbix.session.token').split(':')[0])
 const claim={claimId:'fixture',roomId:'fixture',poolId:'7',engine:'0x5b8d41421b9a6701cb7948e724234cb9b1eb8e1b',chainId:46630,winner:me,assetKind:'erc20',assetContract:'0x'+'cd'.repeat(20),tokenId:'0',amount:'1000',deadline:Math.floor(Date.now()/1000)+86400,payable:true,claimed:false,function:'claimByCode',args:['7',0,1,'0x'+'11'.repeat(65)],code:'OR3-browser-fixture'}
 await page.route('**/wallet/rewards',r=>r.fulfill({json:{rewards:[claim]}}));await page.route('**/rewards/lookup',r=>r.fulfill({json:{claim}}))
 await page.getByRole('button',{name:'Refresh rewards',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Claim later',exact:true}).click()
 await page.getByLabel('Wallet-bound claim code').waitFor();assert.equal(await page.getByLabel('Wallet-bound claim code').inputValue(),claim.code)
 assert.equal(await page.evaluate(me=>localStorage.getItem(`orbix-reward-code:${me}:fixture`),me),claim.code)
 await page.getByRole('button',{name:'Copy code',exact:true}).click();await page.getByRole('status').filter({hasText:/Claim code copied|Copy unavailable/}).waitFor()
 await page.getByText('Exact wallet call',{exact:true}).click();assert(await page.getByRole('dialog').locator('.fr-card').innerText().then(t=>t.includes('claimByCode(7, 0, 1,')))
 await page.getByLabel('Paste a claim code').fill(claim.code);await page.getByRole('button',{name:'Find reward',exact:true}).click();assert.equal(await page.getByRole('dialog').locator('.fr-card').count(),1)
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Rewards overflow ${width}`)
 if(width===390){await page.screenshot({path:'/tmp/orbix-phase-f-rewards-mobile.png'});await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByLabel('Funded reward settings').screenshot({path:'/tmp/orbix-phase-f-wizard-mobile.png'})}
 if(width===1200){
 await page.getByRole('button',{name:'Close',exact:true}).click()
 await page.evaluate(({me,claim})=>sessionStorage.setItem(`orbix-reward-publication:${me}:number-hunt:`,JSON.stringify({nonce:'saved-fixture',config:{template_id:'number-hunt',name:'Resumed funding room',visibility:'unlisted',rules:{digits:4,min:1111,max:9999,guess_budget:20,duration_seconds:60,hints:'on',target_count:1,win_mode:'first-hit'},admission:{player_cap:2,min_ready_to_start:2},access:{vault_mode:'simulated',required_amount:25,joiner_fee:0,creator_absorbs_joiner_fee:false},entry:{kind:'free'}},rewards:{kind:'funded-assets',claim_mode:'auto',claim_deadline:claim.deadline,merkle_winners:[],slots:[{rank:1,asset_kind:'erc20',asset_contract:claim.assetContract,token_id:'0',amount:'1000'}]}})),{me,claim})
 await page.goto(`${base}/center/create/number-hunt`)
 await page.getByText('A funded publication is in progress.',{exact:false}).waitFor()
 assert(await page.getByLabel('Fund real testnet rewards').isChecked());assert(await page.getByLabel('Fund real testnet rewards').isDisabled())
 assert.equal(await page.getByLabel('Per-winner amount (base units)',{exact:true}).inputValue(),'1000')
 const room={roomId:'phase-f-fixture',roomNumber:'999999',roundId:'0x'+'34'.repeat(32),owner:me,name:'Phase F result fixture',status:'claimable',visibility:'public',participants:[{who:me,role:'player',ready:true}],config:{template_id:'number-hunt',mode:'testnet',rules:{digits:4,min:1111,max:9999,guess_budget:20,duration_seconds:60,hints:'on',target_count:1,win_mode:'first-hit'},entry:{kind:'free'},access:{vault_mode:'simulated'},admission:{player_cap:1,min_ready_to_start:1},rewards:{kind:'funded-assets'}},publicState:{template:'number-hunt',finished:true},settlement:{roundId:'0x'+'34'.repeat(32),results:[{who:me,score:100,rank:1,eligible:true}],allocations:[],merkleRoot:'0x'+'00'.repeat(32),allocationsHash:'0x'+'00'.repeat(32),transcriptHash:'0x'+'00'.repeat(32),deadline:claim.deadline}}
 await page.route('**/api/center/v1/rooms/phase-f-fixture',r=>r.fulfill({json:room}))
 await page.route('**/wallet/rewards?*',r=>r.fulfill({json:{rewards:[{...claim,payable:false,reason:'Waiting for the creator to confirm the winner allocation.'}]}}))
 await page.route('**/api/center/v1/rooms/phase-f-fixture/reward-plan',r=>r.fulfill({json:{plan:{poolId:'7',engine:claim.engine,mode:'auto',settled:true,allocationCount:0,allocations:[{winner:me,assetIndex:0,amount:'1000',allocated:false}]}}}))
 await page.goto(`${base}/center/rooms/phase-f-fixture`)
 await page.getByRole('heading',{name:'My rewards',exact:true}).waitFor()
 await page.getByText('Waiting for the creator to confirm the winner allocation.',{exact:true}).waitFor()
 assert(await page.getByRole('button',{name:'Claim now',exact:true}).isDisabled())
 assert(await page.getByRole('button',{name:'Confirm allocations in wallet',exact:true}).isEnabled())
 }
 assert.deepEqual(errors,[]);evidence.push({width,wizard:true,rewards:true,codeCopy:true,codeLookup:true,noOverflow:true,transactionsSent:0});await page.close()
 }
 console.log(JSON.stringify(evidence));require('node:fs').writeFileSync('/tmp/orbix-phase-f-browser.json',JSON.stringify(evidence,null,2))
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
