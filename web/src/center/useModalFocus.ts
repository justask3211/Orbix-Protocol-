import { lockBodyScroll } from './scrollLock'
import { useEffect, useRef } from 'react'

/** Keep keyboard focus in an open dialog and restore its trigger on close. */
export function useModalFocus(onClose: () => void, enabled = true) {
  const dialog = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!enabled) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const unlock = lockBodyScroll()
    const focusables = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []).filter(element => element.getClientRects().length > 0)
    const frame = requestAnimationFrame(() => focusables()[0]?.focus())
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); return }
      if (event.key !== 'Tab') return
      const elements = focusables()
      if (!elements.length) { event.preventDefault(); dialog.current?.focus(); return }
      const first = elements[0], last = elements[elements.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', onKey); unlock(); previous?.focus() }
  }, [enabled])
  return dialog
}
