# Babylon Token Catch parity — 2026-10-10

The product owner rejected the keep-Three.js verdict and mandated Babylon.js.
Apache-2.0 is accepted for code dependencies; art remains original/CC0.
Token Catch now defaults to Babylon. `?engine=babylon` is explicit selection;
`?engine=three` preserves the old renderer. Other games and shared previews stay
on Three. The renderer migration changes no Python or Solidity source.

## Parity checklist

| Concern | Old versus new behavior | Evidence/status |
| --- | --- | --- |
| Rules and scoring | Same versioned Python reducer, loot budget, chunking, bombs, weapons, cooldowns and ranking | Preserved; 597 Python tests pass |
| Input/authority | Same DOM keyboard, standard gamepad and touch controls; finite dx/dz/yaw/sprint/seq, never positions or scores | Practice accepts move/jump/dodge; real room evidence in `room.json` |
| Transport | Existing RoomSocket, 30 Hz authority and 10 Hz state; arenas acknowledge via body inputSeq | Renderer has no independent socket; real-room reconnect/result evidence in `room.json` |
| Prediction/interpolation | Same acknowledged replay, 125 ms remote buffer, bounded extrapolation, lease outage freeze, respawn corrections | Port is byte-identical; motion/jitter/envelope regressions pass |
| Terrain/collisions | Same field-v1 formula and published cover/crates; native Havok capsule and mesh colliders | 608 Python/Babylon samples agree within 5.56e-16; first-snapshot terrain construction tested |
| Sprint/jump/dodge | Same server displacement and timing; native animation presentation | Accepted practice actions and real-room published clocks; animation FSM reused |
| Slopes/step-up | Server slopes/support retained. Free Havok motor has acceleration/deceleration, gravity, 50° slope limit and 28 cm maximum step | Low-step traversal and tall-wall blocking verified; automatic live cover climbing is not added to saved rules |
| Characters/animation | Same original mascots, CC0 skeleton and 20 clips; per-actor native groups and materials | Two skinned actors each expose 20 clips/40 body layers; crossfade/additive recoil |
| Hints/privacy | Same server-filtered snapshots, private hint handling, DOM hints and player visibility settings | Existing Python privacy/hint suites pass; renderer does not request extra state |
| Loot/feedback | Same nearby loot controls and confirmed inventory; native parachutes/lids, health/shields, first-person equipment and event sparks | 400 piles share thin instances; health/shield signals and FPV/TPV tested |
| Classic lane Catch | Same recent/lanesNow/caughtIndices schema and onLane/onCatch callbacks | Actual pointer catch, confirmed paddle lane and caught token removal tested |
| Loading/lifecycle | Engine → physics → characters → shaders → snapshot/ready; Retry on graphics failure | Visible staged loading; late snapshot waits before terrain creation; three disposal/remount cycles keep resource counts stable; rematches/identity or terrain changes own a fresh scene |
| Results/rewards/claims/rematch | Same settlement, entitlement, claim/wallet UI and room history | Existing financial mocks/162 Forge tests pass; real preview result/rematch recorded separately; no funded transfer was exercised |

Babylon uses PBR palette materials and original native item/glove meshes in place
of Three-specific fur shaders and detailed item meshes. Fast quality selects GLB
LOD for local and remote actors. These are explicit visual alternatives; this is
not a claim of pixel-identical rendering or migration of every Three subsystem.
Sounds are optional and no new sound library is introduced.

## Measurements

Both fixtures consume `framework/reviewState.ts`: two static actors, one coin,
the same published field, 960×640, DPR 1, no shadows, reduced motion. They ran
sequentially in Chromium 153.0.8010.12 on Linux/AMD EPYC 9K65 192-Core Processor, using SwiftShader.
The final measurement pass ran without a concurrent build or other test browser.
Each observes ten seconds after readiness/warmup. Render intervals include slow
frames; the fixed Babylon fixture disables adaptive resolution.

| Renderer | Samples | p50 ms | p95 ms | Draw calls | Triangles |
| --- | ---: | ---: | ---: | ---: | ---: |
| Three | 12 | 748.7 | 1399.8 | 63 | 124,246 |
| Babylon | 8 | 1208.8 | 2876.4 | 49 | 42,232 |

Both software runs **fail** the 33.3 ms/30 FPS frame target. Babylon reduces the
observed calls/triangles here but has worse frame intervals. Small samples and
software rendering cannot establish real GPU or phone performance; no speed-win
or zero-lag claim is made. Production retains adaptive resolution and Fast quality
for touch. Practice screenshots/telemetry use `?evidence`, which retains the
WebGL drawing buffer to prevent discarded-canvas captures; its cost is included.

| Production payload | Raw bytes | Per-file gzip-9 bytes |
| --- | ---: | ---: |
| Babylon engine chunk | 3,864,044 | 888,247 |
| Havok WASM | 2,094,563 | 662,067 |
| Babylon renderer additions, including WASM | 6,009,929 | 1,569,733 |
| Three renderer additions, including R3F | 1,188,516 | 323,891 |

The manifest comparison excludes shared Center/GameWorld static code/CSS and
excludes GLBs from both renderer totals. Gzip is a filesystem calculation, not a
measurement of host compression. Babylon is substantially larger. The static
landing dependency graph contains no Babylon; scene/Havok load on game entry.
`browser.json` separately records actual uncompressed local response bytes for
selected practice assets. No cold-network or physical-phone budget is certified.

## Reproduction and evidence

Start a disposable local API (`CENTER_DB=/tmp/...`, `CENTER_WEB_DIST=web/dist`) on
8099 and Vite on 5191. Run `npm --prefix web run build -- --manifest`, then:

```sh
node tools/tests/babylon-regression.cjs
node tools/tests/babylon-bundle.cjs
node tools/tests/babylon-browser.cjs
node tools/tests/babylon-room-browser.cjs
```

`ORBIX_BABYLON_SCOPE=measure` isolates the frame comparison; `fixtures` and
`practice` isolate functionality checks. Scope-specific reruns preserve the
other evidence fields. The review entry points are excluded from production.

Evidence lives in `tools/tests/evidence/babylon/`: `browser.json`, `bundle.json`,
`room.json`, `acceptance.json`, `regressions.json`, fixed-scene desktop comparisons,
1280px desktop/first-person/fullscreen captures and 390×844 portrait plus
844×390 landscape touch/fullscreen captures. Chromium page/console errors are
checked in the practice flows. Preview play performs no token or wallet sends.

Required suites: 597 Python tests, 162 Forge tests, 41 frontend tests, 17 existing
regression scripts plus the Babylon authority/terrain checks, TypeScript and both
Center/root production builds. Build warnings concern large chunks; Python retains
one existing Starlette/httpx deprecation warning. See acceptance JSON for commands.
Artifacts are assembled into `web/dist` and `deploy/site` for Hermes. No Railway
deployment or on-chain transaction is part of this round.
