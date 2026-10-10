# Orbix engine analysis — R0, 2026-10-09

> Current decision, later on 2026-10-10: product-owner feedback supersedes the Babylon adoption/default addendum in this historical analysis. Three.js is the Token Catch default; Babylon remains an explicit experimental route. See [renderer-verdict-2026-10-10.md](renderer-verdict-2026-10-10.md) for the visual-quality correction and deferred parity requirements.

Decision made before runtime edits: retain Three.js/R3F and Python authority;
adopt MIT cannon-es for presentation surface/camera collision queries. No second
renderer, WebGPU requirement, backend migration, or changes to money flows.

## Inputs and provenance

Inspected React 19 / Vite 8 / Three 0.186 / Fiber 9 package manifest, V4
ArenaWorld, MotionTrack, TerrainArenaEngine, skeletal rigs, loading/warmup and
practice paths. The requested `docs/reviews/CHATGPT_GAME_STACK_REVIEW.md` is absent
from this checkout and searchable local Git history. Its contents were not read.
The user's supplied conclusion (upgrade the existing renderer with reusable
controllers/assets/physics/animation) is the architectural requirement; the
exact review Phase 1–4 checklist remains unverified. The loading research was
recovered verbatim from commit `3e3fb98e`, rather than inventing replacement targets.

Constraints: embedded React SPA at /center, mobile WebGL, small selected-game
transfers, wallet/session shell preserved, working authoritative 30Hz simulation,
10Hz snapshots and acknowledged input replay; only CC0/MIT additions. Engine
source licensing and exported artwork licensing are separate decisions.

## Babylon.js: concrete system verdicts

