import { useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Color, Group, InstancedMesh, MathUtils, Object3D, PerspectiveCamera, Vector3 } from 'three'
import type { GameWorldProps } from './GameWorld'
import FieldEnvironment from './FieldEnvironment'
import SkeletalActors from './SkeletalActors'
import GuardianModel from './GuardianModel'
import FirstPersonModel from './FirstPersonModel'
import { stateGround } from './terrain'

type Pose = { x: number; y: number; z: number; yaw: number; moving: number }
type Poses = Map<string, Pose>
const TEAM_COLORS = ['#ff997c', '#74d6f6', '#b5ed78', '#c4a5f6', '#ffdc75', '#f9aad9', '#8dd3ac', '#93aaf4', '#cdeef6', '#dfab78', '#ebaebe', '#72e2ca']
const CHARACTERS: Record<string, { coat: string; skin: string; boots: string; hair: string }> = {
  fox: { coat: '#f18a54', skin: '#ffe3c5', boots: '#514653', hair: '#b45940' },
  robot: { coat: '#4d9fbd', skin: '#bce6ed', boots: '#324a64', hair: '#7182a8' },
  frog: { coat: '#67b459', skin: '#dcf0c1', boots: '#386d62', hair: '#497957' },
  cat: { coat: '#aa82d4', skin: '#ffe2df', boots: '#61517d', hair: '#79639a' },
}
const DROP_COLORS: Record<string, string> = { coin: '#ffdc61', bomb: '#443b62', push: '#f88aaa', shield: '#66d9e9', sword: '#e8eff5', spear: '#dab88b', gun: '#85b6cf', heal: '#a9ee77', upgrade: '#c3a0ff' }
const num = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback

/** Projection respects the server's published static collision shapes. */
function blocked(state: GameWorldProps['state'], x: number, z: number, margin = .32, y = 0) {
  if ((state.crates ?? []).some((item: any) => item.hp > 0 && y < num(item.y) + 1.1 && Math.abs(x - num(item.x)) < .4 + margin && Math.abs(z - num(item.z)) < .4 + margin)) return true
  if (state.boss?.hp > 0 && Math.hypot(x - num(state.boss.x), z - num(state.boss.z)) < 1.2 + margin) return true
  return (state.obstacles ?? []).some((item: any) => y < num(item.baseY) + num(item.height, 1.6) && (item.radius ? Math.hypot(x - num(item.x), z - num(item.z)) < num(item.radius) + margin : Math.abs(x - num(item.x)) < num(item.width, 1) / 2 + margin && Math.abs(z - num(item.z)) < num(item.depth, 1) / 2 + margin))
}

