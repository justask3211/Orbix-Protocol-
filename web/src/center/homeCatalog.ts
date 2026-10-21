import type { TemplateMeta } from './api'

/** Presentation only: room admission and available modes remain server-owned. */
export function isActiveCreatableGame(game: TemplateMeta): boolean {
  const upcomingTag = [game.tag, game.overlay].some(badge => badge?.enabled && /\b(upcoming|coming soon|in development|under development|still in development)\b/i.test(badge.text))
  return game.playStatus === 'live' && game.available_modes?.create === true
    && game.placement !== 'hidden' && game.placement !== 'upcoming' && !upcomingTag
}
