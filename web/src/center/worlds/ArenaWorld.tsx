import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Color, Group, InstancedMesh, MathUtils, Object3D } from 'three'
import type { GameWorldProps } from './GameWorld'

type Body = { x: number; z: number; yaw?: number; hp?: number; maxHp?: number; character?: string; weapon?: string; shieldUntil?: number; stunnedUntil?: number; respawnAt?: number; team?: string; speed?: number; attackReadyAt?: number; blocking?: boolean; moving?: boolean }
type Pose = { x: number; z: number; yaw: number; moving: number }
const TEAM_COLORS = ['#ff8c78', '#73d8f4', '#b5ed78', '#c4a5f6', '#ffdc75', '#f9aad9', '#8dd3ac', '#93aaf4', '#cdeef6', '#dfab78', '#ebaebe', '#72e2ca', '#c3c973', '#efa4ea', '#c0bdfe', '#a4dfab', '#dfc08e', '#afd9db', '#fabb96', '#b5ccec', '#a2d2a8', '#d9a9ce', '#c9d694', '#86cfd1', '#ecb5e2']
const CREATURES: Record<string, { body: string; head: string; feet: string }> = { fox: { body: '#ec9b62', head: '#f9ae78', feet: '#ffead0' }, robot: { body: '#7fb8d4', head: '#c9e8f3', feet: '#557da4' }, frog: { body: '#8cc665', head: '#aade80', feet: '#6fac6f' }, cat: { body: '#a994d3', head: '#c8b2e8', feet: '#f4e5fd' } }
const DROP_COLORS: Record<string, string> = { coin: '#ffdc61', bomb: '#443b62', push: '#f88aaa', shield: '#66d9e9', sword: '#e8eff5', spear: '#dab88b', gun: '#85b6cf', heal: '#a9ee77' }
const number = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback

/** All avatar parts share one instanced draw call. Fifty players do not create fifty skeleton render loops. */
function ArenaCharacters({ state, me, inputRef }: GameWorldProps) {
  const spheres = useRef<InstancedMesh>(null)
  const weapons = useRef<InstancedMesh>(null)
  const marks = useRef<InstancedMesh>(null)
  const shields = useRef<InstancedMesh>(null)
  const healthBars = useRef<InstancedMesh>(null)
  const transform = useMemo(() => new Object3D(), [])
  const color = useMemo(() => new Color(), [])
  const poses = useRef(new Map<string, Pose>())
  const received = useRef(performance.now())
  const snapshot = useRef(state)
  const entries: [string, Body][] = useMemo(() => Object.entries(state.bodies ?? {}).slice(0, 50) as [string, Body][], [state.bodies])
  useEffect(() => { snapshot.current = state; received.current = performance.now() }, [state])
  const PARTS = 16
  useFrame(({ clock }, rawDelta) => {
    if (!spheres.current || !weapons.current || !marks.current || !shields.current || !healthBars.current) return
    const delta = Math.min(.06, rawDelta)
    const age = Math.min(250, performance.now() - received.current)
    const serverTime = number(snapshot.current.serverTimeMs, Date.now()) + age
    const width = number(state.bounds?.width, 20), depth = number(state.bounds?.depth, 16)
    for (let index = 0; index < entries.length; index++) {
      const [who, body] = entries[index]
      const character = CREATURES[body.character || 'fox'] || CREATURES.fox
      let pose = poses.current.get(who)
      if (!pose) { pose = { x: number(body.x), z: number(body.z), yaw: number(body.yaw), moving: 0 }; poses.current.set(who, pose) }
      const isMe = who === me, knockedOut = number(body.respawnAt) > serverTime || number(body.hp, 100) <= 0
      const moving = isMe && inputRef?.current.active && !knockedOut && number(body.stunnedUntil) <= serverTime ? inputRef.current : null
      // A bounded visual projection follows current intent. Server snapshots continuously correct it.
      const speed = number(body.speed, 4.5) * (body.blocking ? .5 : 1)
      let projectedX = MathUtils.clamp(number(body.x) + (moving?.dx || 0) * speed * age / 1000, -width / 2 + .4, width / 2 - .4)
      let projectedZ = MathUtils.clamp(number(body.z) + (moving?.dz || 0) * speed * age / 1000, -depth / 2 + .4, depth / 2 - .4)
      const canWalk = (x: number, z: number) => !(state.crates ?? []).some((crate: any) => crate.hp > 0 && Math.abs(x - crate.x) < .85 && Math.abs(z - crate.z) < .85) && !(state.boss?.hp > 0 && Math.hypot(x, z) < 1.6)
      if (!canWalk(projectedX, number(body.z))) projectedX = number(body.x)
      if (!canWalk(projectedX, projectedZ)) projectedZ = number(body.z)
      const difference = Math.hypot(projectedX - pose.x, projectedZ - pose.z)
      if (difference > 3) { pose.x = projectedX; pose.z = projectedZ }
      else { pose.x = MathUtils.damp(pose.x, projectedX, isMe ? 19 : 12, delta); pose.z = MathUtils.damp(pose.z, projectedZ, isMe ? 19 : 12, delta) }
      pose.moving = MathUtils.damp(pose.moving, (difference > .035 || body.moving) && !knockedOut ? 1 : 0, 12, delta)
      const yaw = moving && (moving.dx || moving.dz) ? Math.atan2(moving.dx, moving.dz) : number(body.yaw)
      const angle = Math.atan2(Math.sin(yaw - pose.yaw), Math.cos(yaw - pose.yaw))
      pose.yaw += angle * Math.min(1, delta * 15)
      const t = clock.elapsedTime * 12 + index
      const bob = Math.abs(Math.sin(t)) * .06 * pose.moving
      const scale = knockedOut ? .42 : 1
      const y = knockedOut ? -.25 : bob
      const swing = Math.sin(t) * .17 * pose.moving
      const attackPhase = MathUtils.clamp((number(body.attackReadyAt) - serverTime) / number(state.weaponCooldownMs, 500), 0, 1)
      const attackSwing = Math.sin(attackPhase * Math.PI) * .5
      const teamIndex = Math.max(0, (parseInt(String(body.team || 'team-1').replace('team-', '')) || 1) - 1)
      const teamColor = TEAM_COLORS[teamIndex % TEAM_COLORS.length]
      const part = (partIndex: number, x: number, py: number, z: number, sx: number, sy: number, sz: number, tint: string) => {
        const cosine = Math.cos(pose!.yaw), sine = Math.sin(pose!.yaw)
        transform.position.set(pose!.x + (x * cosine + z * sine) * scale, (py + y) * scale, pose!.z + (-x * sine + z * cosine) * scale)
        transform.rotation.set(0, pose!.yaw, 0); transform.scale.set(sx * scale, sy * scale, sz * scale); transform.updateMatrix()
        spheres.current!.setMatrixAt(index * PARTS + partIndex, transform.matrix)
        color.set(tint); spheres.current!.setColorAt(index * PARTS + partIndex, color)
      }
      part(0, 0, .61, 0, .3, .39, .24, character.body)
      part(1, 0, 1.14, 0, .34, .32, .3, character.head)
      part(2, -.15, .16, .06 + swing, .13, .17, .19, character.feet)
      part(3, .15, .16, .06 - swing, .13, .17, .19, character.feet)
      part(4, -.35, .6, swing, .11, .26, .11, character.body)
      part(5, .35, .6 + attackSwing * .4, -swing + attackSwing, .11, .26, .11, character.body)
      const frog = body.character === 'frog', robot = body.character === 'robot'
      part(6, -.15, frog ? 1.45 : 1.2, frog ? .09 : .276, frog ? .13 : .04, frog ? .12 : .065, frog ? .13 : .035, frog ? '#e8f9d7' : '#233646')
      part(7, .15, frog ? 1.45 : 1.2, frog ? .09 : .276, frog ? .13 : .04, frog ? .12 : .065, frog ? .13 : .035, frog ? '#e8f9d7' : '#233646')
      part(8, -.15, frog ? 1.45 : 1.21, frog ? .20 : .299, frog ? .05 : .017, frog ? .067 : .026, .025, frog ? '#233646' : '#effbff')
      part(9, .15, frog ? 1.45 : 1.21, frog ? .20 : .299, frog ? .05 : .017, frog ? .067 : .026, .025, frog ? '#233646' : '#effbff')
      part(10, -.22, 1.48, -.03, robot || frog ? .001 : .105, robot || frog ? .001 : .22, .11, character.body)
      part(11, .22, 1.48, -.03, robot || frog ? .001 : .105, robot || frog ? .001 : .22, .11, character.body)
      part(12, 0, 1.04, .265, frog ? .19 : .20, .115, .08, robot ? '#537d9b' : '#fff1d8')
      part(13, 0, 1.09, .351, frog || robot ? .001 : .045, .04, .035, '#303747')
      part(14, 0, .69, -.26, robot || frog ? .10 : .12, .13, robot || frog ? .12 : .34, character.body)
      part(15, 0, .82, .23, .24, .09, .055, teamColor)
      transform.position.set(pose.x, .021, pose.z); transform.rotation.set(-Math.PI / 2, 0, 0); transform.scale.setScalar(isMe ? .66 : .45); transform.updateMatrix(); marks.current.setMatrixAt(index, transform.matrix); color.set(isMe ? '#ffffff' : teamColor); marks.current.setColorAt(index, color)
      const weapon = body.weapon || 'hands'
      const weaponVisible = ['sword', 'spear', 'gun'].includes(weapon) && !knockedOut
      const weaponLength = weapon === 'spear' ? 1.3 : weapon === 'sword' ? .7 : .45
      const cos = Math.cos(pose.yaw), sin = Math.sin(pose.yaw)
      transform.position.set(pose.x + .43 * cos + (.26 + attackSwing) * sin, .65 + y + attackSwing * .4, pose.z - .43 * sin + (.26 + attackSwing) * cos); transform.rotation.set(weapon === 'gun' ? Math.PI / 2 : -.3 - attackSwing, pose.yaw, .2); transform.scale.set(weaponVisible ? .09 : 0, weaponVisible ? weaponLength : 0, weaponVisible ? .09 : 0); transform.updateMatrix(); weapons.current.setMatrixAt(index * 2, transform.matrix); color.set(weapon === 'gun' ? '#3b627e' : weapon === 'spear' ? '#c79667' : '#eef6fb'); weapons.current.setColorAt(index * 2, color)
      transform.position.set(pose.x - .40 * cos + .20 * sin, .65 + y, pose.z + .40 * sin + .20 * cos); transform.rotation.set(0, pose.yaw, 0); transform.scale.set(body.blocking && !knockedOut ? .38 : 0, .58, .10); transform.updateMatrix(); weapons.current.setMatrixAt(index * 2 + 1, transform.matrix); color.set('#73c5e0'); weapons.current.setColorAt(index * 2 + 1, color)
      transform.position.set(pose.x, .85, pose.z); transform.rotation.set(0, 0, 0); transform.scale.setScalar(number(body.shieldUntil) > serverTime && !knockedOut ? .95 : 0); transform.updateMatrix(); shields.current.setMatrixAt(index, transform.matrix)
      const ratio = MathUtils.clamp(number(body.hp, 100) / Math.max(1, number(body.maxHp, 100)), 0, 1)
      transform.position.set(pose.x, 1.92, pose.z); transform.rotation.set(-.50, 0, 0); transform.scale.set(.80, .06, .04); transform.updateMatrix(); healthBars.current.setMatrixAt(index * 2, transform.matrix); color.set('#444456'); healthBars.current.setColorAt(index * 2, color)
      transform.position.x = pose.x - .40 * (1 - ratio); transform.position.z += .024; transform.scale.x *= ratio; transform.updateMatrix(); healthBars.current.setMatrixAt(index * 2 + 1, transform.matrix); color.set(ratio < .30 ? '#ed776e' : '#b8eb7d'); healthBars.current.setColorAt(index * 2 + 1, color)
    }
    spheres.current.instanceMatrix.needsUpdate = true; weapons.current.instanceMatrix.needsUpdate = true; marks.current.instanceMatrix.needsUpdate = true; shields.current.instanceMatrix.needsUpdate = true; healthBars.current.instanceMatrix.needsUpdate = true
    if (spheres.current.instanceColor) spheres.current.instanceColor.needsUpdate = true
    if (weapons.current.instanceColor) weapons.current.instanceColor.needsUpdate = true
    if (marks.current.instanceColor) marks.current.instanceColor.needsUpdate = true
    if (healthBars.current.instanceColor) healthBars.current.instanceColor.needsUpdate = true
  })
  return <><instancedMesh ref={spheres} args={[undefined, undefined, Math.max(1, entries.length * PARTS)]} frustumCulled={false}><sphereGeometry args={[1, 8, 6]} /><meshStandardMaterial roughness={.8} /></instancedMesh><instancedMesh ref={weapons} args={[undefined, undefined, Math.max(1, entries.length * 2)]} frustumCulled={false}><boxGeometry /><meshStandardMaterial metalness={.25} roughness={.5} /></instancedMesh><instancedMesh ref={marks} args={[undefined, undefined, Math.max(1, entries.length)]} frustumCulled={false}><ringGeometry args={[.83, 1, 16]} /><meshBasicMaterial transparent opacity={.8} depthWrite={false} /></instancedMesh><instancedMesh ref={shields} args={[undefined, undefined, Math.max(1, entries.length)]} frustumCulled={false}><sphereGeometry args={[1, 10, 8]} /><meshBasicMaterial color="#8bdff1" transparent opacity={.18} depthWrite={false} /></instancedMesh><instancedMesh ref={healthBars} args={[undefined, undefined, Math.max(1, entries.length * 2)]} frustumCulled={false}><boxGeometry /><meshBasicMaterial /></instancedMesh></>
}