/** Original articulated humanoids; all players share two body draw calls. */
function ArenaCharacters({ state, me, inputRef, cameraRef, poses }: GameWorldProps & { poses: Poses }) {
  const limbs = useRef<InstancedMesh>(null), heads = useRef<InstancedMesh>(null), weapons = useRef<InstancedMesh>(null), marks = useRef<InstancedMesh>(null), bars = useRef<InstancedMesh>(null), shields = useRef<InstancedMesh>(null)
  const transform = useMemo(() => new Object3D(), []), color = useMemo(() => new Color(), [])
  const received = useRef(performance.now())
  const entries = useMemo(() => Object.entries(state.bodies ?? {}).slice(0, 50) as [string, Record<string, any>][], [state.bodies])
  useEffect(() => { received.current = performance.now() }, [state])
  useFrame(({ clock, camera }, rawDelta) => {
    if (!limbs.current || !heads.current || !weapons.current || !marks.current || !bars.current || !shields.current) return
    const delta = Math.min(.06, rawDelta), age = Math.min(250, performance.now() - received.current), serverTime = num(state.serverTimeMs, Date.now()) + age
    const width = num(state.bounds?.width, 40), depth = num(state.bounds?.depth, 40)
    for (let index = 0; index < entries.length; index++) {
      const [who, body] = entries[index], style = CHARACTERS[body.character || 'fox'] || CHARACTERS.fox
      let pose = poses.get(who)
      if (!pose) { pose = { x: num(body.x), y: num(body.y), z: num(body.z), yaw: num(body.yaw), moving: 0 }; poses.set(who, pose) }
      const local = who === me, down = num(body.respawnAt) > serverTime || num(body.hp, 100) <= 0
      const intent = local && inputRef?.current.active && !down && num(body.stunnedUntil) <= serverTime ? inputRef.current : null
      const speed = (intent?.sprint && num(state.worldVersion) >= 3 ? 8 : num(body.speed, 4.5)) * (body.blocking ? .5 : 1)
      let x = MathUtils.clamp(num(body.x) + (intent?.dx || 0) * speed * age / 1000, -width / 2 + .4, width / 2 - .4)
      let z = MathUtils.clamp(num(body.z) + (intent?.dz || 0) * speed * age / 1000, -depth / 2 + .4, depth / 2 - .4)
      if (blocked(state, x, num(body.z), .32, num(body.y))) x = num(body.x)
      if (blocked(state, x, z, .32, num(body.y))) z = num(body.z)
      const gap = Math.hypot(x - pose.x, z - pose.z)
      if (gap > 3) { pose.x = x; pose.z = z; pose.y = num(body.y) }
      else { pose.x = MathUtils.damp(pose.x, x, local ? 19 : 12, delta); pose.z = MathUtils.damp(pose.z, z, local ? 19 : 12, delta); pose.y = MathUtils.damp(pose.y, num(body.y), 22, delta) }
      pose.moving = MathUtils.damp(pose.moving, (gap > .035 || body.moving) && !down ? 1 : 0, 12, delta)
      const facing = local && inputRef?.current.yaw !== undefined ? inputRef.current.yaw : num(body.yaw)
      pose.yaw += Math.atan2(Math.sin(facing - pose.yaw), Math.cos(facing - pose.yaw)) * Math.min(1, delta * 18)
      const cycle = clock.elapsedTime * (body.sprinting || intent?.sprint ? 15 : 10) + index, gait = Math.sin(cycle) * .65 * pose.moving, airborne = pose.y > .12
      const phase = MathUtils.clamp((num(body.attackReadyAt) - serverTime) / num(state.weaponCooldownMs, 500), 0, 1), strike = Math.sin(phase * Math.PI)
      const combo = num(body.combo), scale = local && cameraRef?.current.mode === 'first' ? 0 : 1, y = pose.y + Math.abs(Math.sin(cycle)) * .035 * pose.moving
      const cosine = Math.cos(pose.yaw), sine = Math.sin(pose.yaw)
      const part = (mesh: InstancedMesh, slot: number, px: number, py: number, pz: number, sx: number, sy: number, sz: number, tint: string, rx = 0) => {
        const ly = down ? pz + .24 : py, lz = down ? -py * .85 : pz
        transform.position.set(pose!.x + px * cosine + lz * sine, y + ly, pose!.z - px * sine + lz * cosine)
        transform.rotation.set(rx + (down ? Math.PI / 2 : 0), pose!.yaw, 0); transform.scale.set(sx * scale, sy * scale, sz * scale); transform.updateMatrix()
        mesh.setMatrixAt(slot, transform.matrix); color.set(tint); mesh.setColorAt(slot, color)
      }
      const teamIndex = Math.max(0, (parseInt(String(body.team || 'team-1').replace('team-', '')) || 1) - 1), teamColor = TEAM_COLORS[teamIndex % TEAM_COLORS.length]
      const base = index * 16, head = index * 8
      part(limbs.current, base, 0, 1.03, 0, .53, .62, .29, style.coat, airborne ? -.10 : .03)
      part(limbs.current, base + 1, 0, .70, 0, .42, .20, .28, '#3d5068')
      part(limbs.current, base + 2, 0, 1.02, -.22, .35, .42, .18, '#566985')
      for (const [leg, side] of [-1, 1].entries()) {
        const swing = body.lastAttackStyle === 'heavy' && side > 0 ? -strike * 1.3 : airborne ? side * .35 : gait * side, knee = airborne ? .70 : Math.max(0, -swing) * .9
        part(limbs.current, base + 3 + leg * 3, side * .14, .52, Math.sin(swing) * .12, .17, .39, .18, '#40526b', swing)
        part(limbs.current, base + 4 + leg * 3, side * .14, .24, Math.sin(swing) * .25, .15, .34, .16, style.coat, swing + knee)
        part(limbs.current, base + 5 + leg * 3, side * .14, .075, .055 + Math.sin(swing) * .34, .20, .15, .31, style.boots, swing * .3)
        const arm = body.weapon === 'gun' ? -1.1 : body.blocking ? -1.3 : -gait * side - (side > 0 ? strike * 1.7 : strike * (combo % 2 ? 1.3 : .3))
        part(limbs.current, base + 9 + leg * 2, side * .35, 1.05, Math.sin(-arm) * .13, .16, .36, .17, style.coat, arm)
        part(limbs.current, base + 10 + leg * 2, side * .38, .81 + Math.sin(-arm) * .14, Math.sin(-arm) * .38, .13, .32, .15, style.skin, arm - (body.blocking ? .4 : .2))
      }
      part(limbs.current, base + 13, 0, 1.13, .16, .37, .14, .045, teamColor)
      part(limbs.current, base + 14, 0, 1.56, -.025, .38, .19, .36, style.hair)
      part(limbs.current, base + 15, .25, 1.01, .12, .035, .33, .07, '#fceabb')
      part(heads.current, head, 0, 1.51, 0, .25, .29, .24, style.skin)
      part(heads.current, head + 1, 0, 1.31, 0, .11, .12, .10, style.skin)
      part(heads.current, head + 2, -.09, 1.54, .21, .03, .035, .017, '#263549')
      part(heads.current, head + 3, .09, 1.54, .21, .03, .035, .017, '#263549')
      part(heads.current, head + 4, 0, 1.46, .225, .06, .017, .015, '#bd776d')
      part(heads.current, head + 5, -.38, .69 + strike * .34, .10 + strike * .50, .09, .11, .10, style.skin)
      part(heads.current, head + 6, .38, .69 + strike * .34, .10 + strike * .50, .09, .11, .10, style.skin)
      part(heads.current, head + 7, 0, 1.64, -.015, .25, .13, .25, style.hair)
      const weapon = body.weapon || 'hands', armed = ['sword', 'spear', 'gun'].includes(weapon) && !down
      part(weapons.current, index * 3, .39, weapon === 'gun' ? 1.12 : .8 + strike * .35, .35 + strike * .4, armed ? weapon === 'gun' ? .13 : .07 : 0, armed ? weapon === 'spear' ? 1.65 : weapon === 'sword' ? .8 : .2 : 0, armed ? weapon === 'gun' ? .72 : .07 : 0, weapon === 'gun' ? num(body.weaponLevel) > 0 ? '#7b58a4' : '#304e65' : '#edf5fc', weapon === 'gun' ? 0 : -strike * 1.6)
      part(weapons.current, index * 3 + 1, -.39, 1.02, .33, body.blocking && !down ? .44 : 0, .61, .13, '#67bad9')
      part(weapons.current, index * 3 + 2, .39, 1.17, .75, weapon === 'gun' && strike > .5 ? .19 : 0, .15, .16, '#ffe68b')
      transform.position.set(pose.x, .025, pose.z); transform.rotation.set(-Math.PI / 2, 0, 0); transform.scale.setScalar(local ? .54 : .40); transform.updateMatrix(); marks.current.setMatrixAt(index, transform.matrix); color.set(local ? '#fff6b5' : teamColor); marks.current.setColorAt(index, color)
      transform.position.set(pose.x, y + .94, pose.z); transform.rotation.set(0, 0, 0); transform.scale.setScalar(num(body.shieldUntil) > serverTime && !down ? 1.02 : 0); transform.updateMatrix(); shields.current.setMatrixAt(index, transform.matrix)
      const ratio = MathUtils.clamp(num(body.hp, 100) / Math.max(1, num(body.maxHp, 100)), 0, 1)
      transform.position.set(pose.x, y + 2.03, pose.z); transform.quaternion.copy(camera.quaternion); transform.scale.set(local && cameraRef?.current.mode === 'first' ? 0 : .8, .075, .025); transform.updateMatrix(); bars.current.setMatrixAt(index * 2, transform.matrix); color.set('#293c54'); bars.current.setColorAt(index * 2, color)
      transform.scale.x *= ratio; transform.translateZ(.003); transform.updateMatrix(); bars.current.setMatrixAt(index * 2 + 1, transform.matrix); color.set(ratio < .3 ? '#f47b71' : '#b7ed80'); bars.current.setColorAt(index * 2 + 1, color)
    }
    const alive = new Set(entries.map(([who]) => who)); for (const who of poses.keys()) if (!alive.has(who)) poses.delete(who)
    for (const mesh of [limbs.current, heads.current, weapons.current, marks.current, bars.current, shields.current]) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true }
  }, -2)
  return <><instancedMesh ref={limbs} args={[undefined, undefined, Math.max(1, entries.length * 16)]} frustumCulled={false}><boxGeometry /><meshStandardMaterial roughness={.87} /></instancedMesh><instancedMesh ref={heads} args={[undefined, undefined, Math.max(1, entries.length * 8)]} frustumCulled={false}><sphereGeometry args={[1, 10, 7]} /><meshStandardMaterial roughness={.8} /></instancedMesh><instancedMesh ref={weapons} args={[undefined, undefined, Math.max(1, entries.length * 3)]} frustumCulled={false}><boxGeometry /><meshStandardMaterial metalness={.22} roughness={.45} /></instancedMesh><instancedMesh ref={marks} args={[undefined, undefined, Math.max(1, entries.length)]} frustumCulled={false}><ringGeometry args={[.83, 1, 16]} /><meshBasicMaterial transparent opacity={.7} depthWrite={false} /></instancedMesh><instancedMesh ref={shields} args={[undefined, undefined, Math.max(1, entries.length)]} frustumCulled={false}><sphereGeometry args={[1, 10, 8]} /><meshBasicMaterial color="#8bdff1" transparent opacity={.14} depthWrite={false} /></instancedMesh><instancedMesh ref={bars} args={[undefined, undefined, Math.max(1, entries.length * 2)]} frustumCulled={false}><boxGeometry /><meshBasicMaterial /></instancedMesh></>
}

