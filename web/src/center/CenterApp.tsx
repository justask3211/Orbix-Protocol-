// Orbix Center — the creator game/quiz platform inside orbixcore.fun.
//
// Routes (hash-free, plain paths so the existing cockpit router can delegate to us):
//   /center                 catalog + live rooms
//   /center/create          the creator wizard
//   /center/rooms/:roomId   lobby, live play, results and reward codes
//   /center/wallet          ORBIX vault: balance, deposits, ledger export
//
// Honesty rules enforced in the UI, not just the docs: the vault panel says the balance
// is real ORBIX: deposits land in the vault contract, and rooms are labelled preview or funded
// while the deployment flag is off.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RoundPending, STAGES } from './stages'
import { GameArt, TEMPLATE_META } from './gameArt'
import { QuizEditor, TEMPLATE_FORMS, ruleNumber, type QuizQuestion, type RuleField } from './wizardForms'
import { center, explainError, API_BASE, type Allocation, type RoomDetail, type Settlement, type TemplateMeta } from './api'
import { playerHue, shortAddress, useSession } from './session'
import { WalletModal } from './WalletModal'
import { AdminPanel } from './AdminPanel'
import { bindRoomOnChain, payJoinToken as payJoinTokenGated } from './gate'
import { TxPreview } from './funds'
import { SharePanel } from './SharePanel'
import { ProfileAvatar, ProfileModal } from './ProfilePanel'
import { useProfile } from './ProfilePanel'
import { copyText } from './share'
import { useRoomChannel } from './ws'
import { GameCenterHome } from './GameCenterHome'
import { CenterVault } from './CenterVault'
import { FEATURED_GAMES, isFeaturedGame } from './featuredGames'
import { Gamepad2, Plus, Wallet as WalletIcon, ArrowUpRight, LogOut } from 'lucide-react'
import './center.css'
import './centerShell.css'

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

function ProfileTopButton({ session, onOpen }: { session: ReturnType<typeof useSession>; onOpen: () => void }) {
  const { profile } = useProfile(session.address, session.token)
  const [avatarLoaded, setAvatarLoaded] = useState(false)
  const avatarUrl = session.address
    ? `${API_BASE}/profile/image/${session.address}?t=${Math.floor(Date.now() / 60000)}`
    : null
  useEffect(() => {
    setAvatarLoaded(false)
    if (!avatarUrl) return
    let active = true
    const image = new Image()
    image.onload = () => { if (active) setAvatarLoaded(true) }
    image.src = avatarUrl
    return () => { active = false; image.onload = null }
  }, [avatarUrl])

  if (!session.token) return null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
      {profile?.name && <span style={{ fontSize: 12, color: '#c9c6c0', fontWeight: 600 }}>{profile.name}</span>}
      {avatarUrl && avatarLoaded ? (
        <button onClick={onOpen} className="pf-avatar" style={{ padding: 0, overflow: 'hidden' }}
                aria-label="Open profile">
          <img src={avatarUrl} width={30} height={30} style={{ borderRadius: '50%', objectFit: 'cover' }}
               onLoad={() => setAvatarLoaded(true)} onError={() => setAvatarLoaded(false)}
               alt="Profile" />
        </button>
      ) : (
        <ProfileAvatar name={profile?.name ?? undefined} hue={profile?.hue} size={30}
                       onClick={onOpen} hasWallet />
      )}
    </div>
  )
}

function WalletChip({ session, onOpenWallet }: { session: ReturnType<typeof useSession>; onOpenWallet: () => void }) {
  if (!session.token) return <button className="ct-wallet-connect" onClick={onOpenWallet} disabled={session.signingIn || session.autoSigningIn}><WalletIcon size={16} />{session.signingIn || session.autoSigningIn ? 'Connecting…' : 'Connect wallet'}</button>
  return <div className="ct-wallet"><button className="ct-wallet-account" onClick={() => go('/center/wallet')} title={session.address ?? undefined}><WalletIcon size={16} /><span>{shortAddress(session.address)}</span></button><button className="ct-signout" onClick={session.signOut} aria-label="Disconnect wallet"><LogOut size={16} /></button></div>
}

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let live = true
    setLoading(true)
    setData(null)
    setError(null)
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
  payoutMode?: 'creator' | 'custom' | 'burn'
  payoutAddress?: string
  openMode?: 'now' | 'schedule'
  openAtLocal?: string
  closeAfterHours?: number
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
  'number-hunt': { digits: 4, min: 1111, max: 9999, guess_budget: 10, hints: 'on', hint_visibility: 'public', target_count: 1, win_mode: 'first-hit', guess_cooldown_ms: 500 },
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

