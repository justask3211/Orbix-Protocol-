import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, CanvasTexture, Color, InstancedMesh, Object3D, PlaneGeometry, RepeatWrapping, SRGBColorSpace, Vector2 } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { GameWorldProps } from './GameWorld'
import { terrainHeight, type TerrainTheme } from './terrain'

type EnvironmentProps = Pick<GameWorldProps, 'state' | 'game' | 'reducedMotion'>
type Instance = { x: number; y: number; z: number; sx: number; sy: number; sz: number; yaw?: number; roll?: number; color: string }
const PALETTES = {
  island: { grass: '#73974c', earth: '#c5b080', stone: '#92907e', leaves: '#558147', shadowLeaves: '#2f6546', trunk: '#726049', water: '#367e99', metal: '#728b86', accent: '#e6af54' },
  guardian: { grass: '#617961', earth: '#a89a81', stone: '#747d7b', leaves: '#486b61', shadowLeaves: '#305649', trunk: '#695e52', water: '#476d78', metal: '#788785', accent: '#87dcd0' },
  courtyard: { grass: '#70834d', earth: '#b8a486', stone: '#999488', leaves: '#627b48', shadowLeaves: '#496440', trunk: '#78614a', water: '#487b8d', metal: '#6d7375', accent: '#e6b867' },
}
const num = (n: unknown, fallback = 0) => typeof n === 'number' && Number.isFinite(n) ? n : fallback
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }
const smooth = (edge0: number, edge1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0))); return t * t * (3 - 2 * t) }

/** Procedural textures are original, deterministic and local: no image downloads or render-loop allocations. */
function useSurfaceTextures() {
  const textures = useMemo(() => {
    const size = 256, colorSurface = document.createElement('canvas'), normalSurface = document.createElement('canvas')
    colorSurface.width = colorSurface.height = normalSurface.width = normalSurface.height = size
    const ctx = colorSurface.getContext('2d'), normals = normalSurface.getContext('2d')
    if (ctx && normals) {
      const image = ctx.createImageData(size, size), normal = normals.createImageData(size, size)
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const index = (y * size + x) * 4, grain = hash(index) * 22 + hash(x * .71 + y * .91) * 8
        const value = 224 + grain
        image.data[index] = image.data[index + 1] = image.data[index + 2] = value; image.data[index + 3] = 255
        normal.data[index] = 128 + (hash(index + 17) - .5) * 24
        normal.data[index + 1] = 128 + (hash(index + 59) - .5) * 24
        normal.data[index + 2] = 250; normal.data[index + 3] = 255
      }
      ctx.putImageData(image, 0, 0); normals.putImageData(normal, 0, 0)
    }
    const color = new CanvasTexture(colorSurface), normal = new CanvasTexture(normalSurface)
    color.colorSpace = SRGBColorSpace
    for (const texture of [color, normal]) { texture.wrapS = texture.wrapT = RepeatWrapping; texture.repeat.set(32, 32); texture.anisotropy = 2 }
    return { color, normal }
  }, [])
  useEffect(() => () => { textures.color.dispose(); textures.normal.dispose() }, [textures])
  return textures
}

/** Shared geometry/material draw calls for foliage, grass and stones, rather than one draw call per prop. */
function Batch({ entries, shape = 'sphere', shadows = false, roughness = .96 }: { entries: Instance[]; shape?: 'sphere' | 'trunk' | 'grass' | 'box'; shadows?: boolean; roughness?: number }) {
  const ref = useRef<InstancedMesh>(null), transform = useMemo(() => new Object3D(), []), color = useMemo(() => new Color(), [])
  useEffect(() => {
    if (!ref.current) return
    entries.forEach((entry, index) => {
      transform.position.set(entry.x, entry.y, entry.z); transform.rotation.set(0, entry.yaw || 0, entry.roll || 0); transform.scale.set(entry.sx, entry.sy, entry.sz); transform.updateMatrix()
      ref.current!.setMatrixAt(index, transform.matrix); color.set(entry.color); ref.current!.setColorAt(index, color)
    })
    ref.current.count = entries.length; ref.current.instanceMatrix.needsUpdate = true
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true
    ref.current.computeBoundingSphere()
  }, [entries, transform, color])
  return <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, entries.length)]} castShadow={shadows} receiveShadow>
    {shape === 'trunk' ? <cylinderGeometry args={[.7, 1, 1, 7]} /> : shape === 'grass' ? <coneGeometry args={[.5, 1, 3]} /> : shape === 'box' ? <boxGeometry /> : <icosahedronGeometry args={[1, 1]} />}
    <meshStandardMaterial roughness={roughness} />
  </instancedMesh>
}

