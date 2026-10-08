// Wallet connect modal: connect an injected wallet OR generate a new one.
// The generate path reveals the private key exactly once with a copy button
// and an unmissable warning; localStorage restores it on every later visit.

import { useEffect, useRef, useState } from 'react'
import type { SessionState, GeneratedWallet } from './session'
import { hasInjected, shortAddress } from './session'
import { copyText } from './share'
import { useModalFocus } from './useModalFocus'

export function WalletModal({ session, onClose, onConnected }: { session: SessionState; onClose: () => void; onConnected?: () => void }) {
  const [generated, setGenerated] = useState<GeneratedWallet | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dismissError, setDismissError] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const dismiss = () => {
    if (generated && !copied) { setDismissError('Copy and save your recovery key before closing.'); return }
    onClose()
  }
  const dialog = useModalFocus(dismiss)
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
      <div ref={dialog} tabIndex={-1} className="wl-modal" role="dialog" aria-modal="true" aria-label="Connect a wallet" onClick={(e) => e.stopPropagation()}>
        <button className="wl-close" onClick={dismiss} aria-label="Close">✕</button>
        {dismissError && <p className="err" role="alert">{dismissError}</p>}

        {!generated ? (
          <>
            <h3>Connect a wallet</h3>
            <p className="wl-sub">Choose your wallet for Orbix. Signing in proves ownership with a message; it does not send a transaction.</p>

            <button className="wl-option primary" disabled={busy || session.signingIn} onClick={() => { void connect(session.connectInjected) }}>
              <span className="wl-icon wl-icon-metamask" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                  <path d="M23 3.5l-8.2 6.1 1.5-3.6L23 3.5z" fill="#E2761B"/>
                  <path d="M3 3.5l8.1 6.2-1.4-3.7L3 3.5z" fill="#E4761B"/>
                  <path d="M19.9 17.2l-2.2 3.4 4.7 1.3 1.4-4.6-3.9-.1zM2.2 17.3l1.4 4.6 4.7-1.3-2.2-3.4-3.9.1z" fill="#E4761B"/>
                  <path d="M8 11.6l-1.3 2 4.6.2-.2-5L8 11.6zM18 11.6l-3.2-4.9-.1 5.1 4.6-.2-1.3-2z" fill="#E4761B"/>
                  <path d="M8.3 20.6l2.8-1.4-2.4-1.9-.4 3.3zM14.9 19.2l2.8 1.4-.4-3.3-2.4 1.9z" fill="#D7C1B3"/>
                  <path d="M17.7 20.6l-2.8-1.4.2 1.8v1.3l2.6-1.7zM8.3 20.6l2.6 1.7v-1.3l.2-1.8-2.8 1.4z" fill="#233447"/>
                  <path d="M11 16.2l-2.3-.7 1.6-.8.7 1.5zM15 16.2l.7-1.5 1.6.8-2.3.7z" fill="#CD6116"/>
                  <path d="M8.3 20.6l.5-3.4-2.6.1 2.1 3.3zM17.2 17.2l.5 3.4 2.1-3.3-2.6-.1zM19.3 13.6l-4.6.2.4 2.4.7-1.5 1.6.8-1.9-1.9zM8.7 15.5l1.6-.8.7 1.5.4-2.4-4.6-.2 1.9 1.9z" fill="#E4751F"/>
                  <path d="M6.8 13.6l1.9 3.7-.1-1.8-1.8-1.9zM17.4 15.5l-.1 1.8 1.9-3.7-1.8 1.9zM11.4 13.8l-.4 2.4.5 2.6.1-3.4v-1.6zM14.7 13.8l-.2 1.6.1 3.4.5-2.6-.4-2.4z" fill="#233447"/>
                </svg>
              </span>
              <span>
                <b>Browser wallet</b>
                <small>{hasInjected() ? 'MetaMask, Rainbow, Rabby — one signature to sign in.' : 'No wallet detected — installing MetaMask takes a minute.'}</small>
              </span>
              <span className="wl-arrow" aria-hidden="true">→</span>
            </button>

            <button className="wl-option" disabled={busy || session.signingIn} onClick={doGenerate}>
              <span className="wl-icon wl-icon-generate" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="#ff6b22" strokeWidth="1.5" strokeOpacity="0.55" />
                  <path d="M12 6.5l1.6 3.4 3.4 1.6-3.4 1.6L12 16.5l-1.6-3.4L7 11.5l3.4-1.6L12 6.5z" fill="#ff6b22" />
                  <circle cx="12" cy="12" r="2.1" fill="#0e1012" />
                  <circle cx="12" cy="12" r="1.1" fill="#ffd166" />
                </svg>
              </span>
              <span>
                <b>Generate new wallet</b>
                <small>One tap. We create an EVM key in this browser and save it — you get a recovery key to copy.</small>
              </span>
              <span className="wl-arrow" aria-hidden="true">→</span>
            </button>

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
