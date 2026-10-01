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
import { center, explainError, type Allocation, type RoomDetail, type RoomSummary, type Settlement, type TemplateMeta, type VaultState } from './api'
import { playerHue, shortAddress, useSession } from './session'
import { useRoomChannel } from './ws'
import './center.css'

type Route =
  | { name: 'catalog' }
  | { name: 'create'; templateId?: string }
  | { name: 'room'; roomId: string }
  | { name: 'wallet' }

function parseRoute(): Route {
  const path = window.location.pathname.replace(/\/+$/, '')
  const parts = path.split('/').filter(Boolean)
  if (parts[1] === 'create') return { name: 'create', templateId: parts[2] ?? new URLSearchParams(window.location.search).get('template') ?? undefined }
  if (parts[1] === 'rooms' && parts[2]) return { name: 'room', roomId: parts[2] }
  if (parts[1] === 'wallet') return { name: 'wallet' }
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
    <div className="ct-banner">
      <strong>Preview build.</strong> Rooms run on our server, vault balances are simulated, and no real funds move.
      Rewards appear as points with a claim code until the token and funded-escrow flags are switched on.
    </div>
  )
}

function WalletChip({ session }: { session: ReturnType<typeof useSession> }) {
  const vault = useAsync(
    () => (session.token ? center.vault(session.token) : Promise.resolve(null)),
    [session.token],
  )
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(session.address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }).catch(() => undefined)
  }
  return (
    <div className="ct-wallet" title={session.address}>
      <span className={`dot${session.token ? '' : ' off'}`} />
      <button className="ct-wallet-addr mono" onClick={copy} title="copy address">
        {shortAddress(session.address)}
        {copied ? ' ✓' : ''}
      </button>
      <span className="ct-wallet-bal">
        {vault.data ? `${vault.data.balance} ${vault.data.label}` : session.token ? '…' : '—'}
      </span>
      {session.token ? (
        <button className="link" onClick={session.signOut}>sign out</button>
      ) : (
        <button className="ct-wallet-connect" onClick={session.signIn} disabled={session.signingIn}>
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
        <div className="ct-hero-copy"><span className="ct-kicker">ORBITAL PLAYGROUND · CENTER</span><h1>Make a room<br/><i>worth joining.</i></h1><p className="sub">Create a game, share one link, and watch the room come alive. Center is in preview: play is real-time, balances and rewards are simulated.</p><div className="ct-hero-actions"><button className="btn-primary" onClick={() => go('/center/create')}>Create a room <span aria-hidden>↗</span></button><button className="btn-ghost" onClick={() => document.querySelector('.ct-sub')?.scrollIntoView({ behavior: 'smooth' })}>Browse formats <span aria-hidden>↓</span></button></div><div className="ct-hero-meta"><span><i className="live-dot"/> Rooms update live</span><span>19 formats ready</span></div></div>
        <div className="ct-hero-orbit" aria-hidden="true"><span className="ct-orbit-label">CENTER / 01</span><span className="ct-orbit-ring ring-a"/><span className="ct-orbit-ring ring-b"/><span className="ct-orbit-core">C</span><span className="ct-orbit-dot dot-a"/><span className="ct-orbit-dot dot-b"/></div>
      </section>
      <div className="ct-signal-row"><span><b>19</b> game formats</span><span><b>LIVE</b> room play</span><span><b>0</b> funded rewards today</span></div>
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
          <article key={t.templateId} className={`ct-card t-${t.templateId}`}>
            <GameArt templateId={t.templateId} />
            <div className="ct-card-body">
              <div className="ct-card-top">
                <h3>{t.label}</h3>
                <span className="ct-card-kind">{t.multiplayer ? 'MP' : 'SOLO'}</span>
              </div>
              <p>{TEMPLATE_META[t.templateId]?.blurb ?? t.blurb}</p>
              <div className="ct-tags">
                <span>{t.modes}</span>
                <span>{t.multiplayer ? 'multiplayer' : 'solo'}</span>
                <span className="tag-preview">{t.availability}</span>
              </div>
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

const DEFAULT_RULES: Record<string, Record<string, unknown>> = {
  'number-hunt': { digits: 4, min: 1111, max: 9999, guess_budget: 10, hints: 'on', target_count: 1, win_mode: 'first-hit', guess_cooldown_ms: 500 },
  'live-quiz': {
    question_seconds: 15,
    scoring: 'accuracy',
    speed_bonus_max: 0,
    pass_percentage: 60,
    top_n: 3,
    questions: Array.from({ length: 5 }, (_, i) => ({ prompt: `Question ${i + 1}?`, choices: ['Choice A', 'Choice B', 'Choice C'], correct_index: 0 })),
  },
  'memory-match': { pairs: 6, move_cap: 100, score_mode: 'moves', top_n: 3 },
  'token-catch': { spawn_per_second: 2, lanes: 3, fall_speed: 'normal', hazard_chance_pct: 0, combo_cap: 3, win_threshold: 20, top_n: 3 },
  'reaction-duel': { rounds: 3, choice_window_seconds: 10, reveal_window_seconds: 5, choice_set: 'classic' },
  'puzzle-sprint': { board: 3, move_cap: 300, score_mode: 'time', top_n: 3 },
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

export function Wizard({ session, initialTemplateId }: { session: ReturnType<typeof useSession>; initialTemplateId?: string }) {
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
          <p className="sub">Pick a format, set the rules, publish a link. The play fee comes out of your vault balance.</p>
        </div>
        <button className="btn-ghost" onClick={() => go('/center')}>
          Back to catalog
        </button>
      </header>

      <section className="ct-panel" id="wiz-format">
        <h2>1 · Format</h2>
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
        <h2>2 · Room</h2>
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
        <h2>3 · {TEMPLATE_FORMS[draft.templateId]?.label ?? draft.templateId} settings</h2>
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
        <h2>4 · Vault and rewards (preview points only)</h2>
        <div className="ct-form">
          <label>
            <span>Play fee from your vault</span>
            <input type="number" min={0} value={draft.requiredAmount} onChange={(e) => set('requiredAmount', Number(e.target.value))} />
          </label>
          <label>
            <span>Joiner fee</span>
            <input type="number" min={0} value={draft.joinerFee} onChange={(e) => set('joinerFee', Number(e.target.value))} />
          </label>
          <label className="inline">
            <input type="checkbox" checked={draft.absorbsJoinerFee} onChange={(e) => set('absorbsJoinerFee', e.target.checked)} />
            <span>I absorb the joiner fee (players join free; it comes from my balance)</span>
          </label>
          <label>
            <span>Hint feed</span>
            <select value={draft.hintVisibility} onChange={(e) => set('hintVisibility', e.target.value as DraftState['hintVisibility'])}>
              <option value="private">Private — only the guessing player</option>
              <option value="public">Public — room feed shows higher/lower</option>
            </select>
            <small>Number Hunt only for now; other formats get their own safe hint method in the upgrade pass.</small>
          </label>
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
      {error && <p className="err">{error}</p>}
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
  const me = session.address.toLowerCase()
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

      {error && <p className="err">{error}</p>}

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
  const mine = allocation.winner.toLowerCase() === session.address.toLowerCase()

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

  const v: VaultState | null = vault.data ?? null

  return (
    <div className="ct-page">
      <Banner />
      <header className="ct-head">
        <div>
          <h1>Vault</h1>
          <p className="sub">One balance. Every room you publish is paid for from here, deducted once per publication.</p>
        </div>
        <button className="btn-ghost" onClick={() => go('/center')}>
          Back to catalog
        </button>
      </header>

      <section className="ct-panel">
        <h2>Demo wallet</h2>
        <p className="mono">{session.address}</p>
        <p className="muted">
          This key lives in your browser and signs the real sign-in challenge. It holds no funds — the balance below is simulated while
          the vault is in preview mode.
        </p>
        <div className="ct-actions">
          <button className="btn-ghost" onClick={session.reset}>
            New demo wallet
          </button>
          <button
            className="btn-ghost"
            onClick={() => navigator.clipboard.writeText(session.address)}
          >
            Copy address
          </button>
        </div>
      </section>

      {!session.token && <p className="muted">Sign in to see your vault.</p>}

      {session.token && (
        <>
          <section className="ct-panel">
            <h2>Balance</h2>
            {vault.loading && <p className="muted">Loading…</p>}
            {v && (
              <>
                <p className="big">
                  {v.balance} <span className="muted">{v.label}</span>
                </p>
                {v.simulated && <p className="warn">Simulated balance — no real tokens are held or moved on this deployment.</p>}
                <div className="ct-actions">
                  <input className="pad-input" type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
                  <button className="btn-primary" onClick={topUp} disabled={busy || !v.simulated}>
                    {v.simulated ? 'Add simulated balance' : 'Deposit on-chain'}
                  </button>
                  <button className="btn-ghost" onClick={() => void exportLedger(session.token as string)}>
                    Export ledger (CSV)
                  </button>
                </div>
              </>
            )}
          </section>

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
          </section>
        </>
      )}
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
]

export function CenterApp() {
  const session = useSession()
  const [route, setRoute] = useState<Route>(() => parseRoute())
  const activePath = route.name === 'room' ? '' : route.name === 'create' ? '/center/create' : route.name === 'wallet' ? '/center/wallet' : '/center'

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
      default:
        return <Catalog session={session} />
    }
  }, [route, session])

  return (
    <div className="ct-app">
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
        <WalletChip session={session} />
      </header>
      <main className="ct-main">{body}</main>
    </div>
  )
}
