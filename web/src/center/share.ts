// Clipboard + room-sharing helpers.
//
// The browser Clipboard API needs a secure context and can reject. Always fall
// back to a hidden textarea + execCommand so copy works everywhere, and report
// the result so the UI can show "Copied" only when it really copied.

export { copyText } from '../../public/orbix-clipboard.js'

/** Short, human-quotable form of a room id (the full id still works). */
export function shortRoomId(roomId: string, head = 8): string {
  return roomId.length <= head ? roomId : roomId.slice(0, head)
}

export function roomShareUrl(roomId: string): string {
  return `${window.location.origin}/center/rooms/${roomId}`
}

export function inviteShareUrl(roomId: string, code: string): string {
  return `${window.location.origin}/center/rooms/${roomId}?invite=${code}`
}

/** Parses a pasted room id OR a full share/invite URL into its parts. */
export function parseRoomInput(text: string): { roomId: string; invite?: string } | null {
  const raw = text.trim()
  if (!raw) return null
  // A full URL: pull the id from the path and the invite from the query
  if (raw.includes('/')) {
    try {
      const url = new URL(raw.startsWith('http') ? raw : `https://x${raw}`)
      const parts = url.pathname.split('/').filter(Boolean)
      const idx = parts.lastIndexOf('rooms')
      const id = idx >= 0 ? parts[idx + 1] : parts[parts.length - 1]
      if (!id) return null
      const invite = url.searchParams.get('invite') ?? undefined
      return { roomId: id, invite }
    } catch {
      return null
    }
  }
  // A bare id: hex-ish token, 6..64 chars
  if (/^[A-Za-z0-9_-]{6,64}$/.test(raw)) return { roomId: raw }
  return null
}
