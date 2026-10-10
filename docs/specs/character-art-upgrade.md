# Character outfits and surface upgrade — 2026-10-10

Status: art/engineering plan for BUILD, no asset or profile changes in this planning round. Art must be original Orbix work or verified CC0. The preferred production renderer is [Three.js](../research/renderer-verdict-2026-10-10.md). New outfits serve seated/board games, lobby, profile and podium; they are not a reason to resume open-world development.

## Current foundation and limitations

The server/client catalog already contains 12 original mascots: Maple (cat), Tuck (turtle), Boba (blob), Pip (knight), Mochi (cat-blob), Peep (duckling), Orbit (astronaut), Bolt (toy-robot), Flip (pancake), Wisp (jelly-ninja), Bud (sprout), Puff (marshmallow). `center/characters.py` and `web/src/center/characters.ts` validate/mirror hats, glasses, outfit and accessory. Outfits currently are `default`, palette tints `coral`/`mint`/`lilac`, and `dress`.

`CuteCharacter.ts` uses original procedural skinned parts with five palette materials on the existing CC0 skeleton/clips. Maple has tabby detail and a fur shader; Tuck has raised shell/plastron meshes. `dress` is currently a single inverted cone attached to pelvis with a colour tint. It lacks a fitted bodice, waist, seams, skirt panels and clothing texture. Most variants change a base palette region; they do not provide distinct clothing silhouettes.

`cartoonStyle.ts:cartoonFinish` explicitly clears `material.map` and `normalMap`. The procedural combined geometry in `CuteCharacter.ts` copies positions/normals/skin data but does not retain UV attributes. Merely assigning a cloth texture will either be erased or sample incorrectly. Preserve the approved contour/fur treatment while adding UV-bearing, named clothing regions and a cloth material path that **keeps** verified textures. Do not globally modify every skin/eye material to support shirts.

Babylon's runtime accessories are simplified primitives and its outfit code tints the first PBR material it finds. The exported default GLBs do not contain every costume. Record this parity gap; Babylon remains experimental. New clothing assets may be shared through GLB, but no full Babylon wardrobe port is required for this BUILD.

## Wardrobe decision

Create six real outfit silhouettes, with per-character fitting and original fabric patterns. Dresses are available to any compatible mascot. Every current selectable character must have a readable compatible outfit presentation; core eyes, ears, shell, helmet, sprout and silhouette remain visible.

| Stable new outfit ID | Silhouette | Texture/detail | Best stage use |
| --- | --- | --- | --- |
| `overalls` |Rounded bib, shorts/leg panels, crossed straps, large pocket |Original denim/cotton weave, contrast stitches and one simple patch |Word Forge, Closest Call workshop |
| `rain-jacket` |Short hooded jacket, visible collar, soft sleeves, front placket |Matte coated-fabric grain, coloured zipper/seam trim |Atlas Quest travel desk |
| `festival-jacket` |Cropped jacket, rolled cuffs, wide lapels, sash |Original block-print/star motif and embroidery at readable scale |Relic Auction, RPS |
| `tunic` |Layered tunic, waist belt, rounded hem, sleeve cuffs |Woven linen, stitched borders, small original leaf badge |Prism Lines, garden tables |
| `dress-sun` |Fitted bodice, waist ribbon, flared segmented skirt, knee-length hem |Original gingham/flower print, subtle cotton weave, stitched hem |Museum/garden games |
| `dress-festival` |Layered skirt, short puff sleeves, waist sash, rounded overskirt |Original coloured panels and embroidered stars; restrained satin highlight |Auction, coliseum, podium |

Keep existing IDs persisted: `dress` renders as the compatible sundress preset while retaining its stored value;`coral`/`mint`/`lilac` keep their historical colour meanings and can use a fitted basic cloth overlay. `default` preserves each character's signature original attire/body. Do not delete/rename saved values or substitute a dress with only a body recolour. New catalog options are selectable in the existing outfit field; no separate commerce, inventories, unlock currency or NFT equipment system is needed.

Fit garments to the character's proportions. Tuck's jacket/dress requires a shell opening; Maple/Mochi keep the tail/ears unobstructed; Orbit's helmet is independent of cloth; Bolt uses segmented coveralls/panel seams instead of cloth hiding its toy silhouette; Flip keeps the visible pancake layers; Bud's leaves remain identifiable. Garment meshes include these openings as authored geometry; do not hide identity features to avoid clipping. Hats/glasses/accessories get the same combination review, with unsupported combinations rejected explicitly rather than rendering through the head.

## Per-character palette direction

Treat these as proposed production palette tokens to review beside existing vibrant `web/public/center-art/` banners. The current soft base colours are preserved as identity; richer garment/accent contrast connects them to the banners. Do not claim the existing bitmap banners already encode these exact hex values.

