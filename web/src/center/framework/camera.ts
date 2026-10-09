import { Vector3 } from 'three'
import { SurfaceQueries } from './surface'

const CLEARANCE = [[0, 0, 0], [.22, 0, 0], [-.22, 0, 0], [0, .18, 0], [0, -.18, 0]]

/** Five parallel rays approximate the camera near plane. Always apply after easing. */
export function clipBoom(surface: SurfaceQueries, target: Vector3, desired: Vector3) {
  const started = performance.now()
  let fraction = 1
  for (const [x, y, z] of CLEARANCE) {
    fraction = Math.min(fraction, surface.fraction(target.x + x, target.y + y, target.z + z, desired.x + x, desired.y + y, desired.z + z))
  }
  desired.lerpVectors(target, desired, fraction)
  surface.queryMs = performance.now() - started
  return fraction
}

/** Bounded position response for visual lean/look-ahead; never a movement solver. */
export class MovementResponse {
  velocity = new Vector3()
  private previous = new Vector3()
  private ready = false
  update(x: number, y: number, z: number, dt: number, active = true) {
    if (!this.ready || !active || (this.previous.x - x) ** 2 + (this.previous.y - y) ** 2 + (this.previous.z - z) ** 2 > 6.25) { this.velocity.set(0, 0, 0); this.ready = true }
    else if (dt > 0) {
      const rate = this.velocity.lengthSq() > .01 ? 18 : 12
      const a = 1 - Math.exp(-Math.min(dt, .1) * rate)
      this.velocity.x += (Math.max(-10, Math.min(10, (x - this.previous.x) / dt)) - this.velocity.x) * a
      this.velocity.z += (Math.max(-10, Math.min(10, (z - this.previous.z) / dt)) - this.velocity.z) * a
    }
    this.previous.set(x, y, z)
    return this.velocity
  }
}
