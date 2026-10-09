import { Body, Box, Cylinder, RaycastResult, Vec3, World } from 'cannon-es'
import { stateGround } from '../worlds/terrain'
type State = Record<string, any>
const n = (v: unknown, fallback = 0) => typeof v === 'number' && Number.isFinite(v) ? v : fallback

/** Static presentation queries only. No World.step, actor simulation or gameplay outcomes. */
export class SurfaceQueries {
  readonly world = new World()
  private signature = ''
  private from = new Vec3()
  private to = new Vec3()
  private hit = new RaycastResult()
  queryMs = 0
  update(state: State) {
    const obstacles = [...(state.obstacles ?? []), ...(state.crates ?? []).filter((c: State) => c.hp > 0).map((c: State) => ({ ...c, width: .8, depth: .8, height: .8, baseY: c.y }))]
    if (state.boss?.hp > 0) obstacles.push({ ...state.boss, radius: 1.3, height: 3.8, baseY: state.boss.y })
    const signature = JSON.stringify(obstacles.map(o => [o.x, o.z, o.baseY, o.width, o.depth, o.height, o.radius]))
    if (signature === this.signature) return
    this.signature = signature
    for (const body of this.world.bodies.slice()) this.world.removeBody(body)
    for (const o of obstacles.slice(0, 90)) {
      const h = n(o.height, 1.6), body = new Body({ mass: 0, position: new Vec3(n(o.x), n(o.baseY) + h / 2, n(o.z)) })
      if (o.radius) body.addShape(new Cylinder(n(o.radius), n(o.radius), h, 12))
      else body.addShape(new Box(new Vec3(n(o.width, 1) / 2, h / 2, n(o.depth, 1) / 2)))
      this.world.addBody(body)
    }
  }
  /** Ray segment from target to boom endpoint; caller samples near-plane clearance. */
  fraction(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    this.from.set(ax, ay, az); this.to.set(bx, by, bz); this.hit.reset()
    const length = this.from.distanceTo(this.to)
    if (length < 1e-5) return 1
    this.world.raycastClosest(this.from, this.to, { skipBackfaces: false, checkCollisionResponse: false }, this.hit)
    return this.hit.hasHit ? Math.max(0, (this.hit.distance - .18) / length) : 1
  }
  ground(state: State, x: number, z: number, feetY: number) {
    let ground = stateGround(state, x, z)
    for (const o of state.obstacles ?? []) {
      const top = n(o.baseY) + n(o.height)
      if (feetY >= top - .08 && Math.abs(x - n(o.x)) < n(o.width) / 2 + .32 && Math.abs(z - n(o.z)) < n(o.depth) / 2 + .32) ground = Math.max(ground, top)
    }
    return ground
  }
  dispose() { for (const body of this.world.bodies.slice()) this.world.removeBody(body); this.signature = '' }
}
