import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AnimationAction, AnimationClip, AnimationMixer, Color, Frustum, Group, InstancedMesh, LoopOnce, LoopRepeat, Material, MathUtils, Matrix4, Mesh, MeshStandardMaterial, Object3D, Quaternion, SkinnedMesh, Sphere, Vector3 } from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import type { GameWorldProps } from './GameWorld'
import { stateGround } from './terrain'

type Pose = { x: number; y: number; z: number; yaw: number; moving: number }
type Props = GameWorldProps & { poses: Map<string, Pose>; onReady?: () => void }
type Body = Record<string, any>
type Rig = { scene: Object3D; mixer: AnimationMixer; actions: Map<string, AnimationAction>; hand: Object3D | undefined; materials: Material[]; current: Record<'upper' | 'lower', string> }
type Cue = { name: string; until: number; key: string; whole: boolean }
const num = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const TEAM_COLORS = ['#ffb275', '#78d9ec', '#b5db83', '#c3a2e8', '#ecd07f', '#ea9bb4']
const SUITS: Record<string, { suit: string; armor: string; accent: string }> = {
  fox: { suit: '#bf6240', armor: '#443f45', accent: '#edb760' },
  robot: { suit: '#528ca0', armor: '#394c60', accent: '#87dadd' },
  frog: { suit: '#6f9150', armor: '#3d5550', accent: '#bbd978' },
  cat: { suit: '#9274ae', armor: '#454863', accent: '#d9b1e5' },
}
const lowerTrack = (name: string) => /^(root|pelvis|thigh_[lr]|calf_[lr]|foot_[lr]|ball(?:_leaf)?_[lr])\./.test(name)

function makeRig(gltf: GLTF, character: string, team: string): Rig {
  const scene = clone(gltf.scene), materials: Material[] = [], materialCache = new Map<string, Material>()
  const style = SUITS[character] || SUITS.fox, teamIndex = Math.max(0, Number(String(team).replace('team-', '')) - 1)
  scene.traverse(object => {
    if (!(object instanceof Mesh)) return
    object.castShadow = true; object.receiveShadow = true
    const material = (source: Material) => {
      const tint = source.name === 'Orbix_Suit' ? style.suit : source.name === 'Orbix_Armor' ? style.armor : source.name === 'Orbix_Accent' ? team ? TEAM_COLORS[teamIndex % TEAM_COLORS.length] || style.accent : style.accent : null
      if (!tint || !(source instanceof MeshStandardMaterial)) return source // Preserve skin and eyes; cached maps remain shared.
      let owned = materialCache.get(source.uuid)
      if (!owned) { owned = source.clone(); (owned as MeshStandardMaterial).color.set(tint); materialCache.set(source.uuid, owned); materials.push(owned) }
      return owned
    }
    object.material = Array.isArray(object.material) ? object.material.map(material) : material(object.material)
  })
  const mixer = new AnimationMixer(scene), actions = new Map<string, AnimationAction>()
  for (const clip of gltf.animations) for (const layer of ['lower', 'upper'] as const) {
    const tracks = clip.tracks.filter(track => lowerTrack(track.name) === (layer === 'lower'))
    if (tracks.length) actions.set(`${clip.name}:${layer}`, mixer.clipAction(new AnimationClip(`${clip.name}:${layer}`, clip.duration, tracks)))
  }
  return { scene, mixer, actions, hand: scene.getObjectByName('hand_r'), materials, current: { upper: '', lower: '' } }
}

function releaseRig(rig: Rig) {
  rig.mixer.stopAllAction(); rig.mixer.uncacheRoot(rig.scene)
  for (const material of rig.materials) material.dispose()
  const skeletons = new Set<SkinnedMesh['skeleton']>()
  rig.scene.traverse(object => { if (object instanceof SkinnedMesh) skeletons.add(object.skeleton) })
  for (const skeleton of skeletons) skeleton.dispose() // Skeleton clones own their GPU bone textures, never source geometries/maps.
}

