import type {FormStatus} from './FormRewards'
import type { GateAuthorization } from './gate'
import type { Funding, RewardClaim, RewardPlan } from './rewardWallet'
import type { Appearance, Cosmetics } from './characters'
// Orbix Center API client. One place that knows the wire format, so no component
// hand-rolls a fetch and drifts from the backend contract.

export const API_BASE: string = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_CENTER_API ?? '/api/center/v1'

export type TemplateMeta = {
  placement?: 'featured'|'more'|'coming-soon'|'hidden'
  latencySensitivity?: 'tolerant'|'sensitive'
  practiceAvailable?: boolean
  templateId: string
  version: number
  label: string
  blurb: string
  modes: string
  multiplayer: boolean
  availability: 'preview' | 'live'
  playStatus?: 'live' | 'maintenance' | 'offline'
  maintenanceMessage?: string
}

export type TemplateList = { templates: TemplateMeta[]; count: number }

export type RoomSummary = {
  roomId: string
  roomNumber?: string
  joinCode?: string
  name: string
  templateId: string
  status: string
  visibility: string
  mode: string
  players: number
  rewards: string
  entryKind?: string | null
  entryToken?: string | null
  entryAmount?: number | null
}

export type Participant = { who: string; role: string; ready: boolean; connected?: boolean }

export type RoomDetail = {
  entryGate?: `0x${string}`
  roomId: string
  roomNumber?: string
  joinCode?: string
  status: string
  visibility: string
  mode: string
  owner: string
  config: Record<string, unknown>
  participants: Participant[]
  joinerFee?: string
  ticket?: string
  timing?: { open_at?: number; close_at?: number }
  teams?: Record<string, string>
  characters?: Record<string,string>
  appearances?: Record<string,Appearance>
  gameStatus?: 'live'|'maintenance'|'offline'
  maintenanceMessage?: string
  archived?: boolean
  publicState?: Record<string, unknown> | null
  roundId?: string
  deadline?: number
  serverTimeMs?: number
  communitySettings?: { muteChat: boolean; hidePlayers: boolean; hideGuesses: boolean }
  rematch?: {supported:boolean;requiresFreshRoom:boolean;reason?:string}
  settlement?: Settlement | null
  settlementAccess?: 'available' | 'session-required' | 'admission-required' | 'pending'
}

export type Allocation = {
  claimId: string
  roundId: string
  winner: string
  slotId: number
  points: number
  assetKind: string | null
  assetContract: string | null
  tokenId: number
  amount: number | string
  code: string
}

export type Settlement = {
  merkleRoot: string
  allocationsHash: string
  transcriptHash: string
  deadline: number
  escrow: string
  chainId: number
  allocations: Allocation[]
  results: { who: string; score: number; rank?: number; eligible?: boolean }[]
}

export type VaultState = {
  balance: number
  unit: string
  label: string
  simulated: boolean
  token?: string | null
  vaultAddress?: string | null
  note: string
  spent: number
  ledger: { id: number; kind: string; amount: string; unit: string; room_id?: string | null; created_at: number }[]
}

export type OnchainBalance = {
  live: boolean
  wallet: number | null
  vaultCredit: number | null
  symbol: string | null
  token?: string | null
  vaultAddress?: string | null
  chainId?: number
}

export class ApiError extends Error {
  code: string
  status: number
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) }
  if (init.body) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  const text = await res.text()
  let body: unknown = undefined
  try {
    body = text ? JSON.parse(text) : undefined
  } catch {
    body = { detail: { code: 'BAD_RESPONSE', message: text.slice(0, 200) } }
  }
  if (!res.ok) {
    const detail = (body as { detail?: { code?: string; message?: unknown } } | undefined)?.detail
    const code = detail?.code ?? `HTTP_${res.status}`
    const message = typeof detail?.message === 'string' ? detail.message : JSON.stringify(detail?.message ?? body)
    throw new ApiError(res.status, code, message)
  }
  return body as T
}

