// Preview wallet + session.
//
// Honesty rule from the build manual: on this deployment the vault balance is simulated,
// so the wallet is labelled as a demo key. It is a real secp256k1 key that really signs
// the sign-in challenge, but it holds no funds — no player is ever told otherwise.

import { useCallback, useEffect, useState } from 'react'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { center } from './api'

const KEY_STORAGE = 'orbix.center.demoKey'
const TOKEN_STORAGE = 'orbix.center.session'

export type DemoWallet = { address: `0x${string}`; label: string; created: boolean }

function loadKey(): `0x${string}` {
  const existing = localStorage.getItem(KEY_STORAGE)
  if (existing && /^0x[0-9a-fA-F]{64}$/.test(existing)) return existing as `0x${string}`
  const fresh = generatePrivateKey()
  localStorage.setItem(KEY_STORAGE, fresh)
  return fresh
}

export function demoWallet(): DemoWallet {
  const already = localStorage.getItem(KEY_STORAGE)
  const key = loadKey()
  return { address: privateKeyToAccount(key).address, label: 'Demo wallet', created: !already }
}

export function resetWallet(): void {
  localStorage.removeItem(KEY_STORAGE)
  localStorage.removeItem(TOKEN_STORAGE)
}

export type SessionState = {
  wallet: DemoWallet
  token: string | null
  address: `0x${string}`
  signingIn: boolean
  error: string | null
  signIn: () => Promise<void>
  signOut: () => void
  reset: () => void
}

export function useSession(): SessionState {
  const [wallet, setWallet] = useState<DemoWallet>(() => demoWallet())
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE))
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signIn = useCallback(async () => {
    setSigningIn(true)
    setError(null)
    try {
      const key = localStorage.getItem(KEY_STORAGE) as `0x${string}`
      const account = privateKeyToAccount(key)
      const { nonce, message } = await center.nonce(account.address)
      const signature = await account.signMessage({ message })
      const { token: fresh } = await center.verify(account.address, nonce, signature)
      localStorage.setItem(TOKEN_STORAGE, fresh)
      setToken(fresh)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSigningIn(false)
    }
  }, [])

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE)
    setToken(null)
  }, [])

  const reset = useCallback(() => {
    resetWallet()
    const fresh = demoWallet()
    setWallet(fresh)
    setToken(null)
  }, [])

  useEffect(() => {
    setWallet(demoWallet())
  }, [])

  return { wallet, token, address: wallet.address, signingIn, error, signIn, signOut, reset }
}

export function shortAddress(address?: string | null, size = 4): string {
  if (!address) return '—'
  return `${address.slice(0, 2 + size)}…${address.slice(-size)}`
}

/** Deterministic per-wallet accent so a lobby of players is readable at a glance. */
export function playerHue(address: string): number {
  let h = 0
  for (const ch of address.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}
