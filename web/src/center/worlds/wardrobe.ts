/** Original Orbix cotton/denim/linen prints. Palette masks are neutral sRGB albedo;
 * actor materials apply a single primary tint. Shared atlases are never actor-disposed. */
import {DataTexture,RGBAFormat,SRGBColorSpace,RepeatWrapping,MeshStandardMaterial} from 'three'
import {cartoonFinish} from './cartoonStyle'
export const WARDROBE_VERSION=1
export const OUTFITS=['overalls','rain-jacket','festival-jacket','tunic','dress-sun','dress-festival'] as const
export const GARMENT_PALETTES:Record<string,[string,string,string]>={
 cat:['#39BFAA','#F78369','#FFF0D4'],turtle:['#F5B943','#287B70','#FFF2D5'],blob:['#5075E5','#FF9859','#FFF0D9'],knight:['#F47766','#F6CE67','#354267'],
 'cat-blob':['#50CBB8','#FFA781','#FFF4DE'],duckling:['#35BFC8','#F89548','#FFF5DA'],astronaut:['#5962CD','#F88378','#FFE18B'],'toy-robot':['#4776D5','#F5C84D','#FFF2D8'],
 pancake:['#D96798','#74B795','#FFF0D0'],'jelly-ninja':['#F1788D','#63D5BE','#FFF0DA'],sprout:['#AA82DC','#FFAE75','#FFF3DB'],marshmallow:['#8663D8','#45C9B8','#F18EB5']
}
const textures=new Map<string,DataTexture>()
export function clothTexture(outfit:string,fast=false){
 const pattern=outfit==='dress'?'dress-sun':outfit
 const size=fast?512:1024,key=`${pattern}/${size}`
 const cached=textures.get(key);if(cached)return cached
 const pixels=new Uint8Array(size*size*4)
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const u=Math.floor(x*512/size),v=Math.floor(y*512/size),weave=((u+v)%4===0?8:0)-((u%3===0)?5:0)
  let tone=235+weave
  if(pattern==='dress-sun')tone-=((Math.floor(u/32)+Math.floor(v/32))%2)*28
  if(pattern==='overalls')tone-=((u+2*v)%13<3?24:0)
  if(pattern==='tunic')tone-=((v%48<3)?20:0)
  if(pattern==='festival-jacket'||pattern==='dress-festival'){
   const dx=u%64-32,dy=v%64-32
   if(Math.abs(dx)+Math.abs(dy)<10 || Math.abs(dx)<3&&Math.abs(dy)<17 || Math.abs(dy)<3&&Math.abs(dx)<17)tone=175
  }
  if(pattern==='rain-jacket')tone=244-((u*17+v*31)%19)
  const offset=(y*size+x)*4;pixels[offset]=pixels[offset+1]=pixels[offset+2]=tone;pixels[offset+3]=255
 }
 const texture=new DataTexture(pixels,size,size,RGBAFormat);texture.name=`OrbixOriginal_${key}`;texture.colorSpace=SRGBColorSpace;texture.wrapS=texture.wrapT=RepeatWrapping;texture.generateMipmaps=true;texture.needsUpdate=true
 textures.set(key,texture);return texture
}
export function garmentMaterials(character:string,outfit:string,fast=false){
 const [primary,trim]=GARMENT_PALETTES[character]??GARMENT_PALETTES.blob
 const legacy=({coral:'#F99A92',mint:'#8ADBC4',lilac:'#BDACF0'} as Record<string,string>)[outfit]
 const main=new MeshStandardMaterial({color:legacy??primary,map:clothTexture(outfit,fast),metalness:0,roughness:outfit==='dress-festival'?.67:.88})
 main.name='cloth_main';cartoonFinish(main,'cloth')
 const edge=new MeshStandardMaterial({color:trim,map:clothTexture('tunic',fast),roughness:.9,metalness:0});edge.name='cloth_trim';cartoonFinish(edge,'cloth')
 return [main,edge]
}
