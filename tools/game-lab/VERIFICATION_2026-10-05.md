# Game lab verification · 2026-10-05

Scope: isolated `tools/game-lab` tooling and local scene fixture. Orbix production web, contracts, settlement and multiplayer were not changed or tested by these checks.

## Environment and installation

- Bundled Node: **24.19.0**.
- Isolated npm: **12.2.0**, independently checked with its own CLI.
- Dependencies installed with `npm install --ignore-scripts --no-fund` and a generated lockfile.
- Replaced `@gltf-transform/cli` with SDK core/functions/extensions **4.5.1** and Meshoptimizer **1.3.0**. Installation removed 151 packages from the original isolated dependency tree.
- `run.ps1 install` uses `npm ci --ignore-scripts`; its Node/npm paths and PATH changes are scoped to the runner process.

## Observed successful checks

| Check | Result |
|---|---|
| TypeScript check and Vite production build | Passed |
| Runtime imports | React, React DOM, Three, Fiber, Drei, Rapier, Howler, Motion, Zustand passed |
| QA tool imports | Playwright and axe Playwright passed |
| Real GLB roundtrip | A 3-vertex triangle serialized and restored |
| Meshopt roundtrip | Required Meshopt extension and vertex count preserved |
| Asset command smoke | Local inspect and optimize exited successfully |
| Source and overwrite protection | Original bytes preserved; existing-output and in-place output rejected |
| Rapier WASM | Fixed 60 Hz stepping settled a falling ball on a ground collider within 0.03 world units of the expected height |
| npm advisory audit | **0 vulnerabilities** using npm 12.2.0 |

The miniature GLB changed from 580 to 1,016 bytes; compression overhead makes a tiny fixture larger. This is a functional roundtrip check, not evidence of asset-size improvement.

## Browser review

The coordinating agent's in-app browser review confirmed the colored 3D scene rendered, the ready label transitioned after loading, and reset/focus controls worked. Sustained movement or performance was **not** established: the available input helpers were insufficient for a controlled held-input experiment. No FPS, loading-time, GPU-memory, network-latency or mobile-performance target is claimed.

Scene updates use mutable position/body refs; React UI state changes only on movement start/stop. Physics readiness is announced by a component mounted inside the resolved Physics provider. A surrounding scene error boundary supplies a reload action, and Canvas provides an unsupported-WebGL message. Those error/fallback branches were reviewed in source and typechecked but were not forced in browser QA.

## Latest build output

| Artifact | Minified size | Gzip size |
|---|---:|---:|
| HTML | 0.42 kB | 0.29 kB |
| CSS | 4.04 kB | 1.51 kB |
| React/UI shell | 225.61 kB | 70.89 kB |
| Lazy scene including physics payload | 3,176.36 kB | 1,093.17 kB |
| Additional Rapier loader chunk | 2.67 kB | 1.18 kB |

Vite reports the large-scene-chunk warning; it was retained. The scene is a verification fixture and needs further payload/performance work before becoming a shipping arena. Node smoke imports emit upstream Three CJS and Rapier initializer deprecation warnings without failing the checks.

## Limits

No production deployment, wallet transaction, reward claim, authenticated multiplayer round, real-character retargeting, KTX2 encoding or Draco decoder integration was performed. Asset optimization currently changes geometry through quantization and requires visual review. npm audit is a point-in-time advisory check, not a production security assessment.
