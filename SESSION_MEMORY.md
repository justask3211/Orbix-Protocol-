# SESSION MEMORY — Orbix Protocol (updated 2026-10-10, Babylon build round)

Handoff document. Read this first in a new session, then the technical ledgers:
ORBIX_PROTOCOL_V6_DELIVERY.md, ORBIX_CENTER_V5_EXECUTION.md,
ORBIX_CENTER_A_TO_Z_PLAN.md, USER_DEVELOPMENT_INTENT.md.

Repo of record: **github.com/justask3211/Orbix-Protocol-** (branch `main`, CI green).

## Latest renderer handoff — mandated Babylon adoption, 2026-10-10

The product owner explicitly rejected the keep-Three.js verdict and mandated
Babylon.js. This round resumed the interrupted BUILD after planning was complete;
do not reopen engine selection. Apache-2.0 is accepted for code dependencies.
Art stays original/CC0. The reason for the transition is the user's engine choice,
not a demonstrated performance advantage. Existing reward-hardening requirements
in the next section still apply.

- Phase U was already committed: foundation `accd5d9b`, route selector `f20d0834`.
  Phase V `400b3053` completes the native Token Catch scene. Phase W `4a61698c`
  records verification, repairs loading/terrain/lifecycle and ships static builds.
  Phase X records this override and completion for delivery to `master:main`.
- Token Catch defaults to Babylon/Havok; `?engine=babylon` selects it explicitly
  and `?engine=three` retains the legacy comparison. Other games and shared
  preview/podium components continue to use Three. Do not silently switch the
  flagship back to Three because of older documents.
- The scene owns native cameras, a capsule/mesh Havok world, staged loading,
  PBR/fog/shadows, instanced vegetation/loot, native pickup/equipment feedback,
  original mascot GLBs and their 20 CC0 clips as layered AnimationGroups.
  It disposes its resources and creates a new world for round, terrain or identity
  changes. The first terrain snapshot arrives before colliders are constructed.
- Authority, scoring, hints, private snapshots, settlement, claims and rewards use
  the same Python reducers, DOM controls and WebSocket protocol. No Python or
  Solidity source was changed. Prediction/interpolation is the byte-identical
  motion port, with acknowledged replay and outage freeze.
- Functional parity is verified, with documented presentation alternatives:
  Babylon PBR instead of Three fur shaders, native simplified item meshes and
  Fast GLB LOD. Havok free-motor slope/28 cm step-up is tested independently;
  live motion follows authoritative prediction. Automatic cover climbing is not
  added to saved server rules. Never claim native physics can award value or
  change authoritative displacement.
- Required checks passed: 597 Python tests, 162 Forge tests/16 suites, 41 frontend
  tests, 17 existing regression scripts, Babylon motion/jitter/envelope checks,
  608 Python/Babylon terrain samples, TypeScript and Center/root production builds.
  The final existing Token Catch browser regression also exits 0.
- Browser evidence covers native groups, 400 instanced piles, classic pointer
  catching, delayed snapshots, three clean remounts, desktop, 390px portrait,
  landscape touch/FPV/TPV and fullscreen. Two real local authenticated wallets
  exercise default-Babylon WebSocket move/jump/dodge, reconnect, server preview
  settlement and rematch history; no funded transfer or wallet send was issued.
- Measurements are honest limits: Babylon engine 3,864,044 raw bytes; Havok WASM
  2,094,563; total renderer additions 6,009,929 raw/1,569,733 gzip-9 versus Three
  1,188,516 raw/323,891 gzip-9 (GLBs/shared code excluded). Landing is lazy.
  Fixed SwiftShader p95 is Babylon 2876.4 ms versus Three 1399.8 ms; both fail
  30 FPS. Physical phone/GPU, cold-network budgets and funded payouts are unproven.
  Do not turn these results into a speed or hardware certification claim.
- Evidence and reproduction: `docs/research/babylon-parity.md`,
  `tools/tests/evidence/babylon/`, and
  `docs/sessions/2026-10-10-babylon-adoption.md`. Engine-analysis addendum preserves
  the old verdict as history and records the override/completion.
- `web/dist`, root `deploy/site` and `deploy/site/center-dist` are assembled with
  matching licenses/notice files for Hermes. Only Git delivery is authorized in
  this round. NO Railway deploy, production environment update or on-chain
  transaction was performed. Hermes owns deployment. Final response verifies
  the pushed commit against remote `main`; local Python bytecode changes remain
  outside these commits.

## Latest handoff — v2 reward hardening, 2026-10-09

