import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { CanvasTexture, Group, MathUtils, Mesh, MeshBasicMaterial, SRGBColorSpace } from 'three'
import type { GameWorldProps } from './GameWorld'
import ArenaWorld from './ArenaWorld'

type SceneProps = GameWorldProps & { active: boolean; onContextLost: () => void; onReady: () => void; fallback: ReactNode }
type Vec3 = [number, number, number]
type WorldProps = GameWorldProps & { reducedMotion: boolean }
const COLORS = ['#fb936d', '#b899f4', '#61cfcd', '#f4c766', '#87d780', '#8dbaf5']

function Sphere({ position = [0, 0, 0], scale = [1, 1, 1], color, radius = 1 }: { position?: Vec3; scale?: Vec3; color: string; radius?: number }) {
  return <mesh position={position} scale={scale}><sphereGeometry args={[radius, 12, 8]} /><meshStandardMaterial color={color} roughness={.85} /></mesh>
}

function Block({ position = [0, 0, 0], scale = [1, 1, 1], color, rotation = [0, 0, 0] }: { position?: Vec3; scale?: Vec3; color: string; rotation?: Vec3 }) {
  return <mesh position={position} rotation={rotation} scale={scale}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={color} roughness={.7} /></mesh>
}

function Ring({ position = [0, .02, 0], radius = 1, color, opacity = 1 }: { position?: Vec3; radius?: number; color: string; opacity?: number }) {
  return <mesh position={position} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[radius * .87, radius, 48]} /><meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} /></mesh>
}

function BlobShadow({ position = [0, .015, 0], size = 1 }: { position?: Vec3; size?: number }) {
  return <mesh position={position} rotation={[-Math.PI / 2, 0, 0]} scale={[size, size * .6, 1]}><circleGeometry args={[1, 20]} /><meshBasicMaterial color="#223e5d" transparent opacity={.17} depthWrite={false} /></mesh>
}

function Island({ radius = 5, grass = '#95dca2', rock = '#dfb795', position = [0, 0, 0] }: { radius?: number; grass?: string; rock?: string; position?: Vec3 }) {
  return <group position={position}>
    <mesh position={[0, -.23, 0]}><cylinderGeometry args={[radius, radius * .88, .55, 12]} /><meshStandardMaterial color={grass} roughness={1} /></mesh>
    <mesh position={[0, -1.24, 0]}><coneGeometry args={[radius * .92, 2.1, 9]} /><meshStandardMaterial color={rock} roughness={1} /></mesh>
    <mesh position={[0, -1.24, 0]} rotation={[Math.PI, .17, 0]}><coneGeometry args={[radius * .91, 2.1, 9]} /><meshStandardMaterial color={rock} roughness={1} /></mesh>
  </group>
}

function Cloud({ position, size = 1, moving }: { position: Vec3; size?: number; moving: boolean }) {
  const group = useRef<Group>(null)
  useFrame(({ clock }) => {
    if (moving && group.current) group.current.position.x = position[0] + Math.sin(clock.elapsedTime * .16 + position[2]) * .25
  })
  return <group ref={group} position={position} scale={size}>
    <Sphere scale={[1.7, .38, .67]} color="#ffffff" />
    <Sphere position={[-.6, .2, 0]} scale={[.65, .48, .6]} color="#ffffff" />
    <Sphere position={[.35, .23, 0]} scale={[.85, .6, .6]} color="#ffffff" />
  </group>
}

function Tree({ position, size = 1, color = '#68bb9c' }: { position: Vec3; size?: number; color?: string }) {
  return <group position={position} scale={size}>
    <mesh position={[0, .65, 0]}><cylinderGeometry args={[.11, .18, 1.3, 7]} /><meshStandardMaterial color="#a57466" /></mesh>
    <Sphere position={[0, 1.35, 0]} scale={[.78, .9, .7]} color={color} />
    <Sphere position={[.45, 1.05, .08]} scale={[.5, .55, .5]} color={color} />
    <Sphere position={[-.35, 1.12, .12]} scale={[.48, .65, .5]} color={color} />
  </group>
}

