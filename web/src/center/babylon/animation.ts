import {Animation, AnimationGroup, TransformNode, type InstantiatedEntries, type Scene} from './api'
import {AnimationFSM, type ClipIntent} from '../framework/animation'
import type {Body} from './types'

const lowerTarget = (name: string) => /^(root|pelvis|thigh_[lr]|calf_[lr]|foot_[lr]|ball(?:_leaf)?_[lr])$/.test(name)
type LayerClip = {group:AnimationGroup; weight:number; target:number; blend:number}
/** Actual AnimationGroups cloned from the existing 20-clip GLBs. Partitioning
 * tracks keeps locomotion and upper-body combat independent without root motion. */
export class ActorAnimation {
  readonly machine = new AnimationFSM()
  readonly layers = new Map<string, LayerClip>()
  readonly additive: AnimationGroup
  readonly additiveNode: TransformNode
  private identities = {lower:'',upper:''}
  constructor(entries: InstantiatedEntries, parent: TransformNode, scene: Scene) {
    for (const original of entries.animationGroups) {
      original.stop()
      const name = original.name.split('/').at(-1)!.replace(/^.*?:/, '')
      for (const layer of ['lower','upper'] as const) {
        const group = new AnimationGroup(`${name}:${layer}`, scene)
        for (const target of original.targetedAnimations) if (lowerTarget(target.target.name) === (layer === 'lower')) group.addTargetedAnimation(target.animation.clone(), target.target)
        if (!group.targetedAnimations.length) {group.dispose(); continue}
        group.enableBlending = true; group.blendingSpeed = .15
        this.layers.set(`${name}:${layer}`, {group,weight:0,target:0,blend:.1})
      }
    }
    // An original recoil layer targets an actor-owned node. Additive weights are
    // explicit and never displace the capsule or affect authoritative combat.
    this.additiveNode = new TransformNode('actor-additive-feedback', scene)
    this.additiveNode.parent = parent
    for (const root of entries.rootNodes) root.parent = this.additiveNode
    const recoil = new Animation('recoil', 'rotation.x', 60, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT)
    recoil.setKeys([{frame:0,value:0},{frame:4,value:-.13},{frame:12,value:0}])
    this.additive = new AnimationGroup('additive-hit', scene)
    this.additive.addTargetedAnimation(recoil, this.additiveNode)
    AnimationGroup.MakeAnimationAdditive(this.additive, 0)
    this.additive.start(false); this.additive.setWeightForAllAnimatables(0)
  }
  private select(layer: 'lower' | 'upper', intent: ClipIntent, speed: number) {
    const key = this.layers.has(`${intent.name}:${layer}`) ? `${intent.name}:${layer}` : `Idle:${layer}`
    const next = this.layers.get(key)
    if (!next) return
    const locomotion = ['Walk','Run','Sprint'].includes(intent.name)
    next.group.speedRatio = locomotion ? Math.max(.15, Math.min(2.5, speed / (intent.name === 'Walk' ? 1.6 : intent.name === 'Run' ? 5 : 8))) : intent.rate
    const identity = `${key}:${intent.key}`
    if (identity === this.identities[layer]) return
    this.identities[layer] = identity
    for (const [otherKey, clip] of this.layers) if (otherKey.endsWith(`:${layer}`)) {clip.target = otherKey === key ? 1 : 0; clip.blend = intent.blend}
    next.group.reset(); next.group.start(!intent.once, next.group.speedRatio, next.group.from, next.group.to)
    next.group.setWeightForAllAnimatables(next.weight)
  }
  update(body: Body, state: Body, now: number, speed: number, sprint: boolean, dt: number, reduced: boolean) {
    const result = this.machine.update(body,state,now,speed,sprint)
    this.select('lower',result.lower,speed); this.select('upper',result.upper,speed)
    for (const clip of this.layers.values()) {
      clip.weight += (clip.target - clip.weight) * (1 - Math.exp(-dt * 4 / clip.blend))
      clip.group.setWeightForAllAnimatables(clip.weight)
      if (clip.target === 0 && clip.weight < .001 && clip.group.isStarted) clip.group.stop()
    }
    if (result.hit && !reduced) {this.additive.reset(); this.additive.start(false); this.additive.setWeightForAllAnimatables(1)}
    if (reduced) {this.additive.setWeightForAllAnimatables(0); this.additiveNode.rotation.setAll(0)}
    return result
  }
  dispose() {for (const clip of this.layers.values()) clip.group.dispose(); this.layers.clear(); this.additive.dispose(); this.additiveNode.dispose()}
}
