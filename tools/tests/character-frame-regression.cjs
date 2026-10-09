/* Render production layered rigs with real WebGL. Every catalog character/state is captured.
 * Use the local Vite server at port 5188; software GPU evidence, not phone performance. */
const {chromium}=require(process.env.ORBIX_PLAYWRIGHT_MODULE||'/tmp/orbix-browser-tools/node_modules/playwright')
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const ids=['cat','turtle','blob','knight','cat-blob','duckling','astronaut','toy-robot','pancake','jelly-ninja','sprout','marshmallow']
const out=process.env.ORBIX_FRAME_DIR||'/tmp/orbix-q-frames'
;(async()=>{fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{
 const page=await browser.newPage({viewport:{width:960,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
 await page.route('**/__character_review__',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync('tools/tests/character-render.html','utf8')}));await page.goto('http://127.0.0.1:5188/center/__character_review__');await page.waitForFunction(()=>window.ready,{},{timeout:45000})
 const evidence=[]
 for(const id of ids){
  for(const clip of ['Idle','Walk','Run','Sprint','JumpLoop','PunchCross','Death']){
   const meta=await page.evaluate(({id,clip})=>window.review.show(id,clip,.35),{id,clip});assert.equal(meta.layers.lower.clip,clip+':lower');assert.equal(meta.layers.upper.clip,clip+':upper');assert(meta.triangles<25000&&meta.groups<=5,'Near geometry/material budget')
   const file=`${id}-${clip}.png`;await page.screenshot({path:path.join(out,file)});evidence.push({character:id,clip,file,...meta})
  }
  await page.evaluate(id=>window.review.show(id,'PunchCross',1.2),id)
  const active=await page.evaluate(()=>window.review.transition('Run'))
  assert(active.length===2&&active.every(a=>a.clip.startsWith('Run:')),id+': stale combat after run transition')
 }
 await page.evaluate(()=>window.review.show('turtle','Idle',.35));await page.evaluate(()=>window.review.turn(Math.PI));await page.screenshot({path:path.join(out,'turtle-shell.png')})
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'frames.json'),JSON.stringify({captureDirectory:out,renderer:'Chromium SwiftShader; physical devices untested',cases:evidence,pageErrors:errors},null,2));console.log(`PASS: ${evidence.length} production layered-rig frame captures, 12 characters, correct clips/states, combat→run reset and zero browser/shader errors.`)
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1})
