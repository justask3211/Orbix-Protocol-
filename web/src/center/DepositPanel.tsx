// Deposit flow — real contract invocation from the connected wallet.
//
// Contract deposit (default tab):
//   1. ensure allowance: ORBIX token -> vault (approve only when needed)
//   2. vault.deposit(amount)
//   each step uses window.ethereum personal wallet; no backend custody.
//
// Contract details explain the exact token and vault. Direct token transfers do not
// call deposit() and must never be presented as credited deposits.

import { useState } from 'react'
import { encodeFunctionData, parseUnits, formatUnits } from 'viem'
import { center, explainError } from './api'
import { copyText } from './share'
import type { OnchainBalance } from './api'
import { TxPreview } from './funds'

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
  if (!p) throw new Error('Connect a browser wallet to make a contract deposit.')
  return p
}


/** Railway/Robinhood testnet chain id + params so wallets can switch. */
const CHAIN_ID_HEX = '0xb626' // 46630
const CHAIN_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Test ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://rpc.testnet.chain.robinhood.com'],
  blockExplorerUrls: ['https://explorer.testnet.chain.robinhood.com'],
}

async function ensureChain(provider: EthProvider): Promise<void> {
  const current: string = await provider.request({ method: 'eth_chainId' })
  if (String(current).toLowerCase() === CHAIN_ID_HEX) return
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID_HEX }] })
  } catch (e: any) {
    // 4902 = chain not added to the wallet
    if (e?.code === 4902 || /Unrecognized chain/i.test(String(e?.message))) {
      await provider.request({ method: 'wallet_addEthereumChain', params: [CHAIN_PARAMS] })
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID_HEX }] })
    }
    throw new Error('Switch your wallet to the Robinhood testnet (chain 46630) to deposit.')
  }
  const switched = await provider.request({ method: 'eth_chainId' })
  if (String(switched).toLowerCase() !== CHAIN_ID_HEX) throw new Error('Your wallet has not switched to Robinhood testnet. Switch networks before depositing.')
}

function shortHex(h: string, size = 6): string {
  return `${h.slice(0, 2 + size)}…${h.slice(-size)}`
}

