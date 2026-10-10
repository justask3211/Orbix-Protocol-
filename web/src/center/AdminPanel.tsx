import { isPortfolio } from './gamePortfolio'
import { activeWalletProvider } from './walletConnectors'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Eye, Gamepad2, ShieldCheck, Sparkles, Users, Wrench, Archive, RefreshCw, Radio, Search, MessageSquare } from 'lucide-react'
import { center, explainError } from './api'
import { FEATURED_GAMES } from './featuredGames'
import { TEMPLATE_META } from './gameArt'
import { GameBanner } from './bannerArt'
import { shortAddress, type SessionState } from './session'
import './adminGames.css'

type Pricing = Awaited<ReturnType<typeof center.adminPricing>>
type AdminRoom = Awaited<ReturnType<typeof center.adminRooms>>['rooms'][number]
type Observer = Awaited<ReturnType<typeof center.adminRoomObserve>>
type Availability = Awaited<ReturnType<typeof center.adminGames>>['games'][number]

/** Each destructive/control change obtains a distinct, single-use admin proof. */
async function signedProof(session: SessionState): Promise<string> {
  if (!session.token || !session.address) throw new Error('Connect the administrator wallet first.')
  const { nonce, message } = await center.adminNonce(session.token, session.address)
  let signature: string
  if (session.kind === 'generated') {
    const { loadGeneratedAccount } = await import('./session')
    const account = loadGeneratedAccount()
    if (!account || account.address.toLowerCase() !== session.address.toLowerCase()) throw new Error('Saved wallet does not match the connected administrator.')
    signature = await account.signMessage({ message })
  } else {
    const eth = activeWalletProvider() ?? (window as any).ethereum
    if (!eth) throw new Error('Open your wallet to sign this change.')
    signature = await eth.request({ method: 'personal_sign', params: [message, session.address] })
  }
  return `${nonce}:${signature}`
}

function useAdminAction(session: SessionState) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const run = async (job: (proof: string) => Promise<unknown>, success: string, after?: () => void) => {
    if (!session.token || busy) return
    setBusy(true); setError(''); setMessage('')
    try { await job(await signedProof(session)); setMessage(success); after?.() }
    catch (e) { setError(explainError(e)) }
    finally { setBusy(false) }
  }
  return { busy, error, message, run }
}

