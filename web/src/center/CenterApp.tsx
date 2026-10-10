import {FormRewardSetup, ResultForms, CreatorFormResponses, newForm, type FormReward} from './FormRewards'
import { ResultWaitlist, CreatorWaitlist, type WaitlistOptions } from "./Waitlist"
import { FundedRewardsSetup, MyRewards, CreatorRewardAllocation, initialRewardSettings, rewardConfig, type RewardSettings } from './FundedRewards'
import { fundRewardPool, type Funding } from './rewardWallet'
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

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RoundPending, STAGES } from './stages'
import { FOUR_STAGE_VIEWS } from './GamePlayStages'
import { CenterJoin } from './CenterJoin'
import { RoomCommunity } from './RoomCommunity'
import { ArcadeChoices, ArcadeNumber, ArcadeShares, ArcadeToggle, numericError, type NumericBounds } from './ArcadeSettings'
import { PracticeArena } from './PracticeArena'
import { AdminRoomTools } from './AdminRoomTools'
import { CharacterPicker } from './ArenaControls'
import { verifiedPodium } from './verifiedPodium'
const CharacterLobby = lazy(() => import('./CharacterLobby'))
const LobbyWorld = lazy(() => import('./worlds/GameWorld'))
const WinnerCelebration = lazy(() => import('./WinnerCelebration'))
const RematchSettings = lazy(() => import('./RematchSettings'))
import { GameArt, TEMPLATE_META } from './gameArt'
import { QuizEditor, TEMPLATE_FORMS, ruleNumber, type QuizQuestion, type RuleField } from './wizardForms'
import { center, explainError, API_BASE, type Allocation, type RoomDetail, type Settlement, type TemplateMeta } from './api'
import { playerHue, shortAddress, useSession } from './session'
import { WalletModal } from './WalletModal'
import { AdminPanel } from './AdminPanel'
import { bindRoomOnChain, payJoinToken as payJoinTokenGated, GATE_ADDRESS, LEGACY_GATE, BURN_ADDRESS } from './gate'
import { TxPreview } from './funds'
import { SharePanel } from './SharePanel'
import { RoundImmersion, type ImmersionHandle } from './RoundImmersion'
import { CharacterBadge } from './CharacterBadge'
import { ProfileAvatar, ProfileModal } from './ProfilePanel'
import { CreatorTokenFees, RoomRewardsGuide } from './CreatorEconomy'
import { localPlacement } from './resultPresentation'
import { useProfile } from './ProfilePanel'
import { copyText } from './share'
import { useRoomChannel } from './ws'
import { GameCenterHome } from './GameCenterHome'
import { CenterVault } from './CenterVault'
import { FEATURED_GAMES, isFeaturedGame } from './featuredGames'
import { Gamepad2, Plus, Wallet as WalletIcon, ArrowUpRight, LogOut } from 'lucide-react'
import './center.css'
import './centerShell.css'
import './gameControls.css'
import './roomExperience.css'

type Route =
  | { name: 'catalog' }
  | { name: 'create'; templateId?: string; fromRoom?: string }
  | { name: 'room'; roomId: string }
  | { name: 'wallet' }
  | { name: 'join' }
  | { name: 'admin' }
  | { name: 'practice'; templateId: string }

function parseRoute(): Route {
  const path = window.location.pathname.replace(/\/+$/, '')
  const parts = path.split('/').filter(Boolean)
  if (parts[1] === 'create') return { name: 'create', templateId: parts[2] ?? new URLSearchParams(window.location.search).get('template') ?? undefined, fromRoom: new URLSearchParams(window.location.search).get('from') ?? undefined }
  if (parts[1] === 'rooms' && parts[2]) return { name: 'room', roomId: parts[2] }
  if (parts[1] === 'wallet') return { name: 'wallet' }
  if (parts[1] === 'join') return { name: 'join' }
  if (parts[1] === 'practice' && parts[2]) return { name: 'practice', templateId: parts[2] }
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
  const { profile, revision } = useProfile(session.address, session.token)
  const [avatarLoaded, setAvatarLoaded] = useState(false)
  const avatarUrl = session.address && profile?.hasImage
    ? `${API_BASE}/profile/image/${session.address}?v=${revision}`
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
    <div className="ct-profile-control" style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
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
  'token-catch': { arena_mode: true, world_version:4, loot_budget:500,airdrop_count:10,loot_chunk:5,gun_spawn_chance_pct:30,gun_shots:5,gun_knockout_seconds:10,punch_stun_seconds:2,spawn_per_second: 2, lanes: 3, fall_speed: 'normal', hazard_chance_pct: 12, combo_cap: 3, win_threshold: 20, top_n: 3 },
  'combat-duel': { world_version:4,allow_guns:false,combo_window_ms:800,starting_health: 150, attack_cooldown_ms: 500, min_players: 2, max_players: 2 },
  'reaction-duel': { rounds: 3, choice_window_seconds: 10, reveal_window_seconds: 5, choice_set: 'classic' },
  'puzzle-sprint': { board: 3, move_cap: 300, score_mode: 'time', top_n: 3, hints: 'off', hint_budget: 3, hint_move_penalty: 2 },
  'hash-hunt': { difficulty_bits: 18, win_mode: 'first-valid', leaderboard_size: 10 },
  'boss-raid': { arena_mode: true,world_version:4,winning_teams:3,team_reward_shares:[60,25,15],team_member_split:'equal',starting_gun_damage:12,upgrade_interval_seconds:30,knockout_seconds:10, team_size: 3, min_players: 2, max_players: 50, team_mode: 'teams', boss_health: 12000, action_cooldown_ms: 500, contribution_cap: 100000, min_contribution: 10, reward_rule: 'top-n', top_n: 3 },
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
  const map: Record<string, number> = { 'number-hunt': 90, 'token-catch': 45, 'puzzle-sprint': 120, 'memory-match': 120, 'hash-hunt': 120, 'boss-raid': 180, 'combat-duel': 180 }
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
    playerCap: templateId === 'boss-raid' ? 12 : ['reaction-duel', 'combat-duel'].includes(templateId) ? 2 : SOLO.has(templateId) ? 1 : 8,
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
        <button type="button" key={st.n} disabled={disabled} onClick={() => onChange(st.n)} aria-label={`${st.n} ${st.label}`} aria-current={st.n === current ? 'step' : undefined} className={`wz-step${st.n < current ? ' done' : st.n === current ? ' on' : ''}`}>
          <span className="wz-num">{st.n < current ? '✓' : st.n}</span>
          <span className="wz-label">{st.label}</span>
        </button>
      ))}
    </nav>
  )
}

