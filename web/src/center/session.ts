// Wallet + session.
//
// Connect, generate or recover a real EVM account:
//   1. CONNECT — a browser wallet (MetaMask/Rainbow/etc.) via window.ethereum.
//   2. GENERATE — the site mints a fresh EVM key, shows the address + private key
//      ONCE for the user to copy, and remembers it in localStorage so every visit
//      restores the same wallet automatically.
//
// Honesty rule: a generated wallet is a real secp256k1 key held by the browser.
// The recovery key screen says plainly: copy it, we cannot recover it for you.

import { useCallback, useEffect, useRef, useState } from 'react'
import { center } from './api'
import { KEY_STORAGE, TOKEN_STORAGE, WALLET_KIND, createWallet, loadGeneratedAccount, saveGeneratedAccount } from './walletKeys'
import { injectedConnectors, selectWalletProvider, activeWalletProvider, walletConnectProvider, pairWalletConnect, startWalletDiscovery, type WalletProvider } from './walletConnectors'
import type { GeneratedWallet } from './walletKeys'
export { createWallet, loadGeneratedAccount } from './walletKeys'
export type { GeneratedWallet } from './walletKeys'

type WalletKind = 'generated' | 'injected' | 'walletconnect'
export function hasInjected(): boolean {return typeof window !== 'undefined' && injectedConnectors().length > 0}
const loadStoredAccount = loadGeneratedAccount

export function walletKind(): WalletKind | null {
  const k = localStorage.getItem(WALLET_KIND)
  return k === 'injected' || k === 'generated' || k === 'walletconnect' ? k : null
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
  autoSigningIn: boolean
  connected: boolean
  token: string | null
  signingIn: boolean
  error: string | null
  connectInjected: (provider?: WalletProvider) => Promise<boolean>
  connectWalletConnect: (onUri?:(uri:string)=>void,signal?:AbortSignal) => Promise<boolean>
  recover: (key:string) => Promise<boolean>
  generate: () => GeneratedWallet | null
  restoreGenerated: () => void
  signIn: () => Promise<boolean>
  signOut: () => void
  forget: () => void
}