function Crystal({ position, color = '#bda2ef', scale = 1 }: { position: Vec3; color?: string; scale?: number }) {
  return <group position={position} scale={scale}>
    <mesh position={[0, .5, 0]}><octahedronGeometry args={[.5, 0]} /><meshStandardMaterial color={color} metalness={.2} roughness={.34} /></mesh>
    <mesh position={[.3, .27, .16]} rotation={[0, 0, -.35]}><octahedronGeometry args={[.3, 0]} /><meshStandardMaterial color={color} metalness={.2} roughness={.34} /></mesh>
  </group>
}

/** Original primitive-built characters: grounded root, joint animation, no downloaded meshes or textures. */
function Character({ position, color = '#fb966c', fox = false, facing = 0, moving = true, celebrate = false, action = 0, scale = 1, basket = false }: {
  position: Vec3; color?: string; fox?: boolean; facing?: number; moving?: boolean; celebrate?: boolean; action?: number; scale?: number; basket?: boolean
}) {
  const body = useRef<Group>(null)
  const leftArm = useRef<Group>(null)
  const rightArm = useRef<Group>(null)
  const root = useRef<Group>(null)
  const initialPosition = useRef<Vec3>([...position])
  const pulse = useRef(0)
  const actionPrevious = useRef(action)
  useEffect(() => { if (action !== actionPrevious.current) { pulse.current = .75; actionPrevious.current = action } }, [action])
  useFrame(({ clock }, delta) => {
    if (!root.current || !body.current) return
    root.current.position.x = moving ? MathUtils.damp(root.current.position.x, position[0], 13, delta) : position[0]
    root.current.position.z = moving ? MathUtils.damp(root.current.position.z, position[2], 13, delta) : position[2]
    root.current.position.y = position[1]
    if (!moving) { body.current.position.y = 0; return }
    pulse.current = Math.max(0, pulse.current - Math.min(delta, .05))
    const t = clock.elapsedTime
    body.current.position.y = Math.sin(t * (celebrate ? 8 : 2.2)) * (celebrate ? .11 : .025) + Math.sin(pulse.current * Math.PI) * .12
    body.current.rotation.z = Math.sin(t * 1.8) * .025
    if (leftArm.current) leftArm.current.rotation.z = celebrate ? -.9 + Math.sin(t * 8) * .17 : -.08 - Math.sin(pulse.current * Math.PI) * .65
    if (rightArm.current) rightArm.current.rotation.z = celebrate ? .9 + Math.sin(t * 8) * .17 : .08 + Math.sin(pulse.current * Math.PI) * .65
  })
  return <group ref={root} position={initialPosition.current} rotation={[0, facing, 0]} scale={scale}>
    <BlobShadow size={.57} />
    <group ref={body}>
      <Sphere position={[0, .67, 0]} scale={[.35, .47, .27]} color={color} />
      <Sphere position={[0, 1.25, .01]} scale={[.43, .4, .37]} color={fox ? color : '#ffe0bd'} />
      {fox ? <>
        <mesh position={[-.29, 1.64, .005]} rotation={[0, 0, .3]}><coneGeometry args={[.17, .43, 3]} /><meshStandardMaterial color={color} /></mesh>
        <mesh position={[.29, 1.64, .005]} rotation={[0, 0, -.3]}><coneGeometry args={[.17, .43, 3]} /><meshStandardMaterial color={color} /></mesh>
        <Sphere position={[0, 1.12, .28]} scale={[.28, .17, .16]} color="#fff3da" />
        <Sphere position={[0, 1.21, .43]} radius={.065} color="#283746" />
        <Sphere position={[0, .64, -.4]} scale={[.18, .19, .52]} color={color} />
      </> : <>
        <Sphere position={[0, 1.46, -.02]} scale={[.46, .25, .41]} color={color} />
        <Block position={[0, 1.34, .34]} scale={[.48, .12, .075]} color="#333e60" />
      </>}
      {fox && [-1, 1].map(side => <Sphere key={side} position={[side * .17, 1.3, .344]} scale={[.045, .072, .032]} color="#29374a" />)}
      <mesh position={[0, .91, 0]}><torusGeometry args={[.32, .08, 6, 16]} /><meshStandardMaterial color="#67cbb6" /></mesh>
      <group ref={leftArm} position={[-.33, .86, 0]}><Sphere position={[-.065, -.22, 0]} scale={[.12, .3, .13]} color={fox ? color : '#ffdfbb'} /></group>
      <group ref={rightArm} position={[.33, .86, 0]}><Sphere position={[.065, -.22, 0]} scale={[.12, .3, .13]} color={fox ? color : '#ffdfbb'} /></group>
      {[-1, 1].map(side => <Sphere key={side} position={[side * .18, .18, .09]} scale={[.15, .18, .23]} color="#fff2d6" />)}
      <Block position={[0, .65, -.29]} scale={[.45, .55, .24]} color="#9a81c5" />
      {basket && <mesh position={[0, .53, .53]}><cylinderGeometry args={[.44, .32, .42, 12, 1, true]} /><meshStandardMaterial color="#e5b873" side={2} /></mesh>}
    </group>
  </group>
}

