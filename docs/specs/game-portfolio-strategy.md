# Orbix game portfolio strategy — 2026-10-10

Status: planning decision for the next BUILD round; no hosting or catalog settings changed here. Related specifications: [renderer verdict](../research/renderer-verdict-2026-10-10.md), [auto-reveal](reaction-duel-auto-reveal.md), [five new games](five-new-games.md), [immersion](fullscreen-immersion.md), [character art](character-art-upgrade.md).

## Product decision

Prioritize short, server-arbitrated rounds with 3D boards/props and immediate local selection feedback. Keep Number Hunt prominent, repair Rock Paper Scissors Duel, and prepare existing quiz/puzzle/memory experiences for promotion. Add five distinct games only through the existing platform contracts. Stop adding features to the open world; the owner will hide/disable it manually. Do not delete saved worlds, renderer routes, receipts, claims or history.

The owner's diagnosis is directionally correct: ~150–300 ms RTT is a poor foundation for contested pickups, aiming and close combat, while a 15–40 second answer/turn window can absorb it. “Unplayable” is the owner's observed experience, not a universal technical threshold. Prediction can make movement look responsive at high RTT; it cannot make two competing authoritative pickups occur locally or remove delayed corrections. Better movement alone does not fix the product.

The stated **single-region Railway, no asset CDN, Indian/mobile RTT ~150–300 ms** is a product-owner/environment assumption for this analysis, not a measurement from an Indian device or proof of the live service's region/cache configuration. `deploy/center/Dockerfile` confirms one origin for prebuilt SPA/API, one Python worker and SQLite/in-process room authority. Repo files do not establish live Railway settings. No live network benchmark was conducted in this planning round. Below are code-derived latency estimates and budgets, with an explicit measurement plan.

Railway's current edge routing still sends single-region traffic to that deployment even when it enters a nearby POP. Its docs now also describe optional beta CDN caching; therefore “our service has no CDN” must not become “Railway has no CDN.” Enabling it has not been verified or performed. [Railway edge networking](https://docs.railway.com/networking/edge-networking), [Railway CDN](https://docs.railway.com/networking/cdn).

## Budget model

Let RTT be 150–300 ms, approximately 75–150 ms one way under symmetric routing. Asymmetry/jitter can be much worse. Rendering at 30/60 FPS adds up to about 33/17 ms. Server/database/queue processing is additional and **unmeasured**.

| Path | Code-derived baseline estimate at assumed RTT | Meaning |
| --- | --- | --- |
| Local hover, selection, board preview | ≤1–2 frames, target ≤50 ms | Immediate presentation; never confirmation of a score or reward |
| Nonarena accepted action → ack/public patch | RTT + processing + frame ≈167–333 ms at 60–30 FPS | `RoomRuntime.act` checkpoints/logs accepted actions and sends ack plus full public state; it does not wait for the periodic tick |
| Nonarena deadline → visible resolution | tick residual 0–250 ms + one-way 75–150 + frame ≈92–433 ms | Scheduler default `.25 s`; actual slip can exceed this under load |
| Arena input → confirmed outcome | RTT + up to ~33 ms simulation residual + 0–100 ms snapshot residual + frame ≈167–466 ms | Scheduler runs at up to 30 Hz with arenas; arena broadcast target 10 Hz, checkpoint ~1 s. These are configured cadences, not throughput guarantees |
| Remote actor picture | server-to-client one way + up to 100 ms snapshot residual +125 ms interpolation + frame ≈217–408 ms old | Shared motion buffer improves smoothness at the cost of displayed age; local prediction cannot remove contested authority delay |
| Legacy Catch spawn → tap confirmation | tick residual 0–50 ms + **RTT** + human response + processing/frame | Needs one outbound spawn delivery and one inbound catch request; a 250 ms minimum catch window can be largely consumed by network transit |

At 10 s, 300 ms is 3% of a choice window; at 20 s it is 1.5%; at 250 ms it is 120%. A new sealed-answer window of at least 15 s, accuracy/quality scoring and no arrival-time tie-breaks is the preferred model. A final tap can still miss its deadline: the server uses receive time, not forgeable client timestamps. Show countdowns against synchronized server deadlines and a send-early cue in the final second; do not silently grant high-RTT clients unlimited grace.

