# Orbix procedural worlds

All geometry and outfit designs are original. The production renderer uses the installed Three.js / React Three Fiber libraries; there are no copied commercial game assets, downloaded character packs, paid rendering services, remote textures or blockchain requests in the render loop. The PUBG comparison describes player movement and camera expectations, not a license to reproduce that game's assets.

`GameWorld.tsx` is the lightweight entry and lazily imports `WorldScene.tsx`. An actual renderer loading state appears until the Canvas is created. WebGL errors/context loss retain accessible DOM controls and offer Retry. The scene pauses when the tab is hidden. Essential player interpolation remains active with reduced-motion enabled, while spinning/bobbing embellishments stop. DPR is bounded to 1–1.5; there are no shadow maps or postprocessing passes.

## Current perspective arenas

Token Catch, Boss Raid and Arena Duel use `ArenaWorld.tsx` for server `arena: true` state. Canvas uses a perspective camera, never an orthographic overhead camera. A shoulder camera follows the same reconciled local pose as the avatar and shortens its boom against published cover. `cameraRef` contains `{yaw,pitch,mode:'third'|'first'}`; yaw points world-forward `(sin(yaw),cos(yaw))`, positive camera pitch looks down, and gun aim pitch is the negative of that angle. First-person mode hides the local full body and renders a small original hands/weapon view model. Controls own drag/swipe look, pointer lock, camera-relative WASD/touch movement and gameplay intents; the renderer does not independently change input or submit attacks on mesh clicks.

Scout, Sentinel, Runner and Striker retain the cosmetic IDs `fox`, `robot`, `frog` and `cat`. These are human-shaped characters with distinct outfit/skin/hair palettes, articulated legs/arms, backpacks, boots, hands and facial features. Do not replace them with stationary animal blobs or move them into an overhead board. All participants share two instanced body draw calls (16 box parts and 8 rounded parts per player), plus batched weapons, HP bars, ground rings and shield bubbles. Walking, sprinting, airborne poses, accepted attack cooldowns, combo changes and guard states animate joints. Local full-body visibility changes in FPV without remounting the renderer. Cosmetic choice cannot alter authoritative gameplay stats.

Public state maps directly to geometry:

- `bodies[wallet]`: x/z, capsule-base y, yaw, HP, outfit, weapon, shield, guard, sprint, cooldowns and knockout/respawn times.
- `bounds`: actual server world width/depth. New version 3 worlds are 40×40; legacy bounds remain respected.
- `obstacles`: published x/z/width/depth/height/kind collision shapes. Cover geometry and camera obstruction checks use these values. Projection allows jump clearance above published cover height.
- `crates`: only intact destructible crates render. Supplies from broken crates remain server loot.
- `airdrops`: only already-spawned public crates render. Parachute descent is tied to actual spawn/land times; never invent future landing locations. Crate opening is a server event. Its loot is inspected and collected through the nearby DOM loot panel, rather than decorative click-to-win scene objects.
- `drops`: published coins/bombs/weapons/shields/healing/upgrades, capped at 450 visual items. Opened airdrops expose individual piles around their crate, with `sourceId:airdrop-N` retaining their origin; the nearby loot panel collects each actual server item. Coins spilled after a bomb also appear as public ground loot.
- `projectiles`: capped at 150 batched tracers; projection follows the published yaw/pitch and actual version-dependent speed (28 units/sec in field arenas; 12 in legacy arenas). No predicted hit awards points.
- `attacks`: boss telegraphs are exactly published circles or forward beams. A beam's radius is its full forward length from the boss, with its supplied full width; it must not extend behind the boss. Slam/meteor radius and wave area come from the server. Jump and dodge decisions belong to the simulation.
- `events`: brief confirmed hit/explosion/scatter rings, not fabricated loot or awards.

Movement presentation interpolates snapshots and projects local x/z intent at most 250ms while checking actual walls/cover/crates/boss. A large correction snaps instead of smoothing a teleport. The server owns fixed-step physics, jump gravity, gun trajectories, line of sight, damage, loot, ranking and settlement. Client messages never send final positions or scores. Local prediction is bounded presentation, not an independent physics authority. Clients use increasing sequences seeded from the last server `inputSeq`; input leases expire after a missing release/disconnect.

Arena elapsed clocks (`nowMs`, drop spawn/land/expiry, attack warning/hit/expiry) use milliseconds from match start. Body shield/stun/respawn/attack cooldowns and `serverTimeMs` use epoch milliseconds. Do not mix these time domains. Future RNG/schedules and private room secrets must never enter visual public state.

## Preserved classic scenes

Number Hunt uses mystery islands and masked targets until the round finishes. Original lane-based Token Catch and fixed-strike Boss Raid rooms keep their classic scenes when `arena` is false. Rock Paper Scissors Duel uses sealed choice totems and only completed public history reveals an opponent's move. These older mechanisms and saved transcripts must remain compatible.

## Verification boundaries

TypeScript validates renderer/control interfaces. Browser QA must verify actual perspective rendering, mouse/touch controls, jump clearance, camera obstruction, FPV toggle, knockout/rejoin and resource cleanup. Target-device profiling should measure draw calls, frame time, cold renderer bytes and network behavior with realistic players. No measured frame-rate or 50-device load claim follows merely from instancing or server reducer tests. On-chain receipt confirmation is separate from game score and must not be implied by scene effects.

Primary API references: https://r3f.docs.pmnd.rs/api/canvas, https://r3f.docs.pmnd.rs/api/hooks, https://r3f.docs.pmnd.rs/advanced/pitfalls and https://threejs.org/docs/pages/PerspectiveCamera.html.
