// Two option cards under the header: Create | Join.
// Create shows the creator's active rooms on top so they can jump back in.
// Join shows the room-ID box and the list of public rooms below it.

import { useEffect, useState } from 'react'
import { center } from './api'
import { parseRoomInput } from './share'

type MyRoom = {
  roomId: string
  name: string
  templateId: string
  status: string
  visibility: string
  players: number
  openAt: number | null
  closeAt: number | null
  scheduled: string | null
  expiring: string | null
  active: boolean
}

type PublicRoom = {
  roomId: string
  name: string
  templateId: string
  status: string
  visibility: string
  players: number
  rewards: string
  entryKind?: string | null
  entryToken?: string | null
  entryAmount?: number | null
  entrySymbol?: string | null
}

function timeLeft(ts: number): string {
  const secs = ts - Math.floor(Date.now() / 1000)
  if (secs <= 0) return 'closing now'
  if (secs < 3600) return `${Math.ceil(secs / 60)}m left`
  if (secs < 86400) return `${Math.ceil(secs / 3600)}h left`
  return `${Math.ceil(secs / 86400)}d left`
}

function opensIn(ts: number): string {
  const secs = ts - Math.floor(Date.now() / 1000)
  if (secs <= 0) return 'open now'
  if (secs < 3600) return `opens in ${Math.ceil(secs / 60)}m`
  if (secs < 86400) return `opens in ${Math.ceil(secs / 3600)}h`
  return `opens in ${Math.ceil(secs / 86400)}d`
}

/** What a joiner must pay / gets, as tags. */
function RoomTags({ r }: { r: PublicRoom }) {
  const entry = r.entryKind === 'erc20' && r.entryAmount
  return (
    <span className="tag-row">
      {entry ? (
        <span className="tag tag-pay" title={r.entryToken ?? ''}>
          PAY {r.entryAmount} {r.entrySymbol ?? 'TOKEN'}
        </span>
      ) : (
        <span className="tag tag-free">FREE ENTRY</span>
      )}
      {r.rewards === 'funded-assets'
        ? <span className="tag tag-reward">FUNDED REWARD</span>
        : <span className="tag tag-points">POINTS</span>}
      {r.status === 'running' && <span className="tag tag-live">LIVE</span>}
    </span>
  )
}

export function ActionCards({ session, go }: {
  session: { token: string | null; address: string | null }
  go: (path: string) => void
}) {
  const [tab, setTab] = useState<'create' | 'join'>('join')
  const [myRooms, setMyRooms] = useState<MyRoom[]>([])
  const [pubRooms, setPubRooms] = useState<PublicRoom[]>([])
  const [joinInput, setJoinInput] = useState('')
  const [joinErr, setJoinErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const pull = async () => {
      try {
        const r = await center.rooms()
        if (live) setPubRooms((r.rooms ?? []) as PublicRoom[])
      } catch { /* list is best-effort */ }
      if (session.token) {
        try {
          const mine = await center.myRooms(session.token)
          if (live) setMyRooms((mine.rooms ?? []) as MyRoom[])
        } catch { /* ignore */ }
      } else if (live) {
        setMyRooms([])
      }
    }
    void pull()
    const t = setInterval(pull, 15_000)
    return () => { live = false; clearInterval(t) }
  }, [session.token])

  const parsed = parseRoomInput(joinInput)
  const doJoin = () => {
    if (!parsed) { setJoinErr('Paste a room ID or a full share link.'); return }
    setJoinErr(null)
    const q = parsed.invite ? `?invite=${parsed.invite}` : ''
    go(`/center/rooms/${parsed.roomId}${q}`)
  }

  const activeMine = myRooms.filter((r) => r.active)

  return (
    <section className="action-cards" aria-label="Create or join">
      {/* ------------------------------- CREATE ------------------------------- */}
      <div className={`action-card${tab === 'create' ? ' on' : ''}`}>
        <button className="action-head" onClick={() => setTab('create')} aria-expanded={tab === 'create'}>
          <span className="action-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </span>
          <span className="action-titles">
            <b>Create a room</b>
            <small>Pick a game, set the rules and rewards</small>
          </span>
          <span className="action-chev" aria-hidden="true">{tab === 'create' ? '−' : '+'}</span>
        </button>
        {tab === 'create' && (
          <div className="action-body">
            <button className="btn-primary" style={{ width: '100%' }} onClick={() => go('/center/create')}>
              New room <span aria-hidden="true">↗</span>
            </button>
            {session.token && activeMine.length > 0 && (
              <div className="my-rooms">
                <span className="my-rooms-title">Your active rooms</span>
                {activeMine.map((r) => (
                  <button key={r.roomId} className="my-room" onClick={() => go(`/center/rooms/${r.roomId}`)}>
                    <span className="my-room-name">{r.name}</span>
                    <span className="my-room-meta">
                      {r.status}
                      {' · '}
                      {r.scheduled ? opensIn(r.openAt ?? 0) : r.closeAt ? timeLeft(r.closeAt) : 'open'}
                      {' · '}
                      {r.players} in
                    </span>
                  </button>
                ))}
              </div>
            )}
            {session.token && activeMine.length === 0 && (
              <p className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
                No active rooms yet. Create one and it will show here for quick access.
              </p>
            )}
            {!session.token && (
              <p className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
                Connect a wallet to create a room and track it here.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ------------------------------- JOIN -------------------------------- */}
      <div className={`action-card${tab === 'join' ? ' on' : ''}`}>
        <button className="action-head" onClick={() => setTab('join')} aria-expanded={tab === 'join'}>
          <span className="action-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="action-titles">
            <b>Join a room</b>
            <small>Enter a room ID, a link, or pick from open rooms</small>
          </span>
          <span className="action-chev" aria-hidden="true">{tab === 'join' ? '−' : '+'}</span>
        </button>
        {tab === 'join' && (
          <div className="action-body">
            <div className="join-id-row">
              <input
                type="text"
                value={joinInput}
                spellCheck={false}
                autoComplete="off"
                placeholder="Room ID or share link"
                onChange={(e) => { setJoinInput(e.target.value); setJoinErr(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') doJoin() }}
                aria-label="Room ID or share link"
              />
              <button className="btn-primary" onClick={doJoin} disabled={!parsed}>Join</button>
            </div>
            {joinErr && <p className="err" role="alert" style={{ fontSize: 11.5 }}>{joinErr}</p>}

            <div className="pub-rooms">
              <span className="pub-rooms-title">
                Open rooms <span className="pub-count">{pubRooms.length}</span>
              </span>
              {pubRooms.length === 0 && (
                <p className="muted" style={{ fontSize: 11.5 }}>No public rooms right now.</p>
              )}
              {pubRooms.map((r) => (
                <button key={r.roomId} className="pub-room" onClick={() => go(`/center/rooms/${r.roomId}`)}>
                  <span className="pub-room-name">
                    <b>{r.name}</b>
                    <small>{r.templateId} · {r.players} in · ID <span className="mono" translate="no">{r.roomId}</span></small>
                  </span>
                  <RoomTags r={r} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