export function DepositPanel({ onchain, token, address, onConfirmed }: {
  onchain: OnchainBalance | null
  token: string
  address?: string | null
  onConfirmed?: () => void
}) {
  const [tab, setTab] = useState<'contract' | 'details'>('contract')
  const [amount, setAmount] = useState('100')
  const [step, setStep] = useState<'idle' | 'approving' | 'depositing' | 'done'>('idle')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)

  const vault = onchain?.vaultAddress ?? ''
  const tokenAddr = onchain?.token ?? ''
  const decimals = 18
  const symbol = onchain?.symbol ?? 'ORBIX'
  const configured = Boolean(token && onchain?.live && onchain.chainId === 46630 &&
    /^0x[0-9a-fA-F]{40}$/.test(vault) && /^0x[0-9a-fA-F]{40}$/.test(tokenAddr))
  const busy = step === 'approving' || step === 'depositing'
  const depositAmount = () => {
    if (!configured) throw new Error('Live vault details are unavailable. Refresh before depositing.')
    if (!/^\d+(\.\d{1,18})?$/.test(amount)) throw new Error('Enter a positive amount with no more than 18 decimal places.')
    const wei = parseUnits(amount, decimals)
    if (wei <= 0n) throw new Error('Enter an amount greater than zero.')
    return wei
  }
  const reviewDeposit = () => {
    setErr(null)
    try { depositAmount(); setPreview(true) }
    catch (cause) { setErr(explainError(cause)) }
  }

  const contractDeposit = async () => {
    setErr(null)
    setPreview(false)
    let sent = false
    try {
      const wei = depositAmount()
      setStep('approving')
      const provider = await eth()
      const accounts: string[] = await provider.request({ method: 'eth_requestAccounts' })
      const from = accounts[0]
      if (!from) throw new Error('No wallet account selected. Choose an account in your browser wallet.')
      if (address && from.toLowerCase() !== address.toLowerCase()) throw new Error('The browser wallet account differs from your game-center wallet. Switch to the connected account before depositing.')
      await ensureChain(provider)
      // step 1: allowance check
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
        sent = true
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
      sent = true
      setTxHash(depositTx)
      await waitMined(provider, depositTx)
      setStep('done')
      onConfirmed?.()
    } catch (e) {
      setStep('idle')
      const msg = e instanceof Error ? e.message : String(e)
      if (/insufficient funds/i.test(msg)) {
        setErr('Not enough test ETH for gas. Grab some from the testnet faucet, then try again.')
      } else if (/insufficient allowance/i.test(msg)) {
        setErr('The approval did not go through. Approve again when your wallet asks, then deposit.')
      } else if (/user rejected|denied/i.test(msg)) {
        setErr(sent ? 'You declined the next wallet request. An earlier transaction may already be confirmed; review your wallet activity before retrying.' : 'You declined the wallet request. No transaction was submitted.')
      } else {
        setErr(msg)
      }
    }
  }

  return (
    <section className="ct-panel">
      <h2>Add {symbol} to your vault</h2>
      <div className="dp-tabs" role="tablist" aria-label="Deposit method">
        <button role="tab" aria-selected={tab === 'contract'} className={tab === 'contract' ? 'on' : ''} onClick={() => setTab('contract')}>
          Contract deposit
        </button>
        <button role="tab" aria-selected={tab === 'details'} className={tab === 'details' ? 'on' : ''} onClick={() => setTab('details')}>
          Vault details
        </button>
      </div>

      {tab === 'contract' && (
        <div>
          <ol className="vt-steps" style={{ margin: '14px 0' }}>
            <li><b>Approve</b> — your wallet grants the vault permission to pull exactly the amount you enter. Approval is requested only if your allowance is too low.</li>
            <li><b>Deposit</b> — the vault contract pulls the {symbol} from your wallet into your vault credit. A separate deposit transaction is requested.</li>
          </ol>
          <div className="ct-actions" style={{ alignItems: 'center' }}>
            <input
              className="pad-input"
              type="number" min={0} step="any"
              value={amount}
              disabled={busy}
              onChange={(e) => { setAmount(e.target.value); setStep('idle'); setTxHash(null) }}
              aria-label={`Amount of ${symbol}`}
            />
            <button className="btn-primary" onClick={reviewDeposit} disabled={busy || !configured}>
              {step === 'idle' && 'Review deposit'}
              {step === 'approving' && 'Waiting: approve…'}
              {step === 'depositing' && 'Waiting: deposit…'}
              {step === 'done' && 'Deposit confirmed ✓'}
            </button>
          </div>
          {txHash && (
            <p className="wz-why mono" role="status" aria-live="polite">
              {step === 'done' ? 'Deposit confirmed on-chain' : 'Deposit transaction submitted'} — tx {shortHex(txHash)}. {step === 'done' ? 'Use Check deposit to sync room credit.' : 'Check your wallet activity while confirmation is pending.'}
            </p>
          )}
          {err && <p className="err" role="alert">{err}</p>}
        </div>
      )}

      {tab === 'details' && (
        <div className="dp-details">
          <p className="muted">Use the contract deposit flow to create vault credit. Sending tokens directly to this address does not call deposit() and is not a credited deposit.</p>
          <dl><dt>Network</dt><dd>Robinhood Chain Testnet · 46630</dd><dt>Token contract</dt><dd className="mono dp-addr" translate="no">{tokenAddr || 'Unavailable'}</dd><dt>Vault contract</dt><dd className="mono dp-addr" translate="no">{vault || 'Unavailable'}</dd></dl>
          <button className="btn-ghost" disabled={!configured} onClick={() => { void copyText(vault).then(ok => setCopyStatus(ok ? 'Vault address copied.' : 'Copy failed. Select the address to copy it.')) }}>Copy vault address</button>
          {copyStatus && <p role="status" className="muted">{copyStatus}</p>}
          <CheckDeposit onchain={onchain} token={token} onConfirmed={onConfirmed} />
        </div>
      )}
      {step === 'done' && tab === 'contract' && <CheckDeposit onchain={onchain} token={token} onConfirmed={onConfirmed} />}
      <TxPreview open={preview} title={`Deposit ${amount} ${symbol}`} busy={busy}
        onCancel={() => setPreview(false)} onConfirm={() => { void contractDeposit() }}
        steps={[
          { label: 'Approve if needed', detail: `Allow this vault to transfer exactly ${amount} ${symbol}. Your wallet asks for approval only when your current allowance is too low.`, contract: tokenAddr, fn: 'approve(spender, amount)', args: [['spender', vault], ['amount', `${amount} ${symbol}`]] },
          { label: 'Deposit', detail: `Move ${amount} ${symbol} from your connected wallet into this vault on chain 46630. A blockchain transaction requires test ETH for gas.`, contract: vault, fn: 'deposit(amount)', args: [['amount', `${amount} ${symbol}`]] },
        ]} />

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

function CheckDeposit({ onchain, token, onConfirmed }: { onchain: OnchainBalance | null; token: string; onConfirmed?: () => void }) {
  const [state, setState] = useState<'idle' | 'checking' | 'ok' | 'nothing'>('idle')
  const [msg, setMsg] = useState<string | null>(null)

  const check = async () => {
    if (!onchain) return
    setState('checking'); setMsg(null)
    try {
      const res = await center.checkDeposit(token)
      onConfirmed?.()
      if (res.credited > 0) {
        setState('ok')
        setMsg(`Credited ${formatUnits(BigInt(res.credited), 18)} ${res.symbol ?? 'ORBIX'} to your vault.`)
      } else {
        setState('nothing')
        setMsg('No new deposit found for your wallet yet. Use the contract deposit flow, wait for its receipt, then check again.')
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
