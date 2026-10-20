import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { request, explainError } from './api'
import { shortAddress, type SessionState } from './session'
import './tournaments.css'
const WinnerCelebration = lazy(() => import('./WinnerCelebration'))
export const DUEL_TEMPLATES = ['reaction-duel','rps-duel','combat-duel','prism-lines']
export type TournamentSettings = {
  min_players:number; max_players:number; room_size:number; advancers:number; heats:number;
  seeding:'random'|'creator'|'admin'; seeds:string[]; round_names:string[];
  registration_open:number; registration_close:number; start_condition:'manual'|'creator'|'auto-when-full';
  entry_fee:number; fee_unit:'preview-points'; distribution:number[];
}
export const newTournamentSettings = ():TournamentSettings => ({min_players:2,max_players:16,room_size:10,advancers:3,heats:16,seeding:'random',seeds:[],round_names:[],registration_open:0,registration_close:Math.floor(Date.now()/1000)+86400,start_condition:'creator',entry_fee:0,fee_unit:'preview-points',distribution:[100]})
type Banner = {text:string;style:'purple'|'blue'|'gold';size:'small'|'large';placement:'join'|'front'}
type Match = {id:string;players:string[];room_id:string|null;state:string;ranking:string[];advancing:string[];attempt:number}
export type Tournament = {id:string;owner:string;state:string;revision:number;config:TournamentSettings & {room:{name:string;template_id:string};bracket_type:'elimination'|'heats';banner:Banner};participants:string[];pool:number;rounds:{number:number;name:string;matches:Match[]}[];podium:{wallet:string;rank:number;score:number}[];allocations:{winner:string;points:number;code:string}[]}
export const tournaments = {
  list:(mine?:string)=>request<{tournaments:Tournament[]}>(mine?'/tournaments/mine':'/tournaments',{},mine),
  get:(id:string)=>request<Tournament>(`/tournaments/${id}`),
  create:(config:unknown,intentNonce:string,token:string)=>request<Tournament>('/tournaments',{method:'POST',body:JSON.stringify({config,intentNonce})},token),
  action:(id:string,action:string,token:string,body:unknown={},proof?:string)=>request<Tournament>(`/tournaments/${id}${action?`/${action}`:''}`,{method:action?'POST':'PATCH',headers:proof?{'X-Admin-Proof':proof}:{},body:JSON.stringify(body)},token),
}

export function TournamentParameters({value,onChange,templateId,solo,roomCap}:{value:TournamentSettings;onChange:(v:TournamentSettings)=>void;templateId:string;solo:boolean;roomCap:number}) {
  const [caps,setCaps]=useState<Record<string,number>>({})
  useEffect(()=>{void request<Record<string,number>>('/tournaments/caps').then(setCaps).catch(()=>{})},[])
  const set=<K extends keyof TournamentSettings>(key:K,v:TournamentSettings[K])=>onChange({...value,[key]:v})
  const duel=DUEL_TEMPLATES.includes(templateId)
  const number=(key:'min_players'|'max_players'|'room_size'|'advancers'|'heats'|'entry_fee',label:string,max?:number)=><label>{label}<input type="number" min={key==='entry_fee'?0:1} max={max} step="1" value={value[key]} onChange={e=>set(key,Number(e.target.value))}/></label>
  return <section className="tn-parameters"><h2>Tournament setup</h2><p>{duel?'Elimination · seeded byes, winners advance.':solo?'Individual trials · half advance by score each heat.':'Multiplayer heats · top finishers advance.'}</p><div className="tn-fields">
    {number('min_players','Minimum players',caps.max_players)}{number('max_players','Bracket capacity',caps.max_players)}
    {!duel&&!solo&&<>{number('room_size','Players per room',Math.min(roomCap,caps.max_room_size??100))}{number('advancers','Advancers per room',value.room_size-1)}</>}
    {!duel&&number('heats','Maximum heats (including final)',caps.max_heats)}
    <label>Seeding<select value={value.seeding} onChange={e=>set('seeding',e.target.value as TournamentSettings['seeding'])}><option value="random">Random at start</option><option value="creator">Creator order</option><option value="admin">Administrator order</option></select></label>
    <label>Start condition<select value={value.start_condition} onChange={e=>set('start_condition',e.target.value as TournamentSettings['start_condition'])}><option value="creator">Creator starts</option><option value="manual">Admin starts</option><option value="auto-when-full">Automatic when full / registration ends</option></select></label>
    <label>Registration opens<input type="datetime-local" onChange={e=>set('registration_open',Math.floor(new Date(e.target.value).getTime()/1000)||0)}/></label>
    <label>Registration closes<input type="datetime-local" defaultValue={new Date(value.registration_close*1000-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16)} onChange={e=>set('registration_close',Math.floor(new Date(e.target.value).getTime()/1000))}/></label>
    {number('entry_fee','Entry fee · preview credits',caps.max_entry_fee)}
    <label>Reward split<select value={value.distribution.join(',')==='100'?'winner':value.distribution.join(',')==='60,25,15'?'top3':'custom'} onChange={e=>{if(e.target.value==='winner')set('distribution',[100]);else if(e.target.value==='top3')onChange({...value,min_players:Math.max(3,value.min_players),distribution:[60,25,15]});else set('distribution',[70,30])}}><option value="winner">Winner takes all</option><option value="top3">Top 3 · 60 / 25 / 15</option><option value="custom">Custom percentages</option></select></label>
    <label>Percentages (total 100)<input value={value.distribution.join(',')} onChange={e=>set('distribution',e.target.value.split(',').map(Number))}/></label>
    <label>Custom round names (comma separated)<input value={value.round_names.join(',')} onChange={e=>set('round_names',e.target.value.split(',').filter(Boolean))}/></label>
  </div><p>Fees form a preview-point prize pool. Cancelled tournaments refund each entry once. Token pools need refundable escrow and are currently unavailable. Existing room token payments cannot be refunded into a tournament pool.</p></section>
}

