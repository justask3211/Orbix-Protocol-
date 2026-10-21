/* Home discovery policy, interactions, shared promo and responsive evidence. */
const {chromium}=require('../game-lab/node_modules/playwright')
const AxeBuilder=require('../game-lab/node_modules/@axe-core/playwright').default
const assert=require('node:assert/strict'),fs=require('node:fs')
const base=process.env.ORBIX_BASE_URL||'http://127.0.0.1:5173'
const evidence='tools/tests/evidence/home-promo'
const token='0x16c5451763ec2e0e7f041e2db761a0491fdb6db1'
const buy='https://testnet.vibevibe.fun/token/'+token
const template=(templateId,overrides={})=>({templateId,label:templateId,blurb:'A community game.',modes:'Arcade',version:1,multiplayer:true,availability:'preview',playStatus:'live',placement:'catalog',sort_order:0,available_modes:{create:true,join:true,practice:false,preview:false},...overrides})
const templates=[template('closest-call',{sort_order:-20}),template('word-forge'),template('prism-lines'),template('atlas-quest'),template('relic-auction'),template('reaction-duel'),template('token-catch',{placement:'more'}),template('boss-raid',{placement:'upcoming',overlay:{enabled:true,text:'80% built',color:'blue',position:'top-right'},tag:{enabled:true,text:'Squad play incoming',style:'solid'},available_modes:{create:false,join:false,practice:false,preview:true}}),template('combat-duel',{placement:'hidden'}),template('number-hunt',{playStatus:'maintenance'}),template('join-only',{available_modes:{create:false,join:true,practice:false,preview:false}}),template('offline',{playStatus:'offline'})]
const report={errors:[],checks:[],a11y:[]}
async function settleArt(page){
 for(const image of await page.locator('.arcade-home img:visible').all()){await image.scrollIntoViewIfNeeded();await image.evaluate(el=>el.decode().catch(()=>{}))}
 await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(500)
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
 let policy={promo_enabled:true,promo_text:'Your next move starts with $ORBIX. Discover the Orbix core token.',promo_link:buy,orbix_token:token}
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
 const promo=page.locator('#orbix-promo');await promo.waitFor()
 const grid=page.locator('[aria-label="Active creatable games"]')
 await grid.locator('.arcade-game').first().waitFor()
 assert.equal(await grid.locator('.arcade-game').count(),6)
 assert.equal(await grid.getByRole('heading').first().textContent(),'Closest Call')
 assert.equal(await page.locator('#arcade-more').isVisible(),false)
 assert.equal(await promo.locator('.op-buy').getAttribute('href'),buy)
 assert.equal(await promo.locator('.op-ca').innerText(),'0x16c5…6db1')
 assert.equal(await promo.locator('.op-track').evaluate(e=>getComputedStyle(e).animationName),'orbix-promo-run')
 await promo.hover();assert.equal(await promo.locator('.op-track').evaluate(e=>getComputedStyle(e).animationPlayState),'paused')
 await promo.getByRole('button',{name:'Pause promo animation'}).click();await page.locator('h1').hover()
 assert.equal(await promo.locator('.op-track').evaluate(e=>getComputedStyle(e).animationPlayState),'paused')
 await promo.getByRole('button',{name:'Resume promo animation'}).click()
 await promo.getByRole('button',{name:'Copy ORBIX token contract address',exact:true}).click()
 await promo.getByText('✓ Copied',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),token)
 await page.locator('h1').click()
 await page.getByRole('button',{name:'Filter',exact:true}).click()
 await page.getByRole('button',{name:'Board',exact:true}).click()
 assert.equal(await grid.locator('.arcade-game').count(),1);assert.equal(await grid.getByRole('heading').innerText(),'Prism Lines');assert.match(page.url(),/category=Board/)
 await page.reload();await grid.getByRole('heading',{name:'Prism Lines'}).waitFor();assert.equal(await grid.locator('.arcade-game').count(),1)
 await page.getByRole('button',{name:'All categories',exact:true}).click()
 await page.getByRole('button',{name:'Filter',exact:true}).click()
 await page.getByRole('button',{name:'More',exact:true}).click();assert.equal(await page.locator('#arcade-more').isVisible(),true)
 await page.locator('#arcade-more').getByRole('heading',{name:'Token Catch'}).waitFor()
 await page.getByRole('button',{name:'More',exact:true}).click()
 const upcoming=page.locator('#arcade-coming')
 assert.equal(await upcoming.locator('.gc-overlay').innerText(),'80% built');assert.equal(await upcoming.locator('.gc-tag').innerText(),'Squad play incoming')
 assert.equal(await upcoming.getByRole('link',{name:/Create a room|Try now/}).count(),0);assert.equal(await upcoming.getByRole('button',{name:/Find rooms/}).count(),0)
 await page.getByRole('searchbox',{name:'Search games'}).fill('nothing matches')
 await page.getByText('No games match your filters.',{exact:true}).waitFor()
 await page.getByRole('button',{name:'Show all games'}).click();assert.equal(await grid.locator('.arcade-game').count(),6)
 await grid.locator('.arcade-game').first().getByRole('button',{name:'Find rooms'}).click()
 await page.locator('#arcade-room-id').waitFor();assert.match(page.url(),/view=rooms/)
 assert.equal(await page.locator('.arcade-room-filter select').inputValue(),'closest-call')
 await page.getByRole('button',{name:'Open room',exact:true}).click();assert.equal(await page.locator('#arcade-room-id').getAttribute('aria-invalid'),'true')
 assert.equal(await page.locator('#arcade-room-id').evaluate(e=>document.activeElement===e),true)
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:1050})
  for(const view of ['games','rooms']){
   await page.goto(base+'/center/?view='+view);await page.locator(view==='games'?'.arcade-game':'.arcade-create-card').first().waitFor()
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${view} overflow at ${width}`)
   await settleArt(page);const a11y=await new AxeBuilder({page}).include('.arcade-home').include('#orbix-promo').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
   report.a11y.push({width,view,violations:a11y.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))})
   await settleArt(page);await page.screenshot({path:evidence+`/${view}-${width}.png`,fullPage:true});if(width===390&&view==='games')await page.screenshot({path:evidence+'/mobile-top.png'})
  }
 }
 await page.emulateMedia({reducedMotion:'reduce'})
 await page.goto(base+'/center/');await promo.waitFor();assert.equal(await promo.locator('.op-track').evaluate(e=>getComputedStyle(e).animationName),'none')
 assert.equal(await promo.getByRole('button',{name:'Pause promo animation'}).isVisible(),false)
 assert.equal(await grid.locator('.arcade-game').first().evaluate(e=>getComputedStyle(e).animationName),'none')
 await promo.getByRole('button',{name:'Dismiss ORBIX promotion for this session'}).click();await page.reload();assert.equal(await promo.count(),0)
 await page.evaluate(()=>sessionStorage.clear())
 policy.promo_text='Admin announcement: a new season, a new game.';policy.promo_link='https://testnet.vibevibe.fun/token/'+token+'?source=admin'
 await page.reload();await promo.waitFor();assert.match(await promo.innerText(),/Admin announcement/);assert.match(await promo.locator('.op-buy').getAttribute('href'),/source=admin/)
 await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new Error('denied'))},configurable:true});document.execCommand=()=>false})
 await promo.getByRole('button',{name:'Copy ORBIX token contract address',exact:true}).click();await promo.locator('.op-copy-fallback').waitFor();assert.equal(await promo.locator('.op-copy-fallback').inputValue(),token)
 policy.promo_enabled=false;await page.reload();await grid.locator('.arcade-game').first().waitFor();assert.equal(await promo.count(),0)
 emptyTemplates=true;await page.reload();await page.getByText('No games are available to create right now.',{exact:false}).waitFor()
 report.checks.push('active/create policy, admin ordering, hidden/offline/maintenance/join-only exclusions, upcoming badges and actions, More collapsed/expanded, category/search/URL persistence and reset, room handoff, invite validation, clipboard exact CA and failure recovery, configured copy/link/disabled state, infinite motion/hover/pause/reduced motion, session dismissal, desktop/390px no overflow')
 failTemplates=true;emptyTemplates=false;await page.reload();await page.getByText('We couldn’t check game availability.',{exact:false}).waitFor()
 failTemplates=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await grid.locator('.arcade-game').first().waitFor()
 await page.setViewportSize({width:320,height:780});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'320px overflow')
 await page.getByRole('button',{name:'Filter',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#arcade-categories').isVisible(),true)
 report.checks.push('availability failure/retry, keyboard filter toggle and 320px overflow')
 assert.deepEqual(report.errors,[])

 assert.deepEqual(report.a11y.flatMap(r=>r.violations),[],'Accessibility violations')
 console.log('PASS: home and promo desktop/390px interaction, policy, motion, clipboard and accessibility checks')
 } finally {fs.writeFileSync(evidence+'/verification.json',JSON.stringify(report,null,2));await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