function FaceLabel({ value, color = '#344568', size = .7, position = [0, 0, 0] }: { value: string; color?: string; size?: number; position?: Vec3 }) {
  const texture = useMemo(() => {
    const surface = document.createElement('canvas')
    surface.width = surface.height = 128
    const context = surface.getContext('2d')
    if (context) {
      context.clearRect(0, 0, 128, 128)
      context.fillStyle = color
      context.font = 'bold 88px system-ui, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(value, 64, 69, 112)
    }
    const next = new CanvasTexture(surface)
    next.colorSpace = SRGBColorSpace
    return next
  }, [value, color])
  useEffect(() => () => texture.dispose(), [texture])
  return <mesh position={position}><planeGeometry args={[size, size]} /><meshBasicMaterial map={texture} transparent depthWrite={false} /></mesh>
}

function MysteryCube({ position, value, index, moving, found }: { position: Vec3; value: string; index: number; moving: boolean; found: boolean }) {
  const group = useRef<Group>(null)
  useFrame(({ clock }) => {
    if (!group.current) return
    group.current.position.y = position[1] + (moving ? Math.sin(clock.elapsedTime * 1.7 + index) * .09 : 0)
    group.current.rotation.y = moving ? Math.sin(clock.elapsedTime * .5 + index) * .09 : 0
  })
  return <group ref={group} position={position}>
    <Block scale={[.79, .79, .79]} color={found ? '#d0f078' : index % 2 ? '#ffe6ad' : '#f7b599'} rotation={[0, 0, -.035]} />
    <FaceLabel value={value} position={[0, 0, .402]} size={.69} />
  </group>
}

function NumberWorld({ state, players, me, reducedMotion }: WorldProps) {
  const digits = Math.max(1, Math.min(8, Number(state.digits) || 4))
  const revealed = state.finished && Array.isArray(state.targets) && state.targets.length ? String(state.targets[0]).padStart(digits, '0') : ''
  const claimed = Math.max(0, Number(state.claimedTargets) || 0)
  const guesses = Number(state.guessCount?.[me]) || 0
  return <>
    <Island radius={5} />
    <Island radius={1.1} grass="#b6ddb0" rock="#cab399" position={[-6.6, 1.5, -3.9]} />
    <Island radius={.8} grass="#c3e6ab" position={[6.2, .8, -4]} />
    <Ring radius={3.6} color="#d5e5ad" />
    <Tree position={[-3.2, 0, -1.7]} size={1.2} />
    <Tree position={[3.1, 0, -1.8]} size={1.1} color="#d9b0df" />
    <Tree position={[4, 0, .4]} size={.7} />
    <Tree position={[-4.1, 0, .6]} size={.7} color="#a5d78c" />
    <Crystal position={[-3, 0, 2]} color="#67d1c7" scale={.7} />
    <Crystal position={[3.1, 0, 2.4]} color="#edc573" scale={.6} />
    <Character position={[0, 0, 2.3]} fox color="#ed965c" action={guesses} moving={!reducedMotion} celebrate={claimed > 0 && Boolean(state.finished)} scale={1.35} />
    {Array.from({ length: digits }, (_, i) => <MysteryCube key={i} position={[(i - (digits - 1) / 2) * .95, 1.7, -.5]} value={revealed[i] || '?'} index={i} moving={!reducedMotion} found={Boolean(revealed)} />)}
    {players.filter(player => player !== me).slice(0, 3).map((player, i) => <Character key={player} position={[-2.8 + i * 2.8, 0, -2.7]} color={COLORS[i + 1]} scale={.65} moving={!reducedMotion} />)}
    {Array.from({ length: Math.min(8, claimed) }, (_, i) => <Crystal key={i} position={[(i - (Math.min(8, claimed) - 1) / 2) * .6, 0, 3.8]} scale={.38} color="#f8d26e" />)}
    <Cloud position={[-5, -1.6, 3]} size={1.4} moving={!reducedMotion} /><Cloud position={[5.5, -.9, 1.5]} size={1.1} moving={!reducedMotion} /><Cloud position={[0, 2.6, -7]} size={1.2} moving={!reducedMotion} />
  </>
}