function Wizard({ session, initialTemplateId, fromRoom, onConnect }: { session: ReturnType<typeof useSession>; initialTemplateId?: string; fromRoom?: string; onConnect: () => void }) {
  const [templateRetry, setTemplateRetry] = useState(0)
  const templates = useAsync(() => center.templates(), [templateRetry])
  const [draft, setDraft] = useState<DraftState>(() => initialDraft(initialTemplateId && initialTemplateId in DEFAULT_RULES ? initialTemplateId : 'number-hunt'))
  const [ruleSchemas, setRuleSchemas] = useState<Record<string, NumericBounds & {enum?: unknown[]}>>({})
  const [caps, setCaps] = useState<{ min: number | null; max: number | null }>({ min: null, max: null })

  // The template's own schema is the authority on how many players may join. The wizard
  // clamps to it, so a 1v1 template can never be published with player_cap 8.
  useEffect(() => {
    let live = true
    center.templateRules(draft.templateId).then((r) => { if (live) { setCaps(r.playerCap); setRuleSchemas((r.fields.properties ?? {}) as Record<string, NumericBounds & {enum?: unknown[]}>) } }).catch(() => undefined)
    return () => {
      live = false
    }
  }, [draft.templateId])
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [intentNonce] = useState(() => crypto.randomUUID())
  const fundingAttemptKey = `orbix-reward-publication:${session.address?.toLowerCase()}:${initialTemplateId ?? 'new'}:${fromRoom ?? ''}`
  const [fundingLocked, setFundingLocked] = useState(() => Boolean(sessionStorage.getItem(fundingAttemptKey)))
  // Format picker: collapsed chip after a choice; the full grid shows only while picking.
  const [picking, setPicking] = useState(!initialTemplateId)
  const [wizardStep, setWizardStep] = useState(initialTemplateId ? 2 : 1)
  const [edited, setEdited] = useState(false)
  const [communityOptions, setCommunityOptions] = useState({mute_chat: false, hide_players: false, hide_guesses: false})
  const [timedHints, setTimedHints] = useState<{delay_seconds: number; text: string}[]>([])
  const [waitlist, setWaitlist] = useState<WaitlistOptions>({enabled:false,message:""})
  const [forms,setForms] = useState<FormReward[]>([])
  const [rewardSettings, setRewardSettings] = useState<RewardSettings>(initialRewardSettings)
  const [sourceConfig, setSourceConfig] = useState<Record<string, unknown> | null>(null)
  const [sourceLoading, setSourceLoading] = useState(Boolean(fromRoom))
  useEffect(() => {
    const raw = sessionStorage.getItem(fundingAttemptKey)
    setFundingLocked(Boolean(raw))
    if (!raw) return
    try {
      const saved = JSON.parse(raw) as {config:Record<string,any>;rewards:ReturnType<typeof rewardConfig>}
      const config=saved.config, reward=saved.rewards, slot=reward.slots[0]
      setForms((config.rewards?.forms ?? []) as FormReward[])
      setWaitlist(config.waitlist ?? {enabled:false,message:""})
      const deadline=new Date(reward.claim_deadline*1000)
      setRewardSettings({...initialRewardSettings(),enabled:true,kind:slot.asset_kind,token:slot.asset_contract,amount:slot.amount,tokenId:slot.token_id,count:reward.slots.length,tokenIds:reward.slots.filter(s=>s.asset_kind==='erc721').map(s=>String(s.token_id)),distribution:reward.distribution??'match',waitlistSource:reward.waitlist_source??'',mode:reward.claim_mode,deadline:new Date(deadline.getTime()-deadline.getTimezoneOffset()*60000).toISOString().slice(0,16),recipients:reward.merkle_winners.join(', ')})
      setDraft(previous=>({...previous,templateId:config.template_id,name:config.name,description:config.description??'',visibility:config.visibility,rules:config.rules,durationSeconds:config.rules.duration_seconds??previous.durationSeconds,playerCap:config.admission.player_cap,minReady:config.admission.min_ready_to_start,requiredAmount:config.access.required_amount??0,joinerFee:config.access.joiner_fee??0,absorbsJoinerFee:config.access.creator_absorbs_joiner_fee,entryToken:config.entry.kind==='erc20'?config.entry.token:'',entryAmount:config.entry.amount??0}))
      if (fromRoom) {setSourceConfig(config);setSourceLoading(false)}
      setPicking(false);setWizardStep(4)
    } catch { setError('The saved funding attempt could not be read. Check its confirmed transactions before starting a new publication.') }
  },[fundingAttemptKey])
  const sourceFunding = (sourceConfig?.rewards as {kind?:string} | undefined)?.kind === 'funded-assets'
  const sourceOnchain = (sourceConfig?.access as {vault_mode?:string} | undefined)?.vault_mode === 'onchain'
  useEffect(() => {
    if (!fromRoom || sessionStorage.getItem(fundingAttemptKey)) return
    let active = true
    setSourceLoading(true)
    center.room(fromRoom, session.token ?? undefined).then(source => {
      if (!active) return
      if (source.owner.toLowerCase() !== session.address?.toLowerCase()) throw new Error('Connect the creator wallet to copy this room.')
      const config = source.config, rules = config.rules as Record<string,unknown>, access = config.access as Record<string,unknown>, entry = config.entry as Record<string,unknown>, admission = config.admission as Record<string,unknown>, rewards = config.rewards as {kind:string;slots?:{points?:number}[]}
      const templateId = String(config.template_id)
      setSourceConfig(config)
      setForms(((config.rewards as {forms?:FormReward[]})?.forms ?? []))
      setWaitlist((config.waitlist as WaitlistOptions) ?? {enabled:false,message:""})
      if (rewards.kind === 'funded-assets') {
        const original = config.rewards as unknown as {claim_mode?:RewardSettings['mode'];merkle_winners?:string[];slots:{asset_kind:RewardSettings['kind'];asset_contract:string;amount:string|number;token_id:string|number}[]}
        const slot = original.slots[0]
        if (slot) setRewardSettings({...initialRewardSettings(),enabled:true,kind:slot.asset_kind,token:slot.asset_contract,amount:String(slot.amount),tokenId:String(slot.token_id),count:original.slots.length,mode:original.claim_mode??'code',recipients:(original.merkle_winners??[]).join(', ')})
      }
      setDraft({...initialDraft(templateId),templateId,name:String(config.name),description:String(config.description ?? ''),visibility:config.visibility as DraftState['visibility'],rules:{...rules,...(['token-catch','boss-raid','combat-duel'].includes(templateId)?{world_version:4}:{})},durationSeconds:Number(rules.duration_seconds ?? defaultDuration(templateId)),playerCap:Number(admission.player_cap),minReady:Number(admission.min_ready_to_start),requiredAmount:Number(access.required_amount ?? 0),joinerFee:Number(access.joiner_fee ?? 0),absorbsJoinerFee:Boolean(access.creator_absorbs_joiner_fee),entryToken:entry.kind==='erc20'?String(entry.token):'',entryAmount:Number(entry.amount ?? 0),payoutMode:access.payout_mode as DraftState['payoutMode'],payoutAddress:String(access.payout_address ?? ''),hintVisibility:rules.hint_visibility==='public'?'public':'private',rewardPoints:Number(rewards.slots?.[0]?.points ?? 100)})
      const copiedCommunity = config.community_settings as Partial<typeof communityOptions> | undefined
      setCommunityOptions({mute_chat:Boolean(copiedCommunity?.mute_chat),hide_players:Boolean(copiedCommunity?.hide_players),hide_guesses:Boolean(copiedCommunity?.hide_guesses)})
      setPicking(false); setWizardStep(2)
    }).catch(failure => { if (active) setError(explainError(failure)) }).finally(() => { if (active) setSourceLoading(false) })
    return () => { active = false }
  }, [fromRoom, session.address, session.token])
  useEffect(() => {
    if (!edited || status || busy) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [edited, status, busy])
  const changeStep = (step: number) => {
    if (fundingLocked) { setError('Finish your saved funded publication before editing its settings.'); return }
    if (step > 1 && !templates.data?.templates.some(template => template.templateId === draft.templateId)) { setError('Wait for game availability to load, or retry the connection.'); return }
    if (step > 1 && !isFeaturedGame(draft.templateId)) return
    if (step > 2 && (draft.name.trim().length < 3 || draft.name.trim().length > 60)) { setError('Give your room a name between 3 and 60 characters.'); return }
    if (step > wizardStep && (currentStepErrors.length || step > 2 && Object.values(basicErrors).some(Boolean) || step > 3 && [...Object.values(ruleErrors),...hintErrors].some(Boolean))) { setError('Correct the highlighted settings before continuing.'); return }
    if (step > 1 && !gameAvailable) { setError('This game is currently unavailable. Pick a live game.'); return }
    setError(null); setWizardStep(step)
    document.getElementById('center-main')?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }
  const setRule = (key: string, value: unknown) => { setEdited(true); setDraft(d => ({...d, rules: {...d.rules, [key]: value, ...(d.templateId === 'number-hunt' && key === 'digits' ? Number(value) === 6 ? {min:111111,max:999999} : {min:1111,max:9999} : {})}})) }
  const set = <K extends keyof DraftState>(key: K, value: DraftState[K]) => { setEdited(true); setDraft((d) => ({ ...d, [key]: value })) }

  const chooseTemplate = (templateId: string) => {
    if (sourceConfig && templateId !== sourceConfig.template_id) {setError('Keep the original game when copying a funded room. Start a separate create flow to choose another game.');return}
    setDraft(initialDraft(templateId))
    setCaps({min:null,max:null}); setRuleSchemas({})
    setPicking(false)
    setEdited(true)
    setWizardStep(2)
  }
  const capMax = draft.templateId === 'boss-raid' ? 50 : ['reaction-duel', 'combat-duel'].includes(draft.templateId) ? 2 : caps.max ?? (SOLO.has(draft.templateId) ? 1 : 50)
  const capMin = draft.templateId === 'boss-raid' || ['reaction-duel', 'combat-duel'].includes(draft.templateId) ? 2 : caps.min ?? 1
  const isSolo = SOLO.has(draft.templateId)
  const roundBounds: NumericBounds = ruleSchemas.duration_seconds ?? {minimum: draft.templateId === 'boss-raid' ? 60 : 15, maximum:600}
  const ruleFields = (TEMPLATE_FORMS[draft.templateId]?.fields ?? []).filter(field => {
    if(Number(draft.rules.world_version)>=3 && draft.templateId==='token-catch' && ['lanes','fall_speed','combo_cap','spawn_per_second','win_threshold','top_n','catch_window_ms'].includes(field.key))return false
    if(Number(draft.rules.world_version)>=3 && draft.templateId==='boss-raid' && ['top_n','reward_rule','team_mode'].includes(field.key))return false
    return !(draft.rules.arena_mode && draft.templateId==='token-catch' && ['lanes','fall_speed','combo_cap'].includes(field.key))
  })
  const boundsFor = (field: Extract<RuleField, {kind:'number'}>): NumericBounds => {
    if (draft.templateId === 'number-hunt' && ['min','max'].includes(field.key)) return Number(draft.rules.digits) === 6 ? {minimum:111111,maximum:999999} : {minimum:1111,maximum:9999}
    return ruleSchemas[field.key] ?? {minimum:field.min,maximum:field.max}
  }
  const basicErrors: Record<string, string | undefined> = {
    name: draft.name.trim().length < 3 || draft.name.trim().length > 60 ? 'Use a room name with 3–60 characters.' : undefined,
    duration: hasDuration(draft.templateId) ? numericError(draft.durationSeconds, roundBounds, 'Round length') : undefined,
    playerCap: numericError(draft.playerCap, {minimum:isSolo ? 1 : capMin,maximum:isSolo ? 1 : capMax}, 'Player cap'),
    minReady: numericError(draft.minReady, {minimum:isSolo ? 1 : capMin,maximum:draft.playerCap}, 'Ready players'),
  }
  const ruleErrors: Record<string,string | undefined> = {}
  for (const field of ruleFields) {
    if (field.kind === 'number') ruleErrors[field.key] = numericError(draft.rules[field.key], boundsFor(field), field.label)
  }
  if (draft.templateId === 'number-hunt') {
    const lo = Number(draft.rules.digits) === 6 ? 111111 : 1111
    const hi = Number(draft.rules.digits) === 6 ? 999999 : 9999
    ruleErrors.min = numericError(draft.rules.min,{minimum:lo,maximum:hi},'Range start')
    ruleErrors.max = numericError(draft.rules.max,{minimum:lo,maximum:hi},'Range end')
    if (Number(draft.rules.max) <= Number(draft.rules.min)) ruleErrors.max = 'Range end must be higher than range start.'
    if (Number(draft.rules.target_count) > Number(draft.rules.max) - Number(draft.rules.min) + 1) ruleErrors.target_count = 'Choose fewer targets than the available numbers.'
  }
  if (draft.templateId === 'boss-raid' && Number(draft.rules.min_contribution) > Number(draft.rules.contribution_cap)) ruleErrors.min_contribution = 'Minimum contribution cannot exceed the per-player cap.'
  if(draft.templateId==='boss-raid' && Number(draft.rules.world_version)>=3){
    const shares=draft.rules.team_reward_shares
    if(!Array.isArray(shares) || shares.length!==Number(draft.rules.winning_teams) || shares.some(n=>!Number.isInteger(n)||n<0||n>100) || shares.reduce((a,n)=>a+n,0)!==100)ruleErrors.team_reward_shares='Crew prize shares must match winning crews and total 100%.'
  }
  if(draft.templateId==='token-catch' && Number(draft.rules.world_version)>=3){
    if(Number(draft.rules.airdrop_count)>Number(draft.rules.loot_budget))ruleErrors.airdrop_count='Use at least one loot unit per airdrop.'
    if(Math.ceil(Number(draft.rules.loot_budget)/Number(draft.rules.loot_chunk))+Number(draft.rules.airdrop_count)>400)ruleErrors.loot_chunk='Use larger piles: this match supports up to 400 loot piles.'
  }
  const hintErrors = timedHints.map(hint => hint.text.trim() ? numericError(hint.delay_seconds,{minimum:0,maximum:3600},'Hint delay') : undefined).filter(Boolean)
  const feeErrors: Record<string,string | undefined> = {
    requiredAmount:numericError(draft.requiredAmount,{minimum:0},'Play fee'),
    joinerFee: draft.entryToken ? undefined : numericError(draft.joinerFee,{minimum:0},'Joiner fee'),
    rewardPoints:numericError(draft.rewardPoints,{minimum:0},'Winner points'),
    closeAfterHours:numericError(draft.closeAfterHours ?? 0,{minimum:0,maximum:168},'Auto-close hours'),
    entryToken: draft.entryToken && !/^0x[a-fA-F0-9]{40}$/.test(draft.entryToken.trim()) ? 'Enter a complete ERC-20 contract address.' : undefined,
    entryAmount:draft.entryToken ? numericError(draft.entryAmount,{minimum:1},'Token entry amount') : undefined,
    payoutAddress:draft.entryToken && draft.payoutMode === 'custom' && !/^0x[a-fA-F0-9]{40}$/.test(draft.payoutAddress ?? '') ? 'Enter a complete payout wallet address.' : undefined,
    openAt:draft.openMode === 'schedule' && (!draft.openAtLocal || !Number.isFinite(new Date(draft.openAtLocal).getTime()) || new Date(draft.openAtLocal).getTime() <= Date.now()) ? 'Choose an opening time in the future.' : undefined,
  }
  const allErrors = [...Object.values(basicErrors),...Object.values(ruleErrors),...hintErrors,...Object.values(feeErrors)].filter(Boolean)
  const currentStepErrors = wizardStep === 1 ? [] : wizardStep === 2 ? Object.values(basicErrors).filter(Boolean) : wizardStep === 3 ? [...Object.values(basicErrors),...Object.values(ruleErrors),...hintErrors].filter(Boolean) : allErrors
  const gameMeta = templates.data?.templates.find(template => template.templateId === draft.templateId)
  const gameAvailable = Boolean(gameMeta && (!gameMeta.playStatus || gameMeta.playStatus === 'live'))

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
    if (draft.templateId === 'boss-raid') rules.team_size = Number(rules.team_size)
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
    const nextConfig = {
      template_id: draft.templateId,
      template_version: ['reaction-duel','rps-duel'].includes(draft.templateId) ? 2 : 1,
      name: draft.name,
      description: draft.description,
      visibility: draft.visibility,
      mode: 'preview',
      rules,
      admission: { player_cap: isSolo ? 1 : draft.playerCap, min_ready_to_start: isSolo ? 1 : draft.minReady, spectators: false },
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
        ? { kind: 'erc20' as const, token: draft.entryToken.trim(), amount: draft.entryAmount }
        : { kind: 'free' as const },
      rewards: { kind: 'preview-points', slots: Number(draft.rules.world_version)>=3 && ['token-catch','boss-raid'].includes(draft.templateId) ? [{rank:1,points:draft.templateId==='token-catch'?Number(draft.rules.loot_budget):draft.rewardPoints}] : [{ rank: 1, points: draft.rewardPoints }, { rank: 2, points: Math.round(draft.rewardPoints / 2) }] },
      waitlist,
      branding: { preset: 'solar' },
      community_settings: {...communityOptions, timed_hints: timedHints.filter(h => h.text.trim()).map(h => ({...h, text: h.text.trim()}))},
    }
    if (rewardSettings.enabled) return {...nextConfig,mode:'testnet',rewards:{...rewardConfig(rewardSettings),forms}}
    if (forms.length) return {...nextConfig,rewards:{kind:forms[0].kind,slots:[],forms}}
    if (!sourceConfig) return nextConfig
    const sourceAccess = sourceConfig.access as Record<string,unknown>
    const sourceRewards = sourceConfig.rewards as {kind:string}
    return {...sourceConfig,...nextConfig,mode:sourceConfig.mode,access:{...sourceAccess,...nextConfig.access,vault_mode:sourceAccess.vault_mode,token:sourceAccess.token},rewards:sourceRewards.kind==='funded-assets'?sourceConfig.rewards:nextConfig.rewards}
  }

  const saveDraft = async () => {
    if (sourceLoading || fromRoom && !sourceConfig) return setError("Wait for the original room settings to load with the creator wallet.")
    if (allErrors.length && !fundingLocked) return setError('Correct the highlighted settings before saving or publishing.')
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
    if (sourceLoading || fromRoom && !sourceConfig) return setError('Wait for the original room settings to load with the creator wallet.')
    if (!gameAvailable) return setError('This game is currently unavailable. Pick a live game.')
    if (allErrors.length) return setError('Correct the highlighted settings before saving or publishing.')
    if (!session.token) return setError('Sign in with your wallet first.')
    setBusy(true)
    setError(null)
    try {
      const savedAttempt = sessionStorage.getItem(fundingAttemptKey)
      const attempt = savedAttempt ? JSON.parse(savedAttempt) as {config:ReturnType<typeof buildConfig>;nonce:string;rewards:ReturnType<typeof rewardConfig>} : null
      const config = attempt?.config ?? buildConfig()
      const publishNonce = attempt?.nonce ?? intentNonce
      let funding: Funding | undefined
      if (rewardSettings.enabled || attempt) {
        if (!session.address) throw new Error('Connect the creator wallet first.')
        const rewards = attempt?.rewards ?? {...rewardConfig(rewardSettings),forms}
        const prepared = await center.prepareRewards(config,publishNonce,session.token)
        sessionStorage.setItem(fundingAttemptKey,JSON.stringify({config,nonce:publishNonce,rewards}))
        setFundingLocked(true)
        funding = prepared.funding ?? await fundRewardPool(session.address,prepared,rewards,setStatus)
        setStatus('Deposit receipts confirmed. Backend is verifying pool inventory before publishing.')
      }
      const published = await center.publish(config, publishNonce, session.token, funding)
      // 2) if a join token is configured, bind it on-chain from the creator's wallet
      if (draft.entryToken && draft.entryAmount > 0 && session.address) {
        setStatus('Confirm your join token binding in your wallet.')
        const authorization = await center.gateAuthorization(published.roomId, session.token)
        await bindRoomOnChain(
          published.roomId,
          draft.entryToken,
          draft.entryAmount,
          draft.payoutMode ?? 'creator',
          draft.payoutAddress,
          session.address,
          (step, detail) => setStatus(detail ?? step),
          authorization,
        )
      }
      setStatus(
        published.replayed
          ? 'This publish was already processed — the original room was returned and nothing was charged twice.'
          : `Room created (${published.status}). ${published.charged} ${published.balanceLabel} deducted; balance now ${published.balanceAfter}.`,
      )
      sessionStorage.removeItem(fundingAttemptKey)
      setFundingLocked(false)
      go(published.shareUrl || `/center/rooms/${published.roomId}`)
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
      {fromRoom && <p className="ct-observer-note" role="status">{sourceLoading ? 'Loading the original room settings…' : 'Preparing a fresh room from the previous match. Its results and claims stay intact. Entry and funded rewards need fresh transactions; no wallet payment has been made here.'}</p>}
      {templates.loading && <p role="status">Checking game availability…</p>}
      {templates.error && <div className="err" role="alert"><p>Game availability could not be loaded. {templates.error}</p><button className="btn-ghost" onClick={() => setTemplateRetry(value => value + 1)}>Try again</button></div>}
      {gameMeta && !gameAvailable && <p className="ct-observer-note" role="status">{gameMeta.playStatus === 'maintenance' ? 'Under maintenance' : 'Offline'} · {gameMeta.maintenanceMessage || 'Try a live game while this world is unavailable.'}</p>}
      <section className="ct-panel" id="wiz-format" hidden={wizardStep !== 1}>
        <h2>1 · Pick a game</h2>
        {picking ? (
          <div className="ct-grid ct-grid-formats">
            {(templates.data?.templates ?? []).filter((t) => isFeaturedGame(t.templateId)).map((t: TemplateMeta) => (
              <button
                key={t.templateId}
                className={`ct-format${draft.templateId === t.templateId ? ' on' : ''}`}
                onClick={() => chooseTemplate(t.templateId)}
                disabled={Boolean(t.playStatus && t.playStatus !== 'live')}
                aria-pressed={draft.templateId === t.templateId}
              >
                <img src={`${import.meta.env.BASE_URL}center-art/${t.templateId}.webp`} alt="" width="320" height="200" loading="lazy" />
                <b>{FEATURED_GAMES.find((game) => game.id === t.templateId)?.name ?? t.label}</b>
                {t.playStatus && t.playStatus !== 'live' && <span className="ct-game-status-tag">{t.playStatus === 'maintenance' ? 'Under maintenance' : 'Offline'}</span>}
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
        <p className="muted">Name it, decide who can see it, and how many players fit. Rules stay fixed during each match; preview hosts can edit the next match after results.</p>
        <div className="ct-form">
          <label>
            <span>Name</span>
            <input value={draft.name} minLength={3} maxLength={60} aria-invalid={Boolean(basicErrors.name)} aria-describedby="room-name-help" onChange={(e) => set('name', e.target.value)} />
            {basicErrors.name && <small id="room-name-help" className="ct-field-error" aria-live="polite">{basicErrors.name}</small>}
          </label>
          <ArcadeChoices label="Who can discover your room?" value={draft.visibility} onChange={value => set('visibility', value as DraftState['visibility'])} options={[
            {value:'unlisted',label:'Link only',description:'Share a room code with your crew.'},
            {value:'public',label:'Everyone',description:'Appear in the active room browser.'},
            {value:'private',label:'Invite only',description:'A valid invite is required to enter.'},
          ]} />
          <label className="wide">
            <span>Description</span>
            <textarea rows={2} maxLength={1000} value={draft.description} onChange={(e) => set('description', e.target.value)} />
          </label>
          {hasDuration(draft.templateId) && (
            <ArcadeNumber label="Round length (seconds)" value={draft.durationSeconds} onChange={value => set('durationSeconds', value)} minimum={roundBounds.minimum} maximum={roundBounds.maximum} error={basicErrors.duration} help={`${roundBounds.minimum}–${roundBounds.maximum} seconds · up to 10 minutes. The objective may end a round earlier.`} />
          )}
          <ArcadeNumber label="Player cap" value={draft.playerCap} onChange={value => set('playerCap', value)} minimum={isSolo ? 1 : capMin} maximum={isSolo ? 1 : capMax} error={basicErrors.playerCap} />
          <ArcadeNumber label="Ready needed to start" value={draft.minReady} onChange={value => set('minReady', value)} minimum={isSolo ? 1 : capMin} maximum={draft.playerCap} error={basicErrors.minReady} help={draft.templateId === 'boss-raid' ? 'Players choose a crew in the lobby. Unassigned players are placed on a team at start.' : undefined} />
        </div>
      </section>

      <section className="ct-panel" id="wiz-rules" hidden={wizardStep !== 3}>
        <fieldset className="ct-community-options"><legend>Creator controls</legend>
          <p className="muted">Choose the atmosphere for your room. These controls can change during play.</p>
          <div className="ct-toggle-grid">
            <ArcadeToggle label="Mute player chat" kind="chat" description="Your announcements and hints stay available." checked={communityOptions.mute_chat} onChange={checked => {setCommunityOptions(prev => ({...prev,mute_chat:checked}));setEdited(true)}} />
            <ArcadeToggle label="Hide player names" kind="eye" description="Keep player identities private in the room." checked={communityOptions.hide_players} onChange={checked => {setCommunityOptions(prev => ({...prev,hide_players:checked}));setEdited(true)}} />
            <ArcadeToggle label="Hide the guess log" kind="shield" description="Keep each player's attempts off the public feed." checked={communityOptions.hide_guesses} onChange={checked => {setCommunityOptions(prev => ({...prev,hide_guesses:checked}));setEdited(true)}} />
          </div>
          <p className="muted">Your creator roster keeps verified names and wallets available to you. Reward receipts retain their contract identities.</p>
          <h3>Timed host hints</h3><p className="muted">Hints appear after the match starts. They stay private until their scheduled time.</p>
          {timedHints.map((hint,index) => <div key={index} className="ct-timed-hint">
            <ArcadeNumber label="Seconds after start" value={hint.delay_seconds} minimum={0} maximum={3600} error={numericError(hint.delay_seconds,{minimum:0,maximum:3600},'Hint delay')} onChange={value => {setTimedHints(prev => prev.map((h,i) => i === index ? {...h,delay_seconds:value} : h));setEdited(true)}} />
            <label><span>Hint message</span><input maxLength={500} value={hint.text} onChange={event => {setTimedHints(prev => prev.map((h,i) => i === index ? {...h,text:event.target.value} : h));setEdited(true)}} /></label>
            <button className="btn-ghost" onClick={() => {setTimedHints(prev => prev.filter((_,i) => i !== index));setEdited(true)}}>Remove hint</button>
          </div>)}
          <button className="btn-ghost" disabled={timedHints.length >= 20} onClick={() => {setTimedHints(prev => [...prev,{delay_seconds:30,text:''}]);setEdited(true)}}>Add timed hint</button>
        </fieldset>
        <h2>3 · {TEMPLATE_FORMS[draft.templateId]?.label ?? draft.templateId} rules & hints</h2>
        <p className="muted">Every field below only affects THIS game format. Anything you skip runs on its default.</p>
        <div className="ct-form">
          {ruleFields.map((f: RuleField) => {
            const value = draft.rules[f.key]
            if (f.kind === 'toggle') {
              return (
                <ArcadeToggle key={f.key} label={f.label} description={f.help} checked={Boolean(value)} onChange={checked => setRule(f.key, checked)} />
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
                <ArcadeChoices key={f.key} label={f.label} value={asString} options={f.options} onChange={choice => {setRule(f.key, choice);Object.entries(f.options.find(option=>option.value===choice)?.patch ?? {}).forEach(([key,value])=>setRule(key,value))}} help={f.help} />
              )
            }
            if (f.kind === 'shares') return <ArcadeShares key={f.key} label={f.label} value={Array.isArray(value) ? value as number[] : []} count={Number(draft.rules.winning_teams ?? 3)} onChange={shares => setRule(f.key, shares)} error={ruleErrors[f.key]} help={f.help} />
            return (
              <ArcadeNumber key={f.key} label={f.label} value={typeof value === 'number' ? value : ruleNumber(value)} onChange={number => setRule(f.key, number)} minimum={boundsFor(f).minimum} maximum={boundsFor(f).maximum} step={f.step} error={ruleErrors[f.key]} help={f.help} />
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
                  <ArcadeChoices label="Who sees hint results?" value={draft.hintVisibility} onChange={value => set('hintVisibility',value as DraftState['hintVisibility'])} options={[{value:'private',label:'Just the guesser',description:'Your next clue is personal.'},{value:'public',label:'Whole room',description:'Everyone can learn from each attempt.'}]} />
                </>
              ) : draft.templateId === 'puzzle-sprint' ? (
                <>
                  <p>Legal-move hint: asking suggests ONE legal tile beside the blank, to that player only — never the solution path. Each use adds a small move penalty to the score. Set the uses per player.</p>
                  <ArcadeChoices label="Puzzle hints" value={draft.rules.hints === 'on' ? 'on' : 'off'} onChange={value => setRule('hints', value)} options={[{value:'off',label:'Solve unaided',description:'Players work out each move themselves.'},{value:'on',label:'Private move clue',description:'Suggest one legal move beside the blank.'}]} help="The server suggests a legal move only to the requesting player. It never reveals the solution path." />
                  {draft.rules.hints === 'on' && (
                    <>
                      <ArcadeNumber label="Hints per player" minimum={1} maximum={10} value={ruleNumber(draft.rules.hint_budget)} onChange={value => setRule('hint_budget', value)} help="The maximum private move clues each player can request in a round." />
                      <ArcadeNumber label="Move penalty per hint" minimum={0} maximum={10} value={ruleNumber(draft.rules.hint_move_penalty)} onChange={value => setRule('hint_move_penalty', value)} help="Add these scoring moves for every hint used; 0 makes clues free." />
                    </>
                  )}
                </>
              ) : draft.templateId === 'memory-match' ? (
                <>
                  <p>Bounded pair reveal: asking shows ONE hidden matching pair face-up, to that player only. It never maps the remaining board. Set how many reveals each player gets.</p>
                  <ArcadeChoices label="Memory hints" value={draft.rules.hints === 'on' ? 'on' : 'off'} onChange={value => setRule('hints', value)} options={[{value:'off',label:'Trust your memory',description:'No extra card reveals.'},{value:'on',label:'Private pair reveal',description:'Show one matching pair to the requesting player.'}]} help="Each clue reveals one pair, not the remaining board. Choose a reveal budget for each player." />
                  {draft.rules.hints === 'on' && (
                    <ArcadeNumber label="Reveals per player" minimum={1} maximum={5} value={ruleNumber(draft.rules.hint_budget)} onChange={value => setRule('hint_budget', value)} help="How many private matching-pair reveals each player may request in this round." />
                  )}
                </>
              ) : draft.templateId === 'live-quiz' ? (
                <>
                  <p>Elimination cue: after asking, one wrong choice is struck out for that player only. The server never eliminates the correct answer. Choose how many wrong choices a player may strike out per question.</p>
                  <ArcadeChoices label="Quiz hints" value={draft.rules.hints === 'on' ? 'on' : 'off'} onChange={value => setRule('hints', value)} options={[{value:'off',label:'Answer unaided',description:'Keep every answer option in play.'},{value:'on',label:'Private elimination',description:'Remove a wrong answer for the requesting player.'}]} help="The server strikes out incorrect choices only; it never marks or removes the correct answer." />
                  {draft.rules.hints === 'on' && (
                    <ArcadeNumber label="Eliminations per question" minimum={1} maximum={3} value={ruleNumber(draft.rules.hint_eliminations)} onChange={value => setRule('hint_eliminations', value)} help="The maximum wrong choices a player can strike out on each question." />
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
        {fundingLocked && <p role="status">A funded publication is in progress. Publish again to resume its saved configuration and check pending receipts.</p>}

        {fundingLocked&&<button type="button" className="btn-ghost" disabled={busy} onClick={()=>{const prefix=`orbix-reward-fund:${session.address?.toLowerCase()}:`;if(Object.keys(sessionStorage).some(key=>key.startsWith(prefix))){setError('This attempt has a funding journal or pending transaction. Retry the same attempt to verify it.');return}sessionStorage.removeItem(fundingAttemptKey);setFundingLocked(false);setError(null)}}>Edit settings if no funding transaction was submitted</button>}
        <FundedRewardsSetup session={session} templateId={draft.templateId} settings={rewardSettings} disabled={busy || fundingLocked} onChange={value=>{setRewardSettings(value);setEdited(true)}}/>
        <p className="muted">{sourceOnchain ? 'This copy retains the original onchain vault and its token units. New entry and reward funding are separate transactions.' : 'What it costs to play, what the winner takes, and who pays the joiner fee. These room fees use preview credits. Token entry, when configured, requires a separate wallet transaction.'}</p>
        <div className="ct-form">
          <div className="wz-why">The play fee is charged to YOU once at publish — it is the cost of running the room, not something players pay.</div>
          <ArcadeNumber label={sourceOnchain ? 'Creator vault fee (token base units)' : 'Play fee (preview credits)'} value={draft.requiredAmount} minimum={0} error={feeErrors.requiredAmount} onChange={value => set('requiredAmount',value)} help={sourceOnchain ? 'Retains the original onchain vault token. Confirm independent funding before starting this new room.' : 'Deducted from your preview-credit ledger when you publish.'} />
          <ArcadeNumber label={sourceOnchain ? "Joiner vault fee (token base units)" : "Joiner fee per player (preview credits)"} value={draft.entryToken ? 0 : draft.joinerFee} minimum={0} error={feeErrors.joinerFee} onChange={value => set('joinerFee',draft.entryToken ? 0 : value)} help={draft.entryToken ? 'Token entry is enabled; no extra preview joiner fee is charged.' : 'Each player pays this unless you absorb it.'} />
          <ArcadeToggle label={sourceOnchain ? "I cover joiner vault fees" : "I cover preview joiner fees"} description={sourceOnchain ? "The creator pays the applicable vault fees in the retained token." : "The creator pays the applicable preview-credit joiner fees."} checked={draft.absorbsJoinerFee} onChange={checked => set('absorbsJoinerFee',checked)} />
          <CreatorTokenFees token={draft.entryToken} amount={draft.entryAmount} payoutMode={draft.payoutMode} payoutAddress={draft.payoutAddress} creatorAddress={session.address}>
          <label>
            <span>Join token contract (any ERC-20, optional)</span>
            <input
              value={draft.entryToken}
              spellCheck={false}
              autoComplete="off"
              placeholder="0x… paste any ERC-20 contract address"
              onChange={(e) => set('entryToken', e.target.value.trim())}
            />
            <small className={feeErrors.entryToken ? 'ct-field-error' : undefined} aria-live="polite">{feeErrors.entryToken ?? 'Paste the ERC-20 token joiners will pay. Leave empty for free token entry.'}</small>
          </label>
          {draft.entryToken && (
            <>
              <ArcadeNumber label="Join amount (in the chosen token)" minimum={1} value={draft.entryAmount} error={feeErrors.entryAmount} onChange={value => set('entryAmount',value)} help="Whole token units. Each joiner pays this amount through the creator gate." />
              <ArcadeChoices label="Where entry payments go" value={draft.payoutMode ?? 'creator'} onChange={value => set('payoutMode',value as 'creator' | 'custom' | 'burn')} options={[{value:'creator',label:'My wallet'},{value:'custom',label:'Another wallet'},{value:'burn',label:'Burn',description:'Irreversible transfer to the burn address.'}]} />
              {draft.payoutMode === 'custom' && (
                <label>
                  <span>Custom payout address</span>
                  <input
                    value={draft.payoutAddress ?? ''}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="0x… wallet to receive join fees"
                    onChange={(e) => set('payoutAddress', e.target.value.trim())}
                  />
                  <small className={feeErrors.payoutAddress ? 'ct-field-error' : undefined} aria-live="polite">{feeErrors.payoutAddress ?? 'Tokens from every joiner will be sent here.'}</small>
                </label>
              )}
              {draft.payoutMode === 'burn' && (
                <div className="wz-why">Tokens go to 0x…dEaD and become unavailable. This is irreversible; it does not guarantee a reduction in the token’s reported total supply.</div>
              )}
            </>
          )}
          </CreatorTokenFees>
          <ArcadeChoices label="When does your lobby open?" value={draft.openMode ?? 'now'} onChange={value => set('openMode',value as 'now' | 'schedule')} options={[{value:'now',label:'Right now',description:'Invite players as soon as you publish.'},{value:'schedule',label:'Schedule it',description:'Set a start time for your community.'}]} />
          {draft.openMode === 'schedule' && (
            <label>
              <span>Open at</span>
              <input
                type="datetime-local"
                value={draft.openAtLocal ?? ''}
                onChange={(e) => set('openAtLocal', e.target.value)}
              />
              <small className={feeErrors.openAt ? 'ct-field-error' : undefined} aria-live="polite">{feeErrors.openAt ?? 'The room becomes joinable at this time.'}</small>
            </label>
          )}
          <ArcadeNumber label="Auto-close after (hours, 0 = never)" minimum={0} maximum={168} value={draft.closeAfterHours ?? 0} onChange={value => set('closeAfterHours',value)} error={feeErrors.closeAfterHours} />
          {<RoomRewardsGuide funded={rewardSettings.enabled||Boolean(sourceFunding)} currentDescription={forms.length?`Form rewards · FREE${rewardSettings.enabled?' + funded prize':''}`:undefined} onChoose={type=>{if(type==='waitlist-form'||type==='qa-form'){setForms(previous=>previous.some(f=>f.kind===type)?previous:[...previous,newForm(type)]);setEdited(true);return}if(type==='points'){setForms([]);setRewardSettings(previous=>({...previous,enabled:false}));return}setRewardSettings({...initialRewardSettings(),enabled:true,kind:type==='nft'?'erc721':type==='token'?'erc20':type});document.querySelector('.fr-setup')?.scrollIntoView({block:'start',behavior:'instant'})}}>
          {forms.length&&!rewardSettings.enabled?<p>Eligible players receive the selected form rewards. No points or wallet assets are allocated.</p>:sourceFunding ? <div className="wz-why"><strong>Original funded prize configuration retained</strong><p>This new room needs its own confirmed prize inventory. Previous match deposits and claims stay with the original room. Fund the new room before starting.</p></div> : draft.templateId==='token-catch' && Number(draft.rules.world_version)>=3 ? <ArcadeNumber label="Total airdrop loot pool (preview units)" minimum={1} maximum={10000} value={Number(draft.rules.loot_budget)} onChange={value=>setRule('loot_budget',value)} error={ruleErrors.loot_budget} help="The complete pool is split across the scheduled airdrops. Every collector receives their final collected share as preview points. These are game units, not a wallet transfer."/> : <ArcadeNumber label={draft.templateId==='boss-raid' ? 'Total crew prize pool (preview points)' : 'Winner points (preview)'} minimum={0} value={draft.rewardPoints} onChange={value => set('rewardPoints',value)} error={feeErrors.rewardPoints} help={draft.templateId === 'boss-raid' ? 'This is the complete prize pool. The podium percentages split it between qualifying crews, then the chosen member rule divides each crew share. Game points are separate from wallet tokens.' : 'Game points are separate from wallet tokens. Set to 0 for no preview points.'} />}
          <FormRewardSetup forms={forms} disabled={busy||fundingLocked} onChange={value=>{setForms(value);setEdited(true)}}/>
          </RoomRewardsGuide>}
        </div>

        <div className="wz-why" style={{ marginTop: 14 }}>
          {rewardSettings.enabled ? 'Your wallet creates and deposits into RewardEngine. The backend verifies the confirmed inventory before publishing.' : sourceFunding ? 'This copy retains funded prize settings. Publishing creates a new room and does not reuse or transfer previous deposits.' : forms.length ? 'This room rewards eligible participants with a free form. No reward funds move.' : 'This wizard publishes preview-point rooms. Publishing here does not fund token, NFT or native-currency prizes.'}
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
            <div><small>Play fee</small><b>{draft.requiredAmount} {sourceOnchain ? "token base units" : "preview credits"}</b></div>
            <div><small>Joiner fee</small><b>{draft.entryToken ? `${draft.entryAmount} (token)` : draft.joinerFee ? `${draft.joinerFee} preview credits` : 'Free'}</b></div>
            <div><small>{['token-catch','boss-raid'].includes(draft.templateId)?'Total game reward pool':'Winner reward'}</small><b>{rewardSettings.enabled ? `${rewardSettings.count} × ${rewardSettings.amount} ${rewardSettings.kind} base units` : sourceFunding ? 'Funded inventory required' : forms.length ? forms.map(f=>f.kind==='qa-form'?'Q&A form · FREE':'Waitlist form · FREE').join(' + ') : `${draft.templateId==='token-catch'?Number(draft.rules.loot_budget):draft.rewardPoints} preview points`}</b></div>
          </div>
        </div>
      {currentStepErrors.length > 0 && <p className="ct-field-error ct-validation-summary" role="status">{currentStepErrors.length} setting{currentStepErrors.length === 1 ? '' : 's'} need attention. Check the messages beside your fields.</p>}
      <div className="ct-wizard-actions">
        <button className="btn-ghost" onClick={() => changeStep(Math.max(1, wizardStep - 1))} disabled={busy || wizardStep === 1}>Previous step</button>
        <span>Step {wizardStep} of 4</span>
        {wizardStep < 4 ? <button className="btn-primary" onClick={() => changeStep(wizardStep + 1)} disabled={busy || currentStepErrors.length > 0 || !gameAvailable || templates.loading || !templates.data?.templates.some(template => template.templateId === draft.templateId)}>Continue</button> : <div className="ct-actions"><button className="btn-ghost" onClick={saveDraft} disabled={busy || allErrors.length > 0 || !session.token || templates.loading || Boolean(templates.error)}>Save draft</button><button className="btn-primary" onClick={session.token ? publish : onConnect} disabled={busy || !fundingLocked && allErrors.length > 0 || !gameAvailable || session.signingIn || templates.loading || Boolean(templates.error)}>{busy ? 'Publishing…' : session.token ? 'Publish room' : 'Connect to publish'}</button></div>}
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

function RoomRoute({ roomId, session }: { roomId: string; session: ReturnType<typeof useSession> }) {
  const numeric = /^[1-9]\d{2,9}$/.test(roomId)
  const [resolved, setResolved] = useState<string | null>(numeric ? null : roomId)
  const [failure, setFailure] = useState<string | null>(null)
  useEffect(() => {
    if (!numeric) { setResolved(roomId); return }
    let active = true
    setResolved(null); setFailure(null)
    center.resolveRoomCode(roomId, session.token ?? undefined, new URLSearchParams(window.location.search).get('invite') ?? undefined)
      .then(data => { if (active) setResolved(data.roomId) })
      .catch(error => { if (active) setFailure(explainError(error)) })
    return () => { active = false }
  }, [roomId, numeric, session.token])
  if (resolved) return <Room key={resolved} roomId={resolved} session={session} />
  return <div className="ct-page"><h1>Room {roomId}</h1>{failure ? <p className="err" role="alert">{failure} · Private rooms need a connected wallet or the host’s complete invite link.</p> : <p role="status">Opening your room…</p>}</div>
}

function Room({ roomId, session }: { roomId: string; session: ReturnType<typeof useSession> }) {
  const adminObserver = new URLSearchParams(window.location.search).get('observe') === '1'
  const immersion = useRef<ImmersionHandle>(null)
  const reconnectAttempt=useRef<string|null>(null)
  const resultElement = useRef<HTMLElement>(null)
  const [presentedRound, setPresentedRound] = useState<string | null>(null)
  const scrolledResult = useRef<string | null>(null)
  const roomElement = useRef<HTMLDivElement>(null)
  const expandButton = useRef<HTMLButtonElement>(null)
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
  const refreshPending = useRef(false)
  const latestRound = useRef<string | undefined>(undefined)
  const resetChannel = useRef<() => void>(() => {})
  const [editingRematch, setEditingRematch] = useState(false)
  const [rematchNotice, setRematchNotice] = useState<string | null>(null)
  const [winnerProfiles, setWinnerProfiles] = useState<Record<string, {name:string;hasImage?:boolean;character?:string;cosmetics?:import('./characters').Cosmetics}>>({})

  const refresh = useCallback(async () => {
    if (refreshPending.current || adminObserver && !session.token) return
    refreshPending.current = true
    try {
      const data = await center.room(roomId, session.token ?? undefined)
      if (latestRound.current && data.roundId !== latestRound.current) { setSettlement(null); setReject(null); resetChannel.current() }
      latestRound.current = data.roundId
      setRoom(data)
      if (data.settlement) setSettlement(data.settlement)
    } catch (err) {
      setError(explainError(err))
    } finally { refreshPending.current = false }
  }, [roomId, session.token, adminObserver])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => { if (!document.hidden) void refresh() }, adminObserver ? 500 : 5000)
    return () => window.clearInterval(t)
  }, [refresh, adminObserver])

  const channel = useRoomChannel(roomId, {
    onSettlement: (payload) => setSettlement(payload as unknown as Settlement),
    onRoundStarted: () => { setSettlement(null); setReject(null); void refresh() },
    onRematch: () => { setSettlement(null); setReject(null); void refresh() },
    onRejected: (code) => setReject(code),
    onReconnectTicket: async () => {
      if (!session.token) throw new Error('Sign in to reconnect.')
      return (await center.join(roomId, session.token, new URLSearchParams(window.location.search).get('invite') ?? undefined)).ticket
    },
  })
  resetChannel.current = channel.reset

  const playAgain = async (config?: Record<string,unknown>) => {
    if (!session.token) return
    setBusy(true); setError(null)
    try {
      await center.rematch(roomId, session.token, config)
      channel.reset(); setSettlement(null); setReject(null)
      setEditingRematch(false); setRematchNotice('Next match is open. Everyone must reconnect if needed and press Ready before the creator starts.')
      await refresh()
    } catch (failure) { setError(explainError(failure)); if (config) throw failure }
    finally { setBusy(false) }
  }

  const join = async () => {
    if (adminObserver) return
    if (!session.token) return setError('Sign in first.')
    // A room with a join token shows a signing preview before anything is sent.
    if (entryToken && entryAmount > 0 && session.address) {
      setPreviewOpen(true)
      return
    }
    await doJoin()
  }

  const doJoin = async () => {
    if (!session.token || adminObserver) return
    setPreviewOpen(false)
    setBusy(true)
    setError(null)
    try {
      if (entryToken && entryAmount > 0 && session.address) {
        await payJoinTokenGated(roomId, entryToken, entryAmount, session.address, (step, detail) => setJoinStep(step, detail), room?.entryGate, {creator:room?.owner ?? '',payee:access.payout_mode==='burn'?2:access.payout_mode==='custom'?1:0,payout:access.payout_mode==='burn'?BURN_ADDRESS:access.payout_mode==='custom'?(access.payout_address ?? ''):(room?.owner ?? '')})
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
    immersion.current?.enter()
    setBusy(true)
    try {
      await center.start(roomId, session.token)
      await refresh()
    } catch (err) {
      immersion.current?.minimize()
      setError(explainError(err))
    } finally {
      setBusy(false)
    }
  }

  const cancelRoom = async () => {
    if (!session.token) return
    // Guideline: destructive actions need confirmation — never immediate.
    const sure = window.confirm(
      'Cancel this room? It cannot be reopened. Token entry payments sent through the creator gate are not automatically refunded by cancelling a room.',
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

  const state: Record<string, any> = channel.state ?? { ...(room?.publicState ?? {}), roundId: room?.roundId, __deadline: room?.deadline, serverTimeMs: room?.serverTimeMs }
  const templateId = String(room?.config?.template_id ?? '')
  const Stage = FOUR_STAGE_VIEWS[templateId] ?? STAGES[templateId]
  const me = (session.address ?? '').toLowerCase()
  // F5 pre-sign disclosure fields (typed reads; the server config is the source)
  const access = (room?.config?.access ?? {}) as { required_amount?: number; joiner_fee?: number; creator_absorbs_joiner_fee?: boolean; payout_mode?: string; payout_address?: string }
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
  const amPlayer = !adminObserver && players.includes(me)
  const [formsReady,setFormsReady] = useState(false)
  const finished = Boolean(state.finished) || Boolean(settlement) || room?.status === 'claimable'
  const isHost = !adminObserver && room?.owner?.toLowerCase() === me
  useEffect(() => {
    const addresses = (settlement?.results ?? []).map(row => row.who).filter(wallet => /^0x[0-9a-f]{40}$/i.test(wallet)).slice(0, 50)
    if (!addresses.length || room?.communitySettings?.hidePlayers && !isHost && !adminObserver) { setWinnerProfiles({}); return }
    let active = true
    center.getProfiles(addresses).then(profiles => { if (active) setWinnerProfiles(profiles) }).catch(() => {})
    return () => { active = false }
  }, [settlement, room?.communitySettings?.hidePlayers, isHost, adminObserver])
  const podium = useMemo(() => verifiedPodium({templateId,settlement,state,players,profiles:Object.fromEntries(Object.entries({...winnerProfiles,...room?.appearances}).map(([who])=>[who,{...winnerProfiles[who],...room?.appearances?.[who]}])),characters:Object.fromEntries(Object.entries(room?.appearances??{}).map(([who,appearance])=>[who,appearance.character??'blob']))}), [settlement,templateId,state,players,winnerProfiles,room?.characters,room?.appearances])
  // A stage may only draw from state the server has actually sent for this round.
  const hasRoundState = Boolean(state.template)
  const currentRound = String(state.roundId ?? room?.roundId ?? `${roomId}:live`)
  useEffect(()=>setFormsReady(false),[roomId,currentRound,session.token])
  const onPodiumPresented = useCallback(() => setPresentedRound(currentRound), [currentRound])
  const placement = settlement ? localPlacement(settlement.results, me, state.teams, state.teamRankings) : undefined
  useEffect(() => {
    if (!finished) { scrolledResult.current = null; return }
    if (settlement && podium.length > 0 && presentedRound !== currentRound || scrolledResult.current === currentRound) return
    // Wait for shell restoration and the result anchor layout.
    const frame = requestAnimationFrame(() => {
      const element = resultElement.current
      if (!element) return
      scrolledResult.current = currentRound
      element.focus({ preventScroll: true })
      element.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [finished, currentRound, Boolean(settlement), podium.length, presentedRound])
  useEffect(()=>{
    const key=`${roomId}:${me}:${session.token}`
    if(adminObserver || !amPlayer || room?.status!=='running' || !session.token || channel.status!=='idle' || reconnectAttempt.current===key)return
    reconnectAttempt.current=key
    void center.join(roomId,session.token,new URLSearchParams(window.location.search).get('invite')??undefined)
      .then(joined=>{setTicket(joined.ticket);channel.connect(joined.ticket)})
      .catch(err=>setError(explainError(err)))
  },[roomId,me,session.token,room?.status,amPlayer,adminObserver,channel.status,channel.connect])

  return (
    <div ref={roomElement} className="ct-page ct-game-room">

      {<Banner />}
      {room?.gameStatus && room.gameStatus !== 'live' && <p className="ct-observer-note" role="status">{room.gameStatus === 'maintenance' ? 'Under maintenance' : 'Game offline'} · {room.maintenanceMessage || 'New rooms and admissions are paused. Existing live matches can finish.'}</p>}
      {adminObserver && <p className="ct-observer-note" role="status">Admin observation · your visit does not add a participant or announce a join to the room.</p>}
      <header className="ct-head">
        <div>
          <h1>{String(room?.config?.name ?? 'Room')}</h1>
          <p className="sub">
            {templateId} · <span className={`pill s-${room?.status}`}>{STATUS_LABEL[room?.status ?? ''] ?? room?.status}</span> ·{' '}
            <span className="mono">Room {room?.roomNumber ?? '…'}</span>
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
        {joinStep && <p className="muted" role="status" aria-live="polite">{joinStep}</p>}
        <TxPreview
          open={previewOpen}
          title="Join this room — confirm the transaction"
          busy={busy}
          steps={[
            { label: 'Approve', detail: `Step 1 — approve the gate to transfer ${entryAmount} of the room token from your wallet. Your wallet will ask you to sign. This only happens if your current allowance is lower than the join amount.`, contract: entryToken, fn: 'approve(spender, amount)', value: `${entryAmount} token units`, args: [['spender (gate)', room?.entryGate ?? GATE_ADDRESS]] },
            { label: 'Join', detail: (room?.entryGate ?? GATE_ADDRESS).toLowerCase()===LEGACY_GATE ? 'This existing room uses the legacy gate. Its current fee and payout may change before confirmation. The server verifies payment before admission.' : 'Sign the displayed token, fee and payout quote, then confirm payment. A changed quote reverts. The server verifies payment before admission.', contract: room?.entryGate ?? GATE_ADDRESS, fn: (room?.entryGate ?? GATE_ADDRESS).toLowerCase()===LEGACY_GATE?'join(roomId)':'joinQuoted(roomId, nonce, signature)', args: [['roomId', roomId]] },
          ]}
          onConfirm={doJoin}
          onCancel={() => setPreviewOpen(false)}
        />

      <section className="ct-panel ct-room-meta" hidden={adminObserver}>
        <h2>Players</h2>
        <div className="ct-players">
          {(room?.participants ?? []).map((p) => (
            <span key={p.who} className={`who-chip${p.ready ? ' ready' : ''}`} style={{ ['--hue' as string]: playerHue(p.who) }}>
              <CharacterBadge appearance={room?.appearances?.[p.who]}/> {shortAddress(p.who)} {p.role === 'host' ? '· host' : ''} {p.ready ? '· ready' : ''}
            </span>
          ))}
          {(room?.participants ?? []).length === 0 && <span className="muted">Nobody yet.</span>}
        </div>
        <div className="ct-actions">
          {!ticket && (
            <details className="ct-presign">
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
                    : ['waitlist-form','qa-form'].includes(rewardKind) ? 'free form responses; no funds or points move' : 'preview points only; these are not transferable assets'}
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
                    ? 'this room was cancelled. Creator-gate token payments are direct payments and require the recipient to return them separately'
                    : entryToken ? 'token entry is paid directly through the creator gate. Room cancellation does not automatically return that payment' : 'preview rooms use game credit; token refunds are not involved'}
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
            <button className="btn-primary" onClick={join} disabled={busy || !session.token || Boolean(room?.archived) || Boolean(room?.gameStatus && room.gameStatus !== 'live' && !amPlayer)} title={!session.token ? "Sign in with your wallet to join" : undefined}>
              {busy && joinStep ? 'Working…' : players.includes(me) ? 'Reconnect to room' : 'Join room'}
            </button>
          )}
          {templateId === 'boss-raid' && (room?.config?.rules as {team_mode?:string})?.team_mode === 'teams' && room?.status !== 'running' && !finished && (() => {
            const rules = room?.config?.rules as {arena_mode?:boolean;team_size?:number}
            const teamSize = Number(rules.team_size ?? 3)
            const teamIds = rules.arena_mode ? Array.from({length:Math.max(2,Math.ceil(Number((room?.config?.admission as {player_cap?:number})?.player_cap ?? 12) / teamSize))},(_,i) => `team-${i + 1}`) : ['a','b']
            return <div className="ct-team-picker"><strong>Choose your crew · up to {teamSize} players</strong><p>Choose a squad card or let the lobby assign you. Crews rank by boss damage; the published podium shares determine prizes.</p><div className="ct-team-grid">{teamIds.map((team,index) => {const members=Object.entries(room?.teams ?? {}).filter(([,t])=>t===team);return <button key={team} className={`ct-squad-card${room?.teams?.[me]===team?' is-selected':''}`} aria-pressed={room?.teams?.[me]===team} disabled={!amPlayer || busy || members.length>=teamSize && room?.teams?.[me]!==team} onClick={async () => { if (!session.token) return; try { await center.chooseTeam(roomId,session.token,team);await refresh() } catch(err) {setError(explainError(err))} }}><span className="ct-squad-banner">✦ <strong>Crew {index+1}</strong><small>{members.length}/{teamSize} slots</small></span><span className="ct-squad-slots">{Array.from({length:teamSize},(_,slot)=><i key={slot} title={members[slot]?.[0]}>{members[slot]?'●':'+'}</i>)}</span><span>{room?.teams?.[me]===team?'Your squad':members.length>=teamSize?'Squad full':'Join this squad'}</span></button>})}</div></div>
          })()}
          {['token-catch','boss-raid','combat-duel'].includes(templateId) && (templateId === 'combat-duel' || (room?.config?.rules as {arena_mode?:boolean})?.arena_mode) && room?.status !== 'running' && !finished && <CharacterPicker selected={room?.appearances?.[me]?.character ?? 'blob'} disabled={!amPlayer || busy || !session.token} onChoose={async character => {
            if (!session.token || !amPlayer) return
            setBusy(true)
            try { await center.chooseCharacter(roomId,session.token,character); await refresh() } catch (err) { setError(explainError(err)) } finally { setBusy(false) }
          }} />}
          {ticket && !finished && (
            <button className="btn-ghost" aria-pressed={Boolean(room?.participants.find(p => p.who.toLowerCase() === me)?.ready)} disabled={!amPlayer || busy || channel.status !== 'open' || !session.token} onClick={async () => {
              if (!session.token) return
              if (!room?.participants.find(p => p.who.toLowerCase() === me)?.ready) immersion.current?.enter()
              setBusy(true)
              try { await center.ready(roomId,session.token,!room?.participants.find(p => p.who.toLowerCase() === me)?.ready); await refresh() } catch (failure) {immersion.current?.minimize();setError(explainError(failure))} finally {setBusy(false)}
            }}>
              {room?.participants.find(p => p.who.toLowerCase() === me)?.ready ? 'Ready ✓ · click to pause' : 'Ready & enter'}
            </button>
          )}
          {isHost && room?.status !== 'running' && !finished && (
            <button className="btn-primary" onClick={start} disabled={busy || Boolean(room?.gameStatus && room.gameStatus !== 'live') || Boolean(room?.archived)}>
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
              Cancel room
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
        <SharePanel roomId={roomId} roomNumber={room?.roomNumber} visibility={room?.visibility ?? 'unlisted'} invite={inviteGenerated ?? undefined} />
        {inviteGenerated && (
          <p className="st-note mono" translate="no">
            Private invite ready for room {room?.roomNumber}.
            <button className="link" onClick={() => void copyText(`${window.location.origin}/center/rooms/${room?.roomNumber ?? roomId}?invite=${encodeURIComponent(inviteGenerated)}`)}>Copy invite link</button>
          </p>
        )}
        {!session.token && <p className="muted">Sign in with your wallet to join and play.</p>}
      </section>

      <section className="ct-panel ct-room-play">
        {<div className="ct-play-panel-heading"><h2>Play</h2>{hasRoundState && <button ref={expandButton} className="btn-ghost" onClick={() => immersion.current?.enter()}>Resume game <span aria-hidden="true">↗</span></button>}</div>}
        <RoundImmersion ref={immersion} active={!finished && room?.status==='running'} roundId={currentRound} movement={['token-catch','boss-raid','combat-duel'].includes(templateId)}>{() => <>
        {!Stage && <p className="muted">Waiting for the room configuration…</p>}
        {Stage && !hasRoundState && <><RoundPending status={room?.status} />{['token-catch','boss-raid','combat-duel'].includes(templateId) ? <Suspense fallback={<p role="status">Preparing your characters…</p>}><CharacterLobby players={players} appearances={room?.appearances??{}} me={me}/></Suspense> : isFeaturedGame(templateId) && <Suspense fallback={<p className="muted">Preparing your world…</p>}><LobbyWorld game={templateId as 'number-hunt' | 'boss-raid' | 'token-catch' | 'reaction-duel'} state={room?.config?.rules ?? {}} me={me} players={players} /></Suspense>}</>}
        {Stage && hasRoundState && (
          <Stage
            state={{ ...state, _roomId: roomId, _roundId: state.roundId, _appearances: state.appearances ?? room?.appearances, _spectating: !amPlayer, _adminObserver: adminObserver, _hidePlayers: room?.communitySettings?.hidePlayers, _hideGuesses: room?.communitySettings?.hideGuesses, _canAct: amPlayer && channel.status === 'open' && room?.status === 'running', _connection: channel.status, _actionError: reject }}
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
        </>}</RoundImmersion>
      </section>

      {adminObserver && session.token && <AdminRoomTools roomId={roomId} session={session} roomStatus={room?.status} onChanged={() => void refresh()} />}
      {(amPlayer || isHost) && <RoomCommunity roomId={roomId} session={session} isHost={isHost} roomStatus={room?.status} onSettingsChange={settings => setRoom(prev => prev ? {...prev, communitySettings: settings} : prev)} onRosterChange={() => void refresh()} />}
      {rematchNotice && <p className="ct-observer-note" role="status">{rematchNotice}</p>}
      {rewardKind === 'funded-assets' && finished && session.token && <MyRewards session={session} roomId={roomId} onContinue={Boolean((room?.config.rewards as {forms?:FormReward[]})?.forms?.length)?()=>setFormsReady(true):undefined}/>}
      {rewardKind === 'funded-assets' && isHost && finished && <CreatorRewardAllocation session={session} roomId={roomId}/>}
      {isHost && finished && room && <section className="ct-rematch-panel"><div><span>KEEP THE CREW TOGETHER</span><h2>One more round?</h2><p>{room.rematch?.supported ? 'Keep this room and its players. Each match gets its own result, and everyone confirms readiness again.' : 'This room uses a financial entry or funded reward. A fresh room and funding are required for the next match.'}</p></div><div className="ct-actions">{room.rematch?.supported ? <><button className="btn-primary" disabled={busy} onClick={() => void playAgain()}>Play again · same settings</button><button className="btn-ghost" disabled={busy} onClick={() => setEditingRematch(true)}>Edit next match</button></> : <button className="btn-primary" onClick={() => go(`/center/create/${templateId}?from=${roomId}`)}>Prepare a fresh room</button>}</div></section>}
      {editingRematch && room && <Suspense fallback={<p role="status">Opening next-match settings…</p>}><RematchSettings room={room} onClose={() => setEditingRematch(false)} onSave={playAgain} /></Suspense>}
      {isHost && session.token && Boolean((room?.config.waitlist as WaitlistOptions | undefined)?.enabled) && <CreatorWaitlist roomId={roomId} token={session.token}/>}
      {isHost && session.token && ((room?.config.rewards as {forms?:FormReward[]})?.forms??[]).map(form=><CreatorFormResponses key={form.kind} roomId={roomId} token={session.token!} kind={form.kind}/>)}
      {finished && amPlayer && session.token && Boolean((room?.config.rewards as {forms?:FormReward[]})?.forms?.length) && <ResultForms key={`${roomId}:${currentRound}:${me}`} roomId={roomId} roundId={currentRound} session={session} ready={rewardKind!=='funded-assets'||formsReady}/>}
      {finished && amPlayer && session.token && Boolean((room?.config.waitlist as WaitlistOptions | undefined)?.enabled) && <ResultWaitlist key={`${roomId}:${me}`} roomId={roomId} roundId={currentRound} options={room!.config.waitlist as WaitlistOptions} session={session}/>}
      {finished && <section ref={resultElement} className="ct-round-results" tabIndex={-1} aria-label="Round results">
      {!settlement && <div role="status"><h2>Round complete</h2><p>{room?.settlementAccess === 'session-required' ? 'Sign in with the wallet you used for this round to view your results and rewards. Your session may have expired.' : room?.settlementAccess === 'admission-required' ? 'Results and rewards are available to admitted players. This wallet did not join this round.' : 'The server is finalizing placements. You can retry while settlement completes.'}</p><button className="btn-ghost" onClick={() => void refresh()}>Retry results</button></div>}
      {settlement && podium.length > 0 && <Suspense fallback={<p role="status">Raising the winners’ podium…</p>}><WinnerCelebration winners={podium} me={me} localPlacement={placement} onPresented={onPodiumPresented} teamMode={templateId === 'boss-raid'} /></Suspense>}
      {settlement && (
        <section className="ct-panel">
          <h2>Results and rewards</h2>
          <div className="board">
            {settlement.results.map((row, i) => (
              <div key={row.who} className={`board-row${row.who.toLowerCase() === me ? ' me' : ''}`}>
                <span className="rank">{row.rank ?? i + 1}</span>
                <span className="who">{shortAddress(row.who)}</span>
                <b>{row.score}</b>
              </div>
            ))}
          </div>
          <div className="ct-claims">
            {rewardKind !== 'funded-assets' && settlement.allocations.map((a: Allocation) => (
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
      </section>}
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
  { label: 'Join', path: '/center/join' },
]

export function CenterApp() {
  const session = useSession()
  const [walletOpen, setWalletOpen] = useState(false)
  const [walletNotice, setWalletNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!walletNotice) return
    const timer = window.setTimeout(() => setWalletNotice(null), 6500)
    return () => window.clearTimeout(timer)
  }, [walletNotice])
  const [profileOpen, setProfileOpen] = useState(false)
  const [route, setRoute] = useState<Route>(() => parseRoute())
  const activePath = route.name === 'room' ? '' : route.name === 'join' ? '/center/join' : route.name === 'create' ? '/center/create' : route.name === 'wallet' ? '/center/wallet' : route.name === 'admin' ? '/center/admin' : '/center'

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
      join: 'Join a room — Orbix Game Center',
      admin: 'Admin — Orbix Game Center',
      practice: 'Practice — Orbix Game Center',
    }
    document.title = titles[route.name] ?? 'Orbix Game Center'
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [route])

  const headerElement = useRef<HTMLElement>(null)
  useEffect(() => {
    const element = headerElement.current
    if (!element) return
    const measure = () => document.documentElement.style.setProperty('--ct-header-height', `${element.getBoundingClientRect().height}px`)
    const observer = new ResizeObserver(measure)
    observer.observe(element); measure()
    return () => observer.disconnect()
  }, [])

  const body = useMemo(() => {
    switch (route.name) {
      case 'create':
        return route.templateId && !isFeaturedGame(route.templateId) ? <div className="ct-page ct-unavailable"><Gamepad2 size={48} /><h1>More worlds are on the way.</h1><p>This game is coming soon. Pick a featured game for your next room.</p><button className="btn-primary" onClick={() => go('/center')}>Explore games</button></div> : <Wizard key={`${route.templateId ?? 'choose'}:${route.fromRoom ?? ''}`} session={session} initialTemplateId={route.templateId} fromRoom={route.fromRoom} onConnect={() => setWalletOpen(true)} />
      case 'practice':
        return <PracticeArena templateId={route.templateId} navigate={go} />
      case 'room':
        return <RoomRoute key={`${route.roomId}:${session.address ?? 'watch'}`} roomId={route.roomId} session={session} />
      case 'wallet':
        return <CenterVault session={session} onConnect={() => setWalletOpen(true)} navigate={go} />
      case 'join':
        return <CenterJoin session={session} onConnect={() => setWalletOpen(true)} navigate={go} />
      case 'admin':
        return <AdminPanel session={session} />
      default:
        return <GameCenterHome session={session} onConnect={() => setWalletOpen(true)} navigate={go} />
    }
  }, [route, session])

  return (
    <div className="ct-app">
      <a className="ct-skip-link" href="#center-main">Skip to content</a>
      <header className="ct-topbar" ref={headerElement}>
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
          <button className={`ct-nav-item${route.name === 'wallet' ? ' on' : ''}`} onClick={() => go('/center/wallet')}><WalletIcon size={17} />Vault</button>
          <WalletChip session={session} onOpenWallet={() => setWalletOpen(true)} />
        </div>
      </header>
      {walletOpen && <WalletModal session={session} onClose={() => setWalletOpen(false)} onConnected={() => setWalletNotice('Wallet connected successfully. You’re signed in.')} />}
      {walletNotice && <div className="ct-wallet-notice" role="status" aria-live="polite"><span>{walletNotice}</span><button aria-label="Dismiss wallet confirmation" onClick={() => setWalletNotice(null)}>×</button></div>}
      {profileOpen && <ProfileModalWrapper session={session} onClose={() => setProfileOpen(false)} />}
      <main className="ct-main" id="center-main" tabIndex={-1}>{body}</main>
      <footer className="ct-footer"><a href="/center" onClick={(e) => { e.preventDefault(); go('/center') }}><Gamepad2 size={18} /> Orbix Game Center</a><span>Made for the next round.</span><div><a href="/">Orbix Core</a><button onClick={() => go('/center/admin')}>Admin</button><span>Robinhood testnet</span></div></footer>
    </div>
  )
}


// ------------------------------------------------------------------ join-token payment




function ProfileModalWrapper({ session, onClose }: { session: ReturnType<typeof useSession>; onClose: () => void }) {
  const {profile, loading, error, retry, setProfile} = useProfile(session.address, session.token)
  if (!profile && (loading || error || !profile)) return <div className="wl-backdrop"><div className="wl-modal pf-modal" role="dialog" aria-modal="true" aria-label="Profile unavailable"><button className="wl-close" onClick={onClose} aria-label="Close">✕</button><h3>Your profile</h3><p role={error ? 'alert' : 'status'}>{error ?? 'Loading your saved profile…'}</p>{error && <button className="btn-primary" onClick={retry}>Retry profile</button>}</div></div>
  return <ProfileModal key={session.address} session={session} profile={profile} readError={error} readLoading={loading} onRetry={retry} onClose={onClose} onSave={setProfile} />
}