| Character | Body/identity family | Clothing / trim / accent | Surface distinction |
| --- | --- | --- | --- |
| Maple |Warm tabby sand `#B6A28D`, cream muzzle |Teal `#39BFAA`, coral `#F78369`, cream `#FFF0D4` |Preserve fur grain/stripes; woven vest and stitched dress/overalls are separate |
| Tuck |Leaf shell `#A4BF73`, cream plastron |Marigold `#F5B943`, deep teal `#287B70`, ivory `#FFF2D5` |Raised scutes stay readable, cloth around shell openings |
| Boba |Berry pink `#FFAFCD` |Cobalt `#5075E5`, cream `#FFF0D9`, tangerine `#FF9859` |Soft matte body; garment fabric has visible seams |
| Pip |Sky armour `#8CB8ED` |Scarlet coral `#F47766`, gold `#F6CE67`, navy `#354267` |Restrained enamel/metal, smooth cloth tunic beneath |
| Mochi |Lilac `#C5A4ED` |Mint `#50CBB8`, peach `#FFA781`, cream `#FFF4DE` |Plush body, small embroidered stars on clothes |
| Peep |Butter yellow `#FFE18C` |Turquoise `#35BFC8`, orange `#F89548`, ivory `#FFF5DA` |Readable beak/eyes; cotton jacket/dress, padded cuffs |
| Orbit |Aqua suit `#ADE5F2` |Indigo `#5962CD`, coral `#F88378`, lemon `#FFE18B` |Helmet gloss controlled; matte woven suit panels |
| Bolt |Mint enamel `#70D5C8` |Ultramarine `#4776D5`, sunshine `#F5C84D`, cream `#FFF2D8` |Enamel panels, cloth bib/segmented skirting |
| Flip |Toasted caramel `#E9B47A` |Raspberry `#D96798`, cream `#FFF0D0`, sage `#74B795` |Food-layer identity, knitted/cotton apron-like clothing |
| Wisp |Periwinkle `#9297EA` |Coral `#F1788D`, mint `#63D5BE`, ivory `#FFF0DA` |Soft jelly sheen, opaque fabric silhouette |
| Bud |Spring green `#A8DE87` |Lavender `#AA82DC`, melon `#FFAE75`, cream `#FFF3DB` |Leaves separate from garment weave |
| Puff |Warm white `#FFF2DE` |Royal violet `#8663D8`, teal `#45C9B8`, berry `#F18EB5` |White body stays shaded/readable; high-contrast cloth accents |

Use a garment's character-specific primary/trim/accent tokens, plus selected legacy tint overrides, while keeping face/fur/eye materials stable. Avoid a global team-colour wash over all clothing/body detail; communicate teams/seats with patches, cuffs, table markers and DOM names. Text/control contrast is measured separately from colourful art. Players must remain distinguishable without colour alone.

## Materials, textures, rig and lighting

Assign named material/geometry roles such as `fur`, `skin`, `eyes`, `shell`, `cloth_main`, `cloth_trim`, `metal`, `glass`; role mapping is explicit across source, export and preview. No “first material is the outfit” heuristic. Preserve base authored colours when applying textures; avoid multiplying two full-strength saturated albedos into an unexpectedly dark shirt. Use coloured texture masks plus palette tint in a documented linear colour-space path.

Author original tiling cotton/linen/denim prints and small embroidery/trim atlases, with real UVs and consistent texel scale. Seams, pockets, waistbands, collars and major hems are geometry when they affect silhouette; weave and small stitches are texture. Fast tier retains strong patterns, fold shading and identity, not blank flat coats. No licensed fashion logos, traced movie/game costumes, downloaded marketplace skins or textures with unverified rights.

Three material plan: MeshStandardMaterial for cloth, mostly metalness 0 and roughness about 0.65–0.95 by fabric; controlled normal detail and optional baked fold shading. Body/eye/enamel/glass keep distinct roughness. Use sRGB colour maps and linear normal/roughness maps; keep map sizes and lighting affordable on phones. Keep warm key, cool fill/rim and soft grounding/contact shadow so texture survives bright saturated palettes. Use the stage's lighting family with locked reference exposure; don't fix a dull fabric by making it emissive enough to erase all folds. Preserve approved contour/fur hooks with explicit program-cache keys and verify texture sampling in the combined shader.

Outfits use the current grounded in-place skeleton and named bones. A dress needs a bodice and segmented skirt weighted across pelvis/thighs (with an authored stable rest shape), not the existing single rigid cone. Seated idle, gesture, turn, celebrate and podium clips are required for the new games; existing walk/run/jump assets remain available without gameplay scope expansion. Check clip names, bind pose, scale and bone compatibility rather than assuming retargeting. No runtime cloth simulation needed: authored skin weights, limited secondary motion and reduced-motion static fabric fit the phone budget. Check seated knees, walking/jumping for compatibility previews, raised arms, tail/shell and hat/glasses combinations for intersection.