export function AdminRoomTools({ roomId, session, roomStatus, onChanged, onChange }: {
  roomId: string; session: SessionState; roomStatus?: string; onChanged?: () => void; onChange?: () => void
}) {
  const [data, setData] = useState<Observer | null>(null)
  const [loadError, setLoadError] = useState('')
  const [hint, setHint] = useState('')
  const action = useAdminAction(session)
  const refresh = useCallback(async () => {
    if (!session.token) return
    try { setData(await center.adminRoomObserve(roomId, session.token)); setLoadError('') }
    catch (e) { setLoadError(explainError(e)) }
  }, [roomId, session.token])
  useEffect(() => {
    let active = true, inFlight = false
    const poll = async () => { if (!active || inFlight || document.hidden) return; inFlight = true; try { await refresh() } finally { inFlight = false } }
    void poll(); const timer = setInterval(poll, 2500)
    return () => { active = false; clearInterval(timer) }
  }, [refresh])
  const mutate = (body: Record<string, unknown>, success: string) => action.run(
    (proof) => center.adminRoomAction(roomId, session.token!, proof, body), success,
    () => { void refresh(); onChanged?.(); onChange?.() },
  )
  const status = data?.status ?? roomStatus
  const open = status === 'registration' || status === 'ready' || status === 'running'
  return <section className="ag-room-tools" aria-label="Administrator room controls">
    <div className="ag-tools-head"><span className="ag-icon"><ShieldCheck size={23}/></span><div><h2>Mission control</h2><p>Hidden observation · no player slot or entry charge</p></div><span className="ag-badge"><Eye size={14}/> Observer</span></div>
    {loadError && <p className="ag-error" role="alert">{loadError}</p>}
    {data && <>
      <div className="ag-control-row">{(['muteChat', 'hidePlayers', 'hideGuesses'] as const).map(key => <button key={key} className={`ag-switch ${data.community.settings[key] ? 'is-on' : ''}`} aria-pressed={data.community.settings[key]} disabled={action.busy} onClick={() => void mutate({ operation: 'settings', settings: { [key]: !data.community.settings[key] } }, 'Room controls updated.')}><span className="ag-toggle"/>{key === 'muteChat' ? 'Mute chat' : key === 'hidePlayers' ? 'Hide player names' : 'Hide guesses'}</button>)}</div>
      {!isPortfolio(data.templateId)&&<form className="ag-hint-form" onSubmit={e => { e.preventDefault(); if (hint.trim()) void mutate({ operation: 'hint', text: hint }, 'Clue published to the room.') }}><label htmlFor="admin-room-clue">Publish an administrator clue</label><div><input id="admin-room-clue" maxLength={500} value={hint} onChange={e => setHint(e.target.value)} placeholder="Give the players a helpful clue…" disabled={!open}/><button className="ag-primary" disabled={action.busy || !open || !hint.trim()}><Sparkles size={17}/> Send clue</button></div></form>}
      <p className="ag-note">Live kick suspends controls for this round. Recorded scores and reward records remain intact. Bans also block re-entry.</p>
      <div className="ag-player-list">{data.roster.players.map(player => <div className="ag-player" key={player.wallet}><span className="ag-player-avatar">{player.name.slice(0, 1).toUpperCase()}</span><div><strong>{player.name}</strong><code title={player.wallet}>{player.wallet}</code></div><span className="ag-badge">{player.role}</span>{player.wallet.toLowerCase() !== data.owner.toLowerCase() && player.wallet.toLowerCase() !== session.address?.toLowerCase() && open && <div className="ag-player-actions"><button disabled={action.busy} onClick={() => void mutate({ operation: 'kick', wallet: player.wallet }, 'Player controls suspended or lobby player removed.')}>Kick</button><button className="ag-danger" disabled={action.busy} onClick={() => void mutate({ operation: 'ban', wallet: player.wallet }, 'Wallet banned from this room.')}>Ban</button></div>}</div>)}</div>
      {data.roster.banned.length > 0 && <details><summary>Banned wallets ({data.roster.banned.length})</summary>{data.roster.banned.map(player => <div className="ag-player" key={player.wallet}><div><strong>{player.name}</strong><code>{player.wallet}</code></div><button disabled={action.busy} onClick={() => void mutate({ operation: 'unban', wallet: player.wallet }, 'Ban removed.')}>Unban</button></div>)}</details>}
      <details className="ag-messages"><summary><MessageSquare size={16}/> Moderate room messages</summary>{data.community.messages.filter(m => !m.deleted).map(m => <div className="ag-message" key={m.id}><div><strong>{m.name} · {m.kind}</strong><p>{m.text}</p></div><button disabled={action.busy} onClick={() => void mutate({ operation: 'delete-message', messageId: m.id }, 'Message removed from the conversation.')}>Delete</button></div>)}</details>
      <button className="ag-secondary" disabled={action.busy || (!data.archived && status === 'running')} onClick={() => void mutate({ operation: 'archive', archived: !data.archived }, data.archived ? 'Room restored.' : 'Room removed from active discovery; financial records retained.')}><Archive size={16}/>{data.archived ? 'Restore room' : 'Remove room from active play'}</button>
    </>}
    {action.busy && <p className="ag-note" role="status">Authorize this change with a wallet message signature. No gas or token transfer is requested.</p>}
    {action.error && <p className="ag-error" role="alert">{action.error}</p>}
    {action.message && <p className="ag-success" role="status">{action.message}</p>}
  </section>
}

