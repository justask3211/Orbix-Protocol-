import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Document } from '@gltf-transform/core';
import { createAssetIO, optimizeDocument } from './asset-pipeline.mjs';

for (const name of ['react', 'react-dom/client', 'three', '@react-three/fiber', '@react-three/drei',
  '@react-three/rapier', 'howler', 'motion/react', 'zustand', '@playwright/test', '@axe-core/playwright']) {
  const imported = await import(name);
  assert(Object.keys(imported).length > 0, `${name} exports nothing`);
  console.log(`IMPORT OK ${name}`);
}
const io = await createAssetIO();
const document = new Document();
const buffer = document.createBuffer();
const positions = document.createAccessor('triangle positions').setType('VEC3').setArray(new Float32Array([
  -1, 0, 0, 1, 0, 0, 0, 1, 0,
])).setBuffer(buffer);
const primitive = document.createPrimitive().setAttribute('POSITION', positions);
const mesh = document.createMesh('verification triangle').addPrimitive(primitive);
document.createScene('verification').addChild(document.createNode('triangle').setMesh(mesh));
const original = await io.writeBinary(document);
const decoded = await io.readBinary(original);
assert.equal(decoded.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getCount(), 3);
await optimizeDocument(decoded);
const optimized = await io.writeBinary(decoded);
const restored = await io.readBinary(optimized);
assert.equal(restored.getRoot().listMeshes().length, 1);
assert.equal(restored.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getCount(), 3);
assert(restored.getRoot().listExtensionsRequired().some((extension) => extension.extensionName === 'EXT_meshopt_compression'));
const temp = await mkdtemp(join(tmpdir(), 'orbix-asset-smoke-'));
try {
  const input = join(temp, 'source.glb');
  const output = join(temp, 'optimized.glb');
  await writeFile(input, original);
  const run = (...args) => spawnSync(process.execPath, ['scripts/assets.mjs', ...args], { encoding: 'utf8' });
  assert.equal(run('inspect', '--input', input).status, 0);
  const optimizedResult = run('optimize', '--input', input, '--output', output);
  assert.equal(optimizedResult.status, 0, optimizedResult.stderr);
  assert.equal(run('optimize', '--input', input, '--output', output).status, 1, 'Overwrite must fail');
  assert.deepEqual(new Uint8Array(await readFile(input)), original, 'Source asset must be preserved');
  assert.equal(run('optimize', '--input', input, '--output', input).status, 1, 'In-place edit must fail');
  console.log(`GLB + MESHOPT + CLI OK (${original.byteLength} → ${optimized.byteLength} bytes; tiny fixtures may grow)`);
} finally {
  assert(resolve(temp).startsWith(resolve(tmpdir()) + '\\') || resolve(temp).startsWith(resolve(tmpdir()) + '/'));
  assert(basename(temp).startsWith('orbix-asset-smoke-'));
  await rm(temp, { recursive: true, force: true });
}

const { default: RAPIER } = await import('@dimforge/rapier3d-compat');
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = 1 / 60;
world.createCollider(RAPIER.ColliderDesc.cuboid(5, 0.1, 5).setTranslation(0, -0.1, 0));
const ball = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 3, 0));
world.createCollider(RAPIER.ColliderDesc.ball(0.5), ball);
for (let step = 0; step < 180; step++) world.step();
assert(Math.abs(ball.translation().y - 0.5) < 0.03, 'Ball must settle on the ground');
world.free();
console.log('RAPIER WASM + FIXED STEP + COLLISION OK');
