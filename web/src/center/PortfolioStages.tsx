import { lazy, Suspense, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { StageProps } from './stages'
import './portfolio.css'
const Scene=lazy(()=>import('./PortfolioScene').then(module=>({default:module.PortfolioScene})))
const NAMES:Record<string,string>={'closest-call':'Closest Call','word-forge':'Word Forge','prism-lines':'Prism Lines','relic-auction':'Relic Auction','atlas-quest':'Atlas Quest'}
const short=(who:string)=>who.length>12?`${who.slice(0,6)}…${who.slice(-4)}`:who
const keyFor=(game:string)=>game==='prism-lines'?'turnIndex':game==='relic-auction'?'auctionIndex':'challengeIndex'
function currentReceipt(state:StageProps['state'],field:string,game:string){const receipt=state[field];return receipt?.[keyFor(game)]===state.index?receipt:null}
function useInput(props:StageProps,game:string){
  const {state,act,me,finished}=props,key=keyFor(game)
  const own=currentReceipt(state,'ownSubmission',game)
  const open=!finished&&state.phase==='selection'&&state._canAct!==false&&(game!=='prism-lines'||state.currentPlayer===me)
  const [pending,setPending]=useState(false)
  useEffect(()=>{if(!pending)return;const retry=window.setTimeout(()=>setPending(false),5000);return()=>clearTimeout(retry)},[pending])
  useEffect(()=>setPending(false),[state.index,own?.receiptId,state._actionError])
  const send=(body:Record<string,unknown>)=>{if(!open||pending)return;setPending(true);act({...body,roundId:state.roundId,[key]:state.index,actionId:crypto.randomUUID()})}
  return {own,open,pending,send,locked:!open||pending||Boolean(own)}
}
function Shell({game,props,children}:{game:string;props:StageProps;children:ReactNode}){
 const {state,me,players,act,finished}=props
 const [clock,setClock]=useState(Date.now())
 const [offset,setOffset]=useState(0)
 useEffect(()=>{setOffset(state._serverOffsetMs??Number(state.serverTimeMs)-Date.now())},[state.serverTimeMs,state._serverOffsetMs])
 useEffect(()=>{const timer=window.setInterval(()=>setClock(Date.now()),250);return()=>clearInterval(timer)},[])
 const remaining=Math.max(0,Math.ceil((Number(state.phaseDeadline)*1000-clock-offset)/1000))
 const hint=currentReceipt(state,'hintReceipt',game),own=currentReceipt(state,'ownSubmission',game)
 const canHint=state.phase==='selection'&&!finished&&state._canAct!==false&&state.hints==='on'&&!hint&&(state.hintsRemaining??state.hintBudget)>0&&(game!=='prism-lines'||state.currentPlayer===me)
 const resolved=state.history?.filter((entry:any)=>entry.results||entry.bids).at(-1)
 return <section className={`pf-stage pf-${game}`} aria-label={NAMES[game]}>
   <header className="pf-hud"><div><small>{game==='prism-lines'?'TURN':'CHALLENGE'} {state.index+1}{state.rounds?` / ${state.rounds}`:''}</small><h2>{NAMES[game]}</h2></div><strong role="timer">{finished?'Finished':`${remaining}s · ${state.phase==='selection'?'Choose':'Result'}`}</strong><span>Your score: {state.scores?.[me]??0}</span></header>
   <div className="pf-layout"><Suspense fallback={<p role="status">Preparing tabletop…</p>}><Scene game={game} state={state} players={players}/></Suspense><div className="pf-controls">
     <h3>{state.challenge?.prompt??(game==='prism-lines'?state.currentPlayer===me?'Your turn: connect four':'Your rival is thinking…':'Inspect the relic and seal your bid.')}</h3>
     {children}
     <p className="pf-status" role="status">{own?'Choice locked. The server will reveal it automatically.':state.phase==='selection'?remaining<=1?'Send early: arrival at the server must precede the deadline.':game==='prism-lines'?'Your confirmed drop is visible immediately.':'Your draft stays local until you lock it.':'The server has resolved this phase.'}</p>
     {state._connection&&state._connection!=='open'&&<p role="status">Reconnecting… your accepted choice is preserved.</p>}
     {state._actionError&&<p role="alert">{String(state._actionError).replaceAll('_',' ')}</p>}
     <button className="btn-ghost" disabled={!canHint} onClick={()=>act({kind:'hint',hintKind:state.hintKind,roundId:state.roundId,[keyFor(game)]:state.index,actionId:crypto.randomUUID()})}>Private hint · {state.hintsRemaining??state.hintBudget} left{game==='atlas-quest'?' · −100 points':''}</button>
     {hint&&<aside className="pf-hint" role="status">{game==='word-forge'?`Sorted rack: ${hint.payload.sortedRack.toUpperCase()} · ${Object.entries(hint.payload.counts).map(([letter,count])=>`${letter.toUpperCase()} × ${count}`).join(', ')}`:game==='prism-lines'?`Open columns: ${hint.payload.columns.map((c:number)=>c+1).join(', ')}`:game==='relic-auction'?`${hint.payload.gameCredits} game credits · spent ${hint.payload.spent} · amber ${hint.payload.colours.amber}, jade ${hint.payload.colours.jade}, violet ${hint.payload.colours.violet}. ${hint.payload.formula} Set bonus: ${hint.payload.setBonus}.`:game==='closest-call'?`${hint.payload.lower}–${hint.payload.upper} ${hint.payload.unit}. ${hint.payload.message}`:hint.payload.message}</aside>}
     <p className="pf-rules">{state.tieRule} Preview points only by default. Outside tools can assist play.</p>
   </div></div>
   {resolved&&<section className="pf-result" aria-live="polite"><h3>Last result</h3>{resolved.answer!==undefined&&<p>{game==='atlas-quest'?`Answer cell: column ${resolved.answer.col+1}, row ${resolved.answer.row+1}. ${resolved.explanation}`:`Answer: ${resolved.answer} ${resolved.unit??''}`}</p>}{resolved.results&&<ul>{Object.entries(resolved.results).map(([who,row]:[string,any])=><li key={who}>{state._hidePlayers?'Player':who===me?'You':short(who)}: {game==='word-forge'?`${row.text??'No word'} · ${row.valid?'valid':'invalid or absent'}`:game==='atlas-quest'?`${row.distance??'—'} grid steps${row.hinted?' · hinted':''}`:`${row.value??'No estimate'} · error ${row.error??'—'}`} · {row.score} points</li>)}</ul>}{resolved.bids&&<><p>{resolved.winner?`${resolved.winner===me?'You':state._hidePlayers?'Player':short(resolved.winner)} bought the relic for ${resolved.paid} game credits.`:'All passed. Relic unsold.'}</p><ul>{Object.entries(resolved.bids).map(([who,bid])=><li key={who}>{who===me?'You':state._hidePlayers?'Player':short(who)}: {String(bid)} game credits</li>)}</ul></>}</section>}
   {game==='prism-lines'&&state.reason&&<p className="pf-result" role="status">{state.winner?`${state.winner===me?'You':state._hidePlayers?'Player':short(state.winner)} won · ${state.reason}`:`${state.reason}: no rewards.`}</p>}
   {finished&&state.tieOrder&&<p>Final seeded tie order: {state.tieOrder.map((who:string)=>who===me?'You':state._hidePlayers?'Player':short(who)).join(' → ')}</p>}
 </section>
}
export function ClosestCallStage(props:StageProps){
 const {state}=props,{own,send,locked,pending}=useInput(props,'closest-call'),challenge=state.challenge??{}
 const [value,setValue]=useState('')
 useEffect(()=>setValue(''),[state.index])
 return <Shell game="closest-call" props={props}><div className="pf-exhibit" aria-label="Exhibit diagram: each circle is one object"><svg viewBox="0 0 120 115" role="img" aria-label="Original estimate exhibit"><rect x="8" y="4" width="104" height="103" rx="12" fill="#fff3d5" stroke="#4168e8"/>{(challenge.display?.objects??[]).map((o:any,i:number)=><circle key={i} cx={10+o.x} cy={5+o.y} r="2.8" fill={['#ffb543','#28c7b7','#4168e8','#d67858'][o.tone]}/>)}<path d="M10 112h100" stroke="#4168e8" strokeWidth="2"/></svg></div><label>Your estimate ({challenge.lower}–{challenge.upper} {challenge.unit})<input type="number" inputMode="numeric" min={challenge.lower} max={challenge.upper} step="1" value={own?.submission??value} disabled={locked} onChange={e=>setValue(e.target.value)}/></label><button className="btn-primary" disabled={locked||value===''||!Number.isInteger(Number(value))||Number(value)<challenge.lower||Number(value)>challenge.upper} onClick={()=>send({kind:'estimate',value:Number(value)})}>{pending?'Sending…':own?'Estimate sealed':'Lock estimate'}</button><p>Score: 1000 minus your error as a share of the range. One estimate within 20% qualifies for rewards.</p></Shell>
}
export function WordForgeStage(props:StageProps){
 const {state}=props,{own,send,locked,pending}=useInput(props,'word-forge'),rack=String(state.challenge?.rack??'')
 const [word,setWord]=useState('')
 useEffect(()=>setWord(''),[state.index])
 const valid=word.length>=3&&word.length<=rack.length&&[...new Set(word)].every(letter=>word.split(letter).length<=rack.split(letter).length)
 return <Shell game="word-forge" props={props}><div className="pf-letters" aria-label="Available letters">{rack.split('').map((letter,i)=><button key={i} disabled={locked||word.split(letter).length>=rack.split(letter).length} onClick={()=>setWord(w=>w+letter)}>{letter.toUpperCase()}</button>)}</div><label>Your word<input value={own?.submission??word} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={locked} maxLength={rack.length} onChange={e=>setWord(e.target.value.toLowerCase().replace(/[^a-z]/g,''))}/></label><div className="pf-actions"><button className="btn-ghost" disabled={locked||!word} onClick={()=>setWord(w=>w.slice(0,-1))}>Remove letter</button><button className="btn-primary" disabled={locked||!valid} onClick={()=>send({kind:'word',text:word})}>{pending?'Sending…':own?'Word sealed':'Lock word'}</button></div><p>English only. 100 × length² + 25 for each Q, Z, J or X. Dictionary membership is revealed at close; one valid word qualifies.</p></Shell>
}
export function PrismLinesStage(props:StageProps){
 const {state,me}=props,{send,open,pending}=useInput(props,'prism-lines')
 return <Shell game="prism-lines" props={props}><div className="pf-columns" style={{'--columns':state.columns} as CSSProperties}>{Array.from({length:state.columns??5},(_,c)=><button key={c} aria-label={`Drop into column ${c+1}`} disabled={!open||pending||state.board?.[0]?.[c]!=null} onClick={()=>send({kind:'drop',column:c})}>↓ {c+1}</button>)}</div><div className="pf-board" role="grid" aria-label="Crystal board" style={{'--columns':state.columns} as CSSProperties}>{(state.board??[]).flatMap((row:any[],r:number)=>row.map((who,c)=><div role="gridcell" key={`${r}-${c}`} aria-label={`Row ${r+1}, column ${c+1}: ${who===me?'you':who?'opponent':'empty'}`} className={`${who===me?'is-you':who?'is-rival':''} ${state.winningCells?.some(([rr,cc]:number[])=>rr===r&&cc===c)?'is-winning':''}`}>{who===me?'◆':who?'●':'·'}</div>))}</div><p>Connect four horizontally, vertically or diagonally. Two consecutive missed own turns forfeit; a rival must have made a legal drop to win. Draws pay nobody.</p></Shell>
}
export function RelicAuctionStage(props:StageProps){
 const {state,me}=props,{own,send,locked,pending}=useInput(props,'relic-auction'),balance=state.balances?.[me]??0
 const [bid,setBid]=useState('0')
 useEffect(()=>setBid('0'),[state.index])
 return <Shell game="relic-auction" props={props}><div className="pf-relic"><strong>{state.challenge?.colour} {state.challenge?.prop}</strong><span>Value: {state.challenge?.value} · Set bonus: {state.setBonus}</span></div><p><strong>{balance} game credits</strong> remaining · {state.inventories?.[me]?.length??0} relics</p><label>Sealed bid (game credits)<input type="number" inputMode="numeric" min="0" max={balance} step="1" value={own?.submission??bid} disabled={locked} onChange={e=>setBid(e.target.value)}/></label><div className="pf-actions"><button className="btn-primary" disabled={locked||bid===''||!Number.isInteger(Number(bid))||Number(bid)<0||Number(bid)>balance} onClick={()=>send({kind:'bid',amount:Number(bid)})}>{pending?'Sending…':own?'Bid sealed':'Lock bid'}</button><button className="btn-ghost" disabled={locked} onClick={()=>send({kind:'bid',amount:0})}>Pass</button></div><p>Highest positive bid buys the relic at that price; others pay zero. Bid ties use the seeded seat order rotated by auction index. One amber, jade and violet forms a set. Rewards require a relic and positive profit. Game credits have no wallet value.</p></Shell>
}
// Original coarse outlines: a learning diagram, not third-party map tiles.
export function WorldMap(){return <svg viewBox="0 0 360 180" preserveAspectRatio="none" aria-hidden="true"><rect width="360" height="180" fill="#b8e4f8"/><g fill="#8ad66b" stroke="#63a65c" strokeWidth="1"><path d="M18 23L55 13L86 22L112 18L100 39L82 49L74 66L58 71L44 53L26 48Z"/><path d="M83 73L107 85L116 105L105 132L96 153L85 138L79 114L70 94Z"/><path d="M122 10L143 6L151 18L138 31L123 28Z"/><path d="M170 36L193 24L215 30L239 18L271 20L310 35L324 52L298 63L283 52L270 74L249 78L235 62L218 57L197 53L186 47L172 55Z"/><path d="M175 60L200 56L216 77L211 99L200 125L185 113L171 88L164 71Z"/><path d="M262 109L289 103L309 114L315 132L286 140L266 130Z"/><path d="M8 169L80 166L150 170L240 165L355 171V180H8Z"/></g><path d="M0 90H360" stroke="#fff" strokeDasharray="4 4"/></svg>}
export function AtlasQuestStage(props:StageProps){
 const {state}=props,{own,send,locked,pending}=useInput(props,'atlas-quest')
 const [pin,setPin]=useState({col:18,row:9}),[zoom,setZoom]=useState(1)
 useEffect(()=>{setPin({col:18,row:9});setZoom(1)},[state.index])
 const selected=own?.submission??pin,answer=state.phase!=='selection'?state.history?.at(-1)?.answer:null
 return <Shell game="atlas-quest" props={props}><div className="pf-map-scroll"><div className="pf-map" style={{width:`${zoom*100}%`}}><WorldMap/><div className="pf-map-grid" role="grid" aria-label="World map: 36 longitude columns and 18 latitude rows">{Array.from({length:648},(_,i)=>{const col=i%36,row=Math.floor(i/36),active=selected.col===col&&selected.row===row;return <button type="button" role="gridcell" key={i} tabIndex={active?0:-1} aria-selected={active} aria-label={`Column ${col+1}, row ${row+1}`} disabled={locked} className={active?'is-pin':answer?.col===col&&answer?.row===row?'is-answer':''} onClick={()=>setPin({col,row})} onKeyDown={e=>{const delta=({ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]} as Record<string,number[]>)[e.key];if(delta){e.preventDefault();const next={col:(col+delta[0]+36)%36,row:Math.max(0,Math.min(17,row+delta[1]))};setPin(next);(e.currentTarget.parentElement?.children[next.row*36+next.col] as HTMLElement)?.focus()}}}>{active?'●':answer?.col===col&&answer?.row===row?'✦':''}</button>})}</div></div></div><div className="pf-actions"><label>Map zoom<input type="range" min="1" max="6" step="0.5" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label><button className="btn-ghost" onClick={()=>setZoom(1)}>Reset view</button></div><div className="pf-actions"><label>Column<input type="number" min="1" max="36" value={selected.col+1} disabled={locked} onChange={e=>{const value=Number(e.target.value);if(Number.isInteger(value)&&value>=1&&value<=36)setPin(p=>({...p,col:value-1}))}}/></label><label>Row<input type="number" min="1" max="18" value={selected.row+1} disabled={locked} onChange={e=>{const value=Number(e.target.value);if(Number.isInteger(value)&&value>=1&&value<=18)setPin(p=>({...p,row:value-1}))}}/></label></div><button className="btn-primary" disabled={locked} onClick={()=>send({kind:'pin',...pin})}>{pending?'Sending…':own?'Pin sealed':'Lock pin'}</button><p>1000 − 40 × grid distance, with 100 points deducted for a hint. Longitude wraps; latitude does not. This is grid distance, not kilometres. A pin within five steps qualifies.</p></Shell>
}
