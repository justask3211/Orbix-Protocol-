/* Render the real podium component with an explicitly provided placement fixture. */
const {chromium}=require(process.env.ORBIX_PLAYWRIGHT_MODULE||'/tmp/orbix-browser-tools/node_modules/playwright')
const assert=require('node:assert/strict')
;(async()=>{const browser=await chromium.launch({args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{
 const page=await browser.newPage({viewport:{width:1000,height:850}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('Browser error: '+e.message)});await page.addInitScript(()=>{window.__vite_plugin_react_preamble_installed__=true;window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>v=>v});await page.emulateMedia({reducedMotion:'reduce'})
 await page.route('**/__podium_review__',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en"><meta charset="utf-8"><style>body{margin:30px;background:#253449;color:#f4e8d2;font-family:sans-serif}</style><div id="root" class="ct-app"></div><script type="module">
 import React from '/center/node_modules/.vite/deps/react.js';import ReactDOM from '/center/node_modules/.vite/deps/react-dom_client.js';import WinnerCelebration from '/center/src/center/WinnerCelebration.tsx';
 ReactDOM.createRoot(document.querySelector('#root')).render(React.createElement(WinnerCelebration,{reducedMotion:true,winners:[{wallet:'0x'+'11'.repeat(20),name:'Maple',character:'cat',rank:1,score:100},{wallet:'0x'+'22'.repeat(20),name:'Tuck',character:'turtle',rank:2,score:75}]}));window.ready=true;
 </script></html>`}))
 await page.goto('http://127.0.0.1:5188/center/__podium_review__');await page.getByRole('region',{name:'Winners podium'}).locator('canvas').waitFor({timeout:45000});await page.waitForTimeout(1500);await page.screenshot({path:'/tmp/orbix-q-podium.png',timeout:60000});assert.deepEqual(errors,[]);console.log('PASS: production cat/turtle podium component renders, reduced motion and zero JS errors. Placements are fixtures; no winner authority claim.')
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1})
