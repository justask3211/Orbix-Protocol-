// Admin panel: configure the platform fee schedule the server enforces.
// Admin identity = the exact admin wallet + a single-use signed proof
// (server checks both; a lookalike page or address suffix proves nothing).

import { useEffect, useState } from 'react'
import { center, explainError } from './api'
import type { SessionState } from './session'

type Pricing = { pricing: { creatorFee: number; joinerFee: number }; caps?: Record<string, number>; admin?: string; chainId?: number }

async function adminProof(session: SessionState, nonce: string): Promise<string> {
  // generated wallet: sign locally. injected: window.ethereum personal_sign.
  if (session.kind === 'generated') {
    const { loadGeneratedAccount } = await import('./session')
    const acct = loadGeneratedAccount()
    if (!acct) throw new Error('no saved wallet')
    return acct.signMessage({ message: `Orbix Center admin action\nnonce: ${nonce}` })
  }
  const eth = (window as any).ethereum
  if (!eth) throw new Error('no wallet to sign with')
  return eth.request({ method: 'personal_sign', params: [`Orbix Center admin action\nnonce: ${nonce}`, session.address] })
}

export function AdminPanel({ session }: { session: SessionState }) {
  const [data, setData] = useState<Pricing | null>(null)
  const [creatorFee, setCreatorFee] = useState('')
  const [joinerFee, setJoinerFee] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!session.token) return
    center.adminPricing(session.token).then((d) => {
      const p = d as Pricing
      setData(p)
      setCreatorFee(String(p.pricing?.creatorFee ?? 0))
      setJoinerFee(String(p.pricing?.joinerFee ?? 0))
    }).catch((e) => setErr(explainError(e)))
  }, [session.token])

  const save = async () => {
    if (!session.token) return
    setBusy(true); setMsg(null); setErr(null)
    try {
      const { nonce } = await center.adminNonce(session.token)
      const signature = await adminProof(session, nonce)
      const d = await center.adminUpdatePricing(session.token, signature, {
        creatorFee: Number(creatorFee) || 0,
        joinerFee: Number(joinerFee) || 0,
      })
      setData(d as Pricing)
      setMsg('Saved. Rooms published from now on use these limits; open rooms keep their frozen snapshot. The change is in the audit hash chain.')
    } catch (e) {
      setErr(explainError(e))
    } finally {
      setBusy(false)
    }
  }

  const isAdmin = Boolean(session.address && data?.admin && session.address.toLowerCase() === data.admin.toLowerCase())

  return (
    <div className="ct-page">
      <header className="ct-head">
        <div>
          <h1>Admin</h1>
          <p className="sub">Platform-wide fee schedule. Changes apply to rooms published after the save; open rooms keep their frozen snapshot. Every mutation is signed by you and written to the tamper-evident audit chain.</p>
        </div>
      </header>

      {!session.token && <p className="muted">Sign in with the admin wallet to configure anything.</p>}

      {session.token && !isAdmin && data && (
        <p className="err">Connected wallet is not the pricing authority. The server checks the exact admin address and a fresh single-use signature — a lookalike page or address suffix proves nothing.</p>
      )}

      {session.token && data && (
        <>
          <div className="ad-grid">
            <div className="ad-card">
              <h4>Room creation fee (ORBIX)</h4>
              <p className="sub">Deducted from the creator's vault when a room is published. Set 0 for free creation during onboarding.</p>
              <input type="number" min={0} max={data.caps?.creatorFeeCap ?? 100000} value={creatorFee} onChange={(e) => setCreatorFee(e.target.value)} aria-label="Room creation fee" />
            </div>
            <div className="ad-card">
              <h4>Joiner fee (ORBIX)</h4>
              <p className="sub">Per-player fee for every join unless the creator absorbs it. Capped against abuse.</p>
              <input type="number" min={0} max={data.caps?.joinerFeeCap ?? 100000} value={joinerFee} onChange={(e) => setJoinerFee(e.target.value)} aria-label="Joiner fee" />
            </div>
          </div>

          <div className="ct-actions" style={{ marginTop: 16 }}>
            <button className="btn-primary" onClick={save} disabled={busy || !isAdmin}>
              {busy ? 'Signing & saving…' : 'Sign & save limits'}
            </button>
            {data.chainId && <span className="ad-pill warn">chain {data.chainId} · hash-chained audit</span>}
            {isAdmin && <span className="ad-pill ok">admin wallet verified</span>}
          </div>
          {msg && <p className="wz-why">{msg}</p>}
          {err && <p className="err">{err}</p>}
        </>
      )}
    </div>
  )
}
