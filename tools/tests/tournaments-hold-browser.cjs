const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'../game-lab/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('orbix.wallet.key','0x'+'ab'.repeat(32));localStorage.setItem('orbix.wallet.kind','generated')});
 const base=process.env.ORBIX_BASE_URL||'http://127.0.0.1:8108';
 await page.goto(base+'/center/join');await page.getByRole('heading',{name:'Play for the podium.'}).waitFor();await page.getByRole('heading',{name:'Tournament test'}).waitFor();
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
 await page.goto(base+'/center/admin');await page.getByRole('heading',{name:'ORBIX holding requirements & promotion'}).waitFor();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Admin overflow');
 assert.deepEqual(errors,[]);console.log('PASS: tournament join, wizard, holding modal, admin controls; 390px reduced motion');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)})