function Golem({ health, maximum, hits, slain, moving, onAttack }: { health: number; maximum: number; hits: number; slain: boolean; moving: boolean; onAttack?: () => void }) {
  const body = useRef<Group>(null)
  const core = useRef<Mesh>(null)
  const healthBefore = useRef(health)
  const hitPulse = useRef(0)
  useEffect(() => { if (health < healthBefore.current) hitPulse.current = 1; healthBefore.current = health }, [health, hits])
  useFrame(({ clock }, delta) => {
    if (!body.current || !core.current) return
    hitPulse.current = Math.max(0, hitPulse.current - delta * 2.5)
    if (moving) {
      body.current.position.y = Math.sin(clock.elapsedTime * 1.5) * .07
      body.current.rotation.z = Math.sin(hitPulse.current * 32) * hitPulse.current * .04
      core.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 2) * .06 + hitPulse.current * .13)
    }
    body.current.rotation.x = MathUtils.damp(body.current.rotation.x, slain ? -.65 : 0, 4, delta)
  })
  const healthRatio = maximum > 0 ? Math.max(0, Math.min(1, health / maximum)) : 1
  return <group position={[0, 0, -.7]} onClick={event => { event.stopPropagation(); if (!slain) onAttack?.() }}>
    <BlobShadow size={1.8} />
    <group ref={body}>
      <mesh position={[0, 1.75, 0]} scale={[1.2, 1.55, .85]}><icosahedronGeometry args={[1, 0]} /><meshStandardMaterial color={slain ? '#827b9a' : '#9074cc'} roughness={.65} /></mesh>
      <mesh position={[0, 3.1, 0]} scale={[.8, .65, .65]}><dodecahedronGeometry args={[1, 0]} /><meshStandardMaterial color="#ad91e2" /></mesh>
      {[-1, 1].map(side => <group key={side}>
        <mesh position={[side * 1.33, 1.9, 0]} scale={[.58, 1.05, .58]} rotation={[0, 0, side * .3]}><icosahedronGeometry args={[1, 0]} /><meshStandardMaterial color="#a487d4" /></mesh>
        <mesh position={[side * .68, .51, 0]} scale={[.49, .57, .62]}><dodecahedronGeometry args={[1, 0]} /><meshStandardMaterial color="#8269b5" /></mesh>
        <Sphere position={[side * .28, 3.15, .55]} scale={[.16, .07, .06]} color={slain ? '#5c516f' : '#a5f5df'} />
        <Crystal position={[side * .52, 3.53, -.03]} scale={.55} color="#c7acf5" />
      </group>)}
      <mesh ref={core} position={[0, 1.87, .87]}><octahedronGeometry args={[.46, 0]} /><meshStandardMaterial color="#ffe494" emissive="#ffd073" emissiveIntensity={slain ? .1 : .35} roughness={.27} metalness={.2} /></mesh>
    </group>
    <group position={[-1.3, 4.32, 0]}>
      <Block position={[1.3, 0, 0]} scale={[2.7, .14, .12]} color="#453662" />
      {healthRatio > 0 && <Block position={[1.3 * healthRatio, 0, .08]} scale={[2.6 * healthRatio, .11, .05]} color="#bce983" />}
    </group>
  </group>
}

