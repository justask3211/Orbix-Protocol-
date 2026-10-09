// Wallet connect modal: injected/QR connectors, local generation and recovery.
// The generate path reveals the private key exactly once with a copy button
// and an unmissable warning; localStorage restores it on every later visit.

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { SessionState, GeneratedWallet } from './session'
import { shortAddress } from './session'
import { accountFromRecoveryKey } from './walletKeys'
import { injectedConnectors, watchInjectedConnectors, walletConnectProjectId } from './walletConnectors'
import { WalletMark } from './WalletMarks'
const WalletQr = lazy(()=>import('./WalletQr'))
import { copyText } from './share'
import { useModalFocus } from './useModalFocus'

export function WalletModal({ session, onClose, onConnected }: { session: SessionState; onClose: () => void; onConnected?: () => void }) {
  const [generated, setGenerated] = useState<GeneratedWallet | null>(null)
  const [pairingUri,setPairingUri] = useState('')
  const pairingAbort = useRef<AbortController | null>(null)
  useEffect(()=>()=>{pairingAbort.current?.abort()},[])
  const [connectors,setConnectors] = useState(injectedConnectors)
  const [recovering,setRecovering] = useState(false)
  const [recoveryKey,setRecoveryKey] = useState('')
  let recoveryAddress = ''
  let recoveryError = ''
  if(recoveryKey)try{recoveryAddress=accountFromRecoveryKey(recoveryKey).address}catch(error){recoveryError=(error as Error).message}
  useEffect(()=>watchInjectedConnectors(()=>setConnectors(injectedConnectors())),[])
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dismissError, setDismissError] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const dismiss = () => {
    if (generated && !copied) { setDismissError('Copy and save your recovery key before closing.'); return }
    pairingAbort.current?.abort()
    onClose()
  }
  const dialog = useModalFocus(dismiss)
  useEffect(()=>{
    if(!pairingUri)return
    const frame=requestAnimationFrame(()=>dialog.current?.querySelector<HTMLButtonElement>('.wl-pairing button')?.focus())
    return ()=>cancelAnimationFrame(frame)
  },[pairingUri,dialog])
  const connect = async (method: () => Promise<boolean>) => {
    if (busy || session.signingIn) return
    setBusy(true)
    setDismissError(null)
    try {
      const verified = await method()
      if (verified && mounted.current) { onConnected?.(); onClose() }
    } catch {
      // The session reports the server or wallet failure; retain this dialog for retry.
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const connectQr = () => {
    const abort=new AbortController();pairingAbort.current=abort
    void connect(async()=>{
      try{return await session.connectWalletConnect(uri=>{if(mounted.current)setPairingUri(uri)},abort.signal)}
      finally{if(mounted.current)setPairingUri('');pairingAbort.current=null}
    })
  }
  const doGenerate = () => {
    const w = session.generate()
    if (w) {
      setGenerated(w)
      setCopied(false)
    }
  }

  const copyKey = async () => {
    if (!generated) return
    const ok = await copyText(generated.privateKey)
    setCopied(ok)
  }

  return (
    <div className="wl-backdrop" onClick={dismiss} role="presentation">
      <div ref={dialog} tabIndex={-1} className="wl-modal wl-wallet-modal" role="dialog" aria-modal="true" aria-label="Connect a wallet" onClick={(e) => e.stopPropagation()}>
        <button className="wl-close" onClick={dismiss} aria-label="Close">✕</button>
        {dismissError && <p className="err" role="alert">{dismissError}</p>}

        {!generated ? (
          <>
            <h3>Connect a wallet</h3>
            <p className="wl-sub">Choose your wallet for Orbix. Signing in proves ownership with a message; it does not send a transaction.</p>

            <div hidden={Boolean(pairingUri)}>
            <section aria-label="Connect an existing wallet" className="wl-connect-section">
              <h4>Connect</h4>
              {connectors.length ? connectors.map(connector=><button key={connector.id} className={`wl-option wl-tile-${connector.brand}`} disabled={busy || session.signingIn} onClick={()=>void connect(()=>session.connectInjected(connector.provider))}>
                <span className="wl-icon"><WalletMark brand={connector.brand}/></span><span><b>{connector.name}</b><small>Detected in this browser · sign a message to continue</small></span><span className="wl-arrow" aria-hidden="true">→</span>
              </button>) : <button className="wl-option wl-tile-metamask" disabled={busy || session.signingIn} onClick={()=>void connect(()=>session.connectInjected())}>
                <span className="wl-icon"><WalletMark brand="metamask"/></span><span><b>MetaMask / browser wallet</b><small>No extension detected. MetaMask, Rainbow and Trust are supported.</small></span><span className="wl-arrow" aria-hidden="true">→</span>
              </button>}
              <button className="wl-option wl-tile-walletconnect" disabled={busy || session.signingIn || !walletConnectProjectId()} onClick={connectQr}>
                <span className="wl-icon"><WalletMark brand="walletconnect"/></span><span><b>WalletConnect QR</b><small>{walletConnectProjectId()?'Scan with a mobile wallet · no connection fee':'QR connection is currently unavailable'}</small></span><span className="wl-arrow" aria-hidden="true">→</span>
              </button>
            </section>
            <section aria-label="Generate or recover a wallet" className="wl-local-section">
              <h4>Your Orbix wallet</h4>
              <button className="wl-option wl-tile-generate" disabled={busy || session.signingIn} onClick={doGenerate}>
                <span className="wl-icon"><WalletMark brand="generate"/></span><span><b>Generate new wallet</b><small>Created in this browser. Save the recovery key to return on any device.</small></span><span className="wl-arrow" aria-hidden="true">→</span>
              </button>
              <button className="wl-option wl-tile-recover" disabled={busy || session.signingIn} aria-expanded={recovering} onClick={()=>{setRecovering(!recovering);setRecoveryKey('')}}>
                <span className="wl-icon"><WalletMark brand="recover"/></span><span><b>Recover with key</b><small>Bring back your saved wallet and profile. The key stays in this browser.</small></span><span className="wl-arrow" aria-hidden="true">{recovering?'−':'+'}</span>
              </button>
              {recovering && <form className="wl-import" onSubmit={e=>{e.preventDefault();const key=recoveryKey;setRecoveryKey('');void connect(()=>session.recover(key))}}>
                <label>Saved private key<input type="password" value={recoveryKey} onChange={e=>setRecoveryKey(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="0x + 64 hexadecimal characters" aria-invalid={Boolean(recoveryError)}/></label>
                {recoveryError && <p className="err" role="alert">{recoveryError}</p>}
                {recoveryAddress && <p className="wl-recovered-address">Wallet: {shortAddress(recoveryAddress,6)}</p>}
                <p className="muted">Orbix-generated wallets use a private key, not a seed phrase. Recovery signs you in locally; only your address and signature go to Orbix.</p>
                <button className="btn-primary" disabled={!recoveryAddress || busy || session.signingIn}>Recover and sign in</button>
              </form>}
            </section>

            </div>
            {pairingUri && <div className="wl-pairing" role="region" aria-label="WalletConnect pairing">
              <h4>Scan with your mobile wallet</h4>
              <Suspense fallback={<p role="status">Preparing your QR code…</p>}><WalletQr uri={pairingUri}/></Suspense>
              <p className="muted">Approve the connection, then sign the Orbix sign-in message in your wallet. No transaction is requested.</p>
              <div className="ct-actions"><button className="btn-ghost" onClick={()=>void copyText(pairingUri)}>Copy connection link</button><button className="btn-ghost" onClick={()=>pairingAbort.current?.abort()}>Cancel QR connection</button></div>
            </div>}
            {busy && <p className="muted">Waiting for your wallet…</p>}
          </>
        ) : (
          <>
            <h3>Save your recovery key</h3>
            <p className="wl-sub">
              Your wallet is ready: <span className="wl-addr-chip">{shortAddress(generated.address, 6)}</span>
              {' '}It lives in this browser and restores automatically every visit. The key below is the ONLY way back in from another device.
            </p>
            <div className="wl-recovery">
              <p className="wl-warn">Copy this private key now and store it somewhere safe. We cannot show it again or recover it.</p>
              <code className="wl-key" translate="no" spellCheck={false}>{generated.privateKey}</code>
              <div className="ct-actions">
                <button className="btn-primary" onClick={copyKey}>{copied ? 'Copied ✓' : 'Copy key'}</button>
                <button
                  className="btn-ghost"
                  disabled={!copied || busy || session.signingIn}
                  onClick={() => { void connect(session.signIn) }}
                  title={copied ? undefined : 'Copy the key first'}
                >
                  {busy || session.signingIn ? 'Signing in…' : 'I saved it — continue'}
                </button>
              </div>
            </div>
          </>
        )}
        {session.error && <p className="err" role="alert">{session.error}</p>}
      </div>
    </div>
  )
}
