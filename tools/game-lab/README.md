# Orbix game development lab

An isolated local fixture for the researched React 19 / Three / Fiber / Drei / Rapier toolchain. It does not modify the production web package, contracts, rewards, or multiplayer server. The island uses procedural geometry; the explorer and physics ball are local demonstrations.

From this directory, use PowerShell:

```powershell
.\run.ps1 install
.\run.ps1 verify
.\run.ps1 build
.\run.ps1 audit
.\run.ps1 dev
```

Open `http://127.0.0.1:5188`. Focus the island and use WASD/arrows, or hold the direction buttons. Start again resets the explorer. Keyboard focus loss, hidden tabs and cancelled pointers clear held input. Movement updates use refs; UI updates only when movement starts/stops. Physics steps at 60 Hz and the display adapts pixel ratio. This fixture is not a multiplayer latency or device-performance benchmark.

The runner uses bundled Node 24.19.0 and isolated npm 12.2.0 at `C:\Users\santh\.codex\orbix-tooling\npm`; PATH changes apply only to its process. `install` uses the lockfile and `--ignore-scripts`.

## Asset commands

```powershell
.\run.ps1 assets:inspect --input 'C:\path\model.glb'
.\run.ps1 assets:optimize --input 'C:\path\model.glb' --output 'C:\path\model.optimized.glb'
```

Input must be a local GLB or glTF; output must be a new GLB in an existing directory. Existing outputs and in-place editing are rejected. The original is preserved. NodeIO supports registered glTF extensions and Meshopt decoding; Draco input needs an additional decoder not provided here. Unknown required extensions may be rejected. This tool does not fetch remote models.

Optimization uses glTF Transform SDK 4.5.1: `dedup`, `resample`, `prune`, then Meshopt with medium geometry quantization via Meshoptimizer 1.3.0. Quantization can change geometry slightly: review the result before promotion. No texture resizing, KTX2 conversion, simplification or character retargeting occurs. Source licensing and metadata must be maintained separately. Tiny files can grow because compression has fixed overhead.

Official API references: [NodeIO](https://gltf-transform.dev/modules/core/classes/NodeIO), [Meshopt](https://gltf-transform.dev/modules/functions/functions/meshopt), [inspect](https://gltf-transform.dev/modules/functions/functions/inspect).

## Verification and limitations

`verify` imports the installed runtime and QA tools, serializes a real triangle to GLB, decodes and optimizes it, roundtrips Meshopt data, exercises the asset command and overwrite/source protections, then runs Rapier WASM fixed steps until a falling ball settles on its ground collider. Browser/WebGL/input checks are separate.

On 2026-10-05, npm 12.2.0 audit reported **0 vulnerabilities** after the CLI was replaced with its smaller SDK dependency set. This is a point-in-time package advisory result, not a security assessment of Orbix production.

The initial HTML/CSS/React shell and lazy 3D chunk are separate. The scene includes Rapier WASM and is substantially larger than the shell; this is a toolchain verification fixture, not a shipping size budget. Build output reports actual compressed sizes. Current dependencies emit harmless Three CJS and Rapier initializer deprecation warnings in the Node smoke check. Asset optimizations and desktop Blender availability are not proved by the browser fixture.
