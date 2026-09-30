# Orbix Center — build status and verified evidence

Scope: the Center creator game/quiz platform inside orbixcore.fun, built to
`ORBIX_CENTER_BUILD_MANUAL_V4.md` (V4 supersedes V3). Every claim below is backed by a
command that was actually run; nothing here is a plan.

This document is the manual's Phase A deliverable ("baseline evidence") and the running
record of what is proven, what is simulated, and what is deliberately switched off.

---

## 1. What exists and where

| Layer | Path | State |
| --- | --- | --- |
| Contracts | `src/center/{CenterRegistry,CenterVault,CenterEscrow,SettlementVerifier,ICenter}.sol` + `mocks/Mocks.sol` | complete, 27 tests pass |
| Deployment script | `script/center/DeployCenter.s.sol` | deploys the whole stack and writes `center/deployments/local.json` |
| Backend | `center/{schema,store,lifecycle,vault,settlement,room,api}.py` | complete, 45 tests pass |
| Engines | `center/games/*.py` (8 templates) | complete, server-authoritative |
| Frontend | `web/src/center/*` (shell, wizard, 8 stages, wallet, results) | complete, browser-verified |
| On-chain flow proof | `center/onchain_flow.py` | 17/17 checks pass against a live Anvil chain |
| Container | `deploy/center/Dockerfile` + `requirements.txt` | deployed and serving |

Live preview: `https://orbix-center-production.up.railway.app/center`
(Railway project `orbixcore`, service `orbix-center`, volume `orbix-center-volume` at `/data`.)

## 2. Verified evidence

### 2.1 Contracts — `forge test --match-path 'test/center/*'`
27 tests pass: deposit accounting (fuzzed), idempotent per-intent deduction, refund once
and only by the creator, fee-on-transfer rejection, withdrawal-delay and
cannot-touch-committed-balance rules, full round lifecycle, claim, double-claim rejection,
forged-proof rejection, NFT/ERC-1155 rewards, refunds.

### 2.2 Backend — `center/.venv/bin/python -m pytest center/tests -q`
45 tests pass, covering:
- schema: bounded per-template rules, extra fields rejected, cap and cross-field checks;
- engines: 18 engine tests (hostile input, secret never leaked in `public_state()`,
  deterministic replay from the seed, snapshot round-trip);
- full rounds for **all eight** templates driven through the room runtime, including a
  real BFS solve of the 3×3 puzzle;
- **merkle proof integrity**: every stored entitlement proof rebuilds the recorded root;
- **the revealed seed reproduces the same secret draw** for the four draw-based engines;
- vault idempotency, refund-once, no-negative-balance, joiner fee absorbed once;
- lifecycle legality, terminal states never overwritten, unknown states rejected;
- API: auth, publish idempotency (a replayed publish returns the original room and charges
  once), private-room invite gate, insufficient-balance refusal, preview room refusing the
  real vault, claim ownership check before payability;
- **restart durability**: a mid-round restart resumes from the checkpoint with byte-identical
  engine state and can still settle;
- realtime: an authenticated two-player WebSocket round to settlement, over a bounded,
  non-hanging reader.

### 2.3 Cross-language settlement agreement — `center/onchain_flow.py`
Against a local Anvil chain with the real contracts deployed, all 17 checks pass:
- vault deposit credited; a deduction applied; **a replayed deduction is refused and the
  balance does not move**;
- `settlementDigest` computed by the contract **equals** the Python EIP-712 digest;
- after `publishSettlement`, the contract stores **exactly the Python-built merkle root,
  allocations hash and transcript hash**;
- the winner is paid the full allocation; a second claim is refused; a forged entitlement
  is refused; the runner-up is paid.

This is the check that matters most: the off-chain tree builder and the on-chain verifier
are proven to agree, not assumed to.

### 2.4 Frontend and end-to-end, in a real browser
Verified by driving the running app (no screenshots, no guessing):
- catalog renders 8 formats; wizard publishes a room; the room link works;
- a live round on the local server and on the deployed service: join → ready → start →
  play → settle → claim code;
