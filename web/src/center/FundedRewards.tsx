import { useEffect, useState, useRef } from 'react'
import { Coins, Gift, Link, Play, Trophy, Wallet, KeyRound, Receipt } from 'lucide-react'
import { type Address } from 'viem'
import { center, explainError } from './api'
import { allocateRewardPlan, claimReward, type FundedConfig, type RewardClaim, type RewardPlan } from './rewardWallet'
import { copyText } from './share'
import './creatorEconomy.css'
import './fundedRewards.css'

export type RewardSettings = {enabled:boolean; kind:'erc20'|'erc721'|'erc1155'|'eth'|'key'; token:string; amount:string; tokenId:string; count:number; mode:'auto'|'code'|'merkle'|'open'; deadline:string; recipients:string}
export const initialRewardSettings = ():RewardSettings => ({enabled:false,kind:'erc20',token:'',amount:'1',tokenId:'0',count:1,mode:'auto',deadline:new Date(Date.now()+7*86400000-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16),recipients:''})
export function rewardConfig(settings:RewardSettings): FundedConfig {
  if(settings.kind==='key') throw new Error('Private-key rewards require private off-chain delivery. This deployed contract has no key-delivery method; choose a token, NFT or ETH pool here.')
  const address=settings.kind==='eth'?'0x0000000000000000000000000000000000000000':settings.token.trim()
  if(!/^0x[0-9a-fA-F]{40}$/.test(address))throw new Error('Enter a valid reward token or collection address.')
  if(!/^\d+$/.test(settings.amount)||BigInt(settings.amount)<=0n||BigInt(settings.amount)>=2n**256n)throw new Error('Enter a positive reward amount in token base units or wei.')
  if(!/^\d+$/.test(settings.tokenId)||BigInt(settings.tokenId)>=2n**256n)throw new Error('Enter a valid NFT token ID.')
  if(!Number.isInteger(settings.count)||settings.count<1||settings.count>50)throw new Error('Choose between 1 and 50 prize slots.')
  if(settings.kind==='erc721'&&(settings.count!==1||settings.amount!=='1'))throw new Error('One ERC721 prize requires one slot and amount 1.')
  if(BigInt(settings.amount)*BigInt(settings.count)>=2n**256n)throw new Error('Total reward amount is too large.')
  const deadline=Math.floor(new Date(settings.deadline).getTime()/1000)
  if(!Number.isFinite(deadline)||deadline<=Date.now()/1000+3700)throw new Error('Choose a claim deadline more than one hour from now.')
  const recipients=settings.recipients.split(/[\s,]+/).filter(Boolean)
  if(settings.mode==='merkle'&&(recipients.length!==settings.count||recipients.some(a=>!/^0x[0-9a-fA-F]{40}$/.test(a))||new Set(recipients.map(a=>a.toLowerCase())).size!==recipients.length))throw new Error('Merkle mode needs one distinct recipient wallet per slot before funding.')
  return {kind:'funded-assets',claim_mode:settings.mode,claim_deadline:deadline,merkle_winners:settings.mode==='merkle'?recipients:[],slots:Array.from({length:settings.count},(_,i)=>({rank:i+1,asset_kind:settings.kind as 'erc20',asset_contract:address as Address,token_id:['erc721','erc1155'].includes(settings.kind)?settings.tokenId:'0',amount:settings.amount}))}
}
export function FundedRewardsSetup({settings,onChange,disabled}:{settings:RewardSettings;onChange:(value:RewardSettings)=>void;disabled:boolean}) {
  const set=<K extends keyof RewardSettings>(key:K,value:RewardSettings[K])=>onChange({...settings,[key]:value})
  let validation=''
  if(settings.enabled)try{rewardConfig(settings)}catch(e){validation=explainError(e)}
  return <section className="ec-section fr-setup" aria-label="Funded reward settings">
    <label className="pf-field pf-toggle"><input type="checkbox" checked={settings.enabled} disabled={disabled} onChange={e=>set('enabled',e.target.checked)}/><span>Fund real testnet rewards</span></label>
    {settings.enabled&&<fieldset disabled={disabled}><legend>Creator funds the prize pool</legend><div className="fr-fields">
      <label>Reward type<select aria-label="Reward type" value={settings.kind} onChange={e=>set('kind',e.target.value as RewardSettings['kind'])}><option value="erc20">ERC-20 token</option><option value="erc721">NFT · ERC-721</option><option value="erc1155">NFT · ERC-1155</option><option value="eth">ETH</option><option value="key">Private-key wallet · private delivery</option></select></label>
      {settings.kind!=='eth'&&settings.kind!=='key'&&<label>Token / collection contract<input value={settings.token} onChange={e=>set('token',e.target.value)} placeholder="0x…" spellCheck={false}/></label>}
      {['erc721','erc1155'].includes(settings.kind)&&<label>NFT token ID<input inputMode="numeric" value={settings.tokenId} onChange={e=>set('tokenId',e.target.value)}/></label>}
      <label>Per-winner amount ({settings.kind==='eth'?'wei':'base units'})<input inputMode="numeric" value={settings.amount} onChange={e=>set('amount',e.target.value)}/></label>
      <label>Prize slots<input type="number" min={1} max={50} value={settings.count} onChange={e=>set('count',Number(e.target.value))}/></label>
      <label>Claim mode<select aria-label="Claim mode" value={settings.mode} onChange={e=>set('mode',e.target.value as RewardSettings['mode'])}><option value="auto">Auto · winner prompt + later code</option><option value="code">Code · wallet-bound redemption</option><option value="merkle">Merkle · fixed recipient list</option><option value="open">Open · first N wallets</option></select></label>
      <label>Claim deadline (local time)<input type="datetime-local" value={settings.deadline} onChange={e=>set('deadline',e.target.value)}/></label>
      {settings.mode==='merkle'&&<label>Fixed recipient wallets (one per rank)<textarea value={settings.recipients} onChange={e=>set('recipients',e.target.value)} placeholder="0x… , 0x…"/></label>}
    </div>
    <p>{settings.mode==='auto'?'Auto prompts the winner at settlement. Claim now and Claim later both use the same wallet-bound Code pool.':settings.mode==='open'?'Open pools pay the first N wallets. Prizes are not reserved for match winners.':settings.mode==='merkle'?'The root is fixed at pool creation. Only match winners matching this committed recipient list can redeem.':'The authority signs a one-time claim code for the allocated wallet.'}</p>
    {settings.kind==='key'?<p>Generate and fund a fresh wallet separately. Only its derived address belongs in public records. Private key delivery is off-chain and is not implemented by RewardEngine.</p>:<p>Code and Open rewards require the creator to confirm winner allocations after results. Publishing confirms pool creation and every deposit before binding the room.</p>}
    <ol className="ec-flow fr-flow" aria-label="Funded reward lifecycle">{[{icon:Wallet,title:'Deposit'},{icon:Link,title:'Pool bound'},{icon:Play,title:'Match runs'},{icon:Trophy,title:'Winners allocated'},{icon:Receipt,title:'Claim'}].map(({icon:Icon,title},i)=><li key={title}><span className="ec-step-icon"><Icon size={22}/><small>{i+1}</small></span><b>{title}</b></li>)}</ol>
    <article className="fr-card fr-preview" aria-label="Winner reward preview"><small>WINNER PREVIEW · NO CLAIM ISSUED</small><h4><Gift size={20}/> Your reward is ready</h4><p>{settings.amount} {settings.kind==='eth'?'wei ETH':`${settings.kind.toUpperCase()} base units`} · {settings.kind==='eth'?'native asset':settings.token||'collection or token'}</p><p>Claim by {settings.deadline.replace('T',' ')}</p><code>{settings.mode==='merkle'?'claimByMerkle(poolId, proof, winner, assetIndex, amount)':settings.mode==='open'?'claimOpen(poolId, allocIndex)':'claimByCode(poolId, allocIndex, nonce, signature)'}</code><div className="ct-actions"><button type="button" disabled className="btn-primary">Claim now</button>{['auto','code'].includes(settings.mode)&&<button type="button" disabled className="btn-ghost">Claim later</button>}</div></article>
    {validation&&<p role="alert" className="err">{validation}</p>}
    </fieldset>}
  </section>
}

