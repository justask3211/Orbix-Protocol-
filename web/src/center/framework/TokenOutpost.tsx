import { useMemo } from 'react'
import { Scatter, type ScatterEntry } from './scatter'
import { stateGround } from '../worlds/terrain'
type State = Record<string, any>

/** Sunnydrop's three connected routes: beach arc, hill loop, central supply crossing.
 * All decoration is thin ground dressing; no unannounced gameplay colliders. */
export const outpostPathDistance = (x: number, z: number) => Math.min(
  Math.abs(Math.hypot(x, z) - 11),
  Math.abs(x - Math.sin(z * .12) * 2),
  Math.abs(z - Math.cos(x * .1) * 2.5),
)

export default function TokenOutpost({ state }: { state: State }) {
  const terrain = state.terrain?.theme, kind = state.terrain?.kind, obstacles = state.obstacles
  const obstacleKey = JSON.stringify((obstacles ?? []).map((o: State) => [o.x, o.z, o.baseY, o.width, o.depth, o.height, o.kind]))
  const dressing = useMemo(() => {
    const stones: ScatterEntry[] = [], flowers: ScatterEntry[] = [], pads: ScatterEntry[] = [], trims: ScatterEntry[] = []
    const ground = (x: number, z: number) => stateGround(state, x, z)
    for (let i = 0; i < 120; i++) {
      const angle = i / 120 * Math.PI * 2, radius = i % 2 ? 12.45 : 9.55, x = Math.sin(angle) * radius, z = Math.cos(angle) * radius
      // Leave the crossing routes and server cover accessible and clearly legible.
      if (Math.abs(x) < 2.8 || Math.abs(z - 1.8) < 2.8 || (obstacles ?? []).some((o: State) => Math.abs(x - o.x) < o.width / 2 + .9 && Math.abs(z - o.z) < o.depth / 2 + .9)) continue
      stones.push({ position: [x, ground(x, z) + .025, z], scale: [.19, .035, .14], yaw: angle, color: i % 3 ? '#dce2c0' : '#edc69a' })
      for (let j = 0; j < 3; j++) {
        const fx = x + Math.sin(i * 2.4 + j) * .45, fz = z + Math.cos(i * 2.4 + j) * .45
        flowers.push({ position: [fx, ground(fx, fz) + .08, fz], scale: [.065, .07, .065], yaw: i, color: ['#fff0ac', '#f5aa9d', '#bd9fe9'][i % 3] })
      }
    }
    // Low inset mosaic beside the main supply crossing, decoration rather than a step.
    for (let i = 0; i < 18; i++) {
      const angle = i / 18 * Math.PI * 2, x = Math.sin(angle) * 2.8, z = Math.cos(angle) * 2.8
      pads.push({ position: [x, ground(x, z) + .008, z], scale: [.35, .012, .18], yaw: angle, color: i % 3 ? '#f1dab0' : '#a6d3bf' })
    }
    // Cover detailing shares one batch. Inset panels/rails fit the server's cover boxes.
    for (const o of obstacles ?? []) {
      const x = o.x, z = o.z, y = o.baseY ?? ground(x, z), w = o.width, d = o.depth, h = o.height
      if (!(w > 0 && d > 0 && h > 0)) continue
      const bunker = o.kind === 'bunker'
      for (const side of [-1, 1]) {
        trims.push({ position: [x + side * w * .42, y + h * .48, z + d / 2], scale: [.09, h * .85, .025], color: bunker ? '#f3cc82' : '#926e51' })
        trims.push({ position: [x, y + h * .82, z + side * d * .35], scale: [w * .91, .08, .10], color: '#efd4a4' })
      }
      if (bunker) {
        for (const side of [-1, 1]) trims.push({ position: [x + side * w * .22, y + h * .62, z + d / 2 + .015], scale: [w * .26, h * .25, .025], color: '#284e66' })
        // A shallow roof tile pattern gives the same solid cover an outpost silhouette.
        for (let tile = 0; tile < 5; tile++) trims.push({ position: [x + (tile - 2) * w * .17, y + h - .025, z], scale: [w * .145, .035, d * .84], color: tile % 2 ? '#e2a46f' : '#ecc391' })
      } else {
        for (let seam = 0; seam < 5; seam++) trims.push({ position: [x + (seam - 2) * w * .17, y + h * .5, z + d / 2 + .01], scale: [.022, h * .75, .025], color: '#b08f67' })
      }
    }
    return { stones, flowers, pads, trims }
    // Public terrain and static cover identities, not movement snapshots, own scatter uploads.
  }, [terrain, kind, obstacleKey])
  return <group name="Sunnydrop-connected-outpost">
    <Scatter entries={dressing.stones} /><Scatter entries={dressing.flowers} shape="flower" /><Scatter entries={dressing.pads} shape="box" /><Scatter entries={dressing.trims} shape="box" />
  </group>
}
