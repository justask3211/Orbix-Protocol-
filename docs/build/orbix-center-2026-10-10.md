# Orbix Center build validation

## Phase 1

Version 2 trusted-server duel sealing retains the private SHA-256 preimage and resolves on logical deadlines. Version 1 reducers remain selectable for existing rooms and snapshots. New UI has no reveal action; legacy UI remains for version 1. Runtime checkpoints timed transitions atomically with snapshot/input, reads the durable round-scoped transcript, and enters recovery if observed service/scheduler gaps reach one full selection window. Player disconnects do not trigger recovery.

Validation: 164 focused legacy/duel/practice/result tests passed; 61 version-2 vectors and zero-client restart/outage tests passed; room integration tests passed apart from an invalid-address fixture corrected before rerun; TypeScript passed. Full center regressions also run throughout the build.

Deliberate fixture changes: test_engines, test_late_engines, test_full_rounds, test_duel_hints, test_game_world_mechanics and the drawn-duel case in test_result_placements now explicitly pin template_version=1 for historical manual reveal semantics. New version-2 behavior is covered in test_sealed_duel. Financial allocation code is unchanged.

Device/browser support and performance targets remain measurement requirements, not claims based on headless/source checks. No Railway deployment.

## Phase 2

RoundImmersion is the sole viewport/scroll owner. Its persistent shell contains lobby, loading, stage, notices, modal portals and Minimize. Host Start and guest Ready request native fullscreen synchronously before network work; practice now requires Start practice. Remote starts use labelled CSS immersion, with a Fullscreen gesture available. Portrait controls stay live. Scene constraints are removed inside the shell; safe insets apply to toolbar/control panes and visualViewport tracks the visible input area. Shared modal/body lock ownership prevents nested restoration races.

Validation: TypeScript passed. Chromium fixture verified refusal, real user activation at request, viewport fill, portrait controls, all existing registered stages under WebGL failure and 20 Minimize/Resume cycles at 320×568, 390×844, 844×390 and 1280×800. Additional native Chromium and in-shell hint portal checks run in the same test. Existing framework mobile test was deliberately updated from universal portrait inert gating to Start practice and playable portrait. Physical Android/iOS/in-app browser and keyboard/notch measurements remain unverified here.

## Phase 3

Six fitted silhouettes, segmented pelvis/thigh-weighted dresses, original cotton/denim/linen/star prints and character-specific garment palettes are selectable through the existing profile field. Legacy dress maps to the sundress geometry without rewriting profiles; legacy tints remain selectable. Body/fur colours remain separate. Merged meshes now retain UVs; named cloth materials keep their maps through cartoonFinish. Shared 1024/512 atlases are cache-owned. Four original seated/gesture/turn/celebrate clips supplement the verified CC0 rig. Round appearances are durably frozen outside gameplay/reward commitments and restored for stages/podiums.

Validation: 3,168 character/outfit/clip skinning combinations, max full 16,824 triangles and LOD 3,312; UV/texture/cache ownership and existing 72 mixer/gait + 144 actor-selection cases passed. Profile/catalog/frozen-appearance restart tests and TypeScript passed. Chromium Three.js captures reviewed six silhouettes on Maple and seated Tuck; six PBR interchange GLBs and original texture PNGs have source/derived hashes in center-models/wardrobe/manifest.json. Material groups reach seven (six was a practical target); physical phone FPS and every accessory intersection remain unmeasured. Runtime builds only selected outfits and does not download the reference wardrobe GLBs.
