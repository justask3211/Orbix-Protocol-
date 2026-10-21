import { TournamentsSection } from './Tournaments'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, ChevronDown, Coins, Gamepad2, KeyRound, Plus, Search, ShieldCheck, SlidersHorizontal, Sparkles, Wallet } from 'lucide-react'
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
  const [params, setParams] = useState(() => new URLSearchParams(window.location.search))
  useEffect(() => {
    const sync = () => setParams(new URLSearchParams(window.location.search))
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])
  const view = params.get('view') === 'rooms' ? 'rooms' : 'games'
  const query = params.get('q') ?? ''
  const filter = params.get('category') ?? 'All categories'
  const moreOpen = params.get('more') === '1'
  const [filtersOpen, setFiltersOpen] = useState(Boolean(params.get('category')))
  function updateParam(key: string, value: string) {
    const url = new URL(window.location.href)
    value ? url.searchParams.set(key, value) : url.searchParams.delete(key)
    window.history.replaceState(null, '', url)
    setParams(new URLSearchParams(url.search))
  }
  const setQuery = (value: string) => updateParam('q', value)
  const setFilter = (value: string) => updateParam('category', value === 'All categories' ? '' : value)
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
  const allGames = templates.filter(t=>t.placement!=='hidden' && t.playStatus!=='offline').map(t => FEATURED_GAMES.find(g=>g.id===t.templateId) ?? {id:t.templateId,name:t.label,category:t.modes || 'Arcade',mode:t.modes,color:'#c2b5ec',ink:'#29355c',description:t.blurb,instructions:'Explore the game controls and read the room rules before joining.'})
  const matchesSearch = (game: typeof allGames[number]) => (filter==='All categories'||categoryLabel(game.category)===filter) && `${game.name} ${game.category} ${game.description}`.toLowerCase().includes(query.toLowerCase().trim())
  const sortGames = (a: typeof allGames[number], b: typeof allGames[number]) => (templateById.get(a.id)?.sort_order ?? 0)-(templateById.get(b.id)?.sort_order ?? 0) || a.name.localeCompare(b.name)
  const activeGames = allGames.filter(game => { const t = templateById.get(game.id)!; return t.placement === 'catalog' && t.playStatus === 'live' && t.available_modes?.create === true }).sort(sortGames)
  const shownGames = activeGames.filter(matchesSearch)
  const moreGames = allGames.filter(game => templateById.get(game.id)?.placement === 'more' && matchesSearch(game)).sort(sortGames)
  const categories = [...new Set(allGames.map(game => categoryLabel(game.category)))].sort()
  const comingSoon = allGames.filter(game=>templateById.get(game.id)?.placement==='upcoming' && templateById.get(game.id)?.playStatus!=='offline' && matchesSearch(game)).sort(sortGames)
  const canCreate = templates.some(t=>t.available_modes?.create && t.playStatus==='live' && t.placement!=='hidden' && t.placement!=='upcoming' && (roomGame==='all'||t.templateId===roomGame))
  const moveTo = useCallback((id: string) => document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }), [])
  function browseRooms(id = 'all') { setRoomGame(id); updateParam('view', 'rooms'); window.setTimeout(() => moveTo('arcade-join'), 0) }
  function joinRoom(event: FormEvent) {
    event.preventDefault()
    const path = roomPathFromInput(joinInput)
    if (!path) { setJoinError('Enter a numeric room number (for example 353123) or an Orbix invite link.'); joinField.current?.focus(); return }
    setJoinError(null)
    navigate(path)
  }
  const spotlight = activeGames[0]

  return (
    <div className="arcade-home">
      <header className="arcade-home-heading"><div><span className="arcade-eyebrow">ORBIX CENTER / THE GAME FLOOR</span><h1 id="arcade-title">A new round. Your rules.</h1><p>Find your game. Create a room. Bring your people.</p></div><span className="arcade-floor-mark" aria-hidden="true"><Gamepad2 size={30}/></span></header>
      <div className="arcade-primary-nav" role="group" aria-label="Home view">
        <button aria-pressed={view === 'games'} className={view === 'games' ? 'active' : ''} onClick={() => updateParam('view', '')}><span className="arcade-nav-icon"><Gamepad2 size={22} aria-hidden="true"/></span><span><strong>All games</strong><small>Find your next game</small></span><ArrowUpRight size={20} aria-hidden="true"/></button>
        <button aria-pressed={view === 'rooms'} className={view === 'rooms' ? 'active' : ''} onClick={() => updateParam('view', 'rooms')}><span className="arcade-nav-icon"><Plus size={22} aria-hidden="true"/></span><span><strong>Create & Join</strong><small>Your room. Your crew.</small></span><ArrowUpRight size={20} aria-hidden="true"/></button>
      </div>
      {view === 'games' ? <>
      <section className="arcade-hero" aria-label="Discover Orbix games">
        <div className="arcade-hero-art" aria-hidden="true"><Artwork id={spotlight?.id ?? 'closest-call'} color={spotlight?.color ?? '#ff6b22'} eager /></div>
        <div className="arcade-hero-copy"><span className="arcade-eyebrow">A LITTLE FRIENDLY COMPETITION</span><h2>Big worlds.<br/><em>One more round.</em></h2><p>Outthink a rival. Discover a new world.<br/>Make tonight a game night.</p><button className="arcade-button arcade-button-lime" onClick={() => moveTo('arcade-games')}>Find your game <ArrowDown size={16} aria-hidden="true"/></button></div>
        <span className="arcade-art-caption">Explore the Orbix game worlds</span>
      </section>
      <section className="arcade-games" id="arcade-games" aria-labelledby="arcade-games-title">
        <header className="arcade-section-head"><div><span className="arcade-eyebrow">READY WHEN YOU ARE</span><h2 id="arcade-games-title">All games <span className="arcade-count">{activeGames.length}</span></h2><p>Available to create. Ready to make your own.</p></div><div className="arcade-catalog-tools"><div className="arcade-search"><Search size={18} aria-hidden="true"/><input type="search" name="game-search" autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search games" placeholder="Find a game…"/></div><button className={`arcade-filter-toggle ${filter !== 'All categories' ? 'active' : ''}`} aria-expanded={filtersOpen} aria-controls="arcade-categories" onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={16} aria-hidden="true"/> Filter{filter !== 'All categories' && <span className="arcade-filter-dot"/>}</button></div></header>
        <div className="arcade-secondary-nav"><a href="#arcade-coming">Upcoming games <ArrowRight size={14} aria-hidden="true"/></a><button aria-expanded={moreOpen} aria-controls="arcade-more" onClick={() => updateParam('more', moreOpen ? '' : '1')}>More <ChevronDown size={14} aria-hidden="true" className={moreOpen ? 'rotated' : ''}/></button>{filter !== 'All categories' && <button className="arcade-selected-filter" onClick={() => setFilter('All categories')}>{filter} ×<span className="arcade-sr-only"> Clear category filter</span></button>}</div>
        <div id="arcade-categories" className="arcade-filter-row" role="group" aria-label="Filter games by category" hidden={!filtersOpen}>{['All categories', ...categories].map(choice => <button key={choice} aria-pressed={filter === choice} className={filter === choice ? 'active' : ''} onClick={() => setFilter(choice)}>{choice}</button>)}</div>
        {templatesLoading && <p className="arcade-fetch-state" role="status">Checking game availability…</p>}
        {templateError && <div className="arcade-error" role="status"><p>We couldn’t check game availability. {templateError}</p><button className="arcade-button arcade-button-light" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>}
        <div className="arcade-game-grid" aria-label="Active creatable games">
          {shownGames.map(game => <CatalogCard key={game.id} game={game} template={templateById.get(game.id)!} count={openRooms.filter(r=>r.templateId===game.id).length} browseRooms={browseRooms}/>)}
        </div>
        {!templatesLoading && !templateError && shownGames.length === 0 && <div className="arcade-empty"><Search size={24} aria-hidden="true" /><p>{query || filter !== 'All categories' ? 'No games match your filters.' : 'No games are available to create right now. Explore upcoming games or check back soon.'}</p><button className="arcade-button arcade-button-light" onClick={() => { setQuery(''); setFilter('All categories') }}>Show all games</button></div>}
      </section>

      <section className="arcade-more" id="arcade-more" aria-labelledby="arcade-more-title" hidden={!moreOpen}><header className="arcade-section-head"><div><span className="arcade-eyebrow">OFF THE MAIN FLOOR</span><h2 id="arcade-more-title">More to explore</h2><p>Extra worlds, practice and previews. Availability varies by game.</p></div></header><div className="arcade-game-grid">{moreGames.map(game => <CatalogCard key={game.id} game={game} template={templateById.get(game.id)!} count={openRooms.filter(r=>r.templateId===game.id).length} browseRooms={browseRooms}/>)}</div>{!moreGames.length && <p className="arcade-fetch-state">No extra games match your filters.</p>}</section>
      <section className="arcade-coming" id="arcade-coming" aria-labelledby="arcade-coming-title"><div className="arcade-coming-heading"><Sparkles size={25} aria-hidden="true"/><div><span className="arcade-eyebrow">NEXT ON THE GAME FLOOR</span><h2 id="arcade-coming-title">Upcoming games</h2><p>New worlds in the making. Watch this space.</p></div><span className="arcade-pill">In development</span></div><div className="arcade-game-grid">{comingSoon.map(game=><CatalogCard key={game.id} game={game} template={templateById.get(game.id)!} count={0} browseRooms={browseRooms}/>)}</div>{!templatesLoading && !comingSoon.length && <p className="arcade-fetch-state">{query || filter !== 'All categories' ? 'No upcoming games match your filters.' : 'The next lineup will appear here when announced.'}</p>}</section>
      </> : <>
      <section className="arcade-create-intro" aria-labelledby="arcade-create-title"><div className="arcade-create-card"><span className="arcade-icon-box"><Plus size={24} aria-hidden="true"/></span><span className="arcade-eyebrow">MAKE IT YOUR GAME NIGHT</span><h2 id="arcade-create-title">You bring the crew.<br/>We bring the game.</h2><p>Choose a game, set the rules and send an invite. Entry requirements and rewards stay clear before anyone joins.</p><a className="arcade-button arcade-button-lime" href="/center/create">Create a room <ArrowUpRight size={18} aria-hidden="true"/></a><button className="arcade-find-room" onClick={() => { moveTo('arcade-join'); joinField.current?.focus({preventScroll:true}) }}>Have an invite? Join a room <ArrowRight size={16} aria-hidden="true"/></button></div>
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
      <section className="arcade-join-section" id="arcade-join" aria-labelledby="arcade-join-title">
        <div className="arcade-join-card"><span className="arcade-icon-box"><KeyRound size={24} aria-hidden="true" /></span><h2 id="arcade-join-title">Got an invite?<br />You’re in the right place.</h2><p>Paste a room ID or invite link. Check the room’s rules and entry requirements, then join.</p><form onSubmit={joinRoom} noValidate><label htmlFor="arcade-room-id">Room ID or invite link</label><input id="arcade-room-id" ref={joinField} value={joinInput} onChange={(event) => { setJoinInput(event.target.value); setJoinError(null) }} name="room-invite" placeholder="Room number or invite link…" aria-invalid={Boolean(joinError)} aria-describedby={joinError ? 'arcade-join-error' : undefined} autoComplete="off" spellCheck={false} />{joinError && <p id="arcade-join-error" className="arcade-inline-error" role="alert">{joinError}</p>}<button className="arcade-button arcade-button-ink" type="submit">Open room <ArrowUpRight size={18} aria-hidden="true" /></button></form></div>
        <div className="arcade-room-browser"><header><div><h2>Find your people.</h2><p>Public rooms waiting for players.</p></div><button className="arcade-refresh" onClick={refreshRooms} disabled={roomsRefreshing} aria-label="Refresh public rooms">{roomsRefreshing ? 'Refreshing…' : 'Refresh'}</button></header><label className="arcade-room-filter">Game <select name="room-game" value={roomGame} onChange={(event) => setRoomGame(event.target.value)}><option value="all">All available games</option>{allGames.filter(game=>templateById.get(game.id)?.available_modes?.join && templateById.get(game.id)?.playStatus==='live' && templateById.get(game.id)?.placement!=='upcoming').map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}</select></label>
          {roomsLoading && <p className="arcade-fetch-state" role="status">Looking for open rooms…</p>}
          {roomError && <div className="arcade-error" role="status"><p>Rooms couldn’t be refreshed. {roomError}</p><button className="arcade-button arcade-button-light" disabled={roomsRefreshing} onClick={refreshRooms}>Try again</button></div>}
          {!roomsLoading && !roomError && matchingRooms.length === 0 && <div className="arcade-room-empty"><div className="arcade-empty-avatars" aria-hidden="true"><span>✦</span><span>+</span><span>✦</span></div><h3>The next round could be yours.</h3><p>No waiting rooms {roomGame === 'all' ? 'right now' : 'for this game'}. Create one and send your friends an invite.</p><>{canCreate && <button className="arcade-button arcade-button-lime" onClick={() => navigate(`/center/create${roomGame === 'all' ? '' : `?template=${roomGame}`}`)}>Create a room <ArrowUpRight size={17} aria-hidden="true" /></button>}</></div>}
          {!roomError && <div className="arcade-room-list">{matchingRooms.map((room) => <button key={room.roomId} className="arcade-room-item" onClick={() => navigate(`/center/rooms/${room.roomNumber ?? room.roomId}`)}><span className="arcade-room-icon" style={{ background: allGames.find((game) => game.id === room.templateId)?.color }}><Gamepad2 size={20} aria-hidden="true" /></span><span className="arcade-room-name"><strong>{room.name}</strong><small>{allGames.find((game) => game.id === room.templateId)?.name} · {room.players} {room.players === 1 ? 'player' : 'players'}</small><small>{room.mode === 'preview' ? 'Preview · game points' : 'Funded · check room reward'}{room.entryKind === 'erc20' ? ' · Token entry required' : ' · No token entry'}</small></span><span className="arcade-room-status">{room.status === 'ready' ? 'Ready to start' : 'Waiting for players'}<ArrowUpRight size={16} aria-hidden="true" /></span></button>)}</div>}
          {lastRoomUpdate && !roomError && <p className="arcade-room-updated">Checked at {lastRoomUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Refreshes every 20 seconds.</p>}
        </div>
      </section>
      <TournamentsSection session={session} navigate={navigate} front/>
      </>}
      <section className="arcade-reward-note" aria-label="How rewards work"><span className="arcade-reward-icon"><ShieldCheck size={21} aria-hidden="true"/></span><p><strong>Know your round.</strong> Preview rooms award game points. Funded rewards and entry requirements are shown before you join.</p><a href="/center/wallet">Wallet & vault <ArrowUpRight size={16} aria-hidden="true"/></a></section>
      <footer className="arcade-home-footer"><span><Gamepad2 size={18} aria-hidden="true" /> A little room for fun.</span><p>Choose a game. Create or join a room. Check rewards before playing.</p></footer>
    </div>
  )
}

