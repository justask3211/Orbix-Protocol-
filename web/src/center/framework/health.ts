/** Only published health deltas produce feedback. No client health simulation. */
export class HealthTrack {
  private round: unknown
  private hp: number | null = null
  private respawn: unknown
  hitAt = -Infinity
  observe(hp: number, round: unknown, now: number, respawn?: unknown) {
    if (!Number.isFinite(hp)) return 0
    const damage = this.round === round && this.hp !== null ? Math.max(0, this.hp - hp) : 0
    if (this.round !== round || this.respawn !== respawn) this.hitAt = -Infinity
    this.hp = hp; this.round = round; this.respawn = respawn
    if (damage > 0) this.hitAt = now
    return damage
  }
  intensity(now: number) { return Math.max(0, 1 - (now - this.hitAt) / 260) }
}
export const healthRatio = (hp: number, max: number) => Number.isFinite(hp) ? Math.max(0, Math.min(1, hp / Math.max(1, max))) : 0
