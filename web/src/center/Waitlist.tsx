import { useEffect, useState } from 'react'
import { API_BASE, center, explainError } from './api'
import type { SessionState } from './session'
import { copyText } from './share'
import { useModalFocus } from './useModalFocus'

export type WaitlistOptions = { enabled: boolean; message: string }
export function WaitlistSetup({ value, onChange, disabled }: {value: WaitlistOptions; onChange: (value: WaitlistOptions) => void; disabled: boolean}) {
  return <fieldset className="ct-waitlist-setup" disabled={disabled}>
    <legend>Waitlist</legend>
    <label><input type="checkbox" checked={value.enabled} onChange={e => onChange({...value, enabled:e.target.checked})}/> Wallet waitlist — free, no funds involved</label>
    <p className="muted">After the match, every participant can choose to share an address with you. Joining the list does not promise a reward.</p>
    {value.enabled && <label>Optional message to players<textarea rows={3} maxLength={280} value={value.message} onChange={e => onChange({...value,message:e.target.value})}/><small>{value.message.length}/280</small></label>}
  </fieldset>
}

function SubmitDialog({ roomId, options, session, onClose }: {roomId:string; options:WaitlistOptions; session:SessionState; onClose:()=>void}) {
  const dialog = useModalFocus(onClose)
  const [wallet,setWallet] = useState(session.address ?? '')
  const [saved,setSaved] = useState<string | null>(null)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const valid = /^0x[0-9a-fA-F]{40}$/.test(wallet.trim())
  const submit = async () => {
    if (!session.token || !valid || busy) return
    setBusy(true);setError('')
    try { const result = await center.submitWaitlist(roomId,session.token,wallet.trim());setSaved(result.wallet) }
    catch (failure) { setError(explainError(failure)) }
    finally {setBusy(false)}
  }
  return <div className="wl-backdrop" onClick={onClose} role="presentation"><div ref={dialog} tabIndex={-1} className="wl-modal ct-waitlist-modal" role="dialog" aria-modal="true" aria-label="Join the wallet waitlist" onClick={e=>e.stopPropagation()}>
    <button className="wl-close" onClick={onClose} aria-label="Close waitlist">×</button>
    <h3>Join the wallet waitlist</h3>
    {options.message && <p className="ct-waitlist-message">{options.message}</p>}
    <p className="wl-sub">Optional for every player, whatever your placement. Submit to share this address with the room creator for their waitlist. No funds involved and no reward is promised.</p>
    {saved ? <div role="status"><b>Address saved</b><p className="ct-waitlist-wallet">{saved}</p><p>One entry per player in this room.</p><button className="btn-primary" onClick={onClose}>Done</button></div> : <form onSubmit={e=>{e.preventDefault();void submit()}}>
      <label>EVM wallet address<input value={wallet} onChange={e=>setWallet(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} maxLength={42} aria-invalid={Boolean(wallet && !valid)}/></label>
      {wallet && !valid && <p className="err">Use 0x followed by 40 hexadecimal characters.</p>}
      <p className="muted">Paste any EVM address. Your connected wallet is prefilled; you can replace it. Your first submission is kept if you submit again.</p>
      <div className="ct-actions"><button className="btn-primary" disabled={!valid || busy || !session.token}>{busy?'Saving…':'Submit address'}</button><button type="button" className="btn-ghost" onClick={onClose}>Maybe later</button></div>
    </form>}
    {error && <p className="err" role="alert">{error}</p>}
  </div></div>
}

export function ResultWaitlist({roomId,roundId,options,session}: {roomId:string;roundId:string;options:WaitlistOptions;session:SessionState}) {
  const [open,setOpen] = useState(false)
  useEffect(()=>{setOpen(true)},[roomId,roundId])
  return <><button className="btn-ghost" onClick={()=>setOpen(true)}>Join wallet waitlist</button>{open && <SubmitDialog roomId={roomId} options={options} session={session} onClose={()=>setOpen(false)}/>}</>
}

export function CreatorWaitlist({roomId,token,count}: {roomId:string;token:string;count?:number}) {
  const [open,setOpen] = useState(false)
  const [data,setData] = useState<Awaited<ReturnType<typeof center.waitlist>> | null>(null)
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const [copied,setCopied] = useState(false)
  useEffect(()=>{
    if(count !== undefined)return
    let active=true
    center.waitlist(roomId,token).then(result=>{if(active)setData(result)}).catch(()=>{})
    return ()=>{active=false}
  },[roomId,token,count])
  const dialog = useModalFocus(()=>setOpen(false),open)
  const load = async () => {
    setOpen(true);setBusy(true);setError('');setCopied(false)
    try {setData(await center.waitlist(roomId,token))}catch(failure){setError(explainError(failure))}finally{setBusy(false)}
  }
  const download = async () => {
    setBusy(true);setError('')
    try {
      const response = await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomId)}/waitlist.csv`,{headers:{authorization:`Bearer ${token}`}})
      if(!response.ok)throw new Error(`CSV export failed (${response.status}). Try again shortly.`)
      const url=URL.createObjectURL(await response.blob()),link=document.createElement('a')
      link.href=url;link.download='orbix-waitlist.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
    }catch(failure){setError(explainError(failure))}finally{setBusy(false)}
  }
  return <><button className="btn-ghost" onClick={()=>void load()}>View waitlist ({data?.count ?? count ?? "…"})</button>{open && <div className="wl-backdrop" onClick={()=>setOpen(false)} role="presentation"><div ref={dialog} tabIndex={-1} className="wl-modal ct-waitlist-modal" role="dialog" aria-modal="true" aria-label="Collected wallet waitlist" onClick={e=>e.stopPropagation()}>
    <button className="wl-close" onClick={()=>setOpen(false)} aria-label="Close collected waitlist">×</button><h3>Collected wallet waitlist</h3>
    {busy && <p role="status">Loading…</p>}{data && <><p>{data.count} submissions · {data.uniqueWallets} unique addresses</p>{!data.count && <p>No player has submitted an address yet.</p>}<div className="ct-waitlist-entries">{data.entries.map(entry=><p className="ct-waitlist-wallet" key={entry.player}>{entry.wallet}</p>)}</div><div className="ct-actions"><button className="btn-primary" disabled={!data.count || busy} onClick={()=>void copyText([...new Set(data.entries.map(e=>e.wallet))].join('\n')).then(setCopied)}>{copied?'Copied':'Copy all addresses'}</button><button className="btn-ghost" disabled={busy} onClick={()=>void download()}>Download CSV</button></div></>}
    {error && <p className="err" role="alert">{error}</p>}<button className="btn-ghost" disabled={busy} onClick={()=>void load()}>Refresh list</button>
  </div></div>}</>
}
