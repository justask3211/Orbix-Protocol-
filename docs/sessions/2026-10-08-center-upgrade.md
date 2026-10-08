# October 8: Center bug fixes and arcade UX upgrade

User request: eight tasks in order, checks and a commit after each, final push
from master to main, no pull and no Railway deployment. Starting revision b8fa68e8.
The Orbix engineering and design taste skills inform the existing arcade style.
No external art or new game/money rules are authorized by this work.

## Task 1 — profile images

Reproduction: the real authenticated image POST returned FUNDED_DISABLED (409)
for every valid raster and malformed input: 11 new regressions failed before fixes.
Code-path inspection also found unchecked null canvas exports, missing reader
errors, selection races, stale previews/cache, a modal flag never fetched,
UPDATE-only avatar persistence before profile creation, arbitrary bytes stored
as WebP, unsafe address input, and truncating concurrent writes.

Fixed bounded PNG/JPEG/WebP decoding, center crop and 256-square WebP conversion
with Pillow; unique temp files and atomic replacement; complete-byte responses
with revalidation/ETag; wallet address validation; avatar upsert/public flag.
The UI handles failed canvas/reader operations, clears old selections, prevents
selection/upload races and refreshes header/profile metadata immediately.
Removed the unrelated funded gate only from profile images. Payment authority
and financial flags are untouched. Added Pillow to deployment requirements.
Repaired the pre-existing npm lockfile omission of a required TypeScript peer.

Evidence: 505 Python tests passed (center + community); tsc -b --noEmit and
npm run build passed. Canvas error/crop regression passed. Local Chromium
verified actual PNG selection/crop/export/POST, header avatar, reload and modal
reopen. Concurrent writes, strict bad-input rejection, limits and auth tested.
Production volume permissions/availability remain untested; no live upload made.

## Task 2 — finish navigation and greeting

