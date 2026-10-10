import {terrainHeight} from '../worlds/terrain'
const height = (x: number, z: number) => terrainHeight(x, z, 'island')
const body = (x: number, z: number, character: string) => ({ x, z, y: height(x,z), yaw: Math.PI, hp:100,maxHp:100,speed:5,onGround:true,groundHeight:height(x,z),character,weapon:'hands',inputSeq:0 })
export const state: Record<string, any> = {roundId:'review',worldVersion:4,arena:true,terrain:{kind:'field-v1',theme:'island'},bounds:{width:40,depth:40},serverTimeMs:10000,nowMs:1000,tick:0,
  bodies:{local:body(-3,10,'cat'),friend:body(0,7,'turtle')},
  obstacles:[[-9,-7,4,2,1.2],[9,7,4,2,1.2],[-10,9,2,3,2.4],[10,-9,2,3,2.4],[-4,-12,4,2,2.8],[4,12,4,2,2.8]].map(([x,z,width,depth,height],i)=>({id:`cover-${i}`,x,z,width,depth,height,baseY:globalThis.Number.isFinite(x)?terrainHeight(x,z,'island'):0,kind:i>3?'bunker':'cover'})),
  crates:[{id:'crate-1',x:-7,z:5,y:height(-7,5),hp:40}],airdrops:[{id:'supply',x:-1,z:5,y:height(-1,5),spawnAt:0,landAt:1,opened:false}],
  drops:[{id:'coin',x:-2,z:7,y:height(-2,7),spawnAt:0,landAt:1,kind:'coin',value:5}],events:[],projectiles:[]}
export const cameraRef = {current:{yaw:Math.PI,pitch:.15,mode:'third' as const}}
