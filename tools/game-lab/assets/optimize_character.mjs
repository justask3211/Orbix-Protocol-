import {NodeIO} from '@gltf-transform/core';
import {dedup, prune, resample, simplify} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = root + 'web/public/center-models/';
const io=new NodeIO();
const doc=await io.read(output+'orbix-ranger.glb');
let removedConstantChannels=0;
for(const animation of doc.getRoot().listAnimations()){
  for(const channel of animation.listChannels()){
    const sampler=channel.getSampler();
    const values=sampler.getOutput().getArray();
    const stride=sampler.getOutput().getElementSize();
    let constant=true;
    for(let i=stride;i<values.length;i++){
      if(Math.abs(values[i]-values[i%stride])>.00005){constant=false;break;}
    }
    const node=channel.getTargetNode();
    const rest=channel.getTargetPath()==='translation'?node.getTranslation():channel.getTargetPath()==='rotation'?node.getRotation():node.getScale();
    if(constant&&rest.every((v,i)=>Math.abs(v-values[i])<.0001)){
      channel.dispose();removedConstantChannels++;
    }
  }
  const used=new Set(animation.listChannels().map(channel=>channel.getSampler()));
  for(const sampler of animation.listSamplers())if(!used.has(sampler))sampler.dispose();
}
await doc.transform(resample({tolerance:0.00005}),dedup(),prune());
await io.write(output+'orbix-ranger.glb',doc);
const animations=doc.getRoot().listAnimations().map(a=>({name:a.getName(),channels:a.listChannels().length}));
const manifest=JSON.parse(await readFile(output+'orbix-ranger.manifest.json','utf8'));
const finalBytes=await readFile(output+'orbix-ranger.glb');
manifest.bytes=finalBytes.length;
manifest.sha256=createHash('sha256').update(finalBytes).digest('hex');
manifest.optimization={resampleTolerance:.00005,dedup:true,prune:true};
manifest.optimization.removedConstantChannels=removedConstantChannels;
manifest.exportedAnimations=animations;
await MeshoptSimplifier.ready;
await doc.transform(simplify({simplifier:MeshoptSimplifier,ratio:.16,error:.02}),prune());
await io.write(output+'orbix-ranger-lod.glb',doc);
const lod=await readFile(output+'orbix-ranger-lod.glb');
manifest.lod={url:'orbix-ranger-lod.glb',bytes:lod.length,sha256:createHash('sha256').update(lod).digest('hex'),triangles:doc.getRoot().listMeshes().reduce((total,m)=>total+m.listPrimitives().reduce((sum,p)=>sum+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0)};
await writeFile(output+'orbix-ranger.manifest.json',JSON.stringify(manifest,null,2));
console.log(JSON.stringify({bytes:manifest.bytes,animations,lod:manifest.lod},null,2));
