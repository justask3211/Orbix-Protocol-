# Open-world game tooling review — 2026-10-07

The user wants an expressive third-person multiplayer action game: detailed characters, believable movement, authored environments, animation transitions, useful terrain and responsive controls. The previous procedural capsule/body and flat arena presentation did not meet that expectation. Fortnite is a quality reference, not a claim that this browser project has reached equivalent production value. Installing skills cannot provide the missing art direction, animation content, level design, networking validation or device performance evidence.

## Installed skills and provenance

Eight missing skills were installed into `C:/Users/santh/.codex/skills` with the built-in skill-installer, from the MIT-licensed [alton47/threejs-skills](https://github.com/alton47/threejs-skills/tree/7b8e25638cff83a6be4926d8f05001022cc80ac3) at commit `7b8e25638cff83a6be4926d8f05001022cc80ac3`:

| Skill | Purpose |
| --- | --- |
| threejs-core | Renderer lifecycle and sizing |
| threejs-materials | PBR surfaces and texture conventions |
| threejs-lighting | Sun, environment illumination and shadow coverage |
| threejs-camera | Perspective and camera-control patterns |
| threejs-physics | Collision and character-controller references |
| threejs-shaders | Terrain/material effects and shader fundamentals |
| threejs-react | R3F scene and asset integration |
| threejs-performance | Instancing, LOD, compression and profiling |

These are community skills. The upstream README's use of “official” is not evidence of endorsement by Three.js maintainers. Every new installed directory retains its MIT LICENSE and contains `ORBIX_CORRECTIONS.md`, linked from SKILL.md. The repository manifest `tools/game-lab/skill-sources.json` records source commit, upstream/local skill hashes, correction hash and license hash. Existing corrected animation, geometry, loading, postprocessing and audio skills were preserved byte-for-byte against their manifest hashes. New skills become discoverable on the next Codex turn; their files can already be read explicitly.

Review found stale examples. Corrections cover removed legacy-light flags, HDRLoader replacing deprecated RGBELoader, NoColorSpace for data textures, UV channel selection, alpha-map channel, R3F `gl`, positive render-priority takeover, primitives not cloning objects, independent skeleton instances, fixed-step physics, shader coordinate spaces and unsupported draw-call/FPS promises. Installed Three.js `0.186.1` source and the [renderer](https://threejs.org/docs/pages/WebGLRenderer.html), [texture](https://threejs.org/docs/pages/Texture.html), [R3F hooks](https://r3f.docs.pmnd.rs/api/hooks) and [object lifecycle](https://r3f.docs.pmnd.rs/api/objects) documentation are the authority for these corrections.

## Available tools versus shipped game code

The production frontend currently uses React `19.3.0`, R3F `9.8.1` and Three.js `0.186.1`. The separate `tools/game-lab` already contains Drei `10.7.9`, react-three-rapier `2.2.0`, glTF Transform `4.5.1`, meshoptimizer `1.3.0`, Howler `2.2.4`, Motion `14.0.0`, Zustand `5.0.15`, Playwright `1.63.0` and axe `4.13.0`. Availability in the lab does not mean any package is loaded by production.

`ecctrl` `2.0.2` is added only to the isolated lab. It is MIT-licensed, exposes character/camera/animation helpers and declares peers compatible with this lab. Its package and lockfile are pinned; source was reviewed at `e2cab804f9f15661a642e76f52d09f0b2db63f35`. [Maintainer repository and package](https://github.com/pmndrs/ecctrl/blob/main/package.json). Do not replace authoritative Python movement with a client ecctrl/Rapier simulation. A future production controller adoption needs compatible server collision, input reconciliation and replay tests.

Blender `3.4` is installed, and its local addons directory already includes `ant_landscape`, `rigify` and `io_scene_gltf2`. These provide terrain authoring, rig generation and glTF export; this review verifies files exist, not that all addons have been enabled or used. The existing [Blender MCP](https://github.com/ahujasid/mcp-for-blender) is a community automation bridge, not a Blender Foundation plugin. There is no need to install another unreviewed terrain/rigging MCP merely to duplicate those capabilities.

## Implementation layers and constraints

1. **Character assets:** choose one licensed rigged hero set, a consistent skeleton and verified clips for idle, walking, running, jumping, falling, landing, aiming, punching, guarding and knockdown. Audit proportions, feet/root position, clip duration and movement direction before integration. Clone skeletons per player, reuse immutable resources and use per-player mixers. [Three.js animation system](https://threejs.org/manual/en/animation-system.html).
2. **Locomotion and combat animation:** drive transitions from confirmed movement/combat state, not arbitrary CSS timers. Blend walk/run, separate camera yaw from avatar facing, and allow upper-body aim over locomotion where the rig permits it. Prevent foot sliding by matching clip playback to actual speed. Jump/land/strike/knockdown actions need controlled loops and transitions. [AnimationAction](https://threejs.org/docs/pages/AnimationAction.html).
3. **Terrain and collision:** generate a bounded shared heightfield or authored mesh with simple collision proxies. Use the same height/collider definition on server and client. Decorative hills outside a flat playable floor are not traversable terrain; shader displacement alone changes only visuals. Heightfields fit simple outdoor topology; fixed mesh colliders suit buildings; dynamic objects should use simpler convex shapes. [Rapier colliders](https://rapier.rs/docs/user_guides/javascript/colliders/).
4. **Movement feel:** capsule size, ground offset, gravity, jump impulse, sprint speed, step height, slope limits, ground snap and camera obstruction must be explicit. Validate stair/edge/wall/jump interactions before enlarging a level. Rapier's controller reference supports these concepts, but matching server rules remain necessary. [Character controller](https://rapier.rs/docs/user_guides/javascript/character_controller/).
5. **Environment art:** distinguish Catch's supply-drop field, Raid's boss encounter and Duel's combat courtyard. Use landmarks, readable routes, cover, restrained foliage and distinct light/material palettes. PBR ground detail, local environment illumination and bounded sun shadows matter more than bloom on primitives. Asset licenses are separate from code licenses. [Poly Haven asset license](https://polyhaven.com/license), [ambientCG](https://ambientcg.com/index.php).
6. **Asset delivery:** inspect GLB geometry/material/skin/clip counts, select a local asset path, compress suitable geometry/textures and retain fallbacks. Load the chosen hero/world first and warm needed materials before play. Never silently rely on external decoder/HDR preset requests. [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html), [glTF Transform](https://gltf-transform.dev/).
7. **Multiplayer and rewards:** the room server remains responsible for legal movement, clocks, contested loot, damage, winner selection and integer entitlements. Rendering prediction, interpolation and animation cannot authorize a pickup or mint a reward. Test packet delays, reconnection, released input and simultaneous pickup separately. Colyseus was reviewed as an [MIT multiplayer framework](https://github.com/colyseus/colyseus); introducing a second room system now would duplicate the established Python authentication/moderation/settlement boundary, so it was not installed.
8. **Measured quality:** test representative desktop and mobile hardware, cold loading, p95 frame time, shader warm-up, memory, simultaneous characters and input latency. Use skeletal update distance, object LOD, instanced repeated scenery and quality tiers. A 50-player server capacity is not proof of 50 rigged avatars rendering smoothly on every phone. [R3F performance guidance](https://r3f.docs.pmnd.rs/advanced/scaling-performance).

## Reviewed candidates not installed

- `PlayableIntelligence/game-creator`: broad workflow includes alternative deployments, monetization, paid asset APIs and opinionated architecture; no root repository license was detected. It would add unrelated product and system changes. [Source](https://github.com/PlayableIntelligence/game-creator).
- `Picaresco/threejs-skill` (MIT, reviewed SHA `649c04c11211979056eb8f6cefcf2a2f32ddc9e0`) and `linegel/threejs-complete-set-of-skill` (ISC, reviewed SHA `e3c9563a070b214aa73b84d1ea6026c9ec4db6cb`): useful references but substantially overlapping, with WebGPU-first/canonical WebGPU workflows that do not match the current production WebGL renderer. No renderer migration or giant skill collection was installed. [Picaresco source](https://github.com/Picaresco/threejs-skill), [linegel source](https://github.com/linegel/threejs-complete-set-of-skill).
- OpenAI `develop-web-game`: reviewed the old Apache-2.0 skill at SHA `77963424cd7687fd52e5fcfdd3f08d826ab9b1ab`. It was removed from the current curated repository on 2026-04-23. Its independent Playwright runner and browser time-stepping globals are unnecessary for this authenticated multiplayer game and conflict with the required in-app browser QA workflow if followed literally. It was not installed as a current supported skill. [Upstream removal](https://github.com/openai/skills/commit/11c643813b4645ca9f25d49ca180697732e0141a).
- Paid Meshy/fal/AI asset services, Unity/Unreal editor MCPs and bulk registry copies were not installed. There is no verified missing editor integration that requires an account or replacing the shipping browser game engine.

## Verification and reproduction

Global verification passed eight new skill/frontmatter/license/correction hashes and the five preserved Three.js skill hashes. Existing lab imports, GLB read/write and meshoptimizer codec/CLI round-trip, source-preserving overwrite guards and a Rapier fixed-step ground collision smoke check passed. These are installation/asset-tool tests, not an FPS, networking or visual-quality certification. Upstream dependencies emit Three.js CommonJS and Rapier initialization deprecation warnings; they did not fail the smoke check.

The new ecctrl package imported successfully with `Ecctrl`, `EcctrlAnimationStateController`, `resolveEcctrlAnimationState` and `useEcctrlAnimationStore` exports. Version `2.0.2`, MIT metadata and the lockfile integrity `sha512-cbfB/egQwZgNKmNIkdtdILWUo/U7EWLa2uAgqWQ8uvrRgxKJ/01VZ51RhEezvtnWl8/Y2tmetf3TNYw8c7llEQ==` were verified. The lab npm audit after installation reported zero known vulnerabilities across all severity levels. Installation used `--ignore-scripts`; no third-party lifecycle scripts were executed.

Run lab commands with bundled Node 24 ahead of older system executables:

```powershell
$env:Path = 'C:\Users\santh\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:Path
$orbixNode = 'C:\Users\santh\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$orbixNpm = 'C:\Users\santh\.codex\orbix-tooling\npm\node_modules\npm\bin\npm-cli.js'
Set-Location 'C:\Users\santh\Orbix-Protocol-\tools\game-lab'
& $orbixNode $orbixNpm ci --ignore-scripts --no-fund
& $orbixNode scripts/verify-tools.mjs
& $orbixNode $orbixNpm audit --audit-level=high
```

Browser validation in this Codex session uses the approved in-app browser skill/runtime. No skill installation overrides that rule or authorizes browser storage inspection, production impersonation, deployment to another provider or changes to settlement contracts.
