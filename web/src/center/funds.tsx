// Wallet funds panel + transaction signing preview.
//
// Funds: reads the connected wallet's test ETH and every configured token balance
// on chain 46630 and lists them, with ORBIX highlighted first.
//
// Signing preview: before any contract call, show exactly what will be sent —
// contract address, function, arguments, amount, destination — plus a plain
// "this is safe / what to expect" line, so nobody signs blind.

import { useEffect, useState } from 'react'
import { useModalFocus } from './useModalFocus'

const RPC = 'https://rpc.testnet.chain.robinhood.com'
const ORBIX = '0x16c5451763ec2e0e7f041e2db761a0491fdb6db1'

// Tokens to try to read. ORBIX first (highlighted), then the testnet stock set.
const KNOWN_TOKENS: { address: string; symbol: string; decimals: number }[] = [
  { address: ORBIX, symbol: 'ORBIX', decimals: 18 },
  { address: '0x9d6ea9fbef2b244fb30f6e775f2da3cc431b733e', symbol: 'FREE', decimals: 18 },
]

type Fund = { symbol: string; amount: string; native?: boolean; orbix?: boolean; address?: string }

async function rpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const json = await res.json()
  if (json.error) throw new Error(json.error.message ?? 'rpc error')
  return json.result
}

function pad(addr: string): string {
  return addr.toLowerCase().replace(/^0x/, '').padStart(64, '0')
}

function hexToBig(hex: string | undefined | null): bigint {
  if (!hex || hex === '0x') return 0n
  try { return BigInt(hex) } catch { return 0n }
}

function fmt(wei: bigint, decimals = 18): string {
  const whole = wei / 10n ** BigInt(decimals)
  const frac = wei % 10n ** BigInt(decimals)
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, 4).replace(/0+$/, '')
  return fracStr ? `${whole}.${fracStr}` : whole.toString()
}

export function useWalletFunds(address: string | null) {
  const [funds, setFunds] = useState<Fund[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!address) { setFunds([]); return }
    let alive = true
    setLoading(true)
    setError(null)
    ;(async () => {
      const out: Fund[] = []
      // native test ETH
      try {
        const bal = await rpc('eth_getBalance', [address, 'latest'])
        out.push({ symbol: 'test ETH', amount: fmt(hexToBig(bal)), native: true })
      } catch (e) {
        if (alive) setError('Could not read the chain. Check your connection.')
      }
      // known tokens (ORBIX highlighted)
      for (const t of KNOWN_TOKENS) {
        try {
          const balHex = await rpc('eth_call', [{ to: t.address, data: '0x70a08231' + pad(address) }, 'latest'])
          const bal = hexToBig(balHex)
          out.push({
            symbol: t.symbol, amount: fmt(bal, t.decimals),
            orbix: t.symbol === 'ORBIX', address: t.address,
          })
        } catch { /* token may not exist */ }
      }
      if (alive) { setFunds(out); setLoading(false) }
    })()
    return () => { alive = false }
  }, [address])

  return { funds, loading, error }
}

export function FundsPanel({ address, onConnect }: { address: string | null; onConnect: () => void }) {
  const { funds, loading, error } = useWalletFunds(address)

  // ORBIX first, then test ETH, then the rest
  const sorted = [...funds].sort((a, b) => {
    if (a.orbix && !b.orbix) return -1
    if (b.orbix && !a.orbix) return 1
    if (a.native && !b.native) return -1
    if (b.native && !a.native) return 1
    return 0
  })

  if (!address) {
    return (
      <div className="ct-panel funds">
        <h2>Your funds</h2>
        <p className="muted">Connect or generate a wallet to see your Robinhood testnet balances.</p>
        <button className="btn-primary" onClick={onConnect}>Connect wallet</button>
      </div>
    )
  }

  return (
    <div className="ct-panel funds">
      <h2>Your funds</h2>
      <p className="muted" style={{ fontSize: 11.5 }}>
        Live balances from Robinhood testnet (chain 46630). Balance updates automatically.
      </p>
      {loading && <p className="muted">Reading the chain…</p>}
      {error && <p className="err" role="alert">{error}</p>}
      <div className="funds-list">
        {sorted.map((f) => (
          <div key={f.symbol} className={`fund-row${f.orbix ? ' orbix' : ''}`}>
            <span className="fund-symbol">{f.symbol}</span>
            <span className="fund-amount mono">{f.amount}</span>
          </div>
        ))}
      </div>
      {sorted.length === 0 && !loading && (
        <p className="muted">
          No balances found. Get test ETH from{' '}
          <a href="https://faucet.testnet.chain.robinhood.com" target="_blank" rel="noreferrer">
            faucet.testnet.chain.robinhood.com
          </a>.
        </p>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ signing preview

export type TxStep = { label: string; detail?: string; value?: string; contract?: string; fn?: string; args?: [string, string][] }

export function TxPreview({ open, title, steps, onConfirm, onCancel, busy }: {
  open: boolean
  title: string
  steps: TxStep[]
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}) {
  const dialog = useModalFocus(onCancel, open)
  if (!open) return null
  return (
    <div className="wl-backdrop" onClick={onCancel} role="presentation">
      <div ref={dialog} tabIndex={-1} className="wl-modal tx-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <button className="wl-close" onClick={onCancel} aria-label="Close">✕</button>
        <h3>{title}</h3>
        <p className="wl-sub">
          Review exactly what your wallet will send. Nothing happens until you press Sign.
        </p>
        <div className="tx-safe">
          <span aria-hidden="true">🔒</span>
          <span>
            This transaction runs on Robinhood testnet (46630), changes the specified token balances, and costs test ETH for gas.
            Verify the contracts, amount and destination before signing.
          </span>
        </div>
        <ol className="tx-steps">
          {steps.map((s, i) => (
            <li key={i}>
              {s.detail ?? s.label}
              {s.contract && (
                <div className="tx-detail">
                  <div><span className="tx-k">To contract</span><code translate="no">{s.contract}</code></div>
                  {s.fn && <div><span className="tx-k">Function</span><code translate="no">{s.fn}</code></div>}
                  {s.value && <div><span className="tx-k">Value</span><code translate="no">{s.value}</code></div>}
                  {s.args?.map(([k, v]) => (
                    <div key={k}><span className="tx-k">{k}</span><code translate="no">{v}</code></div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
        <div className="ct-actions" style={{ marginTop: 8 }}>
          <button className="btn-primary" onClick={onConfirm} disabled={busy}>
            {busy ? 'Waiting for your wallet…' : 'Sign & continue'}
          </button>
          <button className="btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
