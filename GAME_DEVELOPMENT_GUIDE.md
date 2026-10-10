# Orbix game development setup

Research and installation date: 2026-10-05. This setup prepares a vibrant browser arcade with distinct game worlds, character animation, multiplayer and verified token rewards. It does not implement a production 3D game or certify contracts. Application dependencies and contracts were not changed by this tooling task.

## Installed capabilities

| Capability | Installed selection | Use |
|---|---|---|
| UI/UX design | `ui-design@claude-code-workflows` 1.0.5 | Visual foundations, responsive CSS, component systems, interaction and accessibility |
| Distinctive frontend | Anthropic `frontend-design` | Game-center shell and themed screens |
| Taste | `design-taste-frontend` | Brief-led landing/marketing design; its own scope excludes multi-step product UI |
| React performance | `vercel-react-best-practices` | Browser render/loading patterns; ignore Next-only APIs in Vite |
| Game principles | `game-development` with 11 topic references | Game design, art/audio, 3D, browser and multiplayer planning |
| Three.js references | geometry, animation, loaders, postprocessing, audio | Selected references with local API/resource corrections |
| Orbix-specific rules | `.agents/skills/orbix-game-engineering` and global copy | Current colorful brief, truthful rewards, character lifecycle and measured multiplayer |
| Blender authoring MCP | plugin 2.1.1, server 2.1.8, existing Blender 3.4.1 | Meshes/materials, scene inspection and GLB export |
| Browser game lab | `tools/game-lab` | Pinned rendering, physics, animation, audio, state and asset tools |
| Starter characters | Kenney Animated Characters Protagonists | Free CC0 characters/skins and movement animations; see asset manifest |

New global skills/plugins become available to Codex on the next turn/reload; they are not all callable from the turn that installs them. The UI plugin also includes native-mobile skills; those are conditional references, not an instruction to migrate Orbix to native apps.

The lab uses Three.js 0.186.1, Fiber 9.8.1, Drei 10.7.9, Rapier 2.2.0, Motion 14.0.0, Howler 2.2.4 and Zustand 5.0.15. React 19.3.0 and Vite 8.3.2 are isolated here. GLTF Transform SDK 4.5.1 and Meshoptimizer 1.3.0 cover the verified asset pipeline. Playwright and axe packages are installed for future QA; installation alone is not an accessibility test. Exact dependencies are in the package lock. Local Node 24.19.0 and isolated npm 12.2.0 avoid changing system Node 21.

## Use the setup

From the repository root:

```powershell
.\tools\game-lab\run.ps1 -Action verify
.\tools\game-lab\run.ps1 -Action build
.\tools\game-lab\run.ps1 -Action dev
.\tools\game-lab\blender\launch.ps1
```

The lab serves only `127.0.0.1:5188`. Blender's per-session helper loads the addon without saving global preferences. Start the localhost bridge from its sidebar when authoring and stop it afterwards. MCP safe mode and telemetry disabling are configured; paid generation providers remain disabled. The addon socket is unauthenticated and its permitted file operators retain broad access: safe mode is not a filesystem sandbox. Do not expose it beyond localhost.

The character download contains FBX originals and separate clips. A derived self-contained rigged GLB was exported, but it has no clips: direct transfer failed a bind-pose check. Retargeting and visual review are required before animated gameplay. Originals and source/license/hash records are preserved.

Verification completed: dependency imports, GLB/Meshopt roundtrip, explicit asset CLI input/output protection, Rapier collision smoke, TypeScript and production lab build. The lab dependency audit reports zero known vulnerabilities on this date; this is not an audit of production dependencies or contract safety. The in-app browser rendered the island, transitioned to ready, and exercised keyboard focus/reset and pointer controls. Sustained movement, mobile play and multiplayer latency were not benchmarked. The fixture is not a production art-direction approval.

The build's shell chunk is approximately 70.89 KB gzip and lazy scene approximately 1,093.17 KB gzip including physics/WASM. This verifies code separation, not a proven fast cold load on phones. The production center should avoid fetching all game scenes initially and needs selected-game asset/network budgets.

See `tools/game-lab/blender/README.md` for repeatable verification. The check passed mesh/material creation, valid GLB export, MCP initialization, nine tool enumeration, scene inspection and safe-mode rejection of `import os`. Because upstream disables background timers, verification used a temporary main-thread bridge through its real command dispatcher. The interactive viewport was not verified by that check.

## Why this selection

One coherent browser renderer fits the existing React/Vite project. Blender supplies free local asset authoring. Existing installed motion/accessibility/frontend skills cover many requests; duplicate skill packs do not improve an implementation. Free libraries do not make hosting, network traffic or human-created artwork free.

Excluded or deferred after review:

- CloudAI-X Three.js pack: older examples and incomplete license notice in the inspected tree.
- Most alton47 Three.js topics: API correctness problems; only five selected references were installed, with explicit local corrections.
- TasteSkill's soft/luxury variants: their direction conflicts with the user's joyful arcade brief. The main skill remains contextual.
- Three.js DevTools MCP: the inspected defaults bind beyond localhost and expose unauthenticated remote evaluation; it needs a local-only configuration/code review before enabling.
- New Godot/Unity/Babylon/PlayCanvas engines: useful alternatives, but installing multiple engines doesn't solve Orbix's existing browser UX.
- Official Blender Lab MCP: its newer Blender requirements do not justify replacing an already verified local authoring setup.
- Colyseus server: optional future architecture experiment, not installed as a replacement for existing Python authority.
- GLTF Transform CLI: its current dependency path produced three high-severity advisories. Replaced with the SDK rather than downgrade to an obsolete CLI.

