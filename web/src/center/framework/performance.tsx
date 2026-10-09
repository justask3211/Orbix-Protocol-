import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { WorldQuality } from '../worlds/GameWorld'
export type FrameMetrics = { fps: number; p50: number; p95: number; samples: number; calls: number; triangles: number; dpr: number }

/** Bounded frame-interval telemetry. Long frames are included, not silently discarded. */
export function FrameMonitor({ quality, onMetrics }: { quality: WorldQuality; onMetrics: (metrics: FrameMetrics) => void }) {
  const samples = useRef<number[]>([]), elapsed = useRef(0), slow = useRef(0), good = useRef(0), tier = useRef(quality)
  const { gl, setDpr } = useThree()
  useFrame((_, delta) => {
    if (!(delta > 0)) return
    if (tier.current !== quality) { tier.current = quality; samples.current = []; slow.current = good.current = 0 }
    samples.current.push(delta * 1000)
    if (samples.current.length > 180) samples.current.shift()
    elapsed.current += delta
    if (elapsed.current < 2 || samples.current.length < 8) return
    const sorted = samples.current.slice().sort((a, b) => a - b), p50 = sorted[Math.floor(sorted.length * .5)], p95 = sorted[Math.floor(sorted.length * .95)]
    const average = sorted.reduce((sum, value) => sum + value, 0) / sorted.length
    onMetrics({ fps: Math.round(1000 / average), p50, p95, samples: sorted.length, calls: gl.info.render.calls, triangles: gl.info.render.triangles, dpr: gl.getPixelRatio() })
    // Hysteresis reduces fill cost; fast tier never enables expensive effects.
    const ceiling = quality === 'fast' ? 1 : quality === 'sharp' ? Math.min(2, window.devicePixelRatio) : Math.min(1.5, window.devicePixelRatio)
    slow.current = p95 > 34 ? slow.current + 1 : 0
    good.current = p95 < 22 ? good.current + 1 : 0
    if (slow.current >= 2) { setDpr(Math.max(.65, gl.getPixelRatio() - .15)); slow.current = 0 }
    else if (good.current >= 4) { setDpr(Math.min(ceiling, gl.getPixelRatio() + .1)); good.current = 0 }
    elapsed.current = 0
  }, -3)
  return null
}