Current `web/src/center/ws.ts` consumes state broadcasts after accepted moves and handles snapshots/gaps; the old skill reference about requesting a snapshot after every ack is superseded by the current source. Practice attempts a poll every 100 ms but allows only one poll/action in flight, suppresses polling while the document is hidden, and advances its engine on requests. At 300 ms RTT it cannot actually deliver 10 polls per second, and a hidden tab has no autonomous practice scheduler. Measure that path separately from room WebSockets; live room auto-resolution must run with no connected clients. Do not apply nonarena disk-write estimates to the optimized arena action path.

## Current template inventory

Classification is about the **implemented action model**, not whether a stage is drawn in 3D. “Tolerant” does not certify deadline enforcement, fairness or UI readiness. Schema ranges below come from `center/schema.py`, `center/rules_late.py`; reducers are in `center/games/`. Recommendations describe future placement after readiness checks, not availability mutations in this round.

| Template / actual variant | Timing/action budget in current code | Classification and material caveat | Recommended placement |
| --- | --- | --- | --- |
| `number-hunt` | 15–600 s round; 300–2000 ms per-player guess cooldown, default 500; 1–50 guesses | **LATENCY-TOLERANT** discrete guesses. A 300 ms ack still permits deliberation. `first-hit` and target claiming favor lower arrival latency; `split-at-end` does not automatically erase contention over claimed targets | Prominent anchor; default a comfortable duration/cooldown; disclose first-hit semantics |
| `live-quiz` | 10–60 s/question; 5–30 configured questions | **LATENCY-TOLERANT** answers. Prefer accuracy; optional speed bonus uses server arrival and favors faster networks. Runtime generic 120 s deadline can truncate long quizzes | Prominent after deadline/content/fullscreen QA |
| `memory-match` | Solo; 30–180 s; 10–200 move cap; two sequential flips per pair | **LATENCY-TOLERANT** puzzle, but waiting for each ack feels slow. Show local pending flips without revealing unknown card faces. Prefer moves to elapsed-time scoring | Prominent after polished 3D stage and practice |
| `token-catch`, legacy nonarena lanes | Spawn 1–8/s; catch window 250–2000 ms (default 1000); catch rate minimum 60 ms; 15–600 s round | **LATENCY-SENSITIVE** timer arcade. No continuous world movement, but spawn receipt→reaction→request must fit a narrow catch window; “server tick” alone is not enough | More games / experimental legacy; not a focus |
| `token-catch`, arena V2 / field V3 / terrain V4 | Continuous movement; configured up to 30 Hz authority, 10 Hz broadcasts; loot, bombs, punch and gun distance/cooldowns; wizard/practice default V4 | **LATENCY-SENSITIVE** contested real-time movement. ~300 ms confirmation and aged remote actors affect pickups and hits | Owner hides open-world entry; preserve all versions and Three/Babylon routes |
| `reaction-duel` | 5–20 s choice(default 10), 3–10 s reveal(default 5); 3/5/7 subround cap | **LATENCY-TOLERANT** sealed choice; current manual reveal loses otherwise valid choices. Current second commit opens reveal early; replace with fixed close | Prominent after server auto-reveal |
| `rps-duel` | Similar windows; odd 3–11 subrounds | **LATENCY-TOLERANT** duplicate concept. Reducer accepts cleartext choice+salt during commit despite its docstring; different timeout/eligibility semantics | More games as compatibility route; one visible RPS product, no second promotional tile |
| `combat-duel`, V2/V3/V4 | Continuous body movement/attack, 300–1000 ms attack cooldown(default 500), 300–1500 ms combo window(default 800), 15–600 s | **LATENCY-SENSITIVE** aiming, melee, evasion and combinations | Hide from prominent catalog alongside movement worlds; owner controls availability |
| `boss-raid`, legacy `arena_mode=false` |60–600 s; 300–2000 ms strike cooldown(default 500); server contribution | **LATENCY-TOLERANT** repeated click/tick raid, though an ack-dependent 500 ms UI can advantage RTT. Current legacy lacks a rich decision loop | More games; do not advertise current V4 raid as this tolerant version |
| `boss-raid`, arena V2/field V3/terrain V4 | Continuous movement/dodging/shooting; 30 Hz/10 Hz; wizard/practice V4 | **LATENCY-SENSITIVE** movement and damage contention | Owner hides movement world; preserve team receipts/settings |
| `puzzle-sprint` |Solo; 3×3/4×4 sliding board; 60–300 s; 10–1000 move cap | **LATENCY-TOLERANT** legal discrete moves. One ack per move still penalizes fast solvers; prefer moves scoring and one pending move at a time | Prominent or first More-games row after stage QA |
| `hash-hunt` |30–300 s; proof nonce checks, 8–32 bits; first-valid /best-effort | **LATENCY-TOLERANT** server-arbitrated proof submissions, but first-valid rewards arrival and computing hardware. Not a casual phone skill game | More games, clearly bot/agent oriented |
| `reward-grid` |30–600 s; 9–100 tiles; 1–20 reveals/wallet; private hidden slot proof | **LATENCY-TOLERANT** capped tile reveals. Chance-heavy and currently described as demo points | More games, preview-only until objective/reward review |
| `logo-bingo` |Calls every 2–8 s; 60–600 s; 3×3/4×4 | **LATENCY-TOLERANT** shared slow draws; first-claim still favors network arrival. At 2 s a433 ms resolution delay is noticeable | More games, promote later if claim fairness is resolved |
| `pattern-recall` |Solo; input-window field 2–10 s(default 5), 3–12 symbols, finite growing sequence | **LATENCY-TOLERANT** whole-sequence submission. Current reducer does **not** enforce the configured input window; visible sequence remains public, so this is not a proved memory challenge yet | More games; fix semantics before promotion |
| `typing-sprint` |30–120 s; server key events, 15 ms minimum inter-key, 2000-key cap | **LATENCY-TOLERANT** local typing plus server arbitration in concept, **network-jitter-sensitive in current validation**: batched arrival can trip 15 ms rejection; paid results need stronger verification than accepted key counts | More games, readiness block for phone/funded promotion |
| `maze-race` |10–30 grid; 60–600 s; server checks adjacent cell/link moves | **LATENCY-TOLERANT** discrete tile movement, not free 3D locomotion. One ack/cell and first-finish can heavily favor low RTT | More games; no twitch rework |
| `level-runner` |30–120 s; client `step` chooses next lane; 100–100000 step cap | **LATENCY-SENSITIVE** intended runner. Current reducer advances per accepted request, without a fixed authoritative step clock/rate bound; this is also an integrity gap | Hidden/coming-soon; stop promotion |
| `contract-detective` |10–60 s declared/question; 60–600 s round; curated snippets | **LATENCY-TOLERANT** quiz model. Audit actual question deadline behavior and small question bank; educational, not a security verdict | More games for technical community |
| `mev-rush` |Opportunity every 2–15 s; 60–300 s; simulated queue capture | **LATENCY-TOLERANT** discrete simulation, with race-sensitive capture timing/bot incentives; no real mempool | More games, niche simulation |
| `idle-rig` |120–3600 s session; server-clock accrual/upgrades | **LATENCY-TOLERANT** progression. Current tick floors short elapsed deltas and compares epoch `now` to relative session seconds; generic room 120 s fallback mismatches it | Keep hidden/coming-soon until clock correctness is fixed; no passive-income claims |
| `airdrop-quest` |Wallet-bound actions/achievements; campaign start/stop; no movement requirement | **LATENCY-TOLERANT** objectives. An engine `complete` action is not proof of an external achievement; event provenance needs validation | Utility/More games, not an arcade flagship |

