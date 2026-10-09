import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Color, Frustum, Group, InstancedMesh, MathUtils, Matrix4, Object3D, Sphere, Vector3 } from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import type { GameWorldProps } from './GameWorld'
import { CARTOON_TEAMS, CARTOON_PROPORTIONS } from './cartoonStyle'
import { HeldItems, type GripBones } from './ItemMeshes'
import { MotionTrack, support, type MotionPose } from './motion'
import { stateGround } from './terrain'
import {makeRig,releaseRig,selectAction} from './AnimationRig'
import { AnimationFSM } from '../framework/animation'
import { FootPlant } from '../framework/feet'
import { HealthTrack } from '../framework/health'

type Pose = MotionPose
type Props = GameWorldProps & { poses: Map<string, Pose>; onReady?: () => void }
type Body = Record<string, any>
const num = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const TEAM_COLORS = CARTOON_TEAMS
function PoseMotion({ state, me, inputRef, poses }: Props) {
  const tracks = useRef(new Map<string, MotionTrack>()), round = useRef(state.roundId)
  const entries = useMemo(() => Object.entries(state.bodies ?? {}).slice(0, 50) as [string, Body][], [state.bodies])
  useFrame((_, rawDelta) => {
    const now = performance.now(), delta = Math.min(.06, rawDelta)
    if (round.current !== state.roundId) { tracks.current.clear(); poses.clear(); round.current = state.roundId }
    for (const [who, body] of entries) {
      let track = tracks.current.get(who)
      if (!track) { track = new MotionTrack(); tracks.current.set(who, track) }
      let pose = poses.get(who)
      if (!pose) { pose = { x: num(body.x), y: num(body.y), z: num(body.z), yaw: num(body.yaw), moving: 0 }; poses.set(who, pose) }
      const input = who === me ? inputRef?.current : undefined
      track.receive(body, state, now, input)
      track.update(pose, state, now, delta, input)
    }
    const alive = new Set(entries.map(([who]) => who))
    for (const who of poses.keys()) if (!alive.has(who)) { poses.delete(who); tracks.current.delete(who) }
  }, -2)
  return null
}

