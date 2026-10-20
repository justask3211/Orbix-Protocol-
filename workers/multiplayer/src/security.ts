const encoder = new TextEncoder()
const hex = (bytes:ArrayBuffer) => [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('')
const unhex = (value:string) => Uint8Array.from(value.match(/../g)??[],s=>parseInt(s,16))
export type Claims = {v:1;iss:'orbix-center';aud:'orbix-multiplayer';sub:string;room:string;round:string;role:'player'|'spectator';iat:number;exp:number;nonce:string}
export async function hmac(secret:string,message:string) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
  return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(message)))
}
async function verifyMac(secret:string,message:string,signature:string) {
  if(!secret||secret.length<32||!/^\w{64}$/.test(signature)||!/^[0-9a-f]+$/.test(signature))return false
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify'])
  return crypto.subtle.verify('HMAC',key,unhex(signature),encoder.encode(message))
}
export async function verifyTicket(ticket:unknown,secret:string,room:string,round:string,now=Math.floor(Date.now()/1000)):Promise<Claims> {
  if(typeof ticket!=='string'||ticket.length>4096)throw new Error('BAD_TICKET')
  const parts=ticket.split('.');if(parts.length!==2||!/^[A-Za-z0-9_-]+$/.test(parts[0]))throw new Error('BAD_TICKET')
  if(!await verifyMac(secret,parts[0],parts[1]))throw new Error('BAD_TICKET')
  const raw=atob(parts[0].replace(/-/g,'+').replace(/_/g,'/'));const c=JSON.parse(raw) as Claims
  if(c.v!==1||c.iss!=='orbix-center'||c.aud!=='orbix-multiplayer'||!/^0x[0-9a-f]{40}$/.test(c.sub)||c.room!==room||c.round!==round||!['player','spectator'].includes(c.role)||!Number.isSafeInteger(c.iat)||!Number.isSafeInteger(c.exp)||c.exp<=now||c.iat>now+5||c.exp-c.iat>120||c.exp<=c.iat||!/^[0-9a-f]{32}$/.test(c.nonce))throw new Error('BAD_TICKET')
  return c
}
export async function verifyProvision(request:Request,body:string,secret:string,now=Math.floor(Date.now()/1000)) {
  const timestamp=request.headers.get('X-Orbix-Time')??'',nonce=request.headers.get('X-Orbix-Nonce')??'',signature=request.headers.get('X-Orbix-Signature')??''
  if(!/^\d{1,12}$/.test(timestamp)||Math.abs(Number(timestamp)-now)>30||!/^[0-9a-f]{32}$/.test(nonce))throw new Error('BAD_PROVISION_SIGNATURE')
  const digest=hex(await crypto.subtle.digest('SHA-256',encoder.encode(body)))
  const message=`orbix/provision/v1\n${new URL(request.url).pathname}\n${timestamp}\n${nonce}\n${digest}`
  if(!await verifyMac(secret,message,signature))throw new Error('BAD_PROVISION_SIGNATURE')
  return {nonce,expires:now+60}
}
