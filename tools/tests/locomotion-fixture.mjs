import fs from 'node:fs'
import * as THREE from '../../web/node_modules/three/build/three.module.js'
import {clone} from '../../web/node_modules/three/examples/jsm/utils/SkeletonUtils.js'
import {transformSync} from '../../web/node_modules/rolldown/dist/utils-index.mjs'
const filename='web/src/center/worlds/locomotion.ts'
const source=transformSync(filename,fs.readFileSync(filename,'utf8'),{target:'es2022'}).code.replace(/^import[^;]*;/gm,'').replace(/\bexport\s+/g,'')
export const locomotion=new Function('THREE','clone',`const {${Object.keys(THREE).join(',')}}=THREE;\n`+source+'\nreturn locomotion;')(THREE,clone)