function RigActor({ who, body, full, lod, handOutputs, ...props }: Props & { who: string; body: Body; full: GLTF; lod: GLTF; handOutputs: Map<string, GripBones> }) {
  const elastic = useRef<Group>(null), squash = useRef(0)
  const container = useRef<Group>(null), contactMarker = useRef<Group>(null)
  const machine = useMemo(() => new AnimationFSM(), []), health = useMemo(() => new HealthTrack(), [])
  const clock = useRef({ server: num(props.state.serverTimeMs, Date.now()), received: performance.now() })
  useEffect(() => { clock.current = { server: num(props.state.serverTimeMs, Date.now()), received: performance.now() } }, [props.state.serverTimeMs])
  const selection = useRef(0), accumulated = useRef(0)
  const gaitSpeed = useRef(0)
  const rigs = useMemo(() => [makeRig(full, body.character || 'blob', body.team || '', body.cosmetics), makeRig(lod, body.character || 'blob', body.team || '', body.cosmetics, true)], [full, lod, body.character, body.team, JSON.stringify(body.cosmetics)])
  const feet = useMemo(() => rigs.map(rig => new FootPlant(rig.scene)), [rigs])
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
    if (clock.current.server !== num(props.state.serverTimeMs, Date.now())) clock.current = { server: num(props.state.serverTimeMs, Date.now()), received: performance.now() }
    const now = clock.current.server + Math.min(250, performance.now() - clock.current.received), local = who === props.me, down = num(body.hp, 100) <= 0 || num(body.respawnAt) > now
    const distance = camera.position.distanceToSquared(sphere.center.set(pose.x, pose.y + 1, pose.z))
    frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    const visible = !(local && props.cameraRef?.current.mode === 'first') && distance < 65 * 65 && frustum.intersectsSphere(sphere)
    container.current.visible = visible; container.current.position.set(pose.x, pose.y, pose.z); container.current.rotation.y = pose.yaw
    const selected = local || distance < 12 * 12 ? 0 : 1
    rigs[0].scene.visible = selected === 0; rigs[1].scene.visible = selected === 1
    const rig = rigs[selected]
    if (rig.hand && visible) handOutputs.set(who, {right:rig.hand,left:rig.leftHand})
    else handOutputs.delete(who)
    const animation = machine.update(body, props.state, now, num(pose.speed), !!(body.sprinting || local && props.inputRef?.current.sprint))
    const onGround = animation.grounded
    if (animation.landed) squash.current = .12
    health.observe(num(body.hp, 100), props.state.roundId, performance.now(), body.respawnAt)
    if (contactMarker.current) contactMarker.current.visible = animation.contact && visible && !props.reducedMotion
    rig.scene.userData.contactWindow = { active: animation.contact, entered: animation.contactEntered, phase: animation.progress }
    if (elastic.current) {
      squash.current *= Math.exp(-Math.min(rawDelta, .06) * 17)
      const stretch = props.reducedMotion || down ? 0 : !onGround ? .035 : -squash.current
      elastic.current.scale.set(CARTOON_PROPORTIONS[0] * (1 - stretch * .5), CARTOON_PROPORTIONS[1] * (1 + stretch), CARTOON_PROPORTIONS[2] * (1 - stretch * .5))
      elastic.current.rotation.x = props.reducedMotion || down ? 0 : MathUtils.damp(elastic.current.rotation.x, -Math.min(.055, num(pose.speed) * .007), 20, rawDelta)
    }
    const { lower: lowerIntent, upper: upperIntent } = animation
    const lower = lowerIntent.name, upper = upperIntent.name
    if (elastic.current && !props.reducedMotion && !down && upper === 'Hit') elastic.current.rotation.z = Math.sin(now * .035) * .06 * health.intensity(performance.now())
    else if (elastic.current) elastic.current.rotation.z = MathUtils.damp(elastic.current.rotation.z, 0, 20, rawDelta)
    gaitSpeed.current = num(pose.speed) < .08 ? 0 : num(pose.speed)
    selectAction(rig, lower, 'lower', lowerIntent.once, lowerIntent.key, animation.locomotion(lower) && lower !== 'Idle' ? gaitSpeed.current / (rig.gaitSpeeds[lower] * CARTOON_PROPORTIONS[2]) : lowerIntent.rate, lowerIntent.blend)
    selectAction(rig, upper, 'upper', upperIntent.once, upperIntent.key, animation.locomotion(upper) && upper !== 'Idle' ? gaitSpeed.current / (rig.gaitSpeeds[upper] * CARTOON_PROPORTIONS[2]) : upperIntent.rate, upperIntent.blend)
    for (const material of rig.materials) if ('emissive' in material) {
      const lit = material as import('three').MeshStandardMaterial
      lit.emissive.set('#ffd58c'); lit.emissiveIntensity = props.reducedMotion ? 0 : health.intensity(performance.now()) * .65
    }
    if(props.reducedMotion && lower==='Idle' && upper==='Idle')for(const layer of ['lower','upper']){const idle=rig.actions.get(`Idle:${layer}`);if(idle){idle.time=.35;idle.setEffectiveTimeScale(0)}}
    accumulated.current += Math.min(rawDelta, .1)
    if (!visible) { accumulated.current = 0; return }
    if (selected === 1 && accumulated.current < .05 && selected === selection.current) return
    rig.mixer.update(Math.min(accumulated.current, .15)); accumulated.current = 0
    container.current.updateMatrixWorld(true)
    if (selection.current !== selected) feet[selected].reset()
    selection.current = selected
    const gait = rig.actions.get(`${lower}:lower`), phase = gait ? gait.time / Math.max(.001, gait.getClip().duration) : 0
    feet[selected].update(container.current, phase, num(pose.speed) > .08, selected === 0 && onGround && !down && animation.locomotion(lower), (x, z) => support(props.state, x, z, pose.y))
    container.current.updateMatrixWorld(true)
  }, -1.5)
  return <group ref={container} dispose={null}><group ref={contactMarker} visible={false} position={[0, .9, .75]} rotation={[-Math.PI / 2, 0, 0]}><mesh><ringGeometry args={[.35, .40, 16, 1, 0, Math.PI]} /><meshBasicMaterial color="#ffe3a1" transparent opacity={.65} depthWrite={false} /></mesh></group><group ref={elastic}><primitive object={rigs[0].scene} dispose={null} /><primitive object={rigs[1].scene} dispose={null} /></group></group>
}

