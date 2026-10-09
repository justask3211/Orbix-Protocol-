/* Actual local authoritative practice API and software WebGL, no wallet or funds. */
const {chromium}=require(process.env.ORBIX_PLAYWRIGHT_MODULE||'/tmp/orbix-browser-tools/node_modules/playwright')
const assert=require('node:assert/strict'),fs=require('node:fs/promises')
const base=process.env.ORBIX_BASE_URL||'http://127.0.0.1:8099'
;(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 try{
 const evidence=[]
 for(const game of ['combat-duel','boss-raid','token-catch']){
  console.log('Checking '+game)
  const context=await browser.newContext({viewport:{width:1200,height:850}}),page=await context.newPage(),errors=[]
  let latest=null,moves=0,jumps=0
  page.on('pageerror',e=>errors.push(e.message))
  page.on('response',async r=>{if(!r.url().includes('/practice'))return;try{const data=await r.json();if(data.state)latest=data;if(data.ok&&r.request().method()==='POST'){const kind=r.request().postDataJSON()?.action?.kind;if(kind==='move')moves++;if(kind==='jump')jumps++}}catch{}})
  await page.addInitScript(()=>{window.sawWorldLoading=false;new MutationObserver(()=>{if(document.querySelector('.ow-loading'))window.sawWorldLoading=true}).observe(document,{childList:true,subtree:true})})
  await page.goto(base+'/center/practice/'+game,{waitUntil:'domcontentloaded'})
  await page.locator('.gp-arena').waitFor({timeout:30000})
  await page.waitForFunction(()=>!document.querySelector('.ow-loading'),{},{timeout:45000})
  assert(await page.evaluate(()=>window.sawWorldLoading),game+' needs a loading stage')
  await page.getByRole('button',{name:'Restart practice'}).click();await page.waitForTimeout(900)
  const start=latest.state.bodies[latest.me].z
  await page.locator('.gp-arena').focus();await page.keyboard.down('w');await page.waitForTimeout(500);await page.keyboard.press('Space');await page.waitForTimeout(180);await page.keyboard.up('w');await page.waitForTimeout(750)
  assert(moves>0&&jumps>0,game+' authoritative movement/jump');assert(Math.abs(latest.state.bodies[latest.me].z-start)>.5)
  assert.equal(latest.state.worldVersion,4);assert.equal(await page.getByText('The 3D view is unavailable.',{exact:false}).isVisible(),false)
  assert.deepEqual(errors,[])
  // A live canvas need not become layout-stable for locator.screenshot's scroll step.
  const bounds=await page.locator('.ow-world').boundingBox()
  assert(bounds)
  await page.screenshot({path:'/tmp/orbix-mno-'+game+'.png',clip:bounds})
  console.log(game+': loading, rendering, movement and jump passed')
  evidence.push({game,worldVersion:latest.state.worldVersion,loading:true,acceptedMovement:true,acceptedJump:true,pageErrors:errors,renderer:'Chromium SwiftShader; no physical-device FPS claim'})
  await context.close()
 }
 await fs.writeFile('/tmp/orbix-mno-worlds.json',JSON.stringify(evidence,null,2));console.log('PASS: all three V4 worlds render, load visibly, accept server movement/jump, and exit cleanly with zero page errors.')
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