/** Only the walkable area samples the authoritative surface; everything beyond its border is vista. */
function landscapeHeight(x: number, z: number, theme: TerrainTheme, hasTerrain: boolean) {
  const radius = Math.max(Math.abs(x), Math.abs(z)), ground = hasTerrain ? terrainHeight(x, z, theme) : 0
  if (radius <= 20.6) return ground
  const shore = smooth(24, 49, radius), ridge = Math.sin(x * .057 + z * .038) * Math.sin(z * .067 - .8)
  if (theme === 'island') return ground * (1 - shore) - shore * 3.4 + Math.max(0, ridge) * smooth(22, 29, radius) * (1 - shore) * 6
  return ground + Math.max(0, ridge + .15) * smooth(23, 36, radius) * 13 - smooth(57, 70, radius) * 7
}

function Ground({ theme, hasTerrain }: { theme: TerrainTheme; hasTerrain: boolean }) {
  const textures = useSurfaceTextures(), palette = PALETTES[theme]
  const geometry = useMemo(() => {
    const mesh = new PlaneGeometry(140, 140, 160, 160); mesh.rotateX(-Math.PI / 2)
    const positions = mesh.attributes.position, colors = new Float32Array(positions.count * 3)
    const grass = new Color(palette.grass), dirt = new Color(palette.earth), stone = new Color(palette.stone), color = new Color()
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index), z = positions.getZ(index), y = landscapeHeight(x, z, theme, hasTerrain)
      positions.setY(index, y)
      const paths = Math.min(Math.abs(x - Math.sin(z * .12) * 2), Math.abs(z - Math.cos(x * .1) * 2.5))
      const clearing = theme === 'courtyard' ? 1 - smooth(15, 23, Math.hypot(x, z)) : theme === 'guardian' ? 1 - smooth(4, 10, Math.hypot(x, z)) : 0
      const dirtMix = Math.max((1 - smooth(1.2, 3.3, paths)) * .85, clearing * .88, smooth(22, 40, Math.max(Math.abs(x), Math.abs(z))) * (theme === 'island' ? .98 : .35))
      color.copy(grass).lerp(dirt, dirtMix)
      const slope = Math.abs(landscapeHeight(x + .4, z, theme, hasTerrain) - y) + Math.abs(landscapeHeight(x, z + .4, theme, hasTerrain) - y)
      color.lerp(stone, smooth(.25, 1.1, slope) * .7).multiplyScalar(.93 + hash(index * .16) * .1)
      colors[index * 3] = color.r; colors[index * 3 + 1] = color.g; colors[index * 3 + 2] = color.b
    }
    positions.needsUpdate = true; mesh.setAttribute('color', new BufferAttribute(colors, 3)); mesh.computeVertexNormals(); mesh.computeBoundingSphere()
    return mesh
  }, [theme, hasTerrain, palette])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} receiveShadow><meshStandardMaterial vertexColors map={textures.color} normalMap={textures.normal} normalScale={new Vector2(.35, .35)} roughness={.98} /></mesh>
}

