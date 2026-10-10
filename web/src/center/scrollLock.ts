/** Shared ownership for game immersion and in-game modal scroll locks. */
let owners = 0
let previous = ''
export function lockBodyScroll() {
  if (owners++ === 0) { previous = document.body.style.overflow; document.body.style.overflow = 'hidden' }
  let released = false
  return () => { if (!released) { released = true; if (--owners === 0) document.body.style.overflow = previous } }
}
