import { useEffect, useState } from 'react'
import { center, explainError, type RoomSummary } from './api'

/** A bare room ID or a complete Orbix invite; never navigate to an external site. */
export function roomPathFromInput(input: string): string | null {
  const value = input.trim()
  if (/^[1-9]\d{2,9}$/.test(value)) return `/center/rooms/${value}`
  if (/^[a-f\d]{16}$/i.test(value)) return `/center/rooms/${value.toLowerCase()}`
  try {
    const url = new URL(value, window.location.origin)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (url.origin !== window.location.origin && !['orbixcore.fun', 'www.orbixcore.fun'].includes(url.hostname)) return null
    if (url.username || url.password) return null
    const match = url.pathname.match(/^\/center\/rooms\/([a-f\d]{16}|[1-9]\d{2,9})\/?$/i)
    if (!match) return null
    const invite = url.searchParams.get('invite')
    if (invite && !/^[a-z\d_-]{1,128}$/i.test(invite)) return null
    return `/center/rooms/${match[1].toLowerCase()}${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`
  } catch { return null }
}

export const OPEN_ROOM_STATES = new Set(['registration', 'ready'])
export const ACTIVE_ROOM_STATES = new Set([...OPEN_ROOM_STATES, 'running'])

export function isDiscoverableRoom(room: RoomSummary) {
  return room.visibility === 'public' && room.gameConfig?.available_modes.join !== false && room.gameConfig?.placement !== 'hidden' && room.gameConfig?.placement !== 'upcoming' && ACTIVE_ROOM_STATES.has(room.status)
}

/** Poll only a visible page, preserving a successful list on a transient failure. */
export function usePublicRooms() {
  const [rooms, setRooms] = useState<RoomSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    let pulling = false
    async function pull() {
      if (pulling || document.hidden) return
      pulling = true
      setRefreshing(true)
      try {
        const result = await center.rooms()
        if (active) { setRooms(result.rooms); setError(null); setUpdatedAt(new Date()) }
      } catch (failure) { if (active) setError(explainError(failure)) }
      finally { pulling = false; if (active) { setLoading(false); setRefreshing(false) } }
    }
    void pull()
    const timer = window.setInterval(() => { void pull() }, 20_000)
    const onVisible = () => { if (!document.hidden) void pull() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [retry])
  return { rooms, loading, refreshing, error, updatedAt, refresh: () => setRetry((value) => value + 1) }
}
