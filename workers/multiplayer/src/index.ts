import { DurableObject } from 'cloudflare:workers'
import { adapters, TEMPLATE_IDS, validateBootstrap, type Bootstrap } from './engines.ts'
import { frame, decodeFrame } from './protocol.ts'
import { verifyProvision, verifyTicket, type Claims } from './security.ts'

export interface Env {
  ROOMS:DurableObjectNamespace<MultiplayerRoom>;ASSETS:Fetcher;
  EDGE_TICKET_SECRET:string;PROVISION_SECRET:string;
  RAILWAY_ORIGIN:string;ALLOWED_ORIGINS:string;TRANSPORT_SMOKE:string;
}
const error=(code:string,status=400)=>Response.json({detail:{code,message:code}},{status})
const validRoom=(id:string)=>/^[0-9a-f]{16,64}$/.test(id)
const origins=(env:Env)=>env.ALLOWED_ORIGINS.split(',').map(s=>s.trim())
const safeMessage=(e:unknown)=>e instanceof Error?e.message:'INTERNAL_ERROR'
type Attachment={claims?:Claims;expiresAt:number;windowAt:number;count:number}

export default {
  async fetch(request:Request,env:Env):Promise<Response> {
    const url=new URL(request.url)
    if(url.pathname==='/multiplayer/health')return Response.json({ok:true,ready:false,transport:'durable-objects',protocol:1,templates:TEMPLATE_IDS,reason:'V4_ENGINE_PORTS_AND_SETTLEMENT_BRIDGE_PENDING'})
    const provision=/^\/internal\/rooms\/([0-9a-f]+)\/provision$/.exec(url.pathname)
    if(provision) {
      if(request.method!=='POST'||!validRoom(provision[1]))return error('NOT_FOUND',404)
      const body=await boundedBody(request,65536)
      if(body===null)return error('PAYLOAD_TOO_LARGE',413)
      try{await verifyProvision(request,body,env.PROVISION_SECRET)}catch{return error('UNAUTHORIZED',401)}
      return env.ROOMS.get(env.ROOMS.idFromName(provision[1])).fetch(new Request(request,{body}))
    }
    const socket=/^\/multiplayer\/v1\/ws\/rooms\/([0-9a-f]+)$/.exec(url.pathname)
    if(socket) {
      if(!validRoom(socket[1])||request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return error('UPGRADE_REQUIRED',426)
      if(!origins(env).includes(request.headers.get('Origin')??''))return error('ORIGIN_FORBIDDEN',403)
      // A transport smoke exercise cannot be mistaken for public gameplay.
      if(env.TRANSPORT_SMOKE!=='true')return error('CLOUDFLARE_RUNTIME_NOT_READY',503)
      return env.ROOMS.get(env.ROOMS.idFromName(socket[1])).fetch(request)
    }
    if(url.pathname.startsWith('/internal/')||url.pathname.startsWith('/multiplayer/'))return error('NOT_FOUND',404)
    if(url.pathname.startsWith('/api/center/')) {
      const origin=new URL(env.RAILWAY_ORIGIN)
      if(origin.protocol!=='https:'||origin.username||origin.password)return error('INVALID_RAILWAY_ORIGIN',503)
      const target=new URL(url.pathname+url.search,origin)
      // Fixed upstream only, no user-selected proxy target and no internal secrets.
      const headers=new Headers(request.headers)
      for(const key of [...headers.keys()])if(key.toLowerCase().startsWith('x-orbix-'))headers.delete(key)
      headers.delete('host')
      return fetch(new Request(target,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body,redirect:'manual'}))
    }
    // Vite is built with base=/center/. Asset binding stores paths without that prefix.
    if(url.pathname==='/center'||url.pathname.startsWith('/center/')) {
      const asset=new URL(request.url);asset.pathname=url.pathname.replace(/^\/center\/?/,'/')
      const isNavigation=request.method==='GET'&&(request.headers.get('Accept')??'').includes('text/html')
      if(isNavigation&&(!asset.pathname.split('/').pop()?.includes('.')))asset.pathname='/index.html'
      const response=await env.ASSETS.fetch(new Request(asset,request))
      if(asset.pathname==='/index.html'){const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');return new Response(response.body,{status:response.status,headers})}
      return response
    }
    return error('NOT_FOUND',404)
  },
} satisfies ExportedHandler<Env>

async function boundedBody(request:Request,limit:number) {
  const reader=request.body?.getReader();if(!reader)return ''
  let count=0;const chunks:Uint8Array[]=[]
  while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>limit){await reader.cancel();return null}chunks.push(value)}
  const bytes=new Uint8Array(count);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length}return new TextDecoder().decode(bytes)
}

