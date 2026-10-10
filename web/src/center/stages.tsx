import { ClosestCallStage, WordForgeStage, PrismLinesStage, RelicAuctionStage, AtlasQuestStage } from './PortfolioStages'
// The eight release-one game stages.
//
// Every stage is a pure view over the server's public state: it may never invent a
// score, a hidden value or a result. Actions carry only intent (a guess, a flip, a lane)
// and the server decides what happened.

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { DuelPlay } from './GamePlayStages'
import { encodeAbiParameters, keccak256, pad, type Hex } from 'viem'

export function RoundPending({ status }: { status?: string }) {
  return (
    <div className="st-pending">
      <span className="spinner" aria-hidden />
      <p>
        {status === 'running'
          ? 'Round in progress — waiting for the server snapshot…'
          : 'Waiting for the host to start the round. Ready up and the field opens here.'}
      </p>
    </div>
  )
}

export type StageProps = {
  state: Record<string, any>
  act: (payload: Record<string, unknown>) => void
  me: string
  players: string[]
  finished: boolean
}

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—')

function hud(label: string, value: string | number, accent?: boolean) {
  return (
    <div className={`st-hud${accent ? ' accent' : ''}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}

// ------------------------------------------------------------------ G01 Number Hunt

export function NumberHuntStage({ state, act, me, finished }: StageProps) {
  const digits: number = state.digits ?? 6
  const [value, setValue] = useState('')
  const [flash, setFlash] = useState<string | null>(null)
  const slots = useMemo(() => Array.from({ length: digits }, (_, i) => value[i] ?? ''), [value, digits])
  const remaining = state.remaining?.[me] ?? state.guessBudget ?? 0

  // Hard input rule: non-digits are dropped and only the first N digits are kept,
  // whether typed or pasted. The server enforces the same rule independently.
  const sanitise = (raw: string) => raw.replace(/\D+/g, '').slice(0, digits)

  const submit = () => {
    if (value.length !== digits || finished) return
    act({ kind: 'guess', number: Number(value) })
    setFlash(`Submitted ${value}`)
    setValue('')
  }

  useEffect(() => {
    if (!flash) return
    const t = window.setTimeout(() => setFlash(null), 1600)
    return () => window.clearTimeout(t)
  }, [flash])

  const hiddenRef = useRef<HTMLInputElement>(null)
  const activeSlot = Math.min(value.length, digits - 1)
  const focusPad = () => hiddenRef.current?.focus()

  return (
    <div className="st">
      <div className="st-row">
        {hud('Range', `${state.min}–${state.max}`)}
        {hud('Your guesses left', remaining ?? 0, (remaining ?? 0) <= 3)}
        {hud('Targets claimed', `${state.claimedTargets ?? 0}/${state.targetCount ?? 1}`)}
        {hud('Hints', state.hints === 'on' ? 'on' : 'off')}
      </div>

      {/* The slots themselves are the input: tap/click then type or paste. A hidden
          field keeps mobile numeric keyboards and caret handling; slots are pure view. */}
      <div
        className={`digits pad${finished ? ' done' : ''}`}
        onClick={focusPad}
        role="button"
        tabIndex={-1}
        aria-label={`Enter ${digits} digit guess`}
      >
        {slots.map((d, i) => (
          <span
            key={i}
            className={`digit${d ? ' filled' : ''}${!finished && i === activeSlot ? ' caret' : ''}`}
          >
            {d || ''}
          </span>
        ))}
        <input
          ref={hiddenRef}
          className="pad-hidden"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          disabled={finished}
          onChange={(e) => setValue(sanitise(e.target.value))}
          onPaste={(e) => {
            e.preventDefault()
            setValue(sanitise(e.clipboardData.getData('text')))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          aria-label="Your guess"
        />
      </div>

      <div className="st-row">
        <button className="btn-primary" onClick={submit} disabled={finished || value.length !== digits}>
          {finished ? 'Round over' : 'Submit guess'}
        </button>
        <button
          className="btn-ghost"
          onClick={() => setValue(`${Math.floor(Math.random() * 9) + 1}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`.slice(0, digits))}
          disabled={finished}
          title="Fills the field locally only — it is not a hint from the server"
        >
          Random
        </button>
      </div>
      {flash && <p className="st-note ok" role="status" aria-live="polite">{flash}</p>}
      {state.guessLog?.length > 0 && (
        <div className="guess-log" aria-label="Guess log">
          <span className="guess-log-title">Guess log</span>
          {state.guessLog.map((g: {who:string; number:number; hit?:boolean; hint?:{who:string; number:number; direction:string}}, i: number) => (
            <div key={i} className={`guess-log-entry${g.hit ? ' hit' : ''}`}>
              <span className="guess-log-who">{g.who === me ? 'You' : short(g.who)}</span>
              <span className="guess-log-number mono">{g.number}</span>
              {g.hit && <span className="guess-log-hit">✓ target found</span>}
              {g.hint && !g.hit && state.hintVisibility === 'public' && (
                <span className="guess-log-hint">{g.hint.direction}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {state.targets && <p className="st-note">Targets revealed: {state.targets.join(', ')}</p>}
      <p className="st-note">Guess counts: {Object.entries(state.guessCount ?? {}).map(([k, v]) => `${short(k)}:${v}`).join('  ')}</p>
    </div>
  )
}

// ------------------------------------------------------------------ G02 Live Quiz

export function QuizStage({ state, act, me, finished }: StageProps) {
  const question = state.question as { prompt: string; choices: string[]; openedAt: number } | undefined
  const index: number = state.questionIndex ?? 0
  const seconds: number = state.questionSeconds ?? 15
  const answered = Boolean(((state.answers as Record<string, Record<string, number>> | undefined)?.[me] ?? {})[String(index)] !== undefined)
  const [picked, setPicked] = useState<number | null>(null)
  const [left, setLeft] = useState(seconds)

  useEffect(() => setPicked(null), [index])
  useEffect(() => {
    const started = question?.openedAt ?? 0
    const tick = () => setLeft(Math.max(0, Math.round(seconds - (Date.now() / 1000 - started))))
    tick()
    const t = window.setInterval(tick, 250)
    return () => window.clearInterval(t)
  }, [question?.openedAt, seconds])

  const choose = (choice: number) => {
    if (finished || answered) return
    setPicked(choice)
    act({ kind: 'answer', questionIndex: index, choice })
  }

  return (
    <div className="st">
      <div className="st-row">
        {hud('Question', `${index + 1}/${state.questionCount ?? '?'}`)}
        {hud('Time left', `${left}s`, left <= 5)}
        {hud('Scoring', state.scoring ?? 'accuracy')}
      </div>
      <div className="q-timer" style={{ ['--pct' as string]: `${Math.max(0, (left / seconds) * 100)}%` }} />
      <h3 className="q-prompt">{question?.prompt ?? 'Waiting for the next question…'}</h3>
      <div className="q-choices">
        {(question?.choices ?? []).map((choice, i) => (
          <button
            key={i}
            className={`q-choice${picked === i ? ' picked' : ''}`}
            onClick={() => choose(i)}
            disabled={finished || answered || left <= 0}
          >
            <span className="q-key">{String.fromCharCode(65 + i)}</span>
            {choice}
          </button>
        ))}
      </div>
      {answered && <p className="st-note ok" role="status" aria-live="polite">Answer locked in.</p>}
      <div className="board">
        {(state.leaderboard ?? []).map((row: { who: string; score: number }, i: number) => (
          <div key={row.who} className={`board-row${row.who === me ? ' me' : ''}`}>
            <span className="rank">{i + 1}</span>
            <span className="who">{short(row.who)}</span>
            <b>{row.score}</b>
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ G03 Memory Match

export function MemoryStage({ state, act, me, finished }: StageProps) {
  const pairs: number = state.pairs ?? 6
  const total = pairs * 2
  const matched = new Set<number>((state.matched as number[]) ?? [])
  const [flipped, setFlipped] = useState<number[]>([])
  const moves = (state.moves as Record<string, number> | undefined)?.[me] ?? 0
  const cap: number = state.moveCap ?? 100

  const flip = (index: number) => {
    if (finished || matched.has(index) || flipped.includes(index)) return
    act({ kind: 'flip', index })
    setFlipped((prev) => (prev.length >= 2 ? [index] : [...prev, index]))
  }

  useEffect(() => {
    if (flipped.length < 2) return
    const t = window.setTimeout(() => setFlipped([]), 650)
    return () => window.clearTimeout(t)
  }, [flipped])

  return (
    <div className="st">
      <div className="st-row">
        {hud('Moves', `${moves}/${cap}`, moves > cap * 0.8)}
        {hud('Matched', `${matched.size / 2}/${pairs}`)}
        {hud('Score mode', state.scoreMode ?? 'moves')}
      </div>
      <div className="mem-grid" style={{ ['--cols' as string]: pairs > 8 ? 6 : 4 }}>
        {Array.from({ length: total }, (_, i) => {
          const isMatched = matched.has(i)
          return (
            <button
              key={i}
              className={`mem-card${isMatched ? ' matched' : ''}${flipped.includes(i) ? ' flipped' : ''}`}
              onClick={() => flip(i)}
              disabled={finished || isMatched}
              aria-label={isMatched ? 'matched card' : 'hidden card'}
            >
              <span>{isMatched ? '✓' : flipped.includes(i) ? '•' : ''}</span>
            </button>
          )
        })}
      </div>
      <p className="st-note">The card faces stay on the server. Only matches you have earned are shown.</p>
    </div>
  )
}

// ------------------------------------------------------------------ G04 Token Catch

export function CatchStage({ state, act, me, finished }: StageProps) {
  const lanes: number = state.lanes ?? 3
  const recent = (state.recent as { index: number; lane: number; atMs: number; points: number }[]) ?? []
  const myLane = (state.lanesNow as Record<string, number> | undefined)?.[me] ?? 0
  const score = (state.scores as Record<string, number> | undefined)?.[me] ?? 0
  const target: number = state.winThreshold ?? 30
  const nowMs: number = state.nowMs ?? 0

  return (
    <div className="st">
      <div className="st-row">
        {hud('Score', score, score >= target)}
        {hud('Target', target)}
        {hud('Lane', myLane + 1)}
      </div>
      <div className="catch-felt" style={{ ['--lanes' as string]: lanes }}>
        {Array.from({ length: lanes }, (_, lane) => (
          <div key={lane} className={`catch-lane${myLane === lane ? ' active' : ''}`}>
            {recent
              .filter((s) => s.lane === lane)
              .map((s) => {
                const offset = Math.max(0, Math.min(1, 1 - (s.atMs - nowMs) / 600 + 0.4))
                return (
                  <button
                    key={s.index}
                    className={`catch-token${s.points < 0 ? ' hazard' : ''}`}
                    style={{ top: `${offset * 80 + 6}%` }}
                    onClick={() => act({ kind: 'catch', spawn: s.index })}
                  >
                    {s.points < 0 ? '!' : '+'}
                  </button>
                )
              })}
          </div>
        ))}
      </div>
      <div className="st-row">
        {Array.from({ length: lanes }, (_, lane) => (
          <button key={lane} className={`btn-ghost${myLane === lane ? ' on' : ''}`} onClick={() => act({ kind: 'lane', lane })} disabled={finished}>
            Lane {lane + 1}
          </button>
        ))}
      </div>
      <p className="st-note">Move your paddle, then tap a token as it crosses. The server checks lane and timing.</p>
    </div>
  )
}

// ------------------------------------------------------------------ G05 Reaction Duel

const CLASSIC = ['rock', 'paper', 'scissors']
const EXTENDED = [...CLASSIC, 'lizard', 'spock']

function LegacyDuelStage({ state, act, me, players, finished }: StageProps) {
  const choices: string[] = state.choiceSet === 'extended' ? EXTENDED : CLASSIC
  const phase: string = state.phase ?? 'commit'
  const roundIndex: number = state.roundIndex ?? 0
  const [pending, setPending] = useState<{ choice: string; salt: string } | null>(null)
  const [log, setLog] = useState<string>('')
  const saltRef = useRef<string>('')

  useEffect(() => {
    setPending(null)
    saltRef.current = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }, [roundIndex])

  const commit = (choice: string) => {
    setPending({ choice, salt: saltRef.current })
    act({ kind: 'commit', choice, salt: saltRef.current })
    setLog(`Committed a sealed choice for round ${roundIndex + 1}`)
  }

  const reveal = () => {
    if (!pending) return
    act({ kind: 'reveal', choice: pending.choice, salt: pending.salt })
    setLog(`Revealed ${pending.choice} for round ${roundIndex + 1}`)
  }

  const opponent = players.find((p) => p !== me)

  return (
    <div className="st">
      <div className="st-row">
        {hud('Round', `${roundIndex + 1}/${state.rounds ?? 3}`)}
        {hud('Phase', phase)}
        {hud('Your wins', (state.wins as Record<string, number> | undefined)?.[me] ?? 0)}
        {hud('Opponent wins', (state.wins as Record<string, number> | undefined)?.[opponent ?? ''] ?? 0)}
      </div>
      <div className="duel-pads">
        {players.map((p) => (
          <div key={p} className={`duel-pad${p === me ? ' me' : ''}${phase === 'reveal' ? ' revealed' : ''}`}>
            <span className="who">{p === me ? 'You' : short(p)}</span>
            <b>{phase === 'reveal' ? (state.history as any[])?.slice(-1)?.[0]?.[p === players[0] ? 'a' : 'b'] ?? '—' : 'sealed'}</b>
          </div>
        ))}
      </div>
      {phase === 'commit' && !finished && (
        <div className="st-row">
          {choices.map((choice) => (
            <button key={choice} className={`btn-ghost${pending?.choice === choice ? ' on' : ''}`} onClick={() => commit(choice)} disabled={Boolean(pending)}>
              {choice}
            </button>
          ))}
        </div>
      )}
      {phase === 'reveal' && pending && !finished && (
        <button className="btn-primary" onClick={reveal} disabled={finished}>
          Reveal {pending.choice}
        </button>
      )}
      {log && <p className="st-note ok" role="status" aria-live="polite">{log}</p>}
      <div className="board">
        {((state.history as any[]) ?? []).map((row, i) => (
          <div key={i} className="board-row">
            <span className="rank">R{row.round + 1}</span>
            <span className="who">{row.a} vs {row.b}</span>
            <b>{String(row.outcome).split(':')[0].slice(0, 6)}</b>
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ G06 Puzzle Sprint

export function PuzzleStage({ state, act, me, finished }: StageProps) {
  const size: number = state.size ?? 3
  const board: number[] = state.board ?? []
  const blank = board.indexOf(0)
  const moves = (state.moves as Record<string, number> | undefined)?.[me] ?? 0

  const adjacent = (index: number) => {
    if (blank < 0 || index < 0) return false
    const [r, c] = [Math.floor(index / size), index % size]
    const [br, bc] = [Math.floor(blank / size), blank % size]
    return Math.abs(r - br) + Math.abs(c - bc) === 1
  }

  return (
    <div className="st">
      <div className="st-row">
        {hud('Moves', moves)}
        {hud('Board', `${size}×${size}`)}
        {hud('Score mode', state.scoreMode ?? 'time')}
        {hud('Duration', `${state.durationSeconds ?? 60}s`)}
      </div>
      <div className="puzzle-grid" style={{ ['--size' as string]: size }}>
        {board.map((tile, index) => (
          <button
            key={index}
            className={`puzzle-tile${tile === 0 ? ' blank' : ''}${adjacent(index) ? ' movable' : ''}`}
            onClick={() => !finished && tile !== 0 && adjacent(index) && act({ kind: 'move', tile })}
            disabled={finished || tile === 0 || !adjacent(index)}
          >
            {tile === 0 ? '' : tile}
          </button>
        ))}
      </div>
      <p className="st-note">Only tiles beside the gap can move. The board is solvable by construction.</p>
    </div>
  )
}

// ------------------------------------------------------------------ G07 Hash Hunt

const HASH_DOMAIN = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_HASH_DOMAIN

export function HashHuntStage({ state, act, me, finished }: StageProps) {
  const bits: number = state.difficultyBits ?? 20
  const [nonce, setNonce] = useState('0')
  const [mining, setMining] = useState(false)
  const [tried, setTried] = useState(0)
  const cancelRef = useRef(false)
  const accepted = (state.leaderboard as { who: string; valid: number }[] | undefined) ?? []

  const target = useMemo(() => (1n << 256n) >> BigInt(bits), [bits])

  const hashFor = (n: bigint): Hex =>
    keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }],
        [
          (HASH_DOMAIN ?? '0x9309d9c477fa9c5cdc6c66cf31c6fffd73f5a8fdffb93ea5262f86ed92b2608a') as Hex,
          BigInt(state.chainId ?? 0),
          (state.escrow ?? '0x0000000000000000000000000000000000000000') as Hex,
          (state.roundId ?? pad('0x00', { size: 32 })) as Hex,
          (state.publicSeed ?? pad('0x00', { size: 32 })) as Hex,
          me as Hex,
          n,
        ],
      ),
    )

  const mine = async () => {
    if (finished || mining) return
    setMining(true)
    cancelRef.current = false
    let n = BigInt(nonce || '0')
    let count = 0
    const started = performance.now()
    // Chunked so the UI keeps breathing; a real miner would be a worker.
    while (!cancelRef.current && performance.now() - started < 4000) {
      n += 1n
      count += 1
      if (BigInt(hashFor(n)) < target) {
        setNonce(n.toString())
        setTried((t) => t + count)
        act({ kind: 'submit', nonce: n.toString() })
        setMining(false)
        return
      }
      if (count % 250 === 0) await new Promise((r) => window.setTimeout(r, 0))
    }
    setNonce(n.toString())
    setTried((t) => t + count)
    setMining(false)
  }

  return (
    <div className="st">
      <div className="st-row">
        {hud('Difficulty', `${bits} bits`)}
        {hud('Attempts', tried.toLocaleString())}
        {hud('Win mode', state.winMode ?? 'first-valid')}
      </div>
      <p className="st-note mono">seed {String(state.publicSeed ?? '').slice(0, 22)}…</p>
      <div className="st-row">
        <input className="pad-input mono" value={nonce} onChange={(e) => setNonce(e.target.value.replace(/\D/g, '') || '0')} disabled={finished} aria-label="Nonce" />
        <button className="btn-primary" onClick={mine} disabled={finished || mining}>
          {mining ? 'Mining…' : 'Mine'}
        </button>
        <button className="btn-ghost" onClick={() => { cancelRef.current = true; setMining(false) }} disabled={!mining}>
          Stop
        </button>
        <button className="btn-ghost" onClick={() => act({ kind: 'submit', nonce })} disabled={finished}>
          Submit nonce
        </button>
      </div>
      <div className="board">
        {accepted.map((row, i) => (
          <div key={row.who} className={`board-row${row.who === me ? ' me' : ''}`}>
            <span className="rank">{i + 1}</span>
            <span className="who">{short(row.who)}</span>
            <b>{row.valid} proof(s)</b>
          </div>
        ))}
      </div>
      <p className="st-note">Proofs are verified server-side against the same keccak tuple.</p>
    </div>
  )
}

// ------------------------------------------------------------------ G08 Boss Raid

export function BossStage({ state, act, me, finished }: StageProps) {
  const health: number = state.bossHealth ?? 0
  const max: number = state.bossHealthMax ?? 1
  const pct = Math.max(0, Math.min(100, (health / max) * 100))
  const contribution = (state.contribution as Record<string, number> | undefined)?.[me] ?? 0
  const [power, setPower] = useState(1)
  const [cooldown, setCooldown] = useState(false)

  const hit = () => {
    if (finished || cooldown) return
    act({ kind: 'hit', power })
    setCooldown(true)
    // Animation is optimistic; the damage figure always comes back from the server.
    window.setTimeout(() => setCooldown(false), 350)
  }

  return (
    <div className="st">
      <div className="boss-bar">
        <div className="boss-fill" style={{ width: `${pct}%` }} />
        <span className="boss-label">
          {state.slain ? 'BOSS SLAIN' : `${health} / ${max} HP`}
        </span>
      </div>
      <div className="st-row">
        {hud('Your damage', contribution, contribution < (state.minContribution ?? 0))}
        {hud('Minimum to qualify', state.minContribution ?? 0)}
        {hud('Reward rule', state.rewardRule ?? 'proportional')}
        {hud('Time', `${state.durationSeconds ?? 60}s`)}
      </div>
      <div className="st-row">
        <label className="slider">
          <span>Power {power}</span>
          <input type="range" min={1} max={100} value={power} onChange={(e) => setPower(Number(e.target.value))} disabled={finished} />
        </label>
        <button className="btn-primary" onClick={hit} disabled={finished || cooldown || state.slain}>
          {state.slain ? 'Boss is down' : cooldown ? 'Recharging…' : `Hit for ${power}`}
        </button>
      </div>
      <div className="board">
        {Object.entries((state.contribution as Record<string, number>) ?? {}).map(([who, dmg]) => (
          <div key={who} className={`board-row${who === me ? ' me' : ''}`}>
            <span className="rank">⚔</span>
            <span className="who">{short(who)}</span>
            <b>{dmg}</b>
          </div>
        ))}
      </div>
      <p className="st-note">Damage is capped per player server-side, so a script cannot out-hit the room.</p>
    </div>
  )
}


// ------------------------------------------------------------------ G09 RPS Duel

function LegacyRpsStage({ state, act, me, players, finished }: StageProps) {
  const moves: string[] = state.moves ?? ['rock', 'paper', 'scissors']
  const phase: string = state.phase ?? 'commit'
  const wins: Record<string, number> = state.wins ?? {}
  const history: any[] = state.history ?? []
  const [choice, setChoice] = useState(moves[0])
  const [salt, setSalt] = useState(() => Math.random().toString(36).slice(2, 10))
  const submitted = Boolean(state.commitsIn?.[me])
  const revealed = Boolean(state.revealsIn?.[me])

  const commit = () => {
    act({ kind: 'commit', choice, salt })
    setSalt(Math.random().toString(36).slice(2, 10))
  }

  return (
    <div className="st">
      <div className="st-row">
        {hud('subround', `${(state.roundIndex ?? 0) + 1} / ${state.rounds ?? 3}`)}
        {hud('phase', phase, true)}
        {players.map((p) => hud(short(p), wins[p] ?? 0))}
      </div>
      {!finished && phase === 'commit' && (
        <>
          <div className="st-row">
            {moves.map((m) => (
              <button key={m} className={`q-choice${choice === m ? ' picked' : ''}`} onClick={() => setChoice(m)} disabled={submitted}>
                <span className="q-key">{m.slice(0, 2)}</span>
                {m}
              </button>
            ))}
          </div>
          <div className="ct-actions">
            <button className="btn-primary" onClick={commit} disabled={submitted}>
              {submitted ? 'Commit sent — waiting for your rival' : 'Lock in this move'}
            </button>
            <span className="muted">Your choice is hashed on the server; nobody can read it before the reveal.</span>
          </div>
        </>
      )}
      {!finished && phase === 'reveal' && (
        <div className="ct-actions">
          <button className="btn-primary" onClick={() => act({ kind: 'reveal', choice, salt })} disabled={revealed}>
            {revealed ? 'Revealed — waiting for your rival' : `Reveal ${choice}`}
          </button>
        </div>
      )}
      {history.length > 0 && (
        <div className="ct-chips">
          {history.slice(-6).map((h, i) => (
            <span key={i} className="chip">
              R{h.round + 1}: {h.a} vs {h.b}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ G10 Reward Grid

export function RewardGridStage({ state, act, me, finished }: StageProps) {
  const tiles: number = state.tiles ?? 36
  const mine: number[] = state.revealed?.[me] ?? []
  const cols = Math.ceil(Math.sqrt(tiles))
  return (
    <div className="st">
      <div className="st-row">
        {hud('slots left', state.slotsLeft ?? 0, true)}
        {hud('reveals used', `${mine.length} / ${state.revealCap ?? 0}`)}
      </div>
      <div className="reward-grid" style={{ ['--cols' as string]: cols }}>
        {Array.from({ length: tiles }, (_, i) => (
          <button
            key={i}
            className={`reward-tile${mine.includes(i) ? ' done' : ''}`}
            disabled={finished || mine.includes(i)}
            onClick={() => act({ kind: 'reveal', tile: i })}
            aria-label={`Reveal tile ${i + 1}`}
          >
            {mine.includes(i) ? '·' : i + 1}
          </button>
        ))}
      </div>
      <p className="st-note">
        {state.slotsLeft > 0
          ? `${state.slotsLeft} of a fixed set of slots are still hidden. Demo points only.`
          : 'All slots found.'}
      </p>
    </div>
  )
}

// ------------------------------------------------------------------ G11 Bingo

export function BingoStage({ state, act, finished }: StageProps) {
  const board: number = state.board ?? 3
  const calls: number[] = state.calls ?? []
  const size = board * board
  const marks = new Set(calls)
  if (state.freeCentre && board === 3) marks.add(4)
  return (
    <div className="st">
      <div className="st-row">
        {hud('calls', calls.length, true)}
        {hud('win', state.winMode === 'full-board' ? 'full board' : 'first line')}
      </div>
      <div className="bingo-board" style={{ ['--cols' as string]: board }}>
        {Array.from({ length: size }, (_, i) => (
          <span key={i} className={`bingo-cell${marks.has(i) ? ' marked' : ''}${state.freeCentre && board === 3 && i === 4 ? ' free' : ''}`}>
            {marks.has(i) ? '●' : i + 1}
          </span>
        ))}
      </div>
      <div className="ct-actions">
        <button className="btn-primary" onClick={() => act({ kind: 'claim' })} disabled={finished}>
          Claim my line
        </button>
        <span className="muted">The server verifies your board against the calls it actually issued.</span>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ G12 Pattern Recall

export function RecallStage({ state, act, me, finished }: StageProps) {
  const visible: number[] = state.visibleSequence ?? []
  const symbols: number = state.symbols ?? 6
  const failed = (state.failed ?? []).includes(me)
  const [entry, setEntry] = useState<number[]>([])
  return (
    <div className="st">
      <div className="st-row">
        {hud('step', state.step ?? 0, true)}
        {hud('symbols', symbols)}
        {failed && hud('status', 'failed')}
      </div>
      <div className="digit-row">
        {visible.map((v, i) => (
          <span key={i} className="seq-chip">{v}</span>
        ))}
      </div>
      <div className="ct-row">
        {Array.from({ length: symbols }, (_, i) => (
          <button key={i} className="q-choice" onClick={() => setEntry((e) => [...e, i])} disabled={finished || failed}>
            {i}
          </button>
        ))}
      </div>
      <div className="st-row">
        <span className="muted mono">your entry: {entry.join(' → ') || '—'}</span>
        <button className="btn-ghost" onClick={() => setEntry([])}>clear</button>
        <button
          className="btn-primary"
          disabled={finished || failed || entry.length !== visible.length}
          onClick={() => {
            act({ kind: 'input', sequence: entry })
            setEntry([])
          }}
        >
          Submit sequence
        </button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ G13 Typing Sprint

export function TypingStage({ state, act, me, finished }: StageProps) {
  const [text, setText] = useState('')
  const lastKey = useRef(0)
  const submitted = (state.submitted ?? []).includes(me)
  const onKey = () => {
    const now = performance.now()
    if (now - lastKey.current < 15) return // the server enforces the same floor
    lastKey.current = now
    act({ kind: 'key' })
  }
  return (
    <div className="st">
      <div className="st-row">
        {hud('pack', state.promptId ?? '—', true)}
        {hud('floor', `${state.accuracyFloor ?? 0}%`)}
        {hud('length', text.length)}
      </div>
      <textarea
        className="type-area"
        rows={3}
        value={text}
        disabled={finished || submitted}
        onKeyDown={onKey}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => e.preventDefault()}
        placeholder="Type here. Pasting is disabled and keystroke timing is checked server-side."
      />
      <div className="ct-actions">
        <button className="btn-primary" disabled={finished || submitted || !text} onClick={() => act({ kind: 'submit', text })}>
          {submitted ? 'Submitted' : 'Submit my text'}
        </button>
        <span className="muted">A pasted block or an impossible burst is refused — the score comes from server keystrokes.</span>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ G14 Maze Race

export function MazeStage({ state, act, me, finished }: StageProps) {
  const size: number = state.size ?? 10
  const links: number[][] = (state.links ?? []).map((l: number[]) => l.slice().sort((a: number, b: number) => a - b))
  const linkSet = useMemo(() => new Set(links.map((l) => l.join('-'))), [state.links])
  const pos: number = state.positions?.[me] ?? state.start ?? 0
  const r = Math.floor(pos / size)
  const c = pos % size
  const step = (dr: number, dc: number) => {
    const nr = r + dr, nc = c + dc
    if (nr < 0 || nc < 0 || nr >= size || nc >= size) return
    const to = nr * size + nc
    const key = [pos, to].sort((a, b) => a - b).join('-')
    if (!linkSet.has(key)) return
    act({ kind: 'move', to })
  }
  return (
    <div className="st">
      <div className="st-row">
        {hud('grid', `${size}×${size}`, true)}
        {hud('your cell', pos)}
        {hud('exit', state.finish ?? 0)}
      </div>
      <div className="maze-wrap" style={{ ['--cols' as string]: size }}>
        {Array.from({ length: size * size }, (_, i) => {
          const isMe = i === pos
          return (
            <span key={i} className={`maze-cell${isMe ? ' me' : ''}${i === state.finish ? ' exit' : ''}${i === state.start ? ' start' : ''}`}>
              {isMe ? '●' : i === state.finish ? '★' : ''}
            </span>
          )
        })}
      </div>
      <div className="maze-pad">
        <button className="btn-ghost" onClick={() => step(-1, 0)} disabled={finished}>↑</button>
        <div className="ct-row">
          <button className="btn-ghost" onClick={() => step(0, -1)} disabled={finished}>←</button>
          <button className="btn-ghost" onClick={() => step(1, 0)} disabled={finished}>↓</button>
          <button className="btn-ghost" onClick={() => step(0, 1)} disabled={finished}>→</button>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ G15 Level Runner

export function RunnerStage({ state, act, me, finished }: StageProps) {
  const lane: number = state.lane?.[me] ?? 1
  const progress: number = state.progress?.[me] ?? 0
  const crashed = (state.crashed ?? []).includes(me)
  return (
    <div className="st">
      <div className="st-row">
        {hud('distance', progress, true)}
        {hud('cap', state.scoreCap ?? 0)}
        {crashed && hud('status', 'crashed')}
      </div>
      <div className="runner-lanes">
        {[0, 1, 2].map((l) => (
          <button key={l} className={`runner-lane${lane === l ? ' on' : ''}`} onClick={() => act({ kind: 'step', lane: l })} disabled={finished || crashed}>
            lane {l + 1}
          </button>
        ))}
      </div>
      <div className="ct-actions">
        <button className="btn-primary" onClick={() => act({ kind: 'step', lane })} disabled={finished || crashed}>
          Advance
        </button>
        <span className="muted">Each step is replayed against the seeded obstacle stream on the server.</span>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ G16 Contract Detective

export function DetectiveStage({ state, act, me, finished }: StageProps) {
  const questions: any[] = state.questions ?? []
  const answered = state.answeredCount?.[me] ?? 0
  const [idx, setIdx] = useState(0)
  const q = questions[idx]
  return (
    <div className="st">
      <div className="st-row">
        {hud('question', `${idx + 1} / ${questions.length}`, true)}
        {hud('answered', answered)}
      </div>
      {q && (
        <>
          <pre className="code-block">{q.snippet}</pre>
          <p className="q-prompt">{q.question}</p>
          <div className="q-choices">
            {q.choices.map((c: string, i: number) => (
              <button key={i} className="q-choice" disabled={finished} onClick={() => { act({ kind: 'answer', question: idx, choice: i }); setIdx((v) => Math.min(v + 1, questions.length - 1)) }}>
                <span className="q-key">{String.fromCharCode(65 + i)}</span>
                {c}
              </button>
            ))}
          </div>
        </>
      )}
      <p className="st-note">Explanations are revealed after the round closes. Educational content, not an audit.</p>
    </div>
  )
}

// ------------------------------------------------------------------ G18 MEV Rush

export function MevStage({ state, act, me, finished }: StageProps) {
  const live: number[] = state.live ?? []
  const mine: number[] = state.captured?.[me] ?? []
  return (
    <div className="st">
      <div className="st-row">
        {hud('live opportunities', live.length, true)}
        {hud('captured', mine.length)}
      </div>
      <div className="ct-chips">
        {live.length === 0 && <span className="muted">Waiting for the first opportunity…</span>}
        {live.slice(-12).map((slot) => (
          <button key={slot} className={`chip${mine.includes(slot) ? ' on' : ''}`} disabled={finished} onClick={() => act({ kind: 'capture', slot })}>
            slot {slot}
          </button>
        ))}
      </div>
      <p className="st-note">A simulated pending-transaction queue — this is not a real-chain frontrunning service.</p>
    </div>
  )
}

// ------------------------------------------------------------------ G19 Idle Rig

export function IdleStage({ state, act, me, finished }: StageProps) {
  const level: number = state.levels?.[me] ?? 1
  const earned: number = state.earned?.[me] ?? 0
  const cost = 10 * Math.pow(2, level - 1)
  return (
    <div className="st">
      <div className="st-row">
        {hud('tier', level, true)}
        {hud('earned', earned)}
        {hud('inventory left', state.inventoryLeft ?? 0)}
      </div>
      <div className="ct-actions">
        <button className="btn-primary" disabled={finished || earned < cost} onClick={() => act({ kind: 'upgrade' })}>
          Upgrade to tier {level + 1} ({cost})
        </button>
        <span className="muted">Progression runs on the server clock — a closed tab earns nothing.</span>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ G20 Airdrop Quest

export function AirdropStage({ state, act, me, finished }: StageProps) {
  const all: string[] = state.achievements ?? []
  const mine: string[] = state.achieved?.[me] ?? []
  return (
    <div className="st">
      <div className="st-row">
        {hud('campaign', state.campaign ?? '—', true)}
        {hud('completed', `${mine.length} / ${all.length}`)}
      </div>
      <div className="ct-chips">
        {all.map((a) => (
          <button key={a} className={`chip${mine.includes(a) ? ' on' : ''}`} disabled={finished || mine.includes(a)} onClick={() => act({ kind: 'complete', achievement: a })}>
            {mine.includes(a) ? '✓ ' : ''}{a}
          </button>
        ))}
      </div>
      <p className="st-note">One wallet-bound entitlement per quest. Completions are verified from accepted actions.</p>
    </div>
  )
}

export const STAGES: Record<string, ((props: StageProps) => ReactElement) | undefined> = {
  'closest-call': ClosestCallStage, 'word-forge': WordForgeStage, 'prism-lines': PrismLinesStage,
  'relic-auction': RelicAuctionStage, 'atlas-quest': AtlasQuestStage,
  'number-hunt': NumberHuntStage,
  'live-quiz': QuizStage,
  'memory-match': MemoryStage,
  'token-catch': CatchStage,
  'reaction-duel': DuelStage,
  'puzzle-sprint': PuzzleStage,
  'hash-hunt': HashHuntStage,
  'boss-raid': BossStage,
  'rps-duel': RpsStage,
  'reward-grid': RewardGridStage,
  'logo-bingo': BingoStage,
  'pattern-recall': RecallStage,
  'typing-sprint': TypingStage,
  'maze-race': MazeStage,
  'level-runner': RunnerStage,
  'contract-detective': DetectiveStage,
  'mev-rush': MevStage,
  'idle-rig': IdleStage,
  'airdrop-quest': AirdropStage,
}

export function DuelStage(props: StageProps) { return Number(props.state.version ?? 1) === 2 ? <DuelPlay {...props} /> : <LegacyDuelStage {...props} /> }
export function RpsStage(props: StageProps) { return Number(props.state.version ?? 1) === 2 ? <DuelPlay {...props} /> : <LegacyRpsStage {...props} /> }
