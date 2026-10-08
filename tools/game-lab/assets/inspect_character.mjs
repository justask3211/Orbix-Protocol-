import {NodeIO} from '@gltf-transform/core';
import {fileURLToPath} from 'node:url';
const path=fileURLToPath(new URL('../../../web/public/center-models/orbix-ranger.glb',import.meta.url));
const doc=await new NodeIO().read(path);
console.log(JSON.stringify({textures:doc.getRoot().listTextures().map(t=>({name:t.getName(),bytes:t.getImage()?.length,size:t.getSize()})),accessors:doc.getRoot().listAccessors().reduce((sum,a)=>sum+a.getArray().byteLength,0)},null,2));
