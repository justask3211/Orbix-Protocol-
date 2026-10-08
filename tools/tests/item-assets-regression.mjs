import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as THREE from '../../web/node_modules/three/build/three.module.js'
import {transformSync} from '../../web/node_modules/rolldown/dist/utils-index.mjs'
const root = new URL('../../web/',import.meta.url)
const assetPath = new URL('src/center/worlds/ItemAssets.ts',root)
let code=transformSync('items.ts',fs.readFileSync(assetPath,'utf8'),{target:'es2022'}).code
code=code.replaceAll('"three"',JSON.stringify(new URL('node_modules/three/build/three.module.js',root).href)).replace(/"three\/addons\/([^"]+)"/g,(_,path)=>JSON.stringify(new URL('node_modules/three/examples/jsm/'+path,root).href))
const assets=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
let triangles=0
for(const kind of assets.ITEM_KINDS){const geometry=assets.makeItemGeometry(kind),count=geometry.getAttribute('position').count;assert(count>100);assert.equal(geometry.getAttribute('color').count,count);assert(Array.from(geometry.getAttribute('position').array).every(Number.isFinite));assert(geometry.boundingSphere.radius>0);triangles+=count/3;geometry.dispose()}
assert(triangles<25000,`Item triangle budget: ${triangles}`)
const frames=[],effects=[],instances=[],modules={react:{useMemo:fn=>fn(),useRef:value=>({current:value}),useEffect:fn=>effects.push(fn)},'@react-three/fiber':{useFrame:fn=>frames.push(fn)},three:THREE,'./ItemAssets':assets,'react/jsx-runtime':{Fragment:'fragment',jsx,jsxs:jsx}}
function jsx(type,props){if(type==='instancedMesh'){const mesh=new THREE.InstancedMesh(...props.args);mesh.count=0;props.ref(mesh);instances.push(mesh)}return{type,props}}
code=transformSync('items.tsx',fs.readFileSync(new URL('src/center/worlds/ItemMeshes.tsx',root),'utf8'),{target:'es2022',jsx:{runtime:'automatic'}}).code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,(_,names,name)=>`const {${names.replace(/\bas\b/g,':')}}=require(${JSON.stringify(name)});`).replace(/\bexport\s+(?:default\s+)?(?=(?:function|const|class)\b)/g,'')
const {ItemPickups,HeldItems}=new Function('require',code+'\nreturn {ItemPickups,HeldItems};')(name=>modules[name])
let time=0;Object.defineProperty(globalThis,'performance',{value:{now:()=>time},configurable:true})
const state={roundId:'a',nowMs:10,drops:[{id:'s',kind:'shield',x:1,y:0,z:2,spawnAt:0,landAt:0}]}
ItemPickups({state,reducedMotion:false});const update=frames.at(-1);update({clock:{elapsedTime:0}});const shield=instances[2];assert.equal(shield.count,1)
state.drops=[];time=20;update({clock:{elapsedTime:.02}});time=180;update({clock:{elapsedTime:.18}});assert.equal(shield.count,1);assert.equal(shield.geometry.getAttribute('itemFade').getX(0),.5)
time=350;update({clock:{elapsedTime:.35}});assert.equal(shield.count,0)
const shader={vertexShader:'#include <begin_vertex>',fragmentShader:'#include <dithering_fragment>'};shield.material.onBeforeCompile(shader);assert(shader.vertexShader.includes('attribute float itemFade'));assert(shader.fragmentShader.includes('discard'))
const hand=new THREE.Object3D();hand.position.set(3,2,1);hand.updateMatrixWorld();let before=instances.length
HeldItems({state:{serverTimeMs:100,bodies:{player:{hp:100,weapon:'gun',shieldUntil:200}}},hands:new Map([['player',{right:hand,left:hand}]]),me:'spectator'});frames.at(-1)();for(const mesh of instances.slice(before, before+2)){assert.equal(mesh.count,1);const m=new THREE.Matrix4();mesh.getMatrixAt(0,m);assert(Math.abs(m.elements[12]-3)<.1);assert(Math.abs(m.elements[13]-2)<.1)}
console.log(`Original item geometry (${triangles} triangles across 9 meshes), wrist attachments and confirmed-removal dissolve passed.`)