function Drops({ state, reducedMotion }: Pick<GameWorldProps, 'state' | 'reducedMotion'>) {
  const coinMesh = useRef<InstancedMesh>(null), itemMesh = useRef<InstancedMesh>(null), bombMesh = useRef<InstancedMesh>(null)
  const transform = useMemo(() => new Object3D(), []), color = useMemo(() => new Color(), [])
  const received = useRef(performance.now())
  useEffect(() => { received.current = performance.now() }, [state.nowMs])
  const drops = Array.isArray(state.drops) ? state.drops.slice(0, 120) : []
  const coins = drops.filter(drop => drop.kind === 'coin'), bombs = drops.filter(drop => drop.kind === 'bomb'), items = drops.filter(drop => !['coin', 'bomb'].includes(drop.kind))
  useFrame(({ clock }) => {
    const nowMs = number(state.nowMs) + (state.finished || reducedMotion ? 0 : Math.min(250, performance.now() - received.current))
    for (const [mesh, collection] of [[coinMesh.current, coins], [itemMesh.current, items], [bombMesh.current, bombs]] as const) {
      if (!mesh) continue
      for (let i = 0; i < collection.length; i++) {
        const drop = collection[i], active = nowMs >= number(drop.spawnAt) && nowMs <= number(drop.expiresAt, Infinity)
        const progress = MathUtils.clamp((nowMs - number(drop.spawnAt)) / Math.max(1, number(drop.landAt) - number(drop.spawnAt)), 0, 1)
        const y = .3 + (1 - progress) * 6
        transform.position.set(number(drop.x), y, number(drop.z)); transform.rotation.set(drop.kind === 'coin' ? Math.PI / 2 : .35, reducedMotion ? .2 : clock.elapsedTime * 2 + i, 0); transform.scale.setScalar(active ? drop.kind === 'bomb' ? .42 : .3 : 0); transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix); color.set(DROP_COLORS[drop.kind] || '#ffffff'); mesh.setColorAt(i, color)
      }
      mesh.count = collection.length; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  })
  return <><instancedMesh ref={coinMesh} args={[undefined, undefined, 120]} frustumCulled={false}><cylinderGeometry args={[1, 1, .23, 12]} /><meshStandardMaterial metalness={.35} roughness={.35} /></instancedMesh><instancedMesh ref={itemMesh} args={[undefined, undefined, 120]} frustumCulled={false}><octahedronGeometry args={[1]} /><meshStandardMaterial roughness={.5} /></instancedMesh><instancedMesh ref={bombMesh} args={[undefined, undefined, 120]} frustumCulled={false}><sphereGeometry args={[1, 8, 6]} /><meshStandardMaterial roughness={.6} /></instancedMesh></>
}

