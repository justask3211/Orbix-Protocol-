/** Keep field-v1 mathematically identical to center/games/terrain.py. */
export type TerrainTheme = 'island' | 'guardian' | 'courtyard'
const smooth = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
export function terrainHeight(x: number, z: number, theme: TerrainTheme = 'island'): number {
  const radius = Math.hypot(x, z), fade = smooth(5, 11, radius)
  if (theme === 'courtyard') return fade * (.16 + .12 * Math.sin(x * .18) * Math.sin(z * .16))
  const ripple = .16 * (1 + Math.sin(x * .23 + .4) * Math.sin(z * .19))
  if (theme === 'guardian') return fade * (ripple + 1.05 * Math.exp(-(((radius - 16) / 5) ** 2)))
  const hill = 1.45 * Math.exp(-((x + 12) ** 2 + (z - 10) ** 2) / 42)
    + 1.1 * Math.exp(-((x - 13) ** 2 + (z + 11) ** 2) / 36)
  return fade * (ripple + hill + .38 * smooth(16, 25, radius))
}
export const stateGround = (state: Record<string, any>, x: number, z: number) =>
  state.terrain?.kind === 'field-v1' ? terrainHeight(x, z, state.terrain.theme) : 0
