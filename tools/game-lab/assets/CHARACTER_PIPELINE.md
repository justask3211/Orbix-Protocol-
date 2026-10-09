# Licensed skeletal character pipeline

Orbix Ranger replaces the original primitive humanoid with an adult anatomical
character, recognizable face, skinned tactical suit, hair, armor and real skeletal
movement. It is a lightweight browser character, not an Epic/Fortnite asset or an
AAA realism claim.

The author is **Quaternius**. Both [Universal Base Characters Standard](https://quaternius.com/packs/universalbasecharacters.html)
and [Universal Animation Library Standard](https://quaternius.com/packs/universalanimationlibrary.html)
are explicitly **CC0 1.0**. The official free base pack was downloaded through its
ordinary no-payment itch.io download. No account, paid content, donation or API key
was used. The animation [mirror](https://github.com/J-Ponzo/gltf-universal-animation-library)
is pinned to commit `e24c23cf2a1323488a3faa226ea7ea21f644b73e`. Exact source bytes and
SHA256 hashes are retained in the public asset manifest and local cache inventory.

Original files live outside the repository in
`~/.codex/orbix-tooling/assets/quaternius-universal`. Archive paths, extensions and
maximum entry sizes are validated before selected art extraction. No remote code
was executed. Only locally reviewed pipeline scripts process the assets.

## Coordinate and animation contract

- Main: `/center/center-models/orbix-ranger.glb`; distant LOD:
  `/center/center-models/orbix-ranger-lod.glb`.
- Approximately 1.82 m; meters, +Y up, feet Y=0, +Z forward.
- One skinned mesh, seven material primitives, 65 joints. Grip bones `hand_r`,
  `hand_l`; head `Head`, hips `pelvis`. Bone local +Y runs wrist toward fingers;
  weapon grip offsets require visual review against `PistolAim`/`SwordIdle`.
- Tint only `Orbix_Suit`, `Orbix_Armor`, `Orbix_Accent` for cosmetics. Preserve
  authored face/eyes/hair. Cloned actor materials and mixers belong to that actor;
  cached source geometry/textures remain shared and must not be disposed per actor.
- Clips: Idle, Walk, Run, Sprint, JumpStart, JumpLoop, JumpLand, PunchJab,
  PunchCross, Guard, SwordAttack, SwordIdle, PistolIdle, PistolAim, PistolShoot,
  Hit, Death, Dodge, Interact, Kick. `Kick` is an original guarded front kick
  authored as six poses; it is not a renamed source punch.
- The source animation rig has DEF-* names/rest frames; the character uses a
  UE-style rig. Rest-space quaternion deltas are deliberately mapped and baked,
  preserving target bone offsets. Never assume matching names imply bind-pose
  compatibility. The exact mapping is recorded in the manifest.
- All horizontal root translation stays in-place. The server owns position,
  jump height, speed, collision, combat, loot and rewards. Animation is visual.
  Crossfade clips; release owned mixer/actions on teardown. Do not change game
  timing or financial behavior to fit an art clip.
- Textures are embedded, at most 512px. Standard GLB needs no Draco, Meshopt or
  KTX runtime decoder. Meshoptimizer is an offline simplifier only.

## Reproduction

Run in PowerShell from the repository root using the configured Python/Node
runtime and isolated `tools/game-lab` dependencies:

```powershell
python tools/game-lab/assets/fetch_universal.py
python tools/game-lab/assets/research_character.py
python tools/game-lab/assets/extract_universal_base.py
& 'C:\Program Files\Blender Foundation\Blender 3.4\blender.exe' --background --factory-startup --python-exit-code 1 --python tools/game-lab/assets/build_orbix_character.py
node tools/game-lab/assets/optimize_character.mjs
python tools/game-lab/assets/verify_character.py
& 'C:\Program Files\Blender Foundation\Blender 3.4\blender.exe' --background --factory-startup --python-exit-code 1 --python tools/game-lab/assets/render_character_review.py
```

The Blender process starts with empty factory settings and does not modify saved
scenes/preferences. Offline optimization resamples redundant keyframes, removes
constant bind-pose channels and unused samplers, deduplicates and prunes. The LOD
retains the same complete rig/clips and reduces mesh triangles to roughly 3,000.
It is intended for distant actors, not local-player closeups.

`verify_character.py` checks GLB container length, embedded images, no decoder
extensions, expected joints/clip names, finite and monotonic animation data,
server-owned root motion, exact final SHA256 and geometry/network budgets. Local
Blender renders reviewed Idle, Sprint, PunchCross, Death and Kick after retarget
and optimization. Browser integration still requires review of camera framing,
weapon grip, blending and mobile performance; these renders do not establish
50-client performance or AAA visual quality.

## Original mascot family (2026-10-09)

The visible character meshes now come from `web/src/center/worlds/CuteCharacter.ts`,
using the existing CC0 skeleton as their shared foundation. Maple (`cat`) and Tuck
(`turtle`) join the ten existing original characters. New meshes, facial features,
shell panels, fur shader and locomotion tracks are original procedural work; no new
external art downloads are involved. `original-characters.manifest.json` records
source hashes and ownership.

`characterRig.ts` shortens presentation legs (cat 0.76, turtle 0.62, others 0.82),
adjusts pelvis translation tracks, and detaches cloned inverse matrices before
rebinding. This detachment is essential: Three's Skeleton clone shares that array.
`locomotion.ts` authors in-place Walk/Run/Sprint with an IK foot path and relaxed
arm swing. Cadence is calibrated from backward planted-foot velocity and includes
the presentation group's Z scale. Other source clips remain available with
retargeted pelvis offsets. Authority, collision, health, speed and rewards stay on
the Python server.

`AnimationRig.ts` owns split upper/lower actions, synchronizes gait phase, seeds idle
before rendering, and removes expired combat contributions on return to movement.
Decorative idle freezes under reduced motion; essential locomotion still plays.

Near geometry uses 16×10 spheres; distant geometry uses 8×5 with less face/tail
detail. The default near characters peak at 14,072 triangles in the browser
fixture, with at most five material groups. Customized geometry is bounded by the
regressions too. Fur is surface grain, fiber colour variation and rim shading in
existing passes. It has no strand silhouette or transparent shell overdraw.

Reproduce from the repository root:

```bash
node tools/tests/original-character-regression.mjs
node tools/tests/locomotion-regression.mjs
node tools/tests/actor-state-regression.mjs
# Start Vite in web at port 5188, then:
node tools/tests/character-frame-regression.cjs
node tools/tests/character-podium-browser.cjs
# Local API serves the final built SPA at port 8100:
node tools/tests/character-integration-browser.cjs
ORBIX_BASE_URL=http://127.0.0.1:8100 node tools/tests/v4-worlds-browser.cjs
```

These checks cover actual rigs, layered clips, finite skinning, cached-source
ownership, cleanup, frame captures and authenticated selection. The podium browser
uses placement fixtures, while the integration browser uses a real authoritative
match. SwiftShader browser results do not establish physical-phone performance or
literal parity with the banner's offline render detail. Curated before/after images
and metadata live in `tools/tests/evidence`; full frame sets are regenerated under
`/tmp/orbix-q-frames`.