These gaps are recorded for prioritization; no existing reducer is repaired during planning. There are 20 registered template IDs, with multiple additional arena reducers selected by `engine_for`. Do not replace an engine's historical rules to make a catalog label look better.

## Discovery and release order

Current `FEATURED_GAMES` contains Number Hunt, Boss Raid, Token Catch, Arena Duel and Reaction Duel. `GameCenterHome` labels **all nonfeatured API templates** “coming soon,” filters public rooms to featured IDs, and the create wizard likewise filters on `isFeaturedGame`. Several hidden templates already have reducers/stages; “coming soon” is currently a merchandising gate, not proof no engine exists.

BUILD should introduce explicit presentation placement (`featured`, `more`, `coming-soon`, `hidden`) independent of server `playStatus` (`live`, `maintenance`, `offline`). One catalog must drive home, create, room filters, practice and deep links. `offline` today pauses new rooms/admissions but leaves a visible tile; it is not a true hide switch. Preserve access to existing room results and claims after hiding. `center/admin_games.py` currently restricts managed game IDs to the five featured games; expand it deliberately for released new games. This round does not change admin settings.

Priority:

1. Fix RPS automatic resolution and shared immersion, establish a polished Number Hunt/RPS visual baseline.
2. Release Closest Call and Word Forge first; then Prism Lines, Atlas Quest and Relic Auction. All five are required for BUILD completion, with separate reviewable slices.
3. Promote Live Quiz/Memory Match/Puzzle Sprint when their runtime deadlines, stages, practice and end-to-end reward paths meet the same bar. Do not call an unfinished stage “available” merely because its reducer passes tests.
4. Keep niche/duplicate content in More games. Keep broken clock/runner templates in coming-soon/hidden. Maintaining routes/receipts is useful; maintaining twenty prominent half-finished cards is dead weight that splits room populations and QA effort.

