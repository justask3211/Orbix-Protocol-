# Orbix framework migration map — R1, 2026-10-09

R0 decision: Three/R3F retained. cannon-es selected under MIT-only runtime rule;
Rapier's installed Apache-2.0 license and 1.65MB gzip exclude it. All framework
outputs are presentation; API actions and server snapshots are unchanged.

| Current system / files | Classification | Source / license | Implementation and rationale |
|---|---|---|---|
| Character controller: motion.ts, ArenaControls, server terrain/field arena | keep-as-is simulation; upgrade-in-place presentation | Existing Orbix; Three MIT | Keep 120Hz bounded predictor, ack replay, 125ms opponents, collision/support, server dodge/jump. Add bounded visual accel/decel/lean, slope feet and step support; never let presentation cross server cover |
| Animation: AnimationRig, SkeletalActors, locomotion | upgrade-in-place | Three MIT; existing Quaternius CC0 | framework/animation.ts typed priorities, interrupt/exit rules, blend table, per-event normalized visual contact windows; retain split layers and measured stride rates |
| Foot contact | adopt-from technique | VRM Game Starter MIT source studied; independent implementation | framework/feet.ts world-space stance anchors, bounded two-bone IK after Mixer, reset on jump/death/teleport/LOD; query authoritative support only |
| Camera: FollowCamera | upgrade-in-place + adopt-from library | cannon-es MIT; Babylon/VRM camera techniques studied | framework/surface.ts static ray queries; framework/camera.ts swept near-plane samples, collision after easing, immediate inward/released outward boom, bounded look-ahead; first-person retained |
| Terrain/environment: FieldEnvironment + terrain.ts | keep terrain math; upgrade-in-place | Original procedural artwork; Three MIT | Preserve field-v1 parity and published obstacle transforms; reusable instanced scatter, original path/flower/stone dressing in Token Catch; scenery cannot become a gameplay collider |
| Combat/health/damage: RigActor, Indicators, GuardianModel | upgrade-in-place | Original code; Three MIT | framework/health.ts confirmed-HP delta/round reset; shared feedback.tsx health bars, damage labels and impact shell for players AND boss; bound feedback count and owned resources; use server knockback trajectory |
| Loading/warmup: GameWorld, WorldScene, lobby GLB preload | keep-as-is | Three/R3F MIT | Keep branded named loading stages and actual texture/shader warmup; shared query world has synchronous setup, no fake progress |
| Netcode presentation: MotionTrack, ws, worldSnapshot | keep-as-is | Existing Orbix | No protocol/rate/outcome changes; original replay/snapshot/actor tests stay green |
| Asset pipeline: GLBs/manifests/license texts, game-lab tooling | keep-as-is + optional offline authoring | Existing CC0 animation/original meshes; Godot/PlayCanvas engines MIT | Add framework license ledger and export contract. Optional GLB authoring in PlayCanvas/Godot; no engine runtime, new copyrighted models or Mixamo imports |
| Wallet/session/launch/rewards | keep-as-is | Existing stack | No writes to wallet, settlement, server, contracts or session paths |
| Quality/reduced motion/fullscreen | upgrade-in-place telemetry, keep interaction | Existing React/Three | Report bounded p50/p95 frame interval + calls, separate from GPU timing; existing fast quality and fullscreen preserved |

## Shared contracts and rollout

`surface` takes public state and exposes ground/camera queries; no input submission.
`animation` takes confirmed body, visual speed, airborne state and event clock and
returns two clip intents with blending and cosmetic contact phase. `feet` adjusts
bones only. `health` consumes published HP once per round/entity and emits display
deltas, never health mutations. `scatter` batches immutable transforms by material.
All three V4 games use surface, camera, animation and player/boss shared feedback.
Only Token Catch gets the new environment composition; other maps stay playable.

Choose Token Catch: pickups, airdrops, movement, terrain variation, cover and rival
combat exercise more of the framework in one existing game. Preserve its rules,
controls and discovery/practice/live room/reward lifecycle. Build a connected
three-route outpost within the current 40x40 published world, with cover-aligned
props and no fake walls/steps. Existing authority has instant horizontal velocity,
no physical auto-step over cover, and server-confirmed dodge displacement.
Acceleration/deceleration is a bounded visual response; slope/step IK fits the
existing support/jump behavior. Changing actual acceleration or permitting cover
autostep would violate the explicit server-untouched requirement, so reject that
simulation change and disclose the limitation.

## Acceptance and evidence

1. R2: animation interruptions/repeated-event/damage-window semantics, camera thin
   cover and smoothing path, feedback dedup/round reset and ground IK reach tested.
2. S: same-state before/after captures and original rig/netcode regressions; ground,
   props, pickups, movement/action transition/damage captures.
3. T: actual local authoritative practice for every V4 game, mobile/reduced-motion/
   fullscreen flow, frame/scene/query counters, bounded cleanup evidence.
4. Final full pytest + forge + tsc + build, all applicable existing local/browser
   tests. Record any failed budget or unavailable environment; no phone performance
   certification from SwiftShader. User's exact absent review checklist unproven.
5. Phase commits, dated SESSION_MEMORY, push master:main; no Railway deploy.
