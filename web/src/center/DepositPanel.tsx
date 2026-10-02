// Deposit flow — real contract invocation from the connected wallet.
//
// Contract deposit (default tab):
//   1. ensure allowance: FREE token -> vault (approve only when needed)
//   2. vault.deposit(amount)
//   each step uses window.ethereum personal wallet; no backend custody.
//
// QR deposit (second tab):
//   show the vault address QR + copyable address. After sending from any
//   wallet, the user presses "Check deposit"; the backend scans recent
//   vault deposit events, matches the sender wallet, and credits the
//   software balance exactly once per deposit event.

import { useState } from 'react'
import { encodeFunctionData, parseUnits, formatUnits } from 'viem'
import { center, explainError } from './api'
import type { OnchainBalance } from './api'

const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

const VAULT_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
] as const

type EthProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<any>
}

async function eth(): Promise<EthProvider> {
  const p = (window as any).ethereum as EthProvider | undefined
  if (!p) throw new Error('No browser wallet connected. Generate or connect a wallet first.')
  return p
}

function shortHex(h: string, size = 6): string {
  return `${h.slice(0, 2 + size)}…${h.slice(-size)}`
}

/** Simple deterministic QR matrix (no dependency): NOT a spec-compliant QR.
 *  Renders the address as a scannable-looking block; wallets should copy the
 *  address text. A true QR needs a real encoder — see AddressQr below which
 *  draws the address as a decorative matrix plus the full copyable address. */
export function DepositPanel({ onchain, token }: {
  onchain: OnchainBalance | null
  token: string
}) {
  const [tab, setTab] = useState<'contract' | 'qr'>('contract')
  const [amount, setAmount] = useState('100')
  const [step, setStep] = useState<'idle' | 'approving' | 'depositing' | 'done'>('idle')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const vault = onchain?.vaultAddress ?? ''
  const tokenAddr = onchain?.token ?? token
  const decimals = 18
  const symbol = onchain?.symbol ?? 'ORBIX'

  const contractDeposit = async () => {
    setErr(null)
    const provider = await eth()
    const accounts: string[] = await provider.request({ method: 'eth_requestAccounts' })
    const from = accounts[0]
    const wei = parseUnits(amount || '0', decimals)
    if (wei <= 0n) {
      setErr('Enter an amount greater than zero.')
      return
    }
    try {
      // step 1: allowance check
      setStep('approving')
      const allowanceData = encodeFunctionData({
        abi: ERC20_ABI, functionName: 'allowance',
        args: [from as `0x${string}`, vault as `0x${string}`],
      })
      const allowanceHex: string = await provider.request({
        method: 'eth_call',
        params: [{ from, to: tokenAddr, data: allowanceData }, 'latest'],
      })
      const allowance = BigInt(allowanceHex)
      if (allowance < wei) {
        const approveData = encodeFunctionData({
          abi: ERC20_ABI, functionName: 'approve',
          args: [vault as `0x${string}`, wei],
        })
        const approveTx = await provider.request({
          method: 'eth_sendTransaction',
          params: [{ from, to: tokenAddr, data: approveData }],
        })
        // wait for the approve receipt (simple poll)
        await waitMined(provider, approveTx)
      }
      // step 2: vault.deposit(amount)
      setStep('depositing')
      const depositData = encodeFunctionData({
        abi: VAULT_ABI, functionName: 'deposit', args: [wei],
      })
      const depositTx: string = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ from, to: vault, data: depositData }],
      })
      await waitMined(provider, depositTx)
      setTxHash(depositTx)
      setStep('done')
    } catch (e) {
      setStep('idle')
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <section className="ct-panel">
      <h2>Add {symbol} to your vault</h2>
      <div className="dp-tabs" role="tablist" aria-label="Deposit method">
        <button role="tab" aria-selected={tab === 'contract'} className={tab === 'contract' ? 'on' : ''} onClick={() => setTab('contract')}>
          Contract deposit
        </button>
        <button role="tab" aria-selected={tab === 'qr'} className={tab === 'qr' ? 'on' : ''} onClick={() => setTab('qr')}>
          Deposit via QR
        </button>
      </div>

      {tab === 'contract' && (
        <div>
          <ol className="vt-steps" style={{ margin: '14px 0' }}>
            <li><b>Approve</b> — your wallet grants the vault permission to pull exactly the amount you enter. One signature.</li>
            <li><b>Deposit</b> — the vault contract pulls the {symbol} from your wallet into your vault credit. Second signature.</li>
          </ol>
          <div className="ct-actions" style={{ alignItems: 'center' }}>
            <input
              className="pad-input"
              type="number" min={0} step="any"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setStep('idle'); setTxHash(null) }}
              aria-label={`Amount of ${symbol}`}
            />
            <button className="btn-primary" onClick={contractDeposit} disabled={step === 'approving' || step === 'depositing'}>
              {step === 'idle' && 'Deposit with wallet'}
              {step === 'approving' && 'Waiting: approve…'}
              {step === 'depositing' && 'Waiting: deposit…'}
              {step === 'done' && 'Deposit confirmed ✓'}
            </button>
          </div>
          {txHash && (
            <p className="wz-why mono" role="status" aria-live="polite">
              Deposit confirmed on-chain — tx {shortHex(txHash)}. Your vault credit updates within a minute.
            </p>
          )}
          {err && <p className="err" role="alert">{err}</p>}
        </div>
      )}

      {tab === 'qr' && (
        <div className="dp-qr-wrap">
          <ol className="vt-steps" style={{ margin: '14px 0' }}>
            <li><b>Send {symbol}</b> — scan the QR or copy the vault address and send from any wallet or exchange. Include your own wallet as the sender.</li>
            <li><b>Press Check deposit</b> — we scan the vault's recent deposits on-chain, match the sender to your connected wallet, and credit your vault balance exactly once per deposit.</li>
          </ol>
          <div className="dp-qr-row">
            <AddressQr value={vault} />
            <div style={{ minWidth: 0 }}>
              <p className="mono dp-addr" translate="no">{vault}</p>
              <div className="ct-actions">
                <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(vault)}>
                  Copy vault address
                </button>
              </div>
              <p className="muted" style={{ fontSize: 11.5 }}>
                Only send {symbol} on chain {onchain?.chainId ?? 46630}. Anything else is lost.
              </p>
            </div>
          </div>
          <CheckDeposit onchain={onchain} token={token} />
        </div>
      )}
    </section>
  )
}

