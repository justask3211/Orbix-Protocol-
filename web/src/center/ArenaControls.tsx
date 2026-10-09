import { Suspense, lazy, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from 'react'
import { Box, Camera, ChevronUp, Clock3, Crosshair, Gem, Hand, Info, Shield, Swords, Trophy, Zap } from 'lucide-react'
import { CHARACTERS as ORIGINAL_CHARACTERS, type CharacterId } from './characters'
import type { StageProps } from './stages'
import './arenaPlay.css'

const GameWorld = lazy(() => import('./worlds/GameWorld'))
export type SentArenaInput = { dx: number; dz: number; sprint?: boolean; active: boolean; seq: number; at: number }
export type ArenaInput = { dx: number; dz: number; active: boolean; sprint?: boolean; yaw?: number; changedAt?: number; jumpAt?: number; history?: SentArenaInput[] }
export type ArenaInputRef = RefObject<ArenaInput>
export type ArenaCamera = { yaw: number; pitch: number; mode: 'third' | 'first' }
export type ArenaCameraRef = RefObject<ArenaCamera>
export type ArenaCharacter = CharacterId
const CHARACTERS = ORIGINAL_CHARACTERS.map(character => ({...character}))
export function CharacterPicker({ selected = 'blob', onChoose, disabled = false }: { selected?: string; onChoose: (character: ArenaCharacter) => void; disabled?: boolean }) {
  return <fieldset className="ar-characters" disabled={disabled}><legend>Choose your character</legend>{CHARACTERS.map(character => <button type="button" key={character.id} aria-pressed={selected === character.id} onClick={() => onChoose(character.id)} style={{ '--ar-character': character.color } as CSSProperties}><span aria-hidden>{character.face}</span><strong>{character.name}</strong><small>{selected === character.id ? 'Selected' : 'Choose'}</small></button>)}</fieldset>
}
const textInput = (target: EventTarget | null) => target instanceof HTMLElement && Boolean(target.closest('input,textarea,select,[contenteditable="true"]'))
const MOVE_KEYS: Record<string, [number, number]> = { w: [0, 1], arrowup: [0, 1], s: [0, -1], arrowdown: [0, -1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] }
const shortName = (wallet: string, me: string, state: StageProps['state']) => wallet === me ? 'You' : state._hidePlayers ? 'Player' : String(state._playerNames?.[wallet] || (wallet.length > 16 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet))
const arenaError = (code: string) => ({ COOLDOWN: 'That ability is recharging.', INPUT_RATE_LIMIT: 'Synchronizing your movement…', NO_PUSH_POWER: 'Collect a push power first.', NO_POWERUP: 'Collect a push power first.', NO_CRATE_IN_REACH: 'Move closer to a crate.', OUT_OF_RANGE: 'Move closer to the target or loot.', STUNNED: 'Recovering from a hit…', NOT_ALIVE: 'Your character will respawn shortly.', LOOT_GONE: 'Another player collected that item.', LOOT_ALREADY_TAKEN: 'Another player collected that item.', LOOT_OUT_OF_REACH: 'Move closer to that loot pile.', RESPAWNING: 'Your character will respawn shortly.', AIRDROP_NOT_LANDED: 'Wait for the supply drop to land.', INVALID_CHARACTER: 'Choose an available character.' } as Record<string, string>)[code] ?? `Action unavailable: ${code}`

/** Sends bounded movement intents; the server owns positions, collisions, loot and rewards. */
export function ArenaPlay(props: StageProps) {
  const { state, act, me, finished } = props
  const game = state.arenaKind === 'boss-raid' ? 'boss-raid' : state.arenaKind === 'combat-duel' ? 'combat-duel' : 'token-catch'
  const title = game === 'boss-raid' ? 'Boss Raid' : game === 'combat-duel' ? 'Arena Duel' : 'Token Catch'
  const body = state.bodies?.[me]
  const enabled = !finished && !state.finished && state._canAct !== false && Boolean(body)
  const input = useRef<ArenaInput>({ dx: 0, dz: 0, active: false, sprint: false, yaw: Math.PI })
  const camera = useRef<ArenaCamera>({ yaw: Math.PI, pitch: .04, mode: 'third' })
  const panel = useRef<HTMLElement>(null)
  const scene = useRef<HTMLDivElement>(null)
  const held = useRef(new Set<string>())
  const stick = useRef({ x: 0, y: 0, pointer: -1 })
  const look = useRef({ pointer: -1, x: 0, y: 0, moved: 0 })
  const seq = useRef(Number(body?.inputSeq) || 0)
  const actRef = useRef(act)
  const enabledRef = useRef(enabled)
  const stateRef = useRef(state)
  const blockHeld = useRef(false)
  const sprintHeld = useRef(false)
  const fireHeld = useRef(false)
  const lastSend = useRef(0)
  const lastAction = useRef(0)
  const pendingMove = useRef<number | null>(null)
  const [stickView, setStickView] = useState({ x: 0, y: 0 })
  const [cameraMode, setCameraMode] = useState<'third' | 'first'>('third')
  const [showCharacters, setShowCharacters] = useState(false)
  const [help, setHelp] = useState(false)
  const [now, setNow] = useState(Date.now())
  actRef.current = act; enabledRef.current = enabled; stateRef.current = state
  seq.current = Math.max(seq.current, Number(body?.inputSeq) || 0)
  const receivedTime = useRef({ server: Number(state.serverTimeMs) || Date.now(), client: Date.now() })
  useEffect(() => { receivedTime.current = { server: Number(state.serverTimeMs) || Date.now(), client: Date.now() } }, [state.serverTimeMs])
  const serverNow = receivedTime.current.server + now - receivedTime.current.client
  const remainingMs = Math.max(0, (Number(state.durationSeconds ?? state.duration) || 0) * 1000 - (Number(state.nowMs) || 0) - (finished ? 0 : now - receivedTime.current.client))
  const stunned = Number(body?.stunnedUntil) > serverNow
  const respawnAt = Math.max(Number(body?.respawnAt) || 0, Number(body?.downedUntil) || 0)
  const respawning = respawnAt > serverNow
  const attackCooling = Math.max(0, Number(body?.attackReadyAt || 0) - serverNow)
  const health = Math.max(0, Number(body?.hp) || 0)
  const maximum = Math.max(1, Number(body?.maxHp) || 100)

  const refreshInput = () => {
    let side = stick.current.x, forward = -stick.current.y
    for (const key of held.current) { const direction = MOVE_KEYS[key]; if (direction) { side += direction[0]; forward += direction[1] } }
    const length = Math.max(1, Math.hypot(side, forward))
    side /= length; forward /= length
    const yaw = camera.current.yaw
    const previous = input.current
    input.current = { ...previous, dx: Math.sin(yaw) * forward - Math.cos(yaw) * side, dz: Math.cos(yaw) * forward + Math.sin(yaw) * side, active: enabledRef.current && !document.hidden, sprint: sprintHeld.current || held.current.has('shift'), yaw }
    if (previous.dx !== input.current.dx || previous.dz !== input.current.dz || previous.sprint !== input.current.sprint || previous.active !== input.current.active) input.current.changedAt = performance.now()
  }
  const sendMovement = () => {
    if (!enabledRef.current || document.hidden) return
    refreshInput()
    // Coalesce rapid key transitions without losing a stop/release behind the server rate limit.
    if (Date.now() - lastSend.current < 40) {
      if (pendingMove.current === null) pendingMove.current = window.setTimeout(() => { pendingMove.current = null; sendMovement() }, 40 - (Date.now() - lastSend.current))
      return
    }
    lastSend.current = Date.now()
    const sequence = ++seq.current
    input.current.history = [...(input.current.history ?? []).filter(command => performance.now() - command.at <= 2000), { dx: input.current.dx, dz: input.current.dz, sprint: input.current.sprint, active: input.current.active, seq: sequence, at: performance.now() }].slice(-64)
    actRef.current({ kind: 'move', dx: input.current.dx, dz: input.current.dz, yaw: camera.current.yaw, aimPitch: -camera.current.pitch, sprint: Boolean(input.current.sprint), seq: sequence })
  }
  const action = (kind: string, extra: Record<string, unknown> = {}) => {
    if (!enabledRef.current || document.hidden || Date.now() - lastAction.current < 90) return
    lastAction.current = Date.now()
    if (kind === 'attack' || kind === 'punch' || kind === 'push') sendMovement()
    if (Number(stateRef.current.worldVersion) < 3) {
      if (kind === 'jump' || kind === 'dodge') return
      if (kind === 'punch') kind = 'attack'
    }
    if (kind === 'jump') input.current.jumpAt = performance.now()
    actRef.current({ kind, yaw: camera.current.yaw, aimPitch: -camera.current.pitch, ...extra })
  }
  const releaseAll = () => {
    const moving = Boolean(input.current.dx || input.current.dz || input.current.sprint)
    held.current.clear(); stick.current = { x: 0, y: 0, pointer: -1 }; sprintHeld.current = false; fireHeld.current = false
    input.current = { ...input.current, dx: 0, dz: 0, active: false, sprint: false, yaw: camera.current.yaw, changedAt: performance.now() }
    setStickView({ x: 0, y: 0 })
    if (pendingMove.current !== null) { clearTimeout(pendingMove.current); pendingMove.current = null }
    if (enabledRef.current && moving) actRef.current({ kind: 'move', dx: 0, dz: 0, sprint: false, yaw: camera.current.yaw, seq: ++seq.current })
    if (blockHeld.current && enabledRef.current) actRef.current({ kind: 'block', active: false })
    blockHeld.current = false; look.current.pointer = -1
  }
  const nearLoot = (): { drops: Record<string, any>[]; airdrops: Record<string, any>[] } => {
    const current = stateRef.current, mine = current.bodies?.[me]
    const elapsed = Number(current.nowMs) || 0
    if (!mine) return { drops: [] as Record<string, any>[], airdrops: [] as Record<string, any>[] }
    const near = (item: Record<string, any>) => Number(item.landAt ?? 0) <= elapsed && Math.hypot(Number(item.x) - Number(mine.x), Number(item.z) - Number(mine.z)) <= 3
    return { drops: (current.drops ?? []).filter((item: Record<string, any>) => near(item) && !item.collected && (item.expiresAt == null || Number(item.expiresAt) > elapsed)), airdrops: (current.airdrops ?? []).filter((item: Record<string, any>) => near(item) && !item.opened) }
  }
  const interact = () => {
    if (Number(stateRef.current.worldVersion) < 3) { action('interact'); return }
    const nearby = nearLoot()
    if (nearby.airdrops[0]) action('open_airdrop', { dropId: nearby.airdrops[0].id })
    else if (nearby.drops[0]) action('loot', { dropId: nearby.drops[0].id })
    else action('interact')
  }
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) setNow(Date.now())
      const current = stateRef.current.bodies?.[me]
      const serverTime = receivedTime.current.server + Date.now() - receivedTime.current.client
      if (!enabledRef.current || document.hidden || Number(current?.respawnAt) > serverTime || Number(current?.downedUntil) > serverTime || Number(current?.stunnedUntil) > serverTime) { input.current.active = false; return }
      refreshInput()
      if (input.current.dx || input.current.dz || input.current.sprint) sendMovement()
      if (fireHeld.current && Number(current?.attackReadyAt || 0) <= serverTime && Date.now() - lastAction.current >= 150) action('attack')
    }, 75)
    const down = (event: KeyboardEvent) => {
      if (!enabledRef.current || textInput(event.target) || (!panel.current?.contains(document.activeElement) && document.activeElement !== document.body)) return
      const key = event.key.toLowerCase()
      if (MOVE_KEYS[key] || key === 'shift') { event.preventDefault(); if (!held.current.has(key)) { held.current.add(key); sendMovement() } }
      else if ([' ', 'q', 'e', 'r', 'f', 'j', 'k', 'l', 't'].includes(key)) {
        if (event.target instanceof HTMLElement && event.target.closest('button,summary,a,[role="button"]') && (key === ' ' || key === 'Enter')) return
        event.preventDefault()
        if (!event.repeat) {
          if (key === 'e') interact()
          else if (key === 'f') { blockHeld.current = true; actRef.current({ kind: 'block', active: true }) }
          else if (key === 'j' || key === 'k' || key === 'l') action('attack', { style: key === 'k' ? 'heavy' : key === 'l' ? 'kick' : 'light' })
          else if (key === 't') action('push')
          else action(key === ' ' ? 'jump' : key === 'q' ? 'punch' : 'dodge')
        }
      }
    }
    const up = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (held.current.delete(key)) sendMovement()
      if (key === 'f' && blockHeld.current) { blockHeld.current = false; if (enabledRef.current) actRef.current({ kind: 'block', active: false }) }
    }
    const visibility = () => { if (document.hidden) releaseAll() }
    const releaseFire = () => { fireHeld.current = false }
    const lockMove = (event: MouseEvent) => { if (document.pointerLockElement !== scene.current) return; rotateCamera(event.movementX, event.movementY) }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', releaseAll); window.addEventListener('pointerup', releaseFire); window.addEventListener('pointercancel', releaseFire); document.addEventListener('visibilitychange', visibility); document.addEventListener('mousemove', lockMove)
    return () => { window.clearInterval(timer); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', releaseAll); window.removeEventListener('pointerup', releaseFire); window.removeEventListener('pointercancel', releaseFire); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('mousemove', lockMove); releaseAll(); if (document.pointerLockElement === scene.current) document.exitPointerLock() }
  }, [me])
  useEffect(() => { if (!enabled) releaseAll() }, [enabled])
  const rotateCamera = (x: number, y: number) => {
    camera.current.yaw = Math.atan2(Math.sin(camera.current.yaw - x * .005), Math.cos(camera.current.yaw - x * .005))
    // Keep yaw bounded for the validated movement protocol, including long mouse-look sessions.
    camera.current.yaw = Math.atan2(Math.sin(camera.current.yaw), Math.cos(camera.current.yaw))
    camera.current.pitch = Math.max(-.55, Math.min(.85, camera.current.pitch + y * .004))
    refreshInput()
    sendMovement()
  }
  const startLook = (event: PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button,summary,input,select,textarea,a,[role="button"],.ar-joystick,.ar-loot-panel')) return
    panel.current?.focus({ preventScroll: true })
    if (document.pointerLockElement === scene.current) { if (event.button === 0) { fireHeld.current = true; action('attack') } return }
    if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 2) return
    event.currentTarget.setPointerCapture(event.pointerId)
    look.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: 0 }
  }
  const moveLook = (event: PointerEvent<HTMLElement>) => {
    if (look.current.pointer !== event.pointerId || document.pointerLockElement === scene.current) return
    const x = event.clientX - look.current.x, y = event.clientY - look.current.y
    look.current = { ...look.current, x: event.clientX, y: event.clientY, moved: look.current.moved + Math.abs(x) + Math.abs(y) }
    rotateCamera(x, y)
  }
  const stopLook = (event: PointerEvent<HTMLElement>, cancel = false) => {
    if (look.current.pointer !== event.pointerId) return
    if (!cancel && event.pointerType === 'mouse' && event.button === 0 && look.current.moved < 5) action('attack')
    look.current.pointer = -1
  }
  const updateStick = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect(), radius = bounds.width * .34
    let x = (event.clientX - bounds.left - bounds.width / 2) / radius, y = (event.clientY - bounds.top - bounds.height / 2) / radius
    const length = Math.max(1, Math.hypot(x, y)); x /= length; y /= length
    stick.current = { x, y, pointer: event.pointerId }; setStickView({ x: x * radius, y: y * radius }); sendMovement()
  }
  const stopStick = (event: PointerEvent<HTMLDivElement>) => {
    if (stick.current.pointer !== event.pointerId) return
    stick.current = { x: 0, y: 0, pointer: -1 }; setStickView({ x: 0, y: 0 }); sendMovement()
  }
  const nearby = nearLoot()
  const players: string[] = Array.isArray(state.players) ? state.players : props.players
  const scores: { who: string; score: number; team?: string; character?: string }[] = Object.entries(state.bodies ?? {}).map(([who, value]) => ({ who, ...(value as Record<string, any>), score: Number(state.scores?.[who] ?? (value as Record<string, any>).score) || 0 })).sort((a, b) => b.score - a.score)
  const teamScores = Object.entries(state.teamDamage ?? {}).sort((a, b) => Number(b[1]) - Number(a[1]))
  const teamPlacements: { team: string; rank: number; damage: number; eligible?: boolean; rewardShare?: number }[] = Array.isArray(state.teamRankings) ? state.teamRankings : teamScores.map(([team, damage], index) => ({ team, damage: Number(damage), rank: index + 1 }))
  const disabled = !enabled || respawning || stunned
  const weapon = String(body?.weapon || 'hands')
  const guard = (active: boolean) => { if (active === blockHeld.current) return; blockHeld.current = active; if (enabledRef.current) actRef.current({ kind: 'block', active }) }
  const startFire = (event: PointerEvent<HTMLButtonElement>) => { if (disabled) return; event.currentTarget.setPointerCapture(event.pointerId); fireHeld.current = true; panel.current?.focus({ preventScroll: true }); action('attack') }
  const stopFire = () => { fireHeld.current = false }

  return <section className={`gp gp-${game} gp-arena`} ref={panel} tabIndex={0} aria-label={`${title} playable 3D world. WASD moves, drag looks, Space jumps.`} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) releaseAll() }}>
    <header className="gp-heading"><div className="gp-title-icon" aria-hidden>{game === 'token-catch' ? <Gem /> : <Swords />}</div><div><span className="gp-eyebrow">{game === 'token-catch' ? 'Airdrop island · run, loot, survive' : game === 'boss-raid' ? 'Guardian outpost · squad raid' : 'Twinlight arena · move, dodge, combo'}</span><h3>{title}</h3></div><div className="gp-heading-actions"><span className="gp-clock"><Clock3 size={16} />{finished ? 'Finished' : `${Math.ceil(remainingMs / 1000)}s`}</span><button type="button" className="gp-help-toggle" aria-label="Show game controls and rules" aria-expanded={help} onClick={() => setHelp(!help)}><Info size={16} /> Controls</button></div></header>
    {help && <div className="gp-rule-help"><p><strong>WASD / arrows</strong> move relative to your view. <strong>Drag the world</strong> to look · <strong>Space</strong> jump · <strong>Shift</strong> sprint · <strong>click / Fire</strong> attack · <strong>Q</strong> punch · <strong>E</strong> loot · <strong>R</strong> dodge · <strong>J / K / L</strong> light / heavy / kick · hold <strong>F</strong> guard. On mobile, use the left joystick and swipe the right side to look.</p><p>{game === 'token-catch' ? 'Run to landed airdrops, open the supply crate, then select individual loot piles. Other players compete for the same loot. Bomb loot scatters half your collected coins. Guns knock rivals down temporarily; punches interrupt nearby rivals.' : game === 'boss-raid' ? 'Your squad starts with equal guns. Dodge the guardian’s telegraphed attacks and collect upgrades as its health falls. Knocked players respawn. Team damage determines placement; the creator’s reward settings determine eligible teams.' : 'Move and face your rival, jump or dodge attacks, and chain strikes when in range. Pick up weapons and hold guard to reduce incoming damage. Only server-confirmed hits count.'}</p><p>Coins and damage are game score. Confirmed room results and settlement determine wallet rewards.</p></div>}
    <div className="gp-scene ar-scene" ref={scene} onPointerDown={startLook} onPointerMove={moveLook} onPointerUp={event => stopLook(event)} onPointerCancel={event => stopLook(event, true)} onLostPointerCapture={event => stopLook(event, true)} onContextMenu={event => event.preventDefault()}>
      <Suspense fallback={<div className="ar-loading" role="status"><span className="ar-loading-orb" /><strong>Preparing {title}…</strong><p>Building the compact world and loading character controls.</p></div>}><GameWorld game={game} state={state} me={me} players={players} inputRef={input} cameraRef={camera} /></Suspense>
      <div className="ar-hud"><span><Gem size={15} />{Number(state.scores?.[me] ?? body?.score ?? 0).toLocaleString()} <small>{game === 'token-catch' ? 'coins' : 'damage'}</small></span><span><Swords size={15} />{weapon}{Number(body?.weaponLevel) > 1 ? ` Lv ${body.weaponLevel}` : ''}{weapon === 'gun' && <small>{Number(body?.weaponUses) === -1 ? '∞' : `${body?.weaponUses ?? 0} shots`}</small>}</span>{body?.team && <span>{String(body.team).replace('team-', 'Team ')}</span>}</div>
      {body && <div className="ar-vitals"><div role="progressbar" aria-label="Your health" aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={health}><i style={{ width: `${health / maximum * 100}%` }} /></div><span>{respawning ? `Respawn in ${Math.ceil((respawnAt - serverNow) / 1000)}s` : stunned ? 'Dazed · recovering' : `${Math.ceil(health)} / ${maximum} HP`}</span></div>}
      <div className="ar-crosshair" aria-hidden="true"><Crosshair size={25} /></div>
      <div className="ar-view-options"><button type="button" aria-label={`Switch to ${cameraMode === 'third' ? 'first' : 'third'} person camera`} onClick={() => { const mode = camera.current.mode === 'third' ? 'first' : 'third'; camera.current.mode = mode; setCameraMode(mode) }}><Camera size={15} />{cameraMode === 'third' ? 'TPV' : 'FPV'}</button><button type="button" className="ar-mouse-lock" onClick={() => { panel.current?.focus({ preventScroll: true }); try { const result = scene.current?.requestPointerLock(); if (result && typeof result.catch === 'function') void result.catch(() => {}) } catch { /* Drag look remains available. */ } }}>Mouse look</button></div>
      <div className="ar-look-zone" aria-label="Swipe here to look around" onPointerDown={startLook} onPointerMove={moveLook} onPointerUp={event => stopLook(event)} onPointerCancel={event => stopLook(event, true)}><span>Swipe to look</span></div>
      <div className="ar-joystick" role="group" aria-label="Touch movement joystick" aria-disabled={disabled} onPointerDown={event => { if (disabled) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); panel.current?.focus({ preventScroll: true }); updateStick(event) }} onPointerMove={event => { if (stick.current.pointer === event.pointerId) { event.stopPropagation(); updateStick(event) } }} onPointerUp={stopStick} onPointerCancel={stopStick} onLostPointerCapture={stopStick}><span className="ar-stick-ring" /><i style={{ transform: `translate(${stickView.x}px,${stickView.y}px)` }} /><small>MOVE</small></div>
      <div className="ar-touch-actions"><button type="button" className="ar-touch-fire" disabled={disabled || (attackCooling > 0 && !fireHeld.current)} onPointerDown={startFire} onPointerUp={stopFire} onPointerCancel={stopFire} onLostPointerCapture={stopFire} onClick={event => { if (event.detail === 0) action('attack') }} aria-label="Fire or attack"><Crosshair />{weapon === 'gun' ? 'Fire' : 'Strike'}</button><button type="button" disabled={disabled} onClick={() => action('jump')}><ChevronUp />Jump</button><button type="button" disabled={disabled} onClick={() => action('punch')}><Hand />Punch</button><button type="button" disabled={disabled || Number(state.worldVersion) < 3} onClick={() => action('dodge')}><Zap />Dodge</button><button type="button" disabled={disabled} onClick={interact}><Box />Loot</button></div>
      {state._canAct === false && <div className="ar-watch">{state._connection && state._connection !== 'open' ? 'Reconnecting · synchronizing world' : 'Watching the arena'}</div>}
      {(nearby.airdrops.length > 0 || nearby.drops.length > 0) && enabled && <aside className="ar-loot-panel" aria-label="Nearby loot"><strong><Box size={15} /> Nearby supplies <small>Shared loot</small></strong>{nearby.airdrops.slice(0, 2).map(item => <button key={item.id} type="button" className="ar-open-drop" disabled={disabled} onClick={() => action('open_airdrop', { dropId: item.id })}><Box size={18} /><span>Open airdrop<small>Choose individual piles after opening</small></span></button>)}<div>{nearby.drops.slice(0, 16).map(item => <button key={item.id} type="button" disabled={disabled} className={item.kind === 'bomb' ? 'ar-loot-bomb' : ''} onClick={() => action('loot', { dropId: item.id })}><span aria-hidden>{item.kind === 'coin' ? '🪙' : item.kind === 'bomb' ? '💣' : item.kind === 'gun' ? '🔫' : item.kind === 'heal' ? '💚' : '⚡'}</span><b>{item.kind === 'coin' ? `${item.value ?? 5} coins` : String(item.kind).replaceAll('_', ' ')}</b>{item.kind === 'bomb' && <small>Spills half your coins</small>}</button>)}</div></aside>}
    </div>
    {game === 'token-catch' && <div className="ar-pickup-guide"><Box size={13} /><span>Airdrops land during the round. Open nearby crates and select each loot pile.</span>{state.lootBudget != null && <strong>{Number(state.droppedValue ?? 0).toLocaleString()} / {Number(state.lootBudget).toLocaleString()} score dropped</strong>}</div>}
    {state.boss && <div className="gp-boss-health"><div className="gp-boss-health-heading"><strong>Crystal guardian · phase {state.boss.phase || 1}</strong><span>{Math.max(0, Number(state.boss.hp)).toLocaleString()} / {Number(state.boss.maxHp).toLocaleString()} HP</span></div><div className="gp-health-track"><span style={{ width: `${Math.max(0, Number(state.boss.hp)) / Math.max(1, Number(state.boss.maxHp)) * 100}%` }} /></div></div>}
    <div className="ar-controls"><div className="ar-desktop-hint"><kbd>W A S D</kbd><span>Move · drag to look</span></div><div className="ar-action-grid"><button type="button" className="gp-action ar-strike" disabled={disabled || (attackCooling > 0 && !fireHeld.current)} onPointerDown={startFire} onPointerUp={stopFire} onPointerCancel={stopFire} onLostPointerCapture={stopFire} onClick={event => { if (event.detail === 0) action('attack') }}><Swords />{attackCooling > 0 ? `${(attackCooling / 1000).toFixed(1)}s` : weapon === 'gun' ? 'Fire' : 'Strike'}<kbd>Hold click</kbd></button>{game === 'combat-duel' && <><button type="button" className="ar-action" disabled={disabled || attackCooling > 0} onClick={() => action('attack', { style: 'heavy' })}><Swords />Heavy strike<kbd>K</kbd></button><button type="button" className="ar-action" disabled={disabled || attackCooling > 0} onClick={() => action('attack', { style: 'kick' })}><Hand />Kick<kbd>L</kbd></button></>}<button type="button" className="ar-action" disabled={disabled || Number(state.worldVersion) < 3} onClick={() => action('jump')}><ChevronUp />Jump<kbd>Space</kbd></button><button type="button" className="ar-action" disabled={disabled} onClick={() => action('punch')}><Hand />Punch<kbd>Q</kbd></button>{Number(body?.pushCharges) > 0 && <button type="button" className="ar-action" disabled={disabled} onClick={() => action('push')}><Zap />Push · {body.pushCharges}<kbd>T</kbd></button>}<button type="button" className="ar-action" disabled={disabled} onClick={interact}><Box />Loot / break<kbd>E</kbd></button><button type="button" className="ar-action ar-dodge" disabled={disabled || Number(state.worldVersion) < 3} onClick={() => action('dodge')}><Zap />Dodge<kbd>R</kbd></button><button type="button" className="ar-action" disabled={disabled} aria-pressed={Boolean(body?.blocking)} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); guard(true) }} onPointerUp={() => guard(false)} onPointerCancel={() => guard(false)} onLostPointerCapture={() => guard(false)} onKeyDown={event => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); guard(true) } }} onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') guard(false) }}><Shield />Guard<kbd>Hold F</kbd></button></div><button type="button" className="ar-character-toggle" onClick={() => setShowCharacters(!showCharacters)} aria-expanded={showCharacters}><span aria-hidden>{CHARACTERS.find(character => character.id === body?.character)?.face || '🧑‍🚀'}</span>Character</button><button type="button" className="ar-sprint-toggle" aria-pressed={sprintHeld.current} disabled={disabled} onClick={() => { sprintHeld.current = !sprintHeld.current; sendMovement(); setNow(Date.now()) }}><Zap size={15} />{sprintHeld.current ? 'Sprint on' : 'Sprint'}<kbd>Shift</kbd></button></div>
    {showCharacters && <CharacterPicker selected={body?.character} disabled={!enabled} onChoose={character => action('equip', { character })} />}
    {state._actionError && !['INPUT_RATE_LIMIT', 'NO_CHANGE'].includes(String(state._actionError)) && <p className="gp-status gp-status-error" role="alert">{arenaError(String(state._actionError))}</p>}
    <details className="ar-leaderboard"><summary><Trophy size={17} />{game === 'boss-raid' ? 'Squad placements & players' : 'Live standings'}<span>{players.length} players</span></summary>{game === 'boss-raid' && <div className="ar-team-standings">{teamPlacements.map(row => <div key={row.team}><strong>{row.rank <= 3 ? ['🥇', '🥈', '🥉'][row.rank - 1] : `#${row.rank}`} {row.team.replace('team-', 'Team ')}</strong><span>{Number(row.damage).toLocaleString()} damage{row.rewardShare != null && row.rewardShare > 0 ? ` · ${Number(row.rewardShare)}% reward share` : ''}</span></div>)}</div>}<ol>{scores.map((row, index) => <li key={row.who}><span>{index + 1}</span><strong>{shortName(row.who, me, state)}</strong><small>{row.team ? String(row.team).replace('team-', 'Team ') : String(row.character || 'fox')}</small><b>{row.score.toLocaleString()}</b></li>)}</ol></details>
    {finished && <p className="gp-result-note"><Trophy size={16} />{state.winningTeam ? `${String(state.winningTeam).replace('team-', 'Team ')} leads the raid.` : state.winner ? `${shortName(state.winner, me, state)} wins.` : 'Round complete.'} {state._practice ? 'Practice carries no token rewards.' : 'Confirmed placements and reward status appear in room results.'}</p>}
  </section>
}
