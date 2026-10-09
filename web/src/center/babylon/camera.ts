import {ArcRotateCamera, UniversalCamera, Ray, Vector3, type Scene, type AbstractMesh} from './api'
import type {ArenaCamera} from '../ArenaControls'
import type {MotionPose} from './motion'

/** Two native Babylon cameras share the existing DOM look controls. Collision is
 * checked after easing, with immediate inward response and a damped return. */
export class FollowRig {
  readonly orbit: ArcRotateCamera
  readonly first: UniversalCamera
  private target = Vector3.Zero()
  private desired = Vector3.Zero()
  private initialized = false
  private distance = 6.4
  constructor(private scene: Scene, private collides: (mesh: AbstractMesh) => boolean) {
    this.orbit = new ArcRotateCamera('sunnydrop-follow', 0, 1.2, 6.4, Vector3.Zero(), scene)
    this.first = new UniversalCamera('sunnydrop-first', Vector3.Zero(), scene)
    for (const camera of [this.orbit, this.first]) {camera.minZ = .08; camera.maxZ = 160; camera.fov = 58 * Math.PI / 180}
    this.orbit.inputs.clear(); this.first.inputs.clear()
    scene.activeCamera = this.orbit
  }
  update(pose: MotionPose, controls: ArenaCamera | undefined, dt: number, reduced: boolean) {
    const yaw = controls?.yaw ?? pose.yaw, pitch = controls?.pitch ?? .12
    const desiredTarget = new Vector3(pose.x, pose.y + 1.05, pose.z)
    if (!reduced) desiredTarget.addInPlace(new Vector3(Math.sin(pose.yaw), 0, Math.cos(pose.yaw)).scale(Math.min(.35, (pose.speed ?? 0) * .04)))
    if (!this.initialized || Vector3.DistanceSquared(this.target, desiredTarget) > 16) this.target.copyFrom(desiredTarget)
    else Vector3.LerpToRef(this.target, desiredTarget, 1 - Math.exp(-dt * 14), this.target)
    this.initialized = true
    const first = controls?.mode === 'first'
    this.scene.activeCamera = first ? this.first : this.orbit
    if (first) {
      this.first.position.set(pose.x, pose.y + 1.45, pose.z)
      this.first.setTarget(this.first.position.add(new Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))))
      return
    }
    const radius = 6.4, elevation = .38 + pitch
    const direction = new Vector3(-Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), -Math.cos(yaw) * Math.cos(elevation))
    let clear = radius
    // Three boom rays give the camera a finite shoulder radius.
    for (const side of [-.18, 0, .18]) {
      const origin = this.target.add(new Vector3(Math.cos(yaw) * side, .08, -Math.sin(yaw) * side))
      const hit = this.scene.pickWithRay(new Ray(origin, direction, radius), this.collides)
      if (hit?.hit) clear = Math.min(clear, Math.max(.7, hit.distance - .25))
    }
    this.distance = clear < this.distance ? clear : this.distance + (clear - this.distance) * (1 - Math.exp(-dt * 5))
    this.desired.copyFrom(this.target).addInPlace(direction.scale(this.distance))
    const floor = this.scene.pickWithRay(new Ray(this.desired.add(new Vector3(0, 4, 0)), new Vector3(0, -1, 0), 8), this.collides)
    if (floor?.pickedPoint) this.desired.y = Math.max(this.desired.y, floor.pickedPoint.y + .22)
    this.orbit.setTarget(this.target)
    this.orbit.setPosition(this.desired)
  }
  dispose() {this.orbit.dispose(); this.first.dispose()}
}
