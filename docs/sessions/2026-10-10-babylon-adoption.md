# 2026-10-10 — mandated Babylon Token Catch adoption

The product owner rejected the previous keep-Three.js recommendation and required
Babylon.js. This session resumed an interrupted implementation with planning
already complete; the task was to finish phases V–X, verify parity and push
`master:main`. Apache-2.0 is accepted for code; art remains original/CC0. The user
explicitly prohibited Railway deployment because Hermes handles it.

## Delivered phases

| Phase | Revision | Result |
| --- | --- | --- |
| U, earlier round | `accd5d9b` | Babylon/Havok dependencies, isolated foundation, exported existing CC0 rigs and notices |
| Route selector, earlier round | `f20d0834` | Explicit Babylon/Three route selection |
| V | `400b3053` | Native Token Catch world: Havok capsule, terrain, cameras, layered AnimationGroups, staged loading, instancing, pickup/equipment feedback |
| W | `4a61698c` | Functional/browser evidence, frame/bundle measurements, late-snapshot and scene lifecycle fixes, default Babylon, static release artifacts |
| X | This documentation commit | Override addendum, license/implementation records, session memory and Git delivery |

Token Catch now defaults to Babylon. `?engine=three` retains the legacy renderer;
other games and shared previews remain on Three. The same server-filtered state,
WebSocket intents, scoring, hints, settlement and wallet/claim UI remain in place.
No Python or Solidity source changed. Native contacts follow the unchanged
predicted/reconciled authoritative pose in live play. Independent free-motor
slope/step traversal is verified; automatic live cover climbing would require a
server rules change and is not part of this renderer migration.

Native PBR materials and simplified native item/glove meshes replace Three-specific
presentation; Fast quality uses existing mascot LOD. These alternatives are
recorded explicitly rather than claimed as pixel-identical rendering.

## Verification and limits

Required suites passed: 597 Python tests, 162 Forge tests across 16 suites,
41 frontend tests, 17 existing regression scripts, Babylon motion/jitter/jump
regressions, 608 Python/Babylon terrain samples, TypeScript and both production
builds. The final retained Token Catch browser regression exits 0.

Chromium checks cover real scene groups, 400 instanced piles, capsule step/wall
contacts, delayed first state, classic pointer catch, clean disposal/remount,
desktop, 390px portrait rotation gating, landscape touch, FPV/TPV and fullscreen.
Two local real authenticated wallets exercise default-renderer WebSocket movement,
jump/dodge, disconnection/reconnect, server preview settlement, rematch and prior
round history. Preview rewards never trigger a funded transfer or wallet send.

The Babylon renderer additions are 6,009,929 raw/1,569,733 filesystem-gzip bytes
including its 2,094,563-byte Havok WASM; Three additions are 1,188,516/323,891.
The landing static graph excludes Babylon. The sequential fixed SwiftShader
fixture has p95 2876.4 ms for Babylon and 1399.8 ms for Three; both miss 30 FPS.
This is a completed engine adoption with a larger payload and unresolved hardware
performance, not a speed-win claim. Physical phone/GPU, cold-network budgets and
live funded payout remain unproven.

See [the parity report](../research/babylon-parity.md) for measurements, commands,
checklist and presentation alternatives. Actual JSON and screenshots are in
`tools/tests/evidence/babylon/`. `web/dist` and both `deploy/site` variants are
assembled with Apache LICENSE/NOTICE and Havok MIT notices. The per-phase commits
are delivered to `master:main`; the final response verifies the remote hash.
No Railway deployment, production environment update or on-chain transaction ran.
Preexisting Python bytecode and baseline captures are not included in delivery.
