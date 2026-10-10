const {chromium}=require(process.env.ORBIX_PLAYWRIGHT_MODULE||'/tmp/orbix-browser-tools/node_modules/playwright')
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path')
;(async()=>{const browser=await chromium.launch({args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{
 const page=await browser.newPage({viewport:{width:640,height:640}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.route('**/__wardrobe_review__',route=>route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'wardrobe-render.html'),'utf8')}))
 await page.goto('http://localhost:5181/center/__wardrobe_review__');await page.waitForFunction(()=>window.ready,{},{timeout:60000})
 fs.mkdirSync('/tmp/orbix-wardrobe-review',{recursive:true});fs.mkdirSync('web/public/center-models/wardrobe',{recursive:true})
 for(const outfit of (process.env.ORBIX_WARDROBE_OUTFIT?[process.env.ORBIX_WARDROBE_OUTFIT]:['overalls','rain-jacket','festival-jacket','tunic','dress-sun','dress-festival'])){
  const meta=await page.evaluate(outfit=>window.review.show('cat',outfit,'Idle'),outfit);assert(meta.textures.length===2)
  await page.screenshot({path:'/tmp/orbix-wardrobe-review/'+outfit+'.png'})
  const data=await page.evaluate(()=>window.review.export());fs.writeFileSync('web/public/center-models/wardrobe/cat-'+outfit+'.glb',Buffer.from(data))
  await page.evaluate(outfit=>window.review.show('turtle',outfit,'OrbixSeatedIdle',true),outfit);await page.screenshot({path:'/tmp/orbix-wardrobe-review/turtle-'+outfit+'.png'})
 }
 assert.deepEqual(errors,[]);console.log('PASS: six textured silhouettes in Three.js, full and seated/LOD rendering; six reference GLB exports. Actual phone GPU/performance and every accessory intersection need device review.')
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1})