This section supersedes the historical test baselines and reward-wiring gaps below.
R01–R18 are fixed in source and were re-verified against the original features.
**No on-chain deployment, live env update or hosting deployment was performed.**
Hermes handles deployment and environment changes. Legacy engine funding remains
fail-closed: the prior read found zero pools and no `safetyVersion()` marker;
Hermes must recheck zero pools immediately before cutover.

Preserve the user's design rationale in future changes:

- ONE universal RewardEngine, all four asset kinds and all four claim modes.
  New varieties belong in this contract's asset/mode model, not per-token deployments.
- Constructor-based, non-upgradeable custody. No proxy, admin sweep, custody pause,
  authority allocation privilege or migration extraction. Authority is immutable;
  replacement is an explicit new deployment behind the safetyVersion gate.
- Server confirms outcomes; contract holds custody; creator confirms Code/Open
  allocations; winner submits the claim. Contract AutoPush remains available and
  is tested with winner submission; wizard Auto prompt still uses Code on-chain.
- ERC-721 per-ID approve, ERC-20 exact aggregate allowance, ERC-1155 collection
  approval disclosed honestly with revocation guidance. Room binding needs no
  creator-token approval and now requests none.
- New funding fails closed in both API and wallet until safetyVersion == 2.

Additional changes: precise ERC-721 outgoing custody check allows recipient
forwarding/burning; chain/engine-scoped browser journals reject ambiguous legacy
attempts; Gate v3 pins a server-signed creator once, with no custody permissions or
owner replacement; `joinQuoted` binds token/fee/payee/payout/room/player/nonce and
reuses the V2 relay digest. Direct `join` remains for compatibility. Quote-changing
callbacks are blocked while ordinary creator updates/pause/payout routing remain.
Gate addresses are stored per token-entry room; old rooms without records use the
historical gate so an env cutover cannot erase already-paid admission. Legacy
joins retain mutable quotes and show that limitation. New room binding requires
Gate v3 and matching server ownership signer.

Full validation: **555 pytest tests**, **162 Forge tests** (141 first-round + 21
new feature/security regressions), **35 Node wallet/NFT/gate tests**, explicit
`tsc --noEmit`, production build. Both deployment scripts ran successfully in
local script VMs with chain ID 46630; these were neither RPC fork tests nor chain
deployments. Known notices remain Starlette/httpx deprecation and Vite chunk size.
Generated pycache and web/dist changes are excluded from the source commit.

Deployment artifacts and recipe:
`script/center/DeployRewardEngineV2.s.sol`,
`script/center/DeployCreatorGateV3.s.sol`, and
`python -m center.verify_reward_engine` (read-only bytecode/source-hash/authority/
version/confirmed-read-ABI verification). Use `FOUNDRY_PROFILE=rewards_v2`:
Solidity 0.8.37, Cancun, via-IR, optimizer 200. Target-chain fork simulation is a
Hermes release prerequisite. Full details, commands, residuals and migration
requirements are in `docs/audits/REWARDS_AUDIT.md`, "v2 hardening round".

Go-live: keep funding off -> deploy engine v2 -> verify authority, marker 2,
bytecode, read ABI and zero inventory -> set `CENTER_REWARD_ENGINE` and build-time
`VITE_REWARD_ENGINE` to the SAME new address -> rebuild/release API and frontend ->
flip `CENTER_TESTNET_REWARDS=true`. Gate activation is separate: deploy Gate v3,
verify bindingAuthority/marker 3, set `CENTER_CREATOR_GATE` + `VITE_CREATOR_GATE`,
and match `CENTER_ROOM_BIND_SIGNER_KEY` (or explicitly matching existing signer
fallback). Keep old room gate records and receipts; do not charge paid entrants
again. No engine migration code is needed for the reported empty legacy engine.
If pools existed, multi-engine readers/discovery and original-engine claim/reclaim
routing would be required; no admin can sweep assets into a replacement.

## Contracts LIVE on chain 46630 (Robinhood testnet)

| Contract | Address | Role |
|---|---|---|
| ORBIX token | `0x16C5451763eC2E0E7f041E2DB761A0491FdB6db1` | the platform token (18 dec) |
| CenterVault v2 | `0x481529b7b3BdE423499B1E7f817aa7DFa689cbE4` | ORBIX deposits; software balance |
| RewardEngine | `0x5b8d41421b9a6701cb7948e724234cb9b1eb8e1b` | ERC20/721/1155/ETH rewards, 4 claim modes |
| CreatorTokenGate v2 | `0xcfc161d02225eceb97aa9b8ff791a407a3bb3cff` | any-ERC20 join token + payout routing |
| (deprecated) vault v1 | `0x33e0d64d1e894cd2bce673baeb0ff68153bd0aa3` | immutable, bound to FREE — do not use |
| (deprecated) gate v1 | `0x19ecd51d78b3836863e8161503b1273e2241c08a` | fixed-treasury payout only |

