import { stateGround } from './terrain'
import type { ArenaInput } from '../ArenaControls'
export type MotionPose = { x: number; y: number; z: number; yaw: number; moving: number; speed?: number }
type Body = Record<string, any>
type Sample = { body: Body; at: number; received: number }
const num = (v: unknown, fallback = 0) => typeof v === 'number' && Number.isFinite(v) ? v : fallback
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const angle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t

/** Mirrors the server's published collision margins, never decorative scenery. */
export function blocked(state: Body, x: number, z: number, y: number): boolean {
  if ((state.crates ?? []).some((c: Body) => c.hp > 0 && y < num(c.y) + 1.1 && Math.abs(x - num(c.x)) < .85 && Math.abs(z - num(c.z)) < .85)) return true
  if (state.boss?.hp > 0 && Math.hypot(x, z) < 1.8) return true
  return (state.obstacles ?? []).some((o: Body) => y < num(o.baseY) + num(o.height, 1.6) && Math.abs(x - num(o.x)) < num(o.width, 1) / 2 + .32 && Math.abs(z - num(o.z)) < num(o.depth, 1) / 2 + .32)
}
export function support(state: Body, x: number, z: number, y: number): number {
  let floor = stateGround(state, x, z)
  for (const o of state.obstacles ?? []) {
    const top = num(o.baseY) + num(o.height)
    if (y >= top - .001 && Math.abs(x - num(o.x)) < num(o.width) / 2 + .32 && Math.abs(z - num(o.z)) < num(o.depth) / 2 + .32) floor = Math.max(floor, top)
  }
  return floor
}

/** Continuous presentation prediction, acknowledged input replay and buffered opponents. */
export class MotionTrack {
  samples: Sample[] = []
  private offset = Infinity
  private latency = 0
  private ack = -1
  private predicted = { x: 0, y: 0, z: 0, vy: 0 }
  private correction = { x: 0, y: 0, z: 0 }
  private lastFrame = 0
  private lastRemoteTime = -Infinity
  private jump = 0
  private snap = false

