import { parseUnits, formatUnits } from 'viem'

export function amountWithSlippage(amount: bigint, slippage: string): bigint {
  const value = Number(slippage)
  if (!Number.isFinite(value) || value < 0 || value >= 100) throw new Error('Slippage must be below 100%')
  return amount * BigInt(Math.floor((100 - value) * 100)) / 10000n
}

export function parsePositiveAmount(value: string, decimals: number): bigint {
  if (!value || Number(value) <= 0) throw new Error('Amount must be greater than zero')
  return parseUnits(value, decimals)
}

export function validateLaunch(name: string, symbol: string, supply: string, tokenSeed: string, collateralSeed: string): { supply: bigint; tokenSeed: bigint; collateralSeed: bigint } {
  if (!name.trim() || !symbol.trim()) throw new Error('Name and symbol are required')
  const parsedSupply = parsePositiveAmount(supply, 18)
  const parsedTokenSeed = parsePositiveAmount(tokenSeed, 18)
  const parsedCollateralSeed = parsePositiveAmount(collateralSeed, 18)
  if (parsedTokenSeed > parsedSupply) throw new Error('Token seed cannot exceed supply')
  return { supply: parsedSupply, tokenSeed: parsedTokenSeed, collateralSeed: parsedCollateralSeed }
}

// S2: price impact vs spot from reserves. All values are raw units; decimals are used only for display rounding.
export function priceImpactPct(reserveIn: bigint, reserveOut: bigint, amountIn: bigint, amountOut: bigint): number {
  if (reserveIn <= 0n || reserveOut <= 0n || amountIn <= 0n || amountOut <= 0n) return 0
  const spot = Number(reserveOut) / Number(reserveIn)
  if (!Number.isFinite(spot) || spot <= 0) return 0
  const exec = Number(amountOut) / Number(amountIn)
  const impact = (1 - exec / spot) * 100
  if (!Number.isFinite(impact)) return 0
  return Math.max(0, Math.round(impact * 100) / 100)
}

export function formatPriceImpact(impactPct: number): string {
  if (impactPct < 0.01) return '0%'
  return `${impactPct.toFixed(2)}%`
}

export function impactSeverity(impactPct: number): 'ok' | 'warn' | 'high' {
  if (impactPct >= 5) return 'high'
  if (impactPct >= 1) return 'warn'
  return 'ok'
}

export function formatTokenAmount(value: bigint, decimals = 18): string {
  return formatUnits(value, decimals)
}

// S5/S8: decode common router/token revert reasons into friendly copy.
export function decodeRevertReason(e: unknown): string {
  const err = e as { name?: string; shortMessage?: string; message?: string; details?: string; data?: unknown }
  const raw = `${err.shortMessage || ''} ${err.details || ''} ${err.message || ''}`.trim()
  if (/user rejected|user denied|UserRejected/i.test(raw)) return 'You rejected the request in your wallet.'
  if (/Expired|deadline/i.test(raw)) return 'Swap deadline expired — try again.'
  if (/InsufficientOutput/i.test(raw)) return 'Not enough output for this trade — try a smaller amount or raise slippage.'
  if (/InsufficientAmount/i.test(raw)) return 'Insufficient amount or liquidity for this pair.'
  if (/PairNotFound/i.test(raw)) return 'No pool exists for this path yet.'
  if (/InvalidPath/i.test(raw)) return 'Invalid swap path.'
  if (/transfer amount exceeds balance|insufficient balance/i.test(raw)) return 'Insufficient token balance.'
  if (/insufficient allowance|exceeds allowance/i.test(raw)) return 'Allowance too low — approve the token first.'
  if (/EthTransferFailed/i.test(raw)) return 'Router failed to send ETH back to you.'
  if (/chain|network/i.test(raw)) return 'Network error — check your connection and retry.'
  return (err.shortMessage || err.message || 'Transaction failed').replace(/^来/, '').slice(0, 180)
}

export const friendlyError = decodeRevertReason
