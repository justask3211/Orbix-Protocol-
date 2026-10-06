import { Suspense, lazy, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Box, Clock3, Gem, Hand, Shield, Swords, Trophy } from 'lucide-react'
import type { StageProps } from './stages'
import './arenaPlay.css'

const GameWorld = lazy(() => import('./worlds/GameWorld'))
export type ArenaInput = { dx: number; dz: number; active: boolean }
export type ArenaInputRef = RefObject<ArenaInput>
export type ArenaCharacter = 'fox' | 'robot' | 'frog' | 'cat'
const CHARACTERS: { id: ArenaCharacter; name: string; face: string; color: string }[] = [
  { id: 'fox', name: 'Sunny fox', face: '🦊', color: '#ffac6f' },
  { id: 'robot', name: 'Orbit robot', face: '🤖', color: '#94ddea' },
  { id: 'frog', name: 'Jelly frog', face: '🐸', color: '#b9ea71' },
  { id: 'cat', name: 'Cloud cat', face: '🐱', color: '#c8abef' },
]

export function CharacterPicker({ selected = 'fox', onChoose, disabled = false }: { selected?: string; onChoose: (character: ArenaCharacter) => void; disabled?: boolean }) {
  return <fieldset className="ar-characters" disabled={disabled}><legend>Choose your character</legend>{CHARACTERS.map(character => <button type="button" key={character.id} aria-pressed={selected === character.id} onClick={() => onChoose(character.id)} style={{ '--ar-character': character.color } as CSSProperties}><span aria-hidden>{character.face}</span><strong>{character.name}</strong><small>{selected === character.id ? 'Selected' : 'Choose'}</small></button>)}</fieldset>
}

const textInput = (target: EventTarget | null) => target instanceof HTMLElement && Boolean(target.closest('input,textarea,select,[contenteditable="true"]'))
const MOVE_KEYS: Record<string, [number, number]> = { w: [0, -1], arrowup: [0, -1], s: [0, 1], arrowdown: [0, 1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] }
const shortName = (wallet: string, me: string, state: StageProps['state']) => wallet === me ? 'You' : state._hidePlayers ? 'Player' : String(state._playerNames?.[wallet] || (wallet.length > 16 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet))
const arenaError = (code: string) => ({ COOLDOWN: 'Your ability is recharging. Try again in a moment.', SLOW_DOWN: 'Your ability is recharging. Try again in a moment.', NO_PUSH_POWER: 'Collect a pink push power-up first.', NO_POWERUP: 'Collect a pink push power-up first.', NO_CRATE_IN_REACH: 'Move closer to a crate, then break it.', OUT_OF_RANGE: 'Move closer to a target or crate.', STUNNED: 'You are dazed. Controls return after you recover.', NOT_ALIVE: 'Wait for your character to return to the arena.', INVALID_CHARACTER: 'Choose one of the available characters.' } as Record<string, string>)[code] ?? `The server declined that action: ${code}`