/** Follow the same reconciled position as the character; collision shortens the camera boom. */
function FollowCamera({ state, me, cameraRef, inputRef, poses }: GameWorldProps & { poses: Poses }) {
  const target = useMemo(() => new Vector3(), []), desired = useMemo(() => new Vector3(), []), look = useMemo(() => new Vector3(), []), initialized = useRef(false)
  useFrame(({ camera, size }, delta) => {
    const pose = poses.get(me), body = state.bodies?.[me]
    const x = pose?.x ?? num(body?.x), z = pose?.z ?? num(body?.z), y = pose?.y ?? num(body?.y)
    const yaw = num(cameraRef?.current.yaw, Math.PI), pitch = MathUtils.clamp(num(cameraRef?.current.pitch, .20), -.5, .90), first = cameraRef?.current.mode === 'first'
    const distance = first ? .04 : size.width < 600 ? 5 : 5.7, flat = Math.cos(pitch), vertical = Math.sin(pitch)
    target.set(x, y + (first ? Number(state.worldVersion) >= 4 ? 1.66 : 1.57 : 1.25), z)
    desired.set(target.x - Math.sin(yaw) * flat * distance - (first ? 0 : Math.cos(yaw) * .48), target.y + vertical * distance + (first ? 0 : .55), target.z - Math.cos(yaw) * flat * distance + (first ? 0 : Math.sin(yaw) * .48))
    if (!first) {
      const obstacles = [...(state.obstacles ?? []), ...(state.crates ?? []).filter((crate: any) => crate.hp > 0).map((crate: any) => ({ ...crate, width: .8, depth: .8, height: .8 }))]
      for (let step = 1; step <= 20; step++) {
        const t = step / 20, px = MathUtils.lerp(target.x, desired.x, t), pz = MathUtils.lerp(target.z, desired.z, t), py = MathUtils.lerp(target.y, desired.y, t)
        if (obstacles.some((item: any) => py < num(item.baseY, num(item.y)) + num(item.height, 1.5) + .2 && (item.radius ? Math.hypot(px - num(item.x), pz - num(item.z)) < num(item.radius) + .25 : Math.abs(px - num(item.x)) < num(item.width, 1) / 2 + .25 && Math.abs(pz - num(item.z)) < num(item.depth, 1) / 2 + .25))) { desired.lerpVectors(target, desired, Math.max(.1, t - .07)); break }
      }
    }
    desired.y = Math.max(stateGround(state, desired.x, desired.z) + .65, desired.y)
    if (!initialized.current || camera.position.distanceTo(desired) > 12) { camera.position.copy(desired); initialized.current = true }
    else camera.position.lerp(desired, 1 - Math.exp(-Math.min(.08, delta) * (first ? 35 : 18)))
    look.set(camera.position.x + Math.sin(yaw) * flat * 15, camera.position.y - vertical * 15, camera.position.z + Math.cos(yaw) * flat * 15)
    camera.lookAt(look)
    if (camera instanceof PerspectiveCamera) { const fov = first ? 72 : inputRef?.current.sprint ? 64 : 58; if (Math.abs(camera.fov - fov) > .03) { camera.fov = MathUtils.damp(camera.fov, fov, 5, delta); camera.updateProjectionMatrix() } }
  }, -1)
  return null
}

