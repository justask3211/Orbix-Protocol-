/* Real local API: signed promotion editor, home banner, rules, code and admission. */
const {chromium}=require('../game-lab/node_modules/playwright')
const AxeBuilder=require('../game-lab/node_modules/@axe-core/playwright').default
const assert=require('node:assert/strict'),fs=require('node:fs')
const base=process.env.ORBIX_BASE_URL||'http://127.0.0.1:8110'
const evidence='tools/tests/evidence/home-correction'
const report={errors:[],checks:[],a11y:[],edits:[]}
async function resetView(page){await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo({top:0,behavior:'instant'})});await page.waitForTimeout(100)}
const noOverflow=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)
async function audit(page,width,view){const data=await new AxeBuilder({page}).include(view==='list'?'.tn-section':'.tn-detail').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();report.a11y.push({width,view,violations:data.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))})}
;(async()=>{
 fs.mkdirSync(evidence,{recursive:true})
 const browser=await chromium.launch({args:['--no-sandbox']})
 try{
 const adminContext=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce'})
 await adminContext.addInitScript(()=>{localStorage.setItem('orbix.wallet.key','0x'+'ab'.repeat(32));localStorage.setItem('orbix.wallet.kind','generated')})
 const admin=await adminContext.newPage();admin.on('pageerror',e=>report.errors.push(e.message))
 const {tournaments:rows}=await (await admin.request.get(base+'/api/center/v1/tournaments')).json()
 const tournament=rows.find(t=>t.config.room.name==='Tournament test');assert(tournament)
 const tid=tournament.id
 await admin.goto(base+'/center/admin')
 await admin.getByRole('heading',{name:'Tournament front-page editor',exact:true}).waitFor()
 await admin.locator('.tn-game-filter select').selectOption(tournament.config.room.template_id)
 await admin.getByRole('button',{name:'Edit promotion',exact:true}).click()
 const editor=admin.locator('.tn-parameters').filter({has:admin.getByRole('heading',{name:'Administrator banner',exact:true})})
 await editor.waitFor();await editor.getByLabel('Headline',{exact:true}).fill('The Orbix Community Championship')
 await editor.getByLabel('Star / promote on the front page',{exact:true}).check()
 await editor.getByLabel('Size',{exact:false}).selectOption('small')
 await editor.getByLabel('Style',{exact:false}).selectOption('blue')
 async function saveBanner(){
  const pending=admin.waitForResponse(r=>r.url().endsWith('/tournaments/'+tid)&&r.request().method()==='PATCH')
  await editor.getByRole('button',{name:'Sign & save banner',exact:true}).click()
  const response=await pending;assert.equal(response.status(),200)
  assert(response.request().headers()['x-admin-proof'],'Missing signed admin proof')
  const saved=await response.json();report.edits.push(saved.config.banner);return saved
 }
 let saved=await saveBanner();assert.equal(saved.config.banner.size,'small');assert.equal(saved.config.banner.placement,'front')
 await admin.goto(base+'/center/');await admin.locator('.arcade-tournament-promotions').getByText('The Orbix Community Championship',{exact:false}).waitFor()
 await admin.screenshot({path:evidence+'/small-promotion.png',fullPage:true})
 await admin.goto(base+'/center/tournaments/'+tid+'?admin=1');await editor.waitFor()
 await editor.getByLabel('Size',{exact:false}).selectOption('large');await editor.getByLabel('Style',{exact:false}).selectOption('gold')
 saved=await saveBanner();assert.equal(saved.config.banner.size,'large')
 for(const width of [1440,390]){
  await admin.setViewportSize({width,height:width===390?844:1050})
  assert(await noOverflow(admin),`Admin editor overflow ${width}`)
  await editor.evaluate(el=>window.scrollTo({top:el.getBoundingClientRect().top+window.scrollY-document.querySelector('.ct-topbar').getBoundingClientRect().height-16,behavior:'instant'}));await editor.screenshot({path:evidence+`/tournament-editor-${width}.png`})
 }
 for(const [index,width] of [1440,390].entries()){
  const context=await browser.newContext({viewport:{width,height:width===390?844:1050},reducedMotion:'reduce'})
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base})
  await context.addInitScript(key=>{localStorage.setItem('orbix.wallet.key',key);localStorage.setItem('orbix.wallet.kind','generated')},'0x'+require('node:crypto').randomBytes(32).toString('hex'))
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message))
  await page.goto(base+'/center/');const banner=page.locator('.arcade-tournament-banner')
  await banner.getByText('The Orbix Community Championship',{exact:false}).waitFor()
  assert.equal(await banner.evaluate(e=>getComputedStyle(e).minHeight),width===390?'350px':'310px')
  assert(await noOverflow(page),`Featured home overflow ${width}`)
  await banner.scrollIntoViewIfNeeded();await page.screenshot({path:evidence+`/featured-banner-${width}.png`})
  await banner.click();await page.getByRole('heading',{name:'Play for the podium.',exact:true}).waitFor()
  assert(new URL(page.url()).pathname==='/center/tournaments')
  assert.equal(await page.locator('.tn-card').count(),rows.filter(t=>!['settled','cancelled','closed'].includes(t.state)).length)
  await audit(page,width,'list');assert(await noOverflow(page),`List overflow ${width}`)
  await resetView(page);await page.screenshot({path:evidence+`/active-tournaments-${width}.png`,fullPage:true})
  await page.getByRole('button',{name:'View bracket',exact:true}).click();await page.getByRole('heading',{name:'Tournament rules',exact:true}).waitFor()
  await page.getByRole('heading',{name:'Join tournament',exact:true}).waitFor()
  assert.match(await page.locator('.tn-rules').innerText(),/2 players per room/)
  // Detail code entry opens another tournament through the same rules route.
  const field=page.getByLabel('Tournament code or invite link',{exact:true})
  await field.fill('not-a-code');await page.getByRole('button',{name:'Open tournament',exact:true}).click()
  assert.equal(await field.getAttribute('aria-invalid'),'true');assert.equal(await field.evaluate(e=>document.activeElement===e),true)
  await field.fill('https://example.com/center/tournaments/'+tid);await page.getByRole('button',{name:'Open tournament',exact:true}).click();assert.equal(await field.getAttribute('aria-invalid'),'true')
  await page.getByRole('button',{name:'Back to active tournaments',exact:true}).click()
  if(!index){await page.getByLabel('Tournament code or invite link',{exact:true}).fill('0'.repeat(24));await page.getByRole('button',{name:'Open tournament',exact:true}).click();await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'Back to active tournaments',exact:true}).click()}
  await page.getByLabel('Tournament code or invite link',{exact:true}).fill(index?base+'/center/tournaments/'+tid:tid.toUpperCase())
  await page.getByRole('button',{name:'Open tournament',exact:true}).click()
  await page.getByRole('heading',{name:'Tournament rules',exact:true}).waitFor();assert(new URL(page.url()).pathname.endsWith('/'+tid))
  await page.getByRole('button',{name:'Copy tournament code',exact:true}).click();await page.getByText('Tournament code copied.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),tid)
  await audit(page,width,'detail');assert(await noOverflow(page),`Rules overflow ${width}`)
  await resetView(page);await page.screenshot({path:evidence+`/tournament-rules-code-${width}.png`,fullPage:true})
  await page.getByRole('checkbox',{name:/I agree to pay/}).check()
  await page.getByRole('button',{name:'Join tournament',exact:true}).waitFor()
  await page.getByRole('button',{name:'Join tournament',exact:true}).click()
  await page.getByRole('heading',{name:'You hold the required amount',exact:true}).waitFor()
  const joinResponse=page.waitForResponse(r=>r.url().endsWith('/tournaments/'+tid+'/join')&&r.request().method()==='POST')
  await page.getByRole('button',{name:'Continue',exact:true}).click();const joined=await joinResponse;assert.equal(joined.status(),200)
  const body=await joined.json();assert.equal(body.id,tid);assert(body.participants.length>index)
  await page.getByText('You are registered.',{exact:false}).waitFor()
  await resetView(page);await page.screenshot({path:evidence+`/tournament-joined-${width}.png`,fullPage:true})
  await context.close()
 }
 // The public endpoint also returns settled rows: the active view must exclude them.
 const filtered=await adminContext.newPage()
 const terminal=['settled','cancelled','closed'].map((state,index)=>({...tournament,id:String(index).repeat(24),state,config:{...tournament.config,room:{...tournament.config.room,name:'Finished fixture '+state},banner:{...tournament.config.banner,text:'Finished promotion',placement:'front',size:'large'}}}))
 await filtered.route('**/api/center/v1/tournaments',route=>route.fulfill({json:{tournaments:[tournament,...terminal]}}))
 await filtered.goto(base+'/center/tournaments');await filtered.getByRole('heading',{name:'Tournament test',exact:true}).waitFor()
 assert.equal(await filtered.locator('.tn-card').count(),1)
 await filtered.route('**/api/center/v1/tournaments',route=>route.fulfill({json:{tournaments:terminal}}))
 await filtered.goto(base+'/center/');await filtered.getByText('One more game. A place on the podium.',{exact:true}).waitFor()
 assert.equal(await filtered.getByText('Finished promotion',{exact:true}).count(),0)
 await filtered.close()
 // Persisted promotion and admission are confirmed by API reads, beyond rendering.
 const final=await (await admin.request.get(base+'/api/center/v1/tournaments/'+tid)).json()
 assert.equal(final.config.banner.text,'The Orbix Community Championship');assert.equal(final.config.banner.size,'large');assert(final.participants.length>=2)
 report.checks.push('Real API signed small/large promotion edits and game selection; front-page custom headline; banner → active tournament directory → rules; raw uppercase code and same-origin link → rules → consent → holding check → server join; malformed/foreign-link validation and unknown-code recovery; exclusion of settled/cancelled/closed tournaments from active directory and promotion; copy exact tournament ID; desktop/390px editor, directory, rules and joined evidence; persisted API configuration and membership')
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.a11y.flatMap(r=>r.violations),[],'Tournament accessibility violations')
 console.log('PASS: real API signed promotion, banner → active tournaments → rules → code → join at desktop/390px')
 }finally{fs.writeFileSync(evidence+'/tournaments.json',JSON.stringify(report,null,2));await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
