// Repeated actual world teardown: cached GLBs may persist; owned scene resources must release.
const {chromium}=require(process.env.ORBIX_PLAYWRIGHT_MODULE||'/tmp/orbix-browser-tools/node_modules/playwright')
const fs=require('node:fs/promises'),assert=require('node:assert/strict')
;(async()=>{const b=await chromium.launch({args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{
 const p=await b.newPage({viewport:{width:640,height:420}}),errors=[];p.on('pageerror',e=>errors.push(e.message))
 await p.goto(process.env.ORBIX_REVIEW_URL||'http://127.0.0.1:5191/center/framework-review.html');await p.waitForFunction(()=>window.orbixReview?.stats.ready,{},{timeout:90000})
 const memory=()=>p.evaluate(()=>({geometries:window.orbixReview.stats.geometries,textures:window.orbixReview.stats.textures}))
 const cycles=[]
 for(let i=0;i<5;i++){
  await p.evaluate(()=>window.orbixReview.mount(false));await p.waitForFunction(()=>window.orbixReview.stats.geometries<=3,{},{timeout:60000});const unmounted=await memory()
  await p.evaluate(()=>window.orbixReview.mount(true));await p.waitForFunction(()=>window.orbixReview.stats.geometries>20,{},{timeout:60000});const mounted=await memory();cycles.push({unmounted,mounted})
 }
 assert(cycles.at(-1).unmounted.geometries<=cycles[0].unmounted.geometries+2,'Owned geometry grows after exits')
 assert(cycles.at(-1).unmounted.textures<=cycles[0].unmounted.textures+1,'Owned textures grow after exits')
 assert(cycles.every(c=>c.mounted.geometries>20),'Every measurement must follow an actual remount')
 assert(cycles.at(-1).mounted.geometries<=cycles[0].mounted.geometries+2,'Mounted resources grow after exits')
 // A fixture supplies confirmed HP changes for visual inspection only, never server damage.
 await p.evaluate(()=>{const r=window.orbixReview,s=r.state;r.update({tick:s.tick+1,bodies:{...s.bodies,local:{...s.bodies.local,hp:73}},boss:{x:3,z:4,y:0,hp:100,maxHp:100,phase:1},events:[]})})
 await p.waitForTimeout(1000)
 await p.evaluate(()=>{const r=window.orbixReview,s=r.state;r.update({tick:s.tick+1,boss:{...s.boss,hp:68},bodies:{...s.bodies,friend:{...s.bodies.friend,hp:85}}})})
 await p.screenshot({path:'tools/tests/evidence/rst/health.png',timeout:90000})
 assert.deepEqual(errors,[]);await fs.writeFile('tools/tests/evidence/rst/lifecycle.json',JSON.stringify({cycles,pageErrors:errors,fixture:'real mounted V4 scene; synthetic published-HP display signals only; no authority claim',cachedGLBs:'retained intentionally by useLoader; this checks renderer counts, not total heap/VRAM'},null,2))
 console.log('PASS: five real V4 scene exits/reentries, bounded renderer geometry/texture counts and shared player/boss health rendering')
 }finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1})
