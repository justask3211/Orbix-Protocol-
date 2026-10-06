import { Component, Suspense, lazy, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, CircleHelp, Clock3, Flag, Gem, LockKeyhole, Shield, Sparkles, Swords, Target, Trophy, X, Zap } from 'lucide-react'
import type { StageProps } from './stages'
import { useModalFocus } from './useModalFocus'
import './gamePlay.css'

const GameWorld = lazy(() => import('./worlds/GameWorld'))
type GameId = 'number-hunt' | 'token-catch' | 'reaction-duel' | 'boss-raid'
const short = (wallet: string) => wallet.length > 14 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet
const name = (wallet: string, me: string, state: StageProps['state']) => wallet === me ? 'You' : state._hidePlayers ? 'Player' : String(state._playerNames?.[wallet] || short(wallet)).slice(0, 60)
const allowed = (state: StageProps['state'], finished: boolean) => !finished && !state.finished && state._canAct !== false
const numeric = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback

/** Unbiased local suggestion. It never accesses targets or sends a game action. */
function randomSuggestion(min: number, max: number) {
  const span = max - min + 1
  if (!Number.isSafeInteger(span) || span < 1 || span > 2 ** 32) return ''
  const limit = Math.floor(2 ** 32 / span) * span
  const sample = new Uint32Array(1)
  do { crypto.getRandomValues(sample) } while (sample[0] >= limit)
  return String(min + sample[0] % span)
}

function useMotionPreference() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const changed = () => setReduced(query.matches)
    query.addEventListener('change', changed)
    return () => query.removeEventListener('change', changed)
  }, [])
  return reduced
}

/** Countdown uses the published server deadline; it never starts a local match clock. */
function useServerClock(state: StageProps['state'], finished: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (finished) return
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [finished])
  const received = useRef({ server: numeric(state.serverTimeMs, Date.now()), local: Date.now() })
  useEffect(() => {
    if (typeof state.serverTimeMs === 'number') received.current = { server: state.serverTimeMs, local: Date.now() }
  }, [state.serverTimeMs])
  const serverNow = typeof state._serverOffsetMs === 'number' ? now + state._serverOffsetMs : typeof state.serverTimeMs === 'number' ? received.current.server + (now - received.current.local) : now
  const deadline = numeric(state.phaseDeadline || state.deadline || state.__deadline || (state.startedAt && state.durationSeconds ? state.startedAt + state.durationSeconds : 0))
  const deadlineMs = deadline > 1e12 ? deadline : deadline * 1000
  return { serverNow, seconds: deadline ? Math.max(0, Math.ceil((deadlineMs - serverNow) / 1000)) : null }
}

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <div className="gp-world-fallback"><Gem aria-hidden /><p>The 3D view is unavailable on this device.</p><span>All game controls remain available below.</span></div> : this.props.children
  }
}

function GameFrame({ game, title, eyebrow, icon, children, help, state, me, players, finished, onLane, onAttack, onCatch }: StageProps & {
  game: GameId; title: string; eyebrow: string; icon: ReactNode; children: ReactNode; help: ReactNode
  onLane?: (lane: number) => void; onAttack?: () => void; onCatch?: (spawnIndex: number) => void
}) {
  const reducedMotion = useMotionPreference()
  const clock = useServerClock(state, finished)
  const [helpOpen, setHelpOpen] = useState(false)
  const helpId = useId()
  return <section className={`gp gp-${game}`} aria-label={`${title} game`}>
    <header className="gp-heading">
      <div className="gp-title-icon" aria-hidden>{icon}</div>
      <div><span className="gp-eyebrow">{eyebrow}</span><h3>{title}</h3></div>
      <div className="gp-heading-actions">
        {clock.seconds !== null && <span className={`gp-clock${clock.seconds <= 10 ? ' urgent' : ''}`} aria-label={`${clock.seconds} seconds left`}><Clock3 size={16} aria-hidden />{finished ? 'Finished' : `${clock.seconds}s`}</span>}
        <button type="button" className="gp-help-toggle" onClick={() => setHelpOpen(!helpOpen)} aria-expanded={helpOpen} aria-controls={helpId}><CircleHelp size={18} aria-hidden /><span>How to play</span></button>
      </div>
    </header>
    {helpOpen && <div className="gp-rule-help" id={helpId}>{help}</div>}
    <div className="gp-scene" aria-label={`${title} world`}>
      <SceneBoundary key={game}><Suspense fallback={<div className="gp-world-fallback"><Sparkles aria-hidden /><p>Opening your game world…</p><span>You can use the controls while the scene loads.</span></div>}>
        <GameWorld game={game} state={state} me={me} players={state._hidePlayers ? (me ? [me] : []) : players} reducedMotion={reducedMotion} onLane={onLane} onAttack={onAttack} onCatch={onCatch} />
      </Suspense></SceneBoundary>
      <span className="gp-world-label"><span aria-hidden />{finished ? 'Round complete' : state._connection === 'reconnecting' || state._connection === 'connecting' ? 'Reconnecting…' : 'Live game world'}</span>
    </div>
    {state._canAct === false && !finished && <p className="gp-status" role="status">{state._spectating ? 'You are watching this round. Join as a player to take part.' : state._connection && state._connection !== 'open' ? 'Waiting for your connection. Controls resume after the room synchronizes.' : 'You are watching this round. Join as a player to take part.'}</p>}
    {children}
    {state._actionError && <p className="gp-status gp-status-error" role="alert">{actionError(String(state._actionError))}</p>}
    {finished && <p className="gp-result-note"><Flag size={16} aria-hidden />Round complete. The room results below show verified placements and reward status.</p>}
  </section>
}

