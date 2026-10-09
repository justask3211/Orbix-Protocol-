# Shared V4 presentation framework

All V4 games consume the same animation, foot contact, camera queries and
confirmed health feedback through ArenaWorld/SkeletalActors/GuardianModel.
Only Token Catch adopts the new outpost composition in this round.

* animation.ts: explicit priorities, timed exits, split layers, named blend times,
  identity-based one-shot contact events. Windows are cosmetic, never damage.
* feet.ts: independent two-bone world-space IK and short stance locks after Mixer;
  bounded reach; reset on airborne/death/LOD/teleport. Decorative props do not
  support characters. Terrain math and cover support remain authority-compatible.
* surface.ts + camera.ts: MIT cannon-es static queries, no world stepping or actor
  bodies; near-plane boom samples before and after easing; velocity look-ahead
  only. MotionTrack still owns all positional prediction/reconciliation.
* health.ts + feedback.tsx: immutable published HP changes only, shared player/boss
  bars/flash/damage labels, round reset and bounded event labels. Server positions
  provide knockback; local shells and recoil never change the motion origin.
* scatter.tsx: reusable immutable per-material instance batches, one upload on
  composition change, owned geometry/material teardown via R3F.
* warmup.tsx: loaded rigs → texture initialization → shader compile → actual warm
  frames; no invented percentage or minimum timer.

Extracted practices and rejections are mapped in docs/research/engine-analysis.md
and framework-migration-map.md. No external reference implementation was copied.
Run framework-regression.mjs, actor-state/locomotion/motion regressions and actual
V4 browser practice checks. Query timings are CPU only; frame intervals are not
GPU timings. Respect reduced motion for lean/contact trails/impact flash/drift.
