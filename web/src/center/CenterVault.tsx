import { useState } from 'react'
import { ArrowLeft, ArrowUpRight, Coins, Copy, Download, Gamepad2, Landmark, RefreshCw, ShieldCheck, Wallet, Zap } from 'lucide-react'
import { center, explainError } from './api'
import { DepositPanel } from './DepositPanel'
import { FundsPanel } from './funds'
import { useSession, shortAddress } from './session'
import { copyText } from './share'
import { formatCenterToken, useCenterBalances } from './CenterBalance'
import './vault.css'

export function CenterVault({ session, onConnect, navigate }: {
  session: ReturnType<typeof useSession>
  onConnect: () => void
  navigate: (path: string) => void
}) {
  const { vault, onchain, loading, error, lastUpdated, refresh } = useCenterBalances(session.token, session.address)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [showFunds, setShowFunds] = useState(false)
  const symbol = onchain?.symbol ?? 'ORBIX'
  const copyAddress = async () => {
    if (!session.address) return
    const ok = await copyText(session.address)
    setCopyStatus(ok ? 'Wallet address copied.' : 'Could not copy. Select the address to copy it manually.')
  }
  const exportLedger = async () => {
    if (!session.token || exporting) return
    setExporting(true); setExportError(null)
    try {
      const response = await fetch(center.ledgerCsvUrl(), { headers: { authorization: `Bearer ${session.token}` } })
      if (!response.ok) throw new Error(`Ledger export failed (${response.status}). Refresh your session and try again.`)
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url; link.download = 'orbix-center-ledger.csv'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) { setExportError(explainError(cause)) }
    finally { setExporting(false) }
  }
  const readyForDeposit = Boolean(session.token && onchain?.live && onchain.chainId === 46630 &&
    /^0x[0-9a-fA-F]{40}$/.test(onchain.token ?? '') && /^0x[0-9a-fA-F]{40}$/.test(onchain.vaultAddress ?? ''))

  return <div className="ct-page cv-page">
    <header className="cv-heading">
      <div><h1>Your play vault<span aria-hidden="true">✦</span></h1><p>A home for your tokens, room credit and next adventure.</p></div>
      <button className="btn-ghost cv-back" onClick={() => navigate('/center')}><ArrowLeft size={16} /> Game center</button>
    </header>
    {!session.address ? <section className="cv-connect">
      <div className="cv-treasure" aria-hidden="true"><Coins size={78} strokeWidth={1.35} /><span>✦</span><i>✧</i></div>
      <div><span className="cv-pill"><Gamepad2 size={15} /> A wallet for your next game</span><h2>Bring your wallet.<br />Keep the fun going.</h2>
        <p>Connect to see your token balance, manage room credit and follow your game-center transactions.</p>
        <button className="btn-primary" onClick={onConnect}><Wallet size={18} /> Connect wallet</button>
        <small>Browser wallet or a new wallet saved on this device. Signing in does not send a transaction.</small>
      </div>
    </section> : <>
      <section className="cv-identity">
        <span className="cv-wallet-icon" aria-hidden="true"><Wallet size={25} /></span>
        <div><b>{session.kind === 'generated' ? 'Your device wallet' : 'Your connected wallet'}</b><code title={session.address} translate="no">{session.address}</code></div>
        <button className="btn-ghost" onClick={() => void copyAddress()}><Copy size={15} /> Copy address</button>
      </section>
      {copyStatus && <p className="cv-notice" role="status">{copyStatus}</p>}
      {!session.token && <section className="cv-notice cv-signin"><ShieldCheck size={24} /><div><b>Sign in to open your vault</b><p>Your wallet is selected. Sign a message to load balances and your ledger.</p></div><button className="btn-primary" onClick={onConnect}>Sign in</button></section>}
      <div className="cv-balance-grid" aria-busy={loading}>
        <section className="cv-balance cv-wallet-balance"><div className="cv-card-top"><Wallet size={21} /><span>{onchain?.chainId ? `Chain ${onchain.chainId}` : 'Wallet holdings'}</span></div><h2>In your wallet</h2>
          <p className="cv-amount">{loading && !onchain ? '…' : formatCenterToken(onchain?.live ? onchain.wallet : null)}<small translate="no">{symbol}</small></p>
          <p>Tokens held at your wallet address.</p>{onchain?.live === false && <span className="cv-status">Live balance unavailable on this deployment</span>}
        </section>
        <section className="cv-balance cv-vault-balance"><div className="cv-card-top"><Landmark size={21} /><span>{vault?.simulated ? 'Preview mode' : 'Game-center credit'}</span></div><h2>{vault?.simulated ? 'Preview room credit' : 'Your vault credit'}</h2>
          <p className="cv-amount">{loading && !vault ? '…' : vault?.simulated ? vault.balance.toLocaleString('en-US') : formatCenterToken(vault?.balance)}<small translate="no">{vault?.simulated ? 'credits' : symbol}</small></p>
          <p>{vault?.simulated ? 'Simulated credit for preview rooms. These points are not blockchain tokens.' : 'Available room credit recorded by the game center.'}</p>
          {onchain?.live && onchain.vaultCredit != null && <span className="cv-status">On-chain vault: {formatCenterToken(onchain.vaultCredit)} {symbol}</span>}
        </section>
      </div>
      <div className="cv-sync"><span role="status">{loading ? 'Refreshing balances…' : lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Refreshes while this page is open.` : 'Connect and sign in to read your balances.'}</span><button className="btn-ghost" disabled={loading || !session.token} onClick={() => void refresh()}><RefreshCw size={14} className={loading ? 'cv-spin' : ''} /> Refresh</button></div>
      {error && <p className="cv-error" role="alert">Balances could not be fully loaded. {error}</p>}
      <div className="cv-columns">
        <div className="cv-deposit">
          <div className="cv-section-heading"><Zap size={22} /><div><h2>Fuel your next room</h2><p>Move tokens from your wallet into room credit.</p></div></div>
          {readyForDeposit ? session.kind === 'injected' ? <DepositPanel key={`${session.address}:${session.token}`} onchain={onchain} token={session.token!} address={session.address} onConfirmed={() => { void refresh() }} /> : <div className="cv-notice"><p>Contract deposits use a browser wallet. Connect the browser wallet you want to deposit from, then review its balance here.</p><button className="btn-ghost" onClick={onConnect}>Choose browser wallet <ArrowUpRight size={15} /></button></div> : <div className="cv-notice"><Landmark size={29} /><p>{loading ? 'Checking the vault connection…' : vault?.simulated ? 'This deployment uses preview room credit. On-chain deposits are unavailable here.' : 'Live vault details are unavailable. Refresh your balances before depositing.'}</p></div>}
          {onchain?.live && <details className="cv-contracts"><summary>Token and vault details</summary><dl><dt>Network</dt><dd>{onchain.chainId === 46630 ? 'Robinhood Chain Testnet · 46630' : `Chain ${onchain.chainId ?? 'unavailable'}`}</dd><dt>Token</dt><dd translate="no">{onchain.token ?? 'Unavailable'}</dd><dt>Vault contract</dt><dd translate="no">{onchain.vaultAddress ?? 'Unavailable'}</dd></dl></details>}
          <button className="btn-ghost cv-funds-toggle" onClick={() => setShowFunds(value => !value)} aria-expanded={showFunds}><Coins size={16} /> {showFunds ? 'Hide other testnet holdings' : 'See other testnet holdings'}</button>
          {showFunds && <FundsPanel key={session.address} address={session.address} onConnect={onConnect} />}
        </div>
        <section className="cv-ledger"><div className="cv-section-heading"><div><h2>Your recent activity</h2><p>Deposits, room charges and refunds.</p></div><button className="btn-ghost" disabled={!session.token || exporting} onClick={() => void exportLedger()} aria-label="Export ledger as CSV"><Download size={17} /> {exporting ? 'Exporting…' : 'CSV'}</button></div>
          {loading && !vault ? <p className="cv-ledger-empty" role="status">Loading your ledger…</p> : !vault ? <p className="cv-ledger-empty">{session.token ? 'Ledger unavailable. Refresh to try again.' : 'Sign in to see your activity.'}</p> : vault.ledger.length === 0 ? <div className="cv-ledger-empty"><span aria-hidden="true">✧</span><h3>A fresh start.</h3><p>Your first room charge or deposit will appear here.</p><button className="btn-ghost" onClick={() => navigate('/center')}>Explore games</button></div> : <ul className="cv-ledger-list">{vault.ledger.map(row => {
            const simulated = row.unit === 'simulated'
            const amount = simulated ? Number(row.amount).toLocaleString('en-US') : formatCenterToken(row.amount)
            return <li key={row.id}><span className={`cv-ledger-mark ${row.kind.includes('refund') || row.kind.includes('deposit') ? 'cv-credit' : ''}`} aria-hidden="true">{row.kind.includes('refund') || row.kind.includes('deposit') ? '+' : '−'}</span><div><b>{row.kind.replace(/-/g, ' ').replace(/^\w/, char => char.toUpperCase())}</b><small>{row.room_id ? `Room ${shortAddress(row.room_id, 4)}` : 'Vault activity'} · {new Date(row.created_at * 1000).toLocaleDateString()}</small></div><strong>{amount}<small>{simulated ? 'preview credits' : symbol}</small></strong></li>
          })}</ul>}
          {exportError && <p className="cv-error" role="alert">{exportError}</p>}
          <p className="cv-ledger-note">Your ledger records game-center credit. Blockchain confirmations and game scores are separate states.</p>
        </section>
      </div>
    </>}
  </div>
}
