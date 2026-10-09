# Orbix framework validation — 2026-10-09

The framework and Sunnydrop Token Catch slice are implemented. Engine migration
is deliberately rejected; this is a shared Three/R3F presentation upgrade, with
cannon-es static camera queries and the existing authoritative motion predictor.
No Python gameplay, wallet/session, settlement, contract or money-flow source was
changed. Mobile received the missing Dodge button, submitting the existing action.
The interrupted-run browser and review files were inspected, repaired and retained
as a reproducible development harness rather than production routes.

## Reproducible evidence

`tools/tests/framework-browser.cjs` mounts the actual V4 scene at 960×640, DPR 1,
shadows disabled, fixed two-character field-v1 snapshot. The baseline was captured
before framework runtime changes. Files are in `tools/tests/evidence/rst`:

| Metric | Before | After | Gate |
|---|---:|---:|---|
| Frame samples | 14 | 18 | Small samples; no speed ranking |
| Frame interval p50 | 802.6 ms | 670.5 ms | **FAIL** against phone target ≤20 ms |
| Frame interval p95 | 1410.5 ms | 813.6 ms | **FAIL** against phone target ≤33.3 ms |
| Draw calls, no shadows | 58 | 63 | Pass ≤100 in this fixture |
| Triangles | 122,464 | 124,246 | Pass ≤200,000 in this fixture |
| Browser/shader errors | 0 | 0 | Pass |

Both captures use Chromium SwiftShader on the same host. Differences are not
proof of an improvement: noisy software rendering cannot establish phone GPU
performance, thermals, latency or GPU execution time. The frame-time gate remains
failed in the available renderer. The in-game readout includes long frames,
reports bounded p50/p95, FPS, calls, triangles and actual DPR, and lowers DPR with
hysteresis to .65 when slow. Its regression includes a one-second frame.

`queries.json` measures the actual chosen workload: ten camera rays, forty static
colliders, 1,000 samples; p50 .0260 ms, p95 .0627 ms on Node/Linux x64. This excludes
rendering and is not a phone benchmark. No dynamic cannon simulation runs in game.

`lifecycle.json` records five actual scene unmounts/remounts: mounted 70 geometries
and 6 textures, unmounted 1 and 1, stable each cycle. This is renderer-resource
evidence, not total heap/VRAM measurement; loader-cached GLBs intentionally persist.
`health.png` exercises real player/boss feedback with synthetic published-HP changes;
it proves display behavior, never a real hit or server outcome.

`live-worlds.json` and captures exercise actual API practice state for Token Catch,
Arena Duel and Boss Raid, visible loading and server-accepted movement/jump, zero
page errors. `character-frames.json` records 84 real layered-rig captures across all
12 characters; representative PNGs are retained under `rst/characters`.

## Tests and integration

Final acceptance commands/results are recorded in the dated SESSION_MEMORY entry.
Source regressions cover 144 real actor states, 72 measured locomotion/mixer cases,
snapshot/replay/jitter/envelope behavior, shared FSM/foot/camera/health contracts,
and telemetry. The complete existing browser suite includes admin, form/reward
wizards, real wallet recovery/waitlist and CSV, mocked WalletConnect relay with
real server signatures, live character integration, podium, all V4 worlds and
character captures. Wallet tests were updated for an existing re-export refactor,
the current form picker, and the `/center/` development base; their security,
consent, real-backend and CSV assertions remain in place. Product money/session
logic was not changed to make tests pass. The V4 movement check tries a real
sidestep if forward movement encounters valid spawn cover; it retains the original
displacement assertion and never expects travel through an authoritative wall.

Camera drag/pointer capture and gameplay Space handling now leave interactive
buttons, form controls and the native performance disclosure alone. The mobile
check opens the disclosure by pointer and toggles it by keyboard without a jump.

The added mobile harness uses portrait 390×844 and landscape 844×390 touch
emulation, reduced motion, fast quality, first/third-person switching, accepted
move/jump/dodge and two fullscreen entries/exits. Its JSON/PNG record the final
result and measured selected asset responses. Emulation is not real phone testing.

## Explicit limits and rejected requirements

* `docs/reviews/CHATGPT_GAME_STACK_REVIEW.md` is absent in this checkout and local
  Git history. Exact Phase 1–4 review compliance cannot be proven.
* Physical acceleration, automatic step-up over cover and a new roll displacement
  are not implemented: existing server rules use immediate velocity, support/jump
  and authoritative dodge. Visual speed response, slope/step foot placement and
  existing accepted dodge are implemented. New displacement requires a separately
  authorized server rules change; presenting it as done would be inaccurate.
* Animation contact windows are cosmetic. Damage numbers come exclusively from
  published HP deltas; attack windows never apply damage, scores or rewards.
* Existing near mascots peak at 14,072 triangles and five material groups, exceeding
  the older per-character 10k/one-draw target; scene totals pass in the fixed fixture.
  Total decoded texture bytes, ≤160 MiB heap, retained heap growth, ≤4 ms animation
  CPU and a four-second cold start at 10 Mbps/100 ms remain unverified.
* Existing full/LOD GLBs total 2,975,856 raw bytes and 1,888,701 filesystem-gzip
  bytes (`asset-bytes.json`). Gzip calculation is not measured host compression;
  it excludes game code and cannot alone pass the ≤3 MiB cold-game target.
  The mobile browser measured **5,335,985 encoded bytes (5.09 MiB)** of selected
  game code/styles/GLBs from the uncompressed local API host: **FAIL** against the
  3 MiB goal in this hosting configuration. It is not a production network run.
* PlayCanvas/Godot GLB export features were verified in official documentation;
  no Orbix editor roundtrip or Godot web build was performed. Neither runtime is
  added. Babylon and Rapier are Apache-2.0, outside the MIT/CC0 rule; Jolt's WASM
  payload/bindings do not serve the selected bounded static-query workload.
* Mixamo and VRoid sample assets are rejected under the asset-license rule.
  VRM Game Starter/OpenCombat MIT code was inspected; techniques were independently
  implemented and no reference source/assets were copied.
* Live wallet hardware, relay pairing and funded on-chain flows remain unproven
  by these local tests. No Railway deployment or on-chain transaction was issued.

Follow-up priorities are physical phone profiling, target-tier geometry/material
optimization if measurements require it, a controlled cold-network run, and the
missing review checklist. The baseline and final failures are retained for review.