Proposed asset budgets (targets, not measured): full character plus outfit ≤20,000 triangles, LOD ≤5,000; six or fewer material draws per actor where practical; per-outfit compressed mesh ≤200 KB; shared cloth atlas 1024×1024, Fast 512×512 with optional smaller normals. At most four detailed seated actors at once in a casual stage; represent remaining players by semantic badges/summary. Retain full facial identity for hero/profile/podium and nearby opponents; choose LOD by projected size/distance.

Reuse verified GLB/Meshopt support, cached geometry/materials/texture atlases and independent skeletal clones. A new KTX2 path is conditional on verified decoder integration. Actor-owned tint/material copies must not dispose shared textures when another actor exits. Load selected outfit/character only; preload in profile/lobby after selection and cancel abandoned loads. Warm shaders and record actual bytes or named loading stages. Scene teardown releases mixers/listeners, owned materials and cached references correctly. `cartoonFinish` must retain new cloth maps **only on its cloth path** while keeping historical default rendering reviewed.

## Persistence through the existing profile system

Use authenticated `POST /api/center/v1/profile/character` (`center/api.py:save_character` → `validate_customization` → `Store.set_profile_character`). Existing storage is wallet-normalized `profiles.character` and `cosmetics_json`; retain the `{hat,glasses,outfit,accessory}` shape. Add stable outfit IDs to server `OPTIONS` and client `COSMETIC_OPTIONS`, with one tested catalog manifest/version to prevent drift. Unknown IDs/keys reject; unsupported fits have explicit validation. Old profiles use defaults/legacy mappings without rewriting every row. Cosmetic changes never affect a rule/config hash, bot policy, collider, score, eligibility or reward amount.

`ProfilePanel` edits a local preview and saves on its existing Save character action. Save response reflects server-validated appearance; render failures must not falsely confirm saved art. `useProfile` cache refreshes after save/account switch. CharacterLobby/Preview/Badge and WinnerCelebration share one renderer/role/palette resolver; the selected dress must have the same silhouette in profile and podium. Mobile/full-size preview should show a neutral pose and a short optional gesture.

Current `RoomRuntime.start` copies cosmetics into bodies for V4 arenas; `center/api.py` builds room `appearances` from chosen character plus profile. New board engines have no arena bodies: freeze a **round-scoped appearance record** at start and expose it through existing room presentation metadata to all five stages, RPS and Number Hunt, filtered by privacy. Store it separately from engine scoring state/financial commitments but durably with the round; use it for historic podiums and reconnect. Profile/room choices apply to the next round, as the current UI states; rematch can use newly saved appearance while prior results retain their own records. No cosmetic action resets game clocks.

Anonymous practice can keep an ephemeral selection or use a loaded profile appearance; it never writes a wallet profile without authorization. Spectators/admin observers use published cosmetic metadata only, and `hidePlayers` masking remains intact. Uploaded profile photos are a different feature; do not treat arbitrary uploads as 3D texture assets. Errors/fallback render a known original character/badge without dropping the saved ID or altering payments.

## Original/CC0 provenance and acceptance

For every texture, garment, mesh, rig and clip, record source URL/file, author, license, source/derived hashes, bytes, dimensions/UV roles, clip names and export steps in the existing asset manifest/license ledger. Retain original Orbix source files and exported GLBs. For CC0, preserve the actual grant/source; “free” or MIT code does not establish CC0 art rights. Existing rigs/clips have their own provenance; verify it before deriving outfits. AI-assisted original fabric art, if used in BUILD, must be recorded and visually reviewed for accidental brand/costume copying; this planning round generates no images.

BUILD acceptance:

1. All 12 characters render default, legacy tints/dress and six new outfits in profile/lobby/new stage/podium on reference desktop/phone; compare neutral-lit and actual stage screenshots. Approve fabric readability, colours, silhouette and dresses separately from movement.
2. Correct UVs, retained maps, named role tints, full/LOD identity, seated/gesture/celebrate deformation, tail/shell/helmet openings and accessory combinations. No missing textures, NaNs or floating garments; Fast remains colourful and readable.
3. Auth/save/load/account switch/unknown IDs/defaults/legacy compatibility; frozen round appearance survives restart/reconnect and matches the prior podium after profile changes. Server/client catalogs agree.
4. Snapshot/replay/scoring/entitlement invariance under cosmetic changes; no outfit statistics, new commerce or wallet request in render loop. Practice writes no profile or ledger reward by default.
5. Texture/material/skeleton cache ownership and repeated preview/room exit cleanup; measure first selected asset bytes, DPR/frame intervals and memory after 20 cycles. Meet documented phone budgets or report adjustments.

Relevant existing coverage: `center/tests/test_profiles.py`, `test_game_world_mechanics.py`, `test_room_world_integration.py`, character/rig/locomotion regressions and browser captures under `tools/tests`. Extend those for actual garment contracts and profile persistence. Keep hidden world art compatible through shared character asset loading, without rebuilding the world or the Babylon parity backlog in this round.