export function TournamentsSection({session,navigate,front=false,admin=false}:{session:SessionState;navigate:(p:string)=>void;front?:boolean;admin?:boolean}) {
  const [rows,setRows]=useState<Tournament[]>([]),[mine,setMine]=useState(false),[error,setError]=useState('')
  const refresh=useCallback(async()=>{try{setRows((await tournaments.list(mine?session.token??undefined:undefined)).tournaments);setError('')}catch(e){setError(explainError(e))}},[mine,session.token])
  useEffect(()=>{void refresh();const timer=setInterval(()=>{if(!document.hidden)void refresh()},15000);return()=>clearInterval(timer)},[refresh])
  const visible=front?rows.filter(t=>t.config.banner.placement==='front'):rows
  return <section className={`tn-section ${front?'tn-front':''}`} aria-label="Tournaments"><header><div><span className="center-join-eyebrow">TOURNAMENTS</span><h2>{front?'Championship spotlight':'Play for the podium.'}</h2></div><div className="ct-actions">{!front&&<><button onClick={()=>setMine(!mine)} disabled={!session.token}>{mine?'All tournaments':'My tournaments'}</button><button onClick={()=>navigate('/center/create?tournament=1')}>Create tournament</button></>}<button onClick={()=>void refresh()}>Refresh</button></div></header>
    {error&&<p role="alert">{error}</p>}{!visible.length&&!front&&<p>No active tournaments yet. Start one for your community.</p>}
    <div className="tn-list">{visible.map(t=><article className={`tn-card tn-${t.config.banner.style} tn-${t.config.banner.size}`} key={t.id}><span>{t.config.banner.text||t.config.room.template_id} · {t.state}</span><h3>{t.config.room.name}</h3><p>{t.participants.length}/{t.config.max_players} players · {t.config.bracket_type} · {t.pool} preview points in pool</p><p>Entry {t.config.entry_fee} preview credits · {t.config.distribution.join(' / ')}% prizes</p><button onClick={()=>navigate(`/center/tournaments/${t.id}${admin?'?admin=1':''}`)}>View bracket</button></article>)}</div>
  </section>
}