function Indicators(props: Props) {
  const entries = useMemo(() => Object.entries(props.state.bodies ?? {}).slice(0, 50) as [string, Body][], [props.state.bodies])
  const marks = useRef<InstancedMesh>(null), shadows = useRef<InstancedMesh>(null), shields = useRef<InstancedMesh>(null), transform = useMemo(() => new Object3D(), []), color = useMemo(() => new Color(), [])
  useFrame(() => {
    if (!marks.current || !shadows.current || !shields.current) return
    for (let index = 0; index < entries.length; index++) {
      const [who, body] = entries[index], pose = props.poses.get(who)
      if (!pose) continue
      const now = num(props.state.serverTimeMs, Date.now()), down = num(body.hp, 100) <= 0 || num(body.respawnAt) > now, local = who === props.me, fpv = local && props.cameraRef?.current.mode === 'first', ground = num(body.groundHeight, stateGround(props.state, pose.x, pose.z))
      const teamIndex = Math.max(0, Number(String(body.team || 'team-1').replace('team-', '')) - 1), tint = TEAM_COLORS[teamIndex % TEAM_COLORS.length] || '#d7e4e7'
      transform.position.set(pose.x, ground + .025, pose.z); transform.rotation.set(-Math.PI / 2, 0, 0); transform.scale.setScalar(local ? .58 : .43); transform.updateMatrix(); marks.current.setMatrixAt(index, transform.matrix); color.set(local ? '#efe0a8' : tint); marks.current.setColorAt(index, color)
      transform.scale.set(.42, .25, 1); transform.updateMatrix(); shadows.current.setMatrixAt(index, transform.matrix)
      transform.position.set(pose.x, pose.y + .94, pose.z); transform.rotation.set(0, 0, 0); transform.scale.setScalar(num(body.shieldUntil) > now && !down && !fpv ? 1.06 : 0); transform.updateMatrix(); shields.current.setMatrixAt(index, transform.matrix)

    }
    marks.current.count = shadows.current.count = shields.current.count = entries.length
    for (const mesh of [marks.current, shadows.current, shields.current]) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true }
  }, -1.3)
  return <>
    <instancedMesh ref={marks} args={[undefined, undefined, 50]} frustumCulled={false}><ringGeometry args={[.83, 1, 20]} /><meshBasicMaterial transparent opacity={.58} depthWrite={false} /></instancedMesh>
    <instancedMesh ref={shadows} args={[undefined, undefined, 50]} frustumCulled={false}><circleGeometry args={[1, 20]} /><meshBasicMaterial color="#24373a" transparent opacity={.19} depthWrite={false} /></instancedMesh>
    <instancedMesh ref={shields} args={[undefined, undefined, 50]} frustumCulled={false}><sphereGeometry args={[1, 12, 10]} /><meshBasicMaterial color="#86c8d3" transparent opacity={.13} depthWrite={false} /></instancedMesh>
  </>
}

/** Actual animated skeletons with lower/upper animation layers, distance LOD and bounded authority reconciliation. */
export default function SkeletalActors(props: Props) {
  const [full, lod] = useLoader(GLTFLoader, [`${import.meta.env.BASE_URL}center-models/orbix-ranger.glb`, `${import.meta.env.BASE_URL}center-models/orbix-ranger-lod.glb`])
  const handOutputs = useMemo(() => new Map<string, GripBones>(), []), ready = useRef(props.onReady)
  ready.current = props.onReady
  useEffect(() => { ready.current?.() }, [full, lod])
  const entries = Object.entries(props.state.bodies ?? {}).slice(0, 50) as [string, Body][]
  return <>
    <PoseMotion {...props} />
    {entries.map(([who, body]) => <RigActor key={who} {...props} who={who} body={body} full={full} lod={lod} handOutputs={handOutputs} />)}
    <HeldItems {...props} hands={handOutputs} />
    <Indicators {...props} />
  </>
}