function actionError(code: string) {
  const messages: Record<string, string> = {
    SLOW_DOWN: 'That action was too soon. Wait for the cooldown, then try again.',
    DUPLICATE_GUESS: 'You already tried that number. Try another guess.',
    BUDGET_EXHAUSTED: 'Your action budget has been used for this round.',
    ACTION_DUPLICATE: 'The server already received that action.',
    STALE_REVISION: 'That token has passed. Catch the next one.',
    BAD_PROOF: 'The server could not verify that move. Check your lane or reveal the original sealed choice.',
    ROUND_NOT_OPEN: 'That action is outside the current game phase.',
    ROUND_FINISHED: 'The round has finished.',
    NOT_ADMITTED: 'Join the round as a player before sending a move.',
  }
  return messages[code] ?? `The server declined this action (${code}).`
}

function Stat({ label, value, icon }: { label: string; value: ReactNode; icon?: ReactNode }) {
  return <div className="gp-stat"><span>{icon}{label}</span><strong>{value}</strong></div>
}

function HintDesk({ open, onClose, enabled, hint, visibility }: { open: boolean; onClose: () => void; enabled: boolean; hint: 'higher' | 'lower' | null; visibility: string }) {
  const dialog = useModalFocus(onClose, open)
  const titleId = useId()
  if (!open) return null
  return createPortal(<div className="gp gp-number-hunt gp-hint-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="gp-hint-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialog} tabIndex={-1}>
      <header><span className="gp-hint-dialog-icon" aria-hidden><CircleHelp size={24} /></span><h4 id={titleId}>Hint desk</h4><button type="button" className="gp-hint-close" aria-label="Close hint desk" onClick={onClose}><X size={19} aria-hidden /></button></header>
      <p>{enabled ? `This round gives higher / lower hints after an accepted miss. Hints are ${visibility === 'private' ? 'private to the guessing player' : 'shared with the room'}.` : 'Automatic hints are disabled for this round. Follow any message your host shares in the room feed.'}</p>
      {hint ? <div className="gp-hint" role="status">{hint === 'higher' ? <ArrowUp size={24} aria-hidden /> : <ArrowDown size={24} aria-hidden />}<div><strong>Your last hint: {hint}</strong><span>This direction comes from the server.</span></div></div> : enabled && <div className="gp-hint-dialog-empty"><Sparkles size={21} aria-hidden /><span>No hint has arrived yet. An accepted miss produces your next clue.</span></div>}
      {enabled && <p>Use the direction to narrow your next guess. In a multi-target round, each hint points toward the nearest target; that target can change between guesses.</p>}
      <button type="button" className="gp-action" onClick={onClose}>Back to the hunt</button>
    </div>
  </div>, document.body)
}

function Scoreboard({ title, scores, me, state, unit = 'points' }: { title: string; scores: Record<string, number>; me: string; state: StageProps['state']; unit?: string }) {
  const rows = Object.entries(scores).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return <section className="gp-board" aria-label={title}><h4><Trophy size={17} aria-hidden />{title}</h4>
    {rows.length ? <ol>{rows.map(([who, score], index) => <li key={who} className={who === me ? 'is-me' : ''}><span className="gp-rank">{index + 1}</span><span>{name(who, me, state)}{state.teamMode === 'teams' && state.teams?.[who] && <small className={`gp-team-label team-${state.teams[who]}`}>Team {String(state.teams[who]).toUpperCase()}</small>}</span><strong>{score.toLocaleString()}<small>{unit}</small></strong></li>)}</ol> : <p className="gp-muted">The first verified action starts the scoreboard.</p>}
  </section>
}

