# Babylon game layer

The 2026-10-10 product-owner decision adopts Babylon.js. This module owns a scene,
Havok world, capsule controller, cameras, cloned GLB AnimationGroups and render
resources. It is loaded dynamically; importing the Center shell loads no Babylon.
The Python server, RoomSocket, input seq/ack format, rewards and claim UI are shared.

`motion.ts` and `terrain.ts` port the engine-independent authority algorithms from
the legacy worlds module. `CapsuleMotor.follow` projects to the reconciled server
pose, so a rounded collider cannot invent cover climbing or reward events.
`freeMove` offers acceleration, gravity, 50° slope rejection and 28 cm step-up for
offline controller verification. The live server has immediate movement velocity;
the client smooths gait/camera response and uses the server's jump/dodge outcomes.

Existing original mascot geometry is exported offline using the existing CC0
rigged GLBs and 20 clips. The runtime loads Babylon AssetContainers and clones
skeletons/groups per actor. Only selected characters are fetched. No Three runtime
is needed by this module. No external art is downloaded.


## Completed Token Catch slice — 2026-10-10

`GameWorld` defaults Token Catch to this renderer; `?engine=three` preserves the
legacy comparison. Boss Raid, Arena Duel and shared character/podium previews
retain Three. Both lane Catch and the versioned perspective Catch read the
existing published field names. All controls, hints, scoring, inventory, results,
rematch, settlement and claims stay in the existing DOM/server components.

The scene waits for the initial body snapshot before constructing its terrain
and collider. Loading progresses through renderer, Havok, characters, shaders and
world sync; graphics failure offers Retry while shared DOM controls remain.
First-person equipment, health/shields, parachutes, opened crate lids, instanced
loot/projectiles and confirmed-event sparks are original procedural Babylon art.
Repeated scenery and up to 450 loot objects use thin instances. Actor materials
are cloned; shared GLB textures remain container-owned until scene teardown.

The 20 source clips are native AnimationGroups split into 40 lower/upper groups
with crossfades and an additive recoil layer. Engine-specific fur and detailed
Three item meshes are replaced by PBR palettes and original Babylon meshes.
These are presentation alternatives; the rules and authority are unchanged.
Live movement uses the existing immediate server velocity, terrain and dodge.
The Havok free motor's acceleration/gravity/slope/step settings are independently
testable; automatic live cover climbing is not introduced into old rules.

`babylon-review.html` and `review.ts` are development-only fixtures. The fixed
comparison disables resolution adaptation to keep both engines at DPR 1.
`?evidence` exposes renderer diagnostics and retains the drawing buffer for
reliable software-WebGL screenshots. Normal play does neither. Browser practice
measurements with that flag include its buffer-retention cost. See
`tools/tests/evidence/babylon/` and `docs/research/babylon-parity.md` for measured
sizes, functionality, screenshots and limits; these are not real phone benchmarks.
