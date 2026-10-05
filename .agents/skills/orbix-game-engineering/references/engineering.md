# Rendering, character and multiplayer decisions

## Browser stack and resources

Prefer one renderer: Three.js with React Three Fiber/Drei for the existing React browser product. Rapier supplies optional local physics, not authoritative rewards. Motion handles DOM transitions; Howler can supply gesture-unlocked game audio; Zustand can hold infrequent UI state. Keep asset loading and scene code lazy per game.

Use refs and `useFrame` for presentation updates, with delta-time-aware motion. Do not push transforms through React state every frame. Preallocate frequent math objects, instance repeated props, cap DPR, and scale expensive shadows/effects to device quality. Use on-demand rendering for still scenes; continuously animated games need continuous frames. Demand mode requires invalidation after imperative changes.

GLB is the interchange format. Reuse cached geometry/materials with explicit ownership. Clone animated skeletons using SkeletonUtils when independent instances are needed; don't blindly dispose shared cache entries at each component unmount. Animation actions must guard missing clips, crossfade intentional states, and clean up mixers/listeners. Root motion versus controller motion is a deliberate choice; don't apply both to displacement.

Inspect assets before optimizing. Store source URL, license, original/optimized hash, bytes, texture dimensions, meshes and clips. Meshopt and KTX2 need compatible loaders/decoders and device support checks. The lab's first optimizer only covers the transforms it actually verifies; don't claim full texture compression or lossless rig handling without an animation roundtrip check.

## Authority and smooth movement

Existing `center/room.py` has a scheduler default around 0.25 seconds, actions append logs/save snapshots, and `web/src/center/ws.ts` requests synchronization after acknowledgements. Inspect current paths before reusing them for high-rate movement; they do not establish a suitable action-game simulation.

Separate rendering, fixed-step simulation, snapshot transmission, durable checkpoints and settlement. Start measured experiments with a 30 Hz simulation and 10–20 Hz snapshots only if the selected game warrants them; these are hypotheses, not verified performance settings. Avoid a database write or full snapshot request per rendered frame.

Send validated inputs with sequence numbers, server ticks and last-processed acknowledgements. Predict the local player for responsiveness, reconcile to server outcomes, and buffer/interpolate remote players. Include reconnect snapshots, stale/duplicate input handling, bounded queues and scene teardown. Client physics is presentation/prediction; validate collisions, eligibility and scores server-side for reward-bearing games.

Keep the Python authority initially. Colyseus is a free open-source option to evaluate if measured requirements justify a dedicated Node game service, not a reason for an immediate backend migration. A multiplayer transport library alone does not implement fairness or make physics deterministically identical across runtimes.

## Verification prompt and evidence

"For Orbix [game], inspect the current room and websocket protocol. Propose the smallest measured path to smooth movement while retaining server scores and settlement. Implement input sequencing, acknowledgement, prediction/reconciliation and remote interpolation where needed. Verify duplicate/stale inputs, disconnect/rejoin and contradictory client positions. Measure p50/p95 frame time, input-to-display delay, RTT/jitter, reconciliation magnitude, bytes/sec, server tick duration and cold-load bytes on named devices. State unresolved limitations."

Choose a reference phone, desktop browser and realistic network before setting budgets. A candidate target is stable 60 FPS on the reference desktop and a usable mobile fallback; measure frames over representative play, rather than quote a tooling fixture's FPS as production evidence. Capture cold and warm loads, long tasks, GPU draw calls, memory after repeated room exits, and network behavior under RTT/jitter/packet-loss experiments.

## Primary references

- https://r3f.docs.pmnd.rs/api/hooks
- https://r3f.docs.pmnd.rs/advanced/pitfalls
- https://r3f.docs.pmnd.rs/advanced/scaling-performance
- https://drei.docs.pmnd.rs/abstractions/use-animations
- https://github.com/pmndrs/react-three-rapier
- https://threejs.org/docs/pages/GLTFLoader.html
- https://gltf-transform.dev/
- https://docs.colyseus.io/netcode/client-prediction
- https://developer.chrome.com/docs/devtools/performance
