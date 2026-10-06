# Orbix procedural worlds

These four worlds are original Three.js geometry composed in React Three Fiber. They use no downloaded models, remote fonts, texture packs, physics service, API polling or blockchain reads. Small canvas-generated glyph textures are owned by `FaceLabel` and disposed when replaced/unmounted. R3F owns the renderer and primitive resources.

`GameWorld` is the lightweight entry; it lazily imports the renderer. The parent supplies server public state and meaningful DOM controls. Optional callbacks carry only lane, catch-spawn, or hit intent; scenes do not decide collisions, scores, winners or rewards.

State mapping:

- Number Hunt: `digits`, `guessCount[me]`, `claimedTargets`, and `targets` **only when finished**. Mystery cubes stay `?` while targets are private. The fox reacts to server-confirmed guess-count changes.
- Boss Raid: `bossHealth`, `bossHealthMax`, `hits`, `slain`, and up to six actual `players`. Avatar attacks and guardian recoil use confirmed hit/health changes. Optional `teams` accepts address-to-team or team-to-address-list structures. Both side colors are decorative when cooperative mode has no team data.
- Token Catch: `lanes`, `lanesNow[me]`, `scores[me]`, `nowMs`, `catchWindowMs`, and `recent`. Only already-fallen public spawns become gameplay objects. Fall animation and expiry follow the server-configured catch window; no future spawn, score, or collection is fabricated. Lane surfaces call `onLane`; tokens call `onCatch`. Green collection/coral hazard rings react only to confirmed score increases/decreases. The accessible stage also checks eligibility, confirmed lane, expiry and duplicate intent before sending an action.
- Duel: `players`, `phase`, `roundIndex`, `wins`, and completed `history`. Choice totems stay sealed while the current round has no resolved public history. Pending client choices, commit preimages and unrevealed server state are never read.

Presentation: distinct floating puzzle islands, crystal arena, lane runway, and split duel coliseum share grounded fox/adventurer characters, props and soft color lighting. Roots interpolate server lane changes; ref-based joints provide idle/action/celebration animation. Geometry is intentionally low subdivision. Fake blob shadows replace realtime shadow maps; no postprocessing or physics runs. DPR is bounded to 1–1.5. Hidden browser tabs stop the renderer. Reduced-motion renders on demand and suppresses idle/floating/action embellishment. Cameras fit narrow scene widths. Error boundaries, unsupported WebGL and context loss retain a useful DOM fallback and retry.

The world reports no measured FPS claim. Actual browser QA and target-device profiling should inspect draw calls, frame times, cold renderer chunk bytes and context recovery. Essential actions and accessible logs belong to the DOM stage, outside the aria-hidden canvas.

Primary API references: https://r3f.docs.pmnd.rs/api/canvas and https://r3f.docs.pmnd.rs/api/hooks.
