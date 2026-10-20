import type { SessionState } from './session'
import { center } from './api'
import { activeWalletProvider } from './walletConnectors'

/** Each destructive/control change obtains a distinct, single-use admin proof. */
export async function signedProof(session: SessionState): Promise<string> {
  if (!session.token || !session.address) throw new Error('Connect the administrator wallet first.')
  const { nonce, message } = await center.adminNonce(session.token, session.address)
  let signature: string
  if (session.kind === 'generated') {
    const { loadGeneratedAccount } = await import('./session')
    const account = loadGeneratedAccount()
    if (!account || account.address.toLowerCase() !== session.address.toLowerCase()) throw new Error('Saved wallet does not match the connected administrator.')
    signature = await account.signMessage({ message })
  } else {
    const eth = activeWalletProvider() ?? (window as any).ethereum
    if (!eth) throw new Error('Open your wallet to sign this change.')
    signature = await eth.request({ method: 'personal_sign', params: [message, session.address] })
  }
  return `${nonce}:${signature}`
}