Manifest: `center/deployments/rewards_v1.json`.
Both v2 contracts verified as deployed (status 0x1 receipts) and their
constructors checked on-chain (vault `vaultToken()` returns ORBIX).

## Backend (Railway orbix-center)

- Env now: `CENTER_VAULT_TOKEN=0x16C5…6db1`, `CENTER_VAULT`/`CENTER_ESCROW`=`0x481529…cbE4`,
  `CENTER_VAULT_SYMBOL=ORBIX`, `CENTER_REAL_BURN=true`, `CENTER_SIGNER_KEY` present.
- Live endpoints verified: `/health/ready` (reports ORBIX + new vault),
  `/token/{address}` (on-chain identity → entry_ok true for ORBIX),
  `/wallet/deposit/check` (401 unauth = auth gate works).
- Live deploy: `0fc5ca8e` (plus later pushes).

## Frontend (orbixcore.fun/center)

Live and verified in the served bundle: Contract deposit + QR deposit tabs,
Check deposit, "Reward type" selector (preview/token/NFT/ETH), claim-mode
selector (auto/code/merkle/open), claim window, custom message, "Where join fees
go" (creator/custom/burn), join-token field, featured game, "Play now" hero.
Chain-switch to 46630 built into both deposit and join paths.

## Test baseline (all green)

- **Foundry: 119** (RewardEngine 17, CreatorTokenGate 20, CenterGamePot+invariants+
  adversarial, plus the rest of the project)
- **Python: 257** (`cd center && PYTHONPATH=~/vibeswap .venv/bin/pytest tests`)
- Frontend: `npx tsc -b --noEmit` clean, `npm run build` clean

## Key architecture facts

- **Fee policy**: ORBIX creation fee is waived platform-wide until ORBIX itself
  graduates; afterwards the standard fee applies to every creator (no exemption).
  Join-token binding is independent and always available.
- **Join token**: ANY ERC-20 — only requirement is that `decimals()` answers.
  No ownership/creation/graduation check (a test asserts the source has none).
  Binding requires the creator to absorb ORBIX joiner fees so joiners pay only
  the chosen token.
- **Payout routing**: per-room Payee enum → creator wallet (default), custom
  address, or burn (`0x…dEaD`). Creator may change it any time.
- **Rewards**: RewardEngine pools with Auto / Code (wallet-bound, one-time
  nonce) / Merkle / Open claims; deadline then creator reclaim; fee-on-transfer
  rejected; `tokenCommitted` prevents sweep of committed assets.
- **Private-key rewards**: creator generates a fresh wallet, funds it, registers
  the address; the key is handed over off-chain. On-chain it is a normal transfer.
- **Deposits**: contract path = approve + `vault.deposit()`; QR path = send then
  `POST /wallet/deposit/check` reconciles on-chain `balanceOf` → software credit
  (delta only, 10s rate-limit, audit-logged).
- Identity: WS `who` comes from server tickets; clients never nominate winners.

## Deploy recipe

```bash
# site (static cockpit + Center SPA)
cd ~/vibeswap && bash deploy/site/build-site.sh
RAILWAY_API_TOKEN=<project token> railway up --detach \
  --project e4e3ab3b-70f4-4503-917b-e6011904dd69 \
  --environment c53306c8-52f9-4c8b-bd25-2b0fdbb6aa79 \
  --service 8fa652eb-710a-48f1-a24b-bcdd26f7eaf9      # orbixcore (site)

# backend API
RAILWAY_API_TOKEN=<project token> railway up --detach \
  --project e4e3ab3b-... --environment c53306c8-... \
  --service 2edb9c98-7055-4a1e-b00f-3f1f20443629      # orbix-center (API)
```

**Important**: the Railway CLI needs `RAILWAY_API_TOKEN` (account/workspace token),
NOT `RAILWAY_TOKEN`. Site uploads must run from the repo ROOT (the Dockerfile is
resolved as `deploy/site/Dockerfile` relative to the archive root). `web/dist` must
NOT be gitignored by `.railwayignore` — the API image COPYs it.

CLI path: `~/.npm/_npx/79fa66f96c8fdacf/node_modules/@railway/cli/bin/railway`.

## Access / secrets (files on this machine)