- **the 4-digit rule**: typing `123456789` leaves `1234` in the field; pasting `987654321`
  leaves `9876`; exactly 4 digit slots; submit disabled unless the field is complete;
- settlement panel shows the ranking, the claim code (`OC1-xxxxxxxx-XXXXXX`) and a
  fairness receipt (merkle root, allocations hash, transcript hash, settle-by);
- a round abandoned by the client was closed by the server scheduler with **zero clients
  attached** — the deadline path is not dependent on a browser being open.

### 2.5 Live-service verification (deployed Railway instance)

Driven against `https://orbix-center-production.up.railway.app` (not the local server):

- catalog renders 8 formats; sign-in (real secp256k1 challenge) works; vault top-up shows
  **500 simulated**; publishing a room returns a room URL.
- a full round played in the browser: join → ready → start → guess → settle → claim code.
- **the 4-digit rule on the live build**: typing `987654` leaves `9876`; 4 digit slots.
- **a round nobody won**: the ranking is still shown for transparency, but there is **no
  allocation and no claim code** — verified after the eligibility fix was deployed. Before it,
  the same round paid slot 1 to a player who never found the target; that was a real bug found
  by live testing, fixed in `eligible()`, and re-verified.
- **a round that was won**: guessing the target produced `#1 … 100 PTS` with claim code
  `OC1-0DDEC4E1-CE0E7F` for entitlement `0x0ddec4e1…5882bd` (`asset_kind: preview-points`,
  `claimed_tx: null` — honestly unpayable).
- `GET /rounds/{id}/fairness` returns `roundId, commitHash, seed, merkleRoot, allocationsHash,
  transcriptHash, settlementDeadline, chainId, escrow, actions, publicState` — the commit is
  published, the seed is revealed after the round, and the transcript is retrievable.
- the abandoned round was closed by the server scheduler with no client attached.

## 3. Honest limits (what is simulated or disabled)

- **No token is created.** Publishing charges the *simulated* vault balance
  (`unit: "simulated"`). `CENTER_REAL_BURN` is `false`; with it on, `deduct` runs on-chain
  against `CenterVault`. Both the API and the UI label the balance as simulated.
- **Rewards are points, not money.** Preview rooms produce `preview-points` entitlements and
  a claim code; `/claims/lookup` answers `payable: false` with the reason, by design.
  Funded assets require `CENTER_TESTNET_REWARDS` + `CENTER_ESCROW`.
- **Mainnet is refused at startup.** `CENTER_MAINNET=true` fails boot with an explicit
  message; there is no code path that could pretend otherwise.
- The wallet is a **browser demo key**: it signs the real sign-in challenge (real secp256k1,
  server-verified) but holds nothing. It is labelled as such wherever it appears.
- Funded rewards, casino-style formats and any fiat path remain out of scope until the
  token, escrow and legal gates are settled.

## 4. Design decisions worth keeping

1. **Server owns every random draw.** The client sends intent only (a guess, a flip, a lane,
   a nonce). Secret state never appears in `public_state()` before the round ends.
2. **Commit before play.** `roundId`, config hash and seed are committed before play; the
   seed is revealed afterwards so anyone can re-derive the draw.
3. **Rotatable settlement authority.** A disclosed co-signer signs settlements
   (`SettlementVerifier`, rotatable per epoch) instead of pretending an RNG is
   trust-minimised.
4. **Idempotency end to end.** A publish intent is consumed once, so a retried publish
   cannot double-charge; a claim can be paid once.
5. **No reward without the objective.** Each engine defines `eligible()`; a round nobody won
   produces zero allocations rather than inventing a winner.
6. **One origin.** FastAPI serves the API and the SPA, so there is no CORS or proxy between
   what was verified locally and what runs deployed.
7. **Durability by checkpoint.** The engine snapshots after every accepted action, so a
   restart mid-round resumes rather than resetting.

## 5. Known follow-ups

- The `deploy/center/Dockerfile` ships the **prebuilt** SPA (`web/dist`). Rebuilding in-image
  was tried and abandoned: `npm install` fails inside the Alpine builder
  (`npm error Exit handler never called!`). Build the SPA before deployment.
