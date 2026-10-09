import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { PrivateKeyAccount } from 'viem/accounts'

export const KEY_STORAGE = 'orbix.wallet.key'
export const TOKEN_STORAGE = 'orbix.session.token'
export const WALLET_KIND = 'orbix.wallet.kind'
export type GeneratedWallet = {address:string; privateKey:string}

export function accountFromRecoveryKey(raw: string): PrivateKeyAccount {
  const key = raw.trim()
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Enter your saved private key: 0x followed by 64 hexadecimal characters.')
  try { return privateKeyToAccount(key as `0x${string}`) }
  catch { throw new Error('That private key is outside the valid EVM key range.') }
}
export function saveGeneratedAccount(raw: string): GeneratedWallet {
  const account = accountFromRecoveryKey(raw)
  // Validate before touching storage; a failed import cannot replace the saved account.
  const privateKey = raw.trim() as `0x${string}`
  localStorage.setItem(KEY_STORAGE,privateKey)
  localStorage.setItem(WALLET_KIND,'generated')
  localStorage.removeItem(TOKEN_STORAGE)
  return {address:account.address,privateKey}
}
export function createWallet(): GeneratedWallet {return saveGeneratedAccount(generatePrivateKey())}
export function loadGeneratedAccount(): PrivateKeyAccount | null {
  if(localStorage.getItem(WALLET_KIND)!=='generated')return null
  const key=localStorage.getItem(KEY_STORAGE)
  if(!key)return null
  try{return accountFromRecoveryKey(key)}catch{return null}
}