function selectAction(rig: Rig, name: string, layer: 'lower' | 'upper', once: boolean, eventKey: string, speed = 1) {
  const key = `${name}:${layer}`, identity = `${key}:${eventKey}`, action = rig.actions.get(key) || rig.actions.get(`Idle:${layer}`)
  if (!action || rig.current[layer] === identity) return
  const previousKey = rig.current[layer].split(':').slice(0, 2).join(':'), prior = rig.actions.get(previousKey)
  if (prior && prior !== action) prior.fadeOut(.15)
  action.reset().setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity).setEffectiveTimeScale(speed).setEffectiveWeight(1)
  action.clampWhenFinished = once; action.fadeIn(.15).play(); rig.current[layer] = identity
}

function blocked(state: Body, x: number, z: number, y: number) {
  if ((state.crates ?? []).some((item: Body) => item.hp > 0 && y < num(item.y) + 1.1 && Math.abs(x - num(item.x)) < .85 && Math.abs(z - num(item.z)) < .85)) return true
  if (state.boss?.hp > 0 && Math.hypot(x - num(state.boss.x), z - num(state.boss.z)) < 1.8) return true
  return (state.obstacles ?? []).some((item: Body) => y < num(item.baseY) + num(item.height, 1.6) - .05 && (item.radius ? Math.hypot(x - num(item.x), z - num(item.z)) < num(item.radius) + .32 : Math.abs(x - num(item.x)) < num(item.width, 1) / 2 + .32 && Math.abs(z - num(item.z)) < num(item.depth, 1) / 2 + .32))
}

function support(state: Body, x: number, z: number, bodyY: number) {
  let floor = stateGround(state, x, z)
  for (const obstacle of state.obstacles ?? []) {
    const top = num(obstacle.baseY) + num(obstacle.height)
    if (bodyY >= top - .08 && Math.abs(x - num(obstacle.x)) < num(obstacle.width) / 2 + .32 && Math.abs(z - num(obstacle.z)) < num(obstacle.depth) / 2 + .32) floor = Math.max(floor, top)
  }
  return floor
}

function PoseMotion({ state, me, inputRef, poses }: Props) {
  const received = useRef(performance.now())
  const entries = useMemo(() => Object.entries(state.bodies ?? {}).slice(0, 50) as [string, Body][], [state.bodies])
  const alive = useMemo(() => new Set(entries.map(([who]) => who)), [entries])
  useEffect(() => { received.current = performance.now() }, [state])
  useFrame((_, rawDelta) => {
    const delta = Math.min(.06, rawDelta), age = Math.min(250, performance.now() - received.current), serverTime = num(state.serverTimeMs, Date.now()) + age
    for (const [who, body] of entries) {
      let pose = poses.get(who)
      if (!pose) { pose = { x: num(body.x), y: num(body.y), z: num(body.z), yaw: num(body.yaw), moving: 0 }; poses.set(who, pose) }
      const local = who === me, down = num(body.respawnAt) > serverTime || num(body.hp, 100) <= 0
      const intent = local && inputRef?.current.active && !down && num(body.stunnedUntil) <= serverTime && !state.finished && state._canAct !== false ? inputRef.current : null
      const speed = (intent?.sprint ? 8 : num(body.speed, 5)) * (body.blocking ? .5 : 1)
      let x = MathUtils.clamp(num(body.x) + (intent?.dx || 0) * speed * age / 1000, -num(state.bounds?.width, 40) / 2 + .55, num(state.bounds?.width, 40) / 2 - .55)
      let z = MathUtils.clamp(num(body.z) + (intent?.dz || 0) * speed * age / 1000, -num(state.bounds?.depth, 40) / 2 + .55, num(state.bounds?.depth, 40) / 2 - .55)
      if (blocked(state, x, num(body.z), num(body.y))) x = num(body.x)
      if (blocked(state, x, z, num(body.y))) z = num(body.z)
      const floor = support(state, x, z, num(body.y)), time = Math.min(.12, age / 1000)
      const y = local ? body.onGround ? floor : Math.max(floor, num(body.y) + num(body.vy) * time - 9 * time * time) : num(body.y)
      const gap = Math.hypot(x - pose.x, z - pose.z)
      if (gap > 3) { pose.x = x; pose.z = z; pose.y = y }
      else { pose.x = MathUtils.damp(pose.x, x, local ? 19 : 12, delta); pose.z = MathUtils.damp(pose.z, z, local ? 19 : 12, delta); pose.y = MathUtils.damp(pose.y, y, 24, delta) }
      pose.moving = MathUtils.damp(pose.moving, (gap > .025 || body.moving || intent && (intent.dx !== 0 || intent.dz !== 0)) && !down ? 1 : 0, 12, delta)
      const facing = local && inputRef?.current.yaw !== undefined ? inputRef.current.yaw : num(body.yaw)
      pose.yaw += Math.atan2(Math.sin(facing - pose.yaw), Math.cos(facing - pose.yaw)) * Math.min(1, delta * 18)
    }
    for (const who of poses.keys()) if (!alive.has(who)) poses.delete(who)
  }, -2)
  return null
}

