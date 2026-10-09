import {AnimationAction,AnimationClip,AnimationMixer,LoopOnce,LoopRepeat,Material,Object3D} from 'three'
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js'
import {buildCuteCharacter} from './CuteCharacter'
import type {Cosmetics} from '../characters'
export type Rig = { gaitSpeeds: Record<string,number>; scene: Object3D; mixer: AnimationMixer; actions: Map<string, AnimationAction>; hand: Object3D | undefined; leftHand: Object3D | undefined; materials: Material[]; current: Record<'upper' | 'lower', string>; release: () => void }
const lowerTrack = (name: string) => /^(root|pelvis|thigh_[lr]|calf_[lr]|foot_[lr]|ball(?:_leaf)?_[lr])\./.test(name)

export function makeRig(gltf: GLTF, character: string, _team: string, cosmetics: Cosmetics = {}, distant = false): Rig {
  const owned = buildCuteCharacter(gltf, {character, cosmetics}, distant)
  const scene = owned.scene, mixer = new AnimationMixer(scene), actions = new Map<string, AnimationAction>()
  for (const clip of owned.animations) for (const layer of ['lower', 'upper'] as const) {
    const tracks = clip.tracks.filter(track => lowerTrack(track.name) === (layer === 'lower'))
    if (tracks.length) actions.set(`${clip.name}:${layer}`, mixer.clipAction(new AnimationClip(`${clip.name}:${layer}`, clip.duration, tracks)))
  }
  // Seed a fully weighted idle pose before the first render/crossfade.
  for(const layer of ['lower','upper'])actions.get(`Idle:${layer}`)?.play()
  mixer.update(.001)
  return {scene, mixer, actions, gaitSpeeds:owned.gaitSpeeds, hand: scene.getObjectByName('hand_r'), leftHand: scene.getObjectByName('hand_l'), materials: owned.materials, release: owned.release, current:{upper:'Idle:upper:',lower:'Idle:lower:'}}
}

export function releaseRig(rig: Rig) {
  rig.mixer.stopAllAction(); rig.mixer.uncacheRoot(rig.scene)
  rig.release()

}

export function selectAction(rig: Rig, name: string, layer: 'lower' | 'upper', once: boolean, eventKey: string, speed = 1) {
  const key = `${name}:${layer}`, identity = `${key}:${eventKey}`, action = rig.actions.get(key) || rig.actions.get(`Idle:${layer}`)
  if (!action) return
  action.setEffectiveTimeScale(speed)
  rig.scene.userData.animationLayers ??= {}
  rig.scene.userData.animationLayers[layer] = {clip:action.getClip().name,rate:speed}
  if (rig.current[layer] === identity) return
  const previousKey = rig.current[layer].split(':').slice(0, 2).join(':'), prior = rig.actions.get(previousKey)
  if (['Idle','Walk','Run','Sprint'].includes(name)) {
    // Expired combat must carry zero weight, including an action paused at its last frame
    // and a LOD mixer that was inactive during the transition.
    for (const [otherKey,other] of rig.actions) if(otherKey.endsWith(`:${layer}`) && !['Idle','Walk','Run','Sprint'].includes(otherKey.split(':')[0])) other.stop()
  }
  if (prior && prior !== action && prior.isRunning()) prior.fadeOut(once ? .07 : .10)
  action.reset().setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity).setEffectiveTimeScale(speed).setEffectiveWeight(1)
  action.paused = false; action.enabled = true
  if (layer === 'upper' && ['Idle','Walk','Run','Sprint'].includes(name)) { const lower = rig.actions.get(`${name}:lower`); if (lower) action.syncWith(lower) }
  action.clampWhenFinished = once; action.fadeIn(once ? .07 : .10).play(); rig.current[layer] = identity
}