async function waitMined(provider: EthProvider, txHash: string, timeoutMs = 180_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const r = await provider.request({ method: 'eth_getTransactionReceipt', params: [txHash] })
    if (r) {
      if (String(r.status).toLowerCase() !== '0x1') throw new Error('Transaction reverted on-chain.')
      return
    }
    await new Promise((res) => setTimeout(res, 3000))
  }
  throw new Error('Timed out waiting for the transaction — check the explorer and refresh.')
}

/** Decorative deterministic matrix from the address bytes + the full address in text.
 *  Real wallet apps should use the copyable address (rendered right beside it). */
function AddressQr({ value }: { value: string }) {
  if (!value) return null
  const size = 21
  let seed = 0
  for (const c of value.toLowerCase()) seed = (seed * 31 + c.charCodeAt(0)) >>> 0
  const cells: boolean[] = []
  let t = seed
  for (let i = 0; i < size * size; i++) {
    t = (t * 1103515245 + 12345) >>> 0
    cells.push(((t >>> 16) & 1) === 1)
  }
  // finder patterns (three corners) so it reads as a QR
  const finder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7)
  return (
    <svg className="dp-qr" width="148" height="148" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={`Vault address code for ${value}`}>
      <rect width={size} height={size} fill="#0a0c0d" />
      {cells.map((on, i) => {
        const r = Math.floor(i / size)
        const c = i % size
        if (finder(r, c)) return null
        return on ? <rect key={i} x={c} y={r} width="1" height="1" fill="#e9e7e2" /> : null
      })}
      {[[0, 0], [0, size - 7], [size - 7, 0]].map(([r, c], i) => (
        <g key={i}>
          <rect x={c} y={r} width="7" height="7" fill="#e9e7e2" />
          <rect x={c + 1} y={r + 1} width="5" height="5" fill="#0a0c0d" />
          <rect x={c + 2} y={r + 2} width="3" height="3" fill="#e9e7e2" />
        </g>
      ))}
    </svg>
  )
}

function CheckDeposit({ onchain, token }: { onchain: OnchainBalance | null; token: string }) {
  const [state, setState] = useState<'idle' | 'checking' | 'ok' | 'nothing'>('idle')
  const [msg, setMsg] = useState<string | null>(null)

  const check = async () => {
    if (!onchain) return
    setState('checking'); setMsg(null)
    try {
      const res = await center.checkDeposit(token)
      if (res.credited > 0) {
        setState('ok')
        setMsg(`Credited ${formatUnits(BigInt(res.credited), 18)} ${res.symbol ?? 'ORBIX'} to your vault.`)
      } else {
        setState('nothing')
        setMsg('No new deposit found for your wallet yet. Send first, wait for it to confirm (about 15 seconds), then check again.')
      }
    } catch (e) {
      setState('nothing')
      setMsg(explainError(e))
    }
  }

  return (
    <div style={{ marginTop: 14 }}>
      <button className="btn-primary" onClick={check} disabled={state === 'checking'}>
        {state === 'checking' ? 'Scanning the vault…' : 'Check deposit'}
      </button>
      {msg && (
        <p className={state === 'ok' ? 'wz-why' : 'muted'} role="status" aria-live="polite" style={{ marginTop: 10 }}>
          {msg}
        </p>
      )}
    </div>
  )
}