function playerTeam(teams: any, player: string, index: number): number {
  if (!teams) return index < 3 ? 0 : 1
  if (Array.isArray(teams)) return teams.findIndex(team => Array.isArray(team) ? team.includes(player) : team?.players?.includes(player)) === 1 ? 1 : 0
  const direct = teams[player]
  if (direct !== undefined) return ['b', 'B', 'team-b', 'blue', 1].includes(direct) ? 1 : 0
  return Object.values(teams).findIndex(team => Array.isArray(team) && team.includes(player)) === 1 ? 1 : 0
}

function BossWorld({ state, players, me, reducedMotion, onAttack }: WorldProps) {
  const participants = players.slice(0, 6)
  const hits = Object.values(state.hits ?? {}).reduce<number>((sum, value) => sum + (Number(value) || 0), 0)
  return <>
    <Island radius={5.7} grass="#726496" rock="#a58bb4" />
    <Ring radius={4.8} color="#cab3e2" opacity={.7} /><Ring radius={2.3} color="#dec793" opacity={.9} />
    <Golem health={Number(state.bossHealth) || 0} maximum={Number(state.bossHealthMax) || 1} hits={hits} slain={Boolean(state.slain)} moving={!reducedMotion} onAttack={onAttack} />
    {participants.map((player, index) => {
      const team = playerTeam(state.teams, player, index)
      const withinSide = participants.slice(0, index).filter((other, i) => playerTeam(state.teams, other, i) === team).length
      const x = team ? 3.7 : -3.7
      const z = -.9 + withinSide * 1.55
      return <group key={player}>
        <Ring position={[x, .025, z]} radius={.6} color={team ? '#7ae0e5' : '#ffb390'} opacity={player === me ? 1 : .55} />
        <Character position={[x, 0, z]} color={team ? '#66cad2' : '#eea182'} facing={team ? -.7 : .7} moving={!reducedMotion} celebrate={Boolean(state.slain)} action={Number(state.hits?.[player]) || 0} scale={player === me ? 1.05 : .85} />
      </group>
    })}
    {[-1, 1].map(side => <group key={side}>
      <Crystal position={[side * 4.1, 0, -3.6]} scale={1.6} color="#bd9beb" /><Crystal position={[side * 5.1, 0, -.8]} scale={.7} color="#73ccd4" /><Crystal position={[side * 2.5, 0, 3.9]} scale={.65} color="#e5c37f" />
      <Cloud position={[side * 6, -1.5, 1.5]} size={1.3} moving={!reducedMotion} />
    </group>)}
    <Cloud position={[0, .4, -7]} size={1.7} moving={!reducedMotion} />
  </>
}

function FallingToken({ spawn, x, nowMs, windowMs, moving, onCatch }: { spawn: { index: number; points: number; atMs: number }; x: number; nowMs: number; windowMs: number; moving: boolean; onCatch?: (index: number) => void }) {
  const token = useRef<Group>(null)
  const arrival = useRef(performance.now())
  useEffect(() => { arrival.current = performance.now() }, [nowMs, spawn.index])
  const age = Math.max(0, nowMs - spawn.atMs)
  useFrame(({ clock }) => {
    if (!token.current) return
    const displayAge = moving ? age + Math.min(windowMs, performance.now() - arrival.current) : age
    token.current.position.y = 1.9 - Math.min(1, displayAge / windowMs) * 1.15
    token.current.visible = displayAge <= windowMs
    token.current.rotation.y = moving ? clock.elapsedTime * 2 : .3
  })
  const hazard = spawn.points < 0
  return <group ref={token} position={[x, 1.5, .9]} onClick={event => { event.stopPropagation(); if (age + performance.now() - arrival.current <= windowMs) onCatch?.(spawn.index) }}>
    {hazard ? <mesh><icosahedronGeometry args={[.31, 0]} /><meshStandardMaterial color="#ec6979" roughness={.6} /></mesh> : <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.29, .29, .09, 16]} /><meshStandardMaterial color={spawn.points > 1 ? '#fff2ae' : '#f6c85e'} metalness={.38} roughness={.34} /></mesh>}
    <FaceLabel position={[0, 0, .31]} value={hazard ? '!' : '+'} size={.39} color={hazard ? '#fff0df' : '#a56b32'} />
  </group>
}

