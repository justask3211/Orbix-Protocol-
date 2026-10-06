import { Component, Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from 'react'
import './worlds.css'

export type WorldGame = 'number-hunt' | 'boss-raid' | 'token-catch' | 'reaction-duel'
export type GameWorldProps = {
  game: WorldGame
  state: Record<string, any>
  me: string
  players: string[]
  reducedMotion?: boolean
  onLane?: (lane: number) => void
  onAttack?: () => void
  onCatch?: (spawnIndex: number) => void
}

const Scene = lazy(() => import('./WorldScene'))
const WORLDS: Record<WorldGame, { title: string; note: string }> = {
  'number-hunt': { title: 'Whisperleaf Islands', note: 'Explore the mystery. Every guess is checked by the game server.' },
  'boss-raid': { title: 'Crystalheart Arena', note: 'Rally your crew. The crystal guardian reacts to confirmed damage.' },
  'token-catch': { title: 'Sunshine Runway', note: 'Choose a lane, then catch a visible token. Watch out for hazards.' },
  'reaction-duel': { title: 'Twinlight Coliseum', note: 'Choose, seal, reveal. Your opponent’s move stays hidden until resolution.' },
}

class WorldBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

/** The renderer loads only when a featured game is opened. DOM controls remain usable without WebGL. */
export default function GameWorld(props: GameWorldProps) {
  const [visible, setVisible] = useState(() => !document.hidden)
  const [motionPreference, setMotionPreference] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [contextLost, setContextLost] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const handleContextLost = useCallback(() => setContextLost(true), [])
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
    <div className="ow-fallback" role="status">
      <span className="ow-fallback-orb" aria-hidden="true" />
      <strong>{world.title}</strong>
      <p>The 3D view is unavailable. You can keep playing with the controls below.</p>
      <button className="btn-ghost" onClick={() => { setContextLost(false); setAttempt(value => value + 1) }}>Retry 3D view</button>
    </div>
  )

  return (
    <section className={`ow-world ow-${props.game}`} aria-label={`${world.title} 3D game environment`}>
      <div className="ow-world-title"><span className="ow-world-dot" aria-hidden="true" /><span>{world.title}</span><small>3D WORLD</small></div>
      <div className="ow-canvas-wrap">
        <WorldBoundary key={`${props.game}:${attempt}`} fallback={fallback}>
          <Suspense fallback={<div className="ow-loading" role="status"><span className="spinner" aria-hidden="true" />Opening {world.title}…</div>}>
            {contextLost ? fallback : <Scene {...props} reducedMotion={reducedMotion} active={visible} onContextLost={handleContextLost} fallback={fallback} />}
          </Suspense>
        </WorldBoundary>
        <div className="ow-scene-caption" aria-hidden="true"><span>{props.state.finished ? 'ROUND COMPLETE' : 'PUBLIC GAME STATE'}</span>{props.game === 'token-catch' && <span>TAP A LANE TO MOVE</span>}{props.game === 'reaction-duel' && props.state.history?.length > 0 && <span>RELICS SHOW REVEALED ROUNDS</span>}</div>
      </div>
      <p className="ow-world-note">{world.note}</p>
    </section>
  )
}
