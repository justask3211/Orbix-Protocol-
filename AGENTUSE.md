# Orbix game center: implementation and intent

Read this before changing `/center`. Current implementation: October 10, 2026.
The latest human request takes precedence. Preserve these established mechanics
and design choices unless the user requests a change; do not silently substitute
an overhead board or unrelated game for the intended experience.

## 2026-10-10 Babylon adoption

The product owner rejected the keep-Three.js verdict and mandated Babylon.js;
Apache-2.0 is accepted for code dependencies. Token Catch now defaults to the
native Babylon/Havok module in `web/src/center/babylon/`; `?engine=three` retains
the legacy renderer. Other games and shared preview/podium components still use
Three. Python authority, WebSocket inputs/snapshots, scores, hints and reward/claim
flows are unchanged. See `docs/research/babylon-parity.md` and the dated session
record for parity alternatives, software measurements and limits. No Railway
deployment is authorized in this round; Hermes handles deployment. Earlier engine
preferences below are historical where they conflict with this adoption.

## Product intent

Orbix combines creator-hosted multiplayer games, token entry requirements,
funded rewards, a wallet and vault, invitations, and creator/admin controls.
The latest request explicitly corrected the compact overhead arenas: Token
Catch, Boss Raid and Arena Duel must be small playable perspective worlds with
human-shaped characters, camera-relative movement, jump, combat and FPV/TPV.
The PUBG comparison describes locomotion, supply crates and squad-room controls;
the Shadow Fight comparison describes melee weapons and combinations. Original
Orbix art and licensed CC0 character sources are described below; neither
comparison authorizes copying those games.

Number Hunt remains a puzzle game. Rock Paper Scissors Duel remains a separate
sealed-choice game (`reaction-duel`); Arena Duel is `combat-duel`. Both remain
available so existing rooms and their transcripts continue to work. Future games
are presented as coming soon rather than given fabricated playable previews.

## Frontend and actual tools used

The game center is a React/TypeScript SPA built by Vite, mounted at `/center`;
do not assume the center uses Next.js because other repository components do.
Installed versions are recorded in `web/package.json` and its lockfile. The
current build uses React 19, React Router 7, Three.js 0.186, React Three Fiber 9,
Vite 8 and TypeScript 7. Viem and WalletConnect support existing wallet flows;
Lucide supplies icons. Styling uses project CSS and CSS transitions/keyframes.
Render transforms use refs and `useFrame`, rather than React state per frame.

The implementation used the project `orbix-game-engineering` skill, the installed
3d-games skill, in-app browser checks, TypeScript/Vite, pytest and a local Python
reducer benchmark. Specialized agents handled renderer, controls, and admin/UI
fixes; the main agent integrated mechanics, settlement, verification and release.
No paid MCP service was used for this update. Tools in
`tools/game-lab` and installed research plugins are optional tooling, not proof
that a particular library is part of the deployed center. In particular this
release does not use ecctrl, Rapier, Drei, Colyseus, Motion, Howler or Zustand at runtime.

The October 8 research installed eight MIT community skills (`threejs-core`,
`materials`, `lighting`, `camera`, `physics`, `shaders`, `react`, `performance`,
each prefixed `threejs-`) at a pinned source revision, with retained licenses and
local API corrections. `tools/game-lab/skill-sources.json` records their hashes.
`ecctrl@2.0.2` is installed only in that lab. Blender 3.4 CLI processed the rigged
assets; the installed community Blender MCP was disconnected, so no successful
MCP scene authoring is claimed. See the dated tooling research report for sources.

Use a supported modern Node runtime (the verified local build used Node 24).
Putting that runtime on PATH matters: npm child scripts can otherwise find an
older system Node and fail on Vite's `node:util.styleText` import.

## Files and design system