function CatchReaction({ score, position, moving }: { score: number; position: Vec3; moving: boolean }) {
  const ring = useRef<Mesh>(null)
  const material = useRef<MeshBasicMaterial>(null)
  const previous = useRef(score)
  const life = useRef(0)
  useEffect(() => {
    if (score !== previous.current && moving) {
      material.current?.color.set(score > previous.current ? '#d4ee75' : '#f0788a')
      life.current = .7
    }
    previous.current = score
  }, [score, moving])
  useFrame((_, delta) => {
    if (!ring.current || !material.current) return
    life.current = Math.max(0, life.current - delta)
    ring.current.visible = life.current > 0 && moving
    ring.current.scale.setScalar(1 + (.7 - life.current) * 1.8)
    material.current.opacity = life.current
  })
  return <mesh ref={ring} position={position} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
    <ringGeometry args={[.48, .61, 32]} /><meshBasicMaterial ref={material} color="#d4ee75" transparent opacity={0} depthWrite={false} />
  </mesh>
}

function CatchWorld({ state, me, reducedMotion, onLane, onCatch }: WorldProps) {
  const lanes = Math.max(1, Math.min(8, Number(state.lanes) || 3))
  const width = Math.min(1.65, 9 / lanes)
  const laneX = (index: number) => (index - (lanes - 1) / 2) * width
  const currentLane = Math.max(0, Math.min(lanes - 1, Number(state.lanesNow?.[me]) || 0))
  const score = Number(state.scores?.[me]) || 0
  const nowMs = Number(state.nowMs) || 0
  const windowMs = Math.max(1, Number(state.catchWindowMs) || 1000)
  // Never generate decorative gameplay tokens or read the committed future stream.
  const recent = Array.isArray(state.recent) ? state.recent.filter((spawn: any) => Number.isInteger(spawn.index) && spawn.lane >= 0 && spawn.lane < lanes && spawn.atMs <= nowMs && nowMs - spawn.atMs <= windowMs) : []
  return <>
    <Island radius={5.6} grass="#b3e4cc" rock="#e7c69a" />
    {Array.from({ length: lanes }, (_, lane) => <group key={lane}>
      <mesh position={[laneX(lane), .025, -.1]} onClick={event => { event.stopPropagation(); if (!state.finished) onLane?.(lane) }}>
        <boxGeometry args={[width * .93, .08, 6.5]} /><meshStandardMaterial color={lane === currentLane ? '#f9e7a1' : lane % 2 ? '#69c9c5' : '#91ded3'} roughness={.9} />
      </mesh>
      <Ring position={[laneX(lane), .09, 2.15]} radius={width * .35} color={lane === currentLane ? '#fff8d2' : '#d8f5e5'} />
      {[-2.7, -1.5, -.3, .9].map(z => <Block key={z} position={[laneX(lane), .085, z]} scale={[.04, .012, .44]} color="#d9f8eb" />)}
      <Block position={[laneX(lane), .16, -3.3]} scale={[width * .95, .24, .26]} color="#ffe9b0" />
    </group>)}
    <Character position={[laneX(currentLane), .1, 2.1]} fox color="#ed985f" moving={!reducedMotion} basket action={score} celebrate={Boolean(state.finished) && score > 0} scale={.95} />
    <CatchReaction score={score} position={[laneX(currentLane), .12, 2.1]} moving={!reducedMotion} />
    {recent.map((spawn: any) => <FallingToken key={spawn.index} spawn={spawn} x={laneX(spawn.lane)} nowMs={nowMs} windowMs={windowMs} moving={!reducedMotion} onCatch={state.finished ? undefined : onCatch} />)}
    <Tree position={[-4.2, 0, -1.7]} color="#57bfa4" size={.85} /><Tree position={[4.2, 0, -1.6]} color="#a5d487" size={.85} />
    <Crystal position={[-4, 0, 2]} color="#f4c778" scale={.7} /><Crystal position={[4, 0, 2.1]} color="#67cec9" scale={.7} />
    <Cloud position={[-6, -1.2, 2]} size={1.5} moving={!reducedMotion} /><Cloud position={[5.8, -.6, .8]} size={1.2} moving={!reducedMotion} /><Cloud position={[0, 2.5, -6.7]} size={1.1} moving={!reducedMotion} />
  </>
}

