/* Real local practice state + touch/fullscreen flow. No wallet or transaction. */
const {chromium}=require(process.env.ORBIX_PLAYWRIGHT_MODULE||'/tmp/orbix-browser-tools/node_modules/playwright')
const fs=require('node:fs/promises'),assert=require('node:assert/strict'),base=process.env.ORBIX_BASE_URL||'http://127.0.0.1:8099'
;(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},screen:{width:844,height:390},deviceScaleFactor:1,isMobile:true,hasTouch:true,reducedMotion:'reduce'}),page=await context.newPage(),errors=[],accepted=[]
 page.on('pageerror',e=>errors.push(e.message));page.on('response',async r=>{if(!r.url().includes('/actions'))return;try{const data=await r.json();if(data.ok)accepted.push(r.request().postDataJSON()?.action?.kind)}catch{}})
 await page.goto(base+'/center/practice/token-catch',{waitUntil:'domcontentloaded'})
 await page.getByRole('heading',{name:'Rotate your phone'}).waitFor({timeout:60000})
 assert(await page.locator('.ct-round-content').getAttribute('inert')!==null)
 await page.setViewportSize({width:844,height:390})
 await page.getByRole('button',{name:'Enter game',exact:true}).click()
 await page.waitForFunction(()=>!document.querySelector('.ow-loading'),{},{timeout:90000})
 await page.waitForFunction(()=>document.fullscreenElement||document.querySelector('.ct-fullscreen-notice'),{},{timeout:60000})
 assert(await page.getByRole('button',{name:'Exit fullscreen',exact:true}).isVisible())
 assert.equal(await page.locator('.ow-quality select').inputValue(),'fast')
 const before=await page.locator('canvas').boundingBox();assert(before&&before.width>300)
 const stick=await page.locator('.ar-joystick').boundingBox(),touch=await context.newCDPSession(page);assert(stick)
 const sx=stick.x+stick.width/2,sy=stick.y+stick.height/2
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:sx,y:sy}]});await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:sx+25,y:sy}]});await page.waitForTimeout(400);await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
 await page.locator('.ar-touch-actions').getByRole('button',{name:'Jump',exact:true}).click();await page.waitForTimeout(500)
 await page.locator('.ar-touch-actions').getByRole('button',{name:'Dodge',exact:true}).click();await page.waitForTimeout(500)
 await page.getByRole('button',{name:'Switch to first person camera',exact:true}).click();await page.waitForTimeout(600)
 await page.getByRole('button',{name:'Switch to third person camera',exact:true}).click()
 await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click()
 await page.waitForFunction(()=>!document.fullscreenElement&&!document.querySelector('.ct-native-game'))
 await page.getByRole('button',{name:'Play fullscreen',exact:true}).click()
 await page.waitForFunction(()=>document.querySelector('.ct-native-game')&&(document.fullscreenElement||document.querySelector('.ct-fullscreen-notice')))
 await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click()
 await page.waitForFunction(()=>!document.fullscreenElement&&!document.querySelector('.ct-native-game'))
 // Emulated fullscreen screen matches the landscape phone; viewport starts portrait.
 // Metrics include slow software frames and the resolution fallback.
 await page.setViewportSize({width:844,height:390});await page.waitForFunction(()=>!matchMedia('(orientation: portrait)').matches)
 const restarted=page.waitForResponse(r=>r.url().endsWith('/api/center/v1/practice')&&r.request().method()==='POST');await page.getByRole('button',{name:'Restart practice',exact:true}).click();await restarted
 await page.getByRole('button',{name:'Enter game',exact:true}).waitFor({timeout:60000});await page.getByRole('button',{name:'Enter game',exact:true}).click()
 await page.waitForFunction(()=>document.querySelector('canvas')&&!document.querySelector('.ow-loading'),{},{timeout:90000})
 await page.waitForFunction(()=>!document.querySelector('.ct-orientation-prompt'),{},{timeout:60000})
 await page.getByLabel('Frame performance').waitFor({timeout:60000});await page.getByLabel('Frame performance').click();await page.waitForFunction(()=>document.querySelector('.ow-performance')?.open)
 const jumps=accepted.filter(kind=>kind==='jump').length
 await page.getByLabel('Frame performance').press('Space');await page.waitForFunction(()=>!document.querySelector('.ow-performance')?.open)
 await page.getByLabel('Frame performance').press('Space');await page.waitForFunction(()=>document.querySelector('.ow-performance')?.open)
 assert.equal(accepted.filter(kind=>kind==='jump').length,jumps,'Disclosure keyboard activation must not jump')
 assert(await page.locator('.ow-performance>div').evaluate(e=>{const r=e.getBoundingClientRect();return Boolean(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.ow-performance'))}),'Open readout must render above touch controls')
 const assets=await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>/\/center\/(?:assets|center-models)\//.test(r.name)).map(r=>({url:new URL(r.name).pathname,encodedBytes:r.encodedBodySize,transferBytes:r.transferSize,durationMs:r.duration})))
 const readout=await page.locator('.ow-performance').innerText()
 await fs.mkdir('tools/tests/evidence/rst',{recursive:true})
 await page.screenshot({path:'tools/tests/evidence/rst/mobile.png',timeout:90000})
 assert.deepEqual(errors,[]);assert(accepted.includes('move')&&accepted.includes('jump')&&accepted.includes('dodge'),JSON.stringify(accepted))
 await fs.writeFile('tools/tests/evidence/rst/mobile.json',JSON.stringify({viewport:[844,390],portraitGate:true,inertGate:true,landscapeEntry:true,fullscreenEntryExitTwice:true,fastQuality:true,reducedMotion:true,firstThirdPerson:true,restartReady:true,accepted,readout,assets,selectedAssetEncodedBytes:assets.reduce((sum,r)=>sum+r.encodedBytes,0),pageErrors:errors,renderer:'Chromium SwiftShader; touch emulation, no phone FPS/thermal claim'},null,2))
 await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click();await context.close()
 console.log('PASS: portrait gating, landscape touch entry, fullscreen twice, fast quality, reduced motion, accepted jump/dodge, first/third-person and honest metrics')
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