export function NumberHuntPlay(props: StageProps) {
  const { state, act, me, finished } = props
  const digits = numeric(state.digits, 6)
  const remaining = numeric(state.remaining?.[me], numeric(state.guessBudget))
  const [guess, setGuess] = useState('')
  const [hintOpen, setHintOpen] = useState(false)
  const [submitted, setSubmitted] = useState<{ number: number; at: number; count: number } | null>(null)
  useServerClock(state, finished)
  const guessCount = numeric(state.guessCount?.[me])
  const log: { who: string; number: number; hit?: boolean; hint?: { direction: string } }[] = Array.isArray(state.guessLog) ? state.guessLog : []
  const mine = log.filter((row) => row.who === me)
  const latestMine = mine.at(-1)
  const cooldownMs = numeric(state.guessCooldownMs, 500)
  const pending = Boolean(submitted && guessCount <= submitted.count && Date.now() - submitted.at < 1600 && !state._actionError)
  const cooling = Boolean(submitted && Date.now() < submitted.at + cooldownMs)
  const valid = guess.length === digits && Number(guess) >= numeric(state.min) && Number(guess) <= numeric(state.max)
  const duplicate = mine.some((row) => row.number === Number(guess))
  const playable = allowed(state, finished) && remaining > 0 && !pending && !cooling
  const inputId = useId()
  const privateHint = state.hint ?? state.privateHint
  const hintValue = state.hints === 'on' ? (state.hintVisibility === 'public' ? latestMine?.hint?.direction : typeof privateHint === 'string' ? privateHint : privateHint?.direction) : null
  const hint = hintValue === 'higher' || hintValue === 'lower' ? hintValue : null
  const submit = () => {
    if (!playable || !valid || duplicate) return
    const number = Number(guess)
    setSubmitted({ number, at: Date.now(), count: guessCount })
    act({ kind: 'guess', number })
  }
  useEffect(() => { setGuess(''); setSubmitted(null) }, [state.roundId, state._roundId])
  useEffect(() => {
    if (submitted && guessCount > submitted.count) setGuess((current) => current === String(submitted.number) ? '' : current)
  }, [guessCount, submitted])
  return <GameFrame {...props} game="number-hunt" title="Number Hunt" eyebrow="The floating number islands" icon={<Target />} help={<><p>Find a hidden {digits}-digit target between <strong>{state.min} and {state.max}</strong>. Each accepted guess uses one attempt. A repeated guess costs no extra attempt.</p><p>{state.hints === 'on' ? `Higher / lower hints are ${state.hintVisibility === 'private' ? 'visible only to the guessing player' : 'shared with the room'}. A hint points toward the nearest target.` : 'Hints are disabled for this round.'} Targets stay hidden until the server ends the round.</p></>}>
    <div className="gp-stats"><Stat label="Your guesses left" value={remaining} icon={<Zap size={14} />} /><Stat label="Targets found" value={`${numeric(state.claimedTargets)} / ${numeric(state.targetCount, 1)}`} icon={<Gem size={14} />} /><Stat label="Search range" value={`${state.min}–${state.max}`} /></div>
    <div className="gp-play-columns"><div className="gp-control-panel">
      <h4>Trust your instinct. Find the number.</h4>
      <form onSubmit={(event) => { event.preventDefault(); submit() }}>
        <label htmlFor={inputId} className="gp-field-label">Your {digits}-digit guess</label>
        <div className="gp-number-entry"><div className="gp-digit-pad"><input id={inputId} className="gp-number-input" type="text" inputMode="numeric" autoComplete="off" maxLength={digits} value={guess} onChange={(event) => setGuess(event.target.value.replace(/\D/g, '').slice(0, digits))} disabled={!allowed(state, finished) || remaining <= 0} aria-describedby={`${inputId}-help`} /><div className="gp-number-slots" style={{ gridTemplateColumns: `repeat(${digits}, minmax(0, 1fr))` }} aria-hidden>{Array.from({ length: digits }, (_, index) => <span key={index} className={`${guess[index] ? 'filled' : ''}${index === Math.min(guess.length, digits - 1) ? ' current' : ''}`}>{guess[index] || '·'}</span>)}</div></div><button className="gp-action" type="submit" disabled={!playable || !valid || duplicate}><Target size={18} aria-hidden />{finished ? 'Round complete' : remaining <= 0 ? 'No guesses left' : pending ? 'Checking…' : cooling ? 'Recharging…' : 'Send guess'}</button><button className="gp-suggest" type="button" onClick={() => setGuess(randomSuggestion(numeric(state.min), numeric(state.max)))} disabled={!playable}><Sparkles size={15} aria-hidden />Randomize</button></div>
        <p id={`${inputId}-help`} className="gp-muted">{duplicate ? 'You already tried this number.' : guess.length === digits && !valid ? `Enter a number from ${state.min} to ${state.max}.` : 'Type or paste a number, then press Enter. Randomize fills a local suggestion without submitting.'}</p>
      </form>
      {submitted && <p className="gp-status" role="status">{guessCount > submitted.count ? `The server recorded ${submitted.number}.` : pending ? `Sent ${submitted.number}. Waiting for the server…` : `Last sent: ${submitted.number}. Check the live log for confirmation.`}</p>}
      {hint && <div className="gp-hint" role="status">{hint === 'higher' ? <ArrowUp size={22} aria-hidden /> : <ArrowDown size={22} aria-hidden />}<div><strong>Try {String(hint) === 'higher' ? 'higher' : 'lower'}</strong><span>Confirmed {state.hintVisibility === 'private' ? 'private ' : ''}hint from your latest guess.</span></div></div>}
      <button type="button" className="gp-hint-toggle" onClick={() => setHintOpen(true)} aria-haspopup="dialog"><CircleHelp size={16} aria-hidden />Open hint desk</button>
      <HintDesk open={hintOpen} onClose={() => setHintOpen(false)} enabled={state.hints === 'on'} hint={hint} visibility={String(state.hintVisibility ?? 'public')} />
      {finished && Array.isArray(state.targets) && <div className="gp-revealed"><Check size={17} aria-hidden /><span>Revealed targets: <strong>{state.targets.join(', ')}</strong></span></div>}
    </div><section className="gp-live-log" aria-label="Live guess log"><h4><Sparkles size={17} aria-hidden />Live guesses<span className="gp-live-dot" aria-label="Live" /></h4>
      {state._hideGuesses ? <p className="gp-muted">The host has hidden the guess feed.</p> : log.length ? <ol>{log.slice(-40).reverse().map((row, index) => <li key={`${log.length - index}-${row.who}-${row.number}`} className={row.hit ? 'is-hit' : ''}><span>{name(row.who, me, state)}</span><strong>{row.number}</strong>{row.hit ? <small><Gem size={13} aria-hidden />Target found</small> : state.hintVisibility === 'public' && row.hint ? <small>{row.hint.direction === 'higher' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}{row.hint.direction}</small> : <small>Checked</small>}</li>)}</ol> : <p className="gp-log-empty">The islands are quiet. Your first guess starts the hunt.</p>}
    </section></div>
  </GameFrame>
}

