export const OVERLAY_COLORS: Record<string, string> = { blue: '#2563eb', purple: '#7c3aed', green: '#15803d', amber: '#b45309', red: '#b91c1c', slate: '#475569' }
export type GameModes = { practice: boolean; preview: boolean; create: boolean; join: boolean }
export type GameConfig = {
  placement: 'catalog' | 'more' | 'upcoming' | 'hidden'
  overlay: { enabled: boolean; text: string; color: string; position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' }
  tag: { enabled: boolean; text: string; style: 'subtle' | 'solid' | 'outline' }
  modes: GameModes
  sort_order: number
}
export type SavedGameConfig = GameConfig & { updated_at?: number | null }
export function defaultGameConfig(): GameConfig {
  return { placement: 'catalog', overlay: { enabled: true, text: 'Coming soon', color: 'blue', position: 'top-right' }, tag: { enabled: false, text: 'Still in development', style: 'subtle' }, modes: { practice: true, preview: true, create: true, join: true }, sort_order: 0 }
}