/** An original camera-space view model stays readable in first-person mode. */
function FirstPersonHands({ state, me, cameraRef }: GameWorldProps) {
  const group = useRef<Group>(null), body = state.bodies?.[me] ?? {}
  const style = CHARACTERS[body.character || 'fox'] || CHARACTERS.fox
  const armed = ['gun', 'sword', 'spear'].includes(body.weapon)
  useFrame(({ camera }) => {
    if (!group.current) return
    const now = num(state.serverTimeMs, Date.now())
    group.current.visible = cameraRef?.current.mode === 'first' && num(body.hp, 100) > 0 && num(body.respawnAt) <= now
    group.current.position.copy(camera.position); group.current.quaternion.copy(camera.quaternion)
  })
  return <group ref={group} visible={false}><group position={[.25, -.23, -.55]}><mesh position={[0, -.1, .12]} rotation={[-.5, 0, 0]}><boxGeometry args={[.12, .28, .14]} /><meshStandardMaterial color={style.coat} /></mesh><mesh position={[0, -.01, 0]}><sphereGeometry args={[.085, 8, 6]} /><meshStandardMaterial color={style.skin} /></mesh>{armed && <mesh position={[0, .03, body.weapon === 'gun' ? -.08 : -.23]} rotation={[body.weapon === 'gun' ? 0 : -.45, 0, 0]}><boxGeometry args={[body.weapon === 'gun' ? .10 : .055, body.weapon === 'gun' ? .12 : .85, body.weapon === 'gun' ? .45 : .055]} /><meshStandardMaterial color={body.weapon === 'gun' ? '#38556a' : '#dbe6ee'} metalness={.3} roughness={.4} /></mesh>}</group><group position={[-.20, -.29, -.54]}><mesh rotation={[-.4, 0, 0]}><boxGeometry args={[.12, .24, .14]} /><meshStandardMaterial color={style.coat} /></mesh><mesh position={[0, .1, -.05]}><sphereGeometry args={[.085, 8, 6]} /><meshStandardMaterial color={style.skin} /></mesh></group></group>
}

