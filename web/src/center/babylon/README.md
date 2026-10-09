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