| Concern | Main implementation |
| --- | --- |
| Routes, creator wizard, room/lobby and expanded game view | `web/src/center/CenterApp.tsx` |
| Choice cards, number inputs, info disclosures and share editor | `ArcadeSettings.tsx`, `wizardForms.tsx`, `gameControls.css` |
| Header, wallet alignment and phone breakpoints | `centerShell.css` |
| Homepage descriptions and instructions | `featuredGames.ts` |
| Camera/input/touch/loot HUD | `ArenaControls.tsx`, `arenaPlay.css` |
| Lazy renderer and loading/context-loss recovery | `worlds/GameWorld.tsx`, `worlds/WorldScene.tsx` |
| Characters, follow camera, FPV hands, cover, drops and boss | `worlds/ArenaWorld.tsx` |
| Rigged actors, original boss/view model, terrain and lighting | `SkeletalActors.tsx`, `GuardianModel.tsx`, `FirstPersonModel.tsx`, `FieldEnvironment.tsx`, `FieldLighting.tsx`, `terrain.ts` |
| Verified podium and host rematch edits | `WinnerCelebration.tsx`, `RematchSettings.tsx` |
| Signed administration | `AdminPanel.tsx`, `center/admin_games.py`, `center/store.py` |
| Rule constraints and version selection | `center/schema.py`, `center/games/__init__.py` |
| Character simulation, versioned terrain and reward allocation | `center/games/field_arena.py`, `terrain_arena.py`, `terrain.py` |
| Realtime, admission, settlement and checkpoints | `center/api.py`, `center/room.py` |
| Isolated bot trials | `center/practice.py` |

The shell uses dark navy, bright lime, cream surfaces and coral/mint/lilac game
accents. Preserve readable contrast, visible keyboard focus, native radio
semantics, accessible Info buttons, immediate numeric validation, and
`prefers-reduced-motion`. Vault remains beside the header wallet; connected and
disconnected states must fit narrow phones. Test at 320px and 390px, including
the connected wallet, not only a desktop screenshot. Running rooms retain the
expanded play view with chat beneath, Minimize and Escape.

## Assets and rendering

Version 4 uses actual skeletal Orbix Ranger GLBs derived from Quaternius Universal
Base Characters Standard and Universal Animation Library Standard, both CC0 1.0.
The locally retargeted rig has 65 joints, 20 clips, embedded textures capped at
512px, a 16,064-triangle full mesh and 3,123-triangle distant LOD. Horizontal root
motion is in place; movement remains server-owned. Retain
`web/public/center-models/NOTICE.md`, CC0 license and the exact source/output hashes
in `orbix-ranger.manifest.json`. The 20 clips include an original Orbix front kick;
do not rename unrelated clips or assume matching bone names imply bind-pose
compatibility. See `tools/game-lab/assets/CHARACTER_PIPELINE.md` for reproduction.
Cosmetic IDs `fox/robot/frog/cat` remain compatible with stored rooms and tint suit,
armor and accent regions without modifying gameplay statistics or the face/eyes.
Version 2/3 retains its procedural characters and previous reducer behavior.
The crystal Guardian, first-person gloves/weapons, foliage, terrain textures,
cover, crates, parachutes and projectile presentation are original Orbix art.
Homepage WebP illustrations were generated earlier using built-in image_gen;
`web/public/center-art/provenance.json` stores prompts, hashes and bytes. They are
world illustrations, not screenshots of this gameplay. This update reuses those
illustrations and adds the licensed character pack described above.
Record provenance/license/hash before adding any external asset.

The renderer and GLBs are lazy and show renderer/asset loading states. Fast uses
DPR 1; Balanced caps DPR at 1.5; Sharp caps it at 2. Version 4 enables one bounded
sun shadow only on fine-pointer desktop viewports in Balanced/Sharp. There are no
postprocessing passes or downloaded HDR environments. Procedural props/loot are
instanced; skeletal actors own cloned mixers/skeletons/tinted materials and share
cached source geometry/textures. Distant actors use LOD and reduced animation
update cadence. The displayed FPS is a short local observation, not a benchmark.
Hidden tabs pause presentation; reduced motion
removes decorative bobbing while retaining movement interpolation. Camera
collision shortens its boom against actual published cover. WebGL failure keeps
DOM controls available with Retry. See `worlds/README.md` for coordinate and
clock conventions, shared geometry ownership and scene mapping.

## Character physics and authority

New UI/practice configurations explicitly set `world_version: 4`. The schema
default remains 2 so existing committed rooms are not silently migrated to
different rules. Version 2 reducers and classic scenes remain available.
Changing a reducer for saved rooms requires explicit version/replay planning.

