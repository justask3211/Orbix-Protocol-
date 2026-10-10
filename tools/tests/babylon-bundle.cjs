const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict')
const root='web/dist',manifest=JSON.parse(fs.readFileSync(`${root}/.vite/manifest.json`))
function closure(keys,dynamic=false){const seen=new Set();function visit(key){if(seen.has(key))return;assert(manifest[key],key);seen.add(key);for(const child of [...(manifest[key].imports||[]),...(dynamic?manifest[key].dynamicImports||[]:[])])visit(child)}keys.forEach(visit);return seen}
const fileInfo=file=>{const data=fs.readFileSync(path.join(root,file));return{file,bytes:data.length,gzipBytes:zlib.gzipSync(data,{level:9}).length}}
function payload(keys,excluded=new Set()){const files=new Set();for(const key of keys){const record=manifest[key];files.add(record.file);for(const file of [...(record.css||[]),...(record.assets||[])])files.add(file)}const records=[...files].filter(file=>!excluded.has(file)).map(fileInfo);return{files:records,bytes:records.reduce((n,r)=>n+r.bytes,0),gzipBytes:records.reduce((n,r)=>n+r.gzipBytes,0)}}
const landing=closure(['index.html','src/center/CenterApp.tsx'])
assert(![...landing].some(key=>/babylon/i.test(key)),'Babylon must stay outside the landing static dependency graph')
const common=closure(['index.html','src/center/CenterApp.tsx','src/center/worlds/GameWorld.tsx'])
const commonFiles=new Set(payload(common).files.map(record=>record.file))
const babylon=closure(['src/center/babylon/BabylonWorld.tsx','src/center/babylon/runtime.ts']),three=closure(['src/center/worlds/WorldScene.tsx'])
const unique=keys=>new Set([...keys].filter(key=>!common.has(key)))
const result={date:'2026-10-10',method:'Vite production manifest dependency graphs; renderer additions exclude shared Center/GameWorld static imports and CSS. Gzip level 9 per file, not observed HTTP compression. Three graph includes R3F and current scene/GLTF code; GLBs excluded from both.',lazyLanding:true,engine:fileInfo(Object.values(manifest).find(record=>record.name==='babylon-engine').file),havok:fileInfo(Object.values(manifest).find(record=>record.file.endsWith('.wasm')).file),babylon:payload(unique(babylon),commonFiles),three:payload(unique(three),commonFiles)}
fs.mkdirSync('tools/tests/evidence/babylon',{recursive:true});fs.writeFileSync('tools/tests/evidence/babylon/bundle.json',JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify({lazyLanding:result.lazyLanding,engine:result.engine,havok:result.havok,babylonBytes:result.babylon.bytes,babylonGzip:result.babylon.gzipBytes,threeBytes:result.three.bytes,threeGzip:result.three.gzipBytes},null,2))
