/** Original Orbix toy equipment, authored in code. No downloaded/copyrighted art. */
import { BufferGeometry, Color, ConeGeometry, CylinderGeometry, ExtrudeGeometry, Float32BufferAttribute, Shape, SphereGeometry, TorusGeometry } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
export const ITEM_KINDS = ['coin','bomb','shield','gun','heal','push','upgrade','sword','spear'] as const
export type ItemKind = typeof ITEM_KINDS[number]
export function itemKind(value: unknown): ItemKind { return ITEM_KINDS.includes(value as ItemKind) ? value as ItemKind : 'upgrade' }
type Vector = [number, number, number]
export function makeItemGeometry(kind: ItemKind): BufferGeometry {
  const parts: BufferGeometry[] = []
  const part = (geometry: BufferGeometry, color: string, position: Vector = [0,0,0], rotation: Vector = [0,0,0], scale: Vector = [1,1,1]) => {
    const mesh = geometry.index ? geometry.toNonIndexed() : geometry
    if (mesh !== geometry) geometry.dispose()
    mesh.scale(...scale); mesh.rotateX(rotation[0]); mesh.rotateY(rotation[1]); mesh.rotateZ(rotation[2]); mesh.translate(...position)
    const tint = new Color(color), colors = new Float32Array(mesh.getAttribute('position').count * 3)
    for (let i = 0; i < colors.length; i += 3) { colors[i] = tint.r; colors[i+1] = tint.g; colors[i+2] = tint.b }
    mesh.setAttribute('color', new Float32BufferAttribute(colors,3)); parts.push(mesh)
  }
  const box = (size: Vector, tint: string, position: Vector = [0,0,0], rotation: Vector = [0,0,0]) => part(new RoundedBoxGeometry(...size, 1, Math.min(...size) * .2), tint, position, rotation)
  const sphere = (radius: number, tint: string, position: Vector, scale: Vector = [1,1,1]) => part(new SphereGeometry(radius,12,8),tint,position,[0,0,0],scale)
  const ring = (radius: number, tube: number, tint: string, position: Vector, rotation: Vector = [0,0,0]) => part(new TorusGeometry(radius,tube,6,20),tint,position,rotation)
  const cylinder = (r: number, height: number, tint: string, position: Vector, rotation: Vector = [0,0,0]) => part(new CylinderGeometry(r,r,height,12),tint,position,rotation)
  const extrude = (shape: Shape, depth: number) => new ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelSize:.025,bevelThickness:.018,bevelSegments:2,steps:1,curveSegments:6})
  if (kind === 'shield') {
    const shape = new Shape(); shape.moveTo(0,-.42); shape.bezierCurveTo(-.37,-.25,-.36,.13,-.32,.28); shape.quadraticCurveTo(0,.43,.32,.28); shape.bezierCurveTo(.36,.13,.37,-.25,0,-.42)
    part(extrude(shape,.065),'#fff0b5',[0,0,-.025]);part(extrude(shape,.07),'#43cbd0',[0,0,.04],[0,0,0],[.84,.84,1])
    box([.26,.055,.03],'#fff8dd',[0,0,.135]);box([.055,.26,.03],'#fff8dd',[0,0,.135]);ring(.05,.022,'#ffcc55',[0,0,.16])
    box([.12,.22,.08],'#356d82',[0,0,-.08])
  } else if (kind === 'gun') {
    box([.19,.20,.44],'#ffb45e',[0,.025,.16]);box([.15,.09,.30],'#36b7ca',[0,.15,.2]);cylinder(.054,.34,'#355775',[0,.065,.49],[Math.PI/2,0,0]);ring(.066,.02,'#baf4f0',[0,.065,.66])
    box([.12,.27,.11],'#416981',[0,-.16,.015],[.2,0,0]);box([.12,.16,.11],'#5ce0d0',[0,-.15,.24]);sphere(.065,'#68ecf1',[0,.23,.2]);box([.16,.1,.16],'#ffdf82',[0,.04,-.11])
  } else if (kind === 'heal') {
    box([.58,.4,.28],'#fff8df');box([.07,.25,.026],'#55bb76',[0,0,.159]);box([.25,.07,.026],'#55bb76',[0,0,.159]);ring(.10,.025,'#53aa9e',[0,.25,0]);box([.6,.055,.3],'#76deb3',[0,-.1,0])
  } else if (kind === 'push') {
    sphere(.22,'#f882b6',[0,.09,0],[1,.85,.9]);for (let i=0;i<4;i++) sphere(.069,'#ffafce',[(i-1.5)*.10,.21,.08]);box([.26,.11,.24],'#fff1d6',[0,-.15,0]);sphere(.085,'#ee6fac',[-.21,.01,.045])
  } else if (kind === 'upgrade') {
    box([.32,.52,.25],'#fbe26a');box([.15,.07,.14],'#496981',[0,.3,0]);box([.34,.055,.27],'#fff8d6',[0,-.16,0]);const bolt=new Shape();bolt.moveTo(.05,.2);bolt.lineTo(-.12,-.015);bolt.lineTo(-.025,-.015);bolt.lineTo(-.07,-.2);bolt.lineTo(.12,.045);bolt.lineTo(.025,.045);bolt.closePath();part(extrude(bolt,.02),'#f68571',[0,0,.155])
  } else if (kind === 'sword') {
    const blade = new Shape();blade.moveTo(-.065,.18);blade.lineTo(-.065,.86);blade.lineTo(0,1.04);blade.lineTo(.065,.86);blade.lineTo(.065,.18);blade.closePath();part(extrude(blade,.025),'#d4f3f5',[0,0,-.012]);box([.022,.61,.03],'#68cad7',[0,.52,.027]);box([.34,.07,.09],'#ffc96d',[0,.17,0]);cylinder(.052,.22,'#6b77b9',[0,0,0]);sphere(.07,'#ffcc77',[0,-.14,0])
  } else if (kind === 'spear') {
    cylinder(.025,1.4,'#da9967',[0,.35,0]);part(new ConeGeometry(.085,.3,6),'#bceff2',[0,1.17,0]);ring(.05,.017,'#ffe8a5',[0,1.015,0],[Math.PI/2,0,0]);box([.065,.16,.065],'#79c7ce')
  } else if (kind === 'bomb') {
    sphere(.25,'#424364',[0,0,0]);cylinder(.055,.1,'#7894aa',[0,.26,0]);ring(.09,.017,'#ffbe6b',[.07,.34,0],[Math.PI/2,0,.4]);sphere(.045,'#ff8a58',[.16,.35,0]);for (const side of [-1,1])sphere(.026,'#fff4cc',[side*.08,.055,.235]);box([.065,.02,.025],'#fff4cc',[0,-.035,.246])
  } else {
    cylinder(.24,.075,'#ffcf54',[0,0,0],[Math.PI/2,0,0]);ring(.19,.019,'#fff1a4',[0,0,.048]);ring(.09,.025,'#d89039',[0,0,.055])
  }
  // Keep the buffer layout uniform for merging; every part supplies position/normal/uv/color.
  const merged = mergeGeometries(parts,false)
  parts.forEach(part => part.dispose())
  if (!merged) throw new Error(`Cannot build Orbix ${kind}`)
  merged.computeBoundingSphere(); return merged
}