- Ethereum signer (coordinator `0x253db2…`): `~/.orbix_signer_env`
- Railway project token: `~/.orbix_railway_env`
- GitHub fine-grained PAT: `~/.orbix_github_env` (has workflow scope)
- RPC: `rpc.testnet.chain.robinhood.com` — **403s plain curl; send a browser User-Agent**

## ORBIX token lock (important)

The ORBIX token blocks transfers from team/curve-locked balances pre-graduation
(custom error `0xdb89e3f4`). Verified on-chain: the coordinator holds ~2.9M ORBIX
and cannot transfer; a curve buyer *can*. Mechanism: ORBIX is a vibe.fun bonding
curve token whose `curve()` (`0xa8805f42…cb18`) reports `complete() == 0` — not
graduated. **We cannot force graduation**; the honest options are (a) wait, or
(b) run Center value flows on a transferable token in the meantime. Deposits work
today for any wallet that can actually transfer ORBIX.

## Next up (priority)

1. **RewardEngine wiring**: creator-side approve + deposit + allocation calls from
   the publish flow (the contract and UI exist; the on-chain publish step needs
   the wallet calls wired end-to-end).
2. Designer Master Prompt second half: per-game generated key-art + WebP/WebM
   animated posters with poster-first lazy loading.
3. E14: full on-chain E2E on 46630 (create → join → play → settle → claim) once
   ORBIX graduates.
4. F1/F3: API/DB schema alignment with events; durable event indexer.
5. C4 remainder: 768px sweep, per-route empty/loading/error states, keyboard pass.
6. E5 remainder: Safe/timelock for registry governance (audit H-01).

## Honest gaps (never claim these done)

- RewardEngine is deployed and tested, but the creator-side publish→deposit wallet
  flow is not yet wired end-to-end.
- Funded value flows are unproven end-to-end on-chain (blocked by the ORBIX lock).
- 4 V4-documented templates are absent from the 19-format catalog (D1).
- G21–G24 chance/prediction games remain legally gated / demo-only.
- No mainnet anywhere, by design.

## 2026-10-09 — Phase P: forms are the rewards

User intent, verbatim essence: “the REWARD ITSELF is a form the winner fills in”; waitlist and Q&A are pure information collection, no funds move. Creators choose winners only / top 3 / everyone / custom top N. Forms belong beside token/NFT/ETH in step 4. Q&A answers are private to the creator, never public or shared with other players. A funded claim comes first, then forms. English only; no Railway deployment (Hermes deploys).

- Rewards now accept `waitlist-form` and `qa-form` with validated `forms` definitions, or append either/both definitions to `funded-assets`. Pure form rewards have no slots and issue no asset/point claims. Questions: 1–5; optional waitlist fields: up to 3; placement checks use authoritative engine eligibility/ranking.
- Extended durable waitlist storage with custom values; separate durable Q&A table dedupes room/player and replaces one response until room closure or scheduled expiry. Authenticated owner-only JSON/CSV endpoints; no private values in public room/results, websocket state or audits. Exports escape spreadsheet formulas. Creator my-rooms exposes per-form response counts and copy/export.
- Step 4 cards + builders, FREE language, prefilled address, sequential post-finish dialogs, Q&A replacement. Funded room shows claim cards first, then an explicit Continue to form rewards button; no claim transaction is required to answer. Dialog portal avoids result stacking contexts.
- Validation: full Python suite **574 passed**, full Foundry **162 passed**, `tsc -b --noEmit`, production build to `/tmp/orbix-phase-p-dist`, authenticated form browser end-to-end, existing funded/NFT wizard browser regression. Captures `/tmp/orbix-p-forms-wizard.png`, `/tmp/orbix-p-private-responses.png`. Local software browser only, no real fund transactions.
- Engine v2 `0xe818724e94b06cf5bf429d13fca377355ef1a7a3` and Gate v3 `0xe0752bce0b7c991f8fef731af502d6e64a5cad81`: user reports live and env-wired. No contract/env changes or Railway deployment in this phase.
- Workspace was not clean on arrival: pre-existing tracked Python bytecode, generated dist/site bundles, and untracked deployment broadcasts. Preserved and excluded from phase source commits. Builds use temporary output directories.

## 2026-10-09 — Phase Q: original mascot models and locomotion overhaul

User intent, verbatim essence: “running animation looks like punching while sliding”; “characters are bad”; wants banner-quality characters **IN GAME**, a cute 3D cat with fur-textured detail and turtle-like characters “like the banner, 100 percent.” Existing visuals were unacceptable. Server authority must stay intact, reduced motion must work, no copyrighted downloads, no Railway deploy; Hermes handles deployment.