type CatchSpawn = { index: number; lane: number; atMs: number; points: number }
export function TokenCatchPlay(props: StageProps) {
  const { state, act, me, finished } = props
  const [elapsed, setElapsed] = useState(numeric(state.nowMs))
  const snapshot = useRef({ elapsed: numeric(state.nowMs), at: performance.now() })
  const [sent, setSent] = useState<Record<number, number>>({})
  const lanes = numeric(state.lanes, 3)
  const myLane = numeric(state.lanesNow?.[me])
  const playable = allowed(state, finished)
  const recent: CatchSpawn[] = Array.isArray(state.recent) ? state.recent : []
  const caught: number[] = Array.isArray(state.caughtIndices?.[me]) ? state.caughtIndices[me] : []
  const windowMs = numeric(state.catchWindowMs, 1000)
  useEffect(() => { snapshot.current = { elapsed: numeric(state.nowMs), at: performance.now() }; setElapsed(numeric(state.nowMs)) }, [state.nowMs, state.roundId, state._roundId])
  useEffect(() => {
    if (finished) return
    const timer = window.setInterval(() => setElapsed(snapshot.current.elapsed + performance.now() - snapshot.current.at), 40)
    return () => window.clearInterval(timer)
  }, [finished])
  useEffect(() => { setSent({}) }, [state.roundId, state._roundId])
  useEffect(() => {
    const active = new Set(recent.map((spawn) => spawn.index))
    setSent((previous) => {
      const entries = Object.entries(previous)
      const kept = entries.filter(([index]) => active.has(Number(index)))
      return kept.length === entries.length ? previous : Object.fromEntries(kept)
    })
  }, [state.nowMs])
  const catchable = (spawn: CatchSpawn) => playable && !caught.includes(spawn.index) && elapsed >= spawn.atMs && elapsed - spawn.atMs <= windowMs && !sent[spawn.index] && spawn.lane === myLane
  const move = (lane: number) => {
    if (playable && Number.isInteger(lane) && lane >= 0 && lane < lanes && lane !== myLane) act({ kind: 'lane', lane })
  }
  const collect = (spawn: CatchSpawn) => {
    if (!catchable(spawn)) return
    setSent((previous) => ({ ...previous, [spawn.index]: Date.now() }))
    act({ kind: 'catch', spawn: spawn.index })
  }
  const collectNearest = () => {
    const target = recent.filter((spawn) => spawn.points > 0 && catchable(spawn)).sort((a, b) => a.atMs - b.atMs)[0]
    if (target) collect(target)
  }
  return <GameFrame {...props} game="token-catch" title="Token Catch" eyebrow="Skyline coin run" icon={<Gem />} onLane={move} onCatch={(index) => { const spawn = recent.find((item) => item.index === index); if (spawn) collect(spawn) }} help={<><p>Move into a lane, then catch a gold token during its live window. Violet hazards reduce your score. Only tokens already published by the server are playable.</p><p>Use <strong>← →</strong> or the lane buttons to move. Focus the control panel and press <strong>Space</strong> to catch an available gold token in your lane. The server verifies timing and your lane; a token catch is a game score, not a wallet transfer.</p></>}>
    <div className="gp-stats"><Stat label="Your score" value={numeric(state.scores?.[me])} icon={<Gem size={14} />} /><Stat label="Score threshold" value={numeric(state.winThreshold)} /><Stat label="Your lane" value={`${myLane + 1} / ${lanes}`} /></div>
    <div className="gp-play-columns"><div className="gp-control-panel gp-catch-controls" tabIndex={0} aria-label="Token Catch controls. Arrow keys move, Space catches a live gold token." onKeyDown={(event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return
      if (event.key === 'ArrowLeft') { event.preventDefault(); move(myLane - 1) }
      else if (event.key === 'ArrowRight') { event.preventDefault(); move(myLane + 1) }
      else if (event.key === ' ' && event.target === event.currentTarget) { event.preventDefault(); collectNearest() }
    }}>
      <div className="gp-section-heading"><h4>Pick your lane. Catch the gold.</h4><span className="gp-key-tip">← → &nbsp; Space</span></div>
      <div className="gp-lanes" style={{ gridTemplateColumns: `repeat(${lanes}, minmax(0, 1fr))` }}>{Array.from({ length: lanes }, (_, lane) => <div key={lane} className={`gp-lane${myLane === lane ? ' selected' : ''}`}>
        <button type="button" className="gp-lane-picker" aria-pressed={myLane === lane} onClick={() => move(lane)} disabled={!playable}>Lane {lane + 1}</button>
        <div className="gp-lane-tokens">{recent.filter((spawn) => spawn.lane === lane && elapsed >= spawn.atMs && elapsed - spawn.atMs <= windowMs).map((spawn) => <button type="button" key={spawn.index} className={`gp-catch-token${spawn.points < 0 ? ' hazard' : ''}`} onClick={() => collect(spawn)} disabled={!catchable(spawn)} aria-label={`${spawn.points < 0 ? 'Hazard' : `Catch gold token for ${spawn.points} points`} in lane ${lane + 1}`}>{spawn.points < 0 ? <Shield aria-hidden /> : <Gem aria-hidden />}<strong>{spawn.points > 0 ? '+' : ''}{spawn.points}</strong></button>)}</div>
        <span className="gp-paddle" aria-label={myLane === lane ? 'Your confirmed position' : undefined}>{myLane === lane ? <ChevronRight size={20} aria-hidden /> : '·'}</span>
      </div>)}</div>
      <div className="gp-touch-controls"><button type="button" className="gp-control" disabled={!playable || myLane === 0} onClick={() => move(myLane - 1)} aria-label="Move left"><ChevronLeft aria-hidden /></button><button type="button" className="gp-action" onClick={collectNearest} disabled={!recent.some((spawn) => spawn.points > 0 && catchable(spawn))}><Gem size={18} aria-hidden />Catch gold</button><button type="button" className="gp-control" disabled={!playable || myLane >= lanes - 1} onClick={() => move(myLane + 1)} aria-label="Move right"><ChevronRight aria-hidden /></button></div>
      <p className="gp-muted">Gold gives points. Avoid violet hazards. Move first, then catch; your paddle shows the server-confirmed lane.</p>
      {Object.keys(sent).length > 0 && <p className="gp-status" role="status">Catch sent. Your scoreboard updates after server verification.</p>}
    </div><Scoreboard title="The catch leaderboard" scores={state.scores ?? {}} me={me} state={state} /></div>
  </GameFrame>
}

