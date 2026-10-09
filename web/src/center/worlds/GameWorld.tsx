import { Component, Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from 'react'
import './worlds.css'
import type { FrameMetrics } from '../framework/performance'
import type { ArenaInputRef, ArenaCameraRef } from '../ArenaControls'

export type WorldGame = 'number-hunt' | 'boss-raid' | 'token-catch' | 'reaction-duel' | 'combat-duel'
export type WorldQuality = 'fast' | 'balanced' | 'sharp'
export type GameWorldProps = {
  game: WorldGame
  state: Record<string, any>
  me: string
  players: string[]
  reducedMotion?: boolean
  onLane?: (lane: number) => void
  onAttack?: () => void
  onCatch?: (spawnIndex: number) => void
  inputRef?: ArenaInputRef
  cameraRef?: ArenaCameraRef
  onAim?: (yaw: number) => void
}

const Scene = lazy(() => import('./WorldScene'))
const WORLDS: Record<WorldGame, { title: string; note: string }> = {
  'number-hunt': { title: 'Whisperleaf Islands', note: 'Explore the mystery. Every guess is checked by the game server.' },
  'boss-raid': { title: 'Crystalheart Arena', note: 'Rally your crew. The crystal guardian reacts to confirmed damage.' },
  'token-catch': { title: 'Sunnydrop Outpost', note: 'Run to supply drops, inspect their loot and collect your share. Watch for bombs and rival players.' },
  'reaction-duel': { title: 'Twinlight Coliseum', note: 'Choose, seal, reveal. Your opponent’s move stays hidden until resolution.' },
  'combat-duel': { title: 'Twinlight Arena', note: 'Move, jump, guard and chain your strikes. The server checks distance, damage and the final knockout.' },
}

function FallbackNotice({ onShow, children }: { onShow: () => void; children: ReactNode }) {
  useEffect(onShow, [onShow])
  return <>{children}</>
}

class WorldBoundary extends Component<{ children: ReactNode; fallback: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onFailure() }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

/** The renderer loads only when a featured game is opened. DOM controls remain usable without WebGL. */
export default function GameWorld(props: GameWorldProps) {
  const [visible, setVisible] = useState(() => !document.hidden)
  const [motionPreference, setMotionPreference] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [contextLost, setContextLost] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [sceneReady, setSceneReady] = useState(false)
  const [sceneFailed, setSceneFailed] = useState(false)
  const [quality, setQuality] = useState<WorldQuality>(() => window.matchMedia('(max-width: 799px), (pointer: coarse)').matches ? 'fast' : 'balanced')
  const [metrics, setMetrics] = useState<FrameMetrics | null>(null)
  const handleFailure = useCallback(() => setSceneFailed(true), [])
  const handleContextLost = useCallback(() => setContextLost(true), [])
  const handleReady = useCallback(() => setSceneReady(true), [])
  const world = WORLDS[props.game]
  const reducedMotion = props.reducedMotion ?? motionPreference

  useEffect(() => {
    const visibility = () => setVisible(!document.hidden)
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const motion = () => setMotionPreference(query.matches)
    document.addEventListener('visibilitychange', visibility)
    query.addEventListener('change', motion)
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      query.removeEventListener('change', motion)
    }
  }, [])

  const fallback = (
    <FallbackNotice onShow={handleFailure}><div className="ow-fallback" role="status">
      <span className="ow-fallback-orb" aria-hidden="true" />
      <strong>{world.title}</strong>
      <p>The 3D view is unavailable. You can keep playing with the controls below.</p>
      <button className="btn-ghost" onClick={() => { setContextLost(false); setSceneReady(false); setSceneFailed(false); setAttempt(value => value + 1) }}>Retry 3D view</button>
    </div></FallbackNotice>
  )

  return (
    <section className={`ow-world ow-${props.game}${props.state.arena ? ' ow-perspective-world' : ''}`} aria-label={`${world.title} 3D game environment`}>
      <div className="ow-world-title"><span className="ow-world-dot" aria-hidden="true" /><span>{world.title}</span><small>{metrics && props.state.arena ? `${metrics.fps} FPS` : '3D WORLD'}</small>{metrics && props.state.arena && <details className="ow-performance"><summary aria-label="Frame performance">{Math.round(metrics.p95)} ms p95</summary><div><strong>Frame intervals</strong><span>p50 {metrics.p50.toFixed(1)} ms · p95 {metrics.p95.toFixed(1)} ms</span><span>{metrics.samples} samples · {metrics.calls} draw calls</span><span>{metrics.triangles.toLocaleString()} triangles · DPR {metrics.dpr.toFixed(2)}</span><span>{metrics.p95 <= 33.3 ? 'Within the 30 FPS frame target' : 'Above the 30 FPS frame target'}</span></div></details>}{props.state.arena && <label className="ow-quality">Graphics<select value={quality} onChange={event => setQuality(event.target.value as WorldQuality)} title="Fast reduces resolution and shadows. Sharp uses higher resolution."><option value="fast">Fast</option><option value="balanced">Balanced</option><option value="sharp">Sharp</option></select></label>}</div>
      <div className="ow-canvas-wrap">
        <WorldBoundary key={`${props.game}:${attempt}`} fallback={fallback} onFailure={handleFailure}>
          <Suspense fallback={<div className="ow-loading ow-loading-world" role="status"><span className="ow-loading-mascot" aria-hidden="true">✦</span><strong>Opening {world.title}…</strong><span>Loading the shared 3D renderer</span></div>}>
            {contextLost ? fallback : <Scene {...props} quality={quality} onMetrics={setMetrics} reducedMotion={reducedMotion} active={visible} onContextLost={handleContextLost} onReady={handleReady} fallback={fallback} />}
          </Suspense>
        </WorldBoundary>
        {!sceneReady && !contextLost && !sceneFailed && <div className="ow-loading ow-loading-assets" role="status"><span className="ow-loading-mascot" aria-hidden="true">✦</span><strong>Preparing {world.title}…</strong><span>Loading character, animations and terrain</span></div>}
        {sceneReady && <div className="ow-scene-caption" aria-hidden="true"><span>{props.state.finished ? 'ROUND COMPLETE' : 'SERVER-VERIFIED WORLD'}</span>{props.state.arena ? <span>MOVE · LOOK · JUMP · LOOT</span> : props.game === 'token-catch' && <span>TAP A LANE TO MOVE</span>}{props.game === 'reaction-duel' && props.state.history?.length > 0 && <span>RELICS SHOW REVEALED ROUNDS</span>}</div>}
      </div>
      <p className="ow-world-note">{world.note}</p>
    </section>
  )
}