function WizardStepper({ current, onChange, disabled }: { current: number; onChange: (step: number) => void; disabled: boolean }) {
  return (
    <nav className="wz-stepper" aria-label="Create-room steps">
      {WIZARD_STEPS.map((st) => (
        <button type="button" key={st.n} disabled={disabled} onClick={() => onChange(st.n)} aria-current={st.n === current ? 'step' : undefined} className={`wz-step${st.n < current ? ' done' : st.n === current ? ' on' : ''}`}>
          <span className="wz-num">{st.n < current ? '✓' : st.n}</span>
          <span className="wz-label">{st.label}</span>
        </button>
      ))}
    </nav>
  )
}

function Wizard({ session, initialTemplateId, onConnect }: { session: ReturnType<typeof useSession>; initialTemplateId?: string; onConnect: () => void }) {
  const [templateRetry, setTemplateRetry] = useState(0)
  const templates = useAsync(() => center.templates(), [templateRetry])
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
  const [wizardStep, setWizardStep] = useState(initialTemplateId ? 2 : 1)
  const [edited, setEdited] = useState(false)
  useEffect(() => {
    if (!edited || status || busy) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [edited, status, busy])
  const changeStep = (step: number) => {
    if (step > 1 && !templates.data?.templates.some(template => template.templateId === draft.templateId)) { setError('Wait for game availability to load, or retry the connection.'); return }
    if (step > 1 && !isFeaturedGame(draft.templateId)) return
    if (step > 2 && (draft.name.trim().length < 3 || draft.name.trim().length > 60)) { setError('Give your room a name between 3 and 60 characters.'); return }
    setError(null); setWizardStep(step)
    document.getElementById('center-main')?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }
  const setRule = (key: string, value: unknown) => { setEdited(true); setDraft((d) => ({ ...d, rules: { ...d.rules, [key]: value } })) }
  const set = <K extends keyof DraftState>(key: K, value: DraftState[K]) => { setEdited(true); setDraft((d) => ({ ...d, [key]: value })) }

  const chooseTemplate = (templateId: string) => {
    setDraft(initialDraft(templateId))
    setPicking(false)
    setEdited(true)
    setWizardStep(2)
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
    // Token entry absorbs the preview joiner fee in the submitted configuration.
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
        joiner_fee: draft.entryToken ? 0 : draft.joinerFee,
        creator_absorbs_joiner_fee: draft.absorbsJoinerFee || Boolean(draft.entryToken),
      payout_mode: draft.entryToken ? (draft.payoutMode ?? 'creator') : undefined,
      payout_address: draft.payoutMode === 'custom' ? draft.payoutAddress : undefined,
      },
      timing: (() => {
        const openAt = draft.openMode === 'schedule' && draft.openAtLocal
          ? Math.floor(new Date(draft.openAtLocal).getTime() / 1000)
          : 0
        const closeAt = draft.closeAfterHours && draft.closeAfterHours > 0
          ? Math.floor(Date.now() / 1000) + draft.closeAfterHours * 3600
          : 0
        return { open_at: openAt > 0 ? openAt : 0, close_at: closeAt > 0 ? closeAt : 0 }
      })(),
      entry: draft.entryToken && draft.entryAmount > 0
        ? { kind: 'erc20' as const, token: draft.entryToken, amount: draft.entryAmount }
        : { kind: 'free' as const },
      rewards: { kind: 'preview-points', slots: [{ rank: 1, points: draft.rewardPoints }, { rank: 2, points: Math.round(draft.rewardPoints / 2) }] },
      branding: { preset: 'solar' },
    }
  }

  const saveDraft = async () => {
    if (!session.token) return setError('Sign in with your wallet first.')
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
    if (!session.token) return setError('Sign in with your wallet first.')
    setBusy(true)
    setError(null)
    try {
      // 1) publish the room first so we have its roomId
      const published = await center.publish(buildConfig(), intentNonce, session.token)
      // 2) if a join token is configured, bind it on-chain from the creator's wallet
      if (draft.entryToken && draft.entryAmount > 0 && session.address) {
        setStatus('Publishing… now binding your join token on-chain (two wallet signatures).')
        await bindRoomOnChain(
          published.roomId,
          draft.entryToken,
          draft.entryAmount,
          draft.payoutMode ?? 'creator',
          draft.payoutAddress,
          session.address,
          (step, detail) => setStatus(detail ?? step),
        )
      }
      setStatus(
        published.replayed
          ? 'This publish was already processed — the original room was returned and nothing was charged twice.'
          : `Room live. ${published.charged} ${published.balanceLabel} deducted; balance now ${published.balanceAfter}.`,
      )
      go(`/center/rooms/${published.roomId}`)
    } catch (err) {
      setError(explainError(err) || (err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ct-page ct-create">
      <header className="ct-head">
        <div>
          <span className="ct-create-kicker"><Plus size={16} /> Make room for fun</span>
          <h1>Your game. Your room.</h1>
          <p className="sub">Pick your game, set the scene, and invite your people. Review fees and rewards before publishing.</p>
        </div>
        <button className="btn-ghost" onClick={() => go('/center')}>
          Game center
        </button>
      </header>

      <WizardStepper current={wizardStep} onChange={changeStep} disabled={busy} />
      {templates.loading && <p role="status">Checking game availability…</p>}
      {templates.error && <div className="err" role="alert"><p>Game availability could not be loaded. {templates.error}</p><button className="btn-ghost" onClick={() => setTemplateRetry(value => value + 1)}>Try again</button></div>}
      <section className="ct-panel" id="wiz-format" hidden={wizardStep !== 1}>
        <h2>1 · Pick a game</h2>
        {picking ? (
          <div className="ct-grid ct-grid-formats">
            {(templates.data?.templates ?? []).filter((t) => isFeaturedGame(t.templateId)).map((t: TemplateMeta) => (
              <button
                key={t.templateId}
                className={`ct-format${draft.templateId === t.templateId ? ' on' : ''}`}
                onClick={() => chooseTemplate(t.templateId)}
                aria-pressed={draft.templateId === t.templateId}
              >
                <img src={`${import.meta.env.BASE_URL}center-art/${t.templateId}.webp`} alt="" width="320" height="200" loading="lazy" />
                <b>{FEATURED_GAMES.find((game) => game.id === t.templateId)?.name ?? t.label}</b>
                <span>{FEATURED_GAMES.find(game => game.id === t.templateId)?.description ?? t.blurb}</span>
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
            <button className="btn-ghost" onClick={() => changeStep(2)}>
              Continue ↓
            </button>
            <button className="link" onClick={() => { setPicking(true); setWizardStep(1) }} title="Pick a different format">
              change
            </button>
          </div>
        )}
      </section>

      <section className="ct-panel" id="wiz-room" hidden={wizardStep !== 2}>
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

      <section className="ct-panel" id="wiz-rules" hidden={wizardStep !== 3}>
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

      <section className="ct-panel" id="wiz-fees" hidden={wizardStep !== 4}>
        <h2>4 · Fees & rewards</h2>
        <p className="muted">What it costs to play, what the winner takes, and who pays the joiner fee. These room fees use preview credits. Token entry, when configured, requires a separate wallet transaction.</p>
        <div className="ct-form">
          <div className="wz-why">The play fee is charged to YOU once at publish — it is the cost of running the room, not something players pay.</div>
          <label>
            <span>Play fee (preview credits)</span>
            <input type="number" min={0} value={draft.requiredAmount} onChange={(e) => set('requiredAmount', Number(e.target.value))} />
            <small>Deducted from your preview-credit ledger when you publish.</small>
          </label>
          <label>
            <span>Joiner fee per player (preview credits){draft.entryToken ? ' — disabled while a join token is set' : ''}</span>
            <input
              type="number" min={0}
              value={draft.entryToken ? 0 : draft.joinerFee}
              disabled={Boolean(draft.entryToken)}
              onChange={(e) => set('joinerFee', Number(e.target.value))}
            />
            {draft.entryToken
              ? <small>Joiners pay the token you chose above — <span translate="no">ORBIX</span> joiner fees are absorbed by you.</small>
              : <small>Each player pays this to join — unless you absorb it below.</small>}
          </label>
          <label className="inline">
            <input type="checkbox" checked={draft.absorbsJoinerFee} onChange={(e) => set('absorbsJoinerFee', e.target.checked)} />
            <span>I pay all joiner fees (players join free; the total is deducted from MY vault after the game ends, based on who joined)</span>
          </label>
          <label>
            <span>Join token contract (any ERC-20, optional)</span>
            <input
              value={draft.entryToken}
              spellCheck={false}
              autoComplete="off"
              placeholder="0x… paste any ERC-20 contract address"
              onChange={(e) => set('entryToken', e.target.value)}
            />
            <small>Paste any token you want joiners to pay. Leave empty for a free room. You do NOT need to own or have created it.</small>
          </label>
          {draft.entryToken && (
            <>
              <label>
                <span>Join amount (in the chosen token)</span>
                <input
                  type="number"
                  min={1}
                  step="any"
                  value={draft.entryAmount || ''}
                  placeholder="e.g. 25"
                  onChange={(e) => set('entryAmount', Number(e.target.value))}
                />
                <small>Each joiner pays this amount of the token above to enter.</small>
              </label>
              <label>
                <span>Where join fees go</span>
                <select
                  value={draft.payoutMode ?? 'creator'}
                  onChange={(e) => set('payoutMode', e.target.value as 'creator' | 'custom' | 'burn')}
                >
                  <option value="creator">My wallet (you receive the tokens)</option>
                  <option value="custom">Custom address (route to any wallet)</option>
                  <option value="burn">Burn (tokens are permanently destroyed)</option>
                </select>
                <small>Choose where the join fees accumulate.</small>
              </label>
              {draft.payoutMode === 'custom' && (
                <label>
                  <span>Custom payout address</span>
                  <input
                    value={draft.payoutAddress ?? ''}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="0x… wallet to receive join fees"
                    onChange={(e) => set('payoutAddress', e.target.value)}
                  />
                  <small>Tokens from every joiner will be sent here.</small>
                </label>
              )}
              {draft.payoutMode === 'burn' && (
                <div className="wz-why">Tokens will be sent to 0x…dEaD. This is irreversible — the supply shrinks with every join.</div>
              )}
            </>
          )}
          <label>
            <span>Room opening</span>
            <select
              value={draft.openMode ?? 'now'}
              onChange={(e) => set('openMode', e.target.value as 'now' | 'schedule')}
            >
              <option value="now">Open room now</option>
              <option value="schedule">Schedule opening</option>
            </select>
            <small>Open immediately, or set a time for the room to go live.</small>
          </label>
          {draft.openMode === 'schedule' && (
            <label>
              <span>Open at</span>
              <input
                type="datetime-local"
                value={draft.openAtLocal ?? ''}
                onChange={(e) => set('openAtLocal', e.target.value)}
              />
              <small>The room becomes joinable at this time.</small>
            </label>
          )}
          <label>
            <span>Auto-close after (hours, 0 = never)</span>
            <input
              type="number" min={0} max={168}
              value={draft.closeAfterHours ?? 0}
              onChange={(e) => set('closeAfterHours', Number(e.target.value))}
            />
            <small>When this elapses the room closes and frees its resources.</small>
          </label>
          <label>
            <span>Winner points (preview)</span>
            <input type="number" min={0} value={draft.rewardPoints} onChange={(e) => set('rewardPoints', Number(e.target.value))} />
            <small>These are game points, separate from wallet tokens. Set to 0 to award no preview points.</small>
          </label>
        </div>

        <div className="wz-why" style={{ marginTop: 14 }}>
          This wizard publishes preview-point rooms. Publishing here does not fund token, NFT or native-currency prizes.
          On-chain prizes require a separate contract funding flow and confirmed inventory before players enter.
        </div>

        <p className="muted">
          The exact configuration is hashed into the round commitment, so a settled round can be checked against the rules that were
          published.
        </p>
      </section>


        {/* Room Capsule — compact summary before publish */}
        <div className="ct-capsule" hidden={wizardStep !== 4} aria-label="Room summary before publish">
          <span className="ct-capsule-title">ROOM SUMMARY</span>
          <div className="ct-capsule-grid">
            <div><small>Game</small><b>{TEMPLATE_FORMS[draft.templateId]?.label ?? draft.templateId}</b></div>
            <div><small>Visibility</small><b>{draft.visibility}</b></div>
            <div><small>Players</small><b>{isSolo ? 1 : draft.playerCap}</b></div>
            <div><small>Play fee</small><b>{draft.requiredAmount} preview credits</b></div>
            <div><small>Joiner fee</small><b>{draft.entryToken ? `${draft.entryAmount} (token)` : draft.joinerFee ? `${draft.joinerFee} preview credits` : 'Free'}</b></div>
            <div><small>Winner reward</small><b>{draft.rewardPoints} preview points</b></div>
          </div>
        </div>
      <div className="ct-wizard-actions">
        <button className="btn-ghost" onClick={() => changeStep(Math.max(1, wizardStep - 1))} disabled={busy || wizardStep === 1}>Previous step</button>
        <span>Step {wizardStep} of 4</span>
        {wizardStep < 4 ? <button className="btn-primary" onClick={() => changeStep(wizardStep + 1)} disabled={busy || templates.loading || !templates.data?.templates.some(template => template.templateId === draft.templateId)}>Continue</button> : <div className="ct-actions"><button className="btn-ghost" onClick={saveDraft} disabled={busy || !session.token || templates.loading || Boolean(templates.error)}>Save draft</button><button className="btn-primary" onClick={session.token ? publish : onConnect} disabled={busy || session.signingIn || templates.loading || Boolean(templates.error)}>{busy ? 'Publishing…' : session.token ? 'Publish room' : 'Connect to publish'}</button></div>}
      </div>
      {status && <p className="st-note ok">{status}</p>}
      {error && <p className="err" role="alert">{error}</p>}
      {!session.token && wizardStep === 4 && <p className="muted">Connect your wallet before publishing. No transaction is sent by connecting.</p>}
    </div>
  )
}

// ------------------------------------------------------------------ room

export function timeLeftShort(closeAt: number): string {
  const secs = closeAt - Math.floor(Date.now() / 1000)
  if (secs <= 0) return 'closing'
  if (secs < 3600) return `${Math.ceil(secs / 60)}m`
  if (secs < 86400) return `${Math.ceil(secs / 3600)}h`
  return `${Math.ceil(secs / 86400)}d`
}

function Room({ roomId, session }: { roomId: string; session: ReturnType<typeof useSession> }) {
  const [joinStep, setJoinStepRaw] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const setJoinStep = (st: string, detail?: string) => setJoinStepRaw(detail ? `${st}: ${detail}` : st)
  const [room, setRoom] = useState<RoomDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ticket, setTicket] = useState<string | null>(null)
  const [settlement, setSettlement] = useState<Settlement | null>(null)
  const [inviteGenerated, setInviteGenerated] = useState<string | null>(null)
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
    // A room with a join token shows a signing preview before anything is sent.
    if (entryToken && entryAmount > 0 && session.address) {
      setPreviewOpen(true)
      return
    }
    await doJoin()
  }

  const doJoin = async () => {
    if (!session.token) return
    setPreviewOpen(false)
    setBusy(true)
    setError(null)
    try {
      if (entryToken && entryAmount > 0 && session.address) {
        await payJoinTokenGated(roomId, entryToken, entryAmount, session.address, (step, detail) => setJoinStep(step, detail))
      }
      const params = new URLSearchParams(window.location.search)
      const joined = await center.join(roomId, session.token, params.get('invite') ?? undefined)
      setTicket(joined.ticket)
      channel.connect(joined.ticket)
      await refresh()
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : explainError(err))
    } finally {
      setBusy(false)
      setJoinStep('')
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
      setInviteGenerated(created.invite)
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
  const entryCfg = (room?.config?.entry ?? {}) as { kind?: string; token?: string; amount?: number }
  const entryToken = String(entryCfg.token ?? '')
  const entryAmount = Number(entryCfg.amount ?? 0)
  const entrySymbol = entryToken ? `token ${shortAddress(entryToken, 4)}` : ''
  const timing = room?.timing ?? {}
  const openAt = Number(timing.open_at ?? 0)
  const closeAt = Number(timing.close_at ?? 0)
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
            {openAt > 0 && Date.now() / 1000 < openAt && (
              <> · <span className="tag tag-free">OPENS {new Date(openAt * 1000).toLocaleTimeString()}</span></>
            )}
            {closeAt > 0 && Date.now() / 1000 < closeAt && (
              <> · <span className="tag tag-live">CLOSES {timeLeftShort(closeAt)}</span></>
            )}
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
{error && <p className="err" role="alert">{error}</p>}
        {joinStep && <p className="muted" role="status" aria-live="polite">{joinStep}</p>}
        <TxPreview
          open={previewOpen}
          title="Join this room — confirm the transaction"
          busy={busy}
          steps={[
            { label: 'Approve', detail: `Step 1 — approve the gate to transfer ${entryAmount} of the room token from your wallet. Your wallet will ask you to sign. This only happens if your current allowance is lower than the join amount.`, contract: entryToken, fn: 'approve(spender, amount)', value: `${entryAmount} token units`, args: [['spender (gate)', '0xcfc161d02225eceb97aa9b8ff791a407a3bb3cff']] },
            { label: 'Join', detail: 'Step 2 — the gate transfers the join amount from your wallet to the room payout and adds you to the room.', contract: '0xcfc161d02225eceb97aa9b8ff791a407a3bb3cff', fn: 'join(roomId)', args: [['roomId', roomId]] },
          ]}
          onConfirm={doJoin}
          onCancel={() => setPreviewOpen(false)}
        />

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
                  <strong>Entry:</strong>{' '}
                  {entryToken ? (
                    <>
                      joining requires{' '}
                      <span className="mono">{entryAmount}</span> of the creator's chosen token{' '}
                      <span className="mono">{shortAddress(entryToken, 4)}</span>{' '}
                      — you will approve and pay from your wallet
                    </>
                  ) : (
                    <>
                      joining costs{' '}
                      <span className="mono">{requiredAmount}</span> preview points from your vault
                      {joinerFee > 0 && (
                        <>
                          {' '}plus a joiner fee of{' '}
                          <span className="mono">{joinerFee}</span>
                          {absorbsFee ? ' (paid by the creator)' : ''}
                        </>
                      )}
                    </>
                  )}
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
            <button className="btn-primary" onClick={join} disabled={busy || !session.token} title={!session.token ? "Sign in with your wallet to join" : undefined}>
              {busy && joinStep ? 'Working…' : players.includes(me) ? 'Reconnect to room' : 'Join room'}
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
        {entryToken && (
          <div className="entry-info">
            <span className="tag tag-pay">ENTRY: {entryAmount} {entrySymbol || 'tokens'}</span>
            <span className="mono" style={{ fontSize: 10.5, color: '#8d9095' }} translate="no">
              {shortAddress(entryToken, 6)}
            </span>
            {absorbsFee && <span className="tag tag-free">ORBIX absorbed by creator</span>}
          </div>
        )}
        <SharePanel roomId={roomId} visibility={room?.visibility ?? 'unlisted'} />
        {inviteGenerated && (
          <p className="st-note mono" translate="no">
            Invite created: {inviteGenerated}
            <button className="link" onClick={() => void copyText(inviteGenerated)}>copy code</button>
          </p>
        )}
        {!session.token && <p className="muted">Sign in with your wallet to join and play.</p>}
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

// ------------------------------------------------------------------ app shell

const NAV: { label: string; path: string }[] = [
  { label: 'Game center', path: '/center' },
  { label: 'Create room', path: '/center/create' },
  { label: 'Vault', path: '/center/wallet' },
]

export function CenterApp() {
  const session = useSession()
  const [walletOpen, setWalletOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [route, setRoute] = useState<Route>(() => parseRoute())
  const activePath = route.name === 'room' ? '' : route.name === 'create' ? '/center/create' : route.name === 'wallet' ? '/center/wallet' : route.name === 'admin' ? '/center/admin' : '/center'

  useEffect(() => {
    const onPop = () => setRoute(parseRoute())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Per-route document title (browser tab readability)
  useEffect(() => {
    const titles: Record<string, string> = {
      catalog: 'Orbix Game Center — Your next round starts here',
      create: 'Create a room — Orbix Game Center',
      room: 'Room — Orbix Game Center',
      wallet: 'Vault — Orbix Game Center',
      admin: 'Admin — Orbix Game Center',
    }
    document.title = titles[route.name] ?? 'Orbix Game Center'
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [route])

  const body = useMemo(() => {
    switch (route.name) {
      case 'create':
        return route.templateId && !isFeaturedGame(route.templateId) ? <div className="ct-page ct-unavailable"><Gamepad2 size={48} /><h1>More worlds are on the way.</h1><p>This game is coming soon. Pick one of the four featured games for your next room.</p><button className="btn-primary" onClick={() => go('/center')}>Explore games</button></div> : <Wizard key={route.templateId ?? 'choose'} session={session} initialTemplateId={route.templateId} onConnect={() => setWalletOpen(true)} />
      case 'room':
        return <Room roomId={route.roomId} session={session} />
      case 'wallet':
        return <CenterVault session={session} onConnect={() => setWalletOpen(true)} navigate={go} />
      case 'admin':
        return <AdminPanel session={session} />
      default:
        return <GameCenterHome session={session} onConnect={() => setWalletOpen(true)} navigate={go} />
    }
  }, [route, session])

  return (
    <div className="ct-app">
      <a className="ct-skip-link" href="#center-main">Skip to content</a>
      <header className="ct-topbar">
        <a className="ct-brand" href="/center" onClick={(e) => { e.preventDefault(); go('/center') }}>
          <span className="ct-brand-orbit" aria-hidden="true"><i /></span>
          <span className="brand-text">
            <b translate="no">ORBIX</b>
            <small>game center</small>
          </span>
        </a>
        <nav className="ct-primary-nav" aria-label="Game center navigation">{NAV.map((item) => (
          <button
            key={item.path}
            className={`ct-nav-item${item.path === activePath ? ' on' : ''}`}
            aria-current={item.path === activePath ? 'page' : undefined}
            onClick={() => go(item.path)}
          >
            {item.path === '/center' ? <Gamepad2 size={17} /> : item.path === '/center/create' ? <Plus size={17} /> : <WalletIcon size={17} />}{item.label}
          </button>
        ))}</nav>
        <a className="ct-nav-item back" href="/">
          Orbix Core <ArrowUpRight size={14} />
        </a>
        <div className="ct-player-controls">
          {session.token && session.address && (
            <ProfileTopButton session={session} onOpen={() => setProfileOpen(true)} />
          )}
          <WalletChip session={session} onOpenWallet={() => setWalletOpen(true)} />
        </div>
      </header>
      {walletOpen && <WalletModal session={session} onClose={() => setWalletOpen(false)} />}
      {profileOpen && <ProfileModalWrapper session={session} onClose={() => setProfileOpen(false)} />}
      <main className="ct-main" id="center-main" tabIndex={-1}>{body}</main>
      <footer className="ct-footer"><a href="/center" onClick={(e) => { e.preventDefault(); go('/center') }}><Gamepad2 size={18} /> Orbix Game Center</a><span>Made for the next round.</span><div><a href="/">Orbix Core</a><button onClick={() => go('/center/admin')}>Admin</button><span>Robinhood testnet</span></div></footer>
    </div>
  )
}


// ------------------------------------------------------------------ join-token payment




function ProfileModalWrapper({ session, onClose }: { session: ReturnType<typeof useSession>; onClose: () => void }) {
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (session.address) {
      center.getProfile(session.address).then(setProfile).catch(() => setProfile(null)).finally(() => setLoading(false))
    }
  }, [session.address])
  if (loading) return null
  return <ProfileModal session={session} profile={profile} onClose={onClose} onSave={() => {}} />
}
