import type { MeshStandardMaterial } from 'three'
export const CARTOON_SUITS: Record<string,{suit:string;armor:string;accent:string}> = {
  fox: {suit:'#ff9860',armor:'#ffc980',accent:'#ffe77a'},
  robot: {suit:'#57cadf',armor:'#a5eef2',accent:'#ffe986'},
  frog: {suit:'#88d65f',armor:'#cef295',accent:'#fff090'},
  cat: {suit:'#b997f1',armor:'#e3c9fa',accent:'#ffb8d2'},
}
export const CARTOON_TEAMS = ['#ffb275','#78d9ec','#b5ed78','#c3a2e8','#ecd07f','#ea9bb4']
export const CARTOON_PROPORTIONS = [1.15,.96,1.12] as const
/** Apply only to actor-owned clothing materials. Skin, eyes and source maps stay intact. */
export function cartoonFinish(material: MeshStandardMaterial, role: 'body' | 'cloth' = 'body') {
  if (role !== 'cloth') { material.map = null; material.normalMap = null }
  if (role !== 'cloth') { material.metalness = .02; material.roughness = .92 }
  material.flatShading = false
  material.emissive.copy(material.color)
  material.emissiveIntensity = .055
  // A soft contour inside the existing shading adds no outline mesh/draw call.
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      float orbixContour = smoothstep(0.08, 0.38, abs(dot(normal, normalize(vViewPosition))));
      outgoingLight *= mix(vec3(0.61, 0.67, 0.78), vec3(1.0), orbixContour);
      #include <opaque_fragment>`)
  }
  material.customProgramCacheKey = () => `orbix-cartoon-${role}-v2`
}