Diagnosis and before/after:

- Source manifest maps Run to `Jog_Fwd_Loop`, not PunchCross. No evidence of a wrong clip-name mapping or double horizontal root displacement. The old jogging upper body held bent arms near the chest. The layered mixer could retain expired combat weight during a movement crossfade or after an inactive LOD; cadence used unmeasured fixed speeds (5.12/8.57) with a 1.5 cap.
- Replaced Walk/Run/Sprint presentation tracks with original two-bone IK foot paths and relaxed opposite arm swing. Lower/upper gait phases sync; playback scales to measured backward planted-foot velocity, including the character group's Z scale. Expired combat contributions stop on locomotion return. Actual accepted attacks still animate while legs move; fake combat is not introduced by walking. An initial fully weighted idle prevents bind/T-pose flashes.
- Maple (`cat`) has a tabby palette, layered eyes, muzzle/nose, whiskers, shaped ears, cheek tufts, continuous curved tail, shirt/vest, scarf and belt. Fur uses original surface grain/fibre colour variation plus rim light in existing material passes. Tuck (`turtle`) has a domed shell with hexagonal raised scutes and seam/rim detail, segmented plastron, stubby legs/paws, claws and expressive face. Both use the shared 20-clip topology and appear in profile selection, authenticated lobby, live game and podium.
- Audited all ten previous models. Puff/Marshmallow and Bolt/Robot were the hardest box shapes; rounded those surfaces. Enlarged faces/eyes throughout; moved eyes outside helmet/visor surfaces; improved Peep, Flip, Wisp and Bud silhouettes/palettes. All twelve use shorter presentation legs, owned inverse matrices and retargeted pelvis tracks. Physics, hitboxes, movement rules, scores, settlement and reward authority are unchanged.
- Ownership review found Three's Skeleton clone shares the inverse array. Detach it before calculating proportion-specific inverses; a regression now checks that every character leaves cached source bindings intact.
- Reduced motion freezes decorative idle in preview/lobby/podium/actors and disables squash/recoil. Essential movement and accepted action animations continue.

Evidence and limits:

- **597 Python tests** (center plus top-level tests), **162 Foundry tests**, `tsc -b --noEmit`, production build and local static-site assembly passed. Existing motion/jitter/envelope, podium and result regressions passed.
- **72** real mixer/LOD gait cases: Walk/Run/Sprint on all twelve characters; no expired combat contribution, synchronized layers, measured planted-foot speed within the 6% regression tolerance. **144** real RigActor state/reduced-motion checks. **84** software-WebGL frame captures: seven states per character, zero browser/shader errors, plus combat→run recovery and turtle shell review. Full regenerated frames: `/tmp/orbix-q-frames`; curated versions and metadata: `tools/tests/evidence`.
- Authenticated browser: Maple/Tuck profile previews, selection persistence, real lobby appearances, two actual authoritative bodies and live match rendering/finish. Production podium renders both using placement fixtures; that fixture does not establish a real winner. All three V4 practice worlds pass visible loading/rendering and accepted movement/jump with zero JS errors.
- Near default geometry peaks at **14,072 triangles**, at most **5 material groups**; distant geometry stays below **4,000 triangles** in the regression. Geometry/shader sources and hashes are recorded in `web/public/center-models/original-characters.manifest.json`.
- **Honest limitation:** these are original stylized game models, not a literal reproduction of the banner's offline fur/detail fidelity. Fur has surface detail and rim softness, not true strands or transparent shell silhouettes. This avoids extra fur passes/overdraw; physical mid-phone FPS, thermals and memory remain **unproven**. No claim of 100% visual parity or measured device performance.

Shipping:

- Phase P commit: `24a8cd00`. Phase Q is a separate commit including the final renderer, regressions, captured review evidence and refreshed checked-in cockpit/Center bundles. The deployment Docker image consumes those bundles, so rebuilding them is necessary for Hermes to ship the new UI.
- Pre-existing generated bundles were backed up before replacement at `/tmp/orbix-preexisting-generated-bundles.tar`. Pre-existing tracked Python bytecode and deployment broadcast receipts remain untouched/uncommitted. No Railway command or on-chain transaction was issued.
- Security note: an existing credential embedded in the Git remote appeared during remote inspection. It was not copied into repo artifacts; subsequent Git output is redacted. Rotate that credential.

## 2026-10-09 — Phases R0/R1/R2/S/T: engine analysis and shared V4 framework

