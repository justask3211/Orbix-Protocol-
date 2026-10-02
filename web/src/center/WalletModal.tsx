// Wallet connect modal: connect an injected wallet OR generate a new one.
// The generate path reveals the private key exactly once with a copy button
// and an unmissable warning; localStorage restores it on every later visit.

import { useState } from 'react'
import type { SessionState, GeneratedWallet } from './session'
import { hasInjected, shortAddress } from './session'

export function WalletModal({ session, onClose }: { session: SessionState; onClose: () => void }) {
  const [generated, setGenerated] = useState<GeneratedWallet | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  const doGenerate = () => {
    const w = session.generate()
    if (w) {
      setGenerated(w)
      setCopied(false)
    }
  }

  const copyKey = async () => {
    if (!generated) return
    await navigator.clipboard.writeText(generated.privateKey)
    setCopied(true)
  }

  return (
    <div className="wl-backdrop" onClick={onClose} role="presentation">
      <div className="wl-modal" role="dialog" aria-modal="true" aria-label="Connect a wallet" onClick={(e) => e.stopPropagation()}>
        <button className="wl-close" onClick={onClose} aria-label="Close">✕</button>

        {!generated ? (
          <>
            <h3>Connect a wallet</h3>
            <p className="wl-sub">Pick how you want to hold your ORBIX. Both are real EVM wallets — the vault deducts from whichever you use.</p>

            <button className="wl-option primary" onClick={() => { setBusy(true); void session.connectInjected().finally(() => setBusy(false)) }}>
              <span className="wl-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M21 12a2 2 0 0 0-2-2H5a2 2 0 0 1 0-4h11a1 1 0 0 1 1 1v2" />
                  <path d="M21 12v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5" />
                  <circle cx="17.5" cy="14.5" r="1" fill="currentColor" stroke="none" />
                </svg>
              </span>
              <span>
                <b>Browser wallet</b>
                <small>{hasInjected() ? 'MetaMask, Rainbow, Rabby — one signature to sign in.' : 'No wallet detected — installing MetaMask takes a minute.'}</small>
              </span>
              <span className="wl-arrow" aria-hidden="true">→</span>
            </button>

            <button className="wl-option" onClick={doGenerate}>
              <span className="wl-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v10M9.5 9.5c0-1 1-1.7 2.5-1.7s2.5.7 2.5 1.7-1 1.5-2.5 1.8-2.5.8-2.5 1.8 1 1.7 2.5 1.7 2.5-.7 2.5-1.7" />
                </svg>
              </span>
              <span>
                <b>Generate new wallet</b>
                <small>One tap. We create an EVM key in this browser and save it — you get a recovery key to copy.</small>
              </span>
              <span className="wl-arrow" aria-hidden="true">→</span>
            </button>

            {session.error && <p className="err">{session.error}</p>}
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
              <code className="wl-key">{generated.privateKey}</code>
              <div className="ct-actions">
                <button className="btn-primary" onClick={copyKey}>{copied ? 'Copied ✓' : 'Copy key'}</button>
                <button
                  className="btn-ghost"
                  disabled={!copied}
                  onClick={() => { void session.signIn().then(onClose) }}
                  title={copied ? undefined : 'Copy the key first'}
                >
                  I saved it — continue
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