export function TournamentDetail({id,session,navigate,onConnect}:{id:string;session:SessionState;navigate:(p:string)=>void;onConnect:()=>void}) {
  const [t,setT]=useState<Tournament|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[disclosed,setDisclosed]=useState(false),[seeds,setSeeds]=useState(''),[banner,setBanner]=useState<Banner|null>(null)
  const admin=new URLSearchParams(location.search).has('admin')
  const refresh=useCallback(()=>tournaments.get(id).then(setT).catch(e=>setError(explainError(e))),[id])
  useEffect(()=>{void refresh();const timer=setInterval(()=>{if(!document.hidden)void refresh()},5000);return()=>clearInterval(timer)},[refresh])
  async function act(action:string,body:unknown={}) {if(!session.token)return onConnect();setBusy(true);setError('');try{
    const proof=admin?await (await import('./AdminPanel')).signedProof(session):undefined
    const value=await tournaments.action(id,action,session.token,body,proof);setT(value)
  }catch(e){setError(explainError(e))}finally{setBusy(false)}}
  if(!t)return <section className="ct-page"><p role="status">{error||'Loading tournament…'}</p></section>
  const host=t.owner===session.address?.toLowerCase()||admin,joined=t.participants.includes(session.address?.toLowerCase()??'')
  return <div className="ct-page tn-detail"><button onClick={()=>navigate('/center/join')}>Back to Join</button><span className="center-join-eyebrow">{t.state} · {t.config.bracket_type}</span><h1>{t.config.room.name}</h1><p>{t.participants.length}/{t.config.max_players} entrants · Pool {t.pool} preview points · Split {t.config.distribution.join(' / ')}%</p><p>Registration closes {new Date(t.config.registration_close*1000).toLocaleString('en-US')}. {t.config.seeding} seeding. Byes go to the highest seeds. No eligible winner means a replay. Cross-room equal placements follow the frozen seed order.</p>
    {t.state==='registering'&&!joined&&<div className="tn-join"><label><input type="checkbox" checked={disclosed} onChange={e=>setDisclosed(e.target.checked)}/> I agree to pay {t.config.entry_fee} preview credits once into the prize pool. Preview points are game credits. Cancellation refunds the entry. Rewards follow the displayed split.</label><button disabled={busy||!disclosed} onClick={()=>void act('join')}>{session.token?'Join tournament':'Connect to join'}</button></div>}
    {joined&&<p>You are registered. Open your assigned match below when the bracket starts.</p>}
    {host&&t.state==='registering'&&<section className="tn-parameters"><h2>Tournament controls</h2>{t.config.seeding!=='random'&&<label>Seed wallets in order, one per line<textarea value={seeds} onChange={e=>setSeeds(e.target.value)}/><small>Entrants: {t.participants.join(', ')}</small></label>}<button disabled={busy} onClick={()=>void act('start',t.config.seeding==='random'?{}:{seeds:seeds.split(/[\s,]+/).filter(Boolean)})}>Start tournament</button><details><summary>Edit registration settings</summary><TournamentParameters value={t.config} onChange={v=>setT({...t,config:{...t.config,...v}})} templateId={t.config.room.template_id} solo={t.config.room_size===1} roomCap={100}/><button disabled={busy} onClick={()=>{const {room,banner,bracket_type,...settings}=t.config;void act('',settings)}}>Save settings</button></details></section>}
    {host&&!['cancelled','settled','closed'].includes(t.state)&&<button disabled={busy} onClick={()=>void act('cancel')}>Cancel and refund entries</button>}
    {host&&t.state==='settled'&&<button disabled={busy} onClick={()=>void act('close')}>Close tournament</button>}
    {admin&&<section className="tn-parameters"><h2>Administrator banner</h2><label>Headline<input maxLength={120} value={(banner??t.config.banner).text} onChange={e=>setBanner({...t.config.banner,...banner,text:e.target.value})}/></label><label>Style<select value={(banner??t.config.banner).style} onChange={e=>setBanner({...t.config.banner,...banner,style:e.target.value as Banner['style']})}>{['purple','blue','gold'].map(s=><option key={s}>{s}</option>)}</select></label><label>Size<select value={(banner??t.config.banner).size} onChange={e=>setBanner({...t.config.banner,...banner,size:e.target.value as Banner['size']})}><option>small</option><option>large</option></select></label><label>Placement<select value={(banner??t.config.banner).placement} onChange={e=>setBanner({...t.config.banner,...banner,placement:e.target.value as Banner['placement']})}><option value="join">Join section</option><option value="front">Front page headline</option></select></label><button disabled={busy||!banner} onClick={()=>void act('',{banner})}>Sign & save banner</button></section>}
    {error&&<p role="alert">{error}</p>}
    <div className="tn-tree" role="region" aria-label="Tournament bracket" tabIndex={0}>{t.rounds.map(r=><section key={r.number} className="tn-round"><h2>{r.name}</h2>{r.matches.map(m=><article className="tn-match" key={m.id}><span>Match {m.id} · {m.state}{m.attempt>1?` · replay ${m.attempt-1}`:''}</span><ol>{m.players.map(p=><li key={p} className={m.advancing.includes(p)?'tn-winner':''}>{shortAddress(p)} {m.advancing.includes(p)&&'✓'}</li>)}</ol>{m.room_id&&m.players.includes(session.address?.toLowerCase()??'')&&m.state==='pending'&&<button onClick={()=>navigate(`/center/rooms/${m.room_id}`)}>Open my match</button>}{m.state==='bye'&&<small>Seeded bye → next round</small>}</article>)}</section>)}</div>
    {!!t.podium.length&&<Suspense fallback={<p>Loading podium…</p>}><WinnerCelebration winners={t.podium.slice(0,3)} title="Tournament champion" me={session.address??undefined} rewardNote="Tournament settled in preview points."/></Suspense>}
    {!!t.allocations.length&&<section><h2>Prize allocations</h2>{t.allocations.filter(a=>host||a.winner===session.address?.toLowerCase()).map(a=><p key={a.code}>{shortAddress(a.winner)} · {a.points} preview points · <code>{a.code}</code></p>)}</section>}
  </div>
}