User directive, verbatim essence: “Use the open source things and engines it
mentioned: Babylon.js, PlayCanvas, Godot engine and more — proper analysis, plan,
and extract everything's skills and all stuff, and everything mapped, and upgrade
the entire thing.” User explicitly required analysis BEFORE runtime code, a system
migration map, shared framework, one polished slice, untouched server authority
and money flows, CC0/MIT additions, per-phase commits, full verification/browser
evidence, push master:main, and NO Railway deployment.

- R0 `b02234ef`: primary-source engine analysis and an external pinned benchmark.
  R1 `6125b9a8`: every controller/animation/camera/environment/health/loading/netcode/
  asset system mapped. R2 `776d74ad`: shared presentation implementation. S
  `4a068703`: Sunnydrop Token Catch connected routes and instanced outpost dressing.
  T carries final telemetry, mobile Dodge, lifecycle/acceptance evidence and rebuilt
  checked-in web bundles. Python/contract sources and wallet/session/reward source
  are unchanged; pre-existing tracked bytecode is excluded from commits.
- Keep Three.js/R3F + existing Python authority. Babylon runtime REJECTED: duplicate
  renderer/resource ownership, migration cost, Apache-2.0 outside this task's license
  rule. PlayCanvas runtime REJECTED as redundant; MIT engine/editor GLB hierarchy
  export is a documented optional authoring workflow. Godot web runtime REJECTED:
  rewrite/WASM/embedding costs, Compatibility WebGL2 and threaded export isolation
  constraints; single-thread export exists. Godot MIT offline GLB authoring accepted
  as an option; no editor roundtrip was performed.
- Rapier is **Apache-2.0, not MIT** (installed 0.21.0); REJECTED by the license rule
  and measured full-API compat payload 1,645,473 gzip bytes. Jolt MIT REJECTED for
  952,524 gzip bytes/native binding ownership when dynamic physics is unnecessary.
  Selected cannon-es 0.20.0 MIT: full API 36,161 gzip bytes, actual ten-ray/forty-box
  camera queries p95 .0627 ms on Node/Linux x64. No `World.step`, actor rigid bodies
  or client outcome simulation. Full-API sizes are not minimal tree-shaken bundles;
  dynamic solver benchmark is noisy and cannot rank phone performance.
- Read actual MIT VRM Game Starter FootIK/CameraRig/BVHEcctrl and OpenCombat server
  movement/lifecycle sources at pinned revisions. Independently adopted stance IK,
  collision-after-easing, bounded response and intent/state separation techniques;
  no reference code/models copied. Mixamo/VRoid samples REJECTED (not CC0/MIT).
  Existing 20 Quaternius CC0 clips/GLBs unchanged; original procedural assets only.
  See docs/research/framework-license-ledger.md and docs/licenses/cannon-es-MIT.txt.
- All three V4 games consume typed two-layer animation FSM/blend times, one-shot
  cosmetic contact windows, bounded foot stance IK, static surface/camera queries,
  look-ahead and shared published-HP feedback for players AND guardian. Texture/
  shader/actual-frame warmup is shared. Token Catch chosen because pickups, terrain,
  cover and rival combat exercise the whole layer; only its composition is rebuilt.
  Reduced motion suppresses decorative recoil/flash/contact/lead. The touch Dodge
  button uses the existing authoritative action; no server or money behavior changes.
- Physical acceleration/automatic cover step-up/new roll displacement are deliberately
  NOT claimed: current authority uses immediate velocity, support/jump and dodge.
  Camera/gait response, slope/step foot placement and accepted dodge are implemented.
  Changing simulation requires a separate server rules change, conflicting with this
  task's server-untouched instruction. Animation windows never inflict damage.
- Stray tools/tests/framework-browser.cjs and web/framework-review.html were inspected
  and retained/repaired as development review tools, with a deterministic actual V4
  scene and mount/update API. The requested ChatGPT review is absent in the checkout
  and searchable local Git history; exact Phase 1–4 compliance remains UNPROVEN.
  animation-loading-research.md was recovered verbatim from commit 3e3fb98e.
- Final checks: complete `pytest center/tests tests` **597 tests**, all pass; default
  center run separately **576 passed**; full Forge **162 passed** in 16 suites;
  all web/Center Node unit tests **41 passed**; **17 regression scripts passed**
  including 144 actor states, 72 real gait/mixer cases and 84 rendered character
  frames; TypeScript noEmit and production Vite build pass. Existing browser flows
  cover all three actual V4 practice worlds, authenticated character lobby/match,
  podium fixtures, reward/form wizards, admin, wallet recovery/waitlist/CSV and mocked
  WalletConnect with real server signatures. Old test harness imports/selectors were
  updated to the current UI without removing security/consent/export assertions.
