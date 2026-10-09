import HavokPhysics from '@babylonjs/havok'
import wasmUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url'
import {HavokPlugin, PhysicsAggregate, PhysicsCharacterController, PhysicsShapeType, CharacterSupportedState, Vector3, type Mesh, type Scene} from './api'
import type {MotionPose} from './motion'

// One compiled WASM module; each mounted world owns its plugin/world/bodies.
let modulePromise: ReturnType<typeof HavokPhysics> | undefined
export async function enableCapsulePhysics(scene: Scene) {
  modulePromise ??= HavokPhysics({locateFile:() => wasmUrl}).catch(error => {modulePromise = undefined; throw error})
  const module = await modulePromise
  if (scene.isDisposed) return null
  const plugin = new HavokPlugin(true, module)
  if (!scene.enablePhysics(new Vector3(0, -18, 0), plugin)) {plugin.dispose(); throw new Error('Havok could not initialize')}
  scene.getPhysicsEngine()!.setTimeStep(1 / 60)
  return plugin
}
export function staticCollider(mesh: Mesh, scene: Scene, shape = PhysicsShapeType.BOX) {
  return new PhysicsAggregate(mesh, shape, {mass:0, friction:.7, restitution:0}, scene)
}

/** Reusable capsule motor. The live mode follows predicted server poses; the free
 * mode demonstrates physical acceleration, gravity, slopes and bounded step-up.
 * Neither mode emits positions, scores, contacts or rewards to the server. */
export class CapsuleMotor {
  readonly capsule: PhysicsCharacterController
  readonly velocity = Vector3.Zero()
  readonly center = Vector3.Zero()
  readonly gravity = new Vector3(0, -18, 0)
  readonly down = new Vector3(0, -1, 0)
  readonly height = 1.6
  readonly radius = .32
  private initialized = false
  constructor(scene: Scene, feet = Vector3.Zero()) {
    this.capsule = new PhysicsCharacterController(feet.add(new Vector3(0, this.height / 2, 0)), {capsuleHeight:this.height, capsuleRadius:this.radius}, scene)
    this.capsule.maxSlopeCosine = Math.cos(Math.PI * 50 / 180)
    this.capsule.maxStepHeight = .28
    this.capsule.acceleration = 1
    this.capsule.keepDistance = .005
    this.capsule.keepContactTolerance = .03
  }
  /** Authority position is the constraint. Capsule sweeps detect presentation
   * contacts but cannot add a climb/dodge displacement rejected by the server. */
  follow(pose: MotionPose, dt: number) {
    this.center.set(pose.x, pose.y + this.height / 2, pose.z)
    const previous = this.capsule.getPosition()
    const displacement = this.center.subtract(previous)
    if (this.initialized && displacement.lengthSquared() < 2.5 * 2.5) this.capsule.moveWithCollisions(displacement)
    // Replay already mirrors the authoritative rectangular margins and terrain.
    // Projection prevents the local solver's rounded geometry drifting the game.
    this.capsule.setPosition(this.center)
    const speed = dt > 0 ? displacement.scale(1 / dt) : Vector3.Zero()
    Vector3.LerpToRef(this.velocity, speed, 1 - Math.exp(-dt * 18), this.velocity)
    this.initialized = true
  }
  freeMove(dx: number, dz: number, sprint: boolean, jump: boolean, dt: number) {
    dt = Math.min(dt, 1 / 30)
    const surface = this.capsule.checkSupport(dt, this.down)
    const grounded = surface.supportedState === CharacterSupportedState.SUPPORTED
    const length = Math.max(1, Math.hypot(dx, dz)), speed = sprint ? 8 : 5
    const response = 1 - Math.exp(-dt * (dx || dz ? 16 : 22))
    this.velocity.x += (dx / length * speed - this.velocity.x) * response
    this.velocity.z += (dz / length * speed - this.velocity.z) * response
    if (grounded) this.velocity.y = jump ? 7.5 : 0
    else this.velocity.y -= 18 * dt
    this.capsule.setVelocity(this.velocity)
    this.capsule.integrate(dt, surface, this.gravity)
    return this.capsule.getPosition().subtract(new Vector3(0, this.height / 2, 0))
  }
  dispose() { this.capsule.dispose() }
}
