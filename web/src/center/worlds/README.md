# Orbix perspective worlds

Current architecture: October 8, 2026. `AGENTUSE.md` records product intent;
dated `docs/sessions` entries preserve prior implementations and release evidence.
Token Catch, Boss Raid and Arena Duel use small movable perspective spaces with
FPV/TPV, jumping, aiming and combat. Fortnite/PUBG/Shadow Fight are quality and
mechanics references, not licensed asset sources or an AAA quality claim.

## Versioned authority and terrain

New wizard/practice worlds explicitly use `world_version: 4`. Schema defaults
remain version 2; `center/games/__init__.py` selects the saved version rather than
silently upgrading old rooms. Version 3 retains its flat 40×40 field simulation;
version 2 and classic scenes retain their earlier mechanics.

Version 4 `TerrainArenaEngine` adds `field-v1` ground height.
`center/games/terrain.py` and `terrain.ts` must match numerically: Catch is
`island`, Raid is `guardian`, Duel is `courtyard`. Body ground/jump/landing,
published cover `baseY`, drops, airdrops, boss placement, projectile obstruction
and respawn use the authoritative surface. Ground/support tests live in
`center/tests/test_terrain_arena.py`; tooling tests check Python/TypeScript parity.
Altering formulas requires version/replay planning.

`FieldEnvironment.tsx` renders a 140×140 landscape, original local grain/normal
textures, trees, grass, stones, water and ruins. The playable region is still the
published 40×40 bounds. Everything beyond it is vista. Decorative foliage and
ruins do not become server cover; only published obstacles, intact crates and
the boss block players/camera/attacks. Do not extend movement into scenery or
invent collision from an attractive prop.

## Rigged characters and original equipment

`SkeletalActors.tsx` loads `/center/center-models/orbix-ranger.glb` and its distant
LOD with standard GLTFLoader. These are actual skinned characters derived from
Quaternius Universal Base Characters Standard and Universal Animation Library
Standard (CC0 1.0). Source/output hashes, licenses and retarget mapping are retained
beside the GLBs; pipeline instructions live in
`tools/game-lab/assets/CHARACTER_PIPELINE.md`.

The full mesh has 16,064 triangles, the LOD 3,123, and both retain the complete
65-joint rig and 20 clips: Idle, Walk, Run, Sprint, JumpStart, JumpLoop, JumpLand,
PunchJab, PunchCross, Guard, SwordAttack, SwordIdle, PistolIdle, PistolAim,
PistolShoot, Hit, Death, Dodge, Interact and the original Orbix Kick. Embedded
textures are at most 512px. No Draco/Meshopt/KTX runtime decoder is required.
Root translation is in place; animation never determines speed, hits, loot,
winners or token transfers. Retargeting uses deliberate rest-space mapping;
matching joint names alone does not establish compatibility.

Meters, +Y up, +Z forward, feet Y=0, approximately 1.82m tall; grip bones are
`hand_r`/`hand_l`. `SkeletonUtils.clone` gives each actor its own skeleton, mixer
and actions. Tint only `Orbix_Suit`, `Orbix_Armor`, `Orbix_Accent`; preserve face,
eyes and source textures. Existing fox/robot/frog/cat cosmetic IDs remain Scout,
Sentinel, Runner and Striker. Colors/team accents do not alter stats.
Crossfaded upper/lower layers allow movement with accepted combat actions.
Within 12 units (and for the local player) use the full rig; distant actors use
LOD and reduced mixer cadence. Frustum/distance culling stops hidden rig work.
StrictMode cleanup must not dispose mixers during effect rehearsal. Release
owned mixers, skeleton bone textures and cloned materials after actual teardown;
cached geometry/textures remain shared.

`GuardianModel.tsx` is an original carved crystal boss with original local
surface texture and poses driven by confirmed HP/attack state.
`FirstPersonModel.tsx` is original gloves, gun, sword, spear and kick presentation
with confirmed inventory/actions. FPV hides the local full-body mesh; remote
actors remain visible. No Epic Games, Fortnite or PUBG assets are present.

