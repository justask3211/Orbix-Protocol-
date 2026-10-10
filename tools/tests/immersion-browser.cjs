const fs=require('node:fs'),path=require('node:path')
const fixture=path.resolve(__dirname,'../../web/__immersion-fixture')
fs.writeFileSync(fixture+'.html',fs.readFileSync(path.join(__dirname,'immersion-fixture.html'),'utf8'))
fs.writeFileSync(fixture+'.tsx',fs.readFileSync(path.join(__dirname,'immersion-fixture.tsx'),'utf8').replaceAll('../../web/','./'))
const assert=require('node:assert/strict')
const {chromium}=require(process.env.ORBIX_PLAYWRIGHT_MODULE||'/tmp/orbix-browser-tools/node_modules/playwright')
;(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 try{
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:1280,height:800}]){
   const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.emulateMedia({reducedMotion:'reduce'})
   await page.addInitScript(()=>{Element.prototype.requestFullscreen=function(){window.gestureAtRequest=navigator.userActivation.isActive;return Promise.reject(new Error('fixture denial'))}})
   await page.goto('http://localhost:5181/center/__immersion-fixture.html')
   await page.getByRole('button',{name:'Start game',exact:true}).click()
   await page.getByText('Browser fullscreen unavailable. Immersive view is active.',{exact:true}).waitFor()
   assert(await page.evaluate(()=>window.gestureAtRequest),'native request must occur during gesture')
   const root=await page.locator('.ct-round-container').boundingBox();assert.equal(Math.round(root.width),viewport.width);assert.equal(Math.round(root.height),viewport.height)
   const exit=await page.getByRole('button',{name:'↙ Minimize',exact:true}).boundingBox();assert(exit.x>=0&&exit.y>=0&&exit.x+exit.width<=viewport.width&&exit.y+exit.height<=viewport.height)
   assert.equal(await page.locator('.ct-round-content').getAttribute('inert'),null)
   assert.equal(await page.locator('.gp-move').count(),3)
   for(let cycle=0;cycle<20;cycle++){await page.getByRole('button',{name:'↙ Minimize',exact:true}).click();assert.equal(await page.evaluate(()=>document.body.style.overflow),'');await page.getByRole('button',{name:'Resume game',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-mode="css-immersive"]'))}
   await page.getByRole('button',{name:'↙ Minimize',exact:true}).click()
   for(const game of await page.getByLabel('Game',{exact:true}).locator('option').evaluateAll(options=>options.map(o=>o.value))){
    await page.getByLabel('Game',{exact:true}).selectOption(game);await page.getByRole('button',{name:'Resume game',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-mode="css-immersive"]'))
    assert(await page.getByRole('button',{name:'↙ Minimize',exact:true}).isVisible(),game+' minimizes');
    if(game==='number-hunt'){await page.getByRole('button',{name:'Open hint desk',exact:true}).click();assert(await page.locator('.ct-round-container [role="dialog"]').isVisible());await page.getByRole('button',{name:'Close hint desk',exact:true}).click()}
await page.getByRole('button',{name:'↙ Minimize',exact:true}).click()
   }
   assert.deepEqual(errors,[]);await page.close()
  }
  const native=await browser.newPage({viewport:{width:1000,height:700}})
  await native.goto('http://localhost:5181/center/__immersion-fixture.html');await native.getByRole('button',{name:'Start game',exact:true}).click()
  await native.waitForFunction(()=>document.fullscreenElement===document.querySelector('.ct-round-container'))
  await native.getByRole('button',{name:'↙ Minimize',exact:true}).click();await native.waitForFunction(()=>!document.fullscreenElement)
  assert.equal(await native.evaluate(()=>document.body.style.overflow),'');await native.close()
  console.log('PASS: gesture-before-request, refusal, edge-to-edge, portrait input, all registered stages, 20-cycle scroll/focus restoration at four viewports. Native device support/keyboard/notches are separate acceptance checks.')
 }finally{await browser.close();fs.unlinkSync(fixture+'.html');fs.unlinkSync(fixture+'.tsx')}
})().catch(e=>{console.error(e);process.exitCode=1})
