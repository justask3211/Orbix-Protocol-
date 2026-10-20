export type ClientFrame = {type:string;ticket?:unknown;payload?:Record<string,unknown>;seq?:number;ready?:boolean}
export function decodeFrame(raw:string|ArrayBuffer):ClientFrame {
  if(typeof raw!=='string'||new TextEncoder().encode(raw).length>8192)throw new Error('PAYLOAD_TOO_LARGE')
  let value:unknown
  try{value=JSON.parse(raw)}catch{throw new Error('BAD_JSON')}
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof (value as ClientFrame).type!=='string')throw new Error('BAD_FRAME')
  const f=value as ClientFrame
  if(!['session.hello','participant.ready','action','room.sync','connection.ping'].includes(f.type))throw new Error('BAD_FRAME')
  if(f.type==='action'&&(!f.payload||typeof f.payload!=='object'||Array.isArray(f.payload)))throw new Error('BAD_ACTION')
  if(f.type==='room.sync'&&f.seq!==undefined&&(!Number.isSafeInteger(f.seq)||f.seq<0))throw new Error('BAD_SEQUENCE')
  return f
}
export function frame(type:string,fields:Record<string,unknown>={}) {return JSON.stringify({v:1,type,...fields})}
export class InputWindow {
  lastSeq=0;tokens=60;at:number
  constructor(now=0){this.at=now}
  accept(seq:unknown,now:number) {
    if(!Number.isSafeInteger(seq)||Number(seq)<=this.lastSeq)return 'STALE_INPUT'
    this.tokens=Math.min(60,this.tokens+Math.max(0,now-this.at)*.03);this.at=now
    if(this.tokens<1)return 'RATE_LIMITED'
    this.tokens--;this.lastSeq=Number(seq);return null
  }
}
/** A pure scheduler primitive. The unavailable engine adapters never start a loop. */
export class FixedStepClock {
  last:number;remainder=0;tick=0
  constructor(now:number){this.last=now}
  advance(now:number) {
    const elapsed=now-this.last
    if(!Number.isFinite(now)||elapsed<0||elapsed>1000/30*5)throw new Error('SIMULATION_RECOVERY_REQUIRED')
    this.last=now;this.remainder+=elapsed
    const steps=Math.floor((this.remainder+1e-8)/(1000/30))
    this.remainder-=steps*(1000/30);this.tick+=steps
    return steps
  }
}
