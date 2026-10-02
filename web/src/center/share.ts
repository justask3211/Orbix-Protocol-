// Clipboard + room-sharing helpers.
//
// The browser Clipboard API needs a secure context and can reject. Always fall
// back to a hidden textarea + execCommand so copy works everywhere, and report
// the result so the UI can show "Copied" only when it really copied.

export async function copyText(text: string): Promise<boolean> {
  // Preferred path
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to the legacy path
    }
  }
  // Legacy fallback: works on http, older browsers, and when the API is blocked
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

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