export function AdminPanel({ session }: { session: SessionState }) {
  const [pricing, setPricing] = useState<Pricing | null>(null)
  const [games, setGames] = useState<Availability[]>([])
  const [rooms, setRooms] = useState<AdminRoom[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('active')
  const [creatorFee, setCreatorFee] = useState('0')
  const [joinerFee, setJoinerFee] = useState('0')
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(false)
  const [live, setLive] = useState(true)
  const [roomRefresh, setRoomRefresh] = useState(0)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [roomError, setRoomError] = useState('')
  const feeDirty = useRef(false)
  const requestVersion = useRef(0)
  const action = useAdminAction(session)
  const refresh = useCallback(async (resetFees = false) => {
    if (!session.token) return
    const version = ++requestVersion.current
    setLoading(true)
    try {
      const [p, g] = await Promise.all([center.adminPricing(session.token), center.adminGames(session.token)])
      if (version !== requestVersion.current) return
      setPricing(p); setGames(g.games); setLoadError('')
      if (resetFees || !feeDirty.current) {
        feeDirty.current = false; setCreatorFee(String(p.pricing.creatorFee)); setJoinerFee(String(p.pricing.joinerFee))
      }
    } catch (e) { if (version === requestVersion.current) setLoadError(explainError(e)) }
    finally { if (version === requestVersion.current) setLoading(false) }
  }, [session.token])
  useEffect(() => {
    feeDirty.current = false; setPricing(null); void refresh()
    return () => { requestVersion.current++ }
  }, [refresh])
  const verified = Boolean(session.address && pricing?.admin.toLowerCase() === session.address.toLowerCase())
  useEffect(() => {
    if (!session.token || !verified) { setRooms([]); setTotal(0); setUpdatedAt(null); return }
    let active = true, inFlight = false
    const poll = async () => {
      if (!active || inFlight || document.hidden) return
      inFlight = true
      try {
        const data = await center.adminRooms(session.token!, offset)
        if (active) { setRooms(data.rooms); setTotal(data.total); setUpdatedAt(Date.now()); setRoomError('') }
      } catch (e) { if (active) setRoomError(explainError(e)) }
      finally { inFlight = false }
    }
    void poll()
    const timer = live ? window.setInterval(poll, 5000) : undefined
    const onVisible = () => { if (live) void poll() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [session.token, verified, offset, live, roomRefresh])
  const refreshAll = () => { void refresh(); setRoomRefresh(value => value + 1) }
  const feeValid = creatorFee.trim() !== '' && joinerFee.trim() !== '' &&
    Number.isSafeInteger(Number(creatorFee)) && Number.isSafeInteger(Number(joinerFee)) &&
    Number(creatorFee) >= 0 && Number(joinerFee) >= 0 &&
    Number(creatorFee) <= (pricing?.caps.creatorFee ?? 0) && Number(joinerFee) <= (pricing?.caps.joinerFee ?? 0)
  const feeChanged = Number(creatorFee) !== pricing?.pricing.creatorFee || Number(joinerFee) !== pricing?.pricing.joinerFee
  const running = rooms.filter(room => !room.archived && room.status === 'running')
  const waiting = rooms.filter(room => !room.archived && ['registration', 'ready'].includes(room.status))
  const visible = rooms.filter(r => (filter === 'all' || filter === 'active' && !r.archived && ['registration', 'ready', 'running'].includes(r.status) || filter === 'archived' && r.archived) && `${r.name} ${r.roomId} ${r.owner} ${r.templateId}`.toLowerCase().includes(search.toLowerCase()))
  return <div className="ct-page ag-page">
    <header className="ag-hero"><div className="ag-hero-orbit" aria-hidden="true"/><span className="ag-eyebrow"><ShieldCheck size={15}/> Orbix operations</span><h1>Your games.<br/><em>Your control room.</em></h1><p>Observe matches, guide players, and keep the arcade running smoothly.</p><div className="ag-hero-status"><span className="ag-badge"><Radio size={14}/>{verified ? 'Administrator verified' : 'Administrator wallet required'}</span><span className="ag-badge">{total} rooms</span><span className="ag-badge">Signed changes · audit trail</span></div></header>
    {!session.token && <div className="ag-empty"><ShieldCheck size={32}/><h2>Connect the administrator wallet</h2><p>Use Connect Wallet in the header to open game operations.</p></div>}
    {loadError && <div className="ag-error" role="alert">{loadError}<button onClick={refreshAll} disabled={loading}>Retry</button></div>}
    {session.token && verified && <>
      <div className="ag-section-head"><div><span className="ag-eyebrow">The arcade</span><h2>Game availability</h2></div><button className="ag-secondary" disabled={loading} onClick={refreshAll}><RefreshCw size={16}/>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
      <div className="ag-game-grid">{games.map(availability => {
        const id = availability.templateId
        const featured = FEATURED_GAMES.find(game => game.id === id)
        const meta = TEMPLATE_META[id]
        const game = { id, name: featured?.name ?? id.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' '), description: featured?.description ?? meta?.blurb ?? 'Server-managed game template.' }
        const current = availability.status
        return <article className="ag-game-card" key={game.id}><div className="ag-game-art"><GameBanner templateId={game.id} hue={featured?.color ?? meta?.hue ?? '#95e7ef'}/></div><div className="ag-game-body"><span className={`ag-state ag-state-${current}`}>{current === 'live' ? <Radio size={13}/> : <Wrench size={13}/>} {current}</span><h3>{game.name}</h3><p>{game.description}</p>{availability.message && <p className="ag-game-notice">{availability.message}</p>}<div className="ag-availability" role="group" aria-label={`${game.name} availability`}>{(['live', 'maintenance', 'offline'] as const).map(status => <button aria-pressed={current === status} className={current === status ? 'selected' : ''} key={status} disabled={action.busy} onClick={() => void action.run(proof => center.adminGameUpdate(game.id, session.token!, proof, { status, message: status === 'maintenance' ? 'A quick tune-up. Check back soon.' : '' }), `${game.name} is now ${status}.`, refreshAll)}>{status === 'live' ? 'Live' : status === 'maintenance' ? 'Tune-up' : 'Offline · hidden'}</button>)}</div>{featured && <a className="ag-trial" href={`/center/practice/${game.id}`}><Gamepad2 size={17}/> Trial play <span>No room or wallet</span></a>}</div></article>
      })}</div>
      <div className="ag-section-head"><div><span className="ag-eyebrow">Live oversight</span><h2>Every room, one view</h2></div><button className="ag-secondary" disabled={action.busy} onClick={() => void action.run(proof => center.adminArchiveUnused(session.token!, proof), 'Unused empty rooms older than 24 hours archived.', refreshAll)}><Archive size={16}/> Clean unused rooms</button></div>
      <section className="ag-overview" aria-label="Live room overview"><div className="ag-overview-head"><div><strong>Rooms on this page</strong><span>{updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()}` : 'Waiting for room data'} · {live ? 'refreshes every 5 seconds' : 'auto-refresh paused'}</span></div><button className="ag-secondary" aria-pressed={live} onClick={() => setLive(value => !value)}><Radio size={16}/>{live ? 'Pause live updates' : 'Resume live updates'}</button><button className="ag-secondary" onClick={() => setRoomRefresh(value => value + 1)}><RefreshCw size={16}/>Refresh rooms</button></div><dl><div><dt>Running matches</dt><dd>{running.length}</dd></div><div><dt>Waiting rooms</dt><dd>{waiting.length}</dd></div><div><dt>Admitted players</dt><dd>{rooms.filter(room => !room.archived).reduce((sum, room) => sum + room.players, 0)}</dd></div><div><dt>Archived rooms</dt><dd>{rooms.filter(room => room.archived).length}</dd></div></dl><p>Counts cover the current page of up to 100 rooms. Admitted players include disconnected players.</p></section>
      {roomError && <p className="ag-error" role="alert">Room updates failed. Showing the last successful snapshot. {roomError}</p>}
      <p className="ag-note">Private rooms are included. Hidden observation uses no player slot. Removing a room archives it; claims, entry payments, and audit records are retained. Admin changes use a message signature with no gas charge or token transfer.</p>
      <div className="ag-room-filters"><label><Search size={17}/><input aria-label="Search administrator rooms" placeholder="Search room, game, or wallet…" value={search} onChange={e => setSearch(e.target.value)}/></label><div role="group" aria-label="Room status filter">{['active', 'all', 'archived'].map(value => <button key={value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>{value}</button>)}</div></div>
      <div className="ag-room-list">{visible.map(room => <article className="ag-room-card" key={room.roomId}><div className="ag-room-icon"><Gamepad2 size={23}/></div><div className="ag-room-copy"><h3>{room.name}</h3><p>{room.templateId} · {room.visibility} · {shortAddress(room.owner)}</p><code>{room.roomId}</code></div><span className="ag-badge"><Users size={14}/>{room.players}</span><span className={`ag-state ag-state-${room.status === 'running' ? 'live' : 'maintenance'}`}>{room.archived ? 'Archived' : room.status}</span><a className="ag-primary" href={`/center/rooms/${room.roomId}?observe=1`}><Eye size={16}/> Observe</a><button className="ag-secondary" disabled={action.busy || !room.archived && room.status === 'running'} title={room.status === 'running' ? 'Finish the match before archiving.' : 'Retains all payment and settlement records.'} onClick={() => void action.run(proof => center.adminRoomAction(room.roomId, session.token!, proof, { operation: 'archive', archived: !room.archived }), room.archived ? 'Room restored.' : 'Room archived.', refreshAll)}>{room.archived ? 'Restore' : 'Remove'}</button></article>)}{!visible.length && <div className="ag-empty"><Search size={28}/><h3>No rooms in this view</h3><p>Try another filter or search.</p></div>}</div>
      <div className="ag-pagination"><button disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - 100))}>Previous</button><span>{total ? offset + 1 : 0}–{Math.min(offset + rooms.length, total)} of {total}</span><button disabled={offset + 100 >= total || loading} onClick={() => setOffset(offset + 100)}>Next</button></div>
      <section className="ag-fees" aria-labelledby="admin-fees-title"><div className="ag-fees-heading"><ShieldCheck size={23}/><div><span className="ag-eyebrow">Saved for each room</span><h2 id="admin-fees-title">Platform fee schedule</h2></div><span className="ag-badge">Chain {pricing?.chainId}</span></div><p>Fee changes apply to newly published rooms. Existing rooms keep their saved schedule. Creator token entry fees are set separately by each room’s creator.</p><div className="ag-fee-grid"><label>Room creation fee (ORBIX)<input type="number" min={0} step={1} max={pricing?.caps.creatorFee} value={creatorFee} disabled={action.busy} onChange={e => { feeDirty.current = true; setCreatorFee(e.target.value) }}/><small>Current: {pricing?.pricing.creatorFee} · Maximum: {pricing?.caps.creatorFee}</small></label><label>Joiner fee (ORBIX)<input type="number" min={0} step={1} max={pricing?.caps.joinerFee} value={joinerFee} disabled={action.busy} onChange={e => { feeDirty.current = true; setJoinerFee(e.target.value) }}/><small>Current: {pricing?.pricing.joinerFee} · Maximum: {pricing?.caps.joinerFee}</small></label></div>{!feeValid && <p className="ag-error" role="alert">Enter whole, nonnegative fees within the displayed limits.</p>}<div className="ag-fee-preview"><div><span>New room creation</span><strong>{creatorFee || '—'} ORBIX</strong></div><div><span>Each new-room joiner</span><strong>{joinerFee || '—'} ORBIX</strong></div></div><div className="ag-fee-actions"><button className="ag-primary" disabled={action.busy || !feeValid || !feeChanged} onClick={() => void action.run(proof => center.adminUpdatePricing(session.token!, proof, { creatorFee: Number(creatorFee), joinerFee: Number(joinerFee) }), 'Fee schedule saved.', () => void refresh(true))}>Sign & save fees</button><button className="ag-secondary" disabled={action.busy || !feeChanged} onClick={() => { feeDirty.current = false; setCreatorFee(String(pricing?.pricing.creatorFee ?? 0)); setJoinerFee(String(pricing?.pricing.joinerFee ?? 0)) }}>Reset draft</button><span>Wallet message signature · no gas payment</span></div></section>
    </>}
    {action.busy && <p className="ag-note" role="status">Authorize this change with a wallet message signature. No gas or token transfer is requested.</p>}
    {action.error && <p className="ag-error" role="alert">{action.error}</p>}
    {action.message && <p className="ag-success" role="status">{action.message}</p>}
  </div>
}