/** Inputs are intents only. Server positions, collisions, pickups and scores are authoritative. */
export function ArenaPlay(props: StageProps) {
  const { state, act, me, finished } = props
  const game = state.arenaKind === 'boss-raid' ? 'boss-raid' : state.arenaKind === 'combat-duel' ? 'combat-duel' : 'token-catch'
  const title = game === 'boss-raid' ? 'Boss Raid' : game === 'combat-duel' ? 'Arena Duel' : 'Token Catch'
  const body = state.bodies?.[me]
  const enabled = !finished && !state.finished && state._canAct !== false && Boolean(body)
  const input = useRef<ArenaInput>({ dx: 0, dz: 0, active: false })
  const panel = useRef<HTMLElement>(null)
  const held = useRef(new Set<string>())
  const seq = useRef(Number(body?.inputSeq) || 0)
  const actRef = useRef(act)
  const enabledRef = useRef(enabled)
  const stateRef = useRef(state)
  const lastMove = useRef(0)
  const lastAction = useRef(0)
  const blocking = useRef(false)
  const aim = useRef<number | null>(null)
  const pointerAttack = useRef<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [showCharacters, setShowCharacters] = useState(false)
  const [help, setHelp] = useState(false)
  actRef.current = act; enabledRef.current = enabled; stateRef.current = state
  seq.current = Math.max(seq.current, Number(body?.inputSeq) || 0)
  const receivedTime = useRef({ server: Number(state.serverTimeMs) || Date.now(), client: Date.now() })
  useEffect(() => { receivedTime.current = { server: Number(state.serverTimeMs) || Date.now(), client: Date.now() } }, [state.serverTimeMs])
  const serverNow = receivedTime.current.server + now - receivedTime.current.client
  const remainingMs = Math.max(0, (Number(state.durationSeconds ?? state.duration) || 0) * 1000 - (Number(state.nowMs) || 0) - (finished ? 0 : now - receivedTime.current.client))
  const stunned = Number(body?.stunnedUntil) > serverNow
  const respawning = Number(body?.respawnAt) > serverNow
  const attackCooling = Math.max(0, Number(body?.attackReadyAt || 0) - serverNow)
  const pushCooling = Math.max(0, Number(body?.pushReadyAt || 0) - serverNow)
  const pushCharges = Math.max(0, Number(body?.pushCharges) || 0)

  const sendAction = (kind: 'attack' | 'push' | 'interact') => {
    if (!enabledRef.current || document.hidden || Date.now() - lastAction.current < 150) return
    lastAction.current = Date.now()
    actRef.current({ kind })
  }
  const refreshInput = () => {
    let dx = 0, dz = 0
    for (const key of held.current) { const direction = MOVE_KEYS[key]; if (direction) { dx += direction[0]; dz += direction[1] } }
    const length = Math.max(1, Math.hypot(dx, dz))
    input.current = { dx: dx / length, dz: dz / length, active: enabledRef.current && !document.hidden }
  }
  const releaseAll = () => {
    const wasMoving = Boolean(input.current.dx || input.current.dz)
    held.current.clear(); input.current = { dx: 0, dz: 0, active: false }
    if (enabledRef.current && wasMoving) actRef.current({ kind: 'move', dx: 0, dz: 0, seq: ++seq.current })
    if (blocking.current && enabledRef.current) actRef.current({ kind: 'block', active: false })
    blocking.current = false
    if (pointerAttack.current !== null) { window.clearTimeout(pointerAttack.current); pointerAttack.current = null }
  }
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) setNow(Date.now())
      const current = stateRef.current.bodies?.[me]
      const serverTime = receivedTime.current.server + Date.now() - receivedTime.current.client
      if (!enabledRef.current || document.hidden || Number(current?.respawnAt) > serverTime || Number(current?.stunnedUntil) > serverTime) { input.current.active = false; return }
      refreshInput()
      if (!(input.current.dx || input.current.dz) && !(lastMove.current)) return
      actRef.current({ kind: 'move', dx: input.current.dx, dz: input.current.dz, ...(aim.current !== null ? { yaw: aim.current } : input.current.dx || input.current.dz ? { yaw: Math.atan2(input.current.dx, input.current.dz) } : {}), seq: ++seq.current })
      lastMove.current = input.current.dx || input.current.dz ? Date.now() : 0
    }, 100)
    const down = (event: KeyboardEvent) => {
      if (!enabledRef.current || textInput(event.target) || !panel.current?.contains(document.activeElement)) return
      const key = event.key.toLowerCase()
      if (MOVE_KEYS[key]) { event.preventDefault(); aim.current = null; held.current.add(key); refreshInput() }
      else if (key === ' ' || key === 'q' || key === 'e') { if (key === ' ' && event.target instanceof HTMLElement && event.target.closest('button')) return; event.preventDefault(); if (!event.repeat) sendAction(key === ' ' ? 'attack' : key === 'q' ? 'push' : 'interact') }
      else if (key === 'shift' && !blocking.current) { event.preventDefault(); blocking.current = true; actRef.current({ kind: 'block', active: true }) }
    }
    const up = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (held.current.delete(key)) refreshInput()
      if (key === 'shift' && blocking.current) { blocking.current = false; if (enabledRef.current) actRef.current({ kind: 'block', active: false }) }
    }
    const visibility = () => { if (document.hidden) releaseAll() }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', releaseAll); document.addEventListener('visibilitychange', visibility)
    return () => { window.clearInterval(timer); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', releaseAll); document.removeEventListener('visibilitychange', visibility); releaseAll() }
  }, [me])
  useEffect(() => { if (!enabled) releaseAll() }, [enabled])

  const direction = (key: string, event: PointerEvent<HTMLButtonElement>, down: boolean) => {
    if (down) { event.preventDefault(); aim.current = null; event.currentTarget.setPointerCapture(event.pointerId); panel.current?.focus({ preventScroll: true }); held.current.add(key) }
    else held.current.delete(key)
    refreshInput()
  }
  const players: string[] = Array.isArray(state.players) ? state.players : props.players
  const scores: { who: string; score?: number; team?: string; character?: string }[] = Object.entries(state.bodies ?? {}).map(([who, value]) => ({ who, ...(value as Record<string, any>), score: Number(state.scores?.[who] ?? (value as Record<string, any>).score) || 0 }))
  scores.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
  const health = Math.max(0, Number(body?.hp) || 0)
  const maximum = Math.max(1, Number(body?.maxHp) || 100)
  return <section className={`gp gp-${game} gp-arena`} ref={panel} tabIndex={0} aria-label={`${title} movement arena. WASD or arrows to move.`} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) releaseAll() }}>
    <header className="gp-heading"><div className="gp-title-icon" aria-hidden>{game === 'token-catch' ? <Gem /> : <Swords />}</div><div><span className="gp-eyebrow">{game === 'token-catch' ? 'Sunnydrop Park · collect, dodge, push' : game === 'boss-raid' ? 'Crystalheart Outpost · team raid' : 'Twinlight Arena · move, guard, strike'}</span><h3>{title}</h3></div><div className="gp-heading-actions"><span className="gp-clock"><Clock3 size={16} />{finished ? 'Finished' : `${Math.ceil(remainingMs / 1000)}s`}</span><button type="button" className="gp-help-toggle" aria-expanded={help} onClick={() => setHelp(!help)}>Controls</button></div></header>
    {help && <div className="gp-rule-help"><p><strong>WASD / arrows</strong> move · <strong>Space</strong> attacks · <strong>E</strong> breaks a nearby crate · <strong>Q</strong> pushes · hold <strong>Shift</strong> to guard. On touch, hold a direction and use the action buttons. Click the world to focus keyboard controls.</p><p>{game === 'token-catch' ? 'Walk under falling coins to collect them after landing. Bombs scatter half your collected coins. A push power-up lets you knock a rival away; a shield protects you. Scattered coins are available to everyone.' : game === 'boss-raid' ? 'Move around the guardian, find weapons in crates and keep your crew alive. Your team competes on confirmed boss damage. Revive after a knockout and continue fighting.' : 'Face your opponent in a small arena. Find a sword, spear or gun, use your shield and move out of range. The server checks every hit; a knockout wins.'}</p><p>Collecting a coin changes your game score. Room results and verified settlement determine rewards.</p></div>}
    <div className="gp-scene ar-scene" onPointerDown={() => panel.current?.focus({ preventScroll: true })}><Suspense fallback={<div className="ar-loading" role="status"><span className="ar-loading-orb" /><strong>Opening {title}…</strong><p>Loading the shared 3D renderer and building your compact world.</p></div>}><GameWorld game={game} state={state} me={me} players={players} inputRef={input} onAim={yaw => { if (!enabledRef.current) return; aim.current = yaw; lastMove.current = Date.now() }} onAttack={() => { if (pointerAttack.current !== null) window.clearTimeout(pointerAttack.current); pointerAttack.current = window.setTimeout(() => { pointerAttack.current = null; sendAction('attack') }, 120) }} /></Suspense>
      <div className="ar-hud"><span><Gem size={15} />{Number(state.scores?.[me] ?? body?.score ?? 0).toLocaleString()} <small>{game === 'token-catch' ? 'coins' : 'damage'}</small></span><span><Swords size={15} />{String(body?.weapon || 'hands')}</span>{body?.team && <span>{String(body.team).replace('team-', 'Team ')}</span>}</div>
      {body && <div className="ar-vitals"><div role="progressbar" aria-label="Your health" aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={health}><i style={{ width: `${health / maximum * 100}%` }} /></div><span>{respawning ? `Returning in ${Math.ceil((body.respawnAt - serverNow) / 1000)}s` : stunned ? 'Dazed · recovering' : `${health} / ${maximum} HP`}</span></div>}
      {state._canAct === false && <div className="ar-watch">{state._connection && state._connection !== 'open' ? 'Reconnecting · synchronizing world' : 'Watching the arena'}</div>}
    </div>
    <div className="ar-pickup-guide" aria-label="Pickup colors">{(game === 'token-catch' ? [{ color: '#edbd43', label: 'Gold coins' }, { color: '#443b62', label: 'Dark bombs · avoid' }, { color: '#f88aaa', label: 'Pink push power' }, { color: '#66c5d5', label: 'Blue shield' }] : [{ color: '#bbbfc4', label: 'Silver sword' }, { color: '#ba9766', label: 'Tan spear' }, { color: '#85b6cf', label: 'Blue gun' }, { color: '#66c5d5', label: 'Cyan shield' }, { color: '#96c45b', label: 'Green heal' }]).map(pickup => <span key={pickup.label}><i style={{ background: pickup.color }} />{pickup.label}</span>)}</div>
    {state.boss && <div className="gp-boss-health"><div className="gp-boss-health-heading"><strong>Crystal guardian · phase {state.boss.phase || 1}</strong><span>{Math.max(0, Number(state.boss.hp)).toLocaleString()} / {Number(state.boss.maxHp).toLocaleString()} HP</span></div><div className="gp-health-track"><span style={{ width: `${Math.max(0, Number(state.boss.hp)) / Math.max(1, Number(state.boss.maxHp)) * 100}%` }} /></div></div>}
    <div className="ar-controls"><div className="ar-dpad" aria-label="Movement controls">{[{ key: 'w', label: 'Move forward', icon: <ArrowUp /> }, { key: 'a', label: 'Move left', icon: <ArrowLeft /> }, { key: 's', label: 'Move backward', icon: <ArrowDown /> }, { key: 'd', label: 'Move right', icon: <ArrowRight /> }].map(item => <button type="button" key={item.key} className={`ar-direction ar-key-${item.key}`} aria-label={item.label} disabled={!enabled || respawning || stunned} onPointerDown={event => direction(item.key, event, true)} onPointerUp={event => direction(item.key, event, false)} onPointerCancel={event => direction(item.key, event, false)} onLostPointerCapture={event => direction(item.key, event, false)} onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); held.current.add(item.key); refreshInput() } }} onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') { held.current.delete(item.key); refreshInput() } }}>{item.icon}</button>)}<span>WASD</span></div>
      <div className="ar-action-grid"><button type="button" className="gp-action ar-strike" disabled={!enabled || respawning || stunned || attackCooling > 0} onClick={() => sendAction('attack')}><Swords />{attackCooling > 0 ? `${(attackCooling / 1000).toFixed(1)}s` : 'Attack'}<kbd>Space</kbd></button><button type="button" className="ar-action" disabled={!enabled || respawning || stunned || pushCharges === 0 || pushCooling > 0} onClick={() => sendAction('push')} title={pushCharges === 0 ? 'Collect a pink push power-up first' : `${pushCharges} push charges available`}><Hand />{pushCooling > 0 ? `${(pushCooling / 1000).toFixed(1)}s` : `Push · ${pushCharges}`}<kbd>Q</kbd></button><button type="button" className="ar-action" disabled={!enabled || respawning || stunned || attackCooling > 0} onClick={() => sendAction('interact')}><Box />Break crate<kbd>E</kbd></button><button type="button" className="ar-action" aria-pressed={Boolean(body?.blocking)} disabled={!enabled || respawning || stunned} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); blocking.current = true; act({ kind: 'block', active: true }) }} onPointerUp={() => { blocking.current = false; act({ kind: 'block', active: false }) }} onPointerCancel={() => { blocking.current = false; if (enabled) act({ kind: 'block', active: false }) }} onLostPointerCapture={() => { if (blocking.current) { blocking.current = false; if (enabled) act({ kind: 'block', active: false }) } }} onKeyDown={event => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); blocking.current = true; act({ kind: 'block', active: true }) } }} onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') { blocking.current = false; act({ kind: 'block', active: false }) } }}><Shield />{body?.blocking ? 'Guarding' : 'Hold guard'}<kbd>Shift</kbd></button></div>
      <button type="button" className="ar-character-toggle" onClick={() => setShowCharacters(!showCharacters)} aria-expanded={showCharacters}><span aria-hidden>{CHARACTERS.find(character => character.id === body?.character)?.face || '🦊'}</span>Character</button>
    </div>
    {showCharacters && <CharacterPicker selected={body?.character} disabled={!enabled} onChoose={character => act({ kind: 'equip', character })} />}
    {state._actionError && <p className="gp-status gp-status-error" role="alert">{arenaError(String(state._actionError))}</p>}
    <details className="ar-leaderboard"><summary><Trophy size={17} />{game === 'boss-raid' ? 'Crew damage & players' : 'Live standings'}<span>{players.length} players</span></summary>{game === 'boss-raid' && <div className="ar-team-standings">{Object.entries(state.teamDamage ?? {}).map(([team, damage]) => <div key={team}><strong>{team.replace('team-', 'Team ')}</strong><span>{Number(damage).toLocaleString()} damage</span></div>)}</div>}<ol>{scores.map((row, index) => <li key={row.who}><span>{index + 1}</span><strong>{shortName(row.who, me, state)}</strong><small>{row.team ? String(row.team).replace('team-', 'Team ') : String(row.character || 'fox')}</small><b>{Number(row.score || 0).toLocaleString()}</b></li>)}</ol></details>
    {finished && <p className="gp-result-note"><Trophy size={16} />{state.winningTeam ? `${String(state.winningTeam).replace('team-', 'Team ')} wins the raid.` : state.winner ? `${shortName(state.winner, me, state)} wins.` : 'Round complete.'} {state._practice ? 'Practice scores carry no token rewards.' : 'Verified placements and reward status appear in the room results.'}</p>}
  </section>
}
