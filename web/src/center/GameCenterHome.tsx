import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, ChevronDown, Coins, Gamepad2, KeyRound, Search, ShieldCheck, Sparkles, Users, Wallet } from 'lucide-react'
import { center, explainError, type TemplateMeta } from './api'
import { GameBanner } from './bannerArt'
import { useCenterBalances } from './CenterBalance'
import { FEATURED_GAMES, isFeaturedGame } from './featuredGames'
import { shortAddress, type SessionState } from './session'
import { OPEN_ROOM_STATES, roomPathFromInput, usePublicRooms } from './roomDiscovery'
import './home.css'
export { roomPathFromInput } from './roomDiscovery'

export type GameCenterHomeProps = {
  session: SessionState
  onConnect: () => void
  navigate: (path: string) => void
}

function Artwork({ id, color, eager = false }: { id: string; color: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false)
  return failed
    ? <GameBanner templateId={id} hue={color} />
    : <img src={`${import.meta.env.BASE_URL}center-art/${id}.webp`} alt="" loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : 'auto'} decoding="async" width={960} height={640} onError={() => setFailed(true)} />
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

  const openRooms = useMemo(() => rooms.filter((room) => room.visibility === 'public' && OPEN_ROOM_STATES.has(room.status) && isFeaturedGame(room.templateId)), [rooms])
  const matchingRooms = openRooms.filter((room) => roomGame === 'all' || room.templateId === roomGame)
  const templateById = new Map(templates.map((template) => [template.templateId, template]))
  const shownGames = FEATURED_GAMES.filter((game) => (filter === 'All games' || game.category === filter) && `${game.name} ${game.category} ${game.description}`.toLowerCase().includes(query.toLowerCase().trim()))
  const comingSoon = templates.filter((template) => !isFeaturedGame(template.templateId))
  const moveTo = useCallback((id: string) => document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }), [])
  function browseRooms(id = 'all') { setRoomGame(id); moveTo('arcade-join') }
  function joinRoom(event: FormEvent) {
    event.preventDefault()
    const path = roomPathFromInput(joinInput)
    if (!path) { setJoinError('Enter a numeric room number (for example 353123) or an Orbix invite link.'); joinField.current?.focus(); return }
    setJoinError(null)
    navigate(path)
  }
  const spotlight = FEATURED_GAMES[0]

  return (
    <div className="arcade-home">
      <section className="arcade-intro" aria-labelledby="arcade-title">
        <div className="arcade-hero">
          <div className="arcade-hero-art" aria-hidden="true"><Artwork id={spotlight.id} color={spotlight.color} eager /></div>
          <div className="arcade-hero-copy">
            <span className="arcade-pill arcade-pill-light"><Gamepad2 size={16} aria-hidden="true" /> Welcome to your arcade</span>
            <h1 id="arcade-title">Your next round<br />starts here.</h1>
            <p>Find your game. Bring your friends.<br />Make a little room for fun.</p>
            <button className="arcade-button arcade-button-ink" onClick={() => moveTo('arcade-games')}>Explore the games <ArrowDown size={18} aria-hidden="true" /></button>
          </div>
          <div className="arcade-hero-stamp" aria-hidden="true"><Sparkles size={24} /><span>Good times<br />ahead</span></div>
          <span className="arcade-art-caption">Number Hunt world preview</span>
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
        <header className="arcade-section-head"><div><h2 id="arcade-games-title">Pick your kind of fun.</h2><p>Small worlds. A game for every mood.</p></div><div className="arcade-search"><Search size={18} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search the featured games" placeholder="Find a game" /></div></header>
        <div className="arcade-filter-row" role="group" aria-label="Filter games">{['All games', 'Brain game', 'Co-op', 'Arcade', '1 vs 1'].map((choice) => <button key={choice} aria-pressed={filter === choice} className={filter === choice ? 'active' : ''} onClick={() => setFilter(choice)}>{choice}</button>)}</div>
        {templatesLoading && <p className="arcade-fetch-state" role="status">Checking game availability…</p>}
        {templateError && <div className="arcade-error" role="status"><p>We couldn’t check game availability. {templateError}</p><button className="arcade-button arcade-button-light" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>}
        <div className="arcade-game-grid">
          {shownGames.map((game) => {
            const template = templateById.get(game.id)
            const unavailable = template?.playStatus === 'maintenance' || template?.playStatus === 'offline'
            const count = openRooms.filter((room) => room.templateId === game.id).length
            return <article className={`arcade-game arcade-game-${game.id}`} key={game.id} style={{ '--game-color': game.color, '--game-ink': game.ink } as CSSProperties}>
              <div className="arcade-game-art"><Artwork id={game.id} color={game.color} /><span className="arcade-game-category">{game.category}</span><span className={`arcade-game-art-label ${unavailable?'arcade-maintenance-tag':''}`}>{unavailable ? template?.playStatus === 'maintenance' ? 'Under maintenance' : 'Currently offline' : 'World preview'}</span></div>
              <div className="arcade-game-body"><div className="arcade-game-heading"><h3>{game.name}</h3><span className="arcade-game-mark" aria-hidden="true">{game.id === 'boss-raid' ? <Users size={24} /> : game.id === 'token-catch' ? <Coins size={24} /> : game.id.includes('duel') ? <Gamepad2 size={24} /> : <Search size={24} />}</span></div><p>{game.description}</p><span className="arcade-game-mode">{game.mode}<span>{unavailable ? 'New rooms paused' : template ? template.availability === 'preview' ? 'Preview available' : 'Available' : templatesLoading ? 'Checking…' : 'Currently unavailable'}</span></span>{unavailable&&template?.maintenanceMessage&&<p role="status">{template.maintenanceMessage}</p>}<div className="arcade-game-actions"><button className="arcade-button arcade-button-game" disabled={!template || unavailable || Boolean(templateError)} onClick={() => navigate(`/center/create?template=${game.id}`)}>Create a room <ArrowUpRight size={17} aria-hidden="true" /></button><button className="arcade-find-room" onClick={() => browseRooms(game.id)}>Find rooms <ArrowRight size={16} aria-hidden="true" />{!roomsLoading && !roomError && count > 0 && <span>{count}</span>}</button></div><button className="arcade-trial" onClick={()=>navigate(`/center/practice/${game.id}`)}><Gamepad2 size={16}/> Try a practice round <ArrowRight size={16}/></button><details className="arcade-game-rules"><summary>How to play <ChevronDown size={15} aria-hidden="true" /></summary><p>{game.instructions}</p></details></div>
            </article>
          })}
        </div>
        {shownGames.length === 0 && <div className="arcade-empty"><Search size={24} aria-hidden="true" /><p>No games match that search.</p><button className="arcade-button arcade-button-light" onClick={() => { setQuery(''); setFilter('All games') }}>Show all games</button></div>}
      </section>

      <section className="arcade-join-section" id="arcade-join" aria-labelledby="arcade-join-title">
        <div className="arcade-join-card"><span className="arcade-icon-box"><KeyRound size={24} aria-hidden="true" /></span><h2 id="arcade-join-title">Got an invite?<br />You’re in the right place.</h2><p>Paste a room ID or invite link. Check the room’s rules and entry requirements, then join.</p><form onSubmit={joinRoom} noValidate><label htmlFor="arcade-room-id">Room ID or invite link</label><input id="arcade-room-id" ref={joinField} value={joinInput} onChange={(event) => { setJoinInput(event.target.value); setJoinError(null) }} placeholder="Paste your invite here" aria-invalid={Boolean(joinError)} aria-describedby={joinError ? 'arcade-join-error' : undefined} autoComplete="off" spellCheck={false} />{joinError && <p id="arcade-join-error" className="arcade-inline-error" role="alert">{joinError}</p>}<button className="arcade-button arcade-button-ink" type="submit">Open room <ArrowUpRight size={18} aria-hidden="true" /></button></form></div>
        <div className="arcade-room-browser"><header><div><h2>Find your people.</h2><p>Public rooms waiting for players.</p></div><button className="arcade-refresh" onClick={refreshRooms} disabled={roomsRefreshing} aria-label="Refresh public rooms">{roomsRefreshing ? 'Refreshing…' : 'Refresh'}</button></header><label className="arcade-room-filter">Game <select value={roomGame} onChange={(event) => setRoomGame(event.target.value)}><option value="all">All featured games</option>{FEATURED_GAMES.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}</select></label>
          {roomsLoading && <p className="arcade-fetch-state" role="status">Looking for open rooms…</p>}
          {roomError && <div className="arcade-error" role="status"><p>Rooms couldn’t be refreshed. {roomError}</p><button className="arcade-button arcade-button-light" disabled={roomsRefreshing} onClick={refreshRooms}>Try again</button></div>}
          {!roomsLoading && !roomError && matchingRooms.length === 0 && <div className="arcade-room-empty"><div className="arcade-empty-avatars" aria-hidden="true"><span>✦</span><span>+</span><span>✦</span></div><h3>The next round could be yours.</h3><p>No waiting rooms {roomGame === 'all' ? 'right now' : 'for this game'}. Create one and send your friends an invite.</p><button className="arcade-button arcade-button-lime" onClick={() => navigate(`/center/create${roomGame === 'all' ? '' : `?template=${roomGame}`}`)}>Create a room <ArrowUpRight size={17} aria-hidden="true" /></button></div>}
          {!roomError && <div className="arcade-room-list">{matchingRooms.map((room) => <button key={room.roomId} className="arcade-room-item" onClick={() => navigate(`/center/rooms/${room.roomNumber ?? room.roomId}`)}><span className="arcade-room-icon" style={{ background: FEATURED_GAMES.find((game) => game.id === room.templateId)?.color }}><Gamepad2 size={20} aria-hidden="true" /></span><span className="arcade-room-name"><strong>{room.name}</strong><small>{FEATURED_GAMES.find((game) => game.id === room.templateId)?.name} · {room.players} {room.players === 1 ? 'player' : 'players'}</small><small>{room.mode === 'preview' ? 'Preview · game points' : 'Funded · check room reward'}{room.entryKind === 'erc20' ? ' · Token entry required' : ' · No token entry'}</small></span><span className="arcade-room-status">{room.status === 'ready' ? 'Ready to start' : 'Waiting for players'}<ArrowUpRight size={16} aria-hidden="true" /></span></button>)}</div>}
          {lastRoomUpdate && !roomError && <p className="arcade-room-updated">Checked at {lastRoomUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Refreshes every 20 seconds.</p>}
        </div>
      </section>

      <section className="arcade-coming" aria-labelledby="arcade-coming-title"><div className="arcade-coming-heading"><Sparkles size={25} aria-hidden="true" /><div><h2 id="arcade-coming-title">More worlds on the way.</h2><p>New adventures are coming to the arcade.</p></div><span className="arcade-pill">Coming soon</span></div><div className="arcade-coming-games">{(comingSoon.length ? comingSoon.map((template) => template.label) : ['Memory Match', 'Maze Race', 'Level Runner', 'Live Quiz']).map((label) => <span key={label}>{label}<small>Coming soon</small></span>)}</div></section>
      <footer className="arcade-home-footer"><span><Gamepad2 size={18} aria-hidden="true" /> A little room for fun.</span><p>Choose a game. Create or join a room. Check rewards before playing.</p></footer>
    </div>
  )
}
