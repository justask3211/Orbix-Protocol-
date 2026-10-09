# Orbix animation, loading and frame stability research

Research completed before implementation: 2026-10-09. React 19, Three 0.186.1, Fiber 9, Vite 8. Target: mid-range Android, usable 30 FPS with 60 FPS where sustainable. Budgets below are engineering targets, not phone measurements.

## Installed capabilities and reviewed references

Inspected `.agents/skills/` and `~/.hermes/skills/`: Orbix engineering and web interface guidelines are local; Hermes includes motion primitives, systematic debugging and frontend tools but no dedicated skeletal-animation/performance skills. The old Windows installation recorded in GAME_DEVELOPMENT_GUIDE is not present on this Linux host.

Installed MIT community reference skills `threejs-animation` and `threejs-performance` into `~/.codex/skills/`, pinned to alton47/threejs-skills revision `7b8e25638cff83a6be4926d8f05001022cc80ac3`, preserving LICENSE. They become discoverable next turn. These are community references, not official Three documentation. Corrections: sharing a material alone does not batch meshes; merge groups still generate separate calls; KTX2 transcoding is not zero CPU cost; do not set maximum anisotropy blindly; culling a skinned mesh requires animation-safe bounds. Existing Three addons supply AnimationMixer, SkeletonUtils and geometry merging without extra runtime dependencies. No paid plugins or assets needed. GPU crowd references were reviewed but a WebGPU migration is unsuitable for this WebGL/mobile round.

## Techniques studied and selected

Loading: [Three LoadingManager](https://threejs.org/docs/pages/LoadingManager.html) reports completed items, not a reliable total byte percentage. Use a fixed manifest of named stages, cached full/LOD GLBs, prepare roster geometry in the lobby, then show completed-stage progress. Procedural item meshes and terrain textures are synchronous assets: their stage completes only when the mounted scene exists. Warm textures with initTexture, compileAsync the mounted scene and render it under an opaque branded screen, including both character LODs and held/drop material variants. Enter play after warm rendering AND a first full authoritative snapshot for the current connection/round. Retry room.sync with capped backoff; reset synchronization on reconnect. No fake timer; no mandatory minimum display duration.

Animation: [Three additive blending example](https://threejs.org/examples/webgl_animation_skinning_additive_blending.html) and [blending example](https://threejs.org/examples/webgl_animation_skinning_blending.html) show mixer layering; study code only, do not import example character assets. Existing upper/lower track masks suit armed locomotion. [Unity blend-tree guidance](https://docs.unity.com/en-us/engine/6000.0/manual/animation-section/animation-mecanim/animation-animator-controller/animation-state-machines/animation-blend-trees/class-blend-tree) explains synchronized foot-contact phases. Select distance-based mixer cadence, speed-matched locomotion, clip crossfades, acceleration lean, restrained breathing, and a two-bone ground/stance correction on the existing rig. Keep root motion disabled because authoritative displacement and prediction already own position. Squash on landing and stretch in flight remain presentation only. Boss clips use named articulated joints, authored anticipation/impact/recovery, sample normalized attack time from published warnAt/hitAt/expiresAt. Enrage follows published phase, death follows HP. Never derive damage from animation.

Budget motion: expensive full IK and motion matching are unnecessary for this roster. Per-foot stance locks must reset on jumps, teleports, LOD transitions and death. Cosmetic secondary motion is disabled with prefers-reduced-motion; essential attack telegraphs remain visible. Boss entrance uses fog, a bounded camera impulse and expanding ground ring, with no audio or effect under reduced motion.

GPU animation: [Three individual skinned instancing](https://github.com/mrdoob/three.js/blob/dev/examples/webgpu_skinning_instancing_individual.html) is a useful future crowd reference, not drop-in WebGLRenderer code. Current SkinnedMesh already deforms vertices on GPU; mixers still evaluate bones on CPU. Share immutable geometry/materials, retain independent skeletons and mixer state, stop invisible mixers, evaluate distant actors at 15–20 Hz. Do not claim GPU-driven clip evaluation.

Frame stability: [R3F scaling](https://r3f.docs.pmnd.rs/advanced/scaling-performance) and [pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls) support cache ownership, instancing and ref-based motion. Existing foliage and item batches are already instanced; inspect remaining cover/crate calls instead of rewriting working batches. [Drei PerformanceMonitor](https://drei.docs.pmnd.rs/performances/performance-monitor) motivates hysteresis and delayed recovery for DPR, implemented locally without adding Drei to production. Cap desktop shadows at one 1024² light, mobile shadows off; reuse scratch math objects and bounded maps. Sample renderer.info after render, frame interval p50/p95 and heap when exposed. JS frame interval is not GPU execution time.

## Concrete scene budgets

| Metric | Phone target | Desktop/high tier ceiling |
|---|---:|---:|
| Visible draw calls, including shadows | <=100 normal, <=150 raid | <=200 |
| Rendered triangles/frame | <=200,000 normal, <=300,000 raid | <=500,000 |
| Decoded texture storage (estimated) | <=32 MiB | <=64 MiB |
| JS heap after warmup | <=160 MiB; <=10 MiB retained growth after 5 exits | <=256 MiB |
| Frame interval | p50 <=20 ms, p95 <=33.3 ms | p95 <=20 ms |
| Main-thread animation work | <=4 ms/frame | <=6 ms/frame |
| Resolution | DPR .65–1, measured hysteresis | DPR .75–1.5; sharp <=2 |
| Shadow maps | 0; blob shadows | 1 × 1024² |
| Character geometry | near <=10k, far <=3k triangles; 1 palette draw | same |
| Cold selected-game assets | <=3 MiB compressed GLB/code goal | same |
| First playable (network goal) | <=4 s at 10 Mbps/100 ms RTT | <=2 s warm |

Prefer original vertex-color palettes (zero character bitmap texture memory). Existing procedural ground maps are 256²; retain them shared within the scene. KTX2/Meshopt are deferred unless measured imported texture/transfer pressure warrants compatible decoders. Terrain uses authority height math unchanged. Cache resources by appearance/LOD with references and dispose when the last scene/preload owner releases them; cached GLBs remain bounded at two URLs. Full/LOD skeleton clones are necessary; geometry/texture clones per actor are not.

## Verification and limits

Use a reproducible browser fixture mounting actual V4 WorldScene for token-catch, combat-duel and boss-raid, fixed roster/cover/drop counts and a 390×844 mobile viewport, SwiftShader, shadows off. Capture draw calls, triangles, geometry/texture counts, estimated decoded texture MiB, exposed JS heap, frame interval p50/p95, ready time, renderer identity and screenshots. Run equivalent fixtures before/after; retain raw JSON. Also exercise real room websocket flow and failure/reconnect gates. [Chrome performance tools](https://developer.chrome.com/docs/devtools/performance) are references for real-device follow-up.

SwiftShader numbers measure software rendering in this host and cannot certify phone FPS, thermal behavior, VRAM or input latency. Browser texture count is not bytes; estimates exclude driver overhead, skeleton float textures, framebuffer and shadow storage unless explicitly included. Report proven and unproven separately. Record current asset bytes and measurements during Phase K; no results are fabricated in this research stage.
