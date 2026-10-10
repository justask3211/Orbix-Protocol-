/* Real Babylon/Havok + legacy comparison, local authority and touch/fullscreen.
 * ORBIX_BASE_URL uses the built SPA/API; ORBIX_REVIEW_ORIGIN uses Vite fixtures. */
const {chromium}=require(process.env.ORBIX_PLAYWRIGHT_MODULE||'/tmp/orbix-browser-tools/node_modules/playwright')
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os')
const base=process.env.ORBIX_BASE_URL||'http://127.0.0.1:8099',review=process.env.ORBIX_REVIEW_ORIGIN||'http://127.0.0.1:5191',dir='tools/tests/evidence/babylon'
const summarize=frames=>{const s=frames.slice().sort((a,b)=>a-b);return{samples:s.length,p50:s[Math.floor(s.length*.5)],p95:s[Math.floor(s.length*.95)],max:s.at(-1)}}
;(async()=>{
 await fs.mkdir(dir,{recursive:true})
 const browser=await chromium.launch({args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 const evidence={date:'2026-10-10',browser:browser.version(),cpu:os.cpus()[0].model,renderer:'Chromium SwiftShader, Linux; no physical phone/GPU performance claim',fixtures:[],practice:[]}
 const scope=process.env.ORBIX_BABYLON_SCOPE||'all'
 if(scope==='practice'||scope==='measure'||process.env.ORBIX_BABYLON_SKIP_THREE){const previous=JSON.parse(await fs.readFile(`${dir}/browser.json`));Object.assign(evidence,previous);if(scope==='measure')evidence.fixtures=[];else if(scope!=='practice')evidence.fixtures=previous.fixtures.filter(item=>item.engine==='three');else evidence.practice=[]}
 try{
  for(const engine of scope==='practice'?[]:process.env.ORBIX_BABYLON_SKIP_THREE?['babylon']:['three','babylon']){
   console.log('Starting',engine,'fixture')
   const page=await browser.newPage({viewport:{width:960,height:640},deviceScaleFactor:1}),errors=[]
   page.on('pageerror',e=>{errors.push(e.message);console.log('Browser error:',e.message)})
   await page.goto(`${review}/center/${engine==='three'?'framework':'babylon'}-review.html`,{waitUntil:'domcontentloaded'})
   await page.waitForFunction(engine==='three'?()=>window.orbixReview?.stats.ready:()=>window.orbixBabylon?.ready,{},{timeout:90000})
   await page.waitForTimeout(2500)
   await page.evaluate(engine=>{(engine==='three'?window.orbixReview.stats.frames:window.orbixBabylon.frames).length=0},engine)
   await page.waitForTimeout(10000)
   const metrics=await page.evaluate(engine=>engine==='three'?{frames:window.orbixReview.stats.frames,calls:window.orbixReview.stats.calls,triangles:window.orbixReview.stats.triangles}:{frames:window.orbixBabylon.frames,calls:window.orbixBabylon.stats.calls,triangles:window.orbixBabylon.stats.triangles,dpr:window.orbixBabylon.stats.dpr,loadMs:window.orbixBabylon.loadMs},engine)
   const {frames,...other}=metrics;assert(frames.length>=5,'Need observed rendered intervals');assert.deepEqual(errors,[])
   evidence.fixtures.push({engine,viewport:[960,640],dpr:1,shadows:false,state:'same reviewState.ts, two actors, one pile; no network',...summarize(frames),...other,errors})
   await fs.writeFile(`${dir}/browser.json`,JSON.stringify(evidence,null,2)+'\n')
   await page.screenshot({path:`${dir}/fixture-${engine}.png`,timeout:90000})
   if(engine==='babylon'&&scope!=='measure'){
    const physics=await page.evaluate(()=>window.orbixBabylonReview.physics());assert(physics.maxHeight>.15&&physics.x>2&&physics.x<3.3,'Capsule must climb low step and stop at tall wall');evidence.physics=physics
    const groups=await page.evaluate(()=>[...window.orbixBabylon.actors.values()].map(slot=>({clips:slot.actor.entries.animationGroups.length,layers:slot.actor.animation.layers.size,skinned:slot.actor.entries.rootNodes.flatMap(root=>root.getChildMeshes()).some(mesh=>!!mesh.skeleton)})))
    assert(groups.every(actor=>actor.clips===20&&actor.layers===40&&actor.skinned));evidence.animations=groups
    await page.evaluate(()=>{const f=window.orbixBabylonReview,s=f.state;f.update({tick:1,serverTimeMs:10100,bodies:{...s.bodies,local:{...s.bodies.local,hp:75,shieldUntil:20000,weapon:'gun',lastAttackAt:10100,lastAttackWeapon:'gun'}},events:[{id:1,kind:'pickup-coin',x:-3,z:10,at:1000}]})})
    await page.waitForFunction(()=>window.orbixBabylon.actors.get('local').actor.barFill.scaling.x===.75)
    const feedback=await page.evaluate(()=>{const actor=window.orbixBabylon.actors.get('local').actor;return{health:actor.barFill.scaling.x,shield:actor.shield.isEnabled(),sparks:window.orbixBabylon.scene.meshes.filter(mesh=>mesh.name==='pickup-spark').length,upper:actor.animation.machine.previous.weapon}})
    assert.equal(feedback.health,.75);assert(feedback.shield);evidence.feedback=feedback
    await page.evaluate(()=>{const f=window.orbixBabylonReview;f.update({drops:Array.from({length:400},(_,i)=>({id:`pile-${i}`,x:-8+i%20*.5,z:4+Math.floor(i/20)*.5,y:0,kind:'coin',spawnAt:0,landAt:1}))})})
    await page.waitForFunction(()=>window.orbixBabylon.scene.getMeshByName('instanced-coin-coin').thinInstanceCount===400)
    const instance=await page.evaluate(()=>({coins:window.orbixBabylon.scene.meshes.filter(mesh=>mesh.name==='instanced-coin-coin').map(mesh=>mesh.thinInstanceCount),calls:window.orbixBabylon.stats.calls}))
    assert.deepEqual(instance.coins,[400]);assert(instance.calls<150);evidence.pickups400=instance
    const cycles=[]
    for(let i=0;i<3;i++){
     const disposal=await page.evaluate(async()=>{const old=window.orbixBabylon;await window.orbixBabylonReview.mount(false);return{sceneDisposed:old.scene.isDisposed,engineDisposed:old.runtime.engine.isDisposed,actors:old.actors.size,loops:old.runtime.engine._activeRenderLoops.length}})
     assert(disposal.sceneDisposed&&disposal.engineDisposed&&disposal.actors===0&&disposal.loops===0)
     await page.evaluate(()=>window.orbixBabylonReview.mount(true));await page.waitForFunction(()=>window.orbixBabylon?.ready,{},{timeout:90000})
     cycles.push({disposal,mounted:await page.evaluate(()=>({meshes:window.orbixBabylon.scene.meshes.length,materials:window.orbixBabylon.scene.materials.length,textures:window.orbixBabylon.scene.textures.length}))})
    }
    assert.deepEqual(cycles.at(-1).mounted,cycles[0].mounted);evidence.lifecycle=cycles
    await page.evaluate(async()=>{
     const fixture=window.orbixBabylonReview;await fixture.mount(false)
     window.originalBabylonBodies=fixture.state.bodies
     fixture.update({arena:false,lanes:5,nowMs:1000,recent:[{index:7,lane:1,atMs:900,points:5}],caughtIndices:{local:[]},lanesNow:{local:3}})
     await fixture.mount(true);window.classicActions=[]
     window.orbixBabylon.runtime.props.onLane=lane=>window.classicActions.push({lane})
     window.orbixBabylon.runtime.props.onCatch=spawn=>window.classicActions.push({spawn})
    })
    await page.waitForFunction(()=>window.orbixBabylon.ready&&window.orbixBabylon.scene.getMeshByName('lane-token-7-coin'))
    const coin=await page.evaluate(()=>{
     const scene=window.orbixBabylon.scene,mesh=scene.getMeshByName('lane-token-7-coin'),V=mesh.position.constructor
     const point=V.Project(new V(0,0,0),mesh.getWorldMatrix(),scene.getTransformMatrix(),scene.activeCamera.viewport.toGlobal(scene.getEngine().getRenderWidth(),scene.getEngine().getRenderHeight()))
     return{x:point.x,y:point.y}
    })
    await page.mouse.click(coin.x,coin.y);await page.waitForFunction(()=>window.classicActions.some(action=>action.spawn===7))
    assert.equal(await page.evaluate(()=>window.orbixBabylon.scene.getTransformNodeByName('server-confirmed-paddle').position.x),2)
    await page.evaluate(()=>window.orbixBabylonReview.update({caughtIndices:{local:[7]}}));await page.waitForFunction(()=>!window.orbixBabylon.scene.getMeshByName('lane-token-7-coin'))
    evidence.classic={publishedRecent:true,lanesNow:true,clickCatch:true,caughtIndicesRemoval:true}
    await page.evaluate(async()=>{const fixture=window.orbixBabylonReview;await fixture.mount(false);fixture.update({arena:true,bodies:{}});void fixture.mount(true)})
    await page.waitForFunction(()=>window.orbixBabylon.stage==='snapshot')
    assert.equal(await page.evaluate(()=>window.orbixBabylon.scene.getMeshByName('authoritative-field-v1')),null)
    await page.evaluate(()=>window.orbixBabylonReview.update({bodies:window.originalBabylonBodies}))
    await page.waitForFunction(()=>window.orbixBabylon.ready,{},{timeout:90000});evidence.lateFirstSnapshot=true
    assert.deepEqual(errors,[])
   }
   await fs.writeFile(`${dir}/browser.json`,JSON.stringify(evidence,null,2)+'\n')
   console.log(engine,'fixture',evidence.fixtures.at(-1));await page.close()
  }
  for(const mobile of ['fixtures','measure'].includes(scope)?[]:[false,true]){
   console.log('Starting',mobile?'mobile':'desktop','practice')
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:850},...(mobile?{screen:{width:844,height:390},isMobile:true,hasTouch:true,reducedMotion:'reduce'}:{}),deviceScaleFactor:1})
   const page=await context.newPage(),errors=[],consoleErrors=[],accepted=[],statuses=[]
   page.on('pageerror',e=>{errors.push(e.message);console.log('Browser error:',e.message)});page.on('console',m=>{if(m.type()==='error'){consoleErrors.push(m.text());console.log('Console error:',m.text())}})
   page.on('response',async r=>{if(!r.url().includes('/actions'))return;try{if((await r.json()).ok)accepted.push(r.request().postDataJSON()?.action?.kind)}catch{}})
   await page.addInitScript(()=>{window.babylonStages=[];new MutationObserver(()=>{const stage=document.querySelector('.ob-loading .is-current');if(stage&&!window.babylonStages.includes(stage.textContent))window.babylonStages.push(stage.textContent)}).observe(document,{childList:true,subtree:true})})
   await page.goto(`${base}/center/practice/token-catch?engine=babylon&evidence`,{waitUntil:'domcontentloaded'})
   if(mobile){
    await page.getByRole('heading',{name:'Rotate your phone'}).waitFor({timeout:60000});assert(await page.locator('.ct-round-content').getAttribute('inert')!==null)
    await page.screenshot({path:`${dir}/portrait-390.png`,timeout:90000})
    await page.setViewportSize({width:844,height:390});await page.getByRole('button',{name:'Enter game',exact:true}).click()
   }
   await page.waitForFunction(()=>window.orbixBabylon?.ready,{},{timeout:90000})
   assert.equal(await page.locator('.ow-world').getAttribute('data-renderer'),'babylon')
   await page.locator('.gp-arena').focus()
   if(mobile){
    assert.equal(await page.locator('.ow-quality select').inputValue(),'fast')
    const stick=await page.locator('.ar-joystick').boundingBox(),cdp=await context.newCDPSession(page),x=stick.x+stick.width/2,y=stick.y+stick.height/2
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+25,y}]});await page.waitForTimeout(500);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    await page.locator('.ar-touch-actions').getByRole('button',{name:'Jump',exact:true}).click();await page.waitForTimeout(500)
    await page.locator('.ar-touch-actions').getByRole('button',{name:'Dodge',exact:true}).click()
   }else{
    await page.keyboard.down('w');await page.waitForTimeout(450);await page.keyboard.press('Space');await page.keyboard.up('w');await page.waitForTimeout(600);await page.keyboard.press('r')
   }
   await page.getByRole('button',{name:'Switch to first person camera',exact:true}).click()
   await page.waitForFunction(()=>window.orbixBabylon.scene.activeCamera.name==='sunnydrop-first'&&window.orbixBabylon.scene.getTransformNodeByName('first-person-feedback').isEnabled(),{},{timeout:30000})
   await page.screenshot({path:`${dir}/${mobile?'mobile':'desktop'}-first-person.png`,timeout:90000})
   await page.getByRole('button',{name:'Switch to third person camera',exact:true}).click()
   await page.waitForFunction(()=>window.orbixBabylon.scene.activeCamera.name==='sunnydrop-follow')
   await page.waitForTimeout(10000)
   const frames=await page.evaluate(()=>window.orbixBabylon.frames),stats=await page.evaluate(()=>window.orbixBabylon.stats)
   assert(frames.length>=5);assert(accepted.includes('move')&&accepted.includes('jump')&&accepted.includes('dodge'),JSON.stringify(accepted))
   await page.screenshot({path:`${dir}/${mobile?'mobile':'desktop'}.png`,timeout:90000})
   if(!mobile)await page.getByRole('button',{name:'Play fullscreen',exact:true}).click()
   await page.waitForFunction(()=>document.fullscreenElement||document.querySelector('.ct-fullscreen-notice'))
   await page.screenshot({path:`${dir}/${mobile?'mobile':'desktop'}-fullscreen.png`,timeout:90000})
   const fullscreen=await page.evaluate(()=>!!document.fullscreenElement)
   await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click();await page.waitForFunction(()=>!document.fullscreenElement&&!document.querySelector('.ct-native-game'))
   const assets=await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>/\/center\/(?:assets|center-models)\//.test(r.name)).map(r=>({path:new URL(r.name).pathname,bytes:r.encodedBodySize,durationMs:r.duration})))
   assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[])
   evidence.practice.push({mobile,portrait:mobile?[390,844]:null,viewport:mobile?[844,390]:[1280,850],accepted:[...new Set(accepted)],fullscreen,...summarize(frames),stats,stages:await page.evaluate(()=>window.babylonStages),assets,selectedBytes:assets.reduce((n,r)=>n+r.bytes,0),errors,consoleErrors})
   console.log(mobile?'mobile':'desktop','practice passed');await context.close()
   await fs.writeFile(`${dir}/browser.json`,JSON.stringify(evidence,null,2)+'\n')
  }
  await fs.writeFile(`${dir}/browser.json`,JSON.stringify(evidence,null,2)+'\n')
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
