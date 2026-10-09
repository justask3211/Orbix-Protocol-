import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { CanvasTexture, Color, InstancedMesh, Object3D, Sprite, SRGBColorSpace } from 'three'
import { HealthTrack, healthRatio } from './health'
import type { MotionPose } from '../worlds/motion'
type State = Record<string, any>
type Label = { key: string; amount: number; x: number; y: number; z: number; at: number }

function DamageNumber({ label, reducedMotion }: { label: Label; reducedMotion?: boolean }) {
  const ref = useRef<Sprite>(null)
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64
    const c = canvas.getContext('2d')!
    c.font = 'bold 40px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 5; c.strokeStyle = '#273a3d'; c.fillStyle = '#ffe2a1'
    c.strokeText(`−${Math.round(label.amount)}`, 64, 32); c.fillText(`−${Math.round(label.amount)}`, 64, 32)
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; return texture
  }, [label.amount])
  useEffect(() => () => texture.dispose(), [texture])
  useFrame(() => {
    if (!ref.current) return
    const age = performance.now() - label.at
    ref.current.visible = age < 900
    ref.current.position.set(label.x, label.y + (reducedMotion ? 0 : Math.min(.6, age / 1500)), label.z)
    const material = ref.current.material; material.opacity = Math.max(0, 1 - age / 900)
  })
  return <sprite ref={ref} scale={[.95, .475, 1]}><spriteMaterial map={texture} depthTest={false} depthWrite={false} transparent toneMapped={false} /></sprite>
}

/** Identical confirmed health feedback for players and guardian, with bounded pooled indicators. */
export function HealthFeedback({ state, poses, me, firstPerson, reducedMotion }: { state: State; poses: Map<string, MotionPose>; me: string; firstPerson?: boolean; reducedMotion?: boolean }) {
  const tracks = useRef(new Map<string, HealthTrack>()), round = useRef(state.roundId), [labels, setLabels] = useState<Label[]>([])
  const bars = useRef<InstancedMesh>(null), impacts = useRef<InstancedMesh>(null), object = useMemo(() => new Object3D(), []), color = useMemo(() => new Color(), [])
  const entities: [string, State][] = Object.entries(state.bodies ?? {}).slice(0, 50) as [string, State][]
  if (state.boss) entities.push(['guardian', state.boss])
  useEffect(() => {
    const now = performance.now(), added: Label[] = []
    if (round.current !== state.roundId) { tracks.current.clear(); setLabels([]); round.current = state.roundId }
    const alive = new Set<string>()
    for (const [id, body] of entities) {
      alive.add(id)
      const track = tracks.current.get(id) ?? new HealthTrack(); tracks.current.set(id, track)
      const amount = track.observe(Number(body.hp), state.roundId, now, body.respawnAt)
      if (amount) added.push({ key: `${id}-${state.tick}-${body.hp}-${now}`, amount, x: body.x ?? 0, y: (body.y ?? 0) + (id === 'guardian' ? 4.4 : 2.25), z: body.z ?? 0, at: now })
    }
    for (const id of tracks.current.keys()) if (!alive.has(id)) tracks.current.delete(id)
    if (added.length) setLabels(old => [...old.filter(l => now - l.at < 900), ...added].slice(-12))
  }, [state])
  useFrame(({ camera }) => {
    if (!bars.current || !impacts.current) return
    entities.forEach(([id, body], i) => {
      const pose = poses.get(id) ?? body, boss = id === 'guardian', hidden = id === me && firstPerson, ratio = healthRatio(body.hp, body.maxHp ?? 100)
      object.position.set(pose.x ?? 0, (pose.y ?? 0) + (boss ? 4.3 : 2.08), pose.z ?? 0); object.quaternion.copy(camera.quaternion); object.scale.set(hidden ? 0 : boss ? 2.4 : .7, boss ? .09 : .05, .02); object.updateMatrix()
      bars.current!.setMatrixAt(i * 2, object.matrix); bars.current!.setColorAt(i * 2, color.set('#24373e'))
      object.scale.x *= ratio; object.translateZ(.006); object.updateMatrix(); bars.current!.setMatrixAt(i * 2 + 1, object.matrix); bars.current!.setColorAt(i * 2 + 1, color.set(ratio < .3 ? '#ee927e' : '#b5d695'))
      const hit = reducedMotion ? 0 : tracks.current.get(id)?.intensity(performance.now()) ?? 0
      object.position.set(pose.x ?? 0, (pose.y ?? 0) + (boss ? 2 : .95), pose.z ?? 0); object.rotation.set(0, 0, 0); object.scale.setScalar(hidden || hit <= 0 ? 0 : (boss ? 1.7 : .56) * (1 + (1 - hit) * .3)); object.updateMatrix(); impacts.current!.setMatrixAt(i, object.matrix)
    })
    bars.current.count = entities.length * 2; impacts.current.count = entities.length
    bars.current.instanceMatrix.needsUpdate = true; impacts.current.instanceMatrix.needsUpdate = true
    if (bars.current.instanceColor) bars.current.instanceColor.needsUpdate = true
  }, -1.2)
  return <>
    <instancedMesh ref={bars} args={[undefined, undefined, 102]} frustumCulled={false}><boxGeometry /><meshBasicMaterial toneMapped={false} /></instancedMesh>
    <instancedMesh ref={impacts} args={[undefined, undefined, 51]} frustumCulled={false}><icosahedronGeometry args={[1, 0]} /><meshBasicMaterial color="#ffe9b0" wireframe transparent opacity={.65} depthWrite={false} /></instancedMesh>
    {labels.map(label => <DamageNumber key={label.key} label={label} reducedMotion={reducedMotion} />)}
  </>
}