## Camera, public state and clocks

`ArenaWorld.tsx` owns shoulder/first-person follow cameras. `cameraRef` holds
`{yaw,pitch,mode:'third'|'first'}`: forward is `(sin(yaw),cos(yaw))`, positive camera
pitch looks down, aim pitch has the opposite sign. Camera obstruction uses
published cover and ground. Controls own pointer lock, drag/swipe look,
camera-relative WASD/touch intent and attacks; mesh clicks do not award loot.
Release held input on blur, cancellation, hidden tab, disconnect and unmount.

The server owns 30Hz physics, lease/sequence validation, cooldowns, inventory,
damage, loot, ranking and settlement; snapshots broadcast at 10Hz. Local
projection is bounded to a 250ms presentation lease, checked against published
cover and reconciled to snapshots. Never submit final positions or scores.

- `bodies` maps feet position, yaw, HP, inventory, cosmetic, guard, cooldowns and
  knockout/respawn state. Version 4 adds `groundHeight`/`onGround` cues.
- `obstacles`, `crates`, `boss` are published collision objects; use base heights.
- `airdrops` expose only spawned crates and actual spawn/land times. Opening
  does not collect the whole value. Nearby DOM loot controls collect individual
  server items; `sourceId` preserves crate origin.
- `drops`/`projectiles` are actual public items/tracers (visual caps 450/150).
- `attacks` are published boss telegraphs. A beam extends forward only with
  its supplied full length/width. Rings never fabricate damage or rewards.

Arena `nowMs` and drop/attack schedules use milliseconds since round start.
Body shield/stun/respawn/attack cooldowns and `serverTimeMs` use epoch milliseconds.
Never mix clocks or expose future RNG, seeds, private hints or sealed moves.

## Loading, graphics and results

`GameWorld.tsx` lazy-loads `WorldScene.tsx` and displays renderer and GLB/terrain
loading states. WebGL/context-loss failures preserve DOM controls with Retry.
Fast defaults on coarse-pointer/mobile viewports: DPR 1, no sun shadows.
Balanced caps DPR at 1.5; Sharp caps it at 2. Version 4 has a bounded 1536px sun
shadow only on fine-pointer desktop viewports in Balanced/Sharp, ACES tone mapping,
local gradient sky and fog. No external HDR or postprocessing is used.
Hidden tabs pause rendering; reduced motion removes decorative motion while
maintaining playable interpolation. Displayed FPS samples about 1.5 seconds of
this browser's rendering. It is an observation, not a reproducible device,
network or 50-player benchmark.

`WinnerCelebration.tsx` separately lazy-loads the shared Ranger podium when results
enter view. It consumes verified final placements supplied by the room API;
animation never decides a winner. DOM names/ranks, fallback and reduced motion
remain available. Finished-room refresh recovers authorized durable settlement.
Onchain claim receipts are separate verification from a score or celebration.

## Tooling and verification boundaries

Production uses React/TypeScript, Three.js and R3F with project CSS. The isolated
lab contains ecctrl 2.0.2, Rapier, Drei, glTF Transform and meshoptimizer; installing
them does not make them deployed gameplay dependencies. glTF Transform and
meshoptimizer optimize art offline. Blender 3.4 CLI processed the rig; the
installed community Blender MCP was disconnected. Pinned community Three.js
skills and their corrections are guidance, not renderer imports.

Use actual in-app browser checks for perspective rendering, touch/keyboard,
jump/cover clearance, FPV grip, attack/knockout, rejoin/rematch and cleanup.
TypeScript/pytest validate interfaces and reducers; screenshots and FPS readouts
do not establish latency, jitter, mobile performance or live funded payouts.
Preserve old session records and add dated evidence for new releases.
# Legacy renderer — 2026-10-10

The user mandated Babylon.js adoption. Token Catch is rebuilt in `../babylon/`;
It is the default Token Catch renderer; `?engine=babylon` explicitly selects it
and `?engine=three` retains the legacy route.
This module remains for other games and compatibility. Delete nothing in this round.