export const center = {
  submitWaitlist: (roomId:string,token:string,wallet:string,fields:string[]=[]) => request<{wallet:string;createdAt:number;replayed:boolean}>(`/rooms/${encodeURIComponent(roomId)}/waitlist`,{method:"POST",body:JSON.stringify({wallet,fields})},token),
  formStatus: (roomId:string,token:string) => request<{forms:FormStatus[]}>(`/rooms/${encodeURIComponent(roomId)}/forms/status`,{},token),
  submitQA: (roomId:string,token:string,answers:string[]) => request<{saved:boolean;edited:boolean}>(`/rooms/${encodeURIComponent(roomId)}/qa-form`,{method:'POST',body:JSON.stringify({answers})},token),
  qaResponses: (roomId:string,token:string) => request<{count:number;entries:{player:string;answers:string[];createdAt:number;updatedAt:number}[]}>(`/rooms/${encodeURIComponent(roomId)}/qa-form`,{},token),
  waitlistRewards: (roomId:string,token:string) => request<{wallets:string[];count:number;sourceRoomId:string}>(`/rooms/${encodeURIComponent(roomId)}/waitlist-rewards`,{},token),
  waitlist: (roomId:string,token:string) => request<{entries:{wallet:string;player:string;createdAt:number}[];count:number;uniqueWallets:number}>(`/rooms/${encodeURIComponent(roomId)}/waitlist`,{},token),
  getProfiles: (addresses: string[]) => request<Record<string,{name:string;hue?:number;showAddress?:boolean;hasImage?:boolean;character?:string;cosmetics?:Cosmetics}>>('/profiles/batch', {method:'POST',body:JSON.stringify({addresses})}),
  chooseCharacter:(roomId:string,token:string,character:string)=>request<{characters:Record<string,string>}>(`/rooms/${roomId}/character`,{method:'POST',body:JSON.stringify({character})},token),
  health: () => request<{ ok: boolean; preview: boolean }>('/health/live'),
  templates: () => request<TemplateList>('/templates'),
  templateRules: (templateId: string) =>
    request<{ templateId: string; fields: Record<string, unknown>; playerCap: { min: number | null; max: number | null } }>(
      `/templates/${templateId}/rules`,
    ),

  // ---- auth
  nonce: (address: string) => request<{ nonce: string; message: string }>('/auth/nonce', { method: 'POST', body: JSON.stringify({ address }) }),
  verify: (address: string, nonce: string, signature: string) =>
    request<{ token: string }>('/auth/verify', { method: 'POST', body: JSON.stringify({ address, nonce, signature }) }),

  gateAuthorization: (roomId:string,token:string) => request<GateAuthorization>(`/rooms/${encodeURIComponent(roomId)}/gate-authorization`,{method:'POST'},token),
  rewardCapabilities: () => request<{available:boolean;engine:string;chainId:number;reason?:string}>('/rewards/capabilities'),
  prepareRewards: (config: unknown, intentNonce: string, token: string) => request<{roomId:string;roomKey:`0x${string}`;engine:`0x${string}`;merkleRoot:`0x${string}`;published:boolean;funding:Funding|null}>('/rooms/prepare-rewards', {method:'POST',body:JSON.stringify({config,intentNonce})},token),
  myRewards: (token:string,roomId?:string) => request<{rewards:RewardClaim[]}>(`/wallet/rewards${roomId?`?roomId=${encodeURIComponent(roomId)}`:''}`,{},token),
  rewardLookup: (code:string,token:string) => request<{claim:RewardClaim}>('/rewards/lookup',{method:'POST',body:JSON.stringify({code})},token),
  rewardPlan: (roomId:string,token:string) => request<{plan:RewardPlan|null}>(`/rooms/${encodeURIComponent(roomId)}/reward-plan`,{},token),
  // ---- drafts + rooms
  saveDraft: (config: unknown, token: string, draftId?: string) =>
    request<{ draftId: string; config: unknown }>(draftId ? `/drafts/${draftId}` : '/drafts', { method: draftId ? 'PATCH' : 'POST', body: JSON.stringify({ config }) }, token),
  publish: (config: unknown, intentNonce: string, token: string, funding?: Funding) =>
    request<{ roomId: string; status: string; charged: number; balanceAfter: number; balanceLabel: string; shareUrl: string; replayed?: boolean; intentId: string }>(
      '/rooms',
      { method: 'POST', body: JSON.stringify({ config, intentNonce, funding }) },
      token,
    ),
  adminPricing: (token: string) =>
    request<{ pricing: { creatorFee: number; joinerFee: number }; caps: Record<string, number>; admin: string; chainId: number }>(
      '/admin/pricing', {}, token),
  adminNonce: (token: string, address: string) =>
    request<{ nonce: string; message: string }>('/auth/nonce', { method: 'POST', body: JSON.stringify({ address, purpose: 'admin' }) }, token),
  adminUpdatePricing: (token: string, signature: string, body: { creatorFee: number; joinerFee: number }) =>
    request<{ pricing: { creatorFee: number; joinerFee: number }; caps: Record<string, number>; chainId: number }>(
      '/admin/pricing',
      { method: 'PATCH', body: JSON.stringify(body), headers: { 'X-Admin-Proof': signature } },
      token),
  adminGames: (token: string) => request<{ games: { templateId: string; status: 'live' | 'maintenance' | 'offline'; message: string }[] }>('/admin/games', {}, token),
  adminGameUpdate: (templateId: string, token: string, proof: string, body: { status: string; message?: string }) =>
    request(`/admin/games/${encodeURIComponent(templateId)}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'X-Admin-Proof': proof } }, token),
  adminRooms: (token: string, offset = 0) => request<{ rooms: { roomId: string; name: string; templateId: string; owner: string; status: string; visibility: string; mode: string; players: number; archived: boolean; createdAt: number; rewardKind: string }[]; total: number }>(`/admin/rooms?offset=${offset}`, {}, token),
  adminRoomObserve: (roomId: string, token: string) => request<{
    roomId: string; name: string; templateId: string; status: string; owner: string; archived: boolean;
    publicState: Record<string, unknown> | null; readOnly: boolean;
    roster: { players: { wallet: string; name: string; ready: boolean; role: string }[]; banned: { wallet: string; name: string }[] };
    community: { settings: { muteChat: boolean; hidePlayers: boolean; hideGuesses: boolean }; messages: { id: number; text: string; name: string; deleted: boolean; kind: string }[] };
  }>(`/admin/rooms/${encodeURIComponent(roomId)}/observe`, {}, token),
  adminRoomAction: (roomId: string, token: string, proof: string, body: Record<string, unknown>) =>
    request(`/admin/rooms/${encodeURIComponent(roomId)}/actions`, { method: 'POST', body: JSON.stringify(body), headers: { 'X-Admin-Proof': proof } }, token),
  adminArchiveUnused: (token: string, proof: string) => request<{ count: number }>('/admin/rooms/archive-unused', { method: 'POST', headers: { 'X-Admin-Proof': proof } }, token),
  rooms: () => request<{ rooms: RoomSummary[] }>('/rooms'),
  myRooms: (token: string) =>
    request<{ rooms: { roomId: string; name: string; templateId: string; status: string; visibility: string; players: number; openAt: number | null; closeAt: number | null; scheduled: string | null; expiring: string | null; active: boolean; waitlistEnabled:boolean; waitlistCount:number; formKinds:('waitlist-form'|'qa-form')[]; responseCounts:Record<string,number> }[] }>(
      '/my/rooms', {}, token),
  closeRoom: (roomId: string, token: string) =>
    request<{ status: string }>(`/rooms/${roomId}/close`, { method: 'POST' }, token),
  room: (roomId: string, token?: string) => request<RoomDetail>(`/rooms/${roomId}`, {}, token),
  resolveRoomCode: (code: string, token?: string, invite?: string) => request<{roomId:string;roomNumber:string}>(`/rooms/resolve/${encodeURIComponent(code)}${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`, {}, token),
  rematch: (roomId: string, token: string, config?: Record<string, unknown>) => request<{roomId:string;roomNumber:string;roundId:string;previousRoundId:string;readinessReset:boolean}>(`/rooms/${roomId}/rematch`, {method:'POST',body:JSON.stringify(config ? {config} : {})}, token),
  chooseTeam: (roomId: string, token: string, team: string) => request<{teams: Record<string, string>}>(`/rooms/${roomId}/team`, {method: 'POST', body: JSON.stringify({team})}, token),
  invite: (roomId: string, token: string) => request<{ invite: string; shareUrl: string }>(`/rooms/${roomId}/invites`, { method: 'POST' }, token),
  join: (roomId: string, token: string, invite?: string) =>
    request<{ role: string; joinerFee: string; status: string; ticket: string }>(`/rooms/${roomId}/join`, { method: 'POST', body: JSON.stringify({ invite: invite ?? null }) }, token),
  ready: (roomId: string, token: string, ready: boolean) =>
    request<{ ready: number }>(`/rooms/${roomId}/ready`, { method: 'POST', body: JSON.stringify({ ready }) }, token),
  start: (roomId: string, token: string) =>
    request<{ roundId: string; commitHash: string; deadline: number }>(`/rooms/${roomId}/start`, { method: 'POST' }, token),
  cancel: (roomId: string, token: string) => request<{ status: string }>(`/rooms/${roomId}/cancel`, { method: 'POST' }, token),
  results: (roomId: string) => request<{ roundId: string; state: string; results: { who: string; score: number; rank?: number; eligible?: boolean }[]; entitlements: Allocation[] }>(`/rooms/${roomId}/results`),
  fairness: (roundId: string) => request<Record<string, unknown>>(`/rounds/${roundId}/fairness`),

  // ---- claims
  claim: (reference: string) => request<Record<string, unknown>>(`/claims/${encodeURIComponent(reference)}`),
  lookupClaim: (code: string, token: string) =>
    request<{ claim: Allocation; payable: boolean; reason?: string }>('/claims/lookup', { method: 'POST', body: JSON.stringify({ code }) }, token),

  // ---- wallet / vault
  vault: (token: string) => request<VaultState>('/wallet/vault', {}, token),
  onchainBalance: (token: string) => request<OnchainBalance>('/wallet/onchain-balance', {}, token),
  deposit: (amount: number, token: string) => request<{ balance: number }>('/wallet/vault/deposit', { method: 'POST', body: JSON.stringify({ amount }) }, token),
  ledgerCsvUrl: () => `${API_BASE}/wallet/ledger.csv`,
  getProfile: (address: string) =>
    request<{ name: string; bio: string; hue: number; showAddress: boolean; address?: string }>(`/profile/${address}`),
  setCharacter: (token:string, appearance:Appearance) => request<any>('/profile/character', {method:'POST', body:JSON.stringify(appearance)}, token),
  setProfile: (token: string, body: { name: string; bio: string; hue: number; showAddress: boolean }) =>
    request<{ name: string; bio: string; hue: number; showAddress: boolean }>('/profile', { method: 'POST', body: JSON.stringify(body) }, token),
  uploadProfileImage: (token: string, dataUrl: string) =>
    request<{ ok: boolean; url: string }>('/profile/image', { method: 'POST', body: JSON.stringify({ image: dataUrl }) }, token),
  checkDeposit: (token: string) =>
    request<{ credited: number; balance: number; wallet: number; symbol: string; synced: boolean }>(
      '/wallet/deposit/check', { method: 'POST' }, token),
}

/** Turn any thrown value into something a player can read. */
export function explainError(error: unknown): string {
  const object = error as {code?: number; message?: string; data?: unknown; cause?: unknown}
  let raw = ''
  try { raw = JSON.stringify(error) + ' ' + (error instanceof Error ? error.message : String(error)) } catch { raw = String(error) }
  if (object?.code === 4001 || /user rejected|user denied|request rejected/i.test(raw)) return 'You rejected the wallet request. No confirmation was recorded.'
  const selectors: Record<string,string> = {
    '0xdb89e3f4': 'ORBIX transfers are locked until its bonding curve graduates. Choose a transferable reward asset.',
    '0xfb8f41b2': 'Insufficient token allowance. Approve the reward contract before depositing.',
    '0x70f65caa': 'The claim deadline has passed.',
    '0x96a18df4': 'Choose a claim deadline more than one hour away.',
    '0x646cf558': 'That reward was already claimed.',
    '0x618c7242': 'This reward belongs to a different wallet.',
    '0x31212686': 'The claim signature does not match the reward authority. Refresh the claim.',
    '0x76ecffc0': 'That reward pool could not be found.',
    '0x9d52b56e': 'The reward asset or claim mode does not match this pool.',
    '0xc5f53ea9': 'All open reward slots have been claimed.',
    '0x1f2a2005': 'Check the deposit amount and remaining pool inventory.',
    '0x93687c0b': 'Only the creator wallet can fund or allocate this pool.',
    '0x560ff900': 'This reward pool has already settled.',
    '0x2c7e4d98': 'The reward proof does not match the committed distribution.',
    '0xe450d38c': 'Your wallet does not have enough tokens for this reward deposit.',
  }
  for (const [selector,message] of Object.entries(selectors)) if(raw.toLowerCase().includes(selector))return message
  if (/insufficient allowance/i.test(raw)) return 'Insufficient token allowance. Approve the reward contract before depositing.'
  if (/0x[0-9a-f]{8}/i.test(raw) && /revert|execution|error|failed/i.test(raw)) return 'The contract rejected this transaction. Refresh your reward status and check the wallet, amount, allowance and deadline.'

  if (error instanceof ApiError) {
    const map: Record<string, string> = {
      UNAUTHORIZED: 'Sign in with your wallet first.',
      INSUFFICIENT_BALANCE: 'Not enough in your vault for this publish.',
      INVITE_REQUIRED: 'This room is private — you need an invite link.',
      ROOM_FULL: 'This room is full.',
      NOT_READY: 'Not enough players are ready yet.',
      NO_PLAYERS: 'Nobody has joined this room yet.',
      ROUND_NOT_OPEN: 'The round is not open for that action.',
      ALREADY_CLAIMED: 'That reward was already claimed.',
      WRONG_CLAIM_WALLET: 'This reward belongs to a different wallet.',
      UNKNOWN_CLAIM: 'No reward matches that code.',
      INVALID_CONFIG: 'That room configuration was rejected — check the rules panel and the server message below.',
      UNFUNDED_REWARD: 'Funded rewards are disabled on this preview deployment.',
    }
    const mapped = map[error.code]
    if (error.code === 'INVALID_CONFIG') return `${mapped} ${error.message}`
    return mapped ?? `${error.code}: ${error.message}`
  }
  return error instanceof Error ? error.message : 'The wallet request failed. Please retry.'
}
