/* User correction: original home, active catalog, final collage and legacy promo. */
const {chromium}=require('../game-lab/node_modules/playwright')
const AxeBuilder=require('../game-lab/node_modules/@axe-core/playwright').default
const assert=require('node:assert/strict'),fs=require('node:fs')
const base=process.env.ORBIX_BASE_URL||'http://127.0.0.1:8110'
const evidence='tools/tests/evidence/home-correction'
const token='0x16c5451763ec2e0e7f041e2db761a0491fdb6db1'
const buy='https://testnet.vibevibe.fun/token/'+token
const template=(templateId,overrides={})=>({templateId,label:templateId,blurb:'A community game.',modes:'Arcade',version:1,multiplayer:true,availability:'preview',playStatus:'live',placement:'catalog',sort_order:0,available_modes:{create:true,join:true,practice:false,preview:false},...overrides})
const templates=[template('closest-call',{sort_order:-20}),template('word-forge'),template('prism-lines'),template('atlas-quest'),template('relic-auction',{tag:{enabled:true,text:'Coming soon',style:'solid'}}),template('reaction-duel',{overlay:{enabled:true,text:'Upcoming',color:'purple',position:'top-right'}}),template('token-catch',{placement:'more'}),template('boss-raid',{placement:'upcoming',overlay:{enabled:true,text:'80% built',color:'blue',position:'top-right'},tag:{enabled:true,text:'Squad play incoming',style:'solid'},available_modes:{create:false,join:false,practice:false,preview:true}}),template('combat-duel',{placement:'hidden',overlay:{enabled:true,text:'In development',color:'amber',position:'top-right'}}),template('number-hunt',{playStatus:'maintenance'})]
const report={errors:[],checks:[],a11y:[]}
async function settleArt(page){
 for(const image of await page.locator('.arcade-home img:visible').all()){await image.evaluate(el=>el.scrollIntoView({block:"center",behavior:"instant"}));await image.evaluate(el=>el.decode().catch(()=>{}))}
 await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(200)
}
;(async()=>{
 fs.mkdirSync(evidence,{recursive:true})
 const browser=await chromium.launch({args:['--no-sandbox']})
 try{
 const context=await browser.newContext({viewport:{width:1440,height:1050}})
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base})
 const page=await context.newPage()
 page.on('pageerror',e=>report.errors.push(e.message))
 page.on('console',msg=>{if(msg.type()==='error'&&!msg.text().includes('503 (Service Unavailable)'))report.errors.push(msg.text())})
 let policy={promo_enabled:true,promo_text:'Your next move starts with $ORBIX.',promo_link:buy,orbix_token:token}
 let failTemplates=false,emptyTemplates=false
 await context.route('**/api/center/v1/**',route=>{
  const path=new URL(route.request().url()).pathname
  if(path.endsWith('/orbix-policy'))return route.fulfill({json:policy})
  if(path.endsWith('/templates'))return route.fulfill(failTemplates?{status:503,json:{detail:'Temporary fixture outage'}}:{json:{templates:emptyTemplates?[]:templates,count:templates.length}})
  if(path.endsWith('/rooms'))return route.fulfill({json:{rooms:[]}})
  if(path.endsWith('/tournaments'))return route.fulfill({json:{tournaments:[]}})
  return route.fulfill({json:{live:false,profile:{},balance:0,simulated:true}})
 })
 await page.goto(base+'/center/')
 const promo=page.locator('#orbix-promo'),grid=page.locator('#games-tab-panel'),upcoming=page.locator('#arcade-coming')
 await grid.locator('.arcade-game').first().waitFor();await promo.waitFor()
 assert.equal(await grid.locator('.arcade-game').count(),5)
 assert.equal(await grid.getByRole('heading').first().textContent(),'Closest Call')
 assert.equal(await page.getByRole('heading',{name:'Your next round starts here.'}).count(),1)
 assert.equal(await page.locator('.arcade-primary-nav,.arcade-filter-toggle,.arcade-secondary-nav').count(),0)
 assert.equal(await page.locator('.arcade-hero').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(224, 247, 124)')
 assert.equal(await promo.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(55, 35, 86)')
 assert.equal(await upcoming.locator('.arcade-upcoming-tile').count(),5)
 assert.equal(await upcoming.locator('.gc-overlay').filter({hasText:'80% built'}).count(),1)
 assert.equal(await upcoming.getByText('Squad play incoming',{exact:true}).count(),1)
 assert.equal(await upcoming.getByRole('heading',{name:'Arena Duel',exact:true}).count(),1)
 assert.equal(await upcoming.getByRole('button').count(),0)
 assert.equal(await upcoming.getByRole('link',{name:/Preview/}).count(),1)
 assert(await page.evaluate(()=>document.querySelector('.arcade-tournaments').nextElementSibling.id==='arcade-coming'))
 assert.equal(await promo.locator('.op-buy').getAttribute('href'),buy)
 assert.equal(await promo.locator('.op-ca').innerText(),token)
 assert.equal(await promo.locator('.op-track').evaluate(e=>getComputedStyle(e).animationDuration),'16s')
 await promo.hover();assert.equal(await promo.locator('.op-track').evaluate(e=>getComputedStyle(e).animationPlayState),'paused')
 await promo.getByRole('button',{name:'Pause promo animation'}).click();await page.locator('h1').hover()
 assert.equal(await promo.locator('.op-track').evaluate(e=>getComputedStyle(e).animationPlayState),'paused')
 await promo.getByRole('button',{name:'Resume promo animation'}).click()
 await promo.getByRole('button',{name:'Copy ORBIX token contract address',exact:true}).click()
 await promo.getByText('✓ Copied',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),token)
 await page.getByRole('tab',{name:'More games',exact:true}).click()
 assert.equal(await grid.locator('.arcade-game').count(),1);await grid.getByRole('heading',{name:'Token Catch'}).waitFor()
 await page.getByRole('tab',{name:'All games',exact:true}).click()
 await page.getByRole('searchbox').fill('nothing matches');await page.getByText('No games match that search.',{exact:true}).waitFor()
 await page.getByRole('button',{name:'Show all games'}).click();assert.equal(await grid.locator('.arcade-game').count(),5)
 await grid.locator('.arcade-game').first().getByRole('button',{name:'Find rooms'}).click()
 assert.equal(await page.locator('.arcade-room-filter select').inputValue(),'closest-call')
 await page.getByRole('button',{name:'Open room',exact:true}).click();assert.equal(await page.locator('#arcade-room-id').getAttribute('aria-invalid'),'true')
 assert.equal(await page.locator('#arcade-room-id').evaluate(e=>document.activeElement===e),true)
 // Offline, join-only and missing permission metadata must also move to the collage.
 for(const patch of [{playStatus:'offline'},{available_modes:{create:false,join:true}},{available_modes:{preview:true}},{available_modes:undefined}]){
  const original={...templates[1]};Object.assign(templates[1],patch)
  await page.reload();await grid.locator('.arcade-game').first().waitFor()
  assert.equal(await grid.getByRole('heading',{name:'Word Forge'}).count(),0)
  assert.equal(await upcoming.getByRole('heading',{name:'Word Forge'}).count(),1)
  Object.assign(templates[1],original)
 }
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:1050});await page.goto(base+'/center/');await grid.locator('.arcade-game').first().waitFor();await settleArt(page)
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`home overflow at ${width}`)
  const a11y=await new AxeBuilder({page}).include('.arcade-home').include('#orbix-promo').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
  report.a11y.push({width,violations:a11y.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))})
  await page.screenshot({path:evidence+`/home-${width}.png`,fullPage:true});await page.screenshot({path:evidence+`/home-top-${width}.png`})
  await page.locator('.arcade-tournaments').scrollIntoViewIfNeeded();await page.screenshot({path:evidence+`/tournament-collage-${width}.png`})
 }
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(base+'/center/');await promo.waitFor()
 assert.equal(await promo.locator('.op-track').evaluate(e=>getComputedStyle(e).animationName),'none')
 assert.equal(await promo.getByRole('button',{name:'Pause promo animation'}).isVisible(),false)
 await promo.getByRole('button',{name:'Dismiss ORBIX promotion for this session'}).click();await page.reload();assert.equal(await promo.count(),0)
 await page.evaluate(()=>sessionStorage.clear());policy.promo_text='Admin announcement: a new season.';policy.promo_link=buy+'?source=admin'
 await page.reload();await promo.waitFor();assert.match(await promo.innerText(),/Admin announcement/);assert.match(await promo.locator('.op-buy').getAttribute('href'),/source=admin/)
 await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new Error('denied'))},configurable:true});document.execCommand=()=>false})
 await promo.getByRole('button',{name:'Copy ORBIX token contract address',exact:true}).click();await promo.locator('.op-copy-fallback').waitFor();assert.equal(await promo.locator('.op-copy-fallback').inputValue(),token)
 policy.promo_enabled=false;await page.reload();await grid.locator('.arcade-game').first().waitFor();assert.equal(await promo.count(),0)
 emptyTemplates=true;await page.reload();await page.getByText('No games match that search.',{exact:true}).waitFor()
 failTemplates=true;emptyTemplates=false;await page.reload();await page.getByText('We couldn’t check game availability.',{exact:false}).waitFor()
 failTemplates=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await grid.locator('.arcade-game').first().waitFor()
 await page.setViewportSize({width:320,height:780});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'320px overflow')
 report.checks.push('Original hero, palette and always-visible room cards; original Games/More catalog controls; active/create/placement/tag gates; disabled/missing/create/preview/hidden/offline/maintenance cases moved to final collage; preserved overlays and preview-only actions; tournament banner immediately above collage; search, rooms and invite focus; purple 16s legacy marquee, copy exact CA, failure recovery, configured text/link/disabled state, pause/reduced motion/session dismissal; desktop/390px and 320px overflow')
 assert.deepEqual(report.errors,[])
 assert.deepEqual(report.a11y.flatMap(r=>r.violations),[],'Accessibility violations')
 console.log('PASS: restored home, active catalog, final collage, legacy promo and desktop/390px accessibility')
 } finally {fs.writeFileSync(evidence+'/verification.json',JSON.stringify(report,null,2));await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
