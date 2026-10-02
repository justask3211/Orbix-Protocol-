// Orbix Center API client. One place that knows the wire format, so no component
// hand-rolls a fetch and drifts from the backend contract.

export const API_BASE: string = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_CENTER_API ?? '/api/center/v1'

export type TemplateMeta = {
  templateId: string
  version: number
  label: string
  blurb: string
  modes: string
  multiplayer: boolean
  availability: 'preview' | 'live'
}

export type TemplateList = { templates: TemplateMeta[]; count: number }

export type RoomSummary = {
  roomId: string
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

export type Participant = { who: string; role: string; ready: boolean }

export type RoomDetail = {
  roomId: string
  status: string
  visibility: string
  mode: string
  owner: string
  config: Record<string, unknown>
  participants: Participant[]
  joinerFee?: string
  ticket?: string
  timing?: { open_at?: number; close_at?: number }
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
  results: { who: string; score: number }[]
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

  // ---- drafts + rooms
  saveDraft: (config: unknown, token: string, draftId?: string) =>
    request<{ draftId: string; config: unknown }>(draftId ? `/drafts/${draftId}` : '/drafts', { method: draftId ? 'PATCH' : 'POST', body: JSON.stringify({ config }) }, token),
  publish: (config: unknown, intentNonce: string, token: string) =>
    request<{ roomId: string; status: string; charged: number; balanceAfter: number; balanceLabel: string; shareUrl: string; replayed?: boolean; intentId: string }>(
      '/rooms',
      { method: 'POST', body: JSON.stringify({ config, intentNonce }) },
      token,
    ),
  adminPricing: (token: string) =>
    request<{ pricing: { creatorFee: number; joinerFee: number }; caps: Record<string, number>; admin: string; chainId: number }>(
      '/admin/pricing', {}, token),
  adminNonce: (token: string) =>
    request<{ nonce: string; message: string }>('/auth/nonce', { method: 'POST', body: JSON.stringify({ purpose: 'admin' }) }, token),
  adminUpdatePricing: (token: string, signature: string, body: { creatorFee: number; joinerFee: number }) =>
    request<{ pricing: { creatorFee: number; joinerFee: number }; caps: Record<string, number>; chainId: number }>(
      '/admin/pricing',
      { method: 'PATCH', body: JSON.stringify(body), headers: { 'X-Admin-Proof': signature } },
      token),
  rooms: () => request<{ rooms: RoomSummary[] }>('/rooms'),
  myRooms: (token: string) =>
    request<{ rooms: { roomId: string; name: string; templateId: string; status: string; visibility: string; players: number; openAt: number | null; closeAt: number | null; scheduled: string | null; expiring: string | null; active: boolean }[] }>(
      '/my/rooms', {}, token),
  closeRoom: (roomId: string, token: string) =>
    request<{ status: string }>(`/rooms/${roomId}/close`, { method: 'POST' }, token),
  room: (roomId: string) => request<RoomDetail>(`/rooms/${roomId}`),
  invite: (roomId: string, token: string) => request<{ invite: string; shareUrl: string }>(`/rooms/${roomId}/invites`, { method: 'POST' }, token),
  join: (roomId: string, token: string, invite?: string) =>
    request<{ role: string; joinerFee: string; status: string; ticket: string }>(`/rooms/${roomId}/join`, { method: 'POST', body: JSON.stringify({ invite: invite ?? null }) }, token),
  ready: (roomId: string, token: string, ready: boolean) =>
    request<{ ready: number }>(`/rooms/${roomId}/ready`, { method: 'POST', body: JSON.stringify({ ready }) }, token),
  start: (roomId: string, token: string) =>
    request<{ roundId: string; commitHash: string; deadline: number }>(`/rooms/${roomId}/start`, { method: 'POST' }, token),
  cancel: (roomId: string, token: string) => request<{ status: string }>(`/rooms/${roomId}/cancel`, { method: 'POST' }, token),
  results: (roomId: string) => request<{ roundId: string; state: string; results: { who: string; score: number }[]; entitlements: Allocation[] }>(`/rooms/${roomId}/results`),
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
  checkDeposit: (token: string) =>
    request<{ credited: number; balance: number; wallet: number; symbol: string; synced: boolean }>(
      '/wallet/deposit/check', { method: 'POST' }, token),
}

/** Turn any thrown value into something a player can read. */
export function explainError(error: unknown): string {
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
  return error instanceof Error ? error.message : String(error)
}