function RigActor({ who, body, full, lod, handOutputs, ...props }: Props & { who: string; body: Body; full: GLTF; lod: GLTF; handOutputs: Map<string, Object3D> }) {
  const container = useRef<Group>(null), health = useRef(num(body.hp, 100)), grounded = useRef(Boolean(body.onGround)), attack = useRef(num(body.lastAttackAt)), dodge = useRef(num(body.dodgeUntil)), loot = useRef(num(body.lootReadyAt))
  const cue = useRef<Cue | null>(null), selection = useRef(0), accumulated = useRef(0)
  const rigs = useMemo(() => [makeRig(full, body.character || 'fox', body.team || ''), makeRig(lod, body.character || 'fox', body.team || '')], [full, lod, body.character, body.team])
  const lifetime = useMemo(() => ({ mounted: false, released: false }), [rigs])
  const frustum = useMemo(() => new Frustum(), []), projection = useMemo(() => new Matrix4(), []), sphere = useMemo(() => new Sphere(new Vector3(), 2.5), [])
  useEffect(() => {
    lifetime.mounted = true
    return () => {
      lifetime.mounted = false
      // StrictMode immediately reinstates this effect with the same memoized rigs.
      // Disposing its mixer in that rehearsal invalidates existing AnimationActions.
      queueMicrotask(() => {
        if (lifetime.mounted || lifetime.released) return
        lifetime.released = true
        for (const rig of rigs) releaseRig(rig)
        handOutputs.delete(who)
      })
    }
  }, [rigs, lifetime, who, handOutputs])
  useFrame(({ camera }, rawDelta) => {
    if (!container.current) return
    const pose = props.poses.get(who)
    if (!pose) return
    const now = num(props.state.serverTimeMs, Date.now()), local = who === props.me, down = num(body.hp, 100) <= 0 || num(body.respawnAt) > now
    const distance = camera.position.distanceToSquared(sphere.center.set(pose.x, pose.y + 1, pose.z))
    frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    const visible = !(local && props.cameraRef?.current.mode === 'first') && distance < 65 * 65 && frustum.intersectsSphere(sphere)
    container.current.visible = visible; container.current.position.set(pose.x, pose.y, pose.z); container.current.rotation.y = pose.yaw
    const selected = local || distance < 12 * 12 ? 0 : 1
    rigs[0].scene.visible = selected === 0; rigs[1].scene.visible = selected === 1
    const rig = rigs[selected]
    if (rig.hand && visible) handOutputs.set(who, rig.hand)
    else handOutputs.delete(who)
    let event: Cue | null = null
    if (num(body.lastAttackAt) > attack.current && now - num(body.lastAttackAt) < 1000) {
      const weapon = body.lastAttackWeapon || body.weapon, name = body.lastAttackKind === 'interact' ? 'Interact' : body.lastAttackStyle === 'kick' ? 'Kick' : body.lastAttackStyle === 'punch' ? num(body.combo) % 2 ? 'PunchJab' : 'PunchCross' : weapon === 'gun' ? 'PistolShoot' : weapon === 'sword' || weapon === 'spear' ? 'SwordAttack' : body.lastAttackStyle === 'heavy' ? 'PunchCross' : num(body.combo) % 2 ? 'PunchJab' : 'PunchCross'
      event = { name, until: now + (name === 'PistolShoot' ? 350 : name === 'Kick' ? 550 : 500), key: `attack-${body.lastAttackAt}`, whole: name === 'Kick' }
    }
    if (num(body.dodgeUntil) > dodge.current && num(body.dodgeUntil) > now) event = { name: 'Dodge', until: now + 430, key: `dodge-${body.dodgeUntil}`, whole: true }
    if (num(body.lootReadyAt) > loot.current && pose.moving < .25) event = { name: 'Interact', until: now + 350, key: `loot-${body.lootReadyAt}`, whole: false }
    if (num(body.hp, 100) < health.current && !down) event = { name: 'Hit', until: now + 250, key: `hit-${props.state.tick}-${body.hp}`, whole: false }
    const onGround = body.onGround !== undefined ? Boolean(body.onGround) : num(body.y) <= num(body.groundHeight) + .08
    if (!onGround && grounded.current && !down) event = { name: 'JumpStart', until: now + 280, key: `jump-${props.state.tick}`, whole: true }
    if (onGround && !grounded.current && !down) event = { name: 'JumpLand', until: now + 160, key: `land-${props.state.tick}`, whole: true }
    attack.current = num(body.lastAttackAt); dodge.current = num(body.dodgeUntil); loot.current = num(body.lootReadyAt); health.current = num(body.hp, 100); grounded.current = onGround
    if (event) cue.current = event
    if (cue.current && now >= cue.current.until) cue.current = null
    let lower = pose.moving > .2 ? body.sprinting || local && props.inputRef?.current.sprint ? 'Sprint' : 'Run' : 'Idle', upper = lower
    let once = false, key = '', speed = 1
    if (body.weapon === 'gun' && pose.moving < .2) upper = 'PistolAim'
    else if (['sword', 'spear'].includes(body.weapon) && pose.moving < .2) upper = 'SwordIdle'
    if (body.blocking) upper = 'Guard'
    if (!onGround) { lower = 'JumpLoop'; upper = 'JumpLoop' }
    if (cue.current) { upper = cue.current.name; if (cue.current.whole) lower = upper; once = true; key = cue.current.key; speed = upper === 'Dodge' ? 3 : upper === 'JumpStart' ? 4 : upper === 'JumpLand' ? 5 : upper === 'Interact' ? 4 : upper === 'SwordAttack' ? 2.5 : 1.5 }
    if (down) { lower = upper = 'Death'; once = true; key = `down-${num(body.respawnAt)}`; speed = 1.5 }
    selectAction(rig, lower, 'lower', once && lower === upper, once && lower === upper ? key : '', lower === upper ? speed : 1)
    selectAction(rig, upper, 'upper', once || upper === 'Guard' || upper === 'PistolAim', key, speed)
    accumulated.current += Math.min(rawDelta, .1)
    if (!visible) { accumulated.current = 0; return }
    if (selected === 1 && accumulated.current < .05 && selected === selection.current) return
    rig.mixer.update(Math.min(accumulated.current, .15)); accumulated.current = 0; selection.current = selected
    container.current.updateMatrixWorld(true)
  }, -1.5)
  return <group ref={container} dispose={null}><primitive object={rigs[0].scene} dispose={null} /><primitive object={rigs[1].scene} dispose={null} /></group>
}

