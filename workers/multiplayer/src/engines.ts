export const TEMPLATE_IDS=['token-catch','combat-duel','boss-raid'] as const
export type RealtimeTemplate=typeof TEMPLATE_IDS[number]
export type Bootstrap={roomId:string;roundId:string;configHash:string;seed:string;participants:string[];config:{template_id:RealtimeTemplate;rules:{world_version:4;[key:string]:unknown};[key:string]:unknown}}
export interface RoomEngine {
  step(dtMs:number):void
  act(who:string,input:Record<string,unknown>):{accepted:boolean;error?:string}
  publicState():Record<string,unknown>
  checkpoint():Record<string,unknown>
  finished:boolean
  ranking():string[]
  eligible():string[]
}
export class EnginePortPending extends Error {constructor(template:RealtimeTemplate){super(`ENGINE_PORT_PENDING:${template}`)}}
/** Explicit adapter slots: do not approximate V4 scoring or change money rules. */
export const adapters:Record<RealtimeTemplate,{ready:false;create:(bootstrap:Bootstrap)=>RoomEngine}>={
  'token-catch':{ready:false,create:()=>{throw new EnginePortPending('token-catch')}},
  'combat-duel':{ready:false,create:()=>{throw new EnginePortPending('combat-duel')}},
  'boss-raid':{ready:false,create:()=>{throw new EnginePortPending('boss-raid')}},
}
export function validateBootstrap(raw:unknown,roomId:string):Bootstrap {
  if(!raw||typeof raw!=='object')throw new Error('INVALID_BOOTSTRAP')
  const b=raw as Bootstrap
  if(b.roomId!==roomId||typeof b.roundId!=='string'||!/^[0-9a-f]{16,64}$/.test(b.roundId)||!/^0x[0-9a-f]{64}$/.test(b.configHash)||!/^[0-9a-f]{64}$/.test(b.seed)||!Array.isArray(b.participants)||b.participants.length<2||b.participants.length>50||b.participants.some(p=>typeof p!=='string'||!/^0x[0-9a-f]{40}$/.test(p))||new Set(b.participants).size!==b.participants.length||!b.config||!TEMPLATE_IDS.includes(b.config.template_id)||b.config.rules?.world_version!==4)throw new Error('INVALID_BOOTSTRAP')
  if(b.config.template_id==='combat-duel'&&b.participants.length!==2)throw new Error('INVALID_BOOTSTRAP')
  return b
}
