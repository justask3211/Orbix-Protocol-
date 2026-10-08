// Profile panel: view and edit display name, bio, hue, address privacy.
// Shows as a small avatar circle next to the wallet chip in the topbar.
// Opens as a modal for editing.

import { useState, useEffect } from 'react'
import { center } from './api'
import { ProfileImageUpload } from './ProfileImage'
import { shortAddress } from './session'
import { useModalFocus } from './useModalFocus'

type Profile = { name: string; bio: string; hue: number; showAddress: boolean; hasImage?: boolean }
const knownProfiles = new Map<string, Profile>()

const HUES = [0, 30, 60, 90, 140, 180, 220, 270, 310, 340]

export function useProfile(address: string | null, token: string | null) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedAddress, setLoadedAddress] = useState<string | null>(null)
  const [revision, setRevision] = useState(() => Date.now())
  useEffect(() => {
    const refresh = () => setRevision(previous => Math.max(Date.now(), previous + 1))
    window.addEventListener('orbix-profile-changed', refresh)
    return () => window.removeEventListener('orbix-profile-changed', refresh)
  }, [])

  useEffect(() => {
    let active = true
    setLoadedAddress(address)
    setProfile(address ? knownProfiles.get(address.toLowerCase()) ?? null : null)
    setError(null)
    if (!address) { setLoading(false); return }
    setLoading(true)
    center.getProfile(address).then((p: any) => {
      if (active) { knownProfiles.set(address.toLowerCase(), p); setProfile(p) }
    }).catch(() => { if (active) setError('Could not load your saved profile. Retry before editing.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [address, token, revision])

  return { profile: loadedAddress === address ? profile : null, setProfile, loading, revision, error, retry: () => setRevision(v => v + 1) }
}

export function ProfileAvatar({ name, hue, size = 32, onClick, hasWallet }: {
  name?: string; hue?: number; size?: number; onClick?: () => void; hasWallet?: boolean
}) {
  const letter = name?.[0]?.toUpperCase() ?? '?'
  const h = hue ?? 0
  return (
    <button
      className="pf-avatar"
      style={{
        width: size, height: size,
        background: `hsl(${h}, 65%, ${hasWallet ? 32 : 18}%)`,
        borderColor: `hsl(${h}, 65%, 50%)`,
      }}
      onClick={onClick}
      aria-label={hasWallet ? 'Open profile' : 'Connect wallet'}
      title={hasWallet ? 'Your profile' : 'Connect wallet'}
    >
      {hasWallet ? letter : (
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" strokeLinecap="round" />
        </svg>
      )}
    </button>
  )
}

export function ProfileModal({ session, profile, onClose, onSave }: {
  session: { address: string | null; token: string | null }
  profile: Profile | null
  onClose: () => void
  onSave: (p: Profile) => void
}) {
  const [name, setName] = useState(profile?.name ?? '')
  const [bio, setBio] = useState(profile?.bio ?? '')
  const [hue, setHue] = useState(profile?.hue ?? 200)
  const [showAddr, setShowAddr] = useState(profile?.showAddress ?? true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [hasImage, setHasImage] = useState(Boolean(profile?.hasImage))
  const dialog = useModalFocus(onClose)

  const save = async () => {
    setBusy(true); setErr(null)
    try {
      const res = await center.setProfile(session.token!, { name, bio, hue, showAddress: showAddr })
      window.dispatchEvent(new Event('orbix-profile-changed'))
      onSave(res)
      onClose()
    } catch (e: any) {
      setErr(e?.detail?.message ?? e?.message ?? 'Failed to save profile.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wl-backdrop" onClick={onClose} role="presentation">
      <div ref={dialog} tabIndex={-1} className="wl-modal pf-modal" role="dialog" aria-modal="true" aria-label="Edit profile" onClick={(e) => e.stopPropagation()}>
        <button className="wl-close" onClick={onClose} aria-label="Close">✕</button>
        <h3>Your profile</h3>
        <p className="wl-sub">This is what other players see in game logs and player lists.</p>

        <div className="pf-preview" style={{ ['--pf-hue' as string]: `${hue}` }}>
          <div className="pf-avatar-preview">{name?.[0]?.toUpperCase() || '?'}</div>
          <div>
            <b>{name || 'No name set'}</b>
            <small>{shortAddress(session.address ?? '', 6)}</small>
          </div>
        </div>

        <label className="pf-field">
          <span>Display name</span>
          <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)}
            placeholder="How other players see you" autoComplete="off" />
        </label>

        <label className="pf-field">
          <span>Bio</span>
          <textarea value={bio} maxLength={200} rows={2} onChange={(e) => setBio(e.target.value)}
            placeholder="A short bio (optional)" />
        </label>

        {session.address && session.token && (
          <div className="pf-field">
            <span>Profile image</span>
            <ProfileImageUpload
              address={session.address}
              token={session.token}
              hasImage={hasImage}
              onUploaded={() => setHasImage(true)}
            />
          </div>
        )}

        <label className="pf-field">
          <span>Profile color</span>
          <div className="pf-hues">
            {HUES.map((h) => (
              <button key={h} className={`pf-hue${hue === h ? ' on' : ''}`}
                style={{ background: `hsl(${h}, 65%, 35%)` }}
                onClick={() => setHue(h)}
                aria-label={`Color ${h}`}
              />
            ))}
          </div>
        </label>

        <label className="pf-field pf-toggle">
          <input type="checkbox" checked={showAddr} onChange={(e) => setShowAddr(e.target.checked)} />
          <span>Show my wallet address to other players</span>
        </label>

        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn-primary" style={{ width: '100%' }} onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </div>
  )
}