type SealedChoice = { choice: string; salt: string; round: number }
const moveSymbols: Record<string, string> = { rock: '●', paper: '▱', scissors: '✂', lizard: '⌁', spock: 'Ⅴ' }
const moveRules: Record<string, string> = { rock: 'Beats scissors & lizard', paper: 'Beats rock & Spock', scissors: 'Beats paper & lizard', lizard: 'Beats paper & Spock', spock: 'Beats rock & scissors' }

export function DuelPlay(props: StageProps) {
  const { state, act, me, players, finished } = props
  const round = numeric(state.roundIndex)
  const roundId = String(state.roundId ?? state._roundId ?? '')
  const storageKey = roundId && me ? `orbix:duel-choice:${String(state._roomId ?? '')}:${roundId}:${me}:${round}` : ''
  const [sealed, setSealed] = useState<SealedChoice | null>(null)
  const [busyUntil, setBusyUntil] = useState(0)
  const [storageError, setStorageError] = useState(false)
  const clock = useServerClock(state, finished)
  const busy = Date.now() < busyUntil && !state._actionError
  const choices = state.choiceSet === 'extended' ? ['rock', 'paper', 'scissors', 'lizard', 'spock'] : ['rock', 'paper', 'scissors']
  const phase = String(state.phase ?? 'commit')
  const committed = Boolean(state.committed?.[me])
  const revealed = Boolean(state.revealed?.[me])
  const roster: string[] = Array.isArray(state.players) ? state.players : players.slice(0, 2)
  const playable = allowed(state, finished) && roster.includes(me) && (clock.seconds === null || clock.seconds > 0)
  const history: { round: number; a: string; b: string; outcome: string; winner?: string | null }[] = Array.isArray(state.history) ? state.history : []
  const sealRef = useRef<SealedChoice | null>(null)
  const previousStorage = useRef<{ key: string; round: number; match: string } | null>(null)
  useEffect(() => {
    setBusyUntil(0); setStorageError(false)
    let restored: SealedChoice | null = null
    if (storageKey) {
      try {
        const previous = previousStorage.current
        if (previous && previous.match === roundId && previous.round < round && previous.key !== storageKey) sessionStorage.removeItem(previous.key)
        const raw = sessionStorage.getItem(storageKey)
        const parsed = raw ? JSON.parse(raw) : null
        if (parsed && parsed.round === round && choices.includes(parsed.choice) && typeof parsed.salt === 'string' && parsed.salt.length >= 20) restored = parsed
      } catch { setStorageError(true) }
    }
    previousStorage.current = { key: storageKey, round, match: roundId }
    sealRef.current = restored; setSealed(restored)
  }, [storageKey, round])
  useEffect(() => {
    if (!finished || !storageKey) return
    try { sessionStorage.removeItem(storageKey) } catch { /* Memory copy remains available until leaving the screen. */ }
  }, [finished, storageKey])
  const sendCommit = (choice: string) => {
    if (!playable || phase !== 'commit' || busy || committed || !choices.includes(choice)) return
    let secret = sealRef.current
    if (secret?.round !== round) secret = null
    if (secret && secret.choice !== choice) return
    if (!secret) {
      const bytes = crypto.getRandomValues(new Uint8Array(32))
      secret = { choice, salt: Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''), round }
      if (storageKey) {
        try { sessionStorage.setItem(storageKey, JSON.stringify(secret)) } catch { setStorageError(true) }
      }
      sealRef.current = secret; setSealed(secret)
    }
    setBusyUntil(Date.now() + 1600)
    act({ kind: 'commit', choice: secret.choice, salt: secret.salt })
  }
  const reveal = () => {
    const secret = sealRef.current
    if (!secret || !playable || busy || revealed || phase !== 'reveal') return
    setBusyUntil(Date.now() + 1600)
    act({ kind: 'reveal', choice: secret.choice, salt: secret.salt })
  }
  const outcomeText = (outcome: string, timeoutWinner?: string | null) => {
    if (outcome === 'timeout') return timeoutWinner ? `No reveal · forfeited to ${name(timeoutWinner, me, state)}` : 'Timed out · draw'
    const winner = outcome.split(':')[0]
    return winner === 'tie' ? 'Draw' : winner === me ? 'You won this round' : `${name(winner, me, state)} won this round`
  }
  return <GameFrame {...props} game="reaction-duel" title="Duel" eyebrow="The two-player showdown" icon={<Swords />} help={<><p>Choose a move, seal it, then reveal the same move after both players commit. The server resolves the matchup. Rock beats scissors, scissors beats paper, and paper beats rock.</p>{state.choiceSet === 'extended' && <p>Lizard beats paper and Spock; Spock beats rock and scissors. Rock beats lizard, paper beats Spock, and scissors beats lizard.</p>}<p>Your sealed move is kept in this browser tab for reconnects. Do not close the tab before revealing. Published round history appears only after the server resolves both moves.</p></>}>
    <div className="gp-stats"><Stat label="Round" value={`${Math.min(round + 1, numeric(state.rounds, 3))} / ${numeric(state.rounds, 3)}`} /><Stat label="Current phase" value={finished ? 'Complete' : phase === 'reveal' ? 'Reveal moves' : 'Seal your move'} icon={<LockKeyhole size={14} />} /><Stat label="Your wins" value={numeric(state.wins?.[me])} icon={<Trophy size={14} />} /></div>
    <div className="gp-duel-versus">{roster.map((who, index) => <div key={who} className={`gp-duelist duelist-${index}${who === me ? ' is-me' : ''}`}><span className="gp-duelist-avatar" aria-hidden>{index ? <Shield size={26} /> : <Swords size={26} />}</span><strong>{name(who, me, state)}</strong><span>{finished ? `${numeric(state.wins?.[who])} wins` : state.revealed?.[who] ? 'Reveal received' : state.committed?.[who] ? 'Move sealed' : 'Choosing a move…'}</span></div>)}{roster.length === 2 && <span className="gp-versus-label" aria-hidden>VS</span>}</div>
    <div className="gp-control-panel">
      <h4>{finished ? 'The showdown is complete.' : phase === 'reveal' ? 'Break the seal. Reveal your move.' : committed ? 'Move sealed. Your rival is choosing.' : 'Make your move.'}</h4>
      {phase === 'commit' && !finished && <div className="gp-move-grid" style={{ gridTemplateColumns: `repeat(${Math.min(choices.length, 3)}, minmax(0, 1fr))` }}>{choices.map((choice) => <button type="button" key={choice} className={`gp-move${sealed?.choice === choice ? ' selected' : ''}`} onClick={() => sendCommit(choice)} disabled={!playable || busy || committed || Boolean(sealed && sealed.choice !== choice)} aria-pressed={sealed?.choice === choice}><span aria-hidden>{moveSymbols[choice]}</span><strong>{choice}</strong><small>{state.choiceSet === 'extended' ? moveRules[choice] : choice === 'rock' ? 'Beats scissors' : choice === 'paper' ? 'Beats rock' : 'Beats paper'}</small></button>)}</div>}
      {phase === 'commit' && sealed && !finished && <p className="gp-status" role="status"><LockKeyhole size={16} aria-hidden />{committed ? 'Your move is sealed by the server.' : busy ? 'Sealing your move. Waiting for the server…' : `Last sent: ${sealed.choice}. Tap the same move to retry if it was not received.`}</p>}
      {phase === 'reveal' && !finished && (sealed ? <button type="button" className="gp-action gp-reveal-button" onClick={reveal} disabled={!playable || busy || revealed}><Sparkles size={18} aria-hidden />{revealed ? 'Reveal received. Waiting for rival…' : busy ? 'Sending reveal…' : `Reveal ${sealed.choice}`}</button> : <p className="gp-status gp-status-error">This tab has no saved move for the current round. The original move and salt are needed to reveal; a new move cannot replace the commitment.</p>)}
      {storageError && <p className="gp-status gp-status-error">Browser storage is unavailable. Keep this game screen open until you reveal your move.</p>}
      {clock.seconds === 0 && !finished && <p className="gp-status">The phase window has ended. Waiting for the server to advance.</p>}
    </div>
    <section className="gp-live-log gp-duel-history" aria-label="Resolved duel history"><h4><Flag size={17} aria-hidden />Round history</h4>{history.length ? <ol>{history.slice().reverse().map((row) => <li key={row.round}><span>Round {row.round + 1}</span><strong>{!row.a && !row.b ? 'No moves revealed' : <>{row.a || 'Not revealed'} <span className="gp-muted">vs</span> {row.b || 'Not revealed'}</>}</strong><small>{outcomeText(row.outcome, row.winner)}</small></li>)}</ol> : <p className="gp-log-empty">Moves stay sealed. The first resolved round appears here.</p>}</section>
  </GameFrame>
}

