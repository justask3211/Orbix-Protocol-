import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, EyeOff, Lightbulb, MessageCircle, Send, ShieldCheck, Trash2, Users, VolumeX, X } from 'lucide-react'
import { API_BASE, ApiError, explainError } from './api'
import type { SessionState } from './session'
import { useModalFocus } from './useModalFocus'
import './community.css'

export type CommunitySettings = { muteChat: boolean; hidePlayers: boolean; hideGuesses: boolean }
type CommunityMessage = { id: number; kind: 'chat' | 'hint'; text: string; deleted: boolean; createdAt: number; isMine: boolean; isHost: boolean; playerId: string; name: string }
type CommunitySnapshot = { settings: CommunitySettings; messages: CommunityMessage[]; players: { playerId: string; name: string; ready: boolean }[]; isHost: boolean }
type CommunityRoster = { players: { playerId: string; name: string; wallet: string; role: string; ready: boolean }[]; banned: { playerId: string; name: string; wallet: string }[] }
type Props = {
  roomId: string
  session: Pick<SessionState, 'token' | 'address'>
  isHost: boolean
  roomStatus?: string
  onConnect?: () => void
  onSettingsChange?: (settings: CommunitySettings) => void
  onRosterChange?: () => void
}

async function communityRequest<T>(roomId: string, path: string, token: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomId)}/community${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(response.status, result.detail?.code ?? `HTTP_${response.status}`, result.detail?.message ?? 'The room community could not be updated.')
  return result as T
}

function HintPopup({ hint, onClose }: { hint: CommunityMessage; onClose: () => void }) {
  const dialog = useModalFocus(onClose)
  return <div className="room-community-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}><div ref={dialog} tabIndex={-1} className="room-community-hint-popup" role="dialog" aria-modal="true" aria-labelledby="room-community-hint-title"><button onClick={onClose} className="room-community-close" aria-label="Close hint"><X size={20} /></button><span className="room-community-hint-symbol"><Lightbulb size={31} aria-hidden="true" /></span><h2 id="room-community-hint-title">A hint from your host.</h2><p>{hint.text}</p><small>{new Date(hint.createdAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small><button className="room-community-primary" onClick={onClose}>Back to the game</button></div></div>
}

