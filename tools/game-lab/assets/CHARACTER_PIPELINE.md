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
