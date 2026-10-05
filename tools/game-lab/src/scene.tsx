import { useEffect, useRef, type RefObject } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { Physics, RigidBody, CuboidCollider, type RapierRigidBody } from '@react-three/rapier';
import { Group, MathUtils } from 'three';
import { useState } from 'react';

export type Controls = { up: boolean; down: boolean; left: boolean; right: boolean };
type Props = { controls: RefObject<Controls>; reset: number; onReady: () => void; onMoving: (moving: boolean) => void };

function Explorer({ controls, reset, onMoving }: Props) {
  const body = useRef<RapierRigidBody>(null);
  const avatar = useRef<Group>(null);
  const location = useRef({ x: 0, y: 0.75, z: 1 });
  const lastMoving = useRef(false);
  const elapsed = useRef(0);
  useEffect(() => { location.current = { x: 0, y: 0.75, z: 1 }; body.current?.setTranslation(location.current, true); }, [reset]);
  useEffect(() => {
    const clear = () => { Object.keys(controls.current).forEach((key) => { controls.current[key as keyof Controls] = false; }); };
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
    return () => { window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', clear); };
  }, [controls]);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30);
    const x = Number(controls.current.right) - Number(controls.current.left);
    const z = Number(controls.current.down) - Number(controls.current.up);
    const length = Math.hypot(x, z);
    const moving = length > 0;
    if (moving !== lastMoving.current) { onMoving(moving); lastMoving.current = moving; }
    if (moving) {
      location.current.x = MathUtils.clamp(location.current.x + x / length * dt * 3, -4.5, 4.5);
      location.current.z = MathUtils.clamp(location.current.z + z / length * dt * 3, -2.8, 3.5);
      if (avatar.current) avatar.current.rotation.y = Math.atan2(x, z);
    }
    body.current?.setNextKinematicTranslation(location.current);
    elapsed.current += dt;
    if (avatar.current) avatar.current.position.y = moving ? Math.sin(elapsed.current * 14) * 0.06 : 0;
  });
  return <RigidBody ref={body} type="kinematicPosition" position={[0, 0.75, 1]} colliders={false}>
    <CuboidCollider args={[0.3, 0.6, 0.3]} />
    <group ref={avatar} name="explorer">
      <mesh position={[0, 0.05, 0]} castShadow><capsuleGeometry args={[0.32, 0.32, 4, 12]} /><meshStandardMaterial color="#ff9654" roughness={0.7} /></mesh>
      <mesh position={[0, 0.6, 0]} castShadow><sphereGeometry args={[0.32, 16, 12]} /><meshStandardMaterial color="#fbe5c5" /></mesh>
      <mesh position={[0, 0.8, -0.04]} castShadow><sphereGeometry args={[0.34, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#733bd8" /></mesh>
      <mesh position={[0, 0.8, 0.22]}><boxGeometry args={[0.42, 0.06, 0.32]} /><meshStandardMaterial color="#733bd8" /></mesh>
      {[-0.11, 0.11].map((x) => <mesh key={x} position={[x, 0.64, 0.29]}><sphereGeometry args={[0.035, 8, 8]} /><meshStandardMaterial color="#302a35" /></mesh>)}
      {[-0.2, 0.2].map((x) => <mesh key={x} position={[x, -0.5, 0.12]} castShadow><boxGeometry args={[0.23, 0.2, 0.38]} /><meshStandardMaterial color="#6530ba" /></mesh>)}
      <mesh position={[0, 0.08, -0.32]} castShadow><boxGeometry args={[0.43, 0.5, 0.24]} /><meshStandardMaterial color="#fed565" /></mesh>
    </group>
  </RigidBody>;
}

function Tree({ x, z, color, scale = 1 }: { x: number; z: number; color: string; scale?: number }) {
  return <group position={[x, 0, z]} scale={scale}>
    <mesh position={[0, 0.5, 0]} castShadow><cylinderGeometry args={[0.09, 0.15, 1, 8]} /><meshStandardMaterial color="#ca9478" /></mesh>
    <mesh position={[0, 1.5, 0]} castShadow><icosahedronGeometry args={[0.85, 1]} /><meshStandardMaterial color={color} roughness={1} /></mesh>
  </group>;
}
function PhysicsReady({ onReady }: { onReady: () => void }) {
  // Mounted within Physics, after its WASM promise has resolved.
  const notify = useRef(onReady);
  useEffect(() => notify.current(), []);
  return null;
}
function World(props: Props) {
  return <>
    <color attach="background" args={['#c4ede9']} />
    <fog attach="fog" args={['#c4ede9', 18, 35]} />
    <ambientLight intensity={1.5} />
    <directionalLight position={[5, 9, 5]} intensity={2.4} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} />
    <mesh position={[0, -0.15, 0]} receiveShadow><boxGeometry args={[12, 0.3, 10]} /><meshStandardMaterial color="#a8d9a0" roughness={1} /></mesh>
    <mesh position={[0, -0.9, 0]}><boxGeometry args={[11.7, 1.4, 9.7]} /><meshStandardMaterial color="#c78c6e" /></mesh>
    <mesh position={[0, 0.01, 1]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[11, 1.7]} /><meshStandardMaterial color="#f6dbac" /></mesh>
    <mesh position={[1.8, 0.025, -1.4]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[1.3, 32]} /><meshStandardMaterial color="#76cbdc" /></mesh>
    <Tree x={-3.8} z={-2.8} color="#57b9a0" scale={1.4} /><Tree x={-2.1} z={-3.1} color="#8982d9" /><Tree x={4.1} z={-2.5} color="#ffb877" scale={1.2} /><Tree x={4.5} z={3.1} color="#59b49c" />
    {[-3, -1.5, 0, 1.5, 3].map((x, i) => <mesh key={x} position={[x, 0.17, 3.6]} castShadow><icosahedronGeometry args={[0.2, 0]} /><meshStandardMaterial color={['#ffa083', '#9a81e0', '#f4cf65'][i % 3]} /></mesh>)}
    <Physics timeStep={1 / 60}>
      <PhysicsReady onReady={props.onReady} />
      <RigidBody type="fixed" colliders={false}><CuboidCollider args={[6, 0.15, 5]} position={[0, -0.15, 0]} /></RigidBody>
      <Explorer {...props} />
      <RigidBody position={[-1.8, 3, -1]} restitution={0.65} colliders="ball"><mesh castShadow><sphereGeometry args={[0.45, 20, 16]} /><meshStandardMaterial color="#d39ceb" roughness={0.35} /></mesh></RigidBody>
    </Physics>
  </>;
}
export default function Scene(props: Props) {
  const [dpr, setDpr] = useState(1.5);
  return <Canvas shadows dpr={dpr} camera={{ position: [10, 9, 13], fov: 38 }} onCreated={({ camera }) => camera.lookAt(0, 0.5, 0)} fallback={<div className="loading" role="alert">Your browser cannot render this 3D island. Try enabling hardware acceleration.</div>}>
    <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(1.5)}><World {...props} /></PerformanceMonitor>
  </Canvas>;
}
