import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Material, Mesh, MeshStandardMaterial, Object3D, SkinnedMesh } from 'three'
import './winnerCelebration.css'
import { CARTOON_SUITS, CARTOON_PROPORTIONS, cartoonFinish } from './worlds/cartoonStyle'
import { celebrationTitle } from './resultPresentation'

export type PodiumWinner = {
  wallet: string
  name?: string
  score: number | string
  rank: number
  avatar?: string
  character?: string
  teamName?: string
}
export type WinnerCelebrationProps = {
  /** Supply verified final leaderboard/crew placements; this component never decides winners. */
  winners: PodiumWinner[]
  me?: string
  teamMode?: boolean
  title?: string
  localPlacement?: number
  onPresented?: () => void
  reducedMotion?: boolean
  rewardNote?: string
}
type SceneProps = { winners: PodiumWinner[]; reducedMotion: boolean; onUnavailable: () => void }
const HEIGHTS = [.84, .60, .43]
const COLORS = ['#dfb85d', '#b9cad7', '#ce9570']
const shortWallet = (wallet: string) => wallet.length > 12 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet
const personName = (winner: PodiumWinner) => winner.teamName || winner.name || shortWallet(winner.wallet)

// Three, Fiber, GLTF and the model are loaded only when the result panel enters view.
const PodiumScene = lazy(async () => {
  const [fiber, three, loader, skeleton] = await Promise.all([
    import('@react-three/fiber'), import('three'),
    import('three/addons/loaders/GLTFLoader.js'), import('three/addons/utils/SkeletonUtils.js'),
  ])
  function Champion({ winner, index, reducedMotion }: { winner: PodiumWinner; index: number; reducedMotion: boolean }) {
    const gltf = fiber.useLoader(loader.GLTFLoader, '/center/center-models/orbix-ranger.glb')
    const slot = Math.max(0, Math.min(2, winner.rank - 1))
    const owned = useMemo(() => {
      const model = skeleton.clone(gltf.scene), materials: Material[] = []
      const copies = new Map<string, Material>()
      model.traverse((object: Object3D) => {
        const mesh = object as Mesh
        if (!mesh.isMesh) return
        mesh.castShadow = mesh.receiveShadow = true
        const tint = (source: Material) => {
          const style = CARTOON_SUITS[winner.character || 'fox'] || CARTOON_SUITS.fox
          const color = source.name === 'Orbix_Suit' ? style.suit : source.name === 'Orbix_Armor' ? style.armor : source.name === 'Orbix_Accent' ? COLORS[slot] : null
          if (!color || !(source as MeshStandardMaterial).isMeshStandardMaterial) return source
          let material = copies.get(source.uuid)
          if (!material) { material = source.clone(); (material as MeshStandardMaterial).color.set(color); cartoonFinish(material as MeshStandardMaterial); copies.set(source.uuid, material); materials.push(material) }
          return material
        }
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material)
      })
      const mixer = new three.AnimationMixer(model)
      return { model, mixer, materials }
    }, [gltf, slot, winner.character])
    useEffect(() => {
      const idle = gltf.animations.find(animation => animation.name === 'Idle')
      if (idle) { owned.mixer.clipAction(idle).reset().play(); owned.mixer.update(0) }
      return () => {
      owned.mixer.stopAllAction(); owned.mixer.uncacheRoot(owned.model)
      owned.materials.forEach(material => material.dispose())
      const skeletons = new Set<SkinnedMesh['skeleton']>()
      owned.model.traverse(object => { const mesh = object as SkinnedMesh; if (mesh.isSkinnedMesh) skeletons.add(mesh.skeleton) })
      skeletons.forEach(rig => rig.dispose())
      }
    }, [owned, gltf])
    fiber.useFrame((_, delta) => { if (!reducedMotion) owned.mixer.update(Math.min(delta, .06)) })
    const x = index === 0 ? 0 : index === 1 ? -1.65 : 1.65
    return <group position={[x, 0, index === 0 ? .05 : -.10]}>
      <mesh position={[0, HEIGHTS[slot] / 2, 0]} receiveShadow castShadow><cylinderGeometry args={[.68, .76, HEIGHTS[slot], 32]} /><meshStandardMaterial color={COLORS[slot]} metalness={.55} roughness={.36} /></mesh>
      <mesh position={[0, HEIGHTS[slot] + .012, 0]}><cylinderGeometry args={[.63, .63, .025, 32]} /><meshStandardMaterial color="#373b47" metalness={.28} roughness={.68} /></mesh>
      <group position={[0, HEIGHTS[slot] + .025, 0]} rotation={[0, index === 1 ? .15 : index === 2 ? -.15 : .02, 0]}>
        <group scale={[...CARTOON_PROPORTIONS]}><primitive object={owned.model} dispose={null} /></group>
      </group>
      {/* Rank remains meaningful in the accessible DOM, rather than canvas text. */}
      <mesh position={[0, HEIGHTS[slot] * .55, .727]}><boxGeometry args={[.075 + Math.min(3, winner.rank) * .045, .055, .018]} /><meshStandardMaterial color="#fff5d7" emissive="#4d432f" emissiveIntensity={.25} /></mesh>
    </group>
  }
  function Scene({ winners, reducedMotion, onUnavailable }: SceneProps) {
    return <fiber.Canvas camera={{ position: [0, 2.22, 7.7], fov: 36 }} dpr={[1, 1.5]} shadows frameloop={reducedMotion ? 'demand' : 'always'} gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }} fallback={<span className="wc-scene-note">Your champions are on the podium below.</span>} onCreated={({ camera, gl }) => {
      camera.lookAt(0, 1.30, 0); gl.toneMapping = three.ACESFilmicToneMapping; gl.toneMappingExposure = 1.08
      gl.domElement.addEventListener('webglcontextlost', onUnavailable, { once: true })
    }}>
      <ambientLight intensity={1.25} />
      <directionalLight position={[3, 6, 4]} intensity={2.6} color="#fff0d5" castShadow shadow-mapSize={[512, 512]} shadow-camera-left={-4} shadow-camera-right={4} shadow-camera-top={5} shadow-camera-bottom={-2} />
      <directionalLight position={[-3, 3, -2]} intensity={1.3} color="#a9d7ff" />
      <Suspense fallback={null}>{winners.map((winner, index) => <Champion key={`${winner.wallet}:${winner.rank}`} winner={winner} index={index} reducedMotion={reducedMotion} />)}</Suspense>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.01, 0]} receiveShadow><planeGeometry args={[15, 10]} /><shadowMaterial opacity={.18} /></mesh>
    </fiber.Canvas>
  }
  return { default: Scene }
})

class PodiumBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

export default function WinnerCelebration({ winners, me = '', teamMode = false, title, localPlacement, onPresented, reducedMotion, rewardNote }: WinnerCelebrationProps) {
  const panel = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false), [unavailable, setUnavailable] = useState(false)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
  const podium = useMemo(() => [...winners].filter(winner => Number.isFinite(winner.rank) && winner.rank >= 1 && winner.rank <= 3).sort((left, right) => left.rank - right.rank).slice(0, 3), [winners])
  useEffect(() => { onPresented?.() }, [onPresented])
  const motion = reducedMotion ?? prefersReducedMotion
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setPrefersReducedMotion(query.matches)
    update(); query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!panel.current) return
    if (!('IntersectionObserver' in window)) { setVisible(true); return }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() } }, { threshold: .1 })
    observer.observe(panel.current); return () => observer.disconnect()
  }, [podium.length])
  if (!podium.length) return null
  const mine = podium.find(winner => winner.wallet.toLowerCase() === me.toLowerCase())
  const fallback = <div className="wc-static-stage" aria-hidden="true"><span>✦</span><strong>{personName(podium[0])}</strong><small>{podium[0].rank === 1 ? 'FIRST' : podium[0].rank === 2 ? 'SECOND' : 'THIRD'} PLACE</small><i>{podium[0].rank}</i></div>
  const order = podium.length === 3 ? [podium[1], podium[0], podium[2]] : podium
  return <section ref={panel} className={`wc-celebration${motion ? ' wc-reduced-motion' : ''}`} aria-label={teamMode ? 'Winning crews podium' : 'Winners podium'}>
    <div className="wc-confetti" aria-hidden="true">{Array.from({ length: 16 }, (_, index) => <i key={index} style={{ '--confetti-index': index } as React.CSSProperties} />)}</div>
    <header className="wc-heading"><span className="wc-eyebrow">{teamMode ? 'CREW HONORS' : 'ROUND COMPLETE'} <span aria-hidden="true">✦</span></span><h2>{title || celebrationTitle(personName(podium[0]), localPlacement ?? mine?.rank)}</h2><p>{localPlacement ? 'Your finish is confirmed. Full results and reward status follow below.' : mine ? `Well played, ${personName(mine)}. Your finish is confirmed.` : 'Great moves. A round worth celebrating.'}</p></header>
    <div className="wc-model-stage" aria-hidden="true">
      {visible && !unavailable ? <PodiumBoundary fallback={fallback}><Suspense fallback={<div className="wc-scene-loading"><span>✦</span>Raising the podium…</div>}><PodiumScene winners={podium} reducedMotion={motion} onUnavailable={() => setUnavailable(true)} /></Suspense></PodiumBoundary> : fallback}
    </div>
    <ol className={`wc-podium wc-count-${podium.length}`} aria-label="Final placements">
      {order.map(winner => {
        const own = winner.wallet.toLowerCase() === me.toLowerCase()
        const avatar = winner.avatar && !winner.avatar.includes('\\') && (winner.avatar.startsWith('/center/') || winner.avatar.startsWith('/api/center/v1/profiles/')) ? winner.avatar : undefined
        return <li key={`${winner.wallet}:${winner.rank}`} className={`wc-place wc-place-${winner.rank}${own ? ' wc-mine' : ''}`}>
          <span className="wc-rank" aria-label={`Rank ${winner.rank}`}>{winner.rank === 1 ? '♛' : winner.rank}<small>{winner.rank === 1 ? '1ST' : winner.rank === 2 ? '2ND' : '3RD'}</small></span>
          <div className="wc-person"><span className="wc-avatar" aria-hidden="true">{personName(winner).slice(0, 2).toUpperCase()}{avatar && <img src={avatar} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true }} />}</span><div><strong>{personName(winner)}</strong><small>{own ? 'YOU' : teamMode ? 'CREW' : shortWallet(winner.wallet)}</small></div></div>
          <div className="wc-score"><b>{String(winner.score)}</b><span>match score</span></div>
        </li>
      })}
    </ol>
    <p className="wc-reward-note">{rewardNote ?? 'These are confirmed match placements. Reward availability and claims are shown below.'}</p>
  </section>
}