A stable result anchor receives focus and scroll once per round after expanded
play closes and the lazy celebration DOM mounts. Waiting for lazy mounting
fixes a browser-reproduced layout race where scrolling a short fallback left
the later podium below the viewport. Reduced motion uses instant scrolling.
Greetings address the winner or show the local server rank (including #9),
with crew placement for raids and the complete server-ranked results below.
No client winner/score calculation was added. Seven presentation regressions
and fourteen verified-podium cases pass; 505 Python tests and tsc/build pass.

## Task 3 — motion diagnosis and implementation

The V4 PoseMotion extrapolator reset age on every state object (including
non-position patches), then damped toward that changing target. There was no
remote snapshot buffer. Body moving flags kept feet running into walls; run
playback ignored actual speed and a selected action never updated its timeScale.
Combat/jump cues read a frozen snapshot clock. Camera damping added local lag,
and unrestricted camera turns eventually failed server-facing validation.
The actual GLTF binds and in-place root motion passed inspection: the rig was
not the source of horizontal movement jitter.

New motion.ts continuously integrates immediate local normalized direction,
keeps a bounded 64-input send history, replays newer inputs from acknowledged
positions and eases small corrections at a bounded rate. V4 public snapshots
now include accepted input direction/lease/timestamp alongside existing inputSeq.
Only presentation metadata changed server-side; 30 Hz simulation, 10 Hz
broadcasts, speed, gravity, collisions, health, inventory and money rules stay
server-owned. Respawn/large corrections snap; late snapshots are ignored;
input prediction stops after 250 ms without a fresh authority sample. Opponents
use a 100 ms snapshot buffer with at most 150 ms bounded extrapolation.
Collision margins and support match published solids; decorative vista is ignored.

Jump receives one bounded speculative impulse and returns to server support on
rejection. Yaw wraps to a valid angle. First-person camera follows the predicted
root immediately; third-person follow settles faster. Animation cues use a
running presentation clock, locomotion layers share phase, and cadence tracks
actual displacement (including zero at a wall). Measured the bundled GLTF's
stance-foot velocity: Run median 5.12 and Sprint 8.57 units/second, used to calibrate
playback to presented speed. Landing compression, airborne stretch and mild lean
are cosmetic and removed for reduced motion; rig/LOD/source meshes remain intact.

Evidence: nine netcode regressions, actual GLTF/StrictMode/Kick/lifecycle test,
and synthetic 120 ms RTT plus 0–35 ms snapshot jitter at 30/60/144 Hz passed.
The jitter fixture initially reproduced a 0.256-unit backward correction;
bounded reconciliation removed it. Final minimum per-frame forward movement
was 0.1167/0.0583/0.0243 units; max reference-position error 0.132/0.131/0.116.
These are deterministic local simulations, not network or device measurements.
506 Python tests, tsc -b --noEmit and production build passed. Actual target-device
FPS, extended human multiplayer under loss/jitter and perfect contact on every
retargeted animation remain unproven. No claim of eliminating every possible
authority correction is made.

API reference checks: [Three AnimationAction](https://threejs.org/docs/pages/AnimationAction.html)
and [Fiber hooks](https://r3f.docs.pmnd.rs/api/hooks); runtime dependencies unchanged.

Task 3 browser follow-up: local Chromium rendered all three V4 practice worlds
and accepted held-key movement, jump and stop; screenshots inspected. Some
coalesced practice inputs hit the existing rate limiter, without invalid actions
or scene failure. A fixture initially counted hidden canvas fallback HTML as
visible; corrected visibility checks pass. This does not measure real-device FPS.

## Task 4 — original equipment and pickups

ItemAssets.ts builds nine original merged, colored meshes (6,656 triangles total):
embossed coin, smiling fused bomb, shield with rim/badge, toy blaster, medkit,
boxing glove, upgrade battery, sword and spear. ItemMeshes instances these shapes
with a scale pop, hover bob and shader dissolve on authoritative removal.
Reduced motion keeps items still and removes pickup animation immediately.
Bounded counts and delayed owned-resource cleanup preserve renderer lifecycle.
Hand_r and hand_l now supply actual grip positions/orientations for weapons and
active shield inventory, in both LODs; first-person shields use the matching mesh.
The gun's axis mapping was checked against PistolAim's actual wrist basis.
No gameplay statistics, item logic, collision shapes or money code changed.

Evidence: real geometry/finite-buffer/triangle-budget/wrist/dissolve regression
and skeletal lifecycle regression passed; local Chromium rendered Duel with the
new item shaders and accepted movement/jump/stop without a visible fallback.
506 Python tests, tsc -b --noEmit and build passed. Extended human review of all
pickup/weapon states and physical mobile performance remain unproven.

## Task 5 — cartoon Ranger styling

Shared cartoonStyle.ts supplies peach/cyan/lime/lilac suit palettes, light armor
and existing team accent rules. Only actor-owned Suit/Armor/Accent materials lose
the tactical clothing maps and receive matte roughness, minimal metal, a mild
color fill and soft contour shading inside the existing shader. Face/skin/eyes,
source textures, skeletons, animation clips and cached geometry are untouched.
A broader, slightly shorter presentation group keeps every bone/attachment in
the same rig; FPV eye height follows that visual scale. Both LODs and the podium
use this treatment. Faster idle/run/action crossfades retain synchronized layers
and measured displacement-based cadence. FPV gloves use the same playful palette.

Evidence: all four cosmetic IDs and both real GLBs pass clothing/team tint,
phase/cadence, idle/Kick/StrictMode/lifecycle regressions; item geometry test still
passes. Chromium rendered the new Duel material shader and character treatment,
accepted movement/jump/stop, and a screenshot was reviewed. 506 Python tests,
tsc -b --noEmit and build passed. This restyles the existing Ranger; it does not
replace its licensed anatomy or establish commercial-game animation parity.

## Task 6 — creator fee and reward explanations

Step 4 now illustrates ERC-20 contract selection, whole-token entry amounts,
joiner approval/payment and creator/custom/burn destinations. The live diagram
reflects the existing editable fields. The contract strip explains allowance
approval followed by join(roomId), with room publishing/binding kept separate.
Burn copy describes an unavailable destination rather than promising that every
ERC-20 decreases totalSupply. Original CSS and Lucide icons add no diagram library.

Five reward guides explain preview points, creator tokens, NFTs, ETH and private-key
wallet delivery, with creator/recipient views and Auto/Code/Merkle/Open strips.
The wizard still publishes preview points or preserves copied funded settings;
exploring these guides explicitly does not configure unsupported funding or claim
modes. No private key is requested. Entry and reward contract behavior is unchanged.

Evidence: 506 Python tests, tsc -b --noEmit and build passed. Chromium exercised
actual CA/amount/custom payout controls, all five guides and all four claim modes
at 1200, 390 and 320px without overflow or page errors. Phone screenshot reviewed;
shared global header sizing and hidden mobile step labels were corrected. Actual
funded contract execution for these explanatory flows was not performed.

## Task 7 — six-digit new room codes

New allocations start at 100000–999999 and expand to seven through nine digits
only when capacity requires it. Existing aliases return unchanged; startup only
allocates missing aliases. Unique constraints, transactional collision retries
and deterministic gap fallback remain. Resolver/frontend parsing still accepts
legacy three-to-five-digit codes. The join-field example now uses six digits.
Private-room visibility and payment/admission requirements remain unchanged.

Evidence: five minimum-length/boundary/collision/migration/concurrency checks
failed on the old allocator, then passed after the fix. A legacy 123 API link
resolves before and after database reopen. 508 Python tests, tsc -b --noEmit and
build passed. No production database migration was executed.
