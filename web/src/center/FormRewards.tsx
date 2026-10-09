import {createPortal} from 'react-dom'
import {useEffect, useState} from 'react'
import {API_BASE, center, explainError} from './api'
import type {SessionState} from './session'
import {copyText} from './share'
import {useModalFocus} from './useModalFocus'

export type FormReward = {kind:'waitlist-form'|'qa-form';eligibility:'winners-only'|'top3'|'anyone'|'custom';custom_count:number;message:string;fields:string[];questions:string[]}
export type FormStatus = FormReward & {eligible:boolean;submitted:boolean;editable:boolean}
export const newForm = (kind:FormReward['kind']):FormReward => ({kind,eligibility:'winners-only',custom_count:1,message:'',fields:[],questions:kind==='qa-form'?['']:[]})
const title = (kind:FormReward['kind']) => kind==='qa-form'?'Q&A form':'Waitlist form'

export function FormRewardSetup({forms,onChange,disabled}:{forms:FormReward[];onChange:(v:FormReward[])=>void;disabled:boolean}) {
  const update=(kind:FormReward['kind'],value:FormReward)=>onChange(forms.map(f=>f.kind===kind?value:f))
  return <fieldset className="ct-waitlist-setup ct-form-rewards" disabled={disabled}><legend>Form rewards · FREE</legend><p>The form itself is the reward. Players fill it in without a transaction. No tokens or funds are promised. Add a form alongside a funded prize if you wish.</p>
    {(['waitlist-form','qa-form'] as const).map(kind=>{const form=forms.find(f=>f.kind===kind);return <div key={kind}>
      <label><input type="checkbox" checked={Boolean(form)} onChange={e=>onChange(e.target.checked?[...forms,newForm(kind)]:forms.filter(f=>f.kind!==kind))}/>{title(kind)} · FREE</label>
      {form&&<><label>Who sees {title(kind)}?<select value={form.eligibility} onChange={e=>update(kind,{...form,eligibility:e.target.value as FormReward['eligibility']})}><option value="winners-only">Winners only</option><option value="top3">Top 3</option><option value="anyone">Everyone</option><option value="custom">Custom N players (top N)</option></select></label>
      {form.eligibility==='custom'&&<label>Top N players<input type="number" min={1} max={100} value={form.custom_count} onChange={e=>update(kind,{...form,custom_count:Number(e.target.value)})}/></label>}
      <label>{kind==='waitlist-form'?'Message to recipient':'Q&A introduction'}<textarea maxLength={280} value={form.message} onChange={e=>update(kind,{...form,message:e.target.value})}/></label>
      {kind==='qa-form'&&<p>Answers are private to you. Each participant can edit their one response until the room closes.</p>}
      {(kind==='qa-form'?form.questions:form.fields).map((value,i)=><div className="ct-actions" key={i}><label>{kind==='qa-form'?'Question':'Optional short text field'} {i+1}<input required maxLength={160} value={value} onChange={e=>{const key=kind==='qa-form'?'questions':'fields';update(kind,{...form,[key]:form[key].map((v,j)=>i===j?e.target.value:v)})}}/></label><button type="button" className="btn-ghost" onClick={()=>{const key=kind==='qa-form'?'questions':'fields';update(kind,{...form,[key]:form[key].filter((_,j)=>i!==j)})}}>Remove {i+1}</button></div>)}
      <button type="button" className="btn-ghost" disabled={(kind==='qa-form'?form.questions.length:form.fields.length)>=(kind==='qa-form'?5:3)} onClick={()=>{const key=kind==='qa-form'?'questions':'fields';update(kind,{...form,[key]:[...form[key],'']})}}>Add {kind==='qa-form'?'question':'field'}</button></>}
    </div>})}
  </fieldset>
}

function ResponseDialog({roomId,form,session,onClose}:{roomId:string;form:FormStatus;session:SessionState;onClose:()=>void}) {
  const dialog=useModalFocus(onClose),[wallet,setWallet]=useState(session.address??''),[values,setValues]=useState<string[]>((form.kind==='qa-form'?form.questions:form.fields).map(()=>'')),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[error,setError]=useState('')
  const valid=form.kind==='qa-form'?values.every(v=>Boolean(v.trim())):/^0x[0-9a-fA-F]{40}$/.test(wallet.trim())
  const submit=async()=>{if(!session.token||!valid||busy)return;setBusy(true);setError('');try{if(form.kind==='qa-form')await center.submitQA(roomId,session.token,values);else await center.submitWaitlist(roomId,session.token,wallet.trim(),values);setSaved(true)}catch(e){setError(explainError(e))}finally{setBusy(false)}}
  return createPortal(<div className="wl-backdrop" role="presentation" onClick={onClose}><div ref={dialog} tabIndex={-1} className="wl-modal ct-waitlist-modal" role="dialog" aria-modal="true" aria-label={title(form.kind)} onClick={e=>e.stopPropagation()}><button className="wl-close" aria-label="Close form" onClick={onClose}>×</button><h3>{title(form.kind)} · FREE</h3>{form.message&&<p className="ct-waitlist-message">{form.message}</p>}<p>No funds move. No token reward is promised. Your response is shared privately with the room creator.</p>
    {saved?<div role="status"><b>Response saved</b><p>{form.kind==='qa-form'?'You can replace your response until the room closes.':'One entry per player; your first submission is kept.'}</p><button className="btn-primary" onClick={onClose}>Done</button></div>:<form onSubmit={e=>{e.preventDefault();void submit()}}>
    {form.kind==='waitlist-form'&&<label>EVM wallet address<input value={wallet} maxLength={42} placeholder="0x…" onChange={e=>setWallet(e.target.value)}/><small>Your connected address is prefilled. You may enter another address.</small></label>}
    {form.submitted&&form.kind==='qa-form'&&<p>Replace your entire response by answering all questions again.</p>}
    {(form.kind==='qa-form'?form.questions:form.fields).map((label,i)=><label key={i}>{label}<input required={form.kind==='qa-form'} maxLength={500} value={values[i]} onChange={e=>setValues(v=>v.map((x,j)=>i===j?e.target.value:x))}/></label>)}
    <div className="ct-actions"><button className="btn-primary" disabled={!valid||busy||!form.editable}>{busy?'Saving…':form.submitted?'Replace response':'Submit response'}</button><button type="button" className="btn-ghost" onClick={onClose}>Later</button></div></form>}{error&&<p role="alert" className="err">{error}</p>}</div></div>,document.querySelector('.ct-app')??document.body)
}

