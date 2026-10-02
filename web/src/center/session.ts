// Wallet + session.
//
// Two ways in, both real EVM:
//   1. CONNECT — a browser wallet (MetaMask/Rainbow/etc.) via window.ethereum.
//   2. GENERATE — the site mints a fresh EVM key, shows the address + private key
//      ONCE for the user to copy, and remembers it in localStorage so every visit
//      restores the same wallet automatically.
//
// Honesty rule: a generated wallet is a real secp256k1 key held by the browser.
// The recovery key screen says plainly: copy it, we cannot recover it for you.

import { useCallback, useEffect, useState } from 'react'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { PrivateKeyAccount } from 'viem/accounts'
import { center } from './api'

const KEY_STORAGE = 'orbix.wallet.key'
const TOKEN_STORAGE = 'orbix.session.token'
const WALLET_KIND = 'orbix.wallet.kind' // 'generated' | 'injected'

type WalletKind = 'generated' | 'injected'

export type GeneratedWallet = { address: string; privateKey: string }

export function hasInjected(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).ethereum)
}

function loadStoredAccount(): PrivateKeyAccount | null {
  const existing = localStorage.getItem(KEY_STORAGE)
  if (existing && /^0x[0-9a-fA-F]{64}$/.test(existing)) {
    return privateKeyToAccount(existing as `0x${string}`)
  }
  return null
}

export function createWallet(): GeneratedWallet {
  const privateKey = generatePrivateKey()
  const account = privateKeyToAccount(privateKey)
  localStorage.setItem(KEY_STORAGE, privateKey)
  localStorage.setItem(WALLET_KIND, 'generated')
  return { address: account.address, privateKey }
}

export function loadGeneratedAccount(): PrivateKeyAccount | null {
  return loadStoredAccount()
}

export function walletKind(): WalletKind | null {
  const k = localStorage.getItem(WALLET_KIND)
  return k === 'injected' || k === 'generated' ? k : null
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

export type SessionState = {
  address: string | null
  kind: WalletKind | null
  connected: boolean
  token: string | null
  signingIn: boolean
  error: string | null
  connectInjected: () => Promise<void>
  generate: () => GeneratedWallet | null
  restoreGenerated: () => void
  signIn: () => Promise<void>
  signOut: () => void
  forget: () => void
}

export function useSession(): SessionState {
  const [address, setAddress] = useState<string | null>(null)
  const [kind, setKind] = useState<WalletKind | null>(null)
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE))
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Restore the generated wallet on every visit (localStorage = the site's memory).
  useEffect(() => {
    const acct = loadStoredAccount()
    if (acct) {
      setAddress(acct.address)
      setKind('generated')
    } else if (walletKind() === 'injected') {
      setKind('injected')
    }
  }, [])

  const signInWith = useCallback(async (sign: (msg: string) => Promise<string>, addr: string, wKind: WalletKind) => {
    setSigningIn(true)
    setError(null)
    try {
      const { nonce, message } = await center.nonce(addr)
      const signature = await sign(message)
      const { token: fresh } = await center.verify(addr, nonce, signature)
      localStorage.setItem(TOKEN_STORAGE, fresh)
      localStorage.setItem(WALLET_KIND, wKind)
      setAddress(addr)
      setKind(wKind)
      setToken(fresh)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      setSigningIn(false)
    }
  }, [])

  const connectInjected = useCallback(async () => {
    const eth = (window as any).ethereum
    if (!eth) {
      setError('No browser wallet found. Install MetaMask, or use "Generate new wallet".')
      return
    }
    try {
      const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' })
      const addr = accounts[0]
      localStorage.setItem(WALLET_KIND, 'injected')
      await signInWith(
        (msg) => eth.request({ method: 'personal_sign', params: [msg, addr] }),
        addr,
        'injected',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wallet connection rejected.')
    }
  }, [signInWith])

  const generate = useCallback((): GeneratedWallet | null => {
    try {
      return createWallet()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    }
  }, [])

  const restoreGenerated = useCallback(() => {
    const acct = loadStoredAccount()
    if (!acct) {
      setError('No saved wallet in this browser. Generate one, or import your key.')
      return
    }
    setAddress(acct.address)
    setKind('generated')
  }, [])

  const signIn = useCallback(async () => {
    const acct = loadStoredAccount()
    if (acct) {
      await signInWith((msg) => acct.signMessage({ message: msg }), acct.address, 'generated')
      return
    }
    if (hasInjected()) {
      await connectInjected()
      return
    }
    setError('Generate a wallet first — it takes one tap and you get a recovery key.')
  }, [signInWith, connectInjected])

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE)
    setToken(null)
  }, [])

  const forget = useCallback(() => {
    localStorage.removeItem(KEY_STORAGE)
    localStorage.removeItem(TOKEN_STORAGE)
    localStorage.removeItem(WALLET_KIND)
    setAddress(null)
    setKind(null)
    setToken(null)
  }, [])

  return {
    address,
    kind,
    connected: Boolean(address && token),
    token,
    signingIn,
    error,
    connectInjected,
    generate,
    restoreGenerated,
    signIn,
    signOut,
    forget,
  }
}

/** Back-compat shim: older code paths read `session.token` / `session.address`. */
export function legacySessionCompat(s: SessionState) {
  return { ...s, signingIn: s.signingIn }
}
