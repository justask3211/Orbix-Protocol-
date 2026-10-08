import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CylinderGeometry, Group, MathUtils, MeshStandardMaterial, SphereGeometry, TorusGeometry, type BufferGeometry } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { makeItemGeometry } from './ItemAssets'
import type { GameWorldProps } from './GameWorld'

type Vec3 = [number, number, number]
const number = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const SUITS: Record<string, string> = { fox: '#b76c49', robot: '#578d9d', frog: '#7b9356', cat: '#947ab2' }
function Part({ geometry, material, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0] }: { geometry: BufferGeometry; material: MeshStandardMaterial; position?: Vec3; scale?: Vec3; rotation?: Vec3 }) {
  return <mesh geometry={geometry} material={material} position={position} scale={scale} rotation={rotation} renderOrder={120} />
}

/** Original first-person gloves/equipment. Inventory and animation cues are server-confirmed. */
export default function FirstPersonModel({ state, me, cameraRef, inputRef, reducedMotion }: GameWorldProps) {
  const root = useRef<Group>(null), left = useRef<Group>(null), right = useRef<Group>(null)
  const shield = useRef<import('three').Mesh>(null)
  const gun = useRef<Group>(null), sword = useRef<Group>(null), spear = useRef<Group>(null), muzzle = useRef<Group>(null), foot = useRef<Group>(null)
  const received = useRef(performance.now()), body = state.bodies?.[me]
  const assets = useMemo(() => {
    const box = new RoundedBoxGeometry(1, 1, 1, 1, .12), joint = new SphereGeometry(1, 6, 4)
    const cylinder = new CylinderGeometry(1, 1, 1, 6, 1), ring = new TorusGeometry(1, .18, 4, 10)
    const material = (color: string, roughness: number, metalness = 0, emissive?: string) => new MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity: emissive ? .9 : 0, depthTest: false, depthWrite: false })
    return { shieldGeo: makeItemGeometry('shield'), shieldMaterial: new MeshStandardMaterial({vertexColors:true,roughness:.65,depthTest:false,depthWrite:false}), box, joint, cylinder, ring, sleeve: material(SUITS[body?.character] || SUITS.fox, .87), glove: material('#343c43', .88), knuckle: material('#626d78', .58, .12), metal: material('#526470', .36, .62), dark: material('#25323c', .65, .3), warm: material('#baa074', .50, .55), blade: material('#c8d6df', .24, .82), glass: material('#68b6c5', .18, .45), flash: material('#ffe8ad', .25, .05, '#ffc658') }
  }, [body?.character])
  useEffect(() => () => {
    for (const geometry of [assets.box, assets.joint, assets.cylinder, assets.ring, assets.shieldGeo]) geometry.dispose()
    for (const material of [assets.shieldMaterial, assets.sleeve, assets.glove, assets.knuckle, assets.metal, assets.dark, assets.warm, assets.blade, assets.glass, assets.flash]) material.dispose()
  }, [assets])
  useEffect(() => { received.current = performance.now() }, [state.serverTimeMs])
  useFrame(({ camera, clock }, delta) => {
    if (!root.current) return
    const now = number(state.serverTimeMs, Date.now()) + Math.min(250, performance.now() - received.current)
    root.current.visible = !!body && cameraRef?.current.mode === 'first' && number(body.hp, 100) > 0 && number(body.respawnAt) <= now
    if (!root.current.visible) return
    root.current.position.copy(camera.position); root.current.quaternion.copy(camera.quaternion)
    if (shield.current) shield.current.visible = number(body.shieldUntil) > now
    const weapon = body.weapon, age = (now - number(body.lastAttackAt)) / 1000, style = body.lastAttackStyle
    const acceptedWeapon = body.lastAttackWeapon || weapon
    const duration = style === 'heavy' ? .62 : style === 'kick' ? .72 : acceptedWeapon === 'gun' ? .20 : .40
    const attack = age >= 0 && age < duration ? Math.sin(Math.PI * age / duration) : 0
    const fistAttack = attack > 0 && (acceptedWeapon === 'fists' || style === 'punch') && style !== 'kick'
    const punch = fistAttack ? attack : 0
    const blocking = !!body.blocking
    const moving = Math.hypot(number(body.dx), number(body.dz)) > .1 || !!inputRef?.current.active
    const bob = reducedMotion || !moving ? 0 : Math.sin(clock.elapsedTime * (body.sprinting ? 13 : 9)) * .007
    const sway = reducedMotion || !moving ? 0 : Math.sin(clock.elapsedTime * 4.5) * .009
    if (right.current) {
      const baseX = blocking ? .20 : weapon === 'gun' && !fistAttack ? .25 : .27
      const baseY = blocking ? -.11 : -.27
      right.current.position.set(baseX + sway - punch * .12, baseY + bob + punch * .14, -.46 - punch * .36 + (acceptedWeapon === 'gun' ? attack * .055 : 0))
      right.current.rotation.set(blocking ? -.36 : fistAttack ? -attack * .23 : 0, fistAttack ? -attack * .22 : 0, blocking ? -.42 : weapon === 'sword' || weapon === 'spear' ? -attack * 1.0 : 0)
    }
    if (left.current) {
      left.current.position.set(blocking ? -.20 : weapon === 'gun' && !fistAttack ? .09 : -.27 + sway, blocking ? -.11 : weapon === 'gun' ? -.32 + bob : -.29 + bob, weapon === 'gun' && !fistAttack ? -.68 : -.47)
      left.current.rotation.set(blocking ? -.36 : weapon === 'gun' ? .4 : 0, weapon === 'gun' ? .18 : 0, blocking ? .42 : weapon === 'gun' ? -.38 : 0)
    }
    if (gun.current) { gun.current.visible = weapon === 'gun' && !fistAttack && !(style === 'kick' && attack > 0); gun.current.rotation.x = -attack * .06 }
    if (sword.current) { sword.current.visible = weapon === 'sword' && !fistAttack; sword.current.rotation.z = -attack * .75; sword.current.rotation.x = -attack * .35 }
    if (spear.current) { spear.current.visible = weapon === 'spear' && !fistAttack; spear.current.position.z = -.30 - attack * .45 }
    if (muzzle.current) { muzzle.current.visible = acceptedWeapon === 'gun' && age >= 0 && age < .075 && weapon === 'gun'; muzzle.current.scale.setScalar(reducedMotion ? .45 : .65 + Math.sin(age * 180) * .2) }
    if (foot.current) { const kicking = style === 'kick' && attack > 0; foot.current.visible = kicking; foot.current.position.set(.07, -.66 + attack * .26, -.46 - attack * .44); foot.current.rotation.x = -.28 + attack * .62 }
    assets.flash.emissiveIntensity = reducedMotion ? .25 : MathUtils.damp(assets.flash.emissiveIntensity, 1.2, 8, delta)
  }, -.8)
  const a = assets
  const hand = (side: number) => <group ref={side < 0 ? left : right} key={side}>
    <Part geometry={a.box} material={a.sleeve} position={[side * .035, -.07, .19]} scale={[.105, .13, .30]} rotation={[.25, side * .08, 0]} />
    <Part geometry={a.cylinder} material={a.glove} position={[0, -.016, .062]} scale={[.064, .065, .064]} rotation={[Math.PI / 2, 0, 0]} />
    <Part geometry={a.box} material={a.glove} position={[0, .006, -.002]} scale={[.116, .086, .14]} />
    <Part geometry={a.box} material={a.knuckle} position={[0, .052, -.045]} scale={[.103, .021, .05]} />
    {[0, 1, 2, 3].map(index => <group key={index} position={[(index - 1.5) * .027, .004, -.073]}>
      <Part geometry={a.cylinder} material={a.glove} position={[0, -.015, -.028]} scale={[.0125, .056, .0125]} rotation={[Math.PI / 2 - .45, 0, 0]} />
      <Part geometry={a.joint} material={a.knuckle} position={[0, -.035, -.054]} scale={[.016, .016, .015]} />
      <Part geometry={a.cylinder} material={a.glove} position={[0, -.051, -.04]} scale={[.012, .034, .012]} rotation={[-.4, 0, 0]} />
    </group>)}
    <Part geometry={a.cylinder} material={a.glove} position={[side * -.069, -.004, -.031]} scale={[.015, .062, .015]} rotation={[.15, 0, side * .55]} />
    <Part geometry={a.joint} material={a.knuckle} position={[side * -.057, .022, -.042]} scale={[.018, .022, .018]} />
  </group>
  return <group ref={root} visible={false} dispose={null}>
    {[-1, 1].map(hand)}
    <mesh ref={shield} geometry={a.shieldGeo} material={a.shieldMaterial} position={[-.26,-.20,-.57]} scale={.48} rotation={[0,.2,0]} visible={false} renderOrder={122} />
    <group ref={gun} position={[.255, -.245, -.53]} visible={false}>
      <Part geometry={a.box} material={a.dark} position={[0, .017, -.19]} scale={[.102, .13, .36]} />
      <Part geometry={a.box} material={a.metal} position={[0, .055, -.29]} scale={[.075, .051, .30]} />
      <Part geometry={a.cylinder} material={a.metal} position={[0, .026, -.48]} scale={[.024, .22, .024]} rotation={[Math.PI / 2, 0, 0]} />
      <Part geometry={a.cylinder} material={a.dark} position={[0, .026, -.60]} scale={[.034, .035, .034]} rotation={[Math.PI / 2, 0, 0]} />
      <Part geometry={a.box} material={a.dark} position={[0, -.081, -.069]} scale={[.072, .18, .066]} rotation={[-.19, 0, 0]} />
      <Part geometry={a.box} material={a.metal} position={[0, -.093, -.232]} scale={[.065, .175, .09]} rotation={[.12, 0, 0]} />
      <Part geometry={a.box} material={a.knuckle} position={[0, .005, .064]} scale={[.084, .072, .19]} />
      <Part geometry={a.box} material={a.dark} position={[0, -.025, .157]} scale={[.11, .135, .043]} />
      <Part geometry={a.cylinder} material={a.dark} position={[0, .112, -.22]} scale={[.033, .15, .033]} rotation={[Math.PI / 2, 0, 0]} />
      <Part geometry={a.cylinder} material={a.glass} position={[0, .112, -.137]} scale={[.027, .007, .027]} rotation={[Math.PI / 2, 0, 0]} />
      <Part geometry={a.box} material={a.warm} position={[.054, .035, -.20]} scale={[.009, .026, .085]} />
      <Part geometry={a.ring} material={a.metal} position={[0, -.039, -.07]} scale={[.028, .042, .028]} rotation={[0, Math.PI / 2, 0]} />
      <group ref={muzzle} position={[0, .026, -.639]} visible={false}><Part geometry={a.joint} material={a.flash} scale={[.067, .058, .12]} /></group>
    </group>
    <group ref={sword} position={[.25, -.25, -.53]} rotation={[-.20, 0, .10]} visible={false}>
      <Part geometry={a.cylinder} material={a.dark} scale={[.025, .19, .025]} />
      <Part geometry={a.box} material={a.warm} position={[0, .115, 0]} scale={[.23, .038, .055]} />
      <Part geometry={a.box} material={a.blade} position={[0, .47, 0]} scale={[.072, .65, .027]} />
      <Part geometry={a.box} material={a.metal} position={[0, .47, -.015]} scale={[.009, .60, .010]} />
      <Part geometry={a.joint} material={a.warm} position={[0, -.13, 0]} scale={[.042, .042, .035]} />
    </group>
    <group ref={spear} position={[.25, -.26, -.30]} rotation={[1.13, 0, .035]} visible={false}>
      <Part geometry={a.cylinder} material={a.warm} position={[0, .41, 0]} scale={[.020, 1.43, .020]} />
      <Part geometry={a.box} material={a.blade} position={[0, 1.17, 0]} scale={[.07, .22, .019]} rotation={[0, 0, -.06]} />
      <Part geometry={a.cylinder} material={a.dark} position={[0, .17, 0]} scale={[.028, .25, .028]} />
    </group>
    <group ref={foot} visible={false}><Part geometry={a.box} material={a.glove} scale={[.145, .13, .26]} /><Part geometry={a.box} material={a.knuckle} position={[0, -.052, -.035]} scale={[.13, .020, .20]} /></group>
  </group>
}
