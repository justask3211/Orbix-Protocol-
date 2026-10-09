# Framework license ledger — 2026-10-09

| Item | Provenance / version | License | Use |
|---|---|---|---|
| cannon-es | npm 0.20.0, lockfile integrity pinned; docs/licenses/cannon-es-MIT.txt and web/public/licenses/cannon-es-MIT.txt | MIT, copyright 2015 cannon.js Authors | Imported static collision queries |
| Three.js / R3F / React | existing package lockfile | MIT | Existing renderer, Mixer and SPA |
| Ranger animation source | web/public/center-models/orbix-ranger.manifest.json; existing LICENSE-Quaternius-CC0.txt | CC0 | Existing 20 retargeted clips; unchanged GLBs |
| Mascot meshes, terrain textures, outpost props, damage glyphs | Original repository code and this change | Original procedural assets; no third-party asset import | Native geometry/canvas |
| VRM Game Starter / BVHEcctrl | b14c236fd8150855348ad085b7820c298eac4b30, LICENSE inspected | MIT code; sample models separate | Techniques studied only; no code/assets copied |
| OpenCombat | aad6c51adbe6d89254b2302c7742449090596b86, LICENSE inspected | MIT code | Techniques studied only; no code/assets copied |
| PlayCanvas / Godot | Primary docs and export workflows | MIT engines; editor/service/assets separate | Optional offline authoring; no dependencies/assets imported |
| Babylon / Rapier | measured npm manifests/license texts | Apache-2.0 | Research only; excluded by user MIT/CC0 restriction |
| Jolt | npm 1.1.0 | MIT | Research only; runtime rejected for transfer/bindings cost |
| Mixamo / VRoid sample avatars | Adobe/VRoid respective terms | Not MIT/CC0 | Rejected, no imports |

An open-source engine does not license the artwork exported with it. Future GLBs
must record source URL, explicit CC0/MIT permission, authorship, SHA256, byte size,
meshes/texture sizes/clip names and optimization settings before import. Inspect
rest pose, units (meters), Y-up and scale; root motion off, no double displacement.
GLB is artwork interchange: behavior, collision and money logic stay in Orbix.