Version 4 adds authoritative `field-v1` terrain to the 40×40 play space: island
for Catch, guardian clearing for Raid, courtyard for Duel. Python
`center/games/terrain.py` and TypeScript `worlds/terrain.ts` must agree. Ground
height, jump/landing, cover base height, loot, projectiles and spawn/respawn follow
the server surface. The wider 140×140 rendered landscape, water, trees and distant
ruins are decorative vista; they do not expand the playable map or create cover.
Only published obstacles/crates/boss are authoritative collision objects.
Terrain parity and replay/version tests are required when changing these formulas.
Version 3 remains flat and replayable; saved rooms are never silently upgraded.

Server simulation is 30Hz, room state
broadcasts are 10Hz, and movement input leases expire after 250ms. Normal speed
is 5 units/sec; sprint is 8; gravity is 18; jump impulse is 7.5. The server owns
collisions, vertical position, cover line of sight, cooldowns, inventory, loot,
damage, ranking and settlement. Clients supply finite normalized directions,
increasing input sequences, facing/aim and actions; never final positions,
scores, winners or hit results. Actions include their validated current aim so
coalesced movement cannot make a newly aimed shot use stale facing.

Desktop: WASD/arrows, drag look or opt-in mouse lock, Space jump, Shift sprint,
F guard, Q punch, R dodge, E nearby loot/crate, J/K/L light/heavy/kick.
Touch: camera swipe, pointer-captured movement stick and action buttons.
Release movement, guard and held fire on blur, hidden tab, cancellation,
disconnect and unmount. Projection is bounded presentation checked against
published cover; authoritative corrections always win.

Arena clocks (`nowMs`, drop/attack schedule) are milliseconds since round start.
Body cooldowns, shields, stun/respawn and `serverTimeMs` are epoch milliseconds.
Do not mix them. Future drop locations are generated only at spawn; public state
must never expose seeds, future random decisions, private hints or sealed moves.

## Game contracts between mechanics and rewards

Token Catch schedules the exact configured `loot_budget` across
`airdrop_count` crates. Last landing precedes the deadline by six seconds. A
500-unit pool with ten crates and `loot_chunk: 5` produces ten 50-unit crates,
each containing ten separate 5-unit coin piles. Opening pays nothing. Each
unique nearby pile requires a server-accepted loot action with a 100ms cooldown;
rivals can share a crate and duplicate pickups fail. Bombs spill floor(half of
collected score) into persistent public ground piles; total score is conserved.
Random crate/ground guns have configurable shots/chance and default 10-second
knockouts. Punch defaults to a 2-second stun; shields/dodges are server checked.
All scheduled value is dropped by the end; uncollected value is not credited to
a wallet or invented as a winner allocation. Caps reject configurations that
would create more than 400 initial coin piles plus crate overhead.

Boss Raid has selectable crews of 2–5 and supports up to 50 admitted players.
Players start with identical infinite-ammo guns, base damage and fire rate.
HP thresholds or timed drops provide collectible gun upgrades. Slam, jumping
shockwave, forward beam and targeted meteor attacks telegraph before damage;
cover, dodge, HP, knockout and default 10-second respawn are server mechanics.
Confirmed team damage ranks the crews. Creator chooses one/two/three rewarded
places, custom percentages totaling exactly 100, and equal or damage-weighted
shares within qualifying crew members. Ties share occupied podium percentages;
absent/ineligible places remain unallocated. Integer/rational arithmetic and
member remainders prevent overallocating the pool even for large ERC20 amounts.

Arena Duel requires exactly two players, fists/sword/spear, guard, light/heavy/
kick combinations, jump and cooldown-limited dodge. Guns are an optional creator
setting. Server range, facing, line of sight and vertical reach determine hits;
zero HP ends the duel. Character selection is cosmetic, never a gameplay bonus.

New proportional Token Catch/Boss Raid funded pools accept one ERC20 reward
asset. Do not silently fractionate NFTs or combine distinct tokens. Preview
points and funded token base units are different. The existing admission,
vault, Merkle entitlement and claim pipeline remains authoritative. This update
does not deploy new contracts or prove automatic winner-wallet transfers.
Before claiming live token payout is complete, verify a real funded round,
correct chain/contracts, transaction receipts and the chosen claim mode.