## Development sequence

1. Build the colorful center shell: illustrated game destinations, recognizable play actions, practice, room discovery, active tournaments and verified reward history.
2. Select one flagship game. Runner is a candidate for expressive 3D movement; confirm its mechanics and phone controls first. Deliver its complete home/create/join/lobby/load/start/play/hint/reconnect/result experience.
3. Establish a character rig, idle/run/jump/land/celebrate state graph, collider, camera, sound cues and asset manifest. Preview animation transitions before importing into the production game.
4. Measure current server and websocket behavior before adding high-rate movement. Separate fixed simulation, visual updates, snapshots, checkpoints and settlement. Add prediction/reconciliation and remote interpolation where needed.
5. Profile named desktop/mobile devices and realistic networks. Tune scene complexity, texture sizes, draw calls, DPR, shadows and loading chunks against measured limits.
6. Reuse the verified shell/protocol/asset pipeline for each game while giving each a distinct world and HUD. Text/puzzle games need legibility more than expensive 3D effects.

The production room scheduler currently defaults to about 4 Hz, while accepted actions save snapshots and client acknowledgements can trigger synchronization. This is a concrete area to investigate for action games. Merely animating the client cannot establish fast authoritative multiplayer.

The recommended starting multiplayer design is sequenced validated inputs, authoritative tick/acknowledgement, immediate local prediction, server reconciliation and buffered remote interpolation. A 30 Hz simulation/10–20 Hz snapshot experiment is a starting hypothesis, not a verified requirement or promise. Keep rewards and blockchain transactions outside movement loops.

The installed skill references contain reusable prompts for art direction, character assets and multiplayer verification. Define a reference device/network before setting FPS or load-time budgets. Report cold-load bytes, first playable time, p95 frame time, RTT/jitter, correction size and repeated-room-exit memory; do not claim the lab fixture proves production performance.

## Provenance and licenses

`tools/game-lab/skill-sources.json` records exact reviewed commits. Each global community skill has `INSTALL_SOURCE.json` and available upstream notices. The game-development collection licenses written content CC BY 4.0 and code MIT; retain its attribution and content notice when redistributing. Vercel's skill declares MIT in frontmatter; its inspected root did not include a separate full notice. Anthropic frontend-design is Apache 2.0. TasteSkill and selected Three.js skills are MIT.

The local Blender marketplace is `C:\Users\santh\.codex\orbix-tooling\marketplace`; it preserves MIT licensing and replaces upstream mutable `uvx` invocation with the exact installed executable. Its reviewed upstream revision is `34b7bd277fff75a693cde78930b4359478958a01`. Python dependency versions are snapshotted in `tools/game-lab/blender/requirements.lock.txt`.

Research clones, node_modules, build output and verification artifacts are ignored; source helpers, manifests and lock files remain reviewable. Character originals are cached outside production assets; see `tools/game-lab/assets/README.md` before copying selected derived files into a game.

## Primary sources and asset catalogs

- [Fiber performance guidance](https://r3f.docs.pmnd.rs/advanced/scaling-performance) and [pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls): asset reuse, instancing, deliberate render loops and avoiding per-frame React state.
- [Drei animation helpers](https://drei.docs.pmnd.rs/abstractions/use-animations), [Rapier integration](https://github.com/pmndrs/react-three-rapier), [GLTF Transform](https://gltf-transform.dev/), [Meshoptimizer](https://github.com/zeux/meshoptimizer).
- [Colyseus prediction/reconciliation](https://docs.colyseus.io/netcode/client-prediction): reference for future movement experiments, not proof Orbix implements this protocol.
- [Kenney characters](https://kenney.nl/assets/animated-characters-protagonists), [Quaternius base characters](https://quaternius.com/packs/universalbasecharacters.html) and [animation library](https://quaternius.com/packs/universalanimationlibrary.html): check free-subset boundaries and exact rigs/formats.
- [Poly Haven license](https://polyhaven.com/license), [API terms](https://polyhaven.com/our-api) and [ambientCG](https://ambientcg.com/): future CC0 textures/environments, import only selected assets with source records.
- [UI design plugin source](https://github.com/wshobson/agents/tree/main/plugins/ui-design), [Anthropic frontend skill](https://github.com/anthropics/skills/tree/main/skills/frontend-design), [TasteSkill](https://github.com/Leonxlnx/taste-skill), [Vercel skills](https://github.com/vercel-labs/agent-skills), [game-development bundle](https://github.com/sickn33/antigravity-awesome-skills/tree/main/skills/game-development), [Three.js references](https://github.com/alton47/threejs-skills), [Blender MCP](https://github.com/ahujasid/mcp-for-blender).


## 2026-10-10 Babylon implementation update

The product-owner override mandates Babylon.js and accepts Apache-2.0 code deps.
Token Catch uses `web/src/center/babylon/` by default (Babylon core/loaders 9.30.0,
Havok 1.3.14); the earlier engine recommendation is superseded for this game.
`?engine=three` and other games retain the existing renderer. See
`docs/research/babylon-parity.md` for implementation, identical authority protocol,
CC0/original GLBs, test evidence and performance/bundle limitations. Deployable
static inputs are assembled locally; Hermes deploys, not this build round.