function RewardCard({claim,session,onRefresh}:{claim:RewardClaim;session:{address:string|null;token:string|null};onRefresh:()=>void}) {
  const [status,setStatus]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[showCode,setShowCode]=useState(false)
  const redeem=async()=>{
    if(!session.address||busy)return
    setBusy(true);setError('')
    try{await claimReward(session.address,claim,setStatus);setConfirmed(true);setStatus('Receipt confirmed. Reward claimed.');onRefresh()}
    catch(e){setError(explainError(e))}finally{setBusy(false)}
  }
  const later=()=>{
    setShowCode(true)
    if(!claim.code||!session.address)return
    try{localStorage.setItem(`orbix-reward-code:${session.address.toLowerCase()}:${claim.claimId}`,claim.code);setStatus('Code saved for this wallet. Redeem it in My rewards before the deadline.')}
    catch{setStatus('Copy the code to keep it. Browser storage is unavailable.')}
  }
  return <article className="fr-card"><h4><Coins size={20}/> {confirmed||claim.claimed?'Reward confirmed':'Your reward'}</h4><p><b>{claim.amount}</b> {claim.assetKind==='eth'?'wei ETH':`${claim.assetKind.toUpperCase()} base units`} {['erc721','erc1155'].includes(claim.assetKind)?`· token #${claim.tokenId}`:''}</p><p className="mono">{claim.assetKind==='eth'?'Native ETH':claim.assetContract}</p><p>Claim by {new Date(claim.deadline*1000).toLocaleString()}</p>
    {claim.function&&<details><summary>Exact wallet call</summary><code>{claim.function}({claim.args?.map(arg=>typeof arg==='object'?JSON.stringify(arg):String(arg)).join(', ')})</code><p>Robinhood testnet 46630 · {claim.engine}</p></details>}
    {!confirmed&&!claim.claimed&&<div className="ct-actions"><button className="btn-primary" disabled={busy||!claim.payable} onClick={()=>void redeem()}>{busy?'Waiting for receipt…':'Claim now'}</button>{claim.code&&<button className="btn-ghost" disabled={busy} onClick={later}><KeyRound size={16}/> Claim later</button>}</div>}
    {showCode&&claim.code&&<div><label>Wallet-bound claim code<textarea aria-label="Wallet-bound claim code" readOnly value={claim.code}/></label><button className="btn-ghost" onClick={async()=>setStatus(await copyText(claim.code!)?'Claim code copied.':'Copy unavailable. Select the code manually.')}>Copy code</button><p>This code can be redeemed once by {claim.winner} against the same RewardEngine.</p></div>}
    {claim.reason&&<p>{claim.reason}</p>}{status&&<p role="status">{status}</p>}{error&&<p className="err" role="alert">{error}</p>}
  </article>
}
export function MyRewards({session,roomId}:{session:{address:string|null;token:string|null};roomId?:string}) {
  const [claims,setClaims]=useState<RewardClaim[]>([]),[code,setCode]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0)
  const refresh=()=>setRevision(v=>v+1)
  const walletToken=useRef(session.token)
  walletToken.current=session.token
  useEffect(()=>{setClaims([]);setCode('')},[session.address,session.token])
  useEffect(()=>{window.addEventListener('orbix-rewards-changed',refresh);return()=>window.removeEventListener('orbix-rewards-changed',refresh)},[])
  useEffect(()=>{
    let active=true
    setError('')
    if(!session.token){setLoading(false);return}
    setLoading(true)
    center.myRewards(session.token,roomId).then(r=>{if(active)setClaims(r.rewards)}).catch(e=>{if(active)setError(explainError(e))}).finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[session.token,session.address,roomId,revision])
  useEffect(()=>{
    if(!roomId||!session.token||error||claims.length>0&&claims.every(c=>c.claimed))return
    const timer=window.setInterval(refresh,10000)
    return()=>window.clearInterval(timer)
  },[roomId,session.token,error,claims])
  const lookup=async()=>{
    if(!session.token)return
    const requestedToken=session.token
    setError('');setLoading(true)
    try{const {claim}=await center.rewardLookup(code.trim(),requestedToken);if(walletToken.current!==requestedToken)return;setClaims(previous=>[claim,...previous.filter(c=>c.claimId!==claim.claimId)])}
    catch(e){setError(explainError(e))}finally{setLoading(false)}
  }
  return <section className="fr-rewards" aria-label="My rewards"><h3>My rewards</h3>{!session.token?<p>Sign in with your winning wallet to view rewards.</p>:<><label>Paste a claim code<textarea value={code} onChange={e=>setCode(e.target.value)} placeholder="OR3-…"/></label><div className="ct-actions"><button className="btn-ghost" disabled={loading||!code.trim()} onClick={()=>void lookup()}>Find reward</button><button className="btn-ghost" disabled={loading} onClick={refresh}>Refresh rewards</button></div>{loading&&<p role="status">Verifying rewards on chain…</p>}{error&&<p role="alert" className="err">{error}</p>}{!loading&&!error&&!claims.length&&<p>No allocated rewards for this wallet yet.</p>}{claims.map(claim=><RewardCard key={`${session.address}:${claim.claimId}`} claim={claim} session={session} onRefresh={()=>window.dispatchEvent(new Event('orbix-rewards-changed'))}/>)}</>}</section>
}
export function CreatorRewardAllocation({session,roomId}:{session:{address:string|null;token:string|null};roomId:string}) {
  const [plan,setPlan]=useState<RewardPlan|null>(null),[status,setStatus]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0)
  useEffect(()=>{let active=true;if(!session.token)return;center.rewardPlan(roomId,session.token).then(r=>{if(active)setPlan(r.plan)}).catch(e=>{if(active)setError(explainError(e))});return()=>{active=false}},[roomId,session.token,revision])
  const allocate=async()=>{if(!plan||!session.address)return;setBusy(true);setError('');try{await allocateRewardPlan(session.address,plan,setStatus);setStatus('Winner allocation receipts confirmed.');setRevision(v=>v+1);window.dispatchEvent(new Event('orbix-rewards-changed'))}catch(e){setError(explainError(e))}finally{setBusy(false)}}
  if(!plan&&!error)return null
  return <section className="fr-card"><h3>Confirm winner allocations</h3><p>RewardEngine requires the creator wallet to register Code and Open allocations. Winners can claim after these receipts confirm.</p>{plan&&plan.mode!=='merkle'&&<button className="btn-primary" disabled={busy||!plan.settled||plan.allocationCount>=plan.allocations.length} onClick={()=>void allocate()}>{busy?'Waiting for confirmation…':plan.allocationCount>=plan.allocations.length?'Allocations confirmed':'Confirm allocations in wallet'}</button>}{status&&<p role="status">{status}</p>}{error&&<p className="err" role="alert">{error}<button className="btn-ghost" onClick={()=>{setError('');setRevision(v=>v+1)}}>Retry</button></p>}</section>
}
