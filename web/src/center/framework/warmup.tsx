import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Material, Texture } from 'three'

/** Readiness follows loaded rigs, uploaded textures, compiled shaders and warm frames. */
export function WorldWarmup({ assetsReady, onReady }: { assetsReady: boolean; onReady: () => void }) {
  const { gl, scene, camera } = useThree(), compiled = useRef(false), frames = useRef(0), notified = useRef(false)
  useEffect(() => {
    if (!assetsReady) return
    let cancelled = false
    compiled.current = false; frames.current = 0; notified.current = false
    const textures = new Set<Texture>()
    scene.traverse(object => {
      const material = (object as unknown as { material?: Material | Material[] }).material
      for (const m of material ? Array.isArray(material) ? material : [material] : []) for (const value of Object.values(m)) if (value instanceof Texture) textures.add(value)
    })
    for (const texture of textures) gl.initTexture(texture)
    // compileAsync rejection falls back to synchronous compile, retaining usable controls.
    void gl.compileAsync(scene, camera).catch(() => { if (!cancelled) gl.compile(scene, camera) }).then(() => { if (!cancelled) compiled.current = true })
    return () => { cancelled = true }
  }, [assetsReady, gl, scene, camera])
  useFrame(() => {
    if (!compiled.current || notified.current) return
    if (++frames.current >= 3) { notified.current = true; onReady() }
  })
  return null
}