function GroundLoot({ state, reducedMotion }: Pick<GameWorldProps, 'state' | 'reducedMotion'>) {
  const coins = useRef<InstancedMesh>(null), items = useRef<InstancedMesh>(null), bombs = useRef<InstancedMesh>(null), transform = useMemo(() => new Object3D(), []), color = useMemo(() => new Color(), []), received = useRef(performance.now())
  useEffect(() => { received.current = performance.now() }, [state.nowMs])
  const drops = (Array.isArray(state.drops) ? state.drops : []).slice(0, 450)
  const collections = [drops.filter((drop: any) => drop.kind === 'coin'), drops.filter((drop: any) => !['coin', 'bomb'].includes(drop.kind)), drops.filter((drop: any) => drop.kind === 'bomb')]
  useFrame(({ clock }) => {
    const now = num(state.nowMs) + (state.finished ? 0 : Math.min(250, performance.now() - received.current))
    for (const [slot, mesh] of [coins.current, items.current, bombs.current].entries()) {
      if (!mesh) continue
      const collection = collections[slot]
      for (let index = 0; index < collection.length; index++) { const drop = collection[index], visible = now >= num(drop.spawnAt) && now <= num(drop.expiresAt, Infinity), progress = MathUtils.clamp((now - num(drop.spawnAt)) / Math.max(1, num(drop.landAt) - num(drop.spawnAt)), 0, 1); transform.position.set(num(drop.x), num(drop.y) + .25 + (1 - progress) * 7 + (reducedMotion ? 0 : Math.sin(clock.elapsedTime * 2 + index) * .035), num(drop.z)); transform.rotation.set(drop.kind === 'coin' ? Math.PI / 2 : .25, reducedMotion ? .2 : clock.elapsedTime * 1.4 + index, 0); transform.scale.setScalar(visible ? drop.kind === 'bomb' ? .32 : .26 : 0); transform.updateMatrix(); mesh.setMatrixAt(index, transform.matrix); color.set(DROP_COLORS[drop.kind] || '#fff2ac'); mesh.setColorAt(index, color) }
      mesh.count = collection.length; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  })
  return <><instancedMesh ref={coins} args={[undefined, undefined, 450]} frustumCulled={false}><cylinderGeometry args={[1, 1, .22, 12]} /><meshStandardMaterial metalness={.38} roughness={.32} /></instancedMesh><instancedMesh ref={items} args={[undefined, undefined, 450]} frustumCulled={false}><octahedronGeometry args={[1]} /><meshStandardMaterial roughness={.5} /></instancedMesh><instancedMesh ref={bombs} args={[undefined, undefined, 450]} frustumCulled={false}><sphereGeometry args={[1, 8, 6]} /><meshStandardMaterial roughness={.6} /></instancedMesh></>
}

function SupplyDrop({ drop, state, reducedMotion }: { drop: Record<string, any>; state: GameWorldProps['state']; reducedMotion?: boolean }) {
  const group = useRef<Group>(null), canopy = useRef<Group>(null), received = useRef(performance.now())
  useEffect(() => { received.current = performance.now() }, [state.nowMs])
  useFrame(({ clock }) => { const now = num(state.nowMs) + (state.finished ? 0 : Math.min(250, performance.now() - received.current)), progress = MathUtils.clamp((now - num(drop.spawnAt)) / Math.max(1, num(drop.landAt) - num(drop.spawnAt)), 0, 1); if (group.current) { group.current.position.y = num(drop.y) + (1 - progress) * 12; group.current.rotation.z = reducedMotion || progress === 1 ? 0 : Math.sin(clock.elapsedTime * 1.7) * .04 } if (canopy.current) canopy.current.visible = progress < 1 })
  return <group ref={group} position={[num(drop.x), num(drop.y) + 12, num(drop.z)]}><mesh position={[0, .52, 0]}><boxGeometry args={[1.35, 1.04, 1.25]} /><meshStandardMaterial color="#e7636d" roughness={.75} /></mesh><mesh position={[0, 1.08, 0]} rotation={[drop.opened ? -.30 : 0, 0, 0]}><boxGeometry args={[1.48, .18, 1.38]} /><meshStandardMaterial color="#5293c4" /></mesh>{[-1, 1].map(side => <mesh key={side} position={[side * .48, .55, .637]}><boxGeometry args={[.10, .96, .025]} /><meshStandardMaterial color="#fff0b9" /></mesh>)}<mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .018, 0]}><ringGeometry args={[1.6, 1.7, 24]} /><meshBasicMaterial color="#f8d978" transparent opacity={.6} /></mesh><group ref={canopy}><mesh position={[0, 3.5, 0]} scale={[2, .62, 2]}><sphereGeometry args={[1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#fceab1" side={2} /></mesh>{[-1, 1].flatMap(x => [-1, 1].map(z => <mesh key={`${x}:${z}`} position={[x * .65, 2.2, z * .65]} rotation={[z * .2, 0, -x * .2]}><cylinderGeometry args={[.013, .013, 2.8, 4]} /><meshBasicMaterial color="#fbf3df" /></mesh>))}</group></group>
}

function ArenaBoss({ state }: Pick<GameWorldProps, 'state'>) {
  const group = useRef<Group>(null), arms = useRef<Group>(null), previous = useRef(num(state.boss?.hp)), hitAt = useRef(0)
  useEffect(() => { if (num(state.boss?.hp) < previous.current) hitAt.current = performance.now(); previous.current = num(state.boss?.hp) }, [state.boss?.hp])
  useFrame(({ clock }, delta) => { if (!group.current) return; group.current.position.x = MathUtils.damp(group.current.position.x, num(state.boss?.x), 10, delta); group.current.position.z = MathUtils.damp(group.current.position.z, num(state.boss?.z), 10, delta); group.current.rotation.y = num(state.boss?.yaw); const hit = Math.max(0, 1 - (performance.now() - hitAt.current) / 300); group.current.rotation.z = Math.sin(clock.elapsedTime * 35) * hit * .035; group.current.scale.y = state.boss?.hp <= 0 ? .16 : 1 + Math.sin(clock.elapsedTime * 2) * .015; if (arms.current) arms.current.rotation.x = state.boss?.phase === 'windup' ? -.75 : Math.sin(clock.elapsedTime * 1.2) * .07 })
  if (!state.boss) return null
  return <group ref={group} position={[num(state.boss.x), 0, num(state.boss.z)]}><mesh position={[0, 1.75, 0]} scale={[1.1, 1.6, .9]}><icosahedronGeometry args={[1, 0]} /><meshStandardMaterial color="#8664b7" /></mesh><mesh position={[0, 3.1, 0]} scale={[.78, .66, .7]}><dodecahedronGeometry args={[1]} /><meshStandardMaterial color="#b799e5" /></mesh><group ref={arms}>{[-1, 1].map(side => <group key={side}><mesh position={[side * 1.23, 1.65, 0]} scale={[.46, 1.05, .55]}><icosahedronGeometry args={[1]} /><meshStandardMaterial color="#9674ca" /></mesh><mesh position={[side * .26, 3.18, .59]}><boxGeometry args={[.23, .10, .10]} /><meshBasicMaterial color={state.boss.phase === 'windup' ? '#ff9a6e' : '#a2f5dc'} /></mesh></group>)}</group>{[-1, 1].map(side => <mesh key={side} position={[side * .53, .38, 0]}><dodecahedronGeometry args={[.55]} /><meshStandardMaterial color="#73579e" /></mesh>)}<mesh position={[0, 1.82, .82]}><octahedronGeometry args={[.42]} /><meshStandardMaterial color="#ffe394" emissive="#c8a65a" emissiveIntensity={.3} /></mesh></group>
}

function BossWarnings({ state }: Pick<GameWorldProps, 'state'>) {
  const attacks = Array.isArray(state.attacks) ? state.attacks : Array.isArray(state.boss?.attacks) ? state.boss.attacks : state.boss?.phase === 'windup' ? [{ id: 'windup', kind: 'slam', x: state.boss.attackX, z: state.boss.attackZ, radius: 2 }] : []
  return <>{attacks.filter((attack: any) => num(attack.expiresAt, Infinity) >= num(state.nowMs)).slice(-12).map((attack: any) => <group key={attack.id} position={[num(attack.x), num(attack.y) + .045, num(attack.z)]} rotation={[0, num(attack.yaw), 0]}><mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, attack.kind === 'beam' ? num(attack.radius, 25) / 2 : 0]}>{attack.kind === 'beam' ? <planeGeometry args={[num(attack.width, 2.5), num(attack.radius, 25)]} /> : <circleGeometry args={[num(attack.radius, 2), 32]} />}<meshBasicMaterial color={attack.kind === 'wave' ? '#ffba68' : '#ff6d6b'} transparent opacity={.33} depthWrite={false} /></mesh>{attack.kind !== 'beam' && <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[Math.max(.1, num(attack.radius, 2) - .10), num(attack.radius, 2), 32]} /><meshBasicMaterial color="#fff0aa" transparent opacity={.8} depthWrite={false} /></mesh>}</group>)}</>
}

