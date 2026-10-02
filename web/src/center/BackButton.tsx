// Persistent back control: a small round button pinned to the left edge on every
// page. Runs history.back() when there is history, otherwise navigates to the
// Center catalog so it is never a dead control.

import { useEffect, useState } from 'react'

export function BackButton({ onFallback }: { onFallback: () => void }) {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    // A brand-new tab has no history to go back to.
    setEnabled(window.history.length > 1)
  }, [])

  const goBack = () => {
    if (window.history.length > 1) {
      window.history.back()
      // If the popstate handler didn't move us, fall back after a beat.
      setTimeout(() => { onFallback() }, 120)
    } else {
      onFallback()
    }
  }

  return (
    <button
      className="back-fab"
      onClick={goBack}
      aria-label="Go back"
      title={enabled ? 'Go back' : 'Back to catalog'}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
