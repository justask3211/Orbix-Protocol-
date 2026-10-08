# October 8: rigged worlds, durable rooms and rematches

## Human request and intent

The user said the previous simple character/terrain presentation did not meet
their expectation. They requested research and installation of useful free,
open-source skills/plugins for realistic movement, characters, animation,
terrain, environments, controls and multiplayer. Fortnite describes the desired
quality direction; this release must make concrete progress without claiming
equivalent AAA production value. Token Catch, Boss Raid and Arena Duel remain
small, playable perspective multiplayer spaces with the existing token mechanism.

Further room feedback calls for easy numeric room numbers, continued play in the
same room, creator choice of existing/edited rules, clear winners and usable
wallet connection. Preserve server authority and safe entry/reward/claim flows.
Keep earlier October 5–7 session files as history; this entry supersedes their
asset/world descriptions for explicitly new version-4 matches only.

## Changes and reasons

- Added actual rigged Orbix Ranger characters derived from Quaternius Universal
  Base Characters Standard and Universal Animation Library Standard, both CC0
  1.0. Deliberate rest-space retargeting, in-place locomotion, embedded textures,
  tactical material regions and an original guarded Kick replace primitive
  characters in new version-4 worlds. Full and distant LOD both retain 65 joints
  and 20 animation clips. This adds recognizable anatomy and movement without
  changing authoritative hit windows or copying commercial game assets.
- `SkeletalActors.tsx` crossfades upper/lower animation layers from accepted
  movement/combat/HP state. Actor-owned skeletons/mixers/tinted materials release
  independently; source geometry/textures stay shared. Distance/frustum culling
  and distant LOD reduce work. Full/LOD meshes have 16,064/3,123 triangles; final
  GLBs are 1,728,160/1,247,696 bytes. Asset hashes, exact sources, licenses and
  bone mapping live in `web/public/center-models/orbix-ranger.manifest.json`.
- New creator/practice defaults explicitly select `world_version: 4`.
  `TerrainArenaEngine` adds shared `field-v1` ground to Catch's island, Raid's
  guardian clearing and Duel's courtyard. Python/TypeScript formulas agree.
  Player support/jump/landing, cover bases, drop height, projectile obstruction
  and respawn follow the server terrain. Older reducer versions remain selected
  by their saved rules rather than silently changing old matches/replays.
- `FieldEnvironment.tsx` adds original local surface textures, foliage, paths,
  water and distant scenery. The authoritative playable region remains 40×40;
  the larger 140×140 vista is decorative. Original `GuardianModel.tsx` and
  `FirstPersonModel.tsx` provide a carved crystal boss and visible gloves/weapons.
  Cosmetic art cannot add collision, damage, score or rewards.
- Added explicit renderer/character loading states and Fast/Balanced/Sharp
  presets. DPR is 1/at most 1.5/at most 2; bounded sun shadows apply only to
  version-4 fine-pointer desktop Balanced/Sharp. Local gradient sky, fog and ACES
  tone mapping use no remote HDR or postprocessing. Hidden tabs pause rendering.
  The approximately 1.5-second FPS readout is local observation, not a benchmark.
- `room_codes` durably maps unique server-allocated numeric aliases to the
  original internal hash IDs. Allocation starts at 100–999 and expands to more
  digits when full; startup migration preserves old rooms, financial IDs and
  historical rounds. Codes survive restarts and rematches; collisions retry
  under database uniqueness rather than deriving ambiguous hash suffixes.
- `/api/center/v1/rooms/resolve/{code}` is navigation only. A private code requires
  an authenticated owner/admin/member or authenticated holder of the existing
  valid secret invite and returns uniform 404 otherwise. Knowing a room number
  never admits a user or bypasses paid-entry verification. Share URLs display
  numbers while requests/escrow/history retain internal IDs.
- Host `POST /rooms/{hash}/rematch` accepts existing or fully edited rules for
  the same template only in free simulated preview-point rooms. It reserves a
  fresh round/seed/commit, clears readiness and retains the admitted roster.
  Subsequent matches use connected, eligible, freshly ready players; original
  first-round admission behavior stays compatible. Each round preserves its
  rules, accepted-action transcript boundary, results, proof and claim IDs.
  Editing hint presets retains historical hints/deliveries.
- Paid entry, funded assets, onchain access and non-preview modes require
  `FRESH_FUNDED_ROOM_REQUIRED`. The creator can review copied rules in a new
  funded-room flow; old escrow game IDs, financial locks or claimed entitlements
  are never reset. Preparing a preview rematch cannot switch it into paid mode.
- Added `/rooms/{hash}/history`, ready/connected roster fields and authorized
  settlement recovery on room GET so refresh/restart preserves the finished
  result. Claim receipt fields remain unmodified; allocations are scoped to
  owner/admin or the winning wallet. Spectators cannot become ready players and
  receive a structured socket error without losing their connection.
- `WinnerCelebration.tsx` lazy-loads the shared rigged podium from final verified
  room placements. Accessible names/ranks and fallback remain available. The
  animation does not choose winners or imply an onchain payout receipt.
