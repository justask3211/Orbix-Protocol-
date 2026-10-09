import { useLayoutEffect, useMemo, useRef } from 'react'
import { Color, InstancedMesh, Object3D } from 'three'
export type ScatterEntry = { position: [number, number, number]; scale: [number, number, number]; yaw?: number; color: string }
/** Original static scatter: one draw per shape/material, no render-loop uploads. */
export function Scatter({ entries, shape = 'stone' }: { entries: ScatterEntry[]; shape?: 'stone' | 'box' | 'flower' }) {
  const ref = useRef<InstancedMesh>(null), object = useMemo(() => new Object3D(), []), color = useMemo(() => new Color(), [])
  useLayoutEffect(() => {
    if (!ref.current) return
    entries.forEach((e, i) => { object.position.set(...e.position); object.scale.set(...e.scale); object.rotation.set(0, e.yaw ?? 0, 0); object.updateMatrix(); ref.current!.setMatrixAt(i, object.matrix); ref.current!.setColorAt(i, color.set(e.color)) })
    ref.current.count = entries.length; ref.current.instanceMatrix.needsUpdate = true
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true
    ref.current.computeBoundingSphere()
  }, [entries, object, color])
  return <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, entries.length)]} receiveShadow>
    {shape === 'box' ? <boxGeometry /> : shape === 'flower' ? <octahedronGeometry args={[1, 0]} /> : <icosahedronGeometry args={[1, 0]} />}
    <meshStandardMaterial roughness={.94} />
  </instancedMesh>
}
