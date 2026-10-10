import fs from 'node:fs'
import assert from 'node:assert/strict'
import { transformSync } from '../../web/node_modules/rolldown/dist/utils-index.mjs'
import { frameworkModule } from './framework-fixture.mjs'
const path='web/src/center/OfflinePreviewEngine.ts'
const raw=fs.readFileSync(path,'utf8')
const js=transformSync(path,raw,{target:'es2022'}).code
  .replace(/import fixtures from [^;]+;/,'const fixtures=fixtureData;')
  .replace(/import \{ stateGround \} from [^;]+;/,'const {stateGround}=terrain;')
  .replace(/export /g,'')
const fixtures=JSON.parse(fs.readFileSync('web/src/center/previewFixtures.json','utf8'))
const {OfflinePreviewEngine,PREVIEW_TEMPLATE_IDS}=new Function('fixtureData','terrain',js+'\nreturn {OfflinePreviewEngine,PREVIEW_TEMPLATE_IDS}')(fixtures,frameworkModule('terrain'))
// Throw if a reducer ever grows an accidental network, database or storage path.
for(const name of ['fetch','WebSocket','XMLHttpRequest','indexedDB','localStorage','sessionStorage'])
  Object.defineProperty(globalThis,name,{configurable:true,get(){throw Error('Preview accessed '+name)}})
for(const id of PREVIEW_TEMPLATE_IDS){const e=new OfflinePreviewEngine(id);e.tick(.03);e.advance();assert(e.snapshot()._offline);assert.equal(e.snapshot().finished,false)}
const arena=new OfflinePreviewEngine('combat-duel'),me=arena.me
const before=arena.snapshot().bodies[me]
arena.act({kind:'move',dx:1,dz:0,seq:1});for(let i=0;i<30;i++)arena.tick(1/30)
assert(arena.snapshot().bodies[me].x>before.x+4)
arena.act({kind:'jump'});arena.tick(.05);assert(arena.snapshot().bodies[me].y>before.y)
arena.act({kind:'attack'});assert.equal(arena.snapshot().scores[me],12)
const prism=new OfflinePreviewEngine('prism-lines');prism.act({kind:'drop',column:1});assert(prism.snapshot().board.flat().includes(prism.me))
const hunt=new OfflinePreviewEngine('number-hunt');hunt.act({kind:'guess',number:3333});assert.equal(hunt.snapshot().remaining[hunt.me],19)
const maze=new OfflinePreviewEngine('maze-race'),from=maze.snapshot().positions[maze.me]
const link=maze.snapshot().links.find(pair=>pair.includes(from)),to=link.find(cell=>cell!==from)
maze.act({kind:'move',to});assert.equal(maze.snapshot().positions[maze.me],to)
for(const id of ['closest-call','word-forge','atlas-quest','relic-auction','reaction-duel']) {
 const a=new OfflinePreviewEngine(id),b=new OfflinePreviewEngine(id),action=({ 'closest-call':{kind:'estimate',value:25},'word-forge':{kind:'word',text:'stone'},'atlas-quest':{kind:'pin',col:5,row:6},'relic-auction':{kind:'bid',amount:10},'reaction-duel':{kind:'commit',choice:'rock'}})[id]
 for(const e of [a,b]){e.act(action);for(let i=0;i<50;i++){e.tick(.05);e.advance()}}
 const aa=a.snapshot(),bb=b.snapshot();for(const key of ['serverTimeMs','serverTime','startedAt','phaseStartedAt','phaseDeadline','deadline']){delete aa[key];delete bb[key]}
 assert.deepEqual(aa,bb,id+' deterministic demo')
}
assert.throws(()=>new OfflinePreviewEngine('invented-game'))
console.log(`Offline preview: ${PREVIEW_TEMPLATE_IDS.length} templates, seeded determinism, movement/jump/attack, board/guess/maze inputs; network and storage access forbidden.`)