function ArenaBoss({ state, me, onAim, onAttack }: Pick<GameWorldProps, 'state' | 'me' | 'onAim' | 'onAttack'>) {
  const group = useRef<Group>(null)
  const before = useRef(number(state.boss?.hp)), hitAt = useRef(0)
  useEffect(() => { if (number(state.boss?.hp) < before.current) hitAt.current = performance.now(); before.current = number(state.boss?.hp) }, [state.boss?.hp])
  useFrame(({ clock }, delta) => {
    if (!group.current) return
    group.current.position.x = MathUtils.damp(group.current.position.x, number(state.boss?.x), 8, delta); group.current.position.z = MathUtils.damp(group.current.position.z, number(state.boss?.z), 8, delta)
    const hit = Math.max(0, 1 - (performance.now() - hitAt.current) / 300)
    group.current.rotation.z = Math.sin(clock.elapsedTime * 35) * hit * .06
    group.current.scale.y = state.boss?.hp <= 0 ? .25 : 1 + Math.sin(clock.elapsedTime * 2) * .02
  })
  if (!state.boss) return null
  return <group ref={group} position={[number(state.boss.x), 0, number(state.boss.z)]} onClick={event => { event.stopPropagation(); const body = state.bodies?.[me]; if (body) onAim?.(Math.atan2(number(state.boss.x) - number(body.x), number(state.boss.z) - number(body.z))); onAttack?.() }}><mesh position={[0, 1.5, 0]} scale={[1.05, 1.4, .85]}><icosahedronGeometry args={[1, 0]} /><meshStandardMaterial color="#8565bd" /></mesh><mesh position={[0, 2.8, 0]} scale={[.75, .6, .6]}><dodecahedronGeometry args={[1]} /><meshStandardMaterial color="#b399e5" /></mesh>{[-1, 1].map(side => <group key={side}><mesh position={[side * 1.2, 1.5, 0]} scale={[.45, 1, .5]}><icosahedronGeometry args={[1]} /><meshStandardMaterial color="#9c7ad0" /></mesh><mesh position={[side * .24, 2.9, .52]}><boxGeometry args={[.22, .09, .09]} /><meshBasicMaterial color={state.boss.phase === 'windup' ? '#ff976b' : '#a3f4dc'} /></mesh><mesh position={[side * .52, .35, 0]}><dodecahedronGeometry args={[.5]} /><meshStandardMaterial color="#7f62a7" /></mesh></group>)}<mesh position={[0, 1.65, .75]}><octahedronGeometry args={[.38]} /><meshStandardMaterial color="#ffdf93" emissive="#c8a65a" emissiveIntensity={.3} /></mesh></group>
}