/** Batched weapons use the animated wrist position; blade orientation follows the actual grip bone. */
function Equipment({ handOutputs, ...props }: Props & { handOutputs: Map<string, Object3D> }) {
  const entries = useMemo(() => Object.entries(props.state.bodies ?? {}).slice(0, 50) as [string, Body][], [props.state.bodies])
  const mesh = useRef<InstancedMesh>(null), transform = useMemo(() => new Object3D(), []), grip = useMemo(() => new Vector3(), []), handQuaternion = useMemo(() => new Quaternion(), []), attachment = useMemo(() => new Object3D(), []), color = useMemo(() => new Color(), [])
  useFrame(({ camera }) => {
    if (!mesh.current) return
    let count = 0
    for (const [who, body] of entries) {
      const hand = handOutputs.get(who), pose = props.poses.get(who), now = num(props.state.serverTimeMs, Date.now())
      if (!hand || !pose || num(body.hp, 100) <= 0 || num(body.respawnAt) > now || who === props.me && props.cameraRef?.current.mode === 'first' || camera.position.distanceToSquared(hand.getWorldPosition(grip)) > 45 * 45) continue
      hand.getWorldQuaternion(handQuaternion)
      const weapon = body.weapon
      if (!['gun', 'sword', 'spear'].includes(weapon)) continue
      attachment.position.copy(grip)
      if (weapon === 'gun') attachment.rotation.set(-num(body.aimPitch), pose.yaw, 0)
      else attachment.quaternion.copy(handQuaternion)
      attachment.updateMatrixWorld()
      const part = (x: number, y: number, z: number, sx: number, sy: number, sz: number, tint: string, roll = 0) => {
        transform.position.set(x, y, z); transform.rotation.set(0, 0, roll); transform.scale.set(sx, sy, sz); transform.updateMatrix(); transform.matrix.premultiply(attachment.matrixWorld)
        mesh.current!.setMatrixAt(count, transform.matrix); color.set(tint); mesh.current!.setColorAt(count++, color)
      }
      if (weapon === 'gun') {
        part(0, .035, .18, .10, .12, .34, '#304352'); part(0, .06, .48, .043, .043, .30, '#758995')
        part(0, -.06, .07, .085, .20, .075, '#314556', -.17); part(0, .035, -.07, .095, .09, .16, '#536576')
        part(0, .13, .2, .06, .055, .11, num(body.weaponLevel) ? '#a687d5' : '#84c6be')
        if (now - num(body.lastAttackAt) < 110) part(0, .06, .67, .12, .10, .13, '#ffe5a0')
      } else if (weapon === 'sword') {
        part(0, .08, 0, .045, .19, .045, '#746348'); part(0, .22, 0, .24, .04, .06, '#c4ac73')
        part(0, .63, 0, .105, .78, .03, '#cfdae3'); part(0, 1.03, 0, .065, .12, .025, '#ecf1f2', -.3)
      } else {
        part(0, .44, 0, .037, 1.75, .037, '#8d7455'); part(0, 1.32, 0, .07, .27, .025, '#d7e0df')
      }
    }
    mesh.current.count = count; mesh.current.instanceMatrix.needsUpdate = true; if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
  }, -1.4)
  return <instancedMesh ref={mesh} args={[undefined, undefined, 50 * 7]} frustumCulled={false} castShadow><boxGeometry /><meshStandardMaterial roughness={.46} metalness={.32} /></instancedMesh>
}

