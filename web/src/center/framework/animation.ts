/** Cosmetic animation policy. Contact windows never submit damage or actions. */
type Body = Record<string, any>
export type ClipIntent = { name: string; once: boolean; key: string; rate: number; blend: number }
type Cue = { name: string; start: number; end: number; key: string; whole: boolean; priority: number }
export const BLEND_SECONDS: Record<string, number> = { Hit: .055, Death: .08, Dodge: .07, JumpStart: .07, JumpLand: .08, Guard: .09, Idle: .12, Walk: .12, Run: .10, Sprint: .10 }
export const CONTACT_WINDOWS: Record<string, [number, number]> = { PunchJab: [.22, .48], PunchCross: [.3, .58], Kick: [.35, .65], SwordAttack: [.25, .62], PistolShoot: [.05, .2], Interact: [.35, .7] }
const finite = (v: unknown, fallback = 0) => typeof v === 'number' && Number.isFinite(v) ? v : fallback
const locomotion = (name: string) => ['Idle', 'Walk', 'Run', 'Sprint'].includes(name)

export class AnimationFSM {
  private previous: Body | null = null
  private round: unknown
  private cue: Cue | null = null
  private windowKey = ''
  update(body: Body, state: Body, now: number, speed: number, sprint: boolean) {
    if (this.round !== state.roundId) { this.previous = null; this.cue = null; this.windowKey = ''; this.round = state.roundId }
    const p = this.previous ?? body
    const down = finite(body.hp, 100) <= 0 || finite(body.respawnAt) > now
    const grounded = body.onGround !== undefined ? Boolean(body.onGround) : finite(body.y) <= finite(body.groundHeight) + .08
    const wasGrounded = p.onGround !== undefined ? Boolean(p.onGround) : finite(p.y) <= finite(p.groundHeight) + .08
    const landed = grounded && !wasGrounded && !down
    const hit = finite(body.hp, 100) < finite(p.hp, 100) && !down
    const offer = (name: string, duration: number, key: string, whole: boolean, priority: number, start = now) => {
      // New cues replace equal/lower priority, but cannot cancel a hit or dodge.
      if (this.cue && now < this.cue.end && this.cue.priority > priority) return
      this.cue = { name, start, end: start + duration, key, whole, priority }
    }
    if (this.cue && now >= this.cue.end) this.cue = null
    if (finite(body.respawnAt) !== finite(p.respawnAt) || finite(body.hp, 100) > finite(p.hp, 100) && finite(p.hp, 100) <= 0) this.cue = null
    if (finite(body.lastAttackAt) > finite(p.lastAttackAt) && now - finite(body.lastAttackAt) < 1000) {
      const weapon = body.lastAttackWeapon || body.weapon
      const name = body.lastAttackKind === 'interact' ? 'Interact' : body.lastAttackStyle === 'kick' ? 'Kick' : body.lastAttackStyle === 'punch' ? finite(body.combo) % 2 ? 'PunchJab' : 'PunchCross' : weapon === 'gun' ? 'PistolShoot' : ['sword', 'spear'].includes(weapon) ? 'SwordAttack' : body.lastAttackStyle === 'heavy' ? 'PunchCross' : finite(body.combo) % 2 ? 'PunchJab' : 'PunchCross'
      offer(name, name === 'PistolShoot' ? 350 : name === 'Kick' ? 550 : 500, `attack-${body.lastAttackAt}`, name === 'Kick', 1, finite(body.lastAttackAt))
    }
    if (finite(body.lootReadyAt) > finite(p.lootReadyAt) && speed < 1.25) offer('Interact', 350, `loot-${body.lootReadyAt}`, false, 1)
    if (!grounded && wasGrounded && !down) offer('JumpStart', 280, `jump-${state.tick}`, true, 2)
    if (landed) offer('JumpLand', 160, `land-${state.tick}`, true, 2)
    if (finite(body.dodgeUntil) > finite(p.dodgeUntil) && finite(body.dodgeUntil) > now) offer('Dodge', 430, `dodge-${body.dodgeUntil}`, true, 3)
    if (hit) offer('Hit', 250, `hit-${state.tick}-${body.hp}`, false, 4)
    let lower = speed > .08 ? sprint ? 'Sprint' : speed < 2 ? 'Walk' : 'Run' : 'Idle', upper = lower
    if (body.weapon === 'gun' && speed < 1) upper = 'PistolAim'
    else if (['sword', 'spear'].includes(body.weapon) && speed < 1) upper = 'SwordIdle'
    if (body.blocking) upper = 'Guard'
    if (!grounded) lower = upper = 'JumpLoop'
    if (this.cue) { upper = this.cue.name; if (this.cue.whole) lower = upper }
    if (state.finished && !down) { lower = upper = 'Idle'; this.cue = null }
    if (down) { lower = upper = 'Death'; this.cue = null }
    const intent = (name: string, whole: boolean): ClipIntent => {
      const cue = this.cue && (whole ? this.cue.whole : true) ? this.cue : null
      return { name, once: down || !!cue || name === 'Guard' || name === 'PistolAim', key: down ? `down-${finite(body.respawnAt)}` : cue?.key ?? '', rate: name === 'Death' ? 1.5 : name === 'Dodge' ? 3 : name === 'JumpStart' || name === 'Interact' ? 4 : name === 'JumpLand' ? 5 : name === 'SwordAttack' ? 2.5 : cue ? 1.5 : 1, blend: BLEND_SECONDS[name] ?? .08 }
    }
    const progress = this.cue ? Math.max(0, Math.min(1, (now - this.cue.start) / (this.cue.end - this.cue.start))) : 0
    const window = this.cue && CONTACT_WINDOWS[this.cue.name]
    const contact = !!window && progress >= window[0] && progress <= window[1]
    const contactKey = contact ? this.cue!.key : ''
    const contactEntered = !!contactKey && contactKey !== this.windowKey
    if (contactEntered) this.windowKey = contactKey
    this.previous = { ...body }
    return { lower: intent(lower, true), upper: intent(upper, false), grounded, landed, hit, down, progress, contact, contactEntered, locomotion }
  }
}
