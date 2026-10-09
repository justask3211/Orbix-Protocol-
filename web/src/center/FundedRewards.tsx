import { useEffect, useState, useRef } from 'react'
import { Coins, Gift, Link, Play, Trophy, Wallet, KeyRound, Receipt } from 'lucide-react'
import { type Address } from 'viem'
import { center, explainError } from './api'
import { allocateRewardPlan, claimReward, type FundedConfig, type RewardClaim, type RewardPlan } from './rewardWallet'
import { copyText } from './share'
import {NftSelector} from './NftSelector'
import {nftMetadata,type Nft} from './nftWallet'
import {nftReadWallet} from './nftWallet'
import './creatorEconomy.css'
import './fundedRewards.css'

export type RewardSettings = {enabled:boolean; kind:'erc20'|'erc721'|'erc1155'|'eth'|'key'|'waitlist-drop'; token:string; amount:string; tokenId:string; tokenIds:string[]; count:number; mode:'auto'|'code'|'merkle'|'open'; deadline:string; recipients:string; waitlistSource:string; distribution:'match'|'drop'}
export const initialRewardSettings = ():RewardSettings => ({enabled:false,kind:'erc20',token:'',amount:'1',tokenId:'0',tokenIds:[],count:1,mode:'auto',deadline:new Date(Date.now()+7*86400000-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16),recipients:'',waitlistSource:'',distribution:'match'})
export function rewardConfig(settings:RewardSettings): FundedConfig {
  if(settings.kind==='key') throw new Error('Private-key delivery is not available yet. Choose a token, NFT or ETH pool.')
  const kind=settings.kind==='waitlist-drop'?'erc20':settings.kind
  const address=kind==='eth'?'0x0000000000000000000000000000000000000000':settings.token.trim()
  if(!/^0x[0-9a-fA-F]{40}$/.test(address)||kind!=='eth'&&BigInt(address)===0n)throw new Error('Enter a valid nonzero reward token or collection address.')
  if(!/^\d+$/.test(settings.amount)||BigInt(settings.amount)<=0n||BigInt(settings.amount)>=2n**256n)throw new Error('Enter a positive reward amount in token base units or wei.')
  if(!/^\d+$/.test(settings.tokenId)||BigInt(settings.tokenId)>=2n**256n)throw new Error('Enter a valid NFT token ID.')
  if(!Number.isInteger(settings.count)||settings.count<1||settings.count>50)throw new Error('Choose between 1 and 50 prize slots.')
  if(kind==='erc721'&&(settings.amount!=='1'||settings.tokenIds.length!==settings.count||new Set(settings.tokenIds).size!==settings.count))throw new Error('Select one distinct verified NFT for each prize slot; ERC-721 amount is 1.')
  if(BigInt(settings.amount)*BigInt(settings.count)>=2n**256n)throw new Error('Total reward amount is too large.')
  const deadline=Math.floor(new Date(settings.deadline).getTime()/1000)
  if(!Number.isFinite(deadline)||deadline<=Date.now()/1000+3700)throw new Error('Choose a claim deadline more than one hour from now.')
  const recipients=settings.recipients.split(/[\s,]+/).filter(Boolean)
  if(settings.mode==='merkle'&&(recipients.length!==settings.count||recipients.some(a=>!/^0x[0-9a-fA-F]{40}$/.test(a)||BigInt(a)===0n)||new Set(recipients.map(a=>a.toLowerCase())).size!==recipients.length))throw new Error('Merkle mode needs one distinct nonzero recipient wallet per slot before funding.')
  if(settings.kind==='waitlist-drop'&&!settings.waitlistSource.trim())throw new Error('Load the creator-owned waitlist before funding this drop.')
  return {kind:'funded-assets',claim_mode:settings.mode,claim_deadline:deadline,merkle_winners:settings.mode==='merkle'?recipients:[],distribution:settings.distribution,waitlist_source:settings.kind==='waitlist-drop'?settings.waitlistSource.trim():undefined,slots:Array.from({length:settings.count},(_,i)=>({rank:i+1,asset_kind:kind,asset_contract:address as Address,token_id:kind==='erc721'?settings.tokenIds[i]:kind==='erc1155'?settings.tokenId:'0',amount:settings.amount}))}
}
export function FundedRewardsSetup({settings,onChange,disabled,session,templateId}:{settings:RewardSettings;onChange:(value:RewardSettings)=>void;disabled:boolean;session:{address:string|null;token:string|null};templateId:string}) {
  const set=<K extends keyof RewardSettings>(key:K,value:RewardSettings[K])=>onChange({...settings,[key]:value})
  const [notice,setNotice]=useState(''),[loading,setLoading]=useState(false),[capability,setCapability]=useState<{available:boolean;reason?:string}|null>(null)
  useEffect(()=>{if(!settings.enabled)return;let active=true;center.rewardCapabilities().then(status=>{if(active)setCapability(status)}).catch(()=>{if(active)setCapability({available:false,reason:'Funding availability could not be verified. Retry before funding.'})});return()=>{active=false}},[settings.enabled])
  let validation=''
  if(settings.enabled)try{rewardConfig(settings);if(settings.distribution==='match'&&['boss-raid','token-catch'].includes(templateId)&&settings.kind!=='erc20')validation='This game splits a shared ERC-20 pool. NFT and ETH match prizes are not available yet; choose a fixed or public drop.'}catch(e){validation=explainError(e)}
  const kind=settings.kind==='waitlist-drop'?'erc20':settings.kind
  const loadWaitlist=async()=>{if(!session.token)return;setLoading(true);setNotice('');try{const result=await center.waitlistRewards(settings.waitlistSource.trim(),session.token);onChange({...settings,mode:'merkle',distribution:'drop',recipients:result.wallets.join('\n'),count:result.count});setNotice(`${result.count} distinct wallets loaded. The server builds an immutable Merkle root from these wallets and amounts before funding.`)}catch(e){setNotice(explainError(e))}finally{setLoading(false)}}
  return <section className="ec-section fr-setup" aria-label="Funded reward settings">
    <label className="pf-field pf-toggle"><input type="checkbox" checked={settings.enabled} disabled={disabled} onChange={e=>set('enabled',e.target.checked)}/><span>Fund real testnet rewards</span></label>
    {settings.enabled&&<fieldset disabled={disabled}><legend>Creator funds the prize pool</legend><p>Funding and claims require a connected browser wallet or WalletConnect. Reward transactions from generated or recovered local wallets are not available yet.</p>{capability&&!capability.available&&<p role="status" className="fr-unavailable">{capability.reason}</p>}<div className="fr-fields">
      <label>Reward type<select aria-label="Reward type" value={settings.kind} onChange={e=>{const kind=e.target.value as RewardSettings['kind'];onChange({...settings,kind,tokenIds:[],amount:kind==='erc721'?'1':settings.amount,token:kind===settings.kind?settings.token:'',...(kind==='waitlist-drop'?{mode:'merkle',distribution:'drop'}:{})})}}><option value="erc20">ERC-20 token</option><option value="erc721">NFT · ERC-721</option><option value="erc1155">NFT · ERC-1155</option><option value="eth">ETH</option><option value="waitlist-drop">Waitlist token drop</option><option value="key">Private-key wallet · not available yet</option></select></label>
      {kind!=='eth'&&kind!=='key'&&<label>Token / collection contract<input value={settings.token} onChange={e=>onChange({...settings,token:e.target.value,tokenIds:[]})} placeholder="0x…" spellCheck={false}/></label>}
      {kind==='erc721'&&<NftSelector address={session.address} collection={settings.token} selected={settings.tokenIds} onSelect={ids=>onChange({...settings,tokenIds:ids,count:ids.length||1,amount:'1'})} disabled={disabled}/>}
      {kind==='erc1155'&&<label>NFT token ID<input inputMode="numeric" value={settings.tokenId} onChange={e=>set('tokenId',e.target.value)}/></label>}
      <label>Per-winner amount ({kind==='eth'?'wei':'base units'})<input inputMode="numeric" value={settings.amount} disabled={kind==='erc721'} onChange={e=>set('amount',e.target.value)}/></label>
      <label>Prize slots<input type="number" min={1} max={50} value={settings.count} disabled={kind==='erc721'||settings.kind==='waitlist-drop'} onChange={e=>set('count',Number(e.target.value))}/></label>
      {settings.kind!=='waitlist-drop'&&<label>Claim mode<select aria-label="Claim mode" value={settings.mode} onChange={e=>{const mode=e.target.value as RewardSettings['mode'];onChange({...settings,mode,distribution:['merkle','open'].includes(mode)?'drop':'match'})}}><option value="auto">Auto prompt · winner signs a claim</option><option value="code">Code · wallet-bound redemption</option><option value="merkle">Merkle · fixed wallet drop</option><option value="open">Open · first N distinct wallets</option></select></label>}
      <label>Claim deadline (local time)<input type="datetime-local" value={settings.deadline} onChange={e=>set('deadline',e.target.value)}/></label>
      {settings.kind==='waitlist-drop'&&<><label>Source waitlist room ID<input value={settings.waitlistSource} onChange={e=>onChange({...settings,waitlistSource:e.target.value,recipients:''})}/></label><button type="button" className="btn-ghost" disabled={loading||!session.token||!settings.waitlistSource.trim()} onClick={()=>void loadWaitlist()}>Distribute to this waitlist</button><p role="status">{notice}</p></>}
      {settings.mode==='merkle'&&<label>Fixed recipient wallets (one per selected NFT or slot)<textarea value={settings.recipients} readOnly={settings.kind==='waitlist-drop'} onChange={e=>set('recipients',e.target.value)} placeholder="0x… , 0x…"/></label>}
    </div>
    <article className="fr-card" aria-label="Reward mechanism"><h4>{settings.kind==='waitlist-drop'?'Waitlist token drop':kind.toUpperCase()} mechanism</h4><p>RewardEngine holds the deposited assets in this pool. Entry fees use CreatorTokenGate separately.</p><p>{kind==='eth'?'Approval: none. depositETH sends the exact wei amount.':kind==='erc721'?'Approval: approve(engine, tokenId) for each selected NFT. Each depositERC721 locks that exact ID into the same pool; no collection-wide permission is requested.':kind==='erc1155'?'Approval: ERC-1155 requires setApprovalForAll(engine, true). This permits all IDs in the collection; revoke it after deposits using your wallet. depositERC1155 locks the chosen ID and quantity.':'Approval: exact aggregate approve(engine, amount), then depositERC20. Amounts are token base units; fee-on-transfer deposits are rejected.'}</p><p>{settings.mode==='auto'?'Auto prompts the winner after server-confirmed results; the recipient still confirms a transaction. Claim now and Claim later use Code mode, not an automatic transfer.':settings.mode==='open'?'Anyone can claim an available slot once per wallet, up to N distinct wallets. Creator confirms public allocations after publication. This drop is independent of game placements.':settings.mode==='merkle'?'The server builds the Merkle tree before funding. The root is committed at createPool; only the fixed recipient wallets can receive their exact asset and amount. A waitlist snapshot includes non-winners and cannot grow after funding.':'Only the wallet assigned by server-confirmed game results can redeem its signed allocation. Creator confirms allocations after settlement.'}</p><p>Claim transfers the token, exact NFT ID or ETH from RewardEngine to the eligible wallet. Receipt status 0x1 confirms delivery. After the deadline claims close and the creator reclaims only this pool’s remaining assets.</p></article>
    {kind==='erc721'&&settings.tokenIds.length>0&&<ol aria-label="NFT winner assignments">{settings.tokenIds.map((id,i)=><li key={id}>NFT #{id} → {settings.mode==='merkle'?settings.recipients.split(/[\s,]+/).filter(Boolean)[i]||`recipient ${i+1}`:settings.mode==='open'?`public claim slot ${i+1}`:`winner rank ${i+1}`}</li>)}</ol>}
    <p>Multi-NFT funding uses separate resumable deposits; an atomic batch transaction is not available yet. A creator reclaim button is not available yet; after expiry, the creator wallet can call reclaimExpired(poolId) on RewardEngine.</p>
    {kind==='key'&&<p>Private-key delivery is not available yet. Never enter a private key here.</p>
    }
    <ol className="ec-flow fr-flow" aria-label="Funded reward lifecycle">{[{icon:Wallet,title:'Deposit'},{icon:Link,title:'Pool bound'},{icon:Play,title:settings.distribution==='drop'?'Drop published':'Match runs'},{icon:Trophy,title:'Allocations'},{icon:Receipt,title:'Claim'}].map(({icon:Icon,title},i)=><li key={title}><span className="ec-step-icon"><Icon size={22}/><small>{i+1}</small></span><b>{title}</b></li>)}</ol>
    <article className="fr-card fr-preview" aria-label="Winner reward preview"><small>WINNER PREVIEW · NO CLAIM ISSUED</small><h4><Gift size={20}/> Your reward</h4><p>{settings.amount} {kind==='eth'?'wei ETH':`${kind.toUpperCase()} base units`} · {settings.token||'native asset'}</p><p>Claim by {settings.deadline.replace('T',' ')}</p><code>{settings.mode==='merkle'?'claimByMerkle(poolId, proof, winner, assetIndex, amount)':settings.mode==='open'?'claimOpen(poolId, allocIndex)':'claimByCode(poolId, allocIndex, nonce, signature)'}</code></article>
    {validation&&<p role="alert" className="err">{validation}</p>}
    </fieldset>}
  </section>
}

function RewardCard({claim,session,onRefresh}:{claim:RewardClaim;session:{address:string|null;token:string|null};onRefresh:()=>void}) {
  const [status,setStatus]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[showCode,setShowCode]=useState(false)
  const [nft,setNft]=useState<Nft|null>(null)
  useEffect(()=>{let active=true;if(['erc721','erc1155'].includes(claim.assetKind)&&session.address)void nftReadWallet().then(wallet=>nftMetadata(claim.assetContract as Address,claim.tokenId,wallet,claim.assetKind as 'erc721'|'erc1155')).then(result=>{if(active)setNft(result)}).catch(()=>{});return()=>{active=false}},[claim.assetKind,claim.assetContract,claim.tokenId,session.address])
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
  return <article className="fr-card"><h4><Coins size={20}/> {confirmed||claim.claimed?'Reward confirmed':'Your reward'}</h4><p><b>{claim.amount}</b> {claim.assetKind==='eth'?'wei ETH':`${claim.assetKind.toUpperCase()} base units`} {['erc721','erc1155'].includes(claim.assetKind)?`· token #${claim.tokenId}`:''}</p><p>Recipient: <span className="mono">{claim.winner}</span></p>{nft?.image&&<img className="fr-nft-image" src={nft.image} alt={nft.name||`NFT #${claim.tokenId}`} referrerPolicy="no-referrer"/>}<p className="mono">{claim.assetKind==='eth'?'Native ETH':claim.assetContract}</p><p>Claim by {new Date(claim.deadline*1000).toLocaleString()}</p>
    {claim.function&&<details><summary>Exact wallet call</summary><code>{claim.function}({claim.args?.map(arg=>typeof arg==='object'?JSON.stringify(arg):String(arg)).join(', ')})</code><p>Robinhood testnet 46630 · {claim.engine}</p></details>}
    {!confirmed&&!claim.claimed&&<div className="ct-actions"><button className="btn-primary" disabled={busy||!claim.payable} onClick={()=>void redeem()}>{busy?'Waiting for receipt…':'Claim now'}</button>{claim.code&&<button className="btn-ghost" disabled={busy} onClick={later}><KeyRound size={16}/> Claim later</button>}</div>}
    {showCode&&claim.code&&<div><label>Wallet-bound claim code<textarea aria-label="Wallet-bound claim code" readOnly value={claim.code}/></label><button className="btn-ghost" onClick={async()=>setStatus(await copyText(claim.code!)?'Claim code copied.':'Copy unavailable. Select the code manually.')}>Copy code</button><p>This code can be redeemed once by {claim.winner} against the same RewardEngine.</p></div>}
    {claim.reason&&<p>{claim.reason}</p>}{status&&<p role="status">{status}</p>}{error&&<p className="err" role="alert">{error}</p>}
  </article>
}
export function MyRewards({session,roomId,onContinue}:{session:{address:string|null;token:string|null};roomId?:string;onContinue?:()=>void}) {
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
  return <section className="fr-rewards" aria-label="My rewards"><h3>My rewards</h3>{!session.token?<p>Sign in with your winning wallet to view rewards.</p>:<><label>Paste a claim code<textarea value={code} onChange={e=>setCode(e.target.value)} placeholder="OR3-…"/></label><div className="ct-actions"><button className="btn-ghost" disabled={loading||!code.trim()} onClick={()=>void lookup()}>Find reward</button><button className="btn-ghost" disabled={loading} onClick={refresh}>Refresh rewards</button></div>{loading&&<p role="status">Verifying rewards on chain…</p>}{error&&<p role="alert" className="err">{error}</p>}{!loading&&!error&&!claims.length&&<p>No allocated rewards for this wallet yet.</p>}{claims.map(claim=><RewardCard key={`${session.address}:${claim.claimId}`} claim={claim} session={session} onRefresh={()=>window.dispatchEvent(new Event('orbix-rewards-changed'))}/>) }{onContinue&&!loading&&<button className="btn-primary" onClick={onContinue}>Continue to form rewards</button>}</>}</section>
}
export function CreatorRewardAllocation({session,roomId}:{session:{address:string|null;token:string|null};roomId:string}) {
  const [plan,setPlan]=useState<RewardPlan|null>(null),[status,setStatus]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0)
  useEffect(()=>{let active=true;if(!session.token)return;center.rewardPlan(roomId,session.token).then(r=>{if(active)setPlan(r.plan)}).catch(e=>{if(active)setError(explainError(e))});return()=>{active=false}},[roomId,session.token,revision])
  const allocate=async()=>{if(!plan||!session.address)return;setBusy(true);setError('');try{await allocateRewardPlan(session.address,plan,setStatus);setStatus('Winner allocation receipts confirmed.');setRevision(v=>v+1);window.dispatchEvent(new Event('orbix-rewards-changed'))}catch(e){setError(explainError(e))}finally{setBusy(false)}}
  if(!plan&&!error)return null
  return <section className="fr-card"><h3>Confirm winner allocations</h3><p>RewardEngine requires the creator wallet to register Code and Open allocations. Eligible wallets can claim after these receipts confirm.</p>{plan&&plan.mode!=='merkle'&&<button className="btn-primary" disabled={busy||!plan.settled||plan.allocationCount>=plan.allocations.length} onClick={()=>void allocate()}>{busy?'Waiting for confirmation…':plan.allocationCount>=plan.allocations.length?'Allocations confirmed':'Confirm allocations in wallet'}</button>}{status&&<p role="status">{status}</p>}{error&&<p className="err" role="alert">{error}<button className="btn-ghost" onClick={()=>{setError('');setRevision(v=>v+1)}}>Retry</button></p>}</section>
}