function Projectiles({ state }: Pick<GameWorldProps, 'state'>) {
  const mesh = useRef<InstancedMesh>(null), transform = useMemo(() => new Object3D(), []), color = useMemo(() => new Color(), []), received = useRef(performance.now())
  useEffect(() => { received.current = performance.now() }, [state.nowMs])
  const projectiles = (Array.isArray(state.projectiles) ? state.projectiles : []).slice(0, 150)
  useFrame(() => { if (!mesh.current) return; const dt = state.finished ? 0 : Math.min(.10, (performance.now() - received.current) / 1000); for (let index = 0; index < projectiles.length; index++) { const bullet = projectiles[index], yaw = num(bullet.yaw), pitch = num(bullet.pitch), speed = num(bullet.speed, num(state.worldVersion) >= 3 ? 28 : 12); transform.position.set(num(bullet.x) + Math.sin(yaw) * Math.cos(pitch) * speed * dt, num(bullet.y, 1.15) + Math.sin(pitch) * speed * dt, num(bullet.z) + Math.cos(yaw) * Math.cos(pitch) * speed * dt); transform.rotation.set(-pitch, yaw, 0); transform.scale.set(.055, .055, .42); transform.updateMatrix(); mesh.current.setMatrixAt(index, transform.matrix); color.set(bullet.kind === 'boss' ? '#ff8182' : '#fff0a4'); mesh.current.setColorAt(index, color) } mesh.current.count = projectiles.length; mesh.current.instanceMatrix.needsUpdate = true; if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true })
  return <instancedMesh ref={mesh} args={[undefined, undefined, 150]} frustumCulled={false}><boxGeometry /><meshBasicMaterial /></instancedMesh>
}

