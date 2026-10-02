// Orbix Center — the creator game/quiz platform inside orbixcore.fun.
//
// Routes (hash-free, plain paths so the existing cockpit router can delegate to us):
//   /center                 catalog + live rooms
//   /center/create          the creator wizard
//   /center/rooms/:roomId   lobby, live play, results and reward codes
//   /center/wallet          vault balance, ledger export, demo wallet
//
// Honesty rules enforced in the UI, not just the docs: the vault panel says the balance
// is simulated, every room is labelled preview, and no funded-reward control is offered
// while the deployment flag is off.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RoundPending, STAGES } from './stages'
import { GameArt, TEMPLATE_META } from './gameArt'
import { QuizEditor, TEMPLATE_FORMS, ruleNumber, type QuizQuestion, type RuleField } from './wizardForms'
import { center, explainError, type Allocation, type OnchainBalance, type RoomDetail, type RoomSummary, type Settlement, type TemplateMeta, type VaultState } from './api'
import { playerHue, shortAddress, useSession } from './session'
import { WalletModal } from './WalletModal'
import { GameBanner } from './bannerArt'
import { AdminPanel } from './AdminPanel'
import { useRoomChannel } from './ws'
import './center.css'

type Route =
  | { name: 'catalog' }
  | { name: 'create'; templateId?: string }
  | { name: 'room'; roomId: string }
  | { name: 'wallet' }
  | { name: 'admin' }

function parseRoute(): Route {
  const path = window.location.pathname.replace(/\/+$/, '')
  const parts = path.split('/').filter(Boolean)
  if (parts[1] === 'create') return { name: 'create', templateId: parts[2] ?? new URLSearchParams(window.location.search).get('template') ?? undefined }
  if (parts[1] === 'rooms' && parts[2]) return { name: 'room', roomId: parts[2] }
  if (parts[1] === 'wallet') return { name: 'wallet' }
  if (parts[1] === 'admin') return { name: 'admin' }
  return { name: 'catalog' }
}

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function navigate(path: string) {
  go(path)
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  'preview-published': 'Preview',
  'config-frozen': 'Frozen',
  funding: 'Funding',
  funded: 'Funded',
  registration: 'Open for players',
  ready: 'Ready to start',
  running: 'Live',
  'result-pending': 'Scoring',
  'settlement-pending': 'Settling',
  claimable: 'Rewards claimable',
  cancelled: 'Cancelled',
  refundable: 'Refundable',
  'recovery-required': 'Needs attention',
  closed: 'Closed',
}

// ------------------------------------------------------------------ shared bits

function Banner() {
  return (
    <div className="ct-banner" role="status">
      <strong>Reward status.</strong> Preview rooms award points only. Where available, on-chain wallet and vault balances are shown separately; every room must state its actual funded reward before entry.
    </div>
  )
}

function WalletChip({ session, onOpenWallet }: { session: ReturnType<typeof useSession>; onOpenWallet: () => void }) {
  const vault = useAsync(
    () => (session.token ? center.vault(session.token) : Promise.resolve(null)),
    [session.token],
  )
  // Live on-chain balances, polled so the number in the bar is always real.
  const [live, setLive] = useState<OnchainBalance | null>(null)
  useEffect(() => {
    if (!session.token) return
    let alive = true
    const pull = () =>
      center
        .onchainBalance(session.token!)
        .then((b) => {
          if (alive) setLive(b)
        })
        .catch(() => undefined)
    pull()
    const t = setInterval(pull, 20_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [session.token])
  const fmt = (n: number | null | undefined) => {
    if (n == null) return null
    const v = n / 1e18
    return v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(v >= 1 ? 2 : 4)
  }
  const liveLabel = live?.live
    ? `${fmt(live.vaultCredit) ?? '0'} ${live.symbol}`
    : null
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(session.address ?? '').then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }).catch(() => undefined)
  }
  return (
    <div className="ct-wallet" title={session.address ?? undefined}>
      <span className={`dot${session.token ? '' : ' off'}`} />
      <button className="ct-wallet-addr mono" onClick={copy} title="copy address">
        {shortAddress(session.address)}
        {copied ? ' ✓' : ''}
      </button>
      <span className="ct-wallet-bal">
        {liveLabel
          ? <><i className="live-dot" /> {liveLabel}</>
          : vault.data ? `${vault.data.balance} ${vault.data.label}` : session.token ? '…' : '—'}
      </span>
      {session.token ? (
        <button className="link" onClick={session.signOut}>sign out</button>
      ) : (
        <button className="ct-wallet-connect" onClick={onOpenWallet} disabled={session.signingIn}>
          {session.signingIn ? 'signing in…' : 'Connect'}
        </button>
      )}
    </div>
  )
}

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let live = true
    setLoading(true)
    fn()
      .then((value) => live && setData(value))
      .catch((err) => live && setError(explainError(err)))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, error, loading }
}

// ------------------------------------------------------------------ catalog