- One worker only: the room registry and scheduler are in-process. Horizontal scale needs a
  shared store and pub/sub (Postgres + Redis), which the store layer is written to allow.
- `token-catch` exposes a short live window of the spawn timeline (0.8 s) so a human can
  react; the full timeline stays secret. If bots become a problem, add a per-round rate
  limit on catches.
- Streams/office-hours scope from the manual's brainstorm section is still unimplemented by
  design (it needs production infrastructure).

## 6. Reproduce

```bash
# contracts
forge test --match-path 'test/center/*'

# backend
center/.venv/bin/python -m pytest center/tests -q

# on-chain settlement agreement
anvil --port 8546 --chain-id 46630 &
forge script script/center/DeployCenter.s.sol:DeployCenter --rpc-url http://127.0.0.1:8546 --broadcast
PATH=$HOME/.foundry/bin:$PATH center/.venv/bin/python center/onchain_flow.py http://127.0.0.1:8546 center/deployments/local.json

# frontend
cd web && npm install && npx vite build

# local server (API + SPA on one origin)
CENTER_DB=$PWD/center/center-live.db CENTER_WEB_DIST=$PWD/web/dist \
  center/.venv/bin/python -m uvicorn center.api:create_app --factory --host 127.0.0.1 --port 8099
# → http://127.0.0.1:8099/center
```

---

## 7. Later catalog (G09-G20) — built in the second pass

Eleven new templates, each with its own reducer, rules schema, adversarial tests, client
stage and artwork. The manual's rule is explicit that re-skinning an engine is not
acceptable, so none of these share a reducer with the release-one eight.

| # | Template | Engine file | Objective that pays |
| --- | --- | --- | --- |
| G09 | RPS Duel | `games/rps_duel.py` | won a subround |
| G10 | Reward Grid | `games/grid_bingo.py` | found a reward tile |
| G11 | Token-Logo Bingo | `games/grid_bingo.py` | claimed a valid line |
| G12 | Pattern Recall | `games/recall_type_maze.py` | reached the starting length |
| G13 | Typing Sprint | `games/recall_type_maze.py` | met the accuracy floor |
| G14 | Maze Race | `games/recall_type_maze.py` | reached the exit |
| G15 | Level Runner | `games/runner_detective_mev.py` | positive distance |
| G16 | Contract Detective | `games/runner_detective_mev.py` | one correct answer |
| G18 | MEV Rush | `games/runner_detective_mev.py` | captured an opportunity |
| G19 | Idle Rig | `games/runner_detective_mev.py` | any accrual |
| G20 | Airdrop Quest | `games/runner_detective_mev.py` | one achievement |

`G21-G24` (Lucky Wheel, Plinko, Crash, Candle Prediction) are **not built**: the manual
requires specialist gambling/financial-product legal review first, and labels them
inactive for monetary play. They are catalogued as unavailable, not shipped as demos.

What the tests prove for this batch (`center/tests/test_late_engines.py`, 30 cases):
commit-reveal integrity and forfeits (G09); per-wallet reveal caps, duplicate-reveal
refusal and seed replay (G10); forged-line refusal and a shared deterministic call
stream (G11); a future sequence is never exposed before its step (G12); an impossible
keystroke burst is refused while a human pace is accepted (G13); wall-clipping and
teleport moves are refused and a seeded maze is solvable (G14); crash and seed replay
(G15); no answer or explanation leaves the server before the round closes (G16);
double-inclusion and stale-opportunity refusal (G18); the inventory cap can never be
exceeded even after a 10,000-second clock jump (G19); duplicate and invented
achievements are refused (G20).

## 8. UI rework and the bugs live testing caught

The second pass also rebuilt the creator wizard and the catalog, and browser testing
found real defects that unit tests could not:

1. **The wizard dumped raw rule keys** (`guess_cooldown_ms`, duplicated select options)
   because it rendered whatever was in the rules object. Now each template declares its
   own labelled field list, so exactly one game's settings appear at a time — verified
   live for all 19 templates (`0` raw keys leaked).
