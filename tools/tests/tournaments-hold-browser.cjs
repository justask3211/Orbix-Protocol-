const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'../game-lab/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('orbix.wallet.key','0x'+'ab'.repeat(32));localStorage.setItem('orbix.wallet.kind','generated')});
 const base=process.env.ORBIX_BASE_URL||'http://127.0.0.1:8108';
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});
 await page.goto(base+'/center/join');
 const promo=page.locator('#orbix-promo');await promo.waitFor();
 assert.match(await promo.locator('a').getAttribute('href'),/vibevibe.fun\/token\/0x16c545/);
 assert.equal(await promo.locator('a').evaluate(e=>getComputedStyle(e).animationName),'none');
 await promo.getByRole('button',{name:'Copy ORBIX token contract address',exact:true}).click();
 await promo.getByText('✓ Copied',{exact:true}).waitFor();
 await promo.getByRole('button',{name:'Dismiss ORBIX promotion for this session',exact:true}).click();
 await page.reload();assert.equal(await page.locator('#orbix-promo').count(),0);
await page.getByRole('heading',{name:'Play for the podium.'}).waitFor();await page.getByRole('heading',{name:'Tournament test'}).waitFor();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Join overflow');
 await page.getByRole('button',{name:'View bracket',exact:true}).click();await page.getByRole('heading',{name:'Tournament test',exact:true}).waitFor();
 if(!await page.getByText('You are registered.',{exact:false}).count()){await page.getByRole('checkbox').first().check();await page.getByRole('button',{name:'Join tournament',exact:true}).click();
 await page.getByRole('heading',{name:'You hold the required amount',exact:true}).waitFor();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByText('You are registered.',{exact:false}).waitFor();}
 await page.goto(base+'/center/create/reaction-duel?tournament=1');
 const continueButton=page.getByRole('button',{name:'Continue',exact:true});
 for(let i=0;i<2;i++){await continueButton.click();}
 await page.getByRole('heading',{name:'Tournament setup',exact:true}).waitFor();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Wizard overflow');
 await page.screenshot({path:'/tmp/orbix-tournaments-390.png',fullPage:true});
 await page.goto(base+'/center/create/reaction-duel');for(let i=0;i<2;i++)await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByText('I pay all ORBIX joiner fees',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Publish room',exact:true}).click();await page.getByRole('heading',{name:'You hold the required amount',exact:true}).waitFor();await page.screenshot({path:'/tmp/orbix-hold-check-390.png'});await page.getByRole('button',{name:'Close',exact:true}).click();
 const tokenInput=page.getByPlaceholder('0x… paste any ERC-20 contract address');
 assert.equal(await tokenInput.isDisabled(),true,'Sponsor opt-in must precede token selection');
 await page.getByRole('checkbox',{name:'I pay all ORBIX joiner fees',exact:false}).focus();await page.keyboard.press('Space');
 await tokenInput.fill('0x'+'22'.repeat(20));
 await page.getByRole('radio',{name:'Hold',exact:false}).focus();await page.keyboard.press('Space');
 await page.getByRole('spinbutton',{name:'Required holding (whole tokens)',exact:false}).fill('10');
 assert.equal(await page.getByRole('button',{name:'Publish room',exact:true}).isDisabled(),false);
 await page.route('**/hold-check',async route=>{await new Promise(r=>setTimeout(r,500));await route.fulfill({json:{passed:false,checks:[{token:'0x'+'22'.repeat(20),symbol:'entry token',required:'10',balance:'2',passed:false}],buy_link:'https://testnet.vibevibe.fun/token/0x16c5451763ec2e0e7f041e2db761a0491fdb6db1',orbix_token:'0x16c5451763ec2e0e7f041e2db761a0491fdb6db1'}})});
 await page.getByRole('button',{name:'Publish room',exact:true}).click();
 await page.getByRole('heading',{name:'Checking ORBIX token hold…',exact:true}).waitFor();
 await page.getByRole('heading',{name:'Insufficient balance',exact:true}).waitFor();
 assert.match(await page.getByRole('link',{name:'Buy ORBIX',exact:true}).getAttribute('href'),/vibevibe.fun\/token\/0x16c545/);
 await page.screenshot({path:'/tmp/orbix-hold-failure-390.png'});
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.goto(base+'/center/admin');await page.getByRole('heading',{name:'ORBIX holding requirements & promotion'}).waitFor();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Admin overflow');
 assert.deepEqual(errors,[]);console.log('PASS: tournament join/wizard, sponsor opt-in, pass/fail holding modals, buy link, promo copy/dismiss/reduced motion, admin controls; 390px');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)})