/** Chat is authenticated; creator wallet exports are fetched only when requested. */
export function RoomCommunity({ roomId, session, isHost, roomStatus, onConnect, onSettingsChange, onRosterChange }: Props) {
  const [snapshot, setSnapshot] = useState<CommunitySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const [hintText, setHintText] = useState('')
  const [hintDelay, setHintDelay] = useState('0')
  const [notice, setNotice] = useState<string | null>(null)
  const [hintOpen, setHintOpen] = useState(false)
  const [roster, setRoster] = useState<CommunityRoster | null>(null)
  const [rosterOpen, setRosterOpen] = useState(false)
  const [pendingRemoval, setPendingRemoval] = useState<{ wallet: string; action: 'kick' | 'ban' } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const generation = useRef(0)
  const pendingRead = useRef<{ generation: number; promise: Promise<CommunitySnapshot> } | null>(null)
  const lastSnapshot = useRef('')
  const lastSettings = useRef('')
  const settingsCallback = useRef(onSettingsChange)
  settingsCallback.current = onSettingsChange
  const acceptSnapshot = useCallback((result: CommunitySnapshot) => {
    const payload = JSON.stringify(result)
    if (lastSnapshot.current === payload) return
    lastSnapshot.current = payload
    setSnapshot(result)
    const settings = JSON.stringify(result.settings)
    if (lastSettings.current !== settings) { lastSettings.current = settings; settingsCallback.current?.(result.settings) }
  }, [])
  const readSnapshot = useCallback((): Promise<CommunitySnapshot> => {
    const current = generation.current
    if (pendingRead.current?.generation === current) return pendingRead.current.promise
    if (!session.token) return Promise.reject(new Error('Connect your wallet.'))
    const promise = communityRequest<CommunitySnapshot>(roomId, '', session.token).finally(() => {
      if (pendingRead.current?.promise === promise) pendingRead.current = null
    })
    pendingRead.current = { generation: current, promise }
    return promise
  }, [roomId, session.token])
  useEffect(() => {
    const current = ++generation.current
    let active = true
    let pulling = false
    setSnapshot(null); setRoster(null); setRosterOpen(false); setHintOpen(false); setPendingRemoval(null); setError(null); setBusy(false); setText(''); setHintText(''); setHintDelay('0'); setNotice(null)
    lastSnapshot.current = ''; lastSettings.current = ''
    setLoading(Boolean(session.token))
    if (!session.token) return () => { active = false; generation.current++ }
    async function pull() {
      if (pulling || document.hidden) return
      pulling = true
      try {
        const result = await readSnapshot()
        if (active && generation.current === current) { acceptSnapshot(result); setError(null) }
      } catch (failure) { if (active && generation.current === current) setError(explainError(failure)) }
      finally { pulling = false; if (active && generation.current === current) setLoading(false) }
    }
    void pull()
    const timer = window.setInterval(() => { void pull() }, 5_000)
    const visible = () => { if (!document.hidden) void pull() }
    document.addEventListener('visibilitychange', visible)
    return () => { active = false; generation.current++; clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [roomId, session.token, refreshKey, readSnapshot, acceptSnapshot])

  const refresh = useCallback(async () => {
    if (!session.token) return
    const current = generation.current
    // An in-flight poll may predate the mutation; finish it, then fetch the new
    // state without sending overlapping reads or displaying an optimistic chat.
    if (pendingRead.current?.generation === current) await pendingRead.current.promise.catch(() => undefined)
    if (generation.current !== current) return
    const result = await readSnapshot()
    if (generation.current === current) acceptSnapshot(result)
  }, [session.token, readSnapshot, acceptSnapshot])

  async function mutate(path: string, method: string, body?: unknown, after?: () => void) {
    if (!session.token || busy) return
    const current = generation.current
    setBusy(true); setError(null); setNotice(null)
    try {
      await communityRequest(roomId, path, session.token, method, body)
      if (generation.current !== current) return
      after?.()
      await refresh()
    } catch (failure) { if (generation.current === current) setError(explainError(failure)) }
    finally { if (generation.current === current) setBusy(false) }
  }
  async function send(event: FormEvent, kind: 'chat' | 'hint') {
    event.preventDefault()
    const value = kind === 'hint' ? hintText : text
    if (!value.trim()) return
    const delay = Number(hintDelay)
    if (kind === 'hint' && (!Number.isInteger(delay) || delay < 0 || delay > 3600)) { setError('Choose a hint delay of 0–3600 whole seconds.'); return }
    await mutate('/messages', 'POST', { text: value.trim(), kind, ...(kind === 'hint' ? { delaySeconds: delay } : {}) }, () => {
      if (kind === 'hint') { setHintText(''); setNotice(delay > 0 ? `Hint scheduled in ${delay} seconds${lobby ? ' after the match starts' : ''}.` : 'Your hint is now visible to the room.') }
      else setText('')
    })
  }
  async function loadRoster() {
    if (!session.token || busy) return
    const current = generation.current
    setBusy(true); setError(null)
    try {
      const result = await communityRequest<CommunityRoster>(roomId, '/roster', session.token)
      if (generation.current === current) { setRoster(result); setRosterOpen(true) }
    } catch (failure) { if (generation.current === current) setError(explainError(failure)) }
    finally { if (generation.current === current) setBusy(false) }
  }
  async function removePlayer() {
    if (!pendingRemoval) return
    await mutate(`/players/${encodeURIComponent(pendingRemoval.wallet)}/${pendingRemoval.action}`, 'POST', undefined, () => {
      setPendingRemoval(null); setRoster(null); setRosterOpen(false); onRosterChange?.()
    })
  }
  function exportRoster() {
    if (!roster) return
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`
    // Prefix spreadsheet formulas in user-supplied names to avoid CSV execution.
    const safeName = (value: string) => /^\s*[=+\-@]/.test(value) || /^[\t\r]/.test(value) ? `'${value}` : value
    const csv = ['Username,Wallet,Role,Ready', ...roster.players.map((player) => [safeName(player.name), player.wallet, player.role, String(player.ready)].map(quote).join(','))].join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `orbix-room-${roomId}-players.csv`; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const owner = isHost && Boolean(snapshot?.isHost)
  const messages = snapshot?.messages.filter((message) => !message.deleted) ?? []
  const latestHint = [...messages].reverse().find((message) => message.kind === 'hint')
  const lobby = roomStatus === 'registration' || roomStatus === 'ready'
  const muted = Boolean(snapshot?.settings.muteChat && !owner)
  return <section className="room-community" aria-labelledby="room-community-title">
    <header><div><span className="room-community-eyebrow"><MessageCircle size={15} aria-hidden="true" />Your room, together</span><h2 id="room-community-title">Live room chat.</h2></div><span className="room-community-poll">Updates every 5 seconds</span></header>
    {!session.token ? <div className="room-community-empty"><Users size={27} aria-hidden="true" /><p>Connect and join this room to open chat and host hints.</p>{onConnect && <button className="room-community-primary" onClick={onConnect}>Connect wallet</button>}</div> : <>
      {loading && <p className="room-community-status" role="status">Opening the room community…</p>}
      {error && <div className="room-community-error" role="status"><p>{error}</p><button disabled={busy} onClick={() => setRefreshKey((key) => key + 1)}>Refresh</button></div>}
      {notice && <p className="room-community-notice" role="status">{notice}</p>}
      {snapshot && <>
        {latestHint && <button className="room-community-hint" onClick={() => setHintOpen(true)}><Lightbulb size={23} aria-hidden="true" /><span><strong>Host hint</strong><span>{latestHint.text}</span></span><ChevronDown size={18} aria-hidden="true" /></button>}
        <div className="room-community-chat" role="log" aria-label="Room comments and host hints" aria-live="polite" aria-relevant="additions text">
          {messages.length === 0 && <p className="room-community-empty-chat">Say hello to your crew. Host hints will appear here too.</p>}
          {messages.map((message) => <article key={message.id} className={`room-community-message ${message.kind === 'hint' ? 'hint' : ''} ${message.isMine ? 'mine' : ''}`}><div><strong>{message.isHost ? 'Host' : message.name}{message.isMine ? ' · You' : ''}</strong><time dateTime={new Date(message.createdAt * 1000).toISOString()}>{new Date(message.createdAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>{owner && <button disabled={busy} onClick={() => { void mutate(`/messages/${message.id}`, 'DELETE') }} aria-label={`Delete ${message.kind} from ${message.name}`}><Trash2 size={14} /></button>}</div>{message.kind === 'hint' && <span className="room-community-message-kind"><Lightbulb size={12} aria-hidden="true" />Host hint</span>}<p>{message.text}</p></article>)}
        </div>
        {muted && <p className="room-community-muted"><VolumeX size={15} aria-hidden="true" />The host has muted chat. You can still read announcements and hints.</p>}
        <form className="room-community-compose" onSubmit={(event) => { void send(event, 'chat') }}><label htmlFor="room-community-message">Message your room</label><div><input id="room-community-message" value={text} onChange={(event) => setText(event.target.value)} placeholder={muted ? 'Chat is muted' : 'Good luck, everyone!'} maxLength={500} disabled={busy || muted} autoComplete="off" /><button className="room-community-primary" type="submit" disabled={busy || muted || !text.trim()}><Send size={16} aria-hidden="true" /><span>Send</span></button></div><small>{text.length}/500 · Up to 10 messages per minute</small></form>
        {snapshot.settings.hidePlayers ? <p className="room-community-muted"><EyeOff size={15} aria-hidden="true" />The host has hidden the player list.</p> : <div className="room-community-player-strip" aria-label="Admitted players">{snapshot.players.map((player) => <span key={player.playerId}><span aria-hidden="true">{player.name.slice(0, 1).toUpperCase()}</span>{player.name}{player.ready && <small>Ready</small>}</span>)}</div>}
        {owner && <details className="room-community-controls"><summary><ShieldCheck size={17} aria-hidden="true" />Creator controls<ChevronDown size={17} aria-hidden="true" /></summary><div className="room-community-control-body"><p>Control chat, visibility, and hints while you host.</p><div className="room-community-switches">{([['muteChat', 'Mute player chat', 'Host announcements and hints stay available.'], ['hidePlayers', 'Hide player identities', 'Hide the player list and use anonymous names in chat.'], ['hideGuesses', 'Hide guess logs', 'Keep guesses out of the shared game log.']] as const).map(([key, label, description]) => <label key={key}><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={snapshot.settings[key]} disabled={busy} onChange={(event) => { void mutate('/settings', 'PATCH', { [key]: event.target.checked }) }} /></label>)}</div>
          <form className="room-community-compose host-hint" onSubmit={(event) => { void send(event, 'hint') }}><label htmlFor="room-community-host-hint">Give your players a custom hint</label><textarea id="room-community-host-hint" value={hintText} onChange={(event) => setHintText(event.target.value)} placeholder="Tell your players what to look for…" maxLength={500} rows={3} disabled={busy} /><label className="room-community-hint-delay">Deliver after (seconds)<input type="number" value={hintDelay} onChange={(event) => setHintDelay(event.target.value)} min={0} max={3600} step={1} disabled={busy} /><small>0 = now. In the lobby, the countdown begins at match start.</small></label><div><small>{hintText.length}/500 · Visible when delivered</small><button type="submit" className="room-community-primary" disabled={busy || !hintText.trim()}><Lightbulb size={16} aria-hidden="true" />{Number(hintDelay) > 0 ? 'Schedule hint' : 'Publish hint'}</button></div></form>
          <div className="room-community-roster-heading"><div><strong>Players & wallet addresses</strong><p>Verified sign-in wallets. Visible only to you as the creator.</p></div><button className="room-community-secondary" disabled={busy} onClick={() => rosterOpen ? setRosterOpen(false) : void loadRoster()}>{rosterOpen ? 'Hide roster' : 'Open roster'}</button></div>
          {rosterOpen && roster && <div className="room-community-roster"><div className="room-community-roster-note"><p>Wallets identify admitted players and reward recipients. Exporting this list does not transfer tokens.</p><button onClick={exportRoster} className="room-community-secondary">Export CSV</button></div>{roster.players.map((player) => <div className="room-community-roster-player" key={player.playerId}><div><strong>{player.name}</strong><code>{player.wallet}</code><small>{player.role} · {player.ready ? 'Ready' : 'Not ready'}</small></div>{lobby && player.wallet.toLowerCase() !== session.address?.toLowerCase() && <div className="room-community-remove-actions"><button disabled={busy} onClick={() => setPendingRemoval({ wallet: player.wallet, action: 'kick' })}>Kick</button><button disabled={busy} onClick={() => setPendingRemoval({ wallet: player.wallet, action: 'ban' })}>Ban</button></div>}</div>)}{roster.banned.length > 0 && <><h4>Banned wallets</h4>{roster.banned.map((player) => <div className="room-community-roster-player" key={player.playerId}><div><strong>{player.name}</strong><code>{player.wallet}</code></div><button disabled={busy} className="room-community-secondary" onClick={() => { void mutate(`/players/${encodeURIComponent(player.wallet)}/ban`, 'DELETE', undefined, () => { setRoster(null); setRosterOpen(false) }) }}>Unban</button></div>)}</>}{!lobby && <p className="room-community-roster-note">Kick and ban are available in the lobby before start. A running match keeps its reward roster.</p>}</div>}
          {pendingRemoval && <div className="room-community-confirm" role="alert"><p>{pendingRemoval.action === 'ban' ? 'Ban this wallet from rejoining and remove it from the lobby?' : 'Remove this player from the lobby? They can rejoin.'}<code>{pendingRemoval.wallet}</code>This action does not issue a token refund.</p><button disabled={busy} onClick={() => { void removePlayer() }}>{pendingRemoval.action === 'ban' ? 'Ban player' : 'Kick player'}</button><button disabled={busy} onClick={() => setPendingRemoval(null)}>Keep player</button></div>}
        </div></details>}
      </>}
    </>}
    {hintOpen && latestHint && <HintPopup hint={latestHint} onClose={() => setHintOpen(false)} />}
  </section>
}