export class MultiplayerRoom extends DurableObject<Env> {
  bootstrap:Bootstrap|undefined
  constructor(ctx:DurableObjectState,env:Env) {
    super(ctx,env)
    ctx.blockConcurrencyWhile(async()=>{this.bootstrap=await ctx.storage.get<Bootstrap>('bootstrap')})
  }
  async fetch(request:Request) {
    const url=new URL(request.url)
    if(url.pathname.startsWith('/internal/')) {
      const body=await boundedBody(request,65536);if(body===null)return error('PAYLOAD_TOO_LARGE',413)
      try{
        const auth=await verifyProvision(request,body,this.env.PROVISION_SECRET)
        const id=url.pathname.split('/')[3];const b=validateBootstrap(JSON.parse(body),id)
        const existing=this.bootstrap
        if(existing&&JSON.stringify(existing)!==JSON.stringify(b))return error('ROOM_COMMITMENT_CONFLICT',409)
        await this.ctx.storage.transaction(async tx=>{
          const committed=await tx.get<Bootstrap>('bootstrap')
          if(committed&&JSON.stringify(committed)!==JSON.stringify(b))throw new Error('ROOM_COMMITMENT_CONFLICT')
          if(await tx.get('provision:'+auth.nonce))throw new Error('PROVISION_REPLAY')
          await tx.put('provision:'+auth.nonce,auth.expires*1000)
          if(!existing)await tx.put('bootstrap',b)
        })
        this.bootstrap=b;await this.ctx.storage.setAlarm(Date.now()+60000)
        return Response.json({roomId:b.roomId,provisioned:true,ready:false,engineReady:adapters[b.config.template_id].ready,transportOnly:true})
      }catch(e){return error(safeMessage(e),400)}
    }
    if(!this.bootstrap)return error('ROOM_NOT_PROVISIONED',404)
    if(this.env.TRANSPORT_SMOKE!=='true')return error('CLOUDFLARE_RUNTIME_NOT_READY',503)
    if(!origins(this.env).includes(request.headers.get('Origin')??''))return error('ORIGIN_FORBIDDEN',403)
    if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return error('UPGRADE_REQUIRED',426)
    if(this.ctx.getWebSockets().length>=64)return error('ROOM_CONNECTION_LIMIT',429)
    const [client,server]=Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({expiresAt:Date.now()+10000,windowAt:Date.now(),count:0} satisfies Attachment)
    await this.ctx.storage.setAlarm(Date.now()+10000)
    return new Response(null,{status:101,webSocket:client})
  }
  async webSocketMessage(ws:WebSocket,raw:string|ArrayBuffer) {
    try{
      const attachment=ws.deserializeAttachment() as Attachment
      const now=Date.now()
      if(now-attachment.windowAt>=1000){attachment.windowAt=now;attachment.count=0}
      if(++attachment.count>60){ws.close(4429,'RATE_LIMITED');return}
      ws.serializeAttachment(attachment)
      const msg=decodeFrame(raw),b=this.bootstrap!
      if(!attachment.claims) {
        if(now>attachment.expiresAt||msg.type!=='session.hello'){ws.close(4401,'SESSION_HELLO_REQUIRED');return}
        const claims=await verifyTicket(msg.ticket,this.env.EDGE_TICKET_SECRET,b.roomId,b.roundId)
        if(!b.participants.includes(claims.sub)||claims.role!=='player'){ws.close(4403,'NOT_ADMITTED');return}
        await this.ctx.storage.transaction(async tx=>{
          if(await tx.get('ticket:'+claims.nonce))throw new Error('TICKET_REPLAY')
          await tx.put('ticket:'+claims.nonce,claims.exp*1000)
        })
        attachment.claims=claims;ws.serializeAttachment(attachment)
        ws.send(frame('session.ready',{roomId:b.roomId,roundId:b.roundId,status:'transport-only',state:null,serverTimeMs:now,revision:1}))
        ws.send(frame('error',{payload:{code:'ENGINE_PORT_PENDING',message:'Transport smoke only. This room has no gameplay or rewards.'}}))
        return
      }
      if(msg.type==='connection.ping'){ws.send(frame('connection.pong',{serverTimeMs:now}));return}
      if(msg.type==='room.sync'){ws.send(frame('room.snapshot',{roundId:b.roundId,serverTimeMs:now,payload:{state:null,status:'transport-only'}}));return}
      // Never acknowledge movement, scores or readiness without a real authority.
      ws.send(frame(msg.type==='action'?'action.rejected':'error',{roundId:b.roundId,actionId:msg.payload?.actionId,payload:{accepted:false,error:'ENGINE_PORT_PENDING',code:'ENGINE_PORT_PENDING'}}))
    }catch(e){ws.send(frame('error',{payload:{code:safeMessage(e)}}));ws.close(4400,'INVALID_FRAME_OR_SESSION')}
  }
  async alarm() {
    const now=Date.now()
    for(const ws of this.ctx.getWebSockets()){
      const a=ws.deserializeAttachment() as Attachment
      if(!a.claims&&a.expiresAt<=now)ws.close(4401,'AUTH_TIMEOUT')
    }
    // Replay guards outlive every valid ticket/signature, then expire durably.
    const remove:string[]=[]
    for(const prefix of ['ticket:','provision:'])for(const [key,expires] of await this.ctx.storage.list<number>({prefix}))if(expires<=now)remove.push(key)
    if(remove.length)await this.ctx.storage.delete(remove)
    if(this.ctx.getWebSockets().length)await this.ctx.storage.setAlarm(now+10000)
  }
  webSocketClose(ws:WebSocket,code:number){ws.close(code===1005?1000:code)}
  webSocketError(ws:WebSocket){ws.close(1011,'SOCKET_ERROR')}
}
