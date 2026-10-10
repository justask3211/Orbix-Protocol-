# Babylon build-round evidence — 2026-10-10

- `browser.json`: sequential fixed-state frame comparison and functional checks,
  actual rendered AnimationGroups, 400 instanced piles, lifecycle, delayed snapshot,
  classic pointer catch, desktop and touch/fullscreen practice.
- `room.json`: two real local authenticated wallets using the default renderer,
  snapshot inputSeq acknowledgement, accepted jump/dodge, disconnect/reconnect,
  server preview settlement, rematch and preserved prior-round history.
- `bundle.json`: Vite manifest renderer graphs and per-file gzip-9 calculations,
  separate Babylon engine/Havok WASM and proof of a lazy landing boundary.
- `acceptance.json`, `regressions.json`: required checks and existing regression
  results. Original full-suite logs were kept in `/tmp/orbix-babylon-*` during work.

PNG files capture actual Chromium rendering, including 390×844 portrait gating,
844×390 landscape touch, desktop/first-person/fullscreen and the live room/result.
Practice uses `?evidence` to expose metrics and retain WebGL pixels for screenshots;
normal play keeps `preserveDrawingBuffer` off. Fixed-frame measurements use no
retained buffer, no shadows and DPR 1 for both engines. Final timing ran separately
from builds and other browser tests. Visual refinements during the round include
right-handed terrain winding and a PBR sky; captures document the tested flows.

All of this is local Linux Chromium SwiftShader evidence. Both engines fail the
30 FPS software comparison. Real phone/GPU performance, network cold-load budgets
and live funded payout remain unproven. No Railway deployment or wallet send ran.
The full parity report is `docs/research/babylon-parity.md`.
