# Orbix authoritative movement research — October 9, 2026

Research completed before Phase C changes. Stack: Python authority, 30 Hz simulation,
10 Hz public snapshots, ordered WebSocket transport, Three.js/R3F presentation.
Numbers below are Orbix engineering recommendations unless explicitly attributed.

## What the reference games actually establish

**Stumble Guys:** Photon identifies the game as using Quantum, whose deterministic
prediction/rollback topology exchanges player inputs rather than continuously
broadcasting every object's transform. Quantum distinguishes predicted frames from
verified frames: server-confirmed inputs allow the latter to advance identically
on clients. Its view system separately interpolates clock aliasing and prediction
errors. This is a useful architecture reference, but not a drop-in model for a
Python server and JavaScript floating-point clients. No primary source located in
this research establishes Stumble Guys' shipped tick rate, interpolation delay,
per-client bandwidth or correction constants. Quantum defaults must not be
reported as that game's production configuration.
Sources: [Photon product comparison](https://doc.photonengine.com/photon/current/photon-products),
[Quantum and Stumble Guys](https://blog.photonengine.com/photon-quantum-is-now-free-for-development/),
[Quantum frames](https://doc.photonengine.com/quantum/v3/manual/frames).

**Fall Guys:** Mediatonic's GDC session documents dedicated game-service scaling,
including a launch peak of 650,000 concurrent users. The accessible primary
material does not establish gameplay tick rate, replication frequency, prediction
algorithm, interpolation buffer or bandwidth budget. Forum guesses about UNet,
Photon and observed tick rates are not production evidence. Its smooth appearance
cannot substantiate a claim of a specific 60/30/20 Hz configuration. The lesson we
can apply is to separate service capacity from simulation/presentation quality.
Source: [Mediatonic/Epic GDC session](https://www.gdcvault.com/play/1034308/Terminal-Velocity-Lessons-Learned-from).

## Source / Quake model

Valve documents local prediction, opponent interpolation, compression and server
lag compensation. Source's documented default interpolation is 100 ms with about
20 received snapshots/sec, and extrapolation is capped at 250 ms. Those are
historical Source settings, not universal constants. Server rewind accounts for
network latency **and** the shooter's view interpolation. It requires trusted
history and bounded time selection; adopting interpolation does not automatically
implement rewind. Orbix retains its existing authoritative current-state combat
validation and does not introduce client-selected rewind in this round.
Source: [Valve networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking).

QuakeWorld's source starts from acknowledged state, replays retained commands,
and interpolates the resulting presentation. Keep command sequences and durations;
discard acknowledged commands, bound history and replay work, and run collision
logic consistent with the authority. A predicted transform never becomes a score,
hit or settlement. Gap correction belongs in a visual offset, not repeated lerps
of the simulation origin. Do not replay effects or wallet actions with commands.
Source: [id Software prediction source](https://github.com/id-Software/Quake/blob/master/QW/client/cl_pred.c).

## Snapshots, clocks and budgets

A timestamped ring buffer decouples network arrivals from render frames. Sample a
single advancing render timeline between two snapshots. Never restart a lerp on
every packet or derive simulation duration from React renders. Linear interpolation
is adequate for bounded character motion; velocity-aware Hermite interpolation can
improve curved paths but needs overshoot/collision constraints. At 10 Hz, 100 ms is
only one interval: robust coverage of two missing UDP packets can require 300 ms
plus jitter, as Fiedler's example demonstrates. A 150 ms target is a normal-network
budget, not a guarantee during loss or WebSocket head-of-line blocking.
Source: [Snapshot interpolation](https://www.gafferongames.com/post/snapshot_interpolation/).

Delta compression needs an explicit known baseline, changed fields/entities and
removal semantics. A delta is not a replacement snapshot. Recover gaps with a full
snapshot; reset baselines on round/reconnect. Quantization affects transport only:
retain exact authoritative collision/reward arithmetic. Estimate a compact actor
at 32–64 bytes × 50 actors × 10 Hz = 16–32 KB/sec before event/transport overhead;
this is a proposed binary budget, not a measurement of the current JSON protocol.
Start with JSON deltas and measure bytes before introducing binary packing.
Source: [Snapshot compression](https://gafferongames.com/post/snapshot_compression/).

Interest management should omit private data first. In Orbix's small 40×40 arena,
all 50 admitted actors are potentially relevant; distance LOD is presentation only.
Do not drop an opponent's collision/combat state merely because the camera cannot
see them. For larger worlds, use authoritative spatial subscriptions with enter
snapshots and leave tombstones; retain global result/event channels. Use bounded
outgoing queues and coalesce movement so old inputs cannot build seconds of lag.
WebSocket is ordered/reliable and the browser API provides no incoming backpressure;
watch bufferedAmount, stop stale prediction and resync after congestion.
Source: [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket).

## Concrete Orbix settings

| Concern | Recommended initial setting | Purpose / limit |
| --- | --- | --- |
| Authority | Keep 30 Hz / 33.333 ms | No reducer or saved-rule changes |
| Broadcast | Keep 10 Hz / 100 ms | Measure bandwidth before raising to 20 Hz |
| Local input | Existing 75 ms keepalive + immediate direction change | Sequence history bounded to 2 seconds |
| Local presentation integration | Bounded substeps ≤8.333 ms; elapsed-clock driven | Same result across 30/60/144 Hz; no frame-duration gravity drift |
| Remote buffer | 125 ms (100–150 ms design range) | 25 ms jitter headroom at 10 Hz; excludes transit |
| Clock adjustment | Sliding low-delay offset, slewed ≤5 ms/sec | Reject old frames; monotonic render clock |
| Remote extrapolation | At most 100 ms; freeze after cap | Stop on authority death/respawn/teleport or obstruction |
| Local outage | Stop new position prediction at 250 ms stale snapshot | Matches lease; freeze horizontal motion and animation |
| Correction | Visual exponential easing, rate 22/sec, bounded 1.5 units/sec | ~136 ms to remove 95% of small error; larger errors take longer |
| Hard discontinuity | Gap >2.5 units, respawn change, death | Snap to authority; never ease through walls |
| Locomotion | Actual horizontal motion; reference Run 5.12 / Sprint 8.57 units/sec | Wall pressure ≠ running; ignore correction-only displacement |
| Camera | Follow predicted position translation immediately; ease boom only | Avoid a second translation lag fighting prediction |
| Animation | Independent mixer time, crossfade 70–100 ms | Actions use event clock; locomotion uses filtered speed |

The substep predictor is deliberately a bounded presentation approximation, not
cross-runtime deterministic lockstep. Server cadence is already fixed; changing
server physics requires a new replay/version plan. Verify jump, stop, reverse,
cover, respawn and outages against the existing reducer before claiming parity.

## Typical mobile web jitter causes to remove

- Variable render dt used as physics dt changes jump arcs and cover contacts.
- Clamping dt without an accumulator loses elapsed time on slow frames.
- Minimum-ever clock offset locks in an ancient clock estimate; abrupt resyncs
  can rewind a buffered actor.
- Extrapolation beyond its lease sends an actor through a wall then pulls it back.
- Camera translation smoothing adds velocity-dependent lag to an already corrected actor.
- Input-driven run clips animate feet even when displacement is zero at a wall.
- Root translation plus controller translation applies movement twice.
- Repeated action resets or snapshot-derived mixer dt pause animation between broadcasts.
- Mixing epoch timestamps with round-relative milliseconds changes cooldown timing.
- Partial body maps interpreted as replacements erase actors and reset motion tracks.

Three.js separates AnimationAction timeScale from world transforms; use that
separation deliberately. Keep clips in place, share source assets and dispose
owned mixers/materials/skeletons on exit. Decorative bounce/preview rotation must
respect reduced motion while essential movement interpolation remains active.
Source: [Three.js AnimationAction](https://threejs.org/docs/pages/AnimationAction.html).

## Competitive consistency and evidence

Players see the same server-authored trajectories and outcomes at bounded but
possibly different presentation times. Local prediction and transit differences
make literal simultaneous identical pixels impossible. Server accepts finite
sequenced inputs and owns movement, collisions, inventory, damage, ranking and
allocations. Clients must never choose results or treat visual contact as a hit.

Before rebuild, existing synthetic 120 ms RTT / 0–35 ms snapshot-jitter test:
30/60/144 Hz max local error 0.132/0.131/0.116 units, minimum forward displacement
0.1167/0.0583/0.0243 units. These are local deterministic fixtures, not measurements
on phones or production internet. Phase C must add airborne frame-rate parity,
remote observer agreement, stop/wall animation and snapshot-gap regressions and
record actual before/after results in the session report.