- Wallet connection options and responsive header treatment are part of the
  integrating release. Final browser evidence belongs in the release fields
  below rather than being inferred from these source changes.

## Skills, tools and licenses

Eight missing MIT community skills were installed from
[alton47/threejs-skills](https://github.com/alton47/threejs-skills/tree/7b8e25638cff83a6be4926d8f05001022cc80ac3):
`threejs-core`, `threejs-materials`, `threejs-lighting`, `threejs-camera`,
`threejs-physics`, `threejs-shaders`, `threejs-react`, `threejs-performance`.
Retained licenses and local API corrections accompany them. Existing corrected
skills were preserved; `tools/game-lab/skill-sources.json` records provenance and
hashes. Installing guidance does not certify game quality or make it runtime code.

MIT `ecctrl@2.0.2` was added only to the isolated lab with scripts disabled,
pinned package/lock integrity and a successful import check. Lab audit reported
zero known vulnerabilities at installation. Rapier/Drei/ecctrl remain unused in
production locomotion. glTF Transform/meshoptimizer process art offline; Three.js
GLTFLoader loads ordinary embedded GLBs without runtime compression decoders.

Blender 3.4 CLI performed reviewed retarget/export/render scripts. Local Rigify,
ANT Landscape and glTF addon files exist; that is not evidence they were enabled
or used for every scene. The installed community Blender MCP was disconnected;
no successful MCP scene authoring is claimed. No paid generative service/account
or redundant terrain MCP was needed. The old removed OpenAI develop-web-game
skill was reviewed but not installed; approved in-app browser QA remains the
browser workflow. See `docs/center/OPEN_WORLD_TOOLING_RESEARCH_2026-10-07.md`.

Primary character sources: [base characters](https://quaternius.com/packs/universalbasecharacters.html)
and [animation library](https://quaternius.com/packs/universalanimationlibrary.html).
The animation mirror is pinned at `e24c23cf2a1323488a3faa226ea7ea21f644b73e`.
Retain `NOTICE.md`, `LICENSE-Quaternius-CC0.txt` and manifests in deployed assets.
Original Guardian, gloves/weapons, Kick and local terrain textures are documented
separately from these licensed source characters.

## Verification evidence and limits

Backend integration checkpoint: 464 center tests passed in 38.30s. After the
spectator socket/presence follow-up, 38 focused alias/rematch and existing flow
tests passed in 10.70s, including 17 new parameterized cases. These checkpoints
are not the final integrating release count.

Coverage includes collision retry/three-digit exhaustion, concurrent allocation,
old-schema migration/reopen, private invite and paid admission boundaries,
pending/finished rematch recovery, independent old claims/rules/proofs, connected
ready eligibility, suspended/spectator exclusion, edited hint history and arena
transcript isolation. Actual authenticated WebSockets exercise two independent
matches and finished-room refresh. Source whitespace checks passed.

The final integrating agent must append combined Python counts, TypeScript/Vite,
asset integrity, browser controls/results/wallet/mobile and served asset checks.
No short FPS observation, local bot trial, screenshot or reducer test establishes
50 human devices, network latency/jitter, sustained mobile performance or live
funded wallet payout. Fortnite-equivalent graphics and animation polish remain a
quality direction, not a completed claim.

## Final verification and release record

- Combined Python tests: **473 passed** in 30.00 seconds; one existing Starlette/httpx deprecation warning. Final JUnit saved outside the repository.
- TypeScript and production build: **passed**, Node 24/Vite 8. Three.js chunk remains lazily loaded and triggers the size advisory.
- Asset/license/hash and terrain parity verification: **passed** for both GLBs, 65 bones, 20 clips, exact manifest hashes; **608** Python/TypeScript terrain samples agree within 5.56e-16. Wallet regressions 13, rematch settings 20, podium eligibility 14, and actual GLTF StrictMode/mixer lifecycle regression passed.
- Browser observations: generated wallet sign-in closes the modal after verification; room **440** publishes a numeric link. Ready/start, expanded game, successful target hit, settled reward, finished-page reload, edited rematch and same-settings replay verified. Roster/code persist and readiness resets, including backend restart/reconnect. Editor immediately rejects 601 seconds. Token/Boss/Duel scenes reviewed with rigged actors; Jump, Dodge and FPV controls inspected. No held-key or new physical mobile-device claim.
- Source commit / GitHub CI run: **PENDING_RELEASE_IDS**.
- API deployment ID / status: **PENDING_RELEASE_IDS**.
- Site deployment ID / status: **PENDING_RELEASE_IDS**.
- Served bundle/model hashes / live readiness: **PENDING_ROOT_FINAL**.

Only the integrating agent should replace these pending fields with observed
results. No commit or deployment was performed by the documentation/backend
subtask. Preserve the production volume and independent financial evidence.

A browser timeout exposed a false Number Hunt podium based on unused guesses. Fixed all server results paths to publish engine rank and final eligibility; the UI now uses a pure verified-podium selector. Regression coverage includes unused guesses, zero-budget true hits, hit-order ranking and drawn RPS.