export function Catalog({ session: _session }: { session: ReturnType<typeof useSession> }) {
  const templates = useAsync(() => center.templates(), [])
  const rooms = useAsync(() => center.rooms(), [])
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | 'multiplayer' | 'solo'>('all')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (templates.data?.templates ?? []).filter((t) => {
      if (kind === 'multiplayer' && !t.multiplayer) return false
      if (kind === 'solo' && t.multiplayer) return false
      if (!q) return true
      const blurb = TEMPLATE_META[t.templateId]?.blurb ?? t.blurb
      return `${t.label} ${blurb} ${t.modes}`.toLowerCase().includes(q)
    })
  }, [templates.data, query, kind])

  return (
    <div className="ct-page ct-catalog">
      <Banner />
      <section className="ct-hero">
        <div className="ct-hero-copy"><span className="ct-kicker">ROOMS FOR YOUR COMMUNITY</span><h1>Make a room<br/><i>worth joining.</i></h1><p className="sub">Launch a live game, set its hint rules and reward mode, then share one link. Every room labels preview and funded assets before play.</p><div className="ct-hero-actions"><button className="btn-primary" onClick={() => go('/center/create')}>Create a room <span aria-hidden>↗</span></button><button className="btn-ghost" onClick={() => document.querySelector('.ct-sub')?.scrollIntoView({ behavior: 'smooth' })}>Browse formats <span aria-hidden>↓</span></button></div><div className="ct-hero-meta"><span><i className="live-dot"/> Rooms update live</span><span>{templates.data?.count ?? templates.data?.templates.length ?? 19} game formats</span></div></div>
        <div className="ct-hero-orbit" aria-hidden="true"><span className="ct-orbit-label">CENTER / 01</span><span className="ct-orbit-ring ring-a"/><span className="ct-orbit-ring ring-b"/><span className="ct-orbit-core">C</span><span className="ct-orbit-dot dot-a"/><span className="ct-orbit-dot dot-b"/></div>
      </section>
      <div className="ct-signal-row"><span><b>{templates.data?.count ?? templates.data?.templates.length ?? 19}</b> game formats</span><span><b>LIVE</b> room play</span><span><b>Testnet</b> funded rewards</span></div>
      <header className="ct-head">
        <div><span className="ct-kicker">FORMAT LIBRARY</span><h2 className="ct-sub">Find your kind of chaos.</h2><p className="sub">From quick duels to co-op raids, every format is ready to configure.</p></div>
        <div className="ct-head-count"><b>{String(shown.length).padStart(2, '0')}</b><span>FORMATS</span></div>
      </header>

      {templates.loading && <p className="muted">Loading formats…</p>}
      {templates.error && <p className="err">{templates.error}</p>}

      <div className="ct-filters">
        <input
          type="search"
          className="ct-search"
          placeholder="Search formats…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search game formats"
        />
        <div className="ct-chips">
          {(['all', 'multiplayer', 'solo'] as const).map((k) => (
            <button key={k} className={`chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)} aria-pressed={kind === k}>
              {k === 'all' ? 'All formats' : k}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 && !templates.loading && (
        <p className="muted">No format matches “{query}”. Try a different word, or clear the filters.</p>
      )}

      <div className="ct-grid">
        {shown.map((t) => (
          <article key={t.templateId} className="gcard" style={{ ['--gc' as string]: TEMPLATE_META[t.templateId]?.hue ?? '#ff6b22' }}>
            <GameBanner templateId={t.templateId} hue={TEMPLATE_META[t.templateId]?.hue ?? '#ff6b22'} />
            <div className="gcard-grad" aria-hidden="true" />
            <div className="gcard-body">
              <div>
                <h3>{t.label}</h3>
                <p>{TEMPLATE_META[t.templateId]?.blurb ?? t.blurb}</p>
                <div className="ct-tags">
                  <span>{t.modes}</span>
                  <span>{t.multiplayer ? 'multiplayer' : 'solo'}</span>
                  <span className="tag-preview">{t.availability}</span>
                </div>
              </div>
              <span className="gcard-chip">{t.multiplayer ? 'MP' : 'SOLO'}</span>
            </div>
            <button className="btn-ghost ct-card-cta" onClick={() => go(`/center/create?template=${t.templateId}`)}>
              Create {t.label} <span aria-hidden>↗</span>
            </button>
          </article>
        ))}
      </div>

      <div className="ct-rooms-head">
        <div><span className="ct-kicker">LIVE ROOMS</span><h2 className="ct-sub">Open now.</h2></div>
        <span className="ct-live-badge"><i className="live-dot"/> {rooms.data?.rooms.length ?? 0} open</span>
      </div>
      {rooms.loading && <p className="muted">Loading rooms…</p>}
      {rooms.data?.rooms.length === 0 && <p className="muted">No public rooms yet — create the first one.</p>}
      <div className="ct-rooms">
        {(rooms.data?.rooms ?? []).map((r: RoomSummary) => (
          <button key={r.roomId} className="ct-room" onClick={() => go(`/center/rooms/${r.roomId}`)}>
            <span className={`pill s-${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
            <span className="ct-room-name"><b>{r.name}</b><small>{r.templateId}</small></span>
            <span className="ct-room-meta">
              <span>{r.players} player{r.players === 1 ? '' : 's'}</span>
              <span>{r.rewards} pts</span>
            </span>
            <span className="ct-room-go" aria-hidden>↗</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ wizard

type DraftState = {
  templateId: string
  name: string
  visibility: 'public' | 'unlisted' | 'private'
  description: string
  rules: Record<string, unknown>
  requiredAmount: number
  joinerFee: number
  absorbsJoinerFee: boolean
  entryToken: string
  entryAmount: number
  hintVisibility: 'private' | 'public'
  durationSeconds: number
  playerCap: number
  minReady: number
  rewardPoints: number
}

const HINT_POLICIES: Record<string, string> = {
  'live-quiz': 'Questions reveal progressively. Future mode: category clue or one wrong-choice elimination, never answer keys.',
  'memory-match': 'No live hint. Future mode: one bounded pair reveal that cannot expose the remaining board.',
  'token-catch': 'No hint feed. Future mode: lane and tempo cue without revealing future spawns.',
  'reaction-duel': 'Only shared round and commit/reveal progress. Opponent choice stays hidden until reveal.',
  'puzzle-sprint': 'No live hint. Future mode: one legal-move suggestion with a creator-set use limit.',
  'hash-hunt': 'Difficulty and mining progress only. Never expose a solution nonce.',
  'boss-raid': 'Shared phase and weakness cue; no hidden participant actions.',
  'rps-duel': 'Commit/reveal status only. Opponent choice remains private until both reveals.',
  'reward-grid': 'No hint feed yet. Proximity hints remain disabled until bounded hint budgets are implemented.',
  'logo-bingo': 'Shared call history is visible to all players.',
  'pattern-recall': 'No hint feed yet. Bounded sequence replay is planned, not active.',
  'typing-sprint': 'Show personal accuracy and pace only; never reveal another player’s input.',
  'maze-race': 'No hint feed yet. Budgeted directional clues are planned, not active.',
  'level-runner': 'Checkpoint state only. Future mode may show one checkpoint cue.',
  'contract-detective': 'No hint feed until creator-curated evidence clues are configured.',
  'mev-rush': 'Simulation queue status only; no real transaction or private target disclosure.',
  'idle-rig': 'Show verified efficiency stats only; no hidden payout or offline earnings hint.',
  'airdrop-quest': 'Show remaining verified quest conditions for the current player only.',
}

const DEFAULT_RULES: Record<string, Record<string, unknown>> = {
  'number-hunt': { digits: 4, min: 1111, max: 9999, guess_budget: 10, hints: 'on', target_count: 1, win_mode: 'first-hit', guess_cooldown_ms: 500 },
  'live-quiz': {
    question_seconds: 15,
    scoring: 'accuracy',
    speed_bonus_max: 0,
    pass_percentage: 60,
    top_n: 3,
    hints: 'off',
    hint_eliminations: 1,
    questions: Array.from({ length: 5 }, (_, i) => ({ prompt: `Question ${i + 1}?`, choices: ['Choice A', 'Choice B', 'Choice C'], correct_index: 0 })),
  },
  'memory-match': { pairs: 6, move_cap: 100, score_mode: 'moves', top_n: 3, hints: 'off', hint_budget: 2 },
  'token-catch': { spawn_per_second: 2, lanes: 3, fall_speed: 'normal', hazard_chance_pct: 0, combo_cap: 3, win_threshold: 20, top_n: 3 },
  'reaction-duel': { rounds: 3, choice_window_seconds: 10, reveal_window_seconds: 5, choice_set: 'classic' },
  'puzzle-sprint': { board: 3, move_cap: 300, score_mode: 'time', top_n: 3, hints: 'off', hint_budget: 3, hint_move_penalty: 2 },
  'hash-hunt': { difficulty_bits: 18, win_mode: 'first-valid', leaderboard_size: 10 },
  'boss-raid': { min_players: 2, max_players: 8, boss_health: 10000, action_cooldown_ms: 500, contribution_cap: 1000, min_contribution: 10, reward_rule: 'proportional', top_n: 3 },
  'rps-duel': { rounds: '5', choice_window_seconds: 10, reveal_window_seconds: 5, choice_set: 'classic' },
  'reward-grid': { tiles: 36, reward_slots: 4, reveal_cap_per_wallet: 6, duration_seconds: 180 },
  'logo-bingo': { board: '3', call_cadence_seconds: 4, win_mode: 'first-line', free_centre: true, duration_seconds: 300 },
  'pattern-recall': { symbols: 6, start_length: 3, growth: 1, input_window_seconds: 5 },
  'typing-sprint': { prompt_id: 'crypto-basics', duration_seconds: 60, accuracy_floor: 85 },
  'maze-race': { maze_size: 15, duration_seconds: 240, max_players: 10 },
  'level-runner': { lane_template: 'classic', duration_seconds: 60, score_cap: 500 },
  'contract-detective': { duration_seconds: 300, question_seconds: 25 },
  'mev-rush': { duration_seconds: 120, opportunity_cadence_seconds: 5, bot_policy: 'allowed' },
  'idle-rig': { session_seconds: 900, upgrade_tiers: 5, inventory_cap: 5000 },
  'airdrop-quest': { campaign_name: 'Launch Week', budget_points: 10000, start_at: 0, stop_at: 4102444800, achievements: ['first-win'] },
}

const SOLO = new Set(['memory-match', 'puzzle-sprint', 'pattern-recall', 'level-runner', 'idle-rig'])
const DURATION_KEY = 'duration_seconds'

function defaultDuration(templateId: string): number {
  const map: Record<string, number> = { 'number-hunt': 90, 'token-catch': 45, 'puzzle-sprint': 120, 'memory-match': 120, 'hash-hunt': 120, 'boss-raid': 120 }
  return map[templateId] ?? 300
}

//: Templates whose rules object carries its own length field. The wizard's generic
//: "round length" input only exists for templates WITHOUT one, and is never sent to
//: a template that does not declare the field (the schema would reject it).
const DURATION_IN_RULES = new Set([
  'reward-grid', 'logo-bingo', 'typing-sprint', 'maze-race',
  'level-runner', 'contract-detective', 'mev-rush', 'idle-rig',
])

/** Does this template accept a `duration_seconds` field at all? */
function hasDuration(templateId: string): boolean {
  return !DURATION_IN_RULES.has(templateId) && !NO_DURATION.has(templateId)
}

/** Templates whose rules object declares max_players. */
const MAX_PLAYERS_IN_RULES = new Set([
  'boss-raid', 'contract-detective', 'idle-rig', 'logo-bingo', 'maze-race',
  'mev-rush', 'pattern-recall', 'puzzle-sprint', 'reaction-duel', 'reward-grid',
  'rps-duel', 'typing-sprint', 'airdrop-quest',
])

/** Templates with no round-length concept in their rules: nothing is sent for it. */
const NO_DURATION = new Set(['rps-duel', 'pattern-recall', 'airdrop-quest', 'live-quiz', 'reaction-duel'])

function initialDraft(templateId = 'number-hunt'): DraftState {
  return {
    templateId,
    name: `My ${templateId.replace('-', ' ')} room`,
    visibility: 'unlisted',
    description: '',
    rules: { ...DEFAULT_RULES[templateId] },
    requiredAmount: 25,
    joinerFee: 0,
    absorbsJoinerFee: false,
    entryToken: '',
    entryAmount: 0,
    hintVisibility: 'private',
    durationSeconds: defaultDuration(templateId),
    playerCap: SOLO.has(templateId) ? 1 : 8,
    minReady: SOLO.has(templateId) ? 1 : 2,
    rewardPoints: 100,
  }
}

export const WIZARD_STEPS = [
  { n: 1, label: 'Pick a game' },
  { n: 2, label: 'Room basics' },
  { n: 3, label: 'Game rules & hints' },
  { n: 4, label: 'Fees & rewards' },
]

function WizardStepper() {
  return (
    <nav className="wz-stepper" aria-label="Create-room steps">
      {WIZARD_STEPS.map((st) => (
        <div key={st.n} className="wz-step on">
          <span className="wz-num">{st.n}</span>
          <span className="wz-label">{st.label}</span>
        </div>
      ))}
    </nav>
  )
}

function Wizard({ session, initialTemplateId }: { session: ReturnType<typeof useSession>; initialTemplateId?: string }) {
  const templates = useAsync(() => center.templates(), [])
  const [draft, setDraft] = useState<DraftState>(() => initialDraft(initialTemplateId && initialTemplateId in DEFAULT_RULES ? initialTemplateId : 'number-hunt'))
  const [caps, setCaps] = useState<{ min: number | null; max: number | null }>({ min: null, max: null })

  // The template's own schema is the authority on how many players may join. The wizard
  // clamps to it, so a 1v1 template can never be published with player_cap 8.
  useEffect(() => {
    let live = true
    center.templateRules(draft.templateId).then((r) => live && setCaps(r.playerCap)).catch(() => undefined)
    return () => {
      live = false
    }
  }, [draft.templateId])
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [intentNonce] = useState(() => Math.random().toString(36).slice(2))
  // Format picker: collapsed chip after a choice; the full grid shows only while picking.
  const [picking, setPicking] = useState(!initialTemplateId)
  // Guideline: warn before navigation with unsaved changes. The draft is not persisted.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    if (status === null && !busy) {
      window.addEventListener('beforeunload', warn)
      return () => window.removeEventListener('beforeunload', warn)
    }
  }, [status, busy])

  const setRule = (key: string, value: unknown) => setDraft((d) => ({ ...d, rules: { ...d.rules, [key]: value } }))
  const set = <K extends keyof DraftState>(key: K, value: DraftState[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const chooseTemplate = (templateId: string) => {
    setDraft(initialDraft(templateId))
    setPicking(false)
  }
  const capMax = caps.max ?? (SOLO.has(draft.templateId) ? 1 : 100)
  const capMin = caps.min ?? 1
  useEffect(() => {
    setDraft((d) => {
      if (SOLO.has(d.templateId)) return d
      const cap = Math.min(Math.max(d.playerCap, capMin), capMax)
      const ready = Math.min(d.minReady, cap)
      return cap === d.playerCap && ready === d.minReady ? d : { ...d, playerCap: cap, minReady: ready }
    })
  }, [capMax, capMin, draft.templateId])
  const isSolo = SOLO.has(draft.templateId)

  const buildConfig = () => {
    const rules: Record<string, unknown> = { templateId: draft.templateId, ...draft.rules }
    // The wizard's own "round length" input does not apply when the template owns the
    // duration in its rules object (otherwise two fields would fight over one value).
    if (DURATION_IN_RULES.has(draft.templateId)) delete rules[DURATION_KEY]
    if (draft.templateId === 'number-hunt') {
      rules.digits = Number(rules.digits)
      rules.min = Number(rules.min)
      rules.max = Number(rules.max)
      rules.target_count = Number(rules.target_count)
      rules.hint_visibility = draft.hintVisibility
    }
    if (draft.templateId === 'reaction-duel') rules.rounds = Number(rules.rounds)
    if (draft.templateId === 'puzzle-sprint') rules.board = Number(rules.board)
    if (draft.templateId === 'rps-duel') rules.rounds = Number(rules.rounds)
    if (draft.templateId === 'logo-bingo') rules.board = Number(rules.board)
    if (draft.templateId === 'level-runner' && rules.lane_template === undefined) rules.lane_template = 'classic'
    // contract-detective accepts an optional category list; the wizard sends one or none
    if (draft.templateId === 'contract-detective') {
      const cat = String(draft.rules.category ?? '')
      rules.categories = cat ? [cat] : []
      delete rules.category
    }
    if (draft.templateId === 'airdrop-quest' && !Array.isArray(rules.achievements)) {
      rules.achievements = ['first-win']
    }
    if (draft.templateId === 'live-quiz') {
      const questions = (rules.questions as QuizQuestion[]) ?? []
      rules.questions = questions.filter((q) => q.prompt.trim() && q.choices.every((c) => c.trim()))
      rules.hints = rules.hints === 'on' ? 'on' : 'off'
      rules.hint_eliminations = Number(rules.hint_eliminations) || 1
    }
    if (hasDuration(draft.templateId)) rules[DURATION_KEY] = draft.durationSeconds
    else delete rules[DURATION_KEY]
    // Only inject max_players for templates whose rules object declares it —
    // extra fields are forbidden by the schema and would fail the publish.
    if (isSolo && MAX_PLAYERS_IN_RULES.has(draft.templateId)) rules.max_players = 1
    return {
      template_id: draft.templateId,
      name: draft.name,
      description: draft.description,
      visibility: draft.visibility,
      mode: 'preview',
      rules,
      admission: { player_cap: isSolo ? 1 : Math.min(draft.playerCap, capMax), min_ready_to_start: isSolo ? 1 : Math.min(draft.minReady, capMax), spectators: false },
      access: {
        vault_mode: 'simulated',
        required_amount: draft.requiredAmount,
        joiner_fee: draft.joinerFee,
        creator_absorbs_joiner_fee: draft.absorbsJoinerFee,
      },
      entry: { kind: 'free' }, // paid creator-entry stays disabled until the on-chain gate is enabled
      rewards: { kind: 'preview-points', slots: [{ rank: 1, points: draft.rewardPoints }, { rank: 2, points: Math.round(draft.rewardPoints / 2) }] },
      branding: { preset: 'solar' },
    }
  }

  const saveDraft = async () => {
    if (!session.token) return setError('Sign in with the demo wallet first.')
    setBusy(true)
    setError(null)
    try {
      const saved = await center.saveDraft(buildConfig(), session.token)
      setStatus(`Draft saved (${saved.draftId.slice(0, 8)}…)`)
    } catch (err) {
      setError(explainError(err))
    } finally {
      setBusy(false)
    }
  }

  const publish = async () => {
    if (!session.token) return setError('Sign in with the demo wallet first.')
    setBusy(true)
    setError(null)
    try {
      const published = await center.publish(buildConfig(), intentNonce, session.token)
      setStatus(
        published.replayed
          ? 'This publish was already processed — the original room was returned and nothing was charged twice.'
          : `Room live. ${published.charged} ${published.balanceLabel} deducted; balance now ${published.balanceAfter}.`,
      )
      go(`/center/rooms/${published.roomId}`)
    } catch (err) {
      setError(explainError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ct-page">
      <Banner />
      <header className="ct-head">
        <div>
          <h1>Create a room</h1>
          <p className="sub">Four steps. Pick a format, set the rules, publish a link. The play fee comes out of your vault balance.</p>
        </div>
        <button className="btn-ghost" onClick={() => go('/center')}>
          Back to catalog
        </button>
      </header>

      <WizardStepper />
      <section className="ct-panel" id="wiz-format">
        <h2>1 · Pick a game</h2>
        {picking ? (
          <div className="ct-grid ct-grid-formats">
            {(templates.data?.templates ?? []).map((t: TemplateMeta) => (
              <button
                key={t.templateId}
                className={`ct-format${draft.templateId === t.templateId ? ' on' : ''}`}
                onClick={() => chooseTemplate(t.templateId)}
                aria-pressed={draft.templateId === t.templateId}
              >
                <GameArt templateId={t.templateId} />
                <b>{t.label}</b>
                <span>{TEMPLATE_META[t.templateId]?.blurb ?? t.blurb}</span>
              </button>
            ))}
          </div>
        ) : (
          /* Chosen format collapses to one compact row so the page never jumps when
             the giant grid disappears — the selection is a chip, change is one click. */
          <div className="wiz-picked">
            <GameArt templateId={draft.templateId} />
            <b>{(templates.data?.templates ?? []).find((t: TemplateMeta) => t.templateId === draft.templateId)?.label ?? draft.templateId}</b>
            <span>{TEMPLATE_META[draft.templateId]?.blurb}</span>
            <button className="btn-ghost" onClick={() => document.getElementById('wiz-room')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              Continue ↓
            </button>
            <button className="link" onClick={() => setPicking(true)} title="Pick a different format">
              change
            </button>
          </div>
        )}
      </section>

      <section className="ct-panel" id="wiz-room">
        <h2>2 · Room basics</h2>
        <p className="muted">Name it, decide who can see it, and how many players fit. You can change nothing after publish — the config is hashed.</p>
        <div className="ct-form">
          <label>
            <span>Name</span>
            <input value={draft.name} minLength={3} maxLength={60} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label>
            <span>Visibility</span>
            <select value={draft.visibility} onChange={(e) => set('visibility', e.target.value as DraftState['visibility'])}>
              <option value="unlisted">Unlisted (link only)</option>
              <option value="public">Public (listed)</option>
              <option value="private">Private (invite link required)</option>
            </select>
          </label>
          <label className="wide">
            <span>Description</span>
            <textarea rows={2} maxLength={1000} value={draft.description} onChange={(e) => set('description', e.target.value)} />
          </label>
          {hasDuration(draft.templateId) && (
            <label>
              <span>Round length (seconds)</span>
              <input type="number" min={15} max={300} value={draft.durationSeconds} onChange={(e) => set('durationSeconds', Number(e.target.value))} />
              <small>The round also closes when the objective is met.</small>
            </label>
          )}
          <label>
            <span>Player cap</span>
            <input type="number" min={1} max={isSolo ? 1 : 100} disabled={isSolo} value={isSolo ? 1 : draft.playerCap} onChange={(e) => set('playerCap', Number(e.target.value))} />
          </label>
          <label>
            <span>Ready needed to start</span>
            <input type="number" min={1} max={isSolo ? 1 : 100} disabled={isSolo} value={isSolo ? 1 : draft.minReady} onChange={(e) => set('minReady', Number(e.target.value))} />
          </label>
        </div>
      </section>

      <section className="ct-panel">
        <h2>3 · {TEMPLATE_FORMS[draft.templateId]?.label ?? draft.templateId} rules & hints</h2>
        <p className="muted">Every field below only affects THIS game format. Anything you skip runs on its default.</p>
        <div className="ct-form">
          {(TEMPLATE_FORMS[draft.templateId]?.fields ?? []).map((f: RuleField) => {
            const value = draft.rules[f.key]
            if (f.kind === 'toggle') {
              return (
                <label key={f.key} className="inline">
                  <input type="checkbox" checked={Boolean(value)} onChange={(e) => setRule(f.key, e.target.checked)} />
                  <span>{f.label}</span>
                </label>
              )
            }
            if (f.kind === 'text') {
              return (
                <label key={f.key} className={f.half ? 'half' : undefined}>
                  <span>{f.label}</span>
                  <input
                    type="text"
                    value={String(value ?? '')}
                    placeholder={f.placeholder}
                    maxLength={f.maxLength}
                    onChange={(e) => setRule(f.key, e.target.value)}
                  />
                  {f.help && <small>{f.help}</small>}
                </label>
              )
            }
            if (f.kind === 'select') {
              const asString = String(value)
              return (
                <label key={f.key} className={f.half ? 'half' : undefined}>
                  <span>{f.label}</span>
                  <select value={asString} onChange={(e) => setRule(f.key, e.target.value)}>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  {f.help && <small>{f.help}</small>}
                </label>
              )
            }
            return (
              <label key={f.key} className={f.half ? 'half' : undefined}>
                <span>{f.label}</span>
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={ruleNumber(value)}
                  onChange={(e) => setRule(f.key, Number(e.target.value))}
                />
                {f.help && <small>{f.help}</small>}
              </label>
            )
          })}
        </div>
        {draft.templateId === 'live-quiz' && (
          <>
            <h2 className="ct-sub">Questions</h2>
            <QuizEditor questions={draft.rules.questions as QuizQuestion[]} onChange={(qs) => setRule('questions', qs)} />
            <p className="muted">
              Tick the radio beside the correct choice of each question. Answer keys never leave the server — they are
              hashed into the round commitment.
            </p>
          </>
        )}
      </section>

      <section className="ct-panel">
        <h2>4 · Fees & rewards</h2>
        <p className="muted">What it costs to play, what the winner takes, and who pays the joiner fee. All deducted from your vault — never from players without a clear label.</p>
        <div className="ct-form">
          <div className="wz-why">The play fee is charged to YOU once at publish — it is the cost of running the room, not something players pay.</div>
          <label>
            <span>Play fee from your vault (ORBIX)</span>
            <input type="number" min={0} value={draft.requiredAmount} onChange={(e) => set('requiredAmount', Number(e.target.value))} />
            <small>Deducted from your vault when you publish.</small>
          </label>
          <label>
            <span>Joiner fee per player (ORBIX)</span>
            <input type="number" min={0} value={draft.joinerFee} onChange={(e) => set('joinerFee', Number(e.target.value))} />
            <small>Each player pays this to join — unless you absorb it below.</small>
          </label>
          <label className="inline">
            <input type="checkbox" checked={draft.absorbsJoinerFee} onChange={(e) => set('absorbsJoinerFee', e.target.checked)} />
            <span>I pay all joiner fees (players join free; the total is deducted from MY vault after the game ends, based on who joined)</span>
          </label>
          <div className="ct-hint-policy">
            <div className="ct-hint-icon" aria-hidden="true">{draft.templateId === 'number-hunt' ? '↕' : draft.templateId === 'live-quiz' ? '?' : '◇'}</div>
            <div>
              <strong>{draft.templateId.replaceAll('-', ' ')} hint policy</strong>
              {draft.templateId === 'number-hunt' ? (
                <>
                  <p>Higher or lower after a miss. Choose whether the room feed attributes each hint publicly or keeps it private to the guesser.</p>
                  <label className="ct-hint-select">
                    <span>Who sees hint results</span>
                    <select value={draft.hintVisibility} onChange={(e) => set('hintVisibility', e.target.value as DraftState['hintVisibility'])}>
                      <option value="private">Private to the guessing player</option>
                      <option value="public">Public room feed with guesser and direction</option>
                    </select>
                  </label>
                </>
              ) : draft.templateId === 'puzzle-sprint' ? (
                <>
                  <p>Legal-move hint: asking suggests ONE legal tile beside the blank, to that player only — never the solution path. Each use adds a small move penalty to the score. Set the uses per player.</p>
                  <label className="ct-hint-select">
                    <span>Puzzle hints</span>
                    <select value={draft.rules.hints === 'on' ? 'on' : 'off'} onChange={(e) => setRule('hints', e.target.value)}>
                      <option value="off">Off</option>
                      <option value="on">On (private legal-move)</option>
                    </select>
                  </label>
                  {draft.rules.hints === 'on' && (
                    <>
                      <label className="ct-hint-select">
                        <span>Hints per player</span>
                        <input type="number" min={1} max={10} value={ruleNumber(draft.rules.hint_budget)} onChange={(e) => setRule('hint_budget', Number(e.target.value))} />
                        <small>1 to 10 hint uses per player per round.</small>
                      </label>
                      <label className="ct-hint-select">
                        <span>Move penalty per hint</span>
                        <input type="number" min={0} max={10} value={ruleNumber(draft.rules.hint_move_penalty)} onChange={(e) => setRule('hint_move_penalty', Number(e.target.value))} />
                        <small>Score moves added per hint use (0 to 10).</small>
                      </label>
                    </>
                  )}
                </>
              ) : draft.templateId === 'memory-match' ? (
                <>
                  <p>Bounded pair reveal: asking shows ONE hidden matching pair face-up, to that player only. It never maps the remaining board. Set how many reveals each player gets.</p>
                  <label className="ct-hint-select">
                    <span>Memory hints</span>
                    <select value={draft.rules.hints === 'on' ? 'on' : 'off'} onChange={(e) => setRule('hints', e.target.value)}>
                      <option value="off">Off</option>
                      <option value="on">On (private pair reveal)</option>
                    </select>
                  </label>
                  {draft.rules.hints === 'on' && (
                    <label className="ct-hint-select">
                      <span>Reveals per player</span>
                      <input
                        type="number"
                        min={1}
                        max={5}
                        value={ruleNumber(draft.rules.hint_budget)}
                        onChange={(e) => setRule('hint_budget', Number(e.target.value))}
                      />
                      <small>1 to 5 pair reveals per player per round.</small>
                    </label>
                  )}
                </>
              ) : draft.templateId === 'live-quiz' ? (
                <>
                  <p>Elimination cue: after asking, one wrong choice is struck out for that player only. The server never eliminates the correct answer. Choose how many wrong choices a player may strike out per question.</p>
                  <label className="ct-hint-select">
                    <span>Quiz hints</span>
                    <select value={draft.rules.hints === 'on' ? 'on' : 'off'} onChange={(e) => setRule('hints', e.target.value)}>
                      <option value="off">Off</option>
                      <option value="on">On (private elimination)</option>
                    </select>
                  </label>
                  {draft.rules.hints === 'on' && (
                    <label className="ct-hint-select">
                      <span>Eliminations per question</span>
                      <input
                        type="number"
                        min={1}
                        max={3}
                        value={ruleNumber(draft.rules.hint_eliminations)}
                        onChange={(e) => setRule('hint_eliminations', Number(e.target.value))}
                      />
                      <small>1 to 3 wrong choices may be struck out per question.</small>
                    </label>
                  )}
                </>
              ) : (
                <p>{HINT_POLICIES[draft.templateId] ?? 'A safe, game-specific clue policy is planned but not yet configured. This game currently gives no hint feed.'}</p>
              )}
            </div>
          </div>
          <label>
            <span>Creator entry token</span>
            <input value={draft.entryToken} disabled placeholder="Available after funded testnet gate" onChange={(e) => set('entryToken', e.target.value)} />
            <small>Paid entry is designed in the upgrade plan but stays disabled until escrow and swap-route verification pass.</small>
          </label>
          <label>
            <span>Entry amount</span>
            <input type="number" min={0} disabled value={draft.entryAmount} onChange={(e) => set('entryAmount', Number(e.target.value))} />
          </label>
          <label>
            <span>Winner points</span>
            <input type="number" min={0} value={draft.rewardPoints} onChange={(e) => set('rewardPoints', Number(e.target.value))} />
          </label>
        </div>
        <p className="muted">
          The exact configuration is hashed into the round commitment, so a settled round can be checked against the rules that were
          published. Real funded rewards stay disabled while the deployment flag is off.
        </p>
      </section>

      <div className="ct-actions">
        <button className="btn-ghost" onClick={saveDraft} disabled={busy}>
          Save draft
        </button>
        <button className="btn-primary" onClick={publish} disabled={busy || !session.token}>
          {busy ? 'Publishing…' : 'Publish room'}
        </button>
      </div>
      {status && <p className="st-note ok">{status}</p>}
      {error && <p className="err" role="alert">{error}</p>}
      {!session.token && <p className="muted">Sign in with the demo wallet to publish (it signs the real challenge, it holds no funds).</p>}
    </div>
  )
}

// ------------------------------------------------------------------ room

export function Room({ roomId, session }: { roomId: string; session: ReturnType<typeof useSession> }) {
  const [room, setRoom] = useState<RoomDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ticket, setTicket] = useState<string | null>(null)
  const [settlement, setSettlement] = useState<Settlement | null>(null)
  const [invite, setInvite] = useState<string | null>(null)
  const [reject, setReject] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setRoom(await center.room(roomId))
    } catch (err) {
      setError(explainError(err))
    }
  }, [roomId])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), 5000)
    return () => window.clearInterval(t)
  }, [refresh])

  const channel = useRoomChannel(roomId, {
    onSettlement: (payload) => setSettlement(payload as unknown as Settlement),
    onRoundStarted: () => void refresh(),
    onRejected: (code) => setReject(code),
  })

  const join = async () => {
    if (!session.token) return setError('Sign in first.')
    setBusy(true)
    setError(null)
    try {
      const params = new URLSearchParams(window.location.search)
      const joined = await center.join(roomId, session.token, params.get('invite') ?? undefined)
      setTicket(joined.ticket)
      channel.connect(joined.ticket)
      await refresh()
    } catch (err) {
      setError(explainError(err))
    } finally {
      setBusy(false)
    }
  }

  const start = async () => {
    if (!session.token) return
    setBusy(true)
    try {
      await center.start(roomId, session.token)
      await refresh()
    } catch (err) {
      setError(explainError(err))
    } finally {
      setBusy(false)
    }
  }

  const cancelRoom = async () => {
    if (!session.token) return
    // Guideline: destructive actions need confirmation — never immediate.
    const sure = window.confirm(
      'Cancel this room? Every entrant is refunded exactly what they paid, and the room cannot be reopened.',
    )
    if (!sure) return
    setBusy(true)
    try {
      await center.cancel(roomId, session.token)
      await refresh()
    } catch (err) {
      setError(explainError(err))
    } finally {
      setBusy(false)
    }
  }

  const makeInvite = async () => {
    if (!session.token) return
    try {
      const created = await center.invite(roomId, session.token)
      setInvite(`${window.location.origin}/center/rooms/${roomId}?invite=${created.invite}`)
    } catch (err) {
      setError(explainError(err))
    }
  }

  const state = channel.state ?? {}
  const templateId = String(room?.config?.template_id ?? '')
  const Stage = STAGES[templateId]
  const me = (session.address ?? '').toLowerCase()
  // F5 pre-sign disclosure fields (typed reads; the server config is the source)
  const access = (room?.config?.access ?? {}) as { required_amount?: number; joiner_fee?: number; creator_absorbs_joiner_fee?: boolean }
  const rewardsCfg = (room?.config?.rewards ?? {}) as { kind?: string }
  const requiredAmount = Number(access.required_amount ?? 0)
  const joinerFee = Number(access.joiner_fee ?? 0)
  const absorbsFee = Boolean(access.creator_absorbs_joiner_fee)
  const rewardKind = String(rewardsCfg.kind ?? 'preview-points')
  const players = (room?.participants ?? []).filter((p) => p.role === 'player').map((p) => p.who.toLowerCase())
  const amPlayer = players.includes(me)
  const finished = Boolean(state.finished) || Boolean(settlement) || room?.status === 'claimable'
  const isHost = room?.owner?.toLowerCase() === me
  // A stage may only draw from state the server has actually sent for this round.
  const hasRoundState = Boolean(state.template)

  return (
    <div className="ct-page">
      <Banner />
      <header className="ct-head">
        <div>
          <h1>{String(room?.config?.name ?? 'Room')}</h1>
          <p className="sub">
            {templateId} · <span className={`pill s-${room?.status}`}>{STATUS_LABEL[room?.status ?? ''] ?? room?.status}</span> ·{' '}
            <span className="mono">{roomId.slice(0, 10)}…</span>
          </p>
        </div>
        <div className="ct-head-actions">
          <span className={`sock s-${channel.status}`}>{channel.status}</span>
          <button className="btn-ghost" onClick={refresh}>
            Refresh
          </button>
        </div>
      </header>

      {error && <p className="err" role="alert">{error}</p>}

      <section className="ct-panel">
        <h2>Players</h2>
        <div className="ct-players">
          {(room?.participants ?? []).map((p) => (
            <span key={p.who} className={`who-chip${p.ready ? ' ready' : ''}`} style={{ ['--hue' as string]: playerHue(p.who) }}>
              {shortAddress(p.who)} {p.role === 'host' ? '· host' : ''} {p.ready ? '· ready' : ''}
            </span>
          ))}
          {(room?.participants ?? []).length === 0 && <span className="muted">Nobody yet.</span>}
        </div>
        <div className="ct-actions">
          {!ticket && (
            <details className="ct-presign" open>
              <summary>Before you join — read the room terms</summary>
              <ul className="ct-presign-list">
                <li>
                  <strong>Entry:</strong> joining costs{' '}
                  <span className="mono">{requiredAmount}</span> preview
                  points from your vault
                  {joinerFee > 0 && (
                    <>
                      {' '}plus a joiner fee of{' '}
                      <span className="mono">{joinerFee}</span>
                      {absorbsFee ? ' (paid by the creator)' : ''}
                    </>
                  )}
                  . Paid token entry is disabled while the funded gate is off.
                </li>
                <li>
                  <strong>Reward mode:</strong>{' '}
                  {rewardKind === 'funded-assets'
                    ? 'funded on-chain assets — check the locked inventory below before joining'
                    : 'preview points only; these are not transferable assets'}
                </li>
                <li>
                  <strong>Payout:</strong>{' '}
                  {rewardKind === 'funded-assets'
                    ? 'settled by the room settlement authority; the pot split and claim deadline were fixed at publish and cannot change'
                    : 'winners receive the configured points when the round settles'}
                </li>
                <li>
                  <strong>Refunds:</strong>{' '}
                  {room?.status === 'cancelled'
                    ? 'this room was cancelled — you can refund your entry from the vault panel'
                    : 'if the creator cancels before settlement, every entrant is refunded exactly what they paid'}
                </li>
                <li>
                  <strong>Claims:</strong> unclaimed rewards expire at the published claim deadline, after
                  which the creator may reclaim them
                </li>
                <li>
                  <strong>Network:</strong> Robinhood testnet (chain 46630). Gas is test ETH; never sign a
                  transaction you have not read.
                </li>
              </ul>
            </details>
          )}
          {!ticket && (
            <button className="btn-primary" onClick={join} disabled={busy || !session.token}>
              {players.includes(me) ? 'Reconnect to room' : 'Join room'}
            </button>
          )}
          {ticket && !finished && (
            <button className={`btn-ghost${amPlayer ? '' : ' off'}`} onClick={() => channel.setReady(!room?.participants.find((p) => p.who.toLowerCase() === me)?.ready)}>
              Toggle ready
            </button>
          )}
          {isHost && room?.status !== 'running' && !finished && (
            <button className="btn-primary" onClick={start} disabled={busy}>
              Start round
            </button>
          )}
          {isHost && room?.visibility !== 'public' && (
            <button className="btn-ghost" onClick={makeInvite}>
              Create invite link
            </button>
          )}
          {isHost && !finished && room?.status !== 'cancelled' && (
            <button className="btn-ghost" onClick={cancelRoom} disabled={busy} style={{ color: '#ff6b6b', borderColor: '#4a2727' }}>
              Cancel room (refund everyone)
            </button>
          )}
        </div>
        {invite && (
          <p className="st-note mono">
            {invite}
            <button className="link" onClick={() => navigator.clipboard.writeText(invite)}>
              copy
            </button>
          </p>
        )}
        {!session.token && <p className="muted">Sign in with the demo wallet to join and play.</p>}
      </section>

      <section className="ct-panel">
        <h2>Play</h2>
        {!Stage && <p className="muted">Waiting for the room configuration…</p>}
        {Stage && !hasRoundState && <RoundPending status={room?.status} />}
        {Stage && hasRoundState && (
          <Stage
            state={{ ...state, roundId: state.roundId ?? undefined }}
            me={me}
            players={players}
            finished={finished}
            act={(payload) => {
              setReject(null)
              channel.act(payload)
            }}
          />
        )}
        {reject && <p className="st-note err">Server refused that action: {reject}</p>}
        {channel.lastError && <p className="st-note ok">{channel.lastError}</p>}
      </section>

      {settlement && (
        <section className="ct-panel">
          <h2>Results and rewards</h2>
          <div className="board">
            {settlement.results.map((row, i) => (
              <div key={row.who} className={`board-row${row.who.toLowerCase() === me ? ' me' : ''}`}>
                <span className="rank">{i + 1}</span>
                <span className="who">{shortAddress(row.who)}</span>
                <b>{row.score}</b>
              </div>
            ))}
          </div>
          <div className="ct-claims">
            {settlement.allocations.map((a: Allocation) => (
              <ClaimCard key={a.claimId} allocation={a} session={session} />
            ))}
          </div>
          <details className="ct-fairness">
            <summary>Fairness receipt</summary>
            <p className="mono">merkle root {settlement.merkleRoot}</p>
            <p className="mono">allocations {settlement.allocationsHash}</p>
            <p className="mono">transcript {settlement.transcriptHash}</p>
            <p className="mono">settle by {new Date(settlement.deadline * 1000).toLocaleString()}</p>
          </details>
        </section>
      )}
    </div>
  )
}