function Cover({ item, boss }: { item: Record<string, any>; boss: boolean }) {
  const height = num(item.height, 1.6), radius = num(item.radius, 1), tree = item.kind === 'tree'
  return <group position={[num(item.x), 0, num(item.z)]}>{tree ? <><mesh position={[0, height * .4, 0]}><cylinderGeometry args={[radius * .35, radius * .45, height * .8, 6]} /><meshStandardMaterial color="#9e7967" /></mesh><mesh position={[0, height + .4, 0]} scale={[radius * 1.65, 1.4, radius * 1.65]}><icosahedronGeometry args={[1, 0]} /><meshStandardMaterial color={boss ? '#8f86b9' : '#64af83'} /></mesh></> : item.radius ? <mesh position={[0, height / 2, 0]} scale={[radius, height / 2, radius]} rotation={[.12, num(item.x) * .2, .1]}><dodecahedronGeometry args={[1, 0]} /><meshStandardMaterial color={boss ? '#9f96b9' : '#aaa999'} roughness={1} /></mesh> : <><mesh position={[0, height / 2, 0]}><boxGeometry args={[num(item.width, 2), height, num(item.depth, 2)]} /><meshStandardMaterial color={boss ? '#9590b0' : '#99af9b'} /></mesh><mesh position={[0, height + .04, 0]}><boxGeometry args={[num(item.width, 2) + .12, .14, num(item.depth, 2) + .12]} /><meshStandardMaterial color="#d8d2bd" /></mesh></>}</group>
}