function Projectile({ projectile, state }: { projectile: Record<string, any>; state: GameWorldProps['state'] }) {
  const group = useRef<Group>(null), received = useRef(performance.now())
  useEffect(() => { received.current = performance.now() }, [projectile.x, projectile.z])
  useFrame(() => { if (!group.current) return; const dt = state.finished ? 0 : Math.min(.1, (performance.now() - received.current) / 1000); group.current.position.set(number(projectile.x) + Math.sin(number(projectile.yaw)) * 12 * dt, .8, number(projectile.z) + Math.cos(number(projectile.yaw)) * 12 * dt) })
  return <group ref={group} position={[number(projectile.x), .8, number(projectile.z)]}><mesh><sphereGeometry args={[.09, 6, 4]} /><meshBasicMaterial color="#ffec9b" /></mesh></group>
}

/** Compact server-shaped playground. Props never mint pickups or imply accepted hits. */
export default function ArenaWorld(props: GameWorldProps) {
  const { state, game } = props
  const width = number(state.bounds?.width, 20), depth = number(state.bounds?.depth, 16)
  const boss = game === 'boss-raid', duel = game === 'combat-duel'
  const floor = boss ? '#947fba' : duel ? '#efc59f' : '#a3ddbd'
  const border = boss ? '#ddd0f3' : duel ? '#fff0ce' : '#fff1b6'
  const crates = Array.isArray(state.crates) ? state.crates.filter((crate: any) => crate.hp > 0) : []
  const events = Array.isArray(state.events) ? state.events.slice(-10) : []
  return <><mesh position={[0, -.18, 0]} onClick={event => { event.stopPropagation(); const body = state.bodies?.[props.me]; if (!body || state.finished) return; props.onAim?.(Math.atan2(event.point.x - number(body.x), event.point.z - number(body.z))); props.onAttack?.() }}><boxGeometry args={[width + .6, .35, depth + .6]} /><meshStandardMaterial color={floor} roughness={1} /></mesh><mesh position={[0, -.58, 0]}><boxGeometry args={[width, .48, depth]} /><meshStandardMaterial color={boss ? '#78648d' : '#c4a887'} /></mesh>
    {[-1, 1].map(side => <group key={side}><mesh position={[side * (width / 2 + .15), .35, 0]}><boxGeometry args={[.20, .45, depth + .5]} /><meshStandardMaterial color={border} /></mesh><mesh position={[0, .35, side * (depth / 2 + .15)]}><boxGeometry args={[width + .5, .45, .20]} /><meshStandardMaterial color={border} /></mesh>{Array.from({ length: 7 }, (_, i) => <mesh key={i} position={[side * (width / 2 + .15), .4, (i - 3) * depth / 6]}><boxGeometry args={[.3, .85, .3]} /><meshStandardMaterial color={border} /></mesh>)}</group>)}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .006, 0]}><ringGeometry args={[3.8, 3.9, 48]} /><meshBasicMaterial color={boss ? '#d2b6ed' : '#fff4d4'} transparent opacity={.6} /></mesh>
    {[-1, 1].flatMap(side => [-1, 1].map(end => <group key={`${side}:${end}`} position={[side * (width / 2 + 1), 0, end * (depth / 2 - 1)]}><mesh position={[0, .6, 0]}><cylinderGeometry args={[.12, .18, 1.2, 6]} /><meshStandardMaterial color="#a2796b" /></mesh><mesh position={[0, 1.7, 0]} scale={[.8, 1.2, .8]}><icosahedronGeometry args={[1, 0]} /><meshStandardMaterial color={boss ? '#b89ed7' : duel ? '#bfb7df' : '#6dbb9e'} /></mesh></group>))}
    {crates.map((crate: any) => <group key={crate.id} position={[number(crate.x), 0, number(crate.z)]}><mesh position={[0, .38, 0]}><boxGeometry args={[.75, .75, .75]} /><meshStandardMaterial color="#d8a174" roughness={.9} /></mesh><mesh position={[0, .4, .386]} rotation={[0, 0, .7]}><boxGeometry args={[.09, .86, .025]} /><meshStandardMaterial color="#f9d7a4" /></mesh><mesh position={[0, .4, .4]} rotation={[0, 0, -.7]}><boxGeometry args={[.09, .86, .025]} /><meshStandardMaterial color="#f9d7a4" /></mesh></group>)}
    <ArenaCharacters {...props} /><Drops state={state} reducedMotion={props.reducedMotion} /><ArenaBoss state={state} me={props.me} onAim={props.onAim} onAttack={props.onAttack} />
    {state.boss?.phase === 'windup' && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[number(state.boss.attackX), .018, number(state.boss.attackZ)]}><circleGeometry args={[2, 32]} /><meshBasicMaterial color="#ff705e" transparent opacity={.30} depthWrite={false} /></mesh>}
    {(Array.isArray(state.projectiles) ? state.projectiles : []).slice(0, 80).map((projectile: any) => <Projectile key={projectile.id} projectile={projectile} state={state} />)}
    {events.filter((event: any) => ['pickup-bomb', 'push', 'boss-slam', 'attack', 'hit', 'scatter', 'crate-break'].includes(event.kind) && number(state.nowMs) - number(event.at) < 450).map((event: any) => <mesh key={event.id} rotation={[-Math.PI / 2, 0, 0]} position={[number(event.x), .08, number(event.z)]}><ringGeometry args={[.65, .8, 20]} /><meshBasicMaterial color={event.kind === 'pickup-bomb' || event.kind === 'boss-slam' ? '#ff806f' : '#fff1a4'} transparent opacity={.7} depthWrite={false} /></mesh>)}
  </>
}