2. **A round nobody won still paid slot 1.** Each engine now defines `eligible()`;
   an unwon round produces zero allocations and no claim code (verified live).
3. **The wizard sent fields a template does not declare** (`duration_seconds`,
   `player_cap 8` for a 1v1 room). The wizard now reads each template's own schema
   (`GET /templates/{id}/rules`) and clamps to its real caps, and only sends a round
   length when the template has one.
4. **`GET /templates/{id}/rules` returned 500** — `json.loads` was called on an
   already-parsed dict. Fixed and covered.
5. **A reconnecting client never saw the settlement.** The results were only ever a live
   broadcast, so an idle tab showed nothing after the room closed. The server now replays
   the settlement frame from durable state on connect, including after a restart.
6. **Two new engines omitted `template` from `public_state()`**, so the client could not
   tell whether round state had arrived and rendered no stage. Fixed for all engines.
7. **Nav highlight read `window.location`** instead of the router, so the active item
   could go stale. Now derived from the route (exactly one active item, back/forward safe).

Every fix above was re-verified in a real browser against the deployed service, not only
in tests. Live evidence: a full Reward Grid round played end-to-end (slot found, claim
code `OC1-0374CC03-DF5841`), a Pattern Recall sequence accepted and the step advanced, a
Logo Bingo round that streamed 18 calls and settled, an MEV Rush round with live
opportunities, and a Maze Race move accepted on the production URL.

## 9. Honesty notes added in this pass

- Reward Grid is chance-based: the manual requires a demo/testnet label until legal
  review, so it ships labelled and points-only.
- Contract Detective is educational content and says so; it is not an audit or a
  certification.
- MEV Rush is a **simulated** queue and states that it is not a real-chain frontrunning
  service.
- Idle Rig has no off-line payout: it uses the server clock with a hard inventory cap.
- Typing Sprint never scores client-reported WPM; keystroke timing is checked server-side
  and pasting is refused.

## 10. 2026-09-30 — domain wiring + live bug hunt (F07/F08)

- **orbixcore.fun/center is live.** The orbixcore site service serves the Center SPA
  (built with base `/center/`, copied to `deploy/site/center-dist`) and proxies
  `/api/center/*` — HTTP and WebSocket — to the orbix-center service over Railway
  private networking (`CENTER_INTERNAL_URL=http://orbix-center.railway.internal:8080`).
  Express `pathFilter` mount, not `app.use(path)`: the path form strips the prefix and
  produced 404s. `RAILWAY_DOCKERFILE_PATH=deploy/site/Dockerfile` with a repo-root
  build context (`COPY deploy/site/ .`). Cockpit at `/` untouched.
- **Four production bugs found by browser-driven playthroughs and fixed:**
  1. mev-rush `tick()` emitted `patch={"live": <int>}`; the client merge
     (`{...prev, ...patch}` in web/src/center/ws.ts) replaced the array
     `public_state()["live"]` and `MevStage`'s `live.slice` crashed the whole SPA on
     round start. Renamed the patch key to `liveCount`.
  2. logo-bingo `tick()` sent `"calls": len(...)` (a number) over the array
     `public_state()["calls"]` — same crash class, caught by the new suite before
     users saw it. Renamed to `callsCount`.
  3. The wizard sent `duration_seconds` into live-quiz/reaction-duel rules and
     `max_players` into memory-match (and any solo template); `extra="forbid"`
     rejected those publishes. Added `NO_DURATION`/`MAX_PLAYERS_IN_RULES` sets.
  4. The start check used `min(min_ready_to_start, len(players))`, letting a host
     start a 2-ready room alone (observed live). It is now a hard floor; production
     shows "Not enough players are ready yet."
- **New regression suite:** `center/tests/test_patch_safety.py` — parametrized across
  all 19 engines; drives start → ticks → actions and fails if any patch key changes the
  type of a snapshot key. Prevents the whole white-screen class.
- **Verification:** 100 pytest green. All 19 formats on production: publish → join →
  ready → start → stage renders, socket OPEN. Deploys: 60349e83, 490bcbef (center),
  4c7fb1dc (site), c9f4d882 (center).