## Administration, persistence and publication

Remove room means signed archival, not deletion of payments, claims or audit
evidence. Restore is supported. Legacy `admin_audit` tables gain missing hash
columns at startup with original JSON/timestamps preserved. Already existing
hash chains are not automatically rewritten. Archive setting + audit insertion
are one transaction; failure leaves no partial setting or in-memory archive.
Admin proofs are wallet message signatures with nonce/expiry/replay checks,
not gas-bearing token transfers. Observation uses no player slot or join notice.

New human room numbers are durable server-allocated strings: 100000–999999,
then seven or more digits as capacity fills. Existing shorter codes stay resolvable. `room_codes` has unique room/code constraints and
startup migration allocates old-room aliases once. Internal hash IDs remain API,
escrow and history identifiers. Resolve with `/api/center/v1/rooms/resolve/{code}`;
private codes return uniform 404 unless an authenticated owner/admin/member or
authenticated holder of the existing valid secret invite is authorized. Knowing
a numeric code does not admit a player or satisfy token-entry verification.

`POST /api/center/v1/rooms/{hash}/rematch` accepts `{}` or a full edited `config` for
the same template. Free simulated preview-point rooms reuse their container and
invite while reserving a fresh round/seed/commit and resetting every ready flag.
Subsequent rounds include only connected eligible ready players; first-round
admission semantics stay compatible. Finished round rules, transcripts, proofs,
entitlements and claim status remain independently owned. History is available
at `/rooms/{hash}/history`; room GET restores authorized settlement after refresh.
Paid entry, funded assets, onchain access or non-preview modes return
`FRESH_FUNDED_ROOM_REQUIRED`; the UI prefills the original rules into a new-room
funding review instead of reusing an old escrow game ID or silently charging.
Podium models display verified final results; they never calculate the winner or
prove a blockchain transfer. Claim receipt fields remain unmodified and scoped
to authorized owners/admins or the winning wallet.

Rooms checkpoint accepted movement batches once per second; critical actions,
settlement and graceful shutdown flush them. Abrupt termination can lose the
most recent uncheckpointed interval. Preserve all added physics/RNG/drop fields
in snapshots. Practice sessions are memory-only, have an 8-second initial bot
grace and never award tokens, charge entry or write reward ledger entries.

Verify pytest (`center/tests` + `tests/test_center_community.py`), TypeScript and
`npm run build`. Copy `web/dist` to `deploy/site/center-dist`. Both prebuilt
directories are tracked deployment inputs. Build from the committed tree,
exclude secrets/QA databases/bytecode, deploy the API first and then the site,
retain the production volume, and verify served asset hashes and API readiness.
Do not put credentials into source, docs, remotes or command output.

## Evidence and continuing development

October 7 checks: 461 Python tests, TypeScript + production Vite build, browser
FPV/TPV worlds, jump/dodge controls, custom podium presets/Info disclosures,
local signed archive/restore, connected header screenshots at 320/390px.
An authenticated WebSocket test covers jump, contested loot and actual preview
settlement. A local 50-player raid reducer sample measured tick p50 0.667ms,
p95 1.472ms and public-state serialization p50 2.760ms, excluding action
processing/checkpoints/fanout/network/browser FPS. These are local observations,
not a guarantee for 50 live devices. Cold scene chunk: 953.64kB minified,
253.33kB gzip, loaded on demand. Target-device performance, latency/jitter,
extended human playtesting and live funded payouts remain verification work.

These October 7 sizes and timings describe that historical build. October 8
evidence and pending release identifiers are recorded in
`docs/sessions/2026-10-08-rigged-worlds-rematches.md`; replace its pending final
verification/deployment fields only after the integrating agent confirms them.

Add a dated file under `docs/sessions` for each substantial update: human
request, intent, changed behavior/files, reason, verified evidence, limits and
release result. Link it from the index. Never turn assumptions into claimed
measurements. Historical records remain historical; newer requests supersede
older implementation choices. Start with `docs/sessions/README.md` and the
October 8 entry rather than treating older SESSION_MEMORY.md as current status.
