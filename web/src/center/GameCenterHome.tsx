import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, ChevronDown, Coins, Gamepad2, KeyRound, Search, ShieldCheck, Sparkles, Wallet } from 'lucide-react'
import { center, explainError, type TemplateMeta } from './api'
import { BannerBadges } from './BannerBadges'
import { GameArtwork as Artwork } from './GameArtwork'
import { useCenterBalances } from './CenterBalance'
import { FEATURED_GAMES } from './featuredGames'
import { shortAddress, type SessionState } from './session'
import { OPEN_ROOM_STATES, roomPathFromInput, usePublicRooms } from './roomDiscovery'
import './home.css'
export { roomPathFromInput } from './roomDiscovery'

export type GameCenterHomeProps = {
  session: SessionState
  onConnect: () => void
  navigate: (path: string) => void
}


const amountFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 })
function chainAmount(value: number | null | undefined) {
  return value == null ? 'Unavailable' : amountFormat.format(value / 1e18)
}

export function GameCenterHome({ session, onConnect, navigate }: GameCenterHomeProps) {
  const [templates, setTemplates] = useState<TemplateMeta[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const { rooms, loading: roomsLoading, error: roomError, updatedAt: lastRoomUpdate, refreshing: roomsRefreshing, refresh: refreshRooms } = usePublicRooms()
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'catalog'|'more'>('catalog')
  const [filter, setFilter] = useState('All games')
  const [roomGame, setRoomGame] = useState('all')
  const [joinInput, setJoinInput] = useState('')
  const [joinError, setJoinError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const joinField = useRef<HTMLInputElement>(null)
  const balances = useCenterBalances(session.token, session.address)

  useEffect(() => {
    let active = true
    setTemplatesLoading(true)
    setTemplateError(null)
    center.templates().then((result) => { if (active) setTemplates(result.templates) })
      .catch((error) => { if (active) setTemplateError(explainError(error)) })
      .finally(() => { if (active) setTemplatesLoading(false) })
    return () => { active = false }
  }, [retry])

  const openRooms = useMemo(() => rooms.filter(room => room.visibility === 'public' && OPEN_ROOM_STATES.has(room.status) && templates.some(t=>t.templateId===room.templateId && t.available_modes?.join !== false && t.placement!=='hidden' && t.placement!=='upcoming' && t.playStatus==='live')), [rooms,templates])
  const matchingRooms = openRooms.filter(room => roomGame === 'all' || room.templateId === roomGame)
  const templateById = new Map(templates.map(template => [template.templateId, template]))
  const allGames = templates.filter(t=>t.placement!=='hidden' && t.playStatus!=='offline').map(t => FEATURED_GAMES.find(g=>g.id===t.templateId) ?? {id:t.templateId,name:t.label,category:t.modes,mode:t.modes,color:'#c2b5ec',ink:'#29355c',description:t.blurb,instructions:'Explore the game controls and read the room rules before joining.'})
  const matchesSearch = (game: typeof allGames[number]) => (filter==='All games'||game.category===filter) && `${game.name} ${game.category} ${game.description}`.toLowerCase().includes(query.toLowerCase().trim())
  const sortGames = (a: typeof allGames[number], b: typeof allGames[number]) => (templateById.get(a.id)?.sort_order ?? 0)-(templateById.get(b.id)?.sort_order ?? 0) || a.name.localeCompare(b.name)
  const shownGames = allGames.filter(game=>templateById.get(game.id)?.playStatus!=='offline' && templateById.get(game.id)?.placement===tab && matchesSearch(game)).sort(sortGames)
  const comingSoon = allGames.filter(game=>templateById.get(game.id)?.placement==='upcoming' && templateById.get(game.id)?.playStatus!=='offline' && matchesSearch(game)).sort(sortGames)
  const canCreate = templates.some(t=>t.available_modes?.create && t.playStatus==='live' && (roomGame==='all'||t.templateId===roomGame))
  const moveTo = useCallback((id: string) => document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }), [])
  function browseRooms(id = 'all') { setRoomGame(id); moveTo('arcade-join') }
  function joinRoom(event: FormEvent) {
    event.preventDefault()
    const path = roomPathFromInput(joinInput)
    if (!path) { setJoinError('Enter a numeric room number (for example 353123) or an Orbix invite link.'); joinField.current?.focus(); return }
    setJoinError(null)
    navigate(path)
  }
  const spotlight = allGames.find(game => { const t=templateById.get(game.id);return t?.placement !== 'hidden' && t?.playStatus !== 'offline' })

  return (
    <div className="arcade-home">
      <section className="arcade-intro" aria-labelledby="arcade-title">
        <div className="arcade-hero">
          <div className="arcade-hero-art" aria-hidden="true"><Artwork id={spotlight?.id ?? 'arcade'} color={spotlight?.color ?? '#95e7ef'} eager /></div>
          <div className="arcade-hero-copy">
            <span className="arcade-pill arcade-pill-light"><Gamepad2 size={16} aria-hidden="true" /> Welcome to your arcade</span>
            <h1 id="arcade-title">Your next round<br />starts here.</h1>
            <p>Find your game. Bring your friends.<br />Make a little room for fun.</p>
            <button className="arcade-button arcade-button-ink" onClick={() => moveTo('arcade-games')}>Explore the games <ArrowDown size={18} aria-hidden="true" /></button>
          </div>
          <div className="arcade-hero-stamp" aria-hidden="true"><Sparkles size={24} /><span>Good times<br />ahead</span></div>
          <span className="arcade-art-caption">Arcade world preview</span>
        </div>

        <aside className="arcade-wallet" aria-labelledby="arcade-wallet-title">
          <div className="arcade-wallet-top"><span className="arcade-icon-box"><Wallet size={22} aria-hidden="true" /></span><span className="arcade-pill">Your player wallet</span></div>
          <h2 id="arcade-wallet-title">All set<br />for the next round?</h2>
          {!session.token ? <>
            <p>Connect your wallet to create rooms, join your crew, and check your token balance.</p>
            <div className="arcade-wallet-illustration" aria-hidden="true"><Coins size={76} strokeWidth={1.2} /><span className="arcade-wallet-star">✦</span></div>
            <button className="arcade-button arcade-button-lime" onClick={onConnect} disabled={session.signingIn || session.autoSigningIn}>{session.signingIn || session.autoSigningIn ? 'Connecting…' : 'Connect wallet'}<ArrowUpRight size={18} aria-hidden="true" /></button>
            <span className="arcade-wallet-foot">Browse first. Connect when you’re ready.</span>
          </> : <>
            <p className="arcade-wallet-address">Connected as <strong title={session.address ?? undefined}>{shortAddress(session.address)}</strong></p>
            <dl className="arcade-balance-list">
              <div><dt>Wallet tokens</dt><dd>{balances.loading ? 'Loading…' : chainAmount(balances.onchain?.live ? balances.onchain.wallet : null)}<small>{balances.onchain?.symbol ?? 'Token balance'}</small></dd></div>
              <div><dt>Vault credit</dt><dd>{balances.loading ? 'Loading…' : chainAmount(balances.onchain?.live ? balances.onchain.vaultCredit : null)}<small>{balances.onchain?.symbol ?? 'On-chain credit'}</small></dd></div>
            </dl>
            {balances.vault?.simulated && <p className="arcade-preview-credit"><ShieldCheck size={15} aria-hidden="true" />{amountFormat.format(balances.vault.balance)} preview credits <span>For preview rooms only</span></p>}
            {balances.error && <p className="arcade-inline-error" role="status">Balances could not be refreshed. <button onClick={() => { void balances.refresh() }}>Try again</button></p>}
            <button className="arcade-button arcade-button-lime" onClick={() => navigate('/center/wallet')}>Open my vault <ArrowUpRight size={18} aria-hidden="true" /></button>
            <span className="arcade-wallet-foot">Wallet tokens and vault credit are separate.</span>
          </>}
        </aside>
      </section>

      <section className="arcade-reward-note" aria-label="How rewards work"><span className="arcade-reward-icon"><ShieldCheck size={21} aria-hidden="true" /></span><p><strong>Play with a clear picture.</strong> Preview rooms award game points. Funded rewards and entry requirements are shown in each room before you join.</p><button onClick={() => navigate('/center/wallet')}>Wallet & vault <ArrowUpRight size={16} aria-hidden="true" /></button></section>

      <section className="arcade-games" id="arcade-games" aria-labelledby="arcade-games-title">
        <header className="arcade-section-head"><div><h2 id="arcade-games-title">Pick your kind of fun.</h2><p>Choose a world, try it, or bring your crew.</p></div><div className="arcade-search"><Search size={18} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search the featured games" placeholder="Find a game" /></div></header>
        <div className="arcade-filter-row" role="group" aria-label="Filter games">{['All games', ...new Set(allGames.map(game=>game.category))].map((choice) => <button key={choice} aria-pressed={filter === choice} className={filter === choice ? 'active' : ''} onClick={() => setFilter(choice)}>{choice}</button>)}</div>
        {templatesLoading && <p className="arcade-fetch-state" role="status">Checking game availability…</p>}
        {templateError && <div className="arcade-error" role="status"><p>We couldn’t check game availability. {templateError}</p><button className="arcade-button arcade-button-light" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>}
        <div className="arcade-filter-row" role="tablist" aria-label="Game catalog location">{(['catalog','more'] as const).map(value=><button key={value} id={`games-tab-${value}`} role="tab" aria-selected={tab===value} aria-controls="games-tab-panel" className={tab===value?'active':''} onClick={()=>setTab(value)}>{value==='catalog'?'Games':'More games'}</button>)}</div>
        <div id="games-tab-panel" role="tabpanel" aria-labelledby={`games-tab-${tab}`} className="arcade-game-grid">
          {shownGames.map(game => <CatalogCard key={game.id} game={game} template={templateById.get(game.id)!} count={openRooms.filter(r=>r.templateId===game.id).length} navigate={navigate} browseRooms={browseRooms}/>)}
        </div>
        {shownGames.length === 0 && <div className="arcade-empty"><Search size={24} aria-hidden="true" /><p>No games match that search.</p><button className="arcade-button arcade-button-light" onClick={() => { setQuery(''); setFilter('All games') }}>Show all games</button></div>}
      </section>

      <section className="arcade-join-section" id="arcade-join" aria-labelledby="arcade-join-title">
        <div className="arcade-join-card"><span className="arcade-icon-box"><KeyRound size={24} aria-hidden="true" /></span><h2 id="arcade-join-title">Got an invite?<br />You’re in the right place.</h2><p>Paste a room ID or invite link. Check the room’s rules and entry requirements, then join.</p><form onSubmit={joinRoom} noValidate><label htmlFor="arcade-room-id">Room ID or invite link</label><input id="arcade-room-id" ref={joinField} value={joinInput} onChange={(event) => { setJoinInput(event.target.value); setJoinError(null) }} placeholder="Paste your invite here" aria-invalid={Boolean(joinError)} aria-describedby={joinError ? 'arcade-join-error' : undefined} autoComplete="off" spellCheck={false} />{joinError && <p id="arcade-join-error" className="arcade-inline-error" role="alert">{joinError}</p>}<button className="arcade-button arcade-button-ink" type="submit">Open room <ArrowUpRight size={18} aria-hidden="true" /></button></form></div>
        <div className="arcade-room-browser"><header><div><h2>Find your people.</h2><p>Public rooms waiting for players.</p></div><button className="arcade-refresh" onClick={refreshRooms} disabled={roomsRefreshing} aria-label="Refresh public rooms">{roomsRefreshing ? 'Refreshing…' : 'Refresh'}</button></header><label className="arcade-room-filter">Game <select value={roomGame} onChange={(event) => setRoomGame(event.target.value)}><option value="all">All available games</option>{allGames.filter(game=>templateById.get(game.id)?.available_modes?.join && templateById.get(game.id)?.playStatus==='live').map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}</select></label>
          {roomsLoading && <p className="arcade-fetch-state" role="status">Looking for open rooms…</p>}
          {roomError && <div className="arcade-error" role="status"><p>Rooms couldn’t be refreshed. {roomError}</p><button className="arcade-button arcade-button-light" disabled={roomsRefreshing} onClick={refreshRooms}>Try again</button></div>}
          {!roomsLoading && !roomError && matchingRooms.length === 0 && <div className="arcade-room-empty"><div className="arcade-empty-avatars" aria-hidden="true"><span>✦</span><span>+</span><span>✦</span></div><h3>The next round could be yours.</h3><p>No waiting rooms {roomGame === 'all' ? 'right now' : 'for this game'}. Create one and send your friends an invite.</p><>{canCreate && <button className="arcade-button arcade-button-lime" onClick={() => navigate(`/center/create${roomGame === 'all' ? '' : `?template=${roomGame}`}`)}>Create a room <ArrowUpRight size={17} aria-hidden="true" /></button>}</></div>}
          {!roomError && <div className="arcade-room-list">{matchingRooms.map((room) => <button key={room.roomId} className="arcade-room-item" onClick={() => navigate(`/center/rooms/${room.roomNumber ?? room.roomId}`)}><span className="arcade-room-icon" style={{ background: allGames.find((game) => game.id === room.templateId)?.color }}><Gamepad2 size={20} aria-hidden="true" /></span><span className="arcade-room-name"><strong>{room.name}</strong><small>{allGames.find((game) => game.id === room.templateId)?.name} · {room.players} {room.players === 1 ? 'player' : 'players'}</small><small>{room.mode === 'preview' ? 'Preview · game points' : 'Funded · check room reward'}{room.entryKind === 'erc20' ? ' · Token entry required' : ' · No token entry'}</small></span><span className="arcade-room-status">{room.status === 'ready' ? 'Ready to start' : 'Waiting for players'}<ArrowUpRight size={16} aria-hidden="true" /></span></button>)}</div>}
          {lastRoomUpdate && !roomError && <p className="arcade-room-updated">Checked at {lastRoomUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Refreshes every 20 seconds.</p>}
        </div>
      </section>

      {comingSoon.length > 0 && <section className="arcade-coming" aria-labelledby="arcade-coming-title"><div className="arcade-coming-heading"><Sparkles size={25} aria-hidden="true"/><div><h2 id="arcade-coming-title">Upcoming games</h2><p>Coming soon — More games</p></div></div><div className="arcade-game-grid">{comingSoon.map(game=><CatalogCard key={game.id} game={game} template={templateById.get(game.id)!} count={0} navigate={navigate} browseRooms={browseRooms}/>)}</div></section>}
      <footer className="arcade-home-footer"><span><Gamepad2 size={18} aria-hidden="true" /> A little room for fun.</span><p>Choose a game. Create or join a room. Check rewards before playing.</p></footer>
    </div>
  )
}

function CatalogCard({game, template, count, navigate, browseRooms}: {
  game: {id: string;name: string;category: string;mode: string;color: string;ink: string;description: string;instructions: string}
  template: TemplateMeta;count: number;navigate: (path:string)=>void;browseRooms: (id:string)=>void
}) {
  const upcoming=template.placement==='upcoming', paused=template.playStatus!=='live'
  const modes=template.available_modes ?? {create:true,join:true,practice:Boolean(template.practiceAvailable),preview:false}
  return <article className={`arcade-game arcade-game-${game.id}`} style={{'--game-color':game.color,'--game-ink':game.ink} as CSSProperties}>
    <div className="arcade-game-art gc-banner"><Artwork id={game.id} color={game.color}/><BannerBadges overlay={template.overlay} tag={template.tag}/><span className="arcade-game-category">{game.category}</span></div>
    <div className="arcade-game-body"><div className="arcade-game-heading"><h3>{game.name}</h3><Gamepad2 size={24}/></div><p>{game.description}</p><span className="arcade-game-mode">{game.mode}<span>{upcoming?'Coming soon':paused?'Under maintenance':'Available'}</span></span>
      {paused&&template.maintenanceMessage&&<p role="status">{template.maintenanceMessage}</p>}
      <div className="arcade-game-actions">
        {!upcoming && !paused && modes.create && <button className="arcade-button arcade-button-game" onClick={()=>navigate(`/center/create?template=${game.id}`)}>Create a room <ArrowUpRight size={17}/></button>}
        {!upcoming && !paused && modes.join && <button className="arcade-find-room" onClick={()=>browseRooms(game.id)}>Find rooms <ArrowRight size={16}/>{count>0&&<span>{count}</span>}</button>}
      </div>
      {!upcoming&&!paused&&modes.practice&&<button className="arcade-trial" onClick={()=>navigate(`/center/practice/${game.id}`)}><Gamepad2 size={16}/> Try now · practice <ArrowRight size={16}/></button>}
      {modes.preview&&<a className="arcade-trial" href={`/center/preview/${game.id}`}><Gamepad2 size={16}/> Preview · offline demo <ArrowRight size={16}/></a>}
      <details className="arcade-game-rules"><summary>How to play <ChevronDown size={15}/></summary><p>{game.instructions}</p></details>
    </div>
  </article>
}