  receive(body: Body, state: Body, now: number, input?: ArenaInput) {
    const at = num(state.serverTimeMs), latest = this.samples.at(-1)
    if (latest && (at < latest.at || at === latest.at && body.inputSeq === latest.body.inputSeq && body.hp === latest.body.hp && body.x === latest.body.x && body.y === latest.body.y && body.z === latest.body.z)) return
    this.samples.push({ body: { ...body }, at, received: now })
    if (this.samples.length > 20) this.samples.shift()
    this.offset = Math.min(this.offset, now - at)
    if (!input) return
    const sent = input.history?.find(item => item.seq === body.inputSeq)
    if (sent && this.ack !== body.inputSeq) {
      const rtt = clamp(now - sent.at - Math.max(0, at - num(body.inputAt, at)), 0, 300)
      this.latency += (rtt / 2 - this.latency) * .35
      this.ack = body.inputSeq
    }
    if (latest && now - latest.received < 250) this.integrate(state, latest.body, input, Math.max(0, Math.min(60, now - this.lastFrame)) / 1000, latest.at + now - latest.received)
    const old = { x: this.predicted.x + this.correction.x, y: this.predicted.y + this.correction.y, z: this.predicted.z + this.correction.z }
    this.predicted = { x: num(body.x), y: num(body.y), z: num(body.z), vy: num(body.vy) }
    const begin = now - this.latency, pending = (input.history ?? []).filter(item => item.seq > num(body.inputSeq) && item.at <= now)
    for (let time = begin; time < now; time += 1000 / 120) {
      const end = Math.min(now, time + 1000 / 120), command = pending.filter(item => item.at <= time).at(-1)
      const direction = num(input.changedAt, now) <= time ? input : command ?? { dx: num(body.inputDx), dz: num(body.inputDz), sprint: body.sprinting, active: num(body.inputUntil) > at + time - begin }
      this.integrate(state, body, direction, (end - time) / 1000, at + time - begin)
    }
    const gap = Math.hypot(old.x - this.predicted.x, old.y - this.predicted.y, old.z - this.predicted.z)
    this.snap = !latest || gap > 2.5 || num(body.respawnAt) !== num(latest.body.respawnAt) || num(body.hp, 100) <= 0
    this.correction = this.snap ? { x: 0, y: 0, z: 0 } : { x: old.x - this.predicted.x, y: old.y - this.predicted.y, z: old.z - this.predicted.z }
    this.lastFrame = now
  }
  private integrate(state: Body, body: Body, input: ArenaInput, dt: number, serverNow: number) {
    if (!input.active || state.finished || state._canAct === false || num(body.hp, 100) <= 0 || num(body.respawnAt) > serverNow || num(body.stunnedUntil) > serverNow) return
    const length = Math.max(1, Math.hypot(input.dx, input.dz)), speed = (input.sprint && !body.blocking ? 8 : num(body.speed, 5)) * (body.blocking ? .5 : 1)
    const p = this.predicted, previousFloor = support(state, p.x, p.z, p.y), grounded = p.y <= previousFloor + .001 && p.vy <= 0
    if (!grounded) { p.vy -= 18 * dt; p.y += p.vy * dt }
    const x = clamp(p.x + input.dx / length * speed * dt, -num(state.bounds?.width, 40) / 2 + .4, num(state.bounds?.width, 40) / 2 - .4)
    const z = clamp(p.z + input.dz / length * speed * dt, -num(state.bounds?.depth, 40) / 2 + .4, num(state.bounds?.depth, 40) / 2 - .4)
    if (!blocked(state, x, p.z, p.y)) p.x = x
    if (!blocked(state, p.x, z, p.y)) p.z = z
    const floor = support(state, p.x, p.z, p.y)
    if (grounded || p.y < floor) { p.y = floor; p.vy = 0 }
  }
  update(pose: MotionPose, state: Body, now: number, dt: number, input?: ArenaInput) {
    const latest = this.samples.at(-1)
    if (!latest) return
    const body = latest.body, age = now - latest.received
    let x: number, y: number, z: number, yaw: number, speed = 0
    if (input) {
      const elapsed = Math.max(0, Math.min(now - this.lastFrame, 60)) / 1000, before = { ...this.predicted }
      if (input.jumpAt && input.jumpAt > this.jump) {
        this.jump = input.jumpAt
        if (body.onGround && num(body.jumpReadyAt) <= latest.at && num(body.hp, 100) > 0 && num(body.stunnedUntil) <= latest.at && !state.finished && state._canAct !== false) this.predicted.vy = 7.5
      }
      if (age < 250) this.integrate(state, body, input, elapsed, latest.at + this.latency + age)
      this.lastFrame = now
      speed = elapsed > 0 ? Math.hypot(this.predicted.x - before.x, this.predicted.z - before.z) / elapsed : num(pose.speed)
      const fade = Math.exp(-dt * 22)
      const distance = Math.hypot(this.correction.x, this.correction.z)
      const horizontalFade = distance > 0 ? 1 - Math.min(1 - fade, 1.5 * dt / distance) : fade
      this.correction.x *= horizontalFade; this.correction.y *= fade; this.correction.z *= horizontalFade
      x = this.predicted.x + this.correction.x; y = this.predicted.y + this.correction.y; z = this.predicted.z + this.correction.z
      if (blocked(state, x, z, y)) { x = this.predicted.x; z = this.predicted.z; this.correction.x = this.correction.z = 0 }
      y = Math.max(support(state, x, z, y), y)
      yaw = input.yaw ?? num(body.yaw)
    } else {
      const time = Math.max(this.lastRemoteTime, now - this.offset - 100)
      this.lastRemoteTime = time
      const right = this.samples.find(s => s.at >= time) ?? latest, index = this.samples.indexOf(right), left = this.samples[Math.max(0, index - 1)]
      const gap = Math.hypot(num(right.body.x) - num(left.body.x), num(right.body.z) - num(left.body.z)), duration = right.at - left.at
      const discontinuity = gap > 2.5 || right.body.respawnAt !== left.body.respawnAt
      const t = duration > 0 && !discontinuity ? clamp((time - left.at) / duration, 0, 1) : 1
      x = num(left.body.x) + (num(right.body.x) - num(left.body.x)) * t
      y = num(left.body.y) + (num(right.body.y) - num(left.body.y)) * t
      z = num(left.body.z) + (num(right.body.z) - num(left.body.z)) * t
      yaw = angle(num(left.body.yaw), num(right.body.yaw), t)
      speed = duration > 0 && !discontinuity && time <= latest.at + 150 ? gap * 1000 / duration : 0
      if (time > latest.at && !discontinuity && speed <= 8.5 && duration > 0) {
        const extra = Math.min(150, time - latest.at) / duration, px = x + (num(right.body.x) - num(left.body.x)) * extra, pz = z + (num(right.body.z) - num(left.body.z)) * extra
        if (!blocked(state, px, pz, y)) { x = px; z = pz }
      }
      y = Math.max(stateGround(state, x, z), y)
    }
    const down = num(body.hp, 100) <= 0 || num(body.respawnAt) > latest.at + Math.min(250, age)
    pose.x = x; pose.y = y; pose.z = z; pose.yaw = angle(pose.yaw, yaw, 1 - Math.exp(-dt * 28)); pose.speed = down ? 0 : speed
    pose.moving += ((pose.speed > .08 ? 1 : 0) - pose.moving) * (1 - Math.exp(-dt * 30))
    if (this.snap) { pose.yaw = yaw; pose.moving = 0; this.snap = false }
  }
}
