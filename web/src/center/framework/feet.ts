import { Object3D, Quaternion, Vector3 } from 'three'
type Leg = { upper: Object3D; knee: Object3D; foot: Object3D; anchor: Vector3; locked: boolean }
const UP = new Vector3(0, 1, 0)

/** Independent two-bone stance correction, evaluated after animation. No root motion. */
export class FootPlant {
  private legs: Leg[] = []
  private a = new Vector3(); private b = new Vector3(); private c = new Vector3()
  private dir = new Vector3(); private bend = new Vector3(); private target = new Vector3(); private joint = new Vector3()
  private from = new Vector3(); private to = new Vector3()
  private q = new Quaternion(); private world = new Quaternion(); private parent = new Quaternion()
  private last = new Vector3(Infinity, 0, 0)
  constructor(scene: Object3D) {
    for (const side of ['l', 'r']) {
      const upper = scene.getObjectByName(`thigh_${side}`), knee = scene.getObjectByName(`calf_${side}`), foot = scene.getObjectByName(`foot_${side}`)
      if (upper && knee && foot) this.legs.push({ upper, knee, foot, anchor: new Vector3(), locked: false })
    }
  }
  reset() { for (const leg of this.legs) leg.locked = false }
  private rotate(bone: Object3D, oldDirection: Vector3, newDirection: Vector3) {
    this.q.setFromUnitVectors(oldDirection.normalize(), newDirection.normalize())
    bone.getWorldQuaternion(this.world); this.q.multiply(this.world)
    bone.parent!.getWorldQuaternion(this.parent).invert()
    bone.quaternion.copy(this.parent.multiply(this.q)); bone.updateWorldMatrix(false, true)
  }
  update(root: Object3D, phase: number, moving: boolean, enabled: boolean, ground: (x: number, z: number) => number) {
    root.getWorldPosition(this.target)
    if (!enabled || this.last.distanceToSquared(this.target) > 1) this.reset()
    this.last.copy(this.target)
    if (!enabled) return
    for (const [index, leg] of this.legs.entries()) {
      const stance = !moving || (phase + index * .5) % 1 < .5
      leg.upper.getWorldPosition(this.a); leg.knee.getWorldPosition(this.b); leg.foot.getWorldPosition(this.c)
      if (!stance) { leg.locked = false; continue }
      if (!leg.locked || leg.anchor.distanceToSquared(this.c) > .22 * .22) { leg.anchor.copy(this.c); leg.locked = true }
      this.target.copy(this.c)
      // A horizontal stance anchor reduces sliding without pulling the leg across a step.
      this.target.x = leg.anchor.x; this.target.z = leg.anchor.z
      const surface = ground(this.target.x, this.target.z)
      this.target.y += Math.max(-.18, Math.min(.18, surface + .065 - this.c.y))
      const l1 = this.a.distanceTo(this.b), l2 = this.b.distanceTo(this.c)
      this.dir.subVectors(this.target, this.a)
      const d = Math.max(.001, Math.min(l1 + l2 - .001, this.dir.length()))
      this.dir.normalize()
      const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d), height = Math.sqrt(Math.max(0, l1 * l1 - along * along))
      this.bend.subVectors(this.b, this.a).addScaledVector(this.dir, -this.bend.dot(this.dir))
      if (this.bend.lengthSq() < 1e-6) this.bend.set(0, 0, 1).addScaledVector(this.dir, -this.dir.z)
      this.bend.normalize(); this.joint.copy(this.a).addScaledVector(this.dir, along).addScaledVector(this.bend, height)
      this.from.subVectors(this.b, this.a); this.to.subVectors(this.joint, this.a)
      this.rotate(leg.upper, this.from, this.to)
      leg.knee.getWorldPosition(this.b); leg.foot.getWorldPosition(this.c)
      this.from.subVectors(this.c, this.b); this.to.subVectors(this.target, this.b)
      this.rotate(leg.knee, this.from, this.to)
      // Mild slope alignment; lift/contact remains bounded and no ray onto decorative props.
      const dx = ground(this.target.x + .04, this.target.z) - ground(this.target.x - .04, this.target.z)
      const dz = ground(this.target.x, this.target.z + .04) - ground(this.target.x, this.target.z - .04)
      this.dir.set(-Math.max(-.045, Math.min(.045, dx)) / .08, 1, -Math.max(-.045, Math.min(.045, dz)) / .08).normalize()
      this.q.setFromUnitVectors(UP, this.dir)
      leg.foot.getWorldQuaternion(this.world); this.q.multiply(this.world)
      leg.foot.parent!.getWorldQuaternion(this.parent).invert(); leg.foot.quaternion.copy(this.parent.multiply(this.q))
    }
  }
}