[Official modular packaging](https://doc.babylonjs.com/setup/frameworkPackages/es6Support/treeShaking/usingPureImports/)
and [source/license](https://github.com/BabylonJS/Babylon.js) reviewed. Core is
Apache-2.0, outside the requested runtime license allowlist. ES modules/pure imports
can reduce payload; the measured full API is an upper scope comparison, not the
minimum size of a Babylon game. React can host an imperative engine/canvas in an
effect, but existing R3F meshes, materials, skeletons and hooks cannot run on it;
adding it alongside Three duplicates scene ownership and GPU resource lifecycle.

| System | Strength | Orbix decision |
|---|---|---|
| Rendering/PBR | Integrated PBR tooling, material inspector, glTF workflows | Keep Three MeshStandardMaterial; adopt roughness/color-space discipline as technique |
| Lighting | Environment lighting, cascades, node materials | Adopt warm key/cool fill and fog principles; reject cascades/postprocessing on fast tier |
| Camera | Mature orbit/follow rigs, collision conventions | Independently implement boom collision, look-ahead and immediate inward response |
| Controller | Character movement, contacts, slopes/steps through physics integration | Adopt separation of velocity, support and animation; do not import Babylon objects |
| Animation | Animation groups/layers and state conventions | Implement typed local FSM over existing AnimationMixer |
| React/wallet | Can embed canvas under React, no intrinsic wallet advantage | Reject replacement: would rebuild working lifecycle/input/GLB code |

Neither Babylon runtime nor its character-controller code is copied. Its
Apache license is not inherently unsafe: it simply fails this task's MIT/CC0 rule.

## PlayCanvas: usable authoring, unnecessary runtime

[Engine](https://developer.playcanvas.com/user-manual/engine/) is MIT. Scene
hierarchies/templates, inspector and glTF material workflows offer useful scene
authoring. [Editor v2.10.0 release](https://github.com/playcanvas/editor/releases/tag/v2.10.0)
explicitly added **Export as GLB** for hierarchy entities. Thus an environment
can be authored there and exported to our GLTFLoader. Older claims that export
requires a custom script are stale. This proves the feature exists, not that a
specific Orbix scene has passed a roundtrip.

Use a visual-only hierarchy, meters, Y-up, PBR/vertex colors and baked transforms.
Export GLB, verify scale/materials/animations in our browser, generate immutable
source/hash/license manifest, and keep collision layout in the server's published
obstacle data. Scripts, gameplay components, Ammo collision settings, editor
animation graphs, scene ambient settings and reward logic are not transferable
GLB behaviors. Copying scene JSON into Three is not a clean export path. Editor
hosting/service terms are separate from the MIT engine license. Optional authoring
workflow approved; no PlayCanvas runtime dependency or required cloud editor.

## Godot 4: offline interchange, reject web-runtime migration

[Web export documentation](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)
requires WebGL2/Compatibility rendering; Forward+/Mobile rendering are not web
backends. Single-thread exports avoid SharedArrayBuffer isolation requirements;
threaded exports require cross-origin isolation headers and impose embedding and
third-party resource constraints. C# web export limitations, audio/autoplay and
mobile GPU/memory restrictions matter. Do not repeat the obsolete blanket claim
that all Godot 4 web builds require threads or cannot run on iOS.

A web build adds WASM engine plus project resources, download/init/memory overhead,
and a JavaScript bridge for our wallet and existing snapshots. No Godot export was
built here, so its exact bytes and phone frame time are **unmeasured**. That cost
and a rewrite are unjustified with functioning Three presentation.

Godot itself is MIT. [Offline GLB export](https://docs.godotengine.org/en/stable/tutorials/assets_pipeline/exporting_3d_scenes.html)
is the useful option: block out connected terrain/props or pose/animate licensed
characters, export meshes/skeleton/animations, and validate through GLTFLoader.
Godot scripts, physics, particles/shaders and navigation cannot be assumed to
survive GLB export. Reject Godot runtime, accept optional offline authoring; no
claim of a completed Godot/PlayCanvas roundtrip in this delivery.

## Three.js + R3F incumbent

MIT, already owns our loaded rig/LOD meshes, materials, camera, lifecycle, quality
controls, first-person hands and cached assets. R3F composes this into the same
React tree as session/wallet controls; scenes are lazy loaded. AnimationMixer,
GLTFLoader and SkeletonUtils already exist; there is no reason to replace them.
Three lacks a game framework: no built-in gameplay FSM, health semantics or
kinematic character-controller policy. Orbix already has bounded MotionTrack
prediction, interpolation, terrain parity and speed-matched planted gaits; reuse
these, add explicit FSM/event windows, ground IK, camera queries, instancing and
confirmed-health presentation. Do not claim Three needs a second engine for PBR.

## Physics comparison and measured decision

Reproduce `tools/research/engine-benchmark.mjs` using the pinned versions in
`evidence/engine-benchmark.json`; install candidates outside production. esbuild
minifies each full public API, gzip includes compat embedded WASM. Inactive
Node-only branches externalized; not a deployable multi-engine build. CPU fixture:
40 static boxes + floor + 50 falling spheres, 120 warmup + 600 timed 60Hz steps,
Linux x64 Node 22. One noisy host run, no renderer, no mobile claims; sleeping
bodies and unequal solver semantics prevent a universal speed ranking.

| Candidate | Actual package license | Minified / gzip bytes | CPU step p50 / p95 ms | Verdict |
|---|---|---:|---:|---|
| Rapier compat 0.21.0 | **Apache-2.0**, not MIT | 4,337,165 / 1,645,473 | 0.116 / 5.197 | Reject this task: license rule + transfer cost |
| cannon-es 0.20.0 | MIT | 123,555 / 36,161 | 0.360 / 6.371 | Select for bounded presentation queries |
| Jolt 1.1.0 compat | MIT | 3,998,819 / 952,524 | 0.181 / 2.216 | Reject: bindings/ownership/WASM cost for no required dynamic simulation |
| Babylon core 9.30.0 | Apache-2.0 | 8,189,759 / 1,838,719 | not benchmarked | Reject runtime migration |
| PlayCanvas 2.23.1 | MIT | 2,519,436 / 655,607 | not benchmarked | Authoring option; reject redundant runtime |

Rapier has built-in capsule sweeps, autostep and slope/snap settings ([official
controller](https://rapier.rs/docs/user_guides/javascript/character_controller/));
cannon-es needs custom movement policy. Jolt offers character/rigid-body systems
but requires careful native allocation disposal. A 6.37ms p95 dynamic cannon
simulation would exceed a 4ms animation/work target if run with a crowd each frame;
**we do not adopt that simulation**. Our workload is static camera/ground queries,
not 50 independently simulated bodies. Measure that actual workload and full
scene after implementation. Server collision/prediction stays analytical, with
no second movement solver and no client-side autostep through server cover.

## Animation and reusable open-source techniques

Current ranger manifest: 20 named clips, including Idle/Walk/Run/Sprint,
JumpStart/Loop/Land, PunchJab/Cross, Kick, Dodge, Guard, weapon aim/strike, Hit,
Interact, Death and celebration. Inspect names, durations and skeleton contract
before adding assets. Original locomotion generator already solves legs for
in-place stance and measures stride speed. Extend with bounded terrain foot
contact after mixer evaluation, named priorities and per-state blending.

[Quaternius Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html)
is CC0; compatible future additions include directional strafing, crouch,
turn-in-place, dedicated roll/recovery and pickup variants. Retargeting/rest-pose
and foot-slide validation are required; adding clips indiscriminately increases
transfer and can break the established mascot rig. Mixamo is free to use under
Adobe terms, **not CC0/MIT**; reject import under this task's asset rule. No new
third-party models/animations are needed for the vertical slice.

Three's vanilla FSM is an example pattern, not a core production FSM package.
Use our own typed two-layer state machine over Mixer actions: dead/finished,
confirmed hit/dodge/jump/action priority, locomotion, timed exit, event identity,
blend duration and normalized cosmetic contact windows. Windows can animate a
trail/anticipation; only server HP/events can display damage or change rewards.

Reviewed actual source locally; only independently implemented techniques reused:

* [VRM Game Starter](https://github.com/norio/vrm-game-starter), revision
  `b14c236fd8150855348ad085b7820c298eac4b30`: MIT code and MIT BVHEcctrl core.
  Read FootIK.ts, CameraRig.ts, camera collision and controller contracts. Floating
  capsule + three-mesh-bvh triangle queries, frame-independent response, two-bone
  terrain IK after animation and near-camera clipping correction are useful.
  Reject its WebGPU/SSGI renderer requirement and VRM dependency: our WebGL rig is
  sufficient. Sample VRoid avatars have separate licenses, not MIT: do not import.
* [OpenCombat](https://github.com/FreePeak/opencombat), revision
  `aad6c51adbe6d89254b2302c7742449090596b86`: MIT source. Read GameRoom.js,
  movement.js, input validation/rate limits and lifecycle. Colyseus accepts intent,
  publishes room state and owns attacks/pickups/death. Movement continues during
  attacks while animation overrides pose. Its 50ms nominal timer uses elapsed dt
  clamped to .25s, unlike Orbix's fixed 30Hz accumulator. Adopt separation, bounded
  input and confirmed feedback; reject copying its timer or replacing our Python
  rooms with Colyseus. Reference asset rights are separate, no assets copied.

## Ordered execution

R1 maps every system and defines public framework contracts. R2 extracts shared
FSM, surface/camera queries, health feedback and scatter; all V4 worlds consume
shared pieces. S specializes Token Catch (terrain, connected loops, pickups and
combat together exercise the layer), retaining other games' environment identity.
T adds honest bounded frame telemetry and verifies loading/launch/mobile/fullscreen.
Each phase commits separately. Baseline/after captures, actual query timings, full
pytest/forge/TypeScript/build and existing browser/netcode regressions finish the
work. Real phones, GPU timings and absent review compliance remain unproven.


## Addendum — 2026-10-10 product-owner override and implementation

The user rejected the earlier keep-Three.js decision table and mandated Babylon.js
adoption. Apache-2.0 is accepted for Babylon code dependencies; art remains
original/CC0. The verdicts above are historical analysis, not authority to reverse
this product-owner decision. Three.js worlds are marked legacy pending the wider
migration and remain available for other games and `?engine=three` comparisons.

Phase U foundation (`accd5d9b`) and its route selector (`f20d0834`) were already
committed when the interrupted build resumed. Phase V (`400b3053`) completed the
Babylon Token Catch world. Phase W (`4a61698c`) completes the parity evidence, corrects the
lazy chunk boundary, late-snapshot terrain initialization and terrain winding,
and promotes Babylon as the default Token Catch renderer. Phase X records this
completion and delivers the per-phase commits to `master:main` without a Railway
deployment. Hermes owns deployment.

The implementation uses Babylon 9.30.0, Havok 1.3.14, capsule/mesh contacts,
native cameras, PBR/fog/shadows and thin-instance scenery/loot. Existing original
mascots retain their CC0 skeleton and 20 clips as native AnimationGroups, with
body layers and additive feedback. The same DOM controls and Python WebSocket
protocol own movement inputs, scoring, hints, settlement, claims and rematch.
No Python reducer or contract source is changed. Live prediction/interpolation
is the exact existing engine-neutral port; Havok presentation cannot award value
or create cover-climbing displacement outside the saved rules.

Functional checks cover both classic and arena Catch, delayed snapshots,
instanced piles, disposal, desktop/touch/fullscreen, and a real admitted two-user
WebSocket round through reconnect, authoritative results and rematch history.
Required Python/Forge/TypeScript/build checks pass. Specific measurements,
commands, parity alternatives and screenshots are in
[babylon-parity.md](babylon-parity.md) and `tools/tests/evidence/babylon/`.

This is adoption completion, not a performance-win claim. The Babylon engine chunk
is 3,864,044 raw bytes and Havok WASM is 2,094,563; renderer additions including WASM
are 6,009,929 raw bytes versus 1,188,516 for the Three baseline. Both software
Chromium comparisons miss 30 FPS and Babylon is slower in that fixture despite
fewer calls/triangles. Real GPU/phone performance and live funded payouts remain
unproven. Normal landing pages fetch no Babylon chunk. Apache LICENSE/NOTICE and
Havok MIT attribution are shipped through `THIRD_PARTY_NOTICES.md` and static
license files. The initial keep-Three recommendation is superseded by the override.