Repeated-use predictions are hypotheses: short phone sessions, friend rematches, familiar rules and transparent score/reward states fit the reported audience. There is no retention/category analytics in this review. Later measure practice→room conversion, completion, rematch rate, deadline misses and reconnect frequency per game and network band; use those results to reorder the catalog, without fabricating active-player counts.

## Hosting/loading mitigations for later

| Mitigation | Concrete next action | Limits |
| --- | --- | --- |
| Asset CDN | Evaluate Railway's optional caching or a static CDN for content-hashed JS/CSS/GLB/WebP/textures. Use long immutable cache headers for hashed assets; revalidate HTML/manifest; exclude authenticated API, room snapshots and claims | Faster cold load and less origin traffic; no reduction of authoritative round RTT by itself. Do not cache personalized state |
| Closer authority | Measure Indian mobile routing to candidate regions, including Railway Singapore. Start with relocating a single authoritative service+volume if justified | [Region availability](https://docs.railway.com/deployments/regions) does not promise an RTT. SQLite and in-memory rooms cannot become globally writable just by adding replicas |
| Regional rooms | Later consider region-pinned room ownership, sticky reconnects and a durable/shared coordinator before multiregion authorities | Requires state/settlement ownership design; avoid split-brain payouts and cross-region writes per action |
| Selected-game preload | Prefetch only selected stage, character/outfit and small content pack while reading instructions/lobby; warm shaders before timed play; bound concurrency and cancel unused loads | Do not preload Babylon/Havok or all five worlds on home; progress must report real bytes or named stages |
| Compact assets | Original/CC0 atlases, Meshopt where already supported, optional KTX2 only after verified decoder integration; Fast keeps core silhouettes and contrast | Fewer bytes/pixels is not automatically better art; review phones |
| Clock/transport | Timestamp server frames, estimate offset using measured RTT, reject stale phase actions, reconnect to current state; keep local animation independent of network acknowledgement | Do not trust client scores/timestamps or introduce retroactive reveals; long disconnects can still lose a round |

## Measurement and acceptance plan

Use a real Indian Android phone on mobile data and Wi-Fi, a desktop control, and reproducible browser/network profiles:150/300/600 ms RTT, 50/100 ms jitter, 1% loss and 2–5 s drops. Record actual geography, device/browser/GPU, cold/warm state and whether latency injection is additive. A container curl result cannot stand in for this audience.

Record p50/p95 WebSocket ping RTT (existing 15 s heartbeat needs timestamp/echo instrumentation), action→ack and action→public update, deadline→resolution, missed deadlines, scene-ready time/bytes, frame intervals, server tick slip/processing and reconnect recovery. Measure practice polling separately. Load-test active rooms against the single worker and SQLite. Avoid logging secrets during rounds.

Proposed BUILD targets, not measured claims: local input feedback≤50 ms p95; at 300 ms RTT, normal action confirmation≤600 ms p95 and deadline display≤750 ms p95 under the reference load; no stall waiting for animation; deterministic server result at logical deadlines; stable 30 FPS phone fallback. At 600 ms RTT the game must stay understandable and finish automatically, with honest pending/reconnect labels. Sealed games must rank identical accepted choices equally regardless of arrival within the window. Document target failures instead of moving the thresholds after testing.