function ChoiceTotem({ choice, position, sealed, moving }: { choice?: string; position: Vec3; sealed: boolean; moving: boolean }) {
  const group = useRef<Group>(null)
  useFrame(({ clock }) => { if (group.current && moving) group.current.position.y = position[1] + Math.sin(clock.elapsedTime * 1.6 + position[0]) * .08 })
  return <group ref={group} position={position}>
    <mesh rotation={[0, .4, 0]}><dodecahedronGeometry args={[.59, 0]} /><meshStandardMaterial color={sealed ? '#d1c0ed' : '#ffe1a3'} metalness={.12} roughness={.45} /></mesh>
    {sealed || !choice ? <FaceLabel value="?" position={[0, 0, .59]} size={.5} /> : choice === 'rock' ? <mesh position={[0, 0, .53]} scale={[.4, .3, .15]}><icosahedronGeometry args={[1, 0]} /><meshStandardMaterial color="#8c86a4" /></mesh> : choice === 'paper' ? <Block position={[0, 0, .56]} scale={[.44, .5, .07]} color="#fff7e4" rotation={[0, 0, -.15]} /> : choice === 'scissors' ? <group position={[0, 0, .55]}><Block scale={[.06, .58, .06]} color="#6b8799" rotation={[0, 0, .5]} /><Block scale={[.06, .58, .06]} color="#6b8799" rotation={[0, 0, -.5]} /></group> : <FaceLabel value={choice === 'lizard' ? 'L' : 'S'} position={[0, 0, .59]} size={.5} />}
  </group>
}

function DuelWorld({ state, players, me, reducedMotion }: WorldProps) {
  const duelPlayers: string[] = Array.isArray(state.players) ? state.players.slice(0, 2) : players.slice(0, 2)
  const history = Array.isArray(state.history) ? state.history : []
  const last = history.at(-1)
  // A completed history row is the only source for visible choices, never pending/local choices.
  const showOutcome = Boolean(last) && (state.phase === 'done' || Number(last.round) === Number(state.roundIndex))
  const winner = last?.outcome?.split(':')[0]
  return <>
    <Island radius={5.2} grass="#bdadc9" rock="#bb9bb8" />
    <mesh position={[-2.3, .02, .05]}><cylinderGeometry args={[2.2, 2.15, .12, 24]} /><meshStandardMaterial color="#efb39b" roughness={.85} /></mesh>
    <mesh position={[2.3, .02, .05]}><cylinderGeometry args={[2.2, 2.15, .12, 24]} /><meshStandardMaterial color="#b9a2e0" roughness={.85} /></mesh>
    <Ring radius={4.8} color="#f8d58e" /><Ring position={[-2.3, .1, .05]} radius={1.9} color="#ffe6c0" /><Ring position={[2.3, .1, .05]} radius={1.9} color="#dfcffa" />
    <Block position={[0, .05, 0]} scale={[.13, .15, 8]} color="#f6d48f" />
    <Crystal position={[0, .1, -3.3]} color="#ffe498" scale={1.35} />
    {duelPlayers.map((player, i) => <group key={player}>
      <Character position={[i ? 2.3 : -2.3, .1, 1.2]} color={i ? '#a48ace' : '#ee9a78'} fox={i === 0} facing={i ? -.3 : .3} scale={1.2} moving={!reducedMotion} action={Number(state.wins?.[player]) || 0} celebrate={Boolean(state.finished) && winner === player} />
      <ChoiceTotem position={[i ? 2.3 : -2.3, 1.8, -1.5]} sealed={!showOutcome} choice={showOutcome ? last?.[i ? 'b' : 'a'] : undefined} moving={!reducedMotion} />
      <Ring position={[i ? 2.3 : -2.3, .115, 1.2]} radius={.8} color={player === me ? '#fff0b4' : '#f0deef'} />
      {last && !showOutcome && <group position={[i ? 3.7 : -3.7, .65, 2.3]} scale={.6}>
        <ChoiceTotem position={[0, .35, 0]} sealed={false} choice={last[i ? 'b' : 'a']} moving={false} />
        <FaceLabel value={`R${Number(last.round) + 1}`} position={[0, -.25, .6]} size={.55} />
      </group>}
    </group>)}
    <Crystal position={[-4.15, 0, -1.9]} color="#f7c49b" scale={.7} /><Crystal position={[4.15, 0, -1.9]} color="#c8a8ed" scale={.7} />
    <Cloud position={[-5.5, -1, 2]} size={1.3} moving={!reducedMotion} /><Cloud position={[5.5, -1, 1]} size={1.3} moving={!reducedMotion} /><Cloud position={[0, 2.7, -7]} size={1.1} moving={!reducedMotion} />
  </>
}

