import { useCallback, useEffect, useRef, useState } from 'react'
import { STAGES } from './stages'
import { FOUR_STAGE_VIEWS } from './GamePlayStages'
import { OfflinePreviewEngine, PREVIEW_TEMPLATE_IDS } from './OfflinePreviewEngine'
import { FEATURED_GAMES } from './featuredGames'
import { RoundImmersion, type ImmersionHandle } from './RoundImmersion'
import './practice.css'
import './gameCustomization.css'

export function PreviewArena({ templateId }: { templateId: string }) {
  const [revision, setRevision] = useState(0)
  const [seed, setSeed] = useState('orbix-offline-demo-v1')
  const [active, setActive] = useState(true)
  const activeRef = useRef(active)
  activeRef.current = active
  const engine = useRef<OfflinePreviewEngine | null>(null)
  const [state, setState] = useState<Record<string, any> | null>(null)
  const immersion = useRef<ImmersionHandle>(null)
  const valid = PREVIEW_TEMPLATE_IDS.includes(templateId)
  const Stage = FOUR_STAGE_VIEWS[templateId] ?? STAGES[templateId]
  useEffect(() => {document.title = 'Preview — offline demo | Orbix'}, [])
  useEffect(() => {
    if (!valid) return
    const local = new OfflinePreviewEngine(templateId, seed)
    engine.current = local; setState(local.snapshot())
    let frame = 0, previous = performance.now(), lastRender = 0
    const animated = ['token-catch','boss-raid','combat-duel','idle-rig'].includes(templateId)
    const animate = (now: number) => {
      if (!document.hidden && activeRef.current) {local.tick((now-previous)/1000);if(local.advance())setState(local.snapshot())}
      previous=now
      if (animated && now-lastRender >= 33) {setState(local.snapshot());lastRender=now}
      frame=requestAnimationFrame(animate)
    }
    frame=requestAnimationFrame(animate)
    return () => {cancelAnimationFrame(frame);engine.current=null}
  }, [templateId, revision, seed, valid])
  const act = useCallback((payload: Record<string, unknown>) => {
    const local=engine.current
    if (!local) return
    if (!activeRef.current) return
    local.act(payload);setState(local.snapshot())
  }, [])
  const title = FEATURED_GAMES.find(game => game.id===templateId)?.name ?? templateId.split('-').map(word=>word[0]?.toUpperCase()+word.slice(1)).join(' ')
  return <div className="ct-app"><main className="ct-practice">
    <header className="ct-practice-header"><a className="btn-ghost" href="/center">← Game center</a><div><span>Local playground</span><h1>{title}</h1></div><button className="btn-primary" onClick={() => setRevision(value=>value+1)}>Reset preview</button></header>
    <p className="ct-practice-note">Preview — offline demo. Explore the same game stage with local controls and sample data. Demo scores are illustrative and stay in memory. No room, connection, account or rewards.</p>
    {!valid || !Stage ? <p role="alert">This game template is unavailable.</p> : <>
      <details><summary>Preview settings</summary><label>Local demo seed <input aria-label="Local demo seed" maxLength={60} value={seed} onChange={e=>setSeed(e.target.value)}/></label><button className="btn-ghost" onClick={()=>setActive(value=>!value)}>{active?'Pause demo':'Resume demo'}</button></details>
      <button className="btn-ghost" onClick={()=>immersion.current?.enter()}>Expand preview</button>
      <RoundImmersion ref={immersion} active={active} roundId={`offline-${templateId}-${revision}`} movement={['token-catch','boss-raid','combat-duel'].includes(templateId)}>{() => <><span className="gc-offline-badge" role="status">Preview — offline demo</span>{state && engine.current && <Stage state={{...state,_offline:true,_canAct:active,_connection:'open'}} act={act} me={engine.current.me} players={engine.current.players} finished={false}/>}</>}</RoundImmersion>
    </>}
  </main></div>
}
