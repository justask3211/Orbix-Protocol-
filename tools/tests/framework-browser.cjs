const {chromium}=require(process.env.ORBIX_PLAYWRIGHT_MODULE||'/tmp/orbix-browser-tools/node_modules/playwright')
const assert=require('node:assert/strict'),fs=require('node:fs/promises')
const stage=process.argv[2]||'after',base=process.env.ORBIX_REVIEW_URL||'http://127.0.0.1:5191/center/framework-review.html'
;(async()=>{
 await fs.mkdir('tools/tests/evidence/rst',{recursive:true})
 const browser=await chromium.launch({args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 try {
  const page=await browser.newPage({viewport:{width:960,height:640}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message));await page.goto(base)
  await page.waitForFunction(()=>window.orbixReview?.stats.ready,{},{timeout:60000});await page.waitForTimeout(2500)
  await page.screenshot({path:`tools/tests/evidence/rst/${stage}.png`,timeout:60000})
  await page.evaluate(()=>window.orbixReview.stats.frames.length=0);await page.waitForTimeout(10000)
  const stats=await page.evaluate(()=>{const s=window.orbixReview.stats,frames=s.frames.slice().sort((a,b)=>a-b);return {samples:frames.length,p50:frames[Math.floor(frames.length*.5)],p95:frames[Math.floor(frames.length*.95)],calls:s.calls,triangles:s.triangles}})
  assert.deepEqual(errors,[]);assert(stats.samples>=5,'Need at least five measured rendered intervals, not a synthetic FPS gate')
  await fs.writeFile(`tools/tests/evidence/rst/${stage}.json`,JSON.stringify({stage,viewport:[960,640],dpr:1,shadows:false,renderer:'Chromium SwiftShader',fixture:'two actors, fixed public field-v1 state; excludes network',...stats,errors},null,2))
  console.log(stage,stats)
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
