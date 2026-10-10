import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, RefreshCw, Sparkles } from 'lucide-react'
import { FOUR_STAGE_VIEWS } from './GamePlayStages'
import { FEATURED_GAMES } from './featuredGames'
import { RoundImmersion, type ImmersionHandle } from './RoundImmersion'
import { localPlacement } from './resultPresentation'
import './practice.css'
const WinnerCelebration = lazy(() => import('./WinnerCelebration'))

type Practice = {practiceId:string;accessToken:string;me:string;players:string[];state:Record<string,any>;serverTimeMs:number;deadline:number}
const base = '/api/center/v1/practice'
async function request(path:string,init?:RequestInit) {
  const res = await fetch(path,{...init,headers:{'Content-Type':'application/json',...init?.headers}})
  const data = await res.json()
  if(!res.ok) throw new Error(data.detail?.message ?? data.detail?.code ?? 'Practice could not load.')
  return data
}

export function PracticeArena({templateId,navigate}:{templateId:string;navigate:(path:string)=>void}) {
  const [practice,setPractice] = useState<Practice|null>(null)
  const [error,setError] = useState<string|null>(null)
  const immersion = useRef<ImmersionHandle>(null)
  const [started,setStarted] = useState(false)
  const [retry,setRetry] = useState(0)
  const resultElement = useRef<HTMLElement>(null)
  const scrolled = useRef<string | null>(null)
  const [presented, setPresented] = useState<string | null>(null)
  const practiceId = practice?.practiceId
  const finished = Boolean(practice?.state.finished)
  const placements = practice?.state.finalPlacements ?? []
  const hasPodium = placements.some((row: any) => row.rank <= 3)
  useEffect(() => {
    if (!finished) { scrolled.current = null; return }
    if (!practiceId || hasPodium && presented !== practiceId || scrolled.current === practiceId) return
    const frame = requestAnimationFrame(() => {
      if (!resultElement.current) return
      scrolled.current = practiceId
      resultElement.current.focus({preventScroll:true})
      resultElement.current.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})
    })
    return () => cancelAnimationFrame(frame)
  }, [practiceId, finished, hasPodium, presented])
  const latest = useRef<Practice|null>(null)
  const pending = useRef(false)
  const generation = useRef(0)
  const actionError = useRef<string|null>(null)
  const queue=useRef<Record<string,unknown>[]>([])
  const pump=useRef<()=>void>(()=>{})
  const title = FEATURED_GAMES.find(g=>g.id===templateId)?.name ?? templateId
  const Stage = FOUR_STAGE_VIEWS[templateId]
  useEffect(()=> {
    if (!started) return
    let active=true;let polling=false
    const current=++generation.current
    queue.current=[];pending.current=false
    setPractice(null);latest.current=null;setError(null)
    request(base,{method:'POST',body:JSON.stringify({templateId})}).then(data=> {
      if(active){latest.current=data;setPractice(data)}
      else void request(`${base}/${data.practiceId}`,{method:'DELETE',headers:{'X-Practice-Token':data.accessToken}}).catch(()=>{})
    }).catch(err=>{if(active){immersion.current?.minimize();setError(err.message)}})
    const timer=window.setInterval(async()=> {
      const match=latest.current
      if(!active || !match || polling || pending.current || document.hidden || match.state.finished)return
      polling=true
      try {
        const data=await request(`${base}/${match.practiceId}`,{headers:{'X-Practice-Token':match.accessToken}})
        if(active && current===generation.current && data.serverTimeMs>=(latest.current?.serverTimeMs??0)){const next={...match,...data};latest.current=next;setPractice(next)}
      } catch(err){if(active)setError(err instanceof Error?err.message:'Practice connection interrupted.')}
      finally{polling=false}
    },100)
    return()=> {
      active=false;window.clearInterval(timer)
      const match=latest.current
      if(match)void request(`${base}/${match.practiceId}`,{method:'DELETE',headers:{'X-Practice-Token':match.accessToken}}).catch(()=>{})
      latest.current=null
      queue.current=[]
      generation.current++
    }
  },[templateId,retry,started])
  pump.current=()=> {
    const match=latest.current
    if(!match || pending.current)return
    const action=queue.current.shift()
    if(!action)return
    const current=generation.current
    pending.current=true
    void request(`${base}/${match.practiceId}/actions`,{method:'POST',body:JSON.stringify({token:match.accessToken,action})})
      .then(data=> {
        if(current!==generation.current)return
        actionError.current=data.ok?null:data.error
        if(data.serverTimeMs>=(latest.current?.serverTimeMs??0)){const next={...match,...data};latest.current=next;setPractice(next)}
      }).catch(err=>{if(current===generation.current)setError(err.message)})
      .finally(()=>{if(current===generation.current){pending.current=false;pump.current()}})
  }
  const act=useCallback((action:Record<string,unknown>)=> {
    if(action.kind==='move')queue.current=queue.current.filter(item=>item.kind!=='move')
    if(queue.current.length<20)queue.current.push(action)
    pump.current()
  },[])
  return <main className="ct-practice">
    <header className="ct-practice-header"><button className="btn-ghost" onClick={()=>navigate('/center')}><ArrowLeft size={18}/> Game center</button><div><span><Sparkles size={15}/> Try the playground</span><h1>{title}</h1></div><button className="btn-primary" onClick={()=>{immersion.current?.enter();setStarted(true);setRetry(v=>v+1)}}><RefreshCw size={16}/> Restart practice</button></header>
    <p className="ct-practice-note">Practice with bots. No room, wallet, entry fee or rewards. Collected tokens are game score.</p>
    {error && <p role="alert" className="ct-error">{error}</p>}
    <RoundImmersion ref={immersion} active={started && !finished} roundId={practice?.practiceId ?? ''} movement={['token-catch','boss-raid','combat-duel'].includes(templateId)}>{()=><>
    {!started && <button className="btn-primary" onClick={()=>{immersion.current?.enter();setStarted(true)}}>Start practice</button>}
    {started && !practice && !error && <section className="ct-practice-loader" role="status"><span aria-hidden="true">✦</span><h2>Preparing your playground</h2><p>Loading a small world and its controls…</p></section>}
    {practice && Stage && <Stage state={{...practice.state,_practice:true,roundId:practice.state.roundId ?? practice.practiceId,_roomId:practice.practiceId,_roundId:practice.state.roundId ?? practice.practiceId,__deadline:practice.deadline,_serverOffsetMs:practice.serverTimeMs-Date.now(),_canAct:!practice.state.finished,_connection:'open',_actionError:actionError.current}} act={act} me={practice.me} players={practice.players} finished={Boolean(practice.state.finished)}/>}
    </>}</RoundImmersion>
    {practice?.state.finished && <section ref={resultElement} className="ct-round-results" tabIndex={-1} aria-label="Practice results"><aside className="ct-practice-result"><strong>Practice complete</strong><p>Try another character, restart, or create a multiplayer room from the game center.</p></aside><Suspense fallback={<p role="status">Preparing practice results…</p>}><WinnerCelebration winners={placements.filter((row: any) => row.rank <= 3).slice(0,3).map((row: any) => ({wallet:row.who,name:row.who===practice.me?'You':'Practice bot',rank:row.rank,score:row.score,character:practice.state.bodies?.[row.who]?.character}))} me={practice.me} localPlacement={localPlacement(placements,practice.me,practice.state.teams,practice.state.teamRankings)} onPresented={() => setPresented(practice.practiceId)} rewardNote="Practice scores have no token payouts, entry payments or claims." /></Suspense></section>}
  </main>
}