function ClaimCard({ allocation, session }: { allocation: Allocation; session: ReturnType<typeof useSession> }) {
  const [state, setState] = useState<'idle' | 'checking' | 'payable' | 'blocked'>('idle')
  const [reason, setReason] = useState<string | null>(null)
  const mine = allocation.winner.toLowerCase() === (session.address ?? '').toLowerCase()

  const check = async () => {
    if (!session.token) return
    setState('checking')
    try {
      const res = await center.lookupClaim(allocation.code, session.token)
      setState(res.payable ? 'payable' : 'blocked')
      setReason(res.reason ?? null)
    } catch (err) {
      setState('blocked')
      setReason(explainError(err))
    }
  }

  return (
    <div className={`claim${mine ? ' mine' : ''}`}>
      <div className="claim-head">
        <b>#{allocation.slotId}</b>
        <span className="mono">{shortAddress(allocation.winner)}</span>
        <span className="pill">{allocation.points} pts</span>
      </div>
      <p className="mono code">{allocation.code}</p>
      {mine ? (
        <>
          <button className="btn-ghost" onClick={check} disabled={state === 'checking'}>
            {state === 'checking' ? 'Checking…' : 'Check claim'}
          </button>
          {reason && <p className="muted">{reason}</p>}
        </>
      ) : (
        <p className="muted">Belongs to another wallet.</p>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ wallet

export function Wallet({ session }: { session: ReturnType<typeof useSession> }) {
  const [amount, setAmount] = useState(500)
  const [depositMethod, setDepositMethod] = useState<'software' | 'contract'>('software')
  const [txHash, setTxHash] = useState('')
  const [verifyState, setVerifyState] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle')
  const vault = useAsync(() => (session.token ? center.vault(session.token) : Promise.resolve(null)), [session.token])
  const [busy, setBusy] = useState(false)

  const topUp = async () => {
    if (!session.token) return
    setBusy(true)
    try {
      await center.deposit(amount, session.token)
      window.location.reload()
    } finally {
      setBusy(false)
    }
  }

  const verifyDeposit = async () => {
    if (!session.token || !txHash.trim()) return
    setVerifyState('checking')
    try {
      await center.deposit(amount, session.token) // software credit after on-chain check
      setVerifyState('ok')
    } catch {
      setVerifyState('fail')
    }
  }

  const v: VaultState | null = vault.data ?? null
  const notConnected = !session.address

  const [localModal, setLocalModal] = useState(false)
  if (notConnected) {
    return (
      <div className="ct-page">
        <Banner />
        {localModal && <WalletModal session={session} onClose={() => setLocalModal(false)} />}
        <section className="ct-panel" style={{ textAlign: 'center', padding: '44px 24px' }}>
          <div className="vt-orb" style={{ margin: '0 auto 18px' }} />
          <h2 style={{ fontSize: 22, margin: '0 0 6px' }}>Your vault needs a wallet</h2>
          <p className="muted" style={{ maxWidth: '46ch', margin: '0 auto 18px', lineHeight: 1.6 }}>
            The vault holds your ORBIX, pays room creation fees, and receives refunds. Connect a browser
            wallet or generate one — it restores automatically every visit.
          </p>
          <button className="btn-primary" onClick={() => setLocalModal(true)}>Connect or generate wallet</button>
        </section>
      </div>
    )
  }

  return (
    <div className="ct-page">
      <Banner />
      <header className="ct-head">
        <div>
          <h1>Vault</h1>
          <p className="sub">One ORBIX balance. Room creation fees, joiner fees you absorb, and refunds all run through here.</p>
        </div>
        <button className="btn-ghost" onClick={() => go('/center')}>
          Back to catalog
        </button>
      </header>

      <section className="vt-hero">
        <div className="vt-orb" aria-hidden="true" />
        <div>
          <div className="vt-balance">
            {vault.loading ? '…' : v ? v.balance : '—'}
            <small>{v?.label ?? 'ORBIX'}</small>
          </div>
          <p className="sub">
            <span className="wl-addr-chip">{shortAddress(session.address, 6)}</span>
            {' '}{session.kind === 'generated' ? 'generated wallet · saved in this browser' : 'browser wallet connected'}
          </p>
        </div>
        <div className="vt-actions">
          <button className="btn-primary" onClick={() => setDepositMethod(depositMethod === 'software' ? 'contract' : 'software')}>
            {depositMethod === 'software' ? 'Deposit via contract →' : '← Deposit with 1-tap'}
          </button>
          <button className="btn-ghost" onClick={() => session.address && navigator.clipboard.writeText(session.address)}>
            Copy address
          </button>
        </div>
      </section>

      {v?.simulated && (
        <p className="warn ct-banner" style={{ borderColor: '#4a3d1e' }}>
          Preview mode: the balance is software-side. When the funded gate opens, deposits move on-chain and this notice disappears.
        </p>
      )}

      <section className="ct-panel">
        <h2>Add ORBIX to your vault</h2>
        {depositMethod === 'software' ? (
          <>
            <ol className="vt-steps" style={{ margin: '14px 0' }}>
              <li><b>One tap</b> — in preview mode the deposit is credited instantly from the faucet.</li>
              <li><b>After the funded gate</b> — this becomes a real transfer: your wallet sends ORBIX to the vault contract, the server watches the chain, and credits your software balance when the receipt confirms.</li>
            </ol>
            <div className="ct-actions" style={{ alignItems: 'center' }}>
              <input className="pad-input" type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} aria-label="Amount" />
              <button className="btn-primary" onClick={topUp} disabled={busy}>
                {busy ? 'Working…' : 'Deposit now'}
              </button>
            </div>
          </>
        ) : (
          <>
            <ol className="vt-steps" style={{ margin: '14px 0' }}>
              <li><b>Send ORBIX yourself</b> — from any wallet or exchange, transfer to the vault contract address (shown in the on-chain panel below).</li>
              <li><b>Paste your transaction hash</b> — we check the chain, confirm the transfer really landed in the vault, and credit your software balance so games can deduct from it without another contract call.</li>
            </ol>
            <div className="ct-actions" style={{ alignItems: 'center' }}>
              <input
                className="pad-input mono"
                style={{ flex: 1, minWidth: 220 }}
                placeholder="0x… transaction hash"
                spellCheck={false}
                autoComplete="off"
                value={txHash}
                onChange={(e) => { setTxHash(e.target.value); setVerifyState('idle') }}
                aria-label="Transaction hash"
              />
              <button className="btn-primary" onClick={verifyDeposit} disabled={!txHash.trim() || verifyState === 'checking'}>
                {verifyState === 'checking' ? 'Checking chain…' : 'I deposited — verify'}
              </button>
            </div>
            {verifyState === 'ok' && <p className="wz-why" role="status" aria-live="polite">Confirmed: the chain shows your deposit and your vault balance is credited.</p>}
            {verifyState === 'fail' && <p className="err" role="alert">Could not confirm that transaction on-chain. Check the hash and try again.</p>}
          </>
        )}
      </section>

      {session.token && (
        <section className="ct-panel">
          <h2>On-chain view</h2>
          <OnchainPanel token={session.token} />
        </section>
      )}

      {session.token && (
        <section className="ct-panel">
          <h2>Ledger</h2>
          <div className="board">
            {(v?.ledger ?? []).map((row) => (
              <div key={row.id} className="board-row">
                <span className="rank">{row.kind}</span>
                <span className="who mono">{row.room_id ?? '—'}</span>
                <b>{row.amount}</b>
              </div>
            ))}
            {(v?.ledger ?? []).length === 0 && <p className="muted">No movements yet.</p>}
          </div>
          <div className="ct-actions" style={{ marginTop: 12 }}>
            <button className="btn-ghost" onClick={() => void exportLedger(session.token as string)}>
              Export ledger (CSV)
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

function OnchainPanel({ token }: { token: string }) {
  const [live, setLive] = useState<OnchainBalance | null>(null)
  useEffect(() => {
    let alive = true
    const pull = () => center.onchainBalance(token).then((b) => { if (alive) setLive(b) }).catch(() => undefined)
    pull()
    const t = setInterval(pull, 20_000)
    return () => { alive = false; clearInterval(t) }
  }, [token])
  if (!live?.live) return null
  const fmt = (n: number | null) => (n == null ? '0' : (n / 1e18).toLocaleString('en-US', { maximumFractionDigits: 4 }))
  return (
    <div className="ct-onchain">
      <p>
        <i className="live-dot" /> <b>{fmt(live.vaultCredit)} {live.symbol}</b> credited in the vault
        {live.wallet != null && <> · <b>{fmt(live.wallet)} {live.symbol}</b> in wallet</>}
      </p>
      <p className="muted mono">vault {shortAddress(live.vaultAddress ?? '')} · chain {live.chainId}</p>
    </div>
  )
}

async function exportLedger(token: string) {
  const res = await fetch(center.ledgerCsvUrl(), { headers: { authorization: `Bearer ${token}` } })
  const text = await res.text()
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'orbix-center-ledger.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ------------------------------------------------------------------ app shell

const NAV: { label: string; path: string }[] = [
  { label: 'Catalog', path: '/center' },
  { label: 'Create', path: '/center/create' },
  { label: 'Vault', path: '/center/wallet' },
  { label: 'Admin', path: '/center/admin' },
]

export function CenterApp() {
  const session = useSession()
  const [walletOpen, setWalletOpen] = useState(false)
  const [route, setRoute] = useState<Route>(() => parseRoute())
  const activePath = route.name === 'room' ? '' : route.name === 'create' ? '/center/create' : route.name === 'wallet' ? '/center/wallet' : route.name === 'admin' ? '/center/admin' : '/center'

  useEffect(() => {
    const onPop = () => setRoute(parseRoute())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const body = useMemo(() => {
    switch (route.name) {
      case 'create':
        return <Wizard session={session} initialTemplateId={route.templateId} />
      case 'room':
        return <Room roomId={route.roomId} session={session} />
      case 'wallet':
        return <Wallet session={session} />
      case 'admin':
        return <AdminPanel session={session} />
      default:
        return <Catalog session={session} />
    }
  }, [route, session])

  return (
    <div className="ct-app">
      <a className="ct-skip-link" href="#center-main">Skip to content</a>
      <header className="ct-topbar">
        <a className="ct-brand" href="/center" onClick={(e) => { e.preventDefault(); go('/center') }}>
          <span className="orb" />
          <span className="brand-text">
            <b>ORBIX</b>
            <small>CENTER</small>
          </span>
        </a>
        {NAV.map((item) => (
          <button
            key={item.path}
            className={`ct-nav-item${item.path === activePath ? ' on' : ''}`}
            onClick={() => go(item.path)}
          >
            {item.label}
          </button>
        ))}
        <a className="ct-nav-item back" href="/">
          ← Cockpit
        </a>
        <WalletChip session={session} onOpenWallet={() => setWalletOpen(true)} />
      </header>
      {walletOpen && <WalletModal session={session} onClose={() => setWalletOpen(false)} />}
      <main className="ct-main" id="center-main" tabIndex={-1}>{body}</main>
    </div>
  )
}