- Five actual scene unmount/remount cycles: renderer counts stable at 70 geometries/
  6 textures mounted, 1/1 unmounted; this does not measure total heap or VRAM. Shared
  health screenshot uses synthetic published HP only. Before/after fixed scene:
  58→63 calls and 122,464→124,246 triangles, within scene ceilings; SwiftShader
  p95 1410.5→813.6 ms, **frame-time gate FAILS**. No speed/device-performance claim.
  Telemetry includes long frames and uses bounded DPR hysteresis down to .65.
- Older per-character 10k/one-palette-draw target is exceeded by existing mascots
  (peak 14,072 triangles/five groups). Phone GPU/thermal/latency, heap/texture bytes,
  animation CPU, controlled cold-network launch, offline editor roundtrips and live
  relay/hardware/funded on-chain flows remain unproven. GLBs total 2,975,856 raw,
  1,888,701 filesystem-gzip bytes; excludes code and is not hosting compression.
  See docs/research/framework-validation.md and tools/tests/evidence/rst.
- Shipping destination is master:main; push verification is reported in the final
  response. No Railway command/deployment or on-chain transaction was issued.
- Mobile touch-emulation browser passed portrait/inert gating, landscape entry,
  reduced motion/fast tier, accepted move/jump/dodge, first/third-person and two
  fullscreen entry/exit cycles. Native fullscreen emulation uses a landscape
  screen matching rotation. Selected asset network responses totaled 5,335,985
  encoded bytes (5.09 MiB) on the uncompressed local host: **3 MiB budget FAILS**
  there; no production-compression or reference-phone certification.

- Final mobile capture check exposed camera pointer capture stealing the performance
  disclosure click. Interactive controls now bypass camera drag and Space on the
  disclosure uses native activation; the browser checks pointer/keyboard opening
  without submitting a gameplay jump. The final capture waits for restarted-world
  warmup, rather than retaining a loading-screen image.

- V4 browser movement regression now tries a real sidestep if a spawn faces solid
  cover, retaining the original >0.5 m displacement assertion. This corrects a
  clear-path assumption without changing collision or gameplay rules.

- The Phase T push to master:main succeeded. A packaging follow-up includes the
  exact cannon-es MIT notice in public/dist licenses as well as the source ledger,
  because minification drops its ordinary source comment. No runtime behavior
  changes; served notice bytes are checked against the installed package license.

## 2026-10-10 — Babylon.js mandated and shipped (user override)

User rejected the keep-Three.js decision table: "use Babylon.js... build it new but
better 100x using all the open-source tools". Directed effort policy: xhigh for
planning, high for building.

Shipped (commits accd5d9b, f20d0834, 400b3053, 4a61698c, 1fd0baa6):
- web/src/center/babylon/: @babylonjs/core + Havok foundation, character controller
  (capsule, 50° slopes, 28cm step-up, accel/decel), animation groups from existing
  CC0 GLBs (20 clips), prediction/interpolation ported byte-identical from
  worlds/motion.ts (125ms buffer, bounded extrapolation), staged loading, PBR/fog/
  shadows, thin-instanced loot (400 piles).
- Token Catch DEFAULTS to Babylon; ?engine=three keeps legacy. Other games remain
  Three (legacy marked in worlds/README.md).
- vite codeSplitting: single babylon-engine lazy chunk (3.7 MB) — landing bundle light.
- Parity: docs/research/babylon-parity.md — same reducer/protocol/rewards; terrain
  samples agree within 5.56e-16; real-room reconnect/results/rematch recorded.
- Tests: 576+21 pytest, 162 forge, 41 frontend, tsc, builds green. Browser evidence
  desktop/390px/touch/fullscreen.

Honest: SwiftShader frame-time target failed (software renderer); real-phone perf
unverified; Babylon visual alternatives for Three fur shaders (PBR palette style);
no funded tx exercised. Deployed: both Railway services SUCCESS 10:49 +08
(live index-BKP7pPKZ.js, babylon chunks 200).

## 2026-10-10 — Portfolio pivot: 5 new latency-tolerant games + auto-reveal + fullscreen (user feedback round)

User's honest feedback: Babylon open-world games unplayable over no-CDN single-region hosting
(RTT); old Three.js Token Catch looked better (structure/texture/colour) than the Babylon one;
RPS "Reveal" button caused forfeits; wants 5 MORE games like Number Hunt/RPS (latency-tolerant),
true fullscreen everywhere + minimize, richer character art. Open-world games stay but will be
hidden manually.