export function useSession(): SessionState {
  const [address, setAddress] = useState<string | null>(null)
  const [kind, setKind] = useState<WalletKind | null>(null)
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE))
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const authAttempt = useRef(0)

  // Restore the generated wallet on every visit (localStorage = the site's memory).
  useEffect(() => {
    startWalletDiscovery()
    const acct = loadStoredAccount()
    if (acct) {
      setAddress(acct.address)
      setKind('generated')
    } else if (walletKind()) {
      setKind(walletKind())
    }
  }, [])

  const signInWith = useCallback(async (sign: (msg: string) => Promise<string>, addr: string, wKind: WalletKind, signal?:AbortSignal) => {
    const attempt=++authAttempt.current
    setSigningIn(true)
    setError(null)
    try {
      const { nonce, message } = await center.nonce(addr)
      if(attempt!==authAttempt.current || signal?.aborted)return false
      const signature = await sign(message)
      const { token: fresh } = await center.verify(addr, nonce, signature)
      if(attempt!==authAttempt.current || signal?.aborted)return false
      if (typeof fresh !== 'string' || !fresh) throw new Error('Sign-in could not be verified. Please try again.')
      localStorage.setItem(TOKEN_STORAGE, fresh)
      localStorage.setItem(WALLET_KIND, wKind)
      setAddress(addr)
      setKind(wKind)
      setToken(fresh)
      return true
    } catch (err) {
      if(attempt===authAttempt.current)setError(err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      if(attempt===authAttempt.current)setSigningIn(false)
    }
  }, [])

  const connectProvider = useCallback(async (eth: WalletProvider, wKind: 'injected'|'walletconnect', selectedAccounts?:string[], signal?:AbortSignal) => {
    setError(null)
    try {
      const accounts: string[] = selectedAccounts ?? await eth.request({method:'eth_requestAccounts'})
      const addr = accounts[0]
      if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) throw new Error('Your wallet did not provide a valid EVM account.')
      // EIP-1193 personal_sign takes hex-encoded UTF-8 data.
      const verified = await signInWith(msg => eth.request({method:'personal_sign',params:[
        '0x'+Array.from(new TextEncoder().encode(msg),byte=>byte.toString(16).padStart(2,'0')).join(''),addr,
      ]}),addr,wKind,signal)
      if(verified){selectWalletProvider(eth);setProvider(eth)}
      return verified
    } catch(err) {setError(err instanceof Error?err.message:'Wallet connection rejected.');return false}
  },[signInWith])
  const [provider,setProvider] = useState<WalletProvider | null>(null)
  const connectInjected = useCallback(async (selected?:WalletProvider) => {
    const eth = selected ?? injectedConnectors()[0]?.provider
    if(!eth){setError('No browser wallet found. Generate a wallet or recover with your saved key.');return false}
    return connectProvider(eth,'injected')
  },[connectProvider])
  const connectWalletConnect = useCallback(async (onUri?:(uri:string)=>void,signal?:AbortSignal) => {
    setError(null)
    try {
      const eth=await walletConnectProvider()
      const accounts=await pairWalletConnect(eth,onUri ?? (()=>{}),signal)
      if(signal?.aborted)return false
      return await connectProvider(eth,'walletconnect',accounts,signal)
    }
    catch(err){setError(signal?.aborted?'WalletConnect connection cancelled.':err instanceof Error?err.message:'WalletConnect could not connect.');return false}
  },[connectProvider])
  const recover = useCallback(async (key:string) => {
    setError(null)
    try {
      const wallet=saveGeneratedAccount(key),account=loadStoredAccount()!
      selectWalletProvider(null);setProvider(null)
      setAddress(wallet.address);setKind('generated');setToken(null)
      return await signInWith(msg=>account.signMessage({message:msg}),wallet.address,'generated')
    }catch(err){setError(err instanceof Error?err.message:'Could not recover this wallet.');return false}
  },[signInWith])
  useEffect(()=>{
    if(!provider)return
    const invalidate=()=>{
      ++authAttempt.current;setSigningIn(false)
      localStorage.removeItem(TOKEN_STORAGE);setToken(null);setAddress(null)
      selectWalletProvider(null);setProvider(null)
      setError('Your wallet account changed or disconnected. Connect again to sign in.')
    }
    provider.on?.('accountsChanged',invalidate);provider.on?.('disconnect',invalidate)
    return ()=>{provider.removeListener?.('accountsChanged',invalidate);provider.removeListener?.('disconnect',invalidate)}
  },[provider])

  const generate = useCallback((): GeneratedWallet | null => {
    setError(null)
    try {
      selectWalletProvider(null);setProvider(null);setToken(null)
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
      return await signInWith((msg) => acct.signMessage({ message: msg }), acct.address, 'generated')
    }
    if (activeWalletProvider()) return connectProvider(activeWalletProvider()!,kind === 'walletconnect'?'walletconnect':'injected')
    if (walletKind() === 'walletconnect') {setError('Open Connect wallet and choose WalletConnect QR to reconnect.');return false}
    if (hasInjected()) {
      return await connectInjected()
    }
    setError('Generate a wallet first — it takes one tap and you get a recovery key.')
    return false
  }, [signInWith, connectInjected, connectProvider, connectWalletConnect, kind])

  // AUTO SIGN-IN: a generated wallet keeps its private key in localStorage, so we
  // can silently re-establish the session on every visit — no popup, no button.
  // This fixes the "wallet is back but it says sign in first" case: the stored
  // token may be stale, and the key is still here to sign a fresh one.
  const [autoSigningIn, setAutoSigningIn] = useState(false)
  useEffect(() => {
    const acct = loadStoredAccount()
    if (!acct) return
    setAddress(acct.address)
    setKind('generated')
    const existing = localStorage.getItem(TOKEN_STORAGE)
    if (!existing) {
      // No token at all: sign in silently.
      setAutoSigningIn(true)
      signInWith((msg) => acct.signMessage({ message: msg }), acct.address, 'generated')
        .catch(() => { /* offline: stay signed out, retry on next action */ })
        .finally(() => setAutoSigningIn(false))
      return
    }
    // A token exists — PROBE it. If the server rejects it (expired / rotated),
    // sign a fresh one silently. This is what keeps a returning user signed in.
    let alive = true
    ;(async () => {
      try {
        await center.vault(existing)  // any cheap authenticated call works
      } catch {
        if (!alive || loadStoredAccount()?.address !== acct.address) return
        localStorage.removeItem(TOKEN_STORAGE)
        setAutoSigningIn(true)
        try {
          await signInWith((msg) => acct.signMessage({ message: msg }), acct.address, 'generated')
        } catch { /* offline */ }
        finally { setAutoSigningIn(false) }
      }
    })()
    return () => { alive = false }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signOut = useCallback(() => {
    ++authAttempt.current;setSigningIn(false)
    localStorage.removeItem(TOKEN_STORAGE)
    setToken(null)
    const current=activeWalletProvider()
    selectWalletProvider(null);setProvider(null)
    if(current?.disconnect)void current.disconnect().catch(()=>{})
  }, [])

  const forget = useCallback(() => {
    ++authAttempt.current;setSigningIn(false)
    selectWalletProvider(null);setProvider(null)
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
    autoSigningIn,
    connected: Boolean(address && token),
    token,
    signingIn,
    error,
    connectInjected,
    connectWalletConnect,
    recover,
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