export function ResultForms({roomId,roundId,session,ready}:{roomId:string;roundId:string;session:SessionState;ready:boolean}) {
  const [forms,setForms]=useState<FormStatus[]>([]),[open,setOpen]=useState<FormStatus|null>(null),[queue,setQueue]=useState<FormStatus[]>([]),[error,setError]=useState(''),[revision,setRevision]=useState(0)
  useEffect(()=>{if(!session.token||!ready)return;let active=true;center.formStatus(roomId,session.token).then(r=>{if(!active)return;const eligible=r.forms.filter(f=>f.eligible);setForms(eligible);if(revision===0){const pending=eligible.filter(f=>!f.submitted&&f.editable);setOpen(pending[0]??null);setQueue(pending.slice(1))}}).catch(e=>{if(active)setError(explainError(e))});return()=>{active=false}},[roomId,roundId,session.token,ready,revision])
  const close=()=>{setOpen(queue[0]??null);setQueue(q=>q.slice(1));setRevision(v=>v+1)}
  return <section aria-label="Form rewards">{forms.map(f=><button key={f.kind} className="btn-ghost" disabled={!ready||!f.editable||f.kind==='waitlist-form'&&f.submitted} onClick={()=>setOpen(f)}>{f.submitted?'Response saved · ':''}{title(f.kind)}{f.kind==='qa-form'&&f.submitted?' · Edit':''}</button>)}{open&&<ResponseDialog key={open.kind} roomId={roomId} form={open} session={session} onClose={close}/>} {error&&<p className="err" role="alert">{error}</p>}</section>
}

export function CreatorFormResponses({roomId,token,kind,count}:{roomId:string;token:string;kind:FormReward['kind'];count?:number}) {
  const [open,setOpen]=useState(false),[data,setData]=useState<{count:number;entries:Record<string,unknown>[]} | null>(null),[error,setError]=useState(''),[copied,setCopied]=useState(false)
  const dialog=useModalFocus(()=>setOpen(false),open)
  const load=async()=>{setOpen(true);setError('');try{setData(kind==='qa-form'?await center.qaResponses(roomId,token):await center.waitlist(roomId,token))}catch(e){setError(explainError(e))}}
  useEffect(()=>{let active=true;if(count===undefined)(kind==='qa-form'?center.qaResponses(roomId,token):center.waitlist(roomId,token)).then(d=>{if(active)setData(d)}).catch(()=>{});return()=>{active=false}},[roomId,token,kind,count])
  const download=async()=>{try{const r=await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomId)}/${kind==='qa-form'?'qa-form':'waitlist'}.csv`,{headers:{authorization:`Bearer ${token}`}});if(!r.ok)throw Error('CSV export failed.');const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=`orbix-${kind}-responses.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){setError(explainError(e))}}
  return <><button className="btn-ghost" onClick={()=>void load()}>{title(kind)} · View responses ({data?.count??count??'…'})</button>{open&&createPortal(<div className="wl-backdrop" role="presentation" onClick={()=>setOpen(false)}><div ref={dialog} tabIndex={-1} className="wl-modal ct-waitlist-modal" role="dialog" aria-modal="true" aria-label={`${title(kind)} responses`} onClick={e=>e.stopPropagation()}><button className="wl-close" aria-label="Close responses" onClick={()=>setOpen(false)}>×</button><h3>{title(kind)} responses · Creator only</h3><p>{data?.count??0} submissions</p><div className="ct-waitlist-entries">{data?.entries.map(e=><pre key={String(e.player)}>{JSON.stringify(e,null,2)}</pre>)}</div><div className="ct-actions"><button className="btn-ghost" onClick={()=>void copyText(JSON.stringify(data?.entries??[],null,2)).then(setCopied)}>{copied?'Copied':'Copy responses'}</button><button className="btn-primary" onClick={()=>void download()}>Download CSV</button><button className="btn-ghost" onClick={()=>void load()}>Refresh</button></div>{error&&<p role="alert" className="err">{error}</p>}</div></div>,document.querySelector('.ct-app')??document.body)}</>
}