function CameraRig({ arena = false, width = 20, depth = 16 }: { arena?: boolean; width?: number; depth?: number }) {
  const { camera, size } = useThree()
  useEffect(() => {
    if (arena) return // ArenaWorld owns its perspective follow camera every frame.
    const aspect = size.width / Math.max(1, size.height)
    const z = arena ? Math.max(depth * 1.75, width * 1.22 / Math.max(.55, aspect)) : Math.max(14.5, 12.7 / Math.max(.7, aspect))
    camera.position.set(0, z * (arena ? .90 : .59), z)
    camera.lookAt(0, .55, -.1)
    camera.updateProjectionMatrix()
  }, [camera, size.width, size.height, arena, width, depth])
  return null
}

function RendererLifecycle({ onContextLost }: { onContextLost: () => void }) {
  const { gl } = useThree()
  useEffect(() => {
    const canvas = gl.domElement
    const lost = (event: Event) => { event.preventDefault(); onContextLost() }
    canvas.addEventListener('webglcontextlost', lost)
    return () => canvas.removeEventListener('webglcontextlost', lost)
  }, [gl, onContextLost])
  return null
}

export default function WorldScene({ active, fallback, onContextLost, onReady, ...props }: SceneProps) {
  const background = props.game === 'boss-raid' ? '#c5b9e0' : props.game === 'reaction-duel' ? '#f2d6ce' : props.game === 'token-catch' ? '#b5e9e5' : '#c0e6df'
  const scenes = { 'number-hunt': NumberWorld, 'boss-raid': BossWorld, 'token-catch': CatchWorld, 'reaction-duel': DuelWorld, 'combat-duel': ArenaWorld }
  const GameScene = scenes[props.game]
  return <Canvas
    aria-hidden="true"
    dpr={[1, 1.5]}
    camera={{ position: [0, 3, 6], fov: props.state.arena ? 58 : 39, near: .08, far: 140 }}
    frameloop={active ? props.reducedMotion && !props.state.arena ? 'demand' : 'always' : 'never'}
    gl={{ antialias: true, alpha: false, powerPreference: 'default' }}
    fallback={fallback}
    shadows={false}
    onCreated={({ camera }) => { camera.lookAt(0, .55, 0); onReady() }}
  >
    <color attach="background" args={[background]} />
    <fog attach="fog" args={[background, props.state.arena ? 30 : 25, props.state.arena ? 85 : 48]} />
    <ambientLight intensity={1.25} />
    <hemisphereLight args={['#fff8e8', '#7988b3', 1.5]} />
    <directionalLight position={[-4, 9, 6]} intensity={2.1} color="#fff2df" />
    <directionalLight position={[6, 5, -4]} intensity={1.3} color="#dedaff" />
    <CameraRig arena={Boolean(props.state.arena)} width={Number(props.state.bounds?.width) || 20} depth={Number(props.state.bounds?.depth) || 16} /><RendererLifecycle onContextLost={onContextLost} />
    {props.state.arena ? <ArenaWorld {...props} /> : <GameScene {...props} reducedMotion={props.reducedMotion ?? false} />}
  </Canvas>
}
