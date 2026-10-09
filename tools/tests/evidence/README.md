# Character review evidence

All images are local Chromium software-WebGL captures of original procedural
Orbix meshes on the existing CC0 shared rig. No downloaded character art.

| Before | After |
|---|---|
| [Old Mochi jogging](q-before-mochi-run.png) | [Maple idle](q-maple-idle.png), [Maple running](q-maple-run.png) |
| [Old Puff with box head](q-before-puff-idle.png) | [Rounded Puff](q-puff-idle.png) |
| No turtle | [Tuck idle](q-tuck-idle.png), [Tuck shell](q-tuck-shell.png) |

[Selected characters in the lobby](q-lobby.png) and [production podium fixture](q-podium.png)
show the shared model path in actual UI. The podium uses explicit placement fixtures;
it does not determine or fabricate server winners.

`q-frames.json` describes 84 production layered-rig captures, seven states for each
of twelve characters. Its full image set is regenerated into `/tmp/orbix-q-frames`
by `node tools/tests/character-frame-regression.cjs`. `q-locomotion.json` records
72 actual mixer/gait cases across characters and LODs. `actor-state-regression.mjs`
adds 144 real actor state/reduced-motion checks.

The surface-noise fur is stylized and does not reproduce the banner's offline
strand/detail level. These captures prove local rendering and clip behavior,
not physical-phone performance or 100% visual parity.
