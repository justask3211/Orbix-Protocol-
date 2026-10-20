import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, LoaderCircle, X } from 'lucide-react'
import { request, explainError } from './api'
import { useModalFocus } from './useModalFocus'
import type { SessionState } from './session'
import './holdGate.css'
export type HoldResult = {passed:boolean;checks:{token:string;symbol:string;required:string;balance:string;passed:boolean}[];buy_link:string;orbix_token:string}
type CheckInput = {action:'create'|'join'|'tournament';config?:unknown;room_id?:string;tournament_id?:string}
export function useHoldCheck(token:string|null) {
  const [state,setState]=useState<{loading:boolean;result?:HoldResult;error?:string}|null>(null)
  const resolve=useRef<((value:boolean)=>void)|null>(null),generation=useRef(0)
  function finish(value:boolean) {generation.current++;setState(null);resolve.current?.(value);resolve.current=null}
  useEffect(()=>()=>{generation.current++;resolve.current?.(false)},[])
  async function check(input:CheckInput) {
    if(!token)throw new Error('Sign in before checking token holdings.')
    const current=++generation.current
    setState({loading:true})
    try {
      const result=await request<HoldResult>('/hold-check',{method:'POST',body:JSON.stringify(input)},token)
      if(current!==generation.current)return false
      if(!result.checks.length){setState(null);return true}
      return await new Promise<boolean>(done=>{resolve.current=done;setState({loading:false,result})})
    }catch(e){if(current!==generation.current)return false;return await new Promise<boolean>(done=>{resolve.current=done;setState({loading:false,error:explainError(e)})})}
  }
  return {check,modal:state?<HoldModal state={state} close={()=>finish(false)} proceed={()=>finish(true)}/>:null}
}
function HoldModal({state,close,proceed}:{state:{loading:boolean;result?:HoldResult;error?:string};close:()=>void;proceed:()=>void}) {
  const ref=useModalFocus(close)
  return createPortal(<div className="hold-backdrop"><div ref={ref} className="hold-modal" role="dialog" aria-modal="true" aria-labelledby="hold-title" tabIndex={-1}>
    <button className="hold-close" aria-label="Close token check" onClick={close}><X/></button>
    <h2 id="hold-title">{state.loading?'Checking ORBIX token hold…':state.error?'Balance check unavailable':state.result?.passed?'You hold the required amount':'Insufficient balance'}</h2>
    <div role="status" aria-live="polite">{state.loading?<><LoaderCircle className="hold-spin" size={48} aria-hidden="true"/><p>Reading your on-chain token balance…</p></>:state.error?<p>{state.error}</p>:state.result?.checks.map(c=><div className={c.passed?'hold-pass':'hold-fail'} key={c.token}>{c.passed?<Check size={34}/>:<X size={34}/>}<p>{c.passed?`You hold the required amount · ${c.balance} ${c.symbol}`:`Insufficient balance — you need ${c.required} ${c.symbol}, you have ${c.balance}`}<small>{c.token}</small></p></div>)}</div>
    {state.result&&!state.result.passed&&<a className="btn-primary" href={state.result.buy_link} target="_blank" rel="noreferrer">Buy ORBIX</a>}
    {state.result?.passed&&<button className="btn-primary" onClick={proceed}>Continue</button>}
    <button className="btn-ghost" onClick={close}>{state.loading?'Cancel check':'Close'}</button><p className="muted">A holding check reads your balance. No tokens are transferred. Admission checks the balance again.</p>
  </div></div>,document.fullscreenElement??document.body)
}

export function OrbixPolicyPanel({session,sign}:{session:SessionState;sign:()=>Promise<string>}) {
  const [policy,setPolicy]=useState<Record<string,unknown>|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  useEffect(()=>{void request<Record<string,unknown>>('/orbix-policy').then(({orbix_token,forcible,...p})=>setPolicy(p)).catch(e=>setMessage(explainError(e)))},[])
  async function save(){if(!policy||!session.token)return;setBusy(true);try{await request('/admin/orbix-policy',{method:'PATCH',headers:{'X-Admin-Proof':await sign()},body:JSON.stringify(policy)},session.token);setMessage('ORBIX holding requirements and promo saved. Positive thresholds apply to everyone.')}catch(e){setMessage(explainError(e))}finally{setBusy(false)}}
  return <section className="ag-fees"><h2>ORBIX holding requirements & promotion</h2><p>Positive thresholds are mandatory for every wallet. Set 0 to disable a requirement. Holdings count while the bonding curve locks transfers.</p>{policy&&<><div className="ag-fee-grid">{(['orbix_hold_create_threshold','orbix_hold_join_threshold','orbix_hold_tournament_threshold','hold_cache_ttl_seconds'] as const).map(key=><label key={key}>{key==='hold_cache_ttl_seconds'?'Balance cache TTL · seconds (0 = fresh every attempt)':key.replace('orbix_hold_','').replace('_threshold','')+' · required ORBIX (whole tokens)'}<input type="number" min="0" max={key==='hold_cache_ttl_seconds'?300:1e15} step="1" value={String(policy[key])} onChange={e=>setPolicy({...policy,[key]:Number(e.target.value)})}/><small>{Number(policy[key])>0&&key!=='hold_cache_ttl_seconds'?'Mandatory · creator settings cannot override':''}</small></label>)}</div><label><input type="checkbox" checked={Boolean(policy.promo_enabled)} onChange={e=>setPolicy({...policy,promo_enabled:e.target.checked})}/> Show site-wide Buy ORBIX strip</label><label>Promo text<input maxLength={120} value={String(policy.promo_text)} onChange={e=>setPolicy({...policy,promo_text:e.target.value})}/></label><label>Buy page URL<input type="url" value={String(policy.promo_link)} onChange={e=>setPolicy({...policy,promo_link:e.target.value})}/></label><button disabled={busy} onClick={()=>void save()}>Sign & save ORBIX settings</button></>}{message&&<p role="status">{message}</p>}</section>
}
