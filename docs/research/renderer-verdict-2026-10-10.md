# Renderer verdict correction — 2026-10-10

Status: current product decision. Supersedes the adoption/default verdict in [Babylon parity](babylon-parity.md), [engine analysis](engine-analysis.md), and the [earlier adoption session](../sessions/2026-10-10-babylon-adoption.md). Those files retain historical implementation and measurement evidence.

## Decision and scope

The product owner judges the old Three.js Token Catch visually **superior in structure, texture and colour**. The Babylon presentation is inferior; the reported improvement is movement. Functional parity did not establish visual parity, and an engine migration is not itself an art upgrade. Record that judgment without reinterpreting it as approval of Babylon's visuals.

Token Catch's default returns to **Three.js**. Keep `?engine=three` as an explicit route and `?engine=babylon` as an **experimental, non-default evaluation route**. Other games continue using Three.js. Retain Babylon dependencies, scene code, assets, Havok work, license notices, measurements and both loading paths. No migration or deletion is authorized by this redirect.

This planning round makes the expressly permitted small source correction in `web/src/center/worlds/GameWorld.tsx`: Babylon is selected only when the game is Token Catch and the URL explicitly contains `engine=babylon`. Missing, unknown, or `engine=three` values use Three.js. The unused `_renderer` state override no longer selects the experimental renderer. No controls, movement rules, world content, availability settings or generated bundles are changed. There is no Railway deployment; the existing prebuilt static bundles still need a deliberate rebuild in the BUILD round before serving this source change.

The owner will disable/hide the open world manually. Returning a renderer default does **not** mean promoting the world again. Preserve the current game mechanics and stop open-world feature investment. New portfolio work follows [the latency strategy](../specs/game-portfolio-strategy.md).

## Why the port lost visual quality

The following causes are supported by source inspection. Their relative perceptual contribution is an inference, not a new side-by-side user study.

| Area | Three.js baseline | Babylon implementation | Implication |
| --- | --- | --- | --- |
| Character surface | `CuteCharacter.ts` builds five palette regions, soft contours, a cat fur shader, grain/fibres, tail stripes and a soft fur rim | `export-babylon-mascots.mjs` exports geometry/standard materials; its manifest explicitly says shader-only fur becomes PBR. `actor.ts` applies roughness `.85`, metallic `.015`, environment intensity `.6` | glTF geometry and clips survive, but renderer-specific shader detail does not. Palette-only PBR changes the plush surface and edge treatment |
| Character detail | Cat ears, cheeks, vest, tail, whiskers and layered eye highlights; turtle raised scutes/plastron | Same original geometry is exported, so **not all detail meshes are missing**. LOD removes some facial detail. Runtime accessories use simplified native primitives | Preserve the distinction between lost fur shading, LOD omission and simplified accessory art; do not claim the port lost the whole mascot mesh |
| Props and structure | `FieldEnvironment.tsx`, `ItemMeshes.tsx`, `ItemAssets.ts`, first-person meshes: layered outpost/cover, trim, signs, windows, steps and detailed items | `environment.ts` and `objects.ts` rebuild scenery/items with native palette primitives; outpost is a deck, mast, sign and flag; cover is primarily boxes and caps | Mechanical collider parity does not preserve the authored silhouette, composition or prop detail |
| Terrain and water | Original deterministic colour/normal textures, vertex colours, layered vegetation, textured water normals | Terrain has vertex colours plus a 128×128 grain albedo texture. Water is a palette PBR ground plane without the Three normal treatment | Babylon is not texture-free, but its material detail is thinner and less varied |
| Light and atmosphere | `FieldLighting.tsx`: warm key, cool rim, hemisphere and ambient fill; Token Catch key intensity `3.2`; ACES exposure `1.05`; warm fog `38–120` for arena | `environment.ts`: key `1.3`, hemisphere `.65`, tiny procedural radiance cube, contrast `1.12`, exposure `1`, blue fog `32–100` | Different shadow warmth, highlights and haze can flatten or wash the palette. Numeric intensities are not directly comparable across renderers; match reference images, not numbers |
| LOD/quality defaults | Both renderers default to Fast on coarse pointers/small screens; Three's `SkeletalActors.tsx` retains full detail for the local actor and opponents within 12 units, switching more distant actors to LOD | `runtime.ts` loads LOD for **every nonlocal actor regardless of distance**, and the local actor at Fast; `assets.ts` uses separate exported GLBs | Near opponents can lose eye highlights/whiskers/detail too early. Fast is a performance tier, not permission to remove identity |
| Shadow defaults | Three field shadows require detailed world, non-Fast, fine pointer and width ≥800; map 1024 | Babylon Fast disables shadows; Balanced uses 512, Sharp 1024 | Grounding/structure can differ by device even under similarly named quality settings |

The existing Three character finish is also mostly procedural; it clears image maps in `cartoonFinish`. Do not invent a rich imported clothing-texture pipeline already present. The owner is responding to a richer overall composition and surface treatment. [The clothing plan](../specs/character-art-upgrade.md) specifies real new garment textures deliberately.

## What Babylon would need to match (record only)

1. Bake or implement the original fur/contour treatment, stripe masks, layered eyes and material-region semantics; use named clothing regions so outfit changes do not tint fur or faces.
2. Restore prop silhouettes, trim, outpost composition, item/accessory detail and first-person equipment. Share original art assets through GLB where appropriate; avoid substituting unrelated primitives merely because they are native to the renderer.
3. Match terrain grain/normal response, water normals, vegetation layering and spatial colour rhythm using the same original art reference.
4. Calibrate colour space, tone mapping, exposure, fill/rim, fog distances and contact shadows against identical cameras/quality tiers. Keep colour legible on Fast without relying on expensive effects.
5. Select character LOD by projected size/distance, retaining full detail for nearby opponents and lobby/podium portraits. Verify every cosmetic in full and LOD variants.
6. Obtain visual approval on actual phones and desktop GPUs, with identical state, camera, resolution and lighting intent. Then separately measure cold-load bytes, frame time, interaction feedback and cleanup.

This is a deferred parity backlog, **not the next BUILD scope**. Babylon is not inherently unable to produce good art; this port did not preserve the approved art treatment. Carry over tested renderer-neutral animation/state/cleanup concepts into the new stages without loading two renderer runtimes into a scene.

## Evidence limits and acceptance

[The earlier parity record](babylon-parity.md#measurements) reports SwiftShader p95 frame intervals of 1399.8 ms for Three and 2876.4 ms for Babylon, with tiny sample counts. Both miss the 30 FPS target. It also reports renderer additions of 1,188,516 raw bytes for Three versus 6,009,929 for Babylon including Havok, excluding GLBs/shared code. These historical local measurements establish neither phone performance nor a Babylon speed win. The owner's movement observation is a separate qualitative judgment; both paths use the same authoritative Python rules and shared prediction/interpolation logic.

The small revert is accepted when the routing matrix is correct, TypeScript remains valid, explicit Babylon evaluation remains available, and the commit contains no generated release artifacts or unrelated work. BUILD must check both routes after rebuilding. All game availability changes remain the owner's manual operation.