Plan round (xhigh, 1cde97e0): docs/specs/{reaction-duel-auto-reveal, fullscreen-immersion,
five-new-games, game-portfolio-strategy, character-art-upgrade}.md + renderer verdict correction
(Token Catch default back to Three.js; ?engine=babylon stays).

Build round (high, commits 46f6a346, 5d086732, d1e53dd0, 9f33cfe1, d594d23b, 88e65ecd):
- RPS/Reaction Duel v2: NO Reveal button — commit locks, server tick auto-reveals at window
  close (works if tab closed); no-choice = forfeit (never auto-pick); CHOICE_LOCKED;
  preimage retained privately server-side; template_version=2.
- Persistent fullscreen shell for ALL games + minimize; portrait no longer blocks turn-based
  games; viewport-fit=cover; portals inside fullscreen subtree.
- Character wardrobes: textured outfits/dresses, frozen round appearances
  (center/cosmetics_catalog.json).
- FIVE NEW GAMES (all latency-tolerant, selection-window → sealed → auto-result):
  closest-call (estimation museum), word-forge (word building, pack_sha256 dictionary),
  prism-lines (4-in-a-row strategy), relic-auction (sealed bids, virtual credits only),
  atlas-quest (map placement). Each: engine + rules + hint policy + stage + banner art
  (original generated) + practice + wizard/catalog wiring.
- Portfolio: latency-tolerant games surfaced; real-time worlds hideable via admin toggle.
- Cabbage cron removed (script retired).

Tests: 799 pytest (778 center + 21 community), 162 forge, 41 frontend, tsc, builds green.
Deployed: both Railway services SUCCESS 19:58 +08 (live index-Fl9LeYyT.js; all 5 new game
IDs in served bundle). Limits: latency figures are estimates; no real-phone measurement;
content packs need curation before treating answer-leak resistance as meaningful.

## 2026-10-10 — Per-game admin customization and offline preview (BUILD)

User intent: individually control every game’s catalog/More/upcoming/hidden
placement, configurable blue “Coming soon” overlay and development tag, ordering,
Try now versus offline Preview, and separate create/join toggles through a smooth
signed-admin editor. Build the feature; push master:main; Hermes handles deployment.

Shipped:
- Strict per-template `game-config:*` settings with placement, overlay, tag,
  practice/preview/create/join toggles and sort order. Each save records its
  timestamp, admin actor/proof digest and an atomic `game.customization` entry in
  the existing audit chain. Public `available_modes` exposes effective gates;
  stored toggles survive placement changes.
- Card editor with placement/banner/play-mode steps, original shared banner art,
  live badges, contrast-aware custom colors, preserved unsaved drafts, reset,
  ordering and the existing fresh wallet-signature flow. Mobile 390px and reduced
  motion supported.
- Games and More games tabs; upcoming cards show banner/overlay/tag and only
  enabled offline Preview. Catalog, wizard, public-room directory and room
  admission actions respect per-game placement/modes. Server publishing,
  drafting, reward preparation, joining and practice enforce the toggles.
- `/center/preview/{templateId}` reuses all 25 existing stage components with
  public build-time seeded fixtures and a local, disconnected demo reducer.
  Movement, interaction, seed/reset/pause and a persistent offline badge work
  without API calls, WebSockets, session initialization or storage. Local motion
  bypasses network interpolation; the badge remains visible in fullscreen.
  Only the initial page request checks policy; the site proxy forwards that read
  to Center and disabled previews return 404. Demo outcomes are illustrative.
- Existing Try now presets retain server-managed ephemeral behavior (the brief’s
  DB description differed from the actual code: practice already writes no rooms
  or ledger). Other templates can opt into the same server practice shell through
  their admin toggle; formerly unsupported templates stay disabled by default.
- Isolation and API notes: `center/PREVIEW_ISOLATION.md`. Fixture generator and
  backend/browser regressions added. Prebuilt `web/dist` and
  `deploy/site/center-dist` refreshed for both service images.

Validation: full `pytest center/tests tests` **848 passed**; **162 Forge tests**;
TypeScript and production build passed. Offline reducer tests forbid network and
storage access; browser sweep verifies 25 stages with a saved wallet and zero API
requests/WebSockets, local inputs, fullscreen badge, signed saves/draft
preservation, mode gates and reduced-motion 390px layouts. Existing admin browser
polling/signature/cap checks pass at 1200/390/320px; wallet and real-room motion
regressions remain green. Intentional existing-test updates: portfolio placement
`featured` → `catalog`, and shared image/vector admin banner assertion.

No Railway deployment was requested or performed. Unrelated pre-existing Python
cache and cockpit build changes were excluded from the commits.