function CatalogCard({game, template, count, browseRooms}: {
  game: {id: string;name: string;category: string;mode: string;color: string;ink: string;description: string;instructions: string}
  template: TemplateMeta;count: number;browseRooms: (id:string)=>void
}) {
  const upcoming=template.placement==='upcoming', paused=template.playStatus!=='live'
  const modes=template.available_modes ?? {create:true,join:true,practice:Boolean(template.practiceAvailable),preview:false}
  return <article className={`arcade-game arcade-game-${game.id}`} style={{'--game-color':game.color,'--game-ink':game.ink} as CSSProperties}>
    <div className="arcade-game-art gc-banner"><Artwork id={game.id} color={game.color}/><BannerBadges overlay={template.overlay} tag={template.tag}/><span className="arcade-game-category">{categoryLabel(game.category)}</span></div>
    <div className="arcade-game-body"><div className="arcade-game-heading"><h3>{game.name}</h3><Gamepad2 size={24} aria-hidden="true"/></div><p>{game.description}</p><span className="arcade-game-mode">{game.mode}<span>{upcoming?'Coming soon':paused?'Under maintenance':modes.create?'Live · create & play':'Live'}</span></span>
      {paused&&template.maintenanceMessage&&<p role="status">{template.maintenanceMessage}</p>}
      <div className="arcade-game-actions">
        {!upcoming && !paused && modes.create && <a className="arcade-button arcade-button-game" href={`/center/create?template=${game.id}`}>Create a room <ArrowUpRight size={17} aria-hidden="true"/></a>}
        {!upcoming && !paused && modes.join && <button className="arcade-find-room" onClick={()=>browseRooms(game.id)}>Find rooms <ArrowRight size={16} aria-hidden="true"/>{count>0&&<span>{count}</span>}</button>}
      </div>
      {!upcoming&&!paused&&modes.practice&&<a className="arcade-trial" href={`/center/practice/${game.id}`}><Gamepad2 size={16} aria-hidden="true"/> Try now · practice <ArrowRight size={16} aria-hidden="true"/></a>}
      {modes.preview&&<a className="arcade-trial" href={`/center/preview/${game.id}`}><Gamepad2 size={16} aria-hidden="true"/> Preview · offline demo <ArrowRight size={16} aria-hidden="true"/></a>}
      <details className="arcade-game-rules"><summary>How to play <ChevronDown size={15} aria-hidden="true"/></summary><p>{game.instructions}</p></details>
    </div>
  </article>
}

function categoryLabel(category: string) {
  return ({'1 vs 1':'Duel', 'Word puzzle':'Word', 'Board strategy':'Board', 'Geography':'Map', 'Auction strategy':'Auction', 'Brain game':'Brain'} as Record<string,string>)[category] ?? category
}
