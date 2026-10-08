import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CanvasTexture, ConeGeometry, CylinderGeometry, ExtrudeGeometry, Group, IcosahedronGeometry, MathUtils, Matrix4, Mesh, MeshStandardMaterial, Shape, SphereGeometry, SRGBColorSpace, TorusGeometry, type BufferGeometry } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { GameWorldProps } from './GameWorld'

type Props = { state: GameWorldProps['state']; reducedMotion?: boolean }
type Vec3 = [number, number, number]
type PieceProps = { geometry: BufferGeometry; material: MeshStandardMaterial; position?: Vec3; scale?: Vec3; rotation?: Vec3 }
const finite = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
export const GUARDIAN_GEOMETRY_INSTANCES = { box: 38, joint: 16, rock: 7, crystal: 2, cylinder: 9, cone: 16, torus: 4, plate: 8 }

function Piece({ geometry, material, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0] }: PieceProps) {
  return <mesh geometry={geometry} material={material} position={position} scale={scale} rotation={rotation} castShadow receiveShadow />
}

/** Original carved crystal guardian. Visual pose follows published state; no gameplay simulation. */
export default function GuardianModel({ state, reducedMotion = false }: Props) {
  const root = useRef<Group>(null), chest = useRef<Group>(null), head = useRef<Group>(null)
  const leftArm = useRef<Group>(null), rightArm = useRef<Group>(null), core = useRef<Group>(null)
  const previousHp = useRef<number | null>(null), hitAt = useRef(-Infinity), deadAt = useRef<number | null>(null)
  const received = useRef(performance.now())
  const assets = useMemo(() => {
    const box = new RoundedBoxGeometry(1, 1, 1, 1, .12)
    const joint = new SphereGeometry(1, 10, 8)
    const rock = new IcosahedronGeometry(1, 1)
    const crystal = new IcosahedronGeometry(1, 0)
    const cylinder = new CylinderGeometry(1, 1, 1, 8, 1)
    const cone = new ConeGeometry(1, 1, 7, 1)
    const torus = new TorusGeometry(1, .13, 5, 20)
    const shield = new Shape()
    shield.moveTo(-.45, .42); shield.lineTo(.45, .42); shield.lineTo(.50, -.10)
    shield.lineTo(.20, -.45); shield.lineTo(0, -.55); shield.lineTo(-.20, -.45)
    shield.lineTo(-.50, -.10); shield.closePath()
    const plate = new ExtrudeGeometry(shield, { depth: .13, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .05, bevelThickness: .035 })
    // Deterministic 256px surface grain, scratches and seams; no downloaded maps.
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256
    const context = canvas.getContext('2d')!
    const pixels = context.createImageData(256, 256)
    let seed = 17031
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
    for (let pixel = 0; pixel < 256 * 256; pixel++) {
      const tone = 146 + Math.round(random() * 62)
      pixels.data[pixel * 4] = tone; pixels.data[pixel * 4 + 1] = tone
      pixels.data[pixel * 4 + 2] = tone; pixels.data[pixel * 4 + 3] = 255
    }
    context.putImageData(pixels, 0, 0)
    for (let line = 0; line < 70; line++) {
      const x = random() * 256, y = random() * 256
      context.strokeStyle = `rgba(32,39,45,${.12 + random() * .18})`; context.lineWidth = .5 + random() * 1.1
      context.beginPath(); context.moveTo(x, y); context.lineTo(x + random() * 23 - 10, y + random() * 18); context.stroke()
    }
    const colorMap = new CanvasTexture(canvas); colorMap.colorSpace = SRGBColorSpace
    const bumpMap = new CanvasTexture(canvas)
    const stone = new MeshStandardMaterial({ color: '#777f8c', map: colorMap, bumpMap, bumpScale: .027, roughness: .90, metalness: .07, emissive: '#56384b', emissiveIntensity: 0 })
    const pale = new MeshStandardMaterial({ color: '#b1ad9c', map: colorMap, bumpMap, bumpScale: .020, roughness: .86, metalness: .12, emissive: '#56384b', emissiveIntensity: 0 })
    const metal = new MeshStandardMaterial({ color: '#544737', roughness: .43, metalness: .77 })
    const bronze = new MeshStandardMaterial({ color: '#af8b52', roughness: .40, metalness: .82 })
    const dark = new MeshStandardMaterial({ color: '#20272b', roughness: .83, metalness: .30 })
    const glow = new MeshStandardMaterial({ color: '#91ffe4', emissive: '#31d8ba', emissiveIntensity: 1.45, roughness: .22, metalness: .28 })
    const coreMaterial = new MeshStandardMaterial({ color: '#c3ffdf', emissive: '#47e4c2', emissiveIntensity: 1.2, roughness: .16, metalness: .35 })
    return { box, joint, rock, crystal, cylinder, cone, torus, plate, stone, pale, metal, bronze, dark, glow, coreMaterial, colorMap, bumpMap }
  }, [])
  useEffect(() => () => {
    for (const geometry of [assets.box, assets.joint, assets.rock, assets.crystal, assets.cylinder, assets.cone, assets.torus, assets.plate]) geometry.dispose()
    for (const material of [assets.stone, assets.pale, assets.metal, assets.bronze, assets.dark, assets.glow, assets.coreMaterial]) material.dispose()
    assets.colorMap.dispose(); assets.bumpMap.dispose()
  }, [assets])
  const hasBoss = !!state.boss
  useLayoutEffect(() => {
    if (!hasBoss || !root.current) return
    // Keep joints animated while merging all static shapes by material per joint.
    // This preserves articulated anatomy without one draw call for every finger.
    const bones = [root.current, chest.current, head.current, leftArm.current, rightArm.current, core.current].filter((value): value is Group => !!value)
    const boundaries = new Set(bones), owned: { parent: Group; mesh: Mesh; originals: Mesh[] }[] = []
    root.current.updateMatrixWorld(true)
    for (const bone of bones) {
      const materials = new Map<MeshStandardMaterial, { geometries: BufferGeometry[]; originals: Mesh[] }>()
      const inverse = new Matrix4().copy(bone.matrixWorld).invert()
      const visit = (object: Group | Mesh) => {
        if (object !== bone && boundaries.has(object as Group)) return
        if (object instanceof Mesh && !Array.isArray(object.material)) {
          const material = object.material as MeshStandardMaterial
          const entry = materials.get(material) ?? { geometries: [], originals: [] }
          const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone()
          geometry.applyMatrix4(new Matrix4().multiplyMatrices(inverse, object.matrixWorld))
          entry.geometries.push(geometry); entry.originals.push(object); materials.set(material, entry)
        }
        for (const child of object.children) visit(child as Group | Mesh)
      }
      visit(bone)
      for (const [material, entry] of materials) {
        const merged = mergeGeometries(entry.geometries, false)
        entry.geometries.forEach(geometry => geometry.dispose())
        if (!merged) continue
        const mesh = new Mesh(merged, material); mesh.castShadow = mesh.receiveShadow = true
        entry.originals.forEach(original => { original.visible = false })
        bone.add(mesh); owned.push({ parent: bone, mesh, originals: entry.originals })
      }
    }
    return () => { for (const entry of owned) { entry.parent.remove(entry.mesh); entry.mesh.geometry.dispose(); entry.originals.forEach(original => { original.visible = true }) } }
  }, [assets, hasBoss])
  useEffect(() => { received.current = performance.now() }, [state.nowMs])
  useEffect(() => {
    const hp = finite(state.boss?.hp)
    if (previousHp.current !== null && hp < previousHp.current) hitAt.current = performance.now()
    previousHp.current = hp
    if (state.boss && hp <= 0 && deadAt.current === null) deadAt.current = performance.now()
    if (hp > 0) deadAt.current = null
  }, [state.boss, state.boss?.hp])
  useFrame(({ clock }, delta) => {
    if (!root.current || !state.boss) return
    const boss = state.boss, wallNow = performance.now(), elapsed = finite(state.nowMs) + (state.finished ? 0 : Math.min(250, wallNow - received.current))
    const attacks = Array.isArray(state.attacks) ? state.attacks : []
    let attack: Record<string, any> | undefined
    for (let index = attacks.length - 1; index >= 0; index--) {
      if (elapsed < finite(attacks[index].expiresAt) && elapsed >= finite(attacks[index].warnAt)) { attack = attacks[index]; break }
    }
    const warning = !!attack && elapsed < finite(attack.hitAt)
    const wind = warning ? MathUtils.clamp((elapsed - finite(attack!.warnAt)) / Math.max(1, finite(attack!.hitAt) - finite(attack!.warnAt)), 0, 1) : 0
    const impact = attack && !warning ? Math.max(0, 1 - (elapsed - finite(attack.hitAt)) / 420) : 0
    const dead = deadAt.current !== null ? reducedMotion ? 1 : MathUtils.clamp((wallNow - deadAt.current) / 1250, 0, 1) : 0
    const hit = Math.max(0, 1 - (wallNow - hitAt.current) / 260)
    const breath = reducedMotion || dead > 0 ? 0 : Math.sin(clock.elapsedTime * 1.5) * .018
    root.current.position.set(finite(boss.x), finite(boss.y), finite(boss.z))
    const yawDifference = Math.atan2(Math.sin(finite(boss.yaw) - root.current.rotation.y), Math.cos(finite(boss.yaw) - root.current.rotation.y))
    root.current.rotation.y += yawDifference * (1 - Math.exp(-12 * delta))
    root.current.rotation.x = MathUtils.damp(root.current.rotation.x, dead * 1.30, 8, delta)
    root.current.position.y -= dead * .20
    if (chest.current) {
      chest.current.position.y = 1.72 + breath - (warning && attack?.kind === 'slam' ? wind * .15 : 0)
      chest.current.rotation.z = reducedMotion ? 0 : Math.sin(wallNow * .045) * hit * .017
      chest.current.rotation.x = MathUtils.damp(chest.current.rotation.x, impact * .17 - wind * .08, 12, delta)
    }
    let left = .08, right = -.08
    if (warning) {
      if (attack?.kind === 'slam') { left = right = -2.05 * wind }
      else if (attack?.kind === 'wave') { left = -.35 - wind * .8; right = -.35 - wind * .8 }
      else if (attack?.kind === 'beam') { right = -1.50 * wind; left = -.40 * wind }
      else { left = -1.85 * wind; right = -.9 * wind }
    } else if (impact > 0) { left = .25 * impact; right = .45 * impact }
    for (const [arm, target] of [[leftArm.current, left], [rightArm.current, right]] as const) if (arm) arm.rotation.x = reducedMotion ? target : MathUtils.damp(arm.rotation.x, target + breath * 2, 11, delta)
    if (head.current) head.current.rotation.x = MathUtils.damp(head.current.rotation.x, warning ? -.07 : breath * 2, 8, delta)
    const glow = dead > 0 ? 1 - dead : warning ? 1.2 + wind * 1.2 : 1
    assets.glow.emissiveIntensity = 1.4 * glow; assets.coreMaterial.emissiveIntensity = 1.2 * glow
    assets.stone.emissiveIntensity = assets.pale.emissiveIntensity = reducedMotion ? 0 : hit * .7
    if (core.current) { core.current.rotation.y = reducedMotion ? 0 : clock.elapsedTime * .30; core.current.scale.setScalar(1 + (reducedMotion ? 0 : Math.sin(clock.elapsedTime * 2.5) * .03)) }
  })
  if (!state.boss) return null
  const a = assets
  const arm = (side: number) => <group ref={side < 0 ? leftArm : rightArm} position={[side * 1.04, 2.70, 0]} key={side}>
    <Piece geometry={a.joint} material={a.dark} scale={[.28, .28, .28]} />
    <Piece geometry={a.rock} material={side < 0 ? a.pale : a.stone} position={[side * .06, -.35, 0]} scale={[.34, .45, .33]} rotation={[0, 0, side * .08]} />
    <Piece geometry={a.plate} material={a.bronze} position={[side * .08, -.27, .28]} scale={[.48, .48, .7]} />
    <Piece geometry={a.joint} material={a.metal} position={[side * .10, -.72, 0]} scale={[.22, .22, .22]} />
    <Piece geometry={a.box} material={a.stone} position={[side * .12, -1.03, .06]} scale={[.47, .59, .49]} rotation={[.06, 0, side * .08]} />
    <Piece geometry={a.torus} material={a.bronze} position={[side * .12, -.80, .06]} scale={[.24, .24, .24]} rotation={[Math.PI / 2, 0, 0]} />
    <Piece geometry={a.box} material={a.pale} position={[side * .13, -1.43, .11]} scale={[.43, .36, .30]} />
    {[0, 1, 2, 3].map(index => <group key={index} position={[side * .13 + (index - 1.5) * .102, -1.61, .12]} rotation={[-.22, 0, 0]}>
      <Piece geometry={a.cylinder} material={a.stone} position={[0, -.11, 0]} scale={[.053, .22, .053]} />
      <Piece geometry={a.joint} material={a.bronze} position={[0, -.21, 0]} scale={[.057, .057, .057]} />
      <Piece geometry={a.cone} material={a.metal} position={[0, -.29, .045]} scale={[.056, .20, .055]} rotation={[Math.PI + .3, 0, 0]} />
    </group>)}
    <Piece geometry={a.box} material={a.pale} position={[side * -.15, -1.48, .29]} scale={[.13, .22, .16]} rotation={[0, 0, -side * .40]} />
    <Piece geometry={a.box} material={a.glow} position={[side * .12, -1.03, .315]} scale={[.09, .34, .026]} rotation={[0, 0, side * .10]} />
  </group>
  return <group ref={root} position={[finite(state.boss.x), finite(state.boss.y), finite(state.boss.z)]} dispose={null}>
    {[-1, 1].map(side => <group key={`leg-${side}`} position={[side * .43, 0, 0]}>
      <Piece geometry={a.box} material={a.dark} position={[0, .18, .14]} scale={[.61, .36, .90]} />
      <Piece geometry={a.box} material={a.stone} position={[0, .61, 0]} scale={[.48, .61, .49]} />
      <Piece geometry={a.plate} material={a.pale} position={[0, .75, .24]} scale={[.43, .47, .7]} />
      <Piece geometry={a.joint} material={a.metal} position={[0, .98, 0]} scale={[.23, .23, .23]} />
      <Piece geometry={a.rock} material={a.stone} position={[0, 1.26, 0]} scale={[.36, .37, .37]} />
      <Piece geometry={a.box} material={a.glow} position={[0, .54, .27]} scale={[.065, .28, .018]} />
      <Piece geometry={a.box} material={a.bronze} position={[0, .20, .60]} scale={[.49, .085, .055]} />
    </group>)}
    <Piece geometry={a.box} material={a.metal} position={[0, 1.48, 0]} scale={[1.19, .38, .79]} />
    <Piece geometry={a.plate} material={a.bronze} position={[0, 1.46, .40]} scale={[.52, .35, .75]} />
    <group ref={chest} position={[0, 1.72, 0]}>
      <Piece geometry={a.rock} material={a.stone} position={[0, .67, 0]} scale={[.87, .81, .58]} />
      <Piece geometry={a.box} material={a.dark} position={[0, .07, 0]} scale={[.97, .37, .73]} />
      {[0, 1, 2].map(index => <Piece key={`abdomen-${index}`} geometry={a.box} material={a.pale} position={[0, .15 + index * .15, .42]} scale={[.59 - index * .04, .13, .14]} />)}
      {[-1, 1].map(side => <group key={`chest-${side}`}>
        <Piece geometry={a.plate} material={a.pale} position={[side * .36, .79, .45]} scale={[.73, .64, 1]} rotation={[0, side * .14, side * -.12]} />
        <Piece geometry={a.rock} material={side < 0 ? a.bronze : a.pale} position={[side * .90, .98, 0]} scale={[.51, .31, .54]} />
        {[0, 1, 2].map(index => <Piece key={`spike-${index}`} geometry={a.cone} material={side < 0 ? a.bronze : a.stone} position={[side * (.82 + index * .15), 1.24 + index * .012, -.13 + index * .09]} scale={[.075, .28 - index * .035, .085]} rotation={[.10, 0, side * -.38]} />)}
        <Piece geometry={a.box} material={a.glow} position={[side * .54, .83, .65]} scale={[.22, .035, .025]} rotation={[0, side * .10, side * -.28]} />
      </group>)}
      <Piece geometry={a.torus} material={a.bronze} position={[0, .79, .75]} scale={[.39, .39, .24]} />
      <Piece geometry={a.torus} material={a.dark} position={[0, .79, .70]} scale={[.43, .43, .28]} />
      <group ref={core} position={[0, .79, .78]}><Piece geometry={a.crystal} material={a.coreMaterial} scale={[.26, .32, .21]} /></group>
      {[0, 1, 2, 3].map(index => <Piece key={`core-clamp-${index}`} geometry={a.box} material={a.bronze} position={[Math.sin(index * Math.PI / 2) * .37, .79 + Math.cos(index * Math.PI / 2) * .37, .79]} scale={[.085, .16, .065]} rotation={[0, 0, -index * Math.PI / 2]} />)}
    </group>
    {[-1, 1].map(arm)}
    <Piece geometry={a.cylinder} material={a.dark} position={[0, 3.0, 0]} scale={[.20, .29, .20]} />
    <group ref={head} position={[0, 3.35, .015]}>
      <Piece geometry={a.box} material={a.stone} scale={[.82, .67, .73]} />
      <Piece geometry={a.plate} material={a.pale} position={[0, .02, .35]} scale={[.58, .43, .55]} />
      <Piece geometry={a.box} material={a.dark} position={[0, .10, .44]} scale={[.55, .13, .05]} />
      {[-1, 1].map(side => <group key={`face-${side}`}>
        <Piece geometry={a.box} material={a.glow} position={[side * .155, .104, .475]} scale={[.17, .048, .035]} rotation={[0, 0, side * -.08]} />
        <Piece geometry={a.box} material={a.bronze} position={[side * .15, .20, .43]} scale={[.27, .075, .11]} rotation={[0, 0, side * -.16]} />
        <Piece geometry={a.cone} material={a.bronze} position={[side * .30, .43, -.07]} scale={[.105, .31, .105]} rotation={[.15, 0, side * -.28]} />
        <Piece geometry={a.joint} material={a.metal} position={[side * .42, -.015, 0]} scale={[.11, .12, .13]} />
      </group>)}
      <Piece geometry={a.box} material={a.pale} position={[0, -.21, .23]} scale={[.58, .19, .40]} />
      <Piece geometry={a.box} material={a.metal} position={[0, -.135, .445]} scale={[.37, .055, .035]} />
      {[0, 1, 2].map(index => <Piece key={`mouth-${index}`} geometry={a.box} material={a.bronze} position={[(index - 1) * .11, -.18, .46]} scale={[.045, .075, .025]} />)}
      <Piece geometry={a.crystal} material={a.coreMaterial} position={[0, .24, .40]} scale={[.055, .085, .04]} />
    </group>
  </group>
}