/** Perspective world renders only the authoritative public match state. */
export default function ArenaWorld(props: GameWorldProps & { onAssetsReady?: () => void }) {
  const { state, game } = props, detailed = Number(state.worldVersion) >= 4, poses = useMemo(() => new Map<string, Pose>(), [])
  const width = num(state.bounds?.width, 40), depth = num(state.bounds?.depth, 40), boss = game === 'boss-raid', duel = game === 'combat-duel'
  const floor = boss ? '#9aa08e' : duel ? '#d6c6a3' : '#a8cba0', border = boss ? '#d1c9db' : '#ecdebc', crates = (state.crates ?? []).filter((crate: any) => crate.hp > 0), events = (state.events ?? []).slice(-12)
  return <>{detailed ? <FieldEnvironment state={state} game={game} reducedMotion={props.reducedMotion} /> : <><mesh position={[0, -.17, 0]}><boxGeometry args={[width + 1, .32, depth + 1]} /><meshStandardMaterial color={floor} roughness={1} /></mesh><mesh position={[0, -.5, 0]}><boxGeometry args={[width + 55, .5, depth + 55]} /><meshStandardMaterial color={boss ? '#a0a2a2' : '#b4cca3'} roughness={1} /></mesh>
    {/* Flat surface patches and distant hills decorate the map without introducing fake colliders. */}
    {[-1, 1].flatMap(x => [-1, 1].map(z => <mesh key={`grass:${x}:${z}`} rotation={[-Math.PI / 2, 0, .2 * x]} position={[x * width * .28, .007, z * depth * .28]}><circleGeometry args={[Math.min(width, depth) * .15, 9]} /><meshStandardMaterial color={boss ? '#899586' : duel ? '#cbbb91' : '#92ba8d'} roughness={1} /></mesh>))}
    {[0, 1].map(axis => <mesh key={`path:${axis}`} rotation={[-Math.PI / 2, 0, axis * Math.PI / 2]} position={[0, .009, 0]}><planeGeometry args={[Math.min(width, depth) * .08, Math.max(width, depth)]} /><meshStandardMaterial color={boss ? '#b3afa0' : '#d2c5a2'} roughness={1} /></mesh>)}
    {[-1, 1].flatMap(side => [0, 1, 2].map(i => <mesh key={`hill:${side}:${i}`} position={[side * (width / 2 + 20 + i * 8), 1.5, (i - 1) * depth * .9]} scale={[12 + i * 2, 6 + i * 2, 15]}><icosahedronGeometry args={[1, 0]} /><meshStandardMaterial color={boss ? '#a9a3b6' : '#9cba9b'} roughness={1} /></mesh>))}
    {[-1, 1].map(side => <group key={side}><mesh position={[side * (width / 2 + .15), .55, 0]}><boxGeometry args={[.22, 1.1, depth + .5]} /><meshStandardMaterial color={border} /></mesh><mesh position={[0, .55, side * (depth / 2 + .15)]}><boxGeometry args={[width + .5, 1.1, .22]} /><meshStandardMaterial color={border} /></mesh>{Array.from({ length: 9 }, (_, i) => <mesh key={i} position={[side * (width / 2 + .15), .7, (i - 4) * depth / 8]}><boxGeometry args={[.4, 1.6, .4]} /><meshStandardMaterial color={border} /></mesh>)}</group>)}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .008, 0]}><ringGeometry args={[boss ? 4.8 : 3.8, boss ? 4.95 : 3.9, 48]} /><meshBasicMaterial color={boss ? '#c0b4da' : '#eee3ba'} transparent opacity={.4} /></mesh>
    {(state.obstacles ?? []).slice(0, 40).map((item: any) => <Cover key={item.id || `${item.x}:${item.z}`} item={item} boss={boss} />)}
    {[-1, 1].flatMap(side => [-1, 1].map(end => <group key={`${side}:${end}`} position={[side * (width / 2 + 5), 0, end * (depth / 2 + 1)]}><mesh position={[0, 1.2, 0]}><cylinderGeometry args={[.2, .3, 2.4, 6]} /><meshStandardMaterial color="#9f7c68" /></mesh><mesh position={[0, 3.3, 0]} scale={[1.9, 2.3, 1.9]}><icosahedronGeometry args={[1, 0]} /><meshStandardMaterial color={boss ? '#a8a0b9' : '#7daf86'} /></mesh></group>))}
</>}
    {crates.slice(0, 40).map((crate: any) => <group key={crate.id} position={[num(crate.x), num(crate.y), num(crate.z)]}><mesh position={[0, .4, 0]}><boxGeometry args={[.8, .8, .8]} /><meshStandardMaterial color="#cf9b72" roughness={.9} /></mesh>{[-1, 1].map(side => <mesh key={side} position={[0, .4, .411]} rotation={[0, 0, side * .7]}><boxGeometry args={[.10, .95, .025]} /><meshStandardMaterial color="#f3d3a2" /></mesh>)}</group>)}
    {(state.airdrops ?? []).slice(0, 30).map((drop: any) => <SupplyDrop key={drop.id} drop={drop} state={state} reducedMotion={props.reducedMotion} />)}
    <Suspense fallback={null}>{detailed ? <SkeletalActors {...props} poses={poses} onReady={props.onAssetsReady} /> : <ArenaCharacters {...props} poses={poses} />}</Suspense><FollowCamera {...props} poses={poses} />{detailed ? <FirstPersonModel {...props} /> : <FirstPersonHands {...props} />}<GroundLoot state={state} reducedMotion={props.reducedMotion} />{detailed ? <GuardianModel state={state} reducedMotion={props.reducedMotion} /> : <ArenaBoss state={state} />}<BossWarnings state={state} /><Projectiles state={state} />
    {events.filter((event: any) => ['pickup-bomb', 'push', 'boss-slam', 'boss-wave', 'attack', 'hit', 'scatter', 'crate-break'].includes(event.kind) && num(state.nowMs) - num(event.at) < 450).map((event: any) => <mesh key={event.id} rotation={[-Math.PI / 2, 0, 0]} position={[num(event.x), stateGround(state, num(event.x), num(event.z)) + .065, num(event.z)]}><ringGeometry args={[.65, .8, 20]} /><meshBasicMaterial color={event.kind.startsWith('boss') || event.kind === 'pickup-bomb' ? '#ff806f' : '#fff1a4'} transparent opacity={.65} depthWrite={false} /></mesh>)}
  </>
}