function Vegetation({ theme, hasTerrain }: { theme: TerrainTheme; hasTerrain: boolean }) {
  const palette = PALETTES[theme]
  const scenery = useMemo(() => {
    const trunks: Instance[] = [], crowns: Instance[] = [], stones: Instance[] = [], grasses: Instance[] = [], flowers: Instance[] = []
    for (let index = 0; index < 42; index++) {
      const angle = index * 2.39996, radius = 24 + hash(index + 3) * 17, x = Math.sin(angle) * radius, z = Math.cos(angle) * radius
      if (theme === 'island' && z < -24 && Math.abs(x) < 20) continue // Open sea sightline from the spawn beach.
      const y = landscapeHeight(x, z, theme, hasTerrain), height = 4.1 + hash(index + 8) * 4.5, size = .8 + hash(index + 2) * .6
      trunks.push({ x, y: y + height * .42, z, sx: .25 * size, sy: height * .84, sz: .25 * size, color: palette.trunk, roll: (hash(index + 12) - .5) * .06 })
      for (let branch = 0; branch < 3; branch++) {
        const direction = branch * 2.1 + index, dx = Math.sin(direction), dz = Math.cos(direction)
        trunks.push({ x: x + dx * .55, y: y + height * .67, z: z + dz * .55, sx: .13, sy: 1.7 * size, sz: .13, roll: .65, yaw: direction, color: palette.trunk })
      }
      for (let leaf = 0; leaf < 7; leaf++) {
        const direction = leaf * 2.39 + index, layer = leaf < 3 ? .72 : .94, offset = leaf === 6 ? 0 : 1.05 * size
        crowns.push({ x: x + Math.sin(direction) * offset, y: y + height * layer, z: z + Math.cos(direction) * offset, sx: (1.45 + hash(index + leaf) * .55) * size, sy: (leaf < 3 ? 1.25 : 1.7) * size, sz: 1.55 * size, yaw: direction, color: leaf % 3 ? palette.leaves : palette.shadowLeaves })
      }
    }
    for (let index = 0; index < 90; index++) {
      const angle = hash(index + 41) * Math.PI * 2, radius = 22.5 + hash(index + 48) * 31, x = Math.sin(angle) * radius, z = Math.cos(angle) * radius
      const y = landscapeHeight(x, z, theme, hasTerrain), size = .4 + hash(index + 25) * 1.8
      stones.push({ x, y: y + size * .3, z, sx: size, sy: size * .7, sz: size * .82, yaw: angle, roll: .12, color: index % 4 ? palette.stone : palette.earth })
    }
    for (let index = 0; index < 540; index++) {
      const x = (hash(index + 513) - .5) * 48, z = (hash(index + 915) - .5) * 48
      const paths = Math.min(Math.abs(x - Math.sin(z * .12) * 2), Math.abs(z - Math.cos(x * .1) * 2.5))
      if (paths < 2.4 || (theme === 'guardian' && Math.hypot(x, z) < 6) || (theme === 'courtyard' && Math.hypot(x, z) < 16)) continue
      const y = landscapeHeight(x, z, theme, hasTerrain), height = .12 + hash(index + 214) * .25
      for (let blade = 0; blade < 3; blade++) grasses.push({ x: x + blade * .035, y: y + height / 2, z, sx: .065, sy: height, sz: .02, yaw: index + blade * 1.2, roll: (blade - 1) * .18, color: blade === 1 ? palette.grass : palette.leaves })
      if (index % 19 === 0) flowers.push({ x, y: y + .19, z, sx: .07, sy: .06, sz: .07, color: theme === 'guardian' ? '#84c7ae' : '#efcc85' })
    }
    return { trunks, crowns, stones, grasses, flowers }
  }, [theme, hasTerrain, palette])
  return <><Batch entries={scenery.trunks} shape="trunk" /><Batch entries={scenery.crowns} /><Batch entries={scenery.stones} /><Batch entries={scenery.grasses} shape="grass" /><Batch entries={scenery.flowers} /></>
}

/** Decorative contact detail stays inside the exact published cover volume. */
function AuthoritativeCover({ item, theme }: { item: Record<string, any>; theme: TerrainTheme }) {
  const width = num(item.width, num(item.radius, 1) * 2), depth = num(item.depth, num(item.radius, 1) * 2), height = num(item.height, 1.6), palette = PALETTES[theme]
  const geometry = useMemo(() => new RoundedBoxGeometry(width, height, depth, 2, Math.min(.12, width / 8, depth / 8, height / 8)), [width, height, depth])
  useEffect(() => () => geometry.dispose(), [geometry])
  const bunker = item.kind === 'bunker'
  return <group position={[num(item.x), num(item.baseY), num(item.z)]}>
    <mesh geometry={geometry} position={[0, height / 2, 0]} castShadow receiveShadow><meshStandardMaterial color={bunker ? palette.metal : palette.stone} roughness={bunker ? .65 : .98} metalness={bunker ? .22 : 0} /></mesh>
    <mesh position={[0, height - .025, 0]}><boxGeometry args={[width * .87, .025, depth * .88]} /><meshStandardMaterial color={bunker ? '#aec2b7' : palette.grass} roughness={1} /></mesh>
    {[.25, .64].map((part, index) => <mesh key={part} position={[0, height * part, depth / 2 - .005]}><boxGeometry args={[width * .98, index ? .045 : .025, .012]} /><meshStandardMaterial color={bunker ? palette.accent : '#686c62'} roughness={.8} /></mesh>)}
    {bunker && [-1, 1].map(side => <mesh key={side} position={[side * width * .34, height * .57, depth / 2 - .004]}><boxGeometry args={[.09, height * .62, .018]} /><meshStandardMaterial color="#334c52" roughness={.6} /></mesh>)}
  </group>
}

