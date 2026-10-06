import { useMemo, useSyncExternalStore } from 'react'
import { center, explainError } from './api'
import type { OnchainBalance, VaultState } from './api'

type Balances = {
  vault: VaultState | null
  onchain: OnchainBalance | null
  loading: boolean
  error: string | null
  lastUpdated: number | null
}
const EMPTY: Balances = { vault: null, onchain: null, loading: false, error: null, lastUpdated: null }
type Resource = {
  getSnapshot: () => Balances
  subscribe: (listener: () => void) => () => void
  refresh: () => Promise<void>
}
const resources = new Map<string, Resource>()
const inactive: Resource = { getSnapshot: () => EMPTY, subscribe: () => () => undefined, refresh: async () => undefined }

function resourceFor(token: string, address: string): Resource {
  const key = `${address.toLowerCase()}:${token}`
  const cached = resources.get(key)
  if (cached) return cached
  let snapshot: Balances = { ...EMPTY, loading: true }
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setInterval> | undefined
  let pending: Promise<void> | null = null
  let generation = 0
  const update = (next: Balances) => { snapshot = next; listeners.forEach(listener => listener()) }
  const refresh = (): Promise<void> => {
    if (pending) return pending
    const currentGeneration = generation
    update({ ...snapshot, loading: true, error: null })
    pending = Promise.allSettled([center.vault(token), center.onchainBalance(token)]).then(([vault, onchain]) => {
      if (generation !== currentGeneration || listeners.size === 0) return
      const errors = [vault, onchain].filter(result => result.status === 'rejected')
        .map(result => explainError((result as PromiseRejectedResult).reason))
      update({
        vault: vault.status === 'fulfilled' ? vault.value : null,
        onchain: onchain.status === 'fulfilled' ? onchain.value : null,
        loading: false,
        error: errors.length ? Array.from(new Set(errors)).join(' ') : null,
        lastUpdated: errors.length ? null : Date.now(),
      })
    }).finally(() => { if (generation === currentGeneration) pending = null })
    return pending
  }
  const resource: Resource = {
    getSnapshot: () => snapshot,
    refresh,
    subscribe: listener => {
      listeners.add(listener)
      if (listeners.size === 1) {
        void refresh()
        timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 20_000)
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          clearInterval(timer)
          generation += 1
          pending = null
          snapshot = { ...EMPTY, loading: true }
        }
      }
    },
  }
  resources.set(key, resource)
  return resource
}

/** Shared read-only resource: header, home and vault subscribers share a single poll. */
export function useCenterBalances(token: string | null, address: string | null) {
  const resource = useMemo(() => token && address ? resourceFor(token, address) : inactive, [token, address])
  const snapshot = useSyncExternalStore(resource.subscribe, resource.getSnapshot, inactive.getSnapshot)
  return { ...snapshot, refresh: resource.refresh }
}

/** The current API returns raw 18-decimal units. Display only; never reuse for transactions. */
export function formatCenterToken(raw: number | string | null | undefined): string {
  if (raw == null || raw === '') return '—'
  const value = Number(raw)
  if (!Number.isFinite(value)) return '—'
  return (value / 1e18).toLocaleString('en-US', { maximumFractionDigits: 4 })
}
