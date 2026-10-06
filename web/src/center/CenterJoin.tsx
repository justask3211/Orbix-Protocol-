import { useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { ArrowUpRight, ChevronDown, Coins, Gamepad2, KeyRound, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Users } from 'lucide-react'
import type { RoomSummary } from './api'
import { FEATURED_GAMES } from './featuredGames'
import { isDiscoverableRoom, OPEN_ROOM_STATES, roomPathFromInput, usePublicRooms } from './roomDiscovery'
import type { SessionState } from './session'
import './join.css'

type CenterJoinProps = { session: SessionState; onConnect: () => void; navigate: (path: string) => void }
type Filters = { game: string; status: string; entry: string; reward: string; query: string }
const DEFAULT_FILTERS: Filters = { game: 'all', status: 'all', entry: 'all', reward: 'all', query: '' }

function RoomCard({ room, navigate }: { room: RoomSummary; navigate: (path: string) => void }) {
  const game = FEATURED_GAMES.find((item) => item.id === room.templateId)!
  const waiting = OPEN_ROOM_STATES.has(room.status)
  const tokenEntry = room.entryKind === 'erc20'
  const status = room.status === 'running' ? 'Match in progress' : room.status === 'ready' ? 'Ready to start' : 'Waiting for players'
  const reward = room.rewards === 'funded-assets' ? 'Funded asset rewards' : room.rewards === 'preview-points' ? 'Preview game points' : 'Check room rewards'
  return <article className="center-join-room" style={{ '--room-accent': game.color, '--room-ink': game.ink } as CSSProperties}>
    <div className="center-join-room-art"><img src={`${import.meta.env.BASE_URL}center-art/${game.id}.webp`} alt="" loading="lazy" decoding="async" width={960} height={640} /><span>{game.name}</span></div>
    <div className="center-join-room-body">
      <span className={`center-join-status ${waiting ? 'waiting' : 'running'}`}><span aria-hidden="true" />{status}</span>
      <h3>{room.name}</h3>
      <div className="center-join-room-meta"><span><Users size={15} aria-hidden="true" />{room.players} {room.players === 1 ? 'player' : 'players'}</span><span>Public room</span></div>
      <dl><div><dt><Coins size={14} aria-hidden="true" />Entry</dt><dd>{tokenEntry ? 'Token entry required' : 'No token entry'}{tokenEntry && room.entryToken && <small title={room.entryToken}>Token {room.entryToken.slice(0, 6)}…{room.entryToken.slice(-4)}</small>}</dd></div><div><dt><ShieldCheck size={14} aria-hidden="true" />Rewards</dt><dd>{reward}<small>{room.mode === 'preview' ? 'Preview room' : 'Testnet room'} · check details before entry</small></dd></div></dl>
      {tokenEntry && room.entryAmount != null && <p className="center-join-entry-detail">Configured entry: {room.entryAmount.toLocaleString('en-US')} token units. Confirm the amount in the room.</p>}
      <button className="center-join-button room" onClick={() => navigate(`/center/rooms/${room.roomId}`)}>{waiting ? 'Open lobby' : 'View room'}<ArrowUpRight size={17} aria-hidden="true" /></button>
      {!waiting && <p className="center-join-running-note">The match has started. Entry may be closed.</p>}
    </div>
  </article>
}

export function CenterJoin({ session, onConnect, navigate }: CenterJoinProps) {
  const { rooms, loading, refreshing, error, updatedAt, refresh } = usePublicRooms()
  const [invite, setInvite] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const inviteField = useRef<HTMLInputElement>(null)
  const activeRooms = useMemo(() => rooms.filter(isDiscoverableRoom), [rooms])
  const filteredRooms = useMemo(() => activeRooms.filter((room) =>
    (filters.game === 'all' || room.templateId === filters.game)
    && (filters.status === 'all' || room.status === filters.status)
    && (filters.entry === 'all' || (filters.entry === 'paid' ? room.entryKind === 'erc20' : room.entryKind !== 'erc20'))
    && (filters.reward === 'all' || room.rewards === filters.reward)
    && `${room.name} ${FEATURED_GAMES.find((game) => game.id === room.templateId)?.name ?? ''}`.toLowerCase().includes(filters.query.toLowerCase().trim())
  ).sort((left, right) => Number(left.status === 'running') - Number(right.status === 'running')), [activeRooms, filters])
  const filtered = Object.entries(filters).some(([key, value]) => value !== DEFAULT_FILTERS[key as keyof Filters])
  function setFilter(key: keyof Filters, value: string) { setFilters((current) => ({ ...current, [key]: value })) }
  function openInvite(event: FormEvent) {
    event.preventDefault()
    const path = roomPathFromInput(invite)
    if (!path) { setInviteError('Use a 16-character room ID or a complete Orbix invite link.'); inviteField.current?.focus(); return }
    setInviteError(null)
    navigate(path)
  }
  return <div className="center-join">
    <section className="center-join-welcome" aria-labelledby="center-join-title">
      <div className="center-join-invite">
        <span className="center-join-eyebrow"><KeyRound size={16} aria-hidden="true" />An invite to a good time</span>
        <h1 id="center-join-title">Your crew.<br />Your next round.</h1>
        <p>Paste your friend’s room code or invite link. Open the lobby, check the rules, and get ready to play.</p>
        <form onSubmit={openInvite} noValidate>
          <label htmlFor="center-join-invite">Room ID or invite link</label>
          <div className="center-join-invite-field"><input id="center-join-invite" ref={inviteField} value={invite} onChange={(event) => { setInvite(event.target.value); setInviteError(null) }} placeholder="Paste your room code or invite" autoComplete="off" spellCheck={false} aria-invalid={Boolean(inviteError)} aria-describedby={inviteError ? 'center-join-invite-error' : 'center-join-invite-help'} /><button type="submit" className="center-join-button">Open room<ArrowUpRight size={18} aria-hidden="true" /></button></div>
          {inviteError ? <p className="center-join-invite-error" id="center-join-invite-error" role="alert">{inviteError}</p> : <p id="center-join-invite-help" className="center-join-invite-help">Private room? Your complete invite link includes the access code.</p>}
        </form>
      </div>
      <aside className="center-join-friends"><div className="center-join-friends-art" aria-hidden="true"><span><Gamepad2 size={38} /></span><span><Users size={38} /></span><span><KeyRound size={38} /></span></div><h2>Meet in the lobby.</h2><p>Public rooms are listed below. Invite-only rooms open through the link your host shares.</p>{!session.token && <button className="center-join-button light" onClick={onConnect} disabled={session.signingIn || session.autoSigningIn}>{session.signingIn || session.autoSigningIn ? 'Connecting…' : 'Connect to play'}<ArrowUpRight size={17} aria-hidden="true" /></button>}<small>Token entry and funded rewards are separate from preview points.</small></aside>
    </section>
    <section className="center-join-discovery" aria-labelledby="center-join-active-title">
      <header className="center-join-section-heading"><div><span className="center-join-eyebrow"><Users size={16} aria-hidden="true" />Public room discovery</span><h2 id="center-join-active-title">Find your next lobby.</h2><p>Waiting, ready, and live rooms from the featured games.</p></div><button className="center-join-refresh" onClick={refresh} disabled={refreshing}><RefreshCw size={16} aria-hidden="true" />{refreshing ? 'Refreshing…' : 'Refresh rooms'}</button></header>
      <div className="center-join-filters">
        <div className="center-join-search"><Search size={17} aria-hidden="true" /><input type="search" value={filters.query} onChange={(event) => setFilter('query', event.target.value)} placeholder="Search room or game" aria-label="Search public rooms" /></div>
        <div className="center-join-filter-title"><SlidersHorizontal size={16} aria-hidden="true" />Find your fit<span className="center-join-public">Public rooms only</span></div>
        <div className="center-join-filter-grid">
          <label>Game<span><select value={filters.game} onChange={(event) => setFilter('game', event.target.value)}><option value="all">All featured games</option>{FEATURED_GAMES.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}</select><ChevronDown size={16} aria-hidden="true" /></span></label>
          <label>Room state<span><select value={filters.status} onChange={(event) => setFilter('status', event.target.value)}><option value="all">All active rooms</option><option value="registration">Waiting for players</option><option value="ready">Ready to start</option><option value="running">Match in progress</option></select><ChevronDown size={16} aria-hidden="true" /></span></label>
          <label>Entry<span><select value={filters.entry} onChange={(event) => setFilter('entry', event.target.value)}><option value="all">Any entry type</option><option value="free">No token entry</option><option value="paid">Paid token entry</option></select><ChevronDown size={16} aria-hidden="true" /></span></label>
          <label>Rewards<span><select value={filters.reward} onChange={(event) => setFilter('reward', event.target.value)}><option value="all">Any reward type</option><option value="funded-assets">Funded assets</option><option value="preview-points">Preview points</option></select><ChevronDown size={16} aria-hidden="true" /></span></label>
        </div>
      </div>
      <div className="center-join-results-heading"><p aria-live="polite">{loading ? 'Looking for active rooms…' : `${filteredRooms.length} ${filteredRooms.length === 1 ? 'room' : 'rooms'}${filtered ? ' match your filters' : ' to explore'}`}</p>{filtered && <button onClick={() => setFilters(DEFAULT_FILTERS)}>Clear filters</button>}</div>
      {error && <div className="center-join-fetch-error" role="status"><p>We couldn’t refresh rooms. {error}{updatedAt && ' The list below was last checked earlier.'}</p><button onClick={refresh} disabled={refreshing}>Try again</button></div>}
      {loading && <div className="center-join-loading" role="status"><Gamepad2 size={29} aria-hidden="true" /><p>Checking the arcade for your next round.</p></div>}
      {!loading && (!error || updatedAt) && filteredRooms.length === 0 && <div className="center-join-empty"><Users size={37} aria-hidden="true" /><h3>{filtered ? 'No rooms match that mix.' : 'Be the start of something fun.'}</h3><p>{filtered ? 'Try another game, entry type, or room state.' : 'There are no active public rooms right now. Create a room and bring your friends.'}</p><button className="center-join-button lime" onClick={() => filtered ? setFilters(DEFAULT_FILTERS) : navigate('/center/create')}>{filtered ? 'Show all active rooms' : 'Create a room'}<ArrowUpRight size={17} aria-hidden="true" /></button></div>}
      {!loading && <div className="center-join-room-grid">{filteredRooms.map((room) => <RoomCard key={room.roomId} room={room} navigate={navigate} />)}</div>}
      {updatedAt && <p className="center-join-update">Last checked {updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Refreshes every 20 seconds while this page is visible. The directory shows the latest public rooms returned by the server.</p>}
    </section>
  </div>
}