function VistaArchitecture({ theme, hasTerrain }: { theme: TerrainTheme; hasTerrain: boolean }) {
  const palette = PALETTES[theme]
  const posts = useMemo(() => {
    const list: Instance[] = []
    for (let side = -1; side <= 1; side += 2) for (let index = 0; index <= 5; index++) {
      const at = -20 + index * 8
      for (const [x, z] of [[side * 21.2, at], [at, side * 21.2]]) list.push({ x, y: landscapeHeight(x, z, theme, hasTerrain) + .4, z, sx: .16, sy: .8, sz: .16, color: palette.metal })
    }
    return list
  }, [theme, hasTerrain, palette])
  if (theme === 'island') return <>
    <Batch entries={posts} shape="box" />
    <group position={[0, landscapeHeight(0, -27, theme, hasTerrain), -27]}>
      <mesh position={[0, 1.5, 0]} castShadow><boxGeometry args={[8, 3, 4]} /><meshStandardMaterial color="#9aa790" roughness={.9} /></mesh>
      <mesh position={[0, 3.1, 0]} rotation={[0, 0, .07]} castShadow><boxGeometry args={[9.2, .24, 5.2]} /><meshStandardMaterial color="#747c77" metalness={.2} roughness={.7} /></mesh>
      <mesh position={[0, 1.4, 2.015]}><boxGeometry args={[2, 2.8, .035]} /><meshStandardMaterial color="#425c62" /></mesh>
      {[-1, 1].map(side => <mesh key={side} position={[side * 2.6, 1.75, 2.035]}><boxGeometry args={[1.7, 1, .05]} /><meshStandardMaterial color="#83b0b4" metalness={.4} roughness={.3} /></mesh>)}
      <mesh position={[3, 4.4, 0]}><cylinderGeometry args={[.07, .07, 3, 8]} /><meshStandardMaterial color="#4e666b" metalness={.6} /></mesh>
      <mesh position={[3, 5.6, 0]} rotation={[0, .4, .65]}><torusGeometry args={[.65, .055, 5, 16]} /><meshStandardMaterial color="#c5cebd" metalness={.3} /></mesh>
      {[0, 1, 2].map(index => <mesh key={index} position={[0, .1 + index * .12, 3.6 - index * .45]}><boxGeometry args={[3.2, .22, 1.1]} /><meshStandardMaterial color="#aaad98" roughness={1} /></mesh>)}
    </group>
  </>
  return <>
    <Batch entries={posts} shape="box" />
    {theme === 'guardian' && <group position={[0, landscapeHeight(0, -27, theme, hasTerrain), -27]}>
      {/* A worn sanctuary gate gives the guardian map a silhouette distinct from the duel fort. */}
      {[-1, 1].map(side => <group key={side} position={[side * 5.3, 0, 0]}>
        <mesh position={[0, 4.1, 0]} castShadow><cylinderGeometry args={[1, 1.3, 8.2, 7]} /><meshStandardMaterial color="#7b827c" roughness={1} /></mesh>
        <mesh position={[0, .4, 0]}><boxGeometry args={[3.2, .8, 3.2]} /><meshStandardMaterial color="#8e9285" roughness={1} /></mesh>
        <mesh position={[0, 7.9, 0]}><boxGeometry args={[3, .65, 2.7]} /><meshStandardMaterial color="#929284" roughness={1} /></mesh>
        <mesh position={[0, 4.7, 1.035]}><boxGeometry args={[.18, 4.4, .025]} /><meshStandardMaterial color="#8fd4bf" emissive="#497c68" emissiveIntensity={.45} roughness={.8} /></mesh>
        {[0, 1, 2].map(index => <mesh key={index} position={[side * .7, 6 - index * 1.1, .5]} scale={[.7, .45, .65]}><icosahedronGeometry args={[1, 1]} /><meshStandardMaterial color={palette.leaves} roughness={1} /></mesh>)}
      </group>)}
      <mesh position={[0, 8.45, 0]} rotation={[0, 0, .035]} castShadow><boxGeometry args={[13.6, 1.2, 2.35]} /><meshStandardMaterial color="#83867c" roughness={1} /></mesh>
      <mesh position={[0, 9.35, 0]}><octahedronGeometry args={[1.5, 0]} /><meshStandardMaterial color="#77c3b0" emissive="#386f61" emissiveIntensity={.4} roughness={.4} metalness={.12} /></mesh>
      {Array.from({ length: 4 }, (_, index) => <mesh key={index} position={[0, .12 + index * .17, 4.4 - index * .7]}><boxGeometry args={[9, .26, 1.7]} /><meshStandardMaterial color="#939489" roughness={1} /></mesh>)}
    </group>}
    {[-1, 1].flatMap(side => [-1, 1].map(end => {
      const x = side * 25.8, z = end * 23.5, y = landscapeHeight(x, z, theme, hasTerrain)
      return <group key={`${side}:${end}`} position={[x, y, z]}>
        <mesh position={[0, 1.4, 0]} castShadow><boxGeometry args={[4.8, 2.8, 4.8]} /><meshStandardMaterial color={palette.stone} roughness={1} /></mesh>
        <mesh position={[0, 4.3, 0]} castShadow><cylinderGeometry args={[1.35, 1.7, 5.8, 8]} /><meshStandardMaterial color={palette.stone} roughness={1} /></mesh>
        <mesh position={[0, 7.3, 0]}><cylinderGeometry args={[1.65, 1.65, .38, 8]} /><meshStandardMaterial color={palette.earth} /></mesh>
        {[0, 1, 2, 3].map(index => <mesh key={index} position={[Math.sin(index * Math.PI / 2) * 1.2, 7.9, Math.cos(index * Math.PI / 2) * 1.2]}><boxGeometry args={[.65, 1.1, .65]} /><meshStandardMaterial color={palette.stone} /></mesh>)}
        <mesh position={[0, 4.8, end * -1.7]}><boxGeometry args={[.9, 2.4, .035]} /><meshStandardMaterial color={theme === 'guardian' ? '#3b645b' : '#ab5d4f'} roughness={.95} /></mesh>
      </group>
    }))}
    {[-1, 1].map(side => <group key={side} position={[side * 25, landscapeHeight(side * 25, 0, theme, hasTerrain), 0]}>
      <mesh position={[0, 1.3, 0]} castShadow><boxGeometry args={[1.8, 2.6, 36]} /><meshStandardMaterial color={palette.stone} roughness={1} /></mesh>
      <mesh position={[0, 2.7, 0]}><boxGeometry args={[2, .25, 36]} /><meshStandardMaterial color={palette.earth} /></mesh>
      {Array.from({ length: 10 }, (_, index) => <mesh key={index} position={[0, 3.2, (index - 4.5) * 3.5]}><boxGeometry args={[1.8, 1, 1.3]} /><meshStandardMaterial color={palette.stone} /></mesh>)}
    </group>)}
  </>
}