function Indicators(props: Props) {
  const entries = useMemo(() => Object.entries(props.state.bodies ?? {}).slice(0, 50) as [string, Body][], [props.state.bodies])
  const bars = useRef<InstancedMesh>(null), marks = useRef<InstancedMesh>(null), shadows = useRef<InstancedMesh>(null), shields = useRef<InstancedMesh>(null), transform = useMemo(() => new Object3D(), []), color = useMemo(() => new Color(), [])
  useFrame(({ camera }) => {
    if (!bars.current || !marks.current || !shadows.current || !shields.current) return
    for (let index = 0; index < entries.length; index++) {
      const [who, body] = entries[index], pose = props.poses.get(who)
      if (!pose) continue
      const now = num(props.state.serverTimeMs, Date.now()), down = num(body.hp, 100) <= 0 || num(body.respawnAt) > now, local = who === props.me, fpv = local && props.cameraRef?.current.mode === 'first', ground = num(body.groundHeight, stateGround(props.state, pose.x, pose.z))
      const teamIndex = Math.max(0, Number(String(body.team || 'team-1').replace('team-', '')) - 1), tint = TEAM_COLORS[teamIndex % TEAM_COLORS.length] || '#d7e4e7'
      transform.position.set(pose.x, ground + .025, pose.z); transform.rotation.set(-Math.PI / 2, 0, 0); transform.scale.setScalar(local ? .58 : .43); transform.updateMatrix(); marks.current.setMatrixAt(index, transform.matrix); color.set(local ? '#efe0a8' : tint); marks.current.setColorAt(index, color)
      transform.scale.set(.42, .25, 1); transform.updateMatrix(); shadows.current.setMatrixAt(index, transform.matrix)
      transform.position.set(pose.x, pose.y + .94, pose.z); transform.rotation.set(0, 0, 0); transform.scale.setScalar(num(body.shieldUntil) > now && !down && !fpv ? 1.06 : 0); transform.updateMatrix(); shields.current.setMatrixAt(index, transform.matrix)
      const ratio = MathUtils.clamp(num(body.hp, 100) / Math.max(1, num(body.maxHp, 100)), 0, 1)
      transform.position.set(pose.x, pose.y + 2.08, pose.z); transform.quaternion.copy(camera.quaternion); transform.scale.set(fpv ? 0 : .7, .05, .02); transform.updateMatrix(); bars.current.setMatrixAt(index * 2, transform.matrix); color.set('#24373e'); bars.current.setColorAt(index * 2, color)
      transform.scale.x *= ratio; transform.translateZ(.003); transform.updateMatrix(); bars.current.setMatrixAt(index * 2 + 1, transform.matrix); color.set(ratio < .3 ? '#ee927e' : '#b5d695'); bars.current.setColorAt(index * 2 + 1, color)
    }
    marks.current.count = shadows.current.count = shields.current.count = entries.length; bars.current.count = entries.length * 2
    for (const mesh of [bars.current, marks.current, shadows.current, shields.current]) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true }
  }, -1.3)
  return <>
    <instancedMesh ref={marks} args={[undefined, undefined, 50]} frustumCulled={false}><ringGeometry args={[.83, 1, 20]} /><meshBasicMaterial transparent opacity={.58} depthWrite={false} /></instancedMesh>
    <instancedMesh ref={shadows} args={[undefined, undefined, 50]} frustumCulled={false}><circleGeometry args={[1, 20]} /><meshBasicMaterial color="#24373a" transparent opacity={.19} depthWrite={false} /></instancedMesh>
    <instancedMesh ref={shields} args={[undefined, undefined, 50]} frustumCulled={false}><sphereGeometry args={[1, 12, 10]} /><meshBasicMaterial color="#86c8d3" transparent opacity={.13} depthWrite={false} /></instancedMesh>
    <instancedMesh ref={bars} args={[undefined, undefined, 100]} frustumCulled={false}><boxGeometry /><meshBasicMaterial /></instancedMesh>
  </>
}

/** Actual animated skeletons with lower/upper animation layers, distance LOD and bounded authority reconciliation. */
export default function SkeletalActors(props: Props) {
  const [full, lod] = useLoader(GLTFLoader, [`${import.meta.env.BASE_URL}center-models/orbix-ranger.glb`, `${import.meta.env.BASE_URL}center-models/orbix-ranger-lod.glb`])
  const handOutputs = useMemo(() => new Map<string, Object3D>(), []), ready = useRef(props.onReady)
  ready.current = props.onReady
  useEffect(() => { ready.current?.() }, [full, lod])
  const entries = Object.entries(props.state.bodies ?? {}).slice(0, 50) as [string, Body][]
  return <>
    <PoseMotion {...props} />
    {entries.map(([who, body]) => <RigActor key={who} {...props} who={who} body={body} full={full} lod={lod} handOutputs={handOutputs} />)}
    <Equipment {...props} handOutputs={handOutputs} />
    <Indicators {...props} />
  </>
}
