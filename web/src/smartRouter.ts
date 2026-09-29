// Smart router: BFS over all factory pairs to find the best-rate swap path (Jumper-style aggregation).
import type { Address } from 'viem'
import { createPublicClient, http } from 'viem'
import { RPC_URL, ADDRESSES } from './addresses'

const FACTORY_ABI = [
  { type: 'function', name: 'allPairsLength', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allPairs', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'getPair', stateMutability: 'view', inputs: [{ name: '', type: 'address' }, { name: '', type: 'address' }], outputs: [{ type: 'address' }] },
] as const
const PAIR_ABI = [
  { type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'getReserves', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }] },
] as const
export const ROUTER_READ_ABI = [
  { type: 'function', name: 'getAmountsOut', stateMutability: 'view', inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'path', type: 'address[]' }], outputs: [{ type: 'uint256[]' }] },
] as const

export const publicClient = createPublicClient({ transport: http(RPC_URL) })

export type TokenMeta = { address: string; symbol: string; decimals: number }
export const BASE_TOKENS: TokenMeta[] = [
  { address: ADDRESSES.WETH, symbol: 'WETH', decimals: 18 },
  { address: ADDRESSES.FREE, symbol: 'FREE', decimals: 18 },
  { address: ADDRESSES.ORBIX, symbol: 'ORBIX', decimals: 18 },
  { address: ADDRESSES.ECO, symbol: 'ECO', decimals: 18 },
  { address: ADDRESSES.OTT_LAUNCH, symbol: 'OTT', decimals: 18 },
]

// Graph edge: pair address + tokens it connects.
type Edge = { pair: Address; a: Address; b: Address }
let graphCache: { edges: Edge[]; tokens: Map<string, TokenMeta>; at: number } | null = null
const GRAPH_TTL_MS = 60_000

// Rebuild the pair graph from factory.allPairs (all launchpad + manual pools included).
export async function loadGraph(force = false): Promise<{ edges: Edge[]; tokens: Map<string, TokenMeta> }> {
  if (!force && graphCache && Date.now() - graphCache.at < GRAPH_TTL_MS) return graphCache
  const factory = ADDRESSES.FACTORY as Address
  const len = Number(await publicClient.readContract({ address: factory, abi: FACTORY_ABI, functionName: 'allPairsLength' }))
  const pairs = await Promise.all(Array.from({ length: len }, (_, i) =>
    publicClient.readContract({ address: factory, abi: FACTORY_ABI, functionName: 'allPairs', args: [BigInt(i)] })))
  const edges: Edge[] = []
  const tokens = new Map<string, TokenMeta>()
  for (const t of BASE_TOKENS) tokens.set(t.address.toLowerCase(), t)
  for (const p of pairs as Address[]) {
    try {
      const [t0, reserves] = await Promise.all([
        publicClient.readContract({ address: p, abi: PAIR_ABI, functionName: 'token0' }),
        publicClient.readContract({ address: p, abi: PAIR_ABI, functionName: 'getReserves' }),
      ])
      const t1 = t0 === (await publicClient.readContract({ address: p, abi: PAIR_ABI, functionName: 'token0' })) ? null : null
      void t1
      // token1 = the other side; resolve via getPair inverse is expensive — use symbol map
      const t0L = (t0 as Address).toLowerCase()
      const other = (await resolveOtherSide(p as Address, t0 as Address)) as Address
      if (!other || other === '0x0000000000000000000000000000000000000000') continue
      const r0 = t0L === other.toLowerCase() ? reserves[0] : reserves[1]
      if (r0 === 0n) continue // skip empty pools
      edges.push({ pair: p as Address, a: t0 as Address, b: other })
      if (!tokens.has(t0L)) tokens.set(t0L, { address: t0 as Address, symbol: await fetchSymbol(t0 as Address), decimals: 18 })
      if (!tokens.has(other.toLowerCase())) tokens.set(other.toLowerCase(), { address: other, symbol: await fetchSymbol(other), decimals: 18 })
    } catch { /* skip malformed pair */ }
  }
  graphCache = { edges, tokens, at: Date.now() }
  return graphCache
}

// Pair has token0; the other side = the reserve index that isn't token0's slot. We resolve via
// pair.token0 + ERC20.symbol on both candidate bases — but simpler: router pairs are always
// (X, WETH) or (X, FREE) or launchpad (X, FREE). Try the known bases.
async function resolveOtherSide(pair: Address, token0: Address): Promise<Address | null> {
  for (const base of [ADDRESSES.WETH, ADDRESSES.FREE, ADDRESSES.ORBIX, ADDRESSES.ECO]) {
    if (base.toLowerCase() === token0.toLowerCase()) continue
    try {
      const p = await publicClient.readContract({ address: ADDRESSES.FACTORY, abi: FACTORY_ABI, functionName: 'getPair', args: [token0, base] })
      if ((p as Address).toLowerCase() === pair.toLowerCase()) return base
    } catch { /* continue */ }
  }
  return null
}

async function fetchSymbol(token: Address): Promise<string> {
  try {
    const s = await publicClient.readContract({ address: token, abi: [{ type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }] as const, functionName: 'symbol' })
    return s as string
  } catch { return token.slice(0, 6) }
}

// BFS over hops (1-3) evaluating getAmountsOut for each candidate path; returns best.
export async function findBestPath(from: Address, to: Address, amountIn: bigint, maxHops = 3): Promise<{ path: Address[]; amounts: bigint[] } | null> {
  const { edges, tokens } = await loadGraph()
  if (from.toLowerCase() === to.toLowerCase()) return null
  const adj = new Map<string, Edge[]>()
  for (const e of edges) {
    if (!adj.has(e.a.toLowerCase())) adj.set(e.a.toLowerCase(), [])
    if (!adj.has(e.b.toLowerCase())) adj.set(e.b.toLowerCase(), [])
    adj.get(e.a.toLowerCase())!.push(e)
    adj.get(e.b.toLowerCase())!.push(e)
  }
  const candidates: Address[][] = []
  const direct: Address[] = [from, to]
  candidates.push(direct)
  // 2-hop and 3-hop paths via intermediate hubs
  for (const hub of Array.from(tokens.keys())) {
    if (hub === from.toLowerCase() || hub === to.toLowerCase()) continue
    candidates.push([from, hub as Address, to])
    for (const hub2 of Array.from(tokens.keys())) {
      if (hub2 === hub || hub2 === from.toLowerCase() || hub2 === to.toLowerCase()) continue
      candidates.push([from, hub as Address, hub2 as Address, to])
    }
  }
  let best: { path: Address[]; amounts: bigint[] } | null = null
  for (const path of candidates) {
    if (path.length - 1 > maxHops) continue
    // All consecutive hops must exist as edges
    let ok = true
    for (let i = 0; i < path.length - 1; i++) {
      const has = (adj.get(path[i].toLowerCase()) || []).some(e =>
        e.a.toLowerCase() === path[i + 1].toLowerCase() || e.b.toLowerCase() === path[i + 1].toLowerCase())
      if (!has) { ok = false; break }
    }
    if (!ok) continue
    try {
      const amounts = await publicClient.readContract({ address: ADDRESSES.ROUTER, abi: ROUTER_READ_ABI, functionName: 'getAmountsOut', args: [amountIn, path as Address[]] }) as bigint[]
      const out = amounts[amounts.length - 1]
      if (!best || out > best.amounts[best.amounts.length - 1]) best = { path: path as Address[], amounts }
    } catch { /* route unavailable */ }
  }
  return best
}