function Water({ theme, reducedMotion }: { theme: TerrainTheme; reducedMotion?: boolean }) {
  const surface = useRef<CanvasTexture | null>(null)
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const pixels = ctx.createImageData(128, 128)
      for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
        const at = (y * 128 + x) * 4
        pixels.data[at] = 128 + Math.sin(x * Math.PI / 16 + Math.cos(y * Math.PI / 32)) * 28
        pixels.data[at + 1] = 128 + Math.cos(y * Math.PI / 16 + Math.sin(x * Math.PI / 32)) * 28
        pixels.data[at + 2] = 245; pixels.data[at + 3] = 255
      }
      ctx.putImageData(pixels, 0, 0)
    }
    const next = new CanvasTexture(canvas); next.wrapS = next.wrapT = RepeatWrapping; next.repeat.set(20, 20); surface.current = next; return next
  }, [])
  useEffect(() => () => texture.dispose(), [texture])
  useFrame((_, delta) => { if (!reducedMotion && surface.current) { surface.current.offset.x += delta * .006; surface.current.offset.y += delta * .003 } })
  return <mesh position={[0, -1.6, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[350, 350]} /><meshStandardMaterial color={PALETTES[theme].water} normalMap={texture} normalScale={new Vector2(.42, .42)} roughness={.3} metalness={.35} /></mesh>
}

/** Field-v1 is a small multiplayer arena with a much larger visual horizon, never a client-owned reward simulation. */
export default function FieldEnvironment({ state, game, reducedMotion }: EnvironmentProps) {
  const theme: TerrainTheme = game === 'boss-raid' ? 'guardian' : game === 'combat-duel' ? 'courtyard' : 'island'
  const hasTerrain = state.terrain?.kind === 'field-v1'
  return <group>
    <Ground theme={theme} hasTerrain={hasTerrain} />
    <Water theme={theme} reducedMotion={reducedMotion} />
    <Vegetation theme={theme} hasTerrain={hasTerrain} />
    <VistaArchitecture theme={theme} hasTerrain={hasTerrain} />
    {(state.obstacles ?? []).slice(0, 40).map((item: Record<string, any>) => <AuthoritativeCover key={item.id || `${item.x}:${item.z}`} item={item} theme={theme} />)}
  </group>
}
