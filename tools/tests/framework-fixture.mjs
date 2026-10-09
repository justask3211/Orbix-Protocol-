// Evaluate real production TS math with real Three/cannon; no renderer stubs.
import fs from 'node:fs'
import * as THREE from '../../web/node_modules/three/build/three.module.js'
import * as CANNON from '../../web/node_modules/cannon-es/dist/cannon-es.js'
import {transformSync} from '../../web/node_modules/rolldown/dist/utils-index.mjs'
const cache=new Map([['three',THREE],['cannon-es',CANNON]])
export function frameworkModule(name){
 if(cache.has(name))return cache.get(name)
 const file=name==='terrain'?'web/src/center/worlds/terrain.ts':`web/src/center/framework/${name}.ts`
 const raw=fs.readFileSync(file,'utf8'),names=[...raw.matchAll(/export (?:class|function|const) (\w+)/g)].map(m=>m[1])
 const code=transformSync(file,raw,{target:'es2022'}).code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,(_,members,module)=>`const {${members.replace(/\bas\b/g,':')}}=require(${JSON.stringify(module)});`).replace(/\bexport\s+(?=(?:class|function|const)\b)/g,'')
 const exports=new Function('require',code+`\nreturn {${names.join(',')}};`)(module=>frameworkModule(module.split('/').at(-1)))
 cache.set(name,exports);return exports
}
