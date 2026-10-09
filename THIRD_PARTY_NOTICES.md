# Third-party notices — Babylon game client

The 2026-10-10 product-owner override allows Apache-2.0 code dependencies. Artwork
remains original Orbix geometry or the existing Quaternius-derived CC0 rig/clips.

| Package | Pinned version | License | Use |
| --- | --- | --- | --- |
| @babylonjs/core | 9.30.0 | Apache-2.0 | Lazy Babylon scene, renderer, camera, AnimationGroups, physics integration |
| @babylonjs/loaders | 9.30.0 | Apache-2.0 | Existing GLB AssetContainers |
| @babylonjs/havok | 1.3.14 | MIT | WebAssembly capsule contacts, slope and step controller |

Babylon.js is copyright (c) Microsoft Corporation and contributors. Exact installed
Apache license and upstream NOTICE are preserved in
`docs/licenses/babylonjs-Apache-2.0.txt` and `docs/licenses/babylonjs-NOTICE.md`.
The installed Havok for web MIT notice is preserved in `docs/licenses/havok-MIT.txt`.
The same notices are distributed under `web/public/licenses/` in built clients.
Packages are used unmodified. No upstream NOTICE was present in @babylonjs/loaders;
it ships the same Apache-2.0 license as core.

Existing rig/animation provenance: `web/public/center-models/NOTICE.md` and
`LICENSE-Quaternius-CC0.txt`. Exported original mascots record source hashes, clip
names, bytes and output hashes in `center-models/babylon-mascots/manifest.json`.
The offline GLB exporter uses existing Three.js tooling under its existing MIT
license; it is not a Babylon runtime dependency.
