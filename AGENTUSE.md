# Orbix game center: implementation and intent

Read this before changing `/center`. Current implementation: October 7, 2026.
The latest human request takes precedence. Preserve these established mechanics
and design choices unless the user requests a change; do not silently substitute
an overhead board or unrelated game for the intended experience.

## Product intent

Orbix combines creator-hosted multiplayer games, token entry requirements,
funded rewards, a wallet and vault, invitations, and creator/admin controls.
The latest request explicitly corrected the compact overhead arenas: Token
Catch, Boss Raid and Arena Duel must be small playable perspective worlds with
human-shaped characters, camera-relative movement, jump, combat and FPV/TPV.
The PUBG comparison describes locomotion, supply crates and squad-room controls;
the Shadow Fight comparison describes melee weapons and combinations. Assets
and code here are original; neither comparison authorizes copying those games.

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
No new dependency or paid MCP service was needed for this update. Tools in
`tools/game-lab` and installed research plugins are optional tooling, not proof
that a particular library is part of the deployed center. In particular this
release does not use Rapier, Drei, Colyseus, Motion, Howler or Zustand at runtime.

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
| Signed administration | `AdminPanel.tsx`, `center/admin_games.py`, `center/store.py` |
| Rule constraints and version selection | `center/schema.py`, `center/games/__init__.py` |
| Character simulation and reward allocation | `center/games/field_arena.py` |
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

Human characters (Scout/Sentinel/Runner/Striker), outfits, limbs, cover, hills,
crates, parachutes, weapons, projectiles and the crystal guardian are procedural
original geometry. Cosmetic IDs `fox/robot/frog/cat` remain compatible with
stored rooms; they no longer require animal-shaped overhead blobs.
Homepage WebP illustrations were generated earlier using built-in image_gen;
`web/public/center-art/provenance.json` stores prompts, hashes and bytes. They are
world illustrations, not screenshots of this gameplay. The current update
reuses those illustrations and introduces no downloaded character/texture pack.
Record provenance/license/hash before adding any external asset.

The renderer is lazy and shows a loading state. DPR is bounded to 1–1.5; there
are no shadow maps or postprocessing passes. Shared instanced geometry batches
characters, weapons and loot. Hidden tabs pause presentation; reduced motion
removes decorative bobbing while retaining movement interpolation. Camera
collision shortens its boom against actual published cover. WebGL failure keeps
DOM controls available with Retry. See `worlds/README.md` for coordinate and
clock conventions, shared geometry ownership and scene mapping.

## Character physics and authority

New UI/practice configurations explicitly set `world_version: 3`. The schema
default remains 2 so existing committed rooms are not silently migrated to
different rules. Version 2 reducers and classic scenes remain available.
Changing a reducer for saved rooms requires explicit version/replay planning.

Version 3 worlds are 40×40 units. Server simulation is 30Hz, room state
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

Add a dated file under `docs/sessions` for each substantial update: human
request, intent, changed behavior/files, reason, verified evidence, limits and
release result. Link it from the index. Never turn assumptions into claimed
measurements. Historical records remain historical; newer requests supersede
older implementation choices. Start with `docs/sessions/README.md` and the
October 7 entry rather than treating older SESSION_MEMORY.md as current status.
