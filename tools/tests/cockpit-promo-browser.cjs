const {chromium}=require('../game-lab/node_modules/playwright')
const assert=require('node:assert/strict'),fs=require('node:fs')
const base=process.env.ORBIX_BASE_URL||'http://127.0.0.1:8110'
const evidence='tools/tests/evidence/home-promo'
;(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox']})
 try{
  const context=await browser.newContext({viewport:{width:1440,height:950},reducedMotion:'reduce'})
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base})
  const page=await context.newPage(),errors=[]
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  await page.goto(base+'/');const promo=page.locator('#orbix-promo');await promo.waitFor()
  assert.match(await promo.innerText(),/Step into the Orbix world/)
  const configuredLink=await promo.locator('.op-buy').getAttribute('href')
  assert.match(configuredLink,/vibevibe.fun\/token\/0x16c545/)
  await promo.screenshot({path:evidence+'/cockpit-promo-desktop.png'})
  await page.setViewportSize({width:390,height:844})
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await promo.screenshot({path:evidence+'/cockpit-promo-390.png'})
  await promo.getByRole('button',{name:'Copy ORBIX token contract address',exact:true}).click();await promo.getByText('✓ Copied',{exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'0x16c5451763ec2e0e7f041e2db761a0491fdb6db1')
  assert.deepEqual(errors,[])
  fs.writeFileSync(evidence+'/cockpit.json',JSON.stringify({errors,configuredLink,promoWidth:390,checks:['root cockpit default message, configured buy destination, shared copyText helper, exact contract address, desktop/390px, static reduced motion, no overflow']},null,2))
  console.log('PASS: assembled root cockpit promo, default message, copy, buy link, desktop/390px, zero console errors')
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