export function BossRaidPlay(props: StageProps) {
  const { state, act, me, finished } = props
  const health = numeric(state.bossHealth, numeric(state.health))
  const maxHealth = Math.max(1, numeric(state.bossHealthMax, 1))
  const damage = numeric(state.contribution?.[me])
  const cap = typeof state.contributionCap === 'number' ? state.contributionCap : null
  const min = numeric(state.minContribution)
  const [power, setPower] = useState(100)
  const teamsMode = state.teamMode === 'teams'
  const attackPower = teamsMode ? 25 : power
  const [lastSent, setLastSent] = useState(0)
  const clock = useServerClock(state, finished)
  const cooldownMs = numeric(state.actionCooldownMs, 500)
  const localCooldown = Math.max(0, lastSent + cooldownMs - Date.now())
  const serverLastHit = numeric(state.lastHitAt?.[me]) * 1000
  const cooldown = Math.max(localCooldown, serverLastHit > 0 ? serverLastHit + cooldownMs - clock.serverNow : 0)
  const playable = allowed(state, finished) && !state.slain && health > 0 && cooldown <= 0 && (cap === null || damage < cap)
  const totalA = numeric(state.teamDamage?.a)
  const totalB = numeric(state.teamDamage?.b)
  const totalTeams = Math.max(1, totalA + totalB)
  const team = state.teams?.[me]
  const attack = () => {
    if (!playable) return
    setLastSent(Date.now())
    act({ kind: 'hit', power: attackPower })
  }
  useEffect(() => { setLastSent(0) }, [state.roundId, state._roundId])
  return <GameFrame {...props} game="boss-raid" title="Boss Raid" eyebrow={teamsMode ? 'Two teams. One mighty boss.' : 'The crystal guardian arena'} icon={<Shield />} onAttack={attack} help={<><p>{teamsMode ? <>Each team strike has a fixed <strong>25 power</strong>, issued by the server.</> : <>Attack the crystal guardian with a power from <strong>1 to 100</strong>.</>} Every hit is checked by the server. Your cooldown is {cooldownMs / 1000}s{cap !== null ? ` and your contribution cap is ${cap.toLocaleString()} damage` : ''}.</p><p>{teamsMode ? 'Teams compete to deal the most confirmed damage. The server decides the winning team when the round ends. ' : 'Everyone contributes to the same raid. '}Reach {min.toLocaleString()} damage to meet the configured minimum. Reward eligibility and allocation follow the room’s verified settlement.</p><p>Use the attack button or focus the controls and press <strong>Space</strong>. Attack animations express your input; only confirmed contributions count.</p></>}>
    <div className="gp-boss-health"><div className="gp-boss-health-heading"><strong>{state.slain ? 'Guardian defeated!' : finished ? 'Raid complete' : 'Crystal guardian'}</strong><span>{health.toLocaleString()} / {maxHealth.toLocaleString()} HP</span></div><div className="gp-health-track" role="progressbar" aria-label="Boss health" aria-valuemin={0} aria-valuemax={maxHealth} aria-valuenow={health}><span style={{ width: `${Math.max(0, Math.min(100, health / maxHealth * 100))}%` }} /></div></div>
    <div className="gp-stats"><Stat label="Your contribution" value={damage.toLocaleString()} icon={<Swords size={14} />} /><Stat label="Minimum contribution" value={min.toLocaleString()} /><Stat label={state.teamMode === 'teams' ? 'Your team' : 'Your remaining allowance'} value={state.teamMode === 'teams' ? team ? `Team ${String(team).toUpperCase()}` : 'Spectator' : cap !== null ? Math.max(0, cap - damage).toLocaleString() : 'Server verified'} /></div>
    {state.teamMode === 'teams' && <section className="gp-team-score" aria-label="Team damage"><div><strong className="team-a">Team A</strong><span>{totalA.toLocaleString()} damage</span><span>{totalB.toLocaleString()} damage</span><strong className="team-b">Team B</strong></div><div className="gp-team-track"><span style={{ width: `${totalA + totalB ? totalA / totalTeams * 100 : 50}%` }} /></div>{finished && <p role="status">{state.winningTeam ? `Team ${String(state.winningTeam).toUpperCase()} dealt the most damage.` : 'The teams finished with equal damage.'}</p>}</section>}
    <div className="gp-play-columns"><div className="gp-control-panel gp-raid-controls" tabIndex={0} aria-label="Boss Raid controls. Space attacks." onKeyDown={(event) => { if (event.key === ' ' && event.target === event.currentTarget) { event.preventDefault(); attack() } }}>
      <h4>{state.slain ? 'The guardian has fallen.' : teamsMode ? 'Rally your team. Time your strike.' : 'Power up your next strike.'}</h4>
      {teamsMode ? <div className="gp-fixed-power"><Zap size={24} aria-hidden /><div><strong>25 power per strike</strong><span>The server gives every teammate the same attack power.</span></div></div> : <><fieldset className="gp-power-picker" disabled={!allowed(state, finished) || state.slain}><legend>Attack power</legend>{[25, 50, 100].map((value) => <button key={value} type="button" onClick={() => setPower(value)} aria-pressed={power === value} className={power === value ? 'selected' : ''}><Zap size={16} aria-hidden />{value}</button>)}</fieldset><label className="gp-power-slider"><span>Custom power <strong>{power}</strong></span><input type="range" min={1} max={100} value={power} onChange={(event) => setPower(Number(event.target.value))} disabled={!allowed(state, finished) || state.slain} /></label></>}
      <button type="button" className="gp-action gp-attack-button" onClick={attack} disabled={!playable}><Swords size={21} aria-hidden />{state.slain ? 'Guardian defeated' : finished ? 'Raid complete' : cap !== null && damage >= cap ? 'Contribution cap reached' : cooldown > 0 ? `Recharging · ${(cooldown / 1000).toFixed(1)}s` : `Strike · ${attackPower} power`}</button>
      <p className="gp-muted">{damage >= min ? 'Minimum contribution reached. Final reward eligibility is confirmed after the round.' : `${Math.max(0, min - damage).toLocaleString()} more damage to reach the minimum contribution.`}</p>
    </div><Scoreboard title="Live contributions" scores={state.contribution ?? {}} me={me} state={state} unit="damage" /></div>
  </GameFrame>
}

export const FOUR_STAGE_VIEWS: Partial<Record<string, (props: StageProps) => ReactNode>> = {
  'number-hunt': NumberHuntPlay,
  'token-catch': TokenCatchPlay,
  'reaction-duel': DuelPlay,
  'boss-raid': BossRaidPlay,
} satisfies Record<GameId, (props: StageProps) => ReactNode>
