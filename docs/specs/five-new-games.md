# Five new Orbix games — 2026-10-10

Status: complete design proposal for BUILD, **not implemented**. Exactly five new template IDs, each with a new authoritative Engine, bounded Rules schema, stage and registry entry. Use the existing Python room/reward platform and Three.js/R3F presentation; do not fork the center or migrate services. See [portfolio](game-portfolio-strategy.md), [immersion](fullscreen-immersion.md), [characters](character-art-upgrade.md).

## Selection

| Game / template ID | Unique category | Reason to select |
| --- | --- | --- |
| Closest Call / `closest-call` | Estimation / closest guess | Familiar number input; broad appeal without specialist knowledge; natural first extension from Number Hunt |
| Word Forge / `word-forge` | Word building / language puzzle | Deliberation and mastery, works solo or with friends; a different cognitive task from finding a number |
| Prism Lines / `prism-lines` | Tile / board strategy | Familiar four-in-a-row with short strategic turns; strong two-player rematch loop |
| Relic Auction / `relic-auction` | Sealed auction / budget strategy | Reads well for a token-aware community, but uses virtual credits and invented relics rather than live assets or external markets |
| Atlas Quest / `atlas-quest` | Geography / map placement | Directly interactable map/globe; visual learning and new places support repeat play |

These categories are a reasoned audience hypothesis based on casual mobile sessions and friend rooms, **not measured popularity**. Live Quiz/Contract Detective already cover trivia; Memory Match/Pattern Recall cover memory. Another version of either would add catalog quantity without a new loop. Drawing/Pictionary adds moderation, input streaming, secret-word collaboration and device asymmetry. Opinion/prediction games need an unambiguous resolution oracle and collusion controls. Social deduction needs stable groups and chat. Rhythm/reaction wheels recreate timing/network concerns, while luck-heavy wheels poorly fit skill-based rewards. Keep those out of this BUILD.

## Shared implementation contract (mandatory for every game)

### Authority and lifecycle

Subclass `center.games.base.Engine`. Implement `start(now)`, `tick(now)`, `act(who, action, now)`, `public_state()`, `scores()`, `ranking()`, `eligible()`, `snapshot()` and `_load()`. Reuse `ActionResult`, per-viewer `private_state(who)` where needed, `StreamRNG`, `commit_hash`, default `Engine.entitlements()` and `RoomRuntime.finish`. A stage sends intentions, never a score, position-based reward, entitlement or payout amount. All 5 games are **LATENCY-TOLERANT**: no walk/aim/combat input, no per-frame network traffic and no timestamp/speed scoring.

For the four simultaneous-round games, define selection then result phases: every selection opens for the full configured window, all accepted submissions remain sealed until the fixed close, and the result phase lasts `result_seconds`. Logical boundaries are derived from server start time, not late tick delivery. Do not end selection early when everyone responds. `duration_seconds = rounds × (selection_seconds + result_seconds)`, validated and frozen in Rules; the wizard computes it and shows the total instead of offering a conflicting round-length field. Engine can finish after the last result phase, then the platform settles. Prism Lines uses its turn budget described below.

All rule numbers below are strict integers (reject booleans/floats), except declared booleans; strings/enums/arrays are bounded, `extra='forbid'` through `Strict`. Default rule values are shown below. Each has `templateId` literal equal to its ID; `RoomConfig.template_version=1` for these new immutable semantics. No `world_version` or `arena_mode` needed. `RoomConfig` admission, visibility, access, timing, entry, rewards, branding, waitlist and community contracts remain shared.

Every action names `roundId` and phase identifier (`challengeIndex`, `auctionIndex` or `turnIndex`), includes an `actionId`, and is authenticated to an admitted participant. A submission is accepted only during `[phaseStartedAt, phaseDeadline)` by server receipt time. Advance elapsed phase transitions before handling an action, reject stale/out-of-turn packets, never transplant a queued submission into a later phase. Match/phase IDs must be sent by every stage/practice bot. Identical retries reuse a durable receipt with no second score/budget decrement; conflicting final submissions reject. Keep local drafts separate from accepted choices. Timed result transitions also need idempotent durable records so that a rejected late action does not suppress a legitimate clock update.

Exact action payloads use the existing room action envelope: common fields `kind`, `actionId`, `roundId`, plus `challengeIndex` for `estimate` (`value`), `word` (`text`) and `pin` (`col`, `row`); `turnIndex` for `drop` (`column`); `auctionIndex` for `bid` (`amount`). `hint` includes the current phase index and the registered `hintKind`. Validate the corresponding action shape in the engine and reject unknown gameplay fields, including client scores or timestamps. The shared transport remains unchanged in purpose.

At close, missing submission contributes zero (a pass for auction, timeout policy for board); never substitute an RNG guess for an absent player. A disconnected player can reconnect to current phase, own accepted submission and published history. An accepted submission completes with **no further client action**. During detected full-window server outages, use explicit platform recovery/cancellation rather than creating unearned winners. The RPS spec describes the same outage/deadline discipline.

### Determinism, content and information boundaries

Use a frozen normalized/sorted participant roster and server seed. Derive documented `StreamRNG` domains by template/version/challenge index for puzzles/content and a separate domain for tie priority. Precompute the whole challenge deck at start and snapshot it, or persist exact stream state; `_load` must not silently draw again with the default RNG counter. Never use Python ambient `random`, `secrets` after start, `Date.now()`, locale sorting or floats to determine winners. Cosmetic randomness is separate and cannot affect rules.

For content-based games, `pack_id` (allowlisted ASCII ID≤60 characters) and `pack_sha256` (64 lowercase hex characters) identify an immutable server pack. Validate the actual bytes/canonical pack digest **before publish/start**, store the hash in Rules/config commitment and store selected records in the private snapshot. Use allowlisted server files, never creator URLs or a live API. Publishing resolves the built-in default hash server-side; it must never leave an `auto`/blank digest in a frozen config. Existing rooms can restore the stored content if a newer default pack is released. A missing incompatible pack cannot change a match; fail into recovery. Versioned dictionaries/content packs and seed/deck proof after settlement support replay without exposing future content during play.

`public_state`: template/version, roundId, phase/index, server time/deadline, current challenge's allowed visual/public data, submission booleans, **past resolved** scores/history and finished. `private_state(who)`: own accepted submission, own hint receipts/budget and own private inventory only when specified. Public config/room templates must not ship hidden answer fields, selected future records, sealed words/estimates/bids or hint receipts. `RoomConfig.public_dict()` currently redacts only quiz answer indices: extend typed redaction and test all outward routes for these games. Do not send a full private snapshot to Canvas. `hidePlayers` masking is presentation privacy and is not secret-answer protection.

The existing session-ready and reconnect snapshot APIs merge `private_state(who)`. Extend client private ack handling deliberately: current `ws.ts` does not generically merge all `ActionResult.private` fields. Own receipts must survive reconnect; broadcasts must stay public. Archive revealed submissions only after their phase closes. Future answers/seed remain private until match end, including owner/admin observation in reward-bearing play. Hosts select approved packs/difficulty; they cannot edit answer keys for these new games.

Curated answer/dictionary packs are not anti-bot guarantees: players can use outside tools, count rendered objects or memorize content. Server arbitration rejects forged results, but cannot prove a human supplied an answer. Default releases are preview points with no token entry; retain bot-policy disclosure and existing funding gates. Funded support is an integration capability, not a claim that casual skill fairness is audited.

### Scoring, ties, hints and settlement

All arithmetic determining scores is integer. No points for inactivity. Except Prism Lines, rank by total score descending then a seed-derived permutation of the frozen roster (`tie_order`), revealed with the final result and committed/replayable from seed+roster. Explain “Equal scores use the round's seeded tie order” before play. This permits existing one-recipient reward slots without inventing a shared-prize protocol; it adds bounded chance on ties and must be disclosed. No address ordering or fastest submission as a reward tie-break. An objective-qualified participant may receive lower configured rank slots; the highest eligible score wins rank 1. Prism Lines has only a unique winner; draws pay nobody. `eligible()` must be explicit so base Engine's default all-participants eligibility cannot pay idle users.

Each rules schema declares `hints: 'off'|'on'` (default `on`) and its bounded `hint_budget` below. Register a `HintPolicy(version=1, implemented=True)` with the listed ID/audience/default budget/cost. The engine enforces configured budget, not just the registry display value. Off rejects `HINTS_OFF`; exhausted rejects `HINT_BUDGET_EXHAUSTED`. All budgets are **per player per entire match**, preserved in snapshot; at most one accepted hint per challenge/turn/auction. Duplicate hint requests use the original private receipt and do not spend again. Hints are accepted only in the current open input phase, do not extend it and do not authorize a second submission. Share only a public “hint used” status where appropriate, never the hint payload. Host freeform timed hints must be disabled for these ranked new-game rounds: that schedule is excluded from the current config hash and bypasses the bounded policy. Keep ordinary chat/mute rules separate.

Do not assume the hint registry is already hashed: `config_hash_input()` serializes RoomConfig, not registry data. Frozen template version 1 must map to immutable policy 1 and tested reducer 1. Rules budgets/cost constants and pack hashes are committed. A future policy semantic change requires a new template version/pinned implementation (or a compatible explicit policy version field); preserve existing config hashes/receipts.

All scores/results flow through shared room lifecycle, result rows, eligibility-filtered `Engine.entitlements`, settlement Merkle allocation, reward release/forms and wallet claims. Default preview rewards use existing `Rewards`/slot schema; solo rules offer one slot and multiplayer slot ranks cannot exceed the configured cap. Show score→settlement pending→claim available→signature→submitted→receipt-confirmed as separate states. Practice uses no entitlement/ledger/entry writes. Drop rewards retain their existing nonmatch distribution semantics; do not display a funded-drop claim as a match victory.

### Shared tests and wiring

For **each** engine add `center/tests/test_<module>.py` plus `test_<module>_hints.py`. Parameterize shared coverage for strict rule bounds, unknown fields, invalid/nonparticipant/stale/duplicate/conflicting actions, exact deadlines, idle/disconnect, repeated ticks, complete match, deterministic replay, snapshot/restore in every phase, secret-free public state/config/fairness/socket routes, private reconnect, and eligible rank/entitlement allocation. Assert equality of uninterrupted and restarted final scores/rank/entitlements/transcript. Fake clocks and small known seed vectors must test rules, not mirror each source function. No client score is trusted.

Required registry changes in BUILD:

| Integration | Existing seam / required change |
| --- | --- |
| Rules | Add 5 `Strict` models to `center/schema.py` (a focused `center/rules_portfolio.py` may hold them), `TEMPLATE_RULES`, discriminated `RulesUnion` and cross-field/admission validators; round-trip aliases through `normalise_keys` |
| Reducers | Register 5 classes in `center/games/__init__.py:ENGINES`; `engine_for` should naturally select them without arena branches |
| Hints | Add 5 immutable policies in `center/games/hints.py`, with exact budgets/audiences below; test every registered engine has a deliberate policy |
| Catalog/API | Add `TEMPLATE_META`, rules-schema API and meaningful version reporting; put only ready games in placement from the portfolio spec; expand `admin_games.GAME_IDS` and admin UI so each released ID can be paused |
| Creation/rematch | Add defaults, supported rule fields and validation in `CenterApp.tsx`, `wizardForms.tsx`, `RematchSettings.tsx`; preserve pack hash/hint settings and actual duration on drafts/rematches; 2-player admission for Prism Lines, 1–20 for stated casual games, 2–8 for auction |
| UI routes | Add each named stage to `stages.tsx:STAGES` and the featured-play registry currently called `FOUR_STAGE_VIEWS`; either rename it consistently or extend it. Existing `GameId`/`WorldGame` unions must support new stage scenes or use dedicated scene components; do not force them through a world-movement renderer |
| Discovery/art | Add ready entries to shared catalog, category filters, room discovery and create selection; `center-art/<templateId>.webp` plus original SVG fallback in `bannerArt.tsx`/`gameArt.tsx`. Cards must show real release/availability, not generic “world preview” or fake rooms |
| Practice | Extend `center/practice.py:RULES`, bounded simulations and true deadlines; extend `PracticeArena`'s stage resolver beyond its current featured-only map. New games can practice anonymously; multiplayer practice uses scripted seed-driven bots that never inspect sealed choices |
| Durability/fairness | Fix nonarena restarted transcript sourcing (currently in-memory `actions_seen`) using round-scoped durable accepted log and timed transitions, as specified for RPS. New reducer snapshots alone do not make a replay receipt correct |
| Results/rewards | Use current placement/celebration/reward release/funded claim flows with explicit objective eligibility. Update result/tie presentation to seeded priorities; do not create new money paths or auto-whitelist contracts |
| Profiles/immersion | Fetch/display room appearances for seated players across 5 stages; apply shared immersion and minimize; original/CC0 materials/outfits from character spec |

A new template is not delivered until create→join→lobby→start→input/hints→automatic result→settlement→claim/form where applicable→rematch works, with reconnect and practice. Existing room access/entry/creator funding costs remain controlled by shared configuration, not per-game special fees. Any on-chain template allowlist/authority registration needed for funded use must be checked in BUILD; a Python registry entry alone does not authorize a funded template. No deployment/chain transaction in this planning round.

## 1. Closest Call

**Pitch.** Enter a colourful curiosity museum and estimate the contents of a glass jar, the height of a miniature tower or a quantity in an original visual scene. Everyone seals one integer estimate; at the close the exhibit counts out its answer and each player's distance becomes a score. The common range/unit makes the task readable on phones. Repeat appeal comes from improving estimation, varied seed-generated displays and comparing friendly near misses rather than racing to the server.

**Rules — `ClosestCallRules`; module `center/games/closest_call.py:ClosestCallEngine`.**

| Field | Default / bounds / invariant |
| --- | --- |
| `rounds` |5; 3–10; pack must supply at least this many distinct challenges |
| `selection_seconds` |20; 15–40 |
| `result_seconds` |3; 3–6 |
| `duration_seconds` |115; must equal rounds×(selection+result), 15–600 |
| `pack_id`, `pack_sha256` |Allowlisted `closest-museum-v1`, resolved/frozen digest; original verified exhibits only |
| `hint_budget` |2; 1–2 with hints on; budget ignored when hints off |
| `max_players` |20; 1–20; admission cap≤this, min-ready≤cap; solo supported |

Pack records: unique `id`, prompt≤200 characters, `unit`≤20, `lower`/`upper` strict integers with `0<=lower<upper<=10000`, hidden integer `answer` within range, allowlisted `scene_kind` (`jar-count`, `tower-count`, `scale-estimate`), immutable display parameters and a reference marker unrelated to the answer. Start deterministically chooses distinct records and scene layouts; visual quantity and answer must agree in pack validation. Do not ship `answer` or future display data in the client bundle. Visible count geometry is inherently inspectable; that is the visual puzzle, not a promised secret against bots.

Action `estimate(value, challengeIndex)` accepts one range-valid integer/player/challenge; identical retry returns receipt, changed value rejects. At close `error=abs(value-answer)`, `span=upper-lower`; `roundScore=max(0,1000-floor(1000*error/span))`. Missing estimate scores 0. Totals are sum of round scores; no speed bonus. Eligible if at least one accepted estimate has `5*error<=span` (within 20% of the displayed range); all qualifying players rank by total and seeded tie order. Rank 1 is the match winner; no qualified estimates means no match allocations.

Hint `scale-reference`: private; 2/player/match, 0 cost. Repeats the already-public range/unit and scales a **fixed, answer-independent** reference prop (e.g. a marked unit ruler). Never returns answer, direction-to-answer, error from a draft, a target-dependent scale or another estimate. The hint cannot be an answer oracle; a pre-close estimate never yields accuracy feedback. Tests vary target while keeping public reference constant.

**Stage `ClosestCallStage.tsx` / `ClosestCallScene.tsx`.** Museum palette mango `#FFB543`, teal `#28C7B7`, cobalt `#4168E8`, cream `#FFF3D5`. Central jar/tower on a felt pedestal, orbiting seated mascots and a legible DOM number pad/range slider. Rotate/zoom the exhibit locally with bounded drag; all available views are equal for all players. Submission seals a ticket; at outcome miniature objects arrange into countable rows, ruler expands and distance rings appear. Animation cannot change the scoring quantity. Original ceramic/glass/wood/felt textures; no camera movement required to submit. WebGL fallback shows the same original diagram/parameters and semantic estimate input.

**Specific tests/wiring.** Score at exact/boundary/just-over-threshold, integer division and zero/span extremes; no accuracy leak before close; scene/answer consistency for every pack record; repeated hint independence; best score ties independent of action order. Catalog category “Estimation”; wizard offers rounds/window/pack/hints, no editable target. Rewards use common ranked slots and the explicit 20% eligibility objective. Practice uses seeded exhibits and estimates, no bots needed for solo; results explain error and range normalization.

## 2. Word Forge

**Pitch.** Build one strong word from glowing letter tiles on a tiny workshop table. Players arrange a shared rack, choose when to lock their word, then watch letters click into a brass word machine at the deadline. Longer valid words and rare letters earn points. Replays provide solvable new racks and personal word discovery; asynchronous input avoids penalizing slower networks. V1 is explicitly English/Latin alphabet; do not pretend it covers every language spoken by the audience.

**Rules — `WordForgeRules`; module `center/games/word_forge.py:WordForgeEngine`.**

| Field | Default / bounds / invariant |
| --- | --- |
| `rounds` |3; 3–6 |
| `rack_size` |8; 7–9 |
| `selection_seconds` |40; 30–60 |
| `result_seconds` |4; 3–6 |
| `duration_seconds` |132; rounds×(selection+result),≤600 |
| `pack_id`, `pack_sha256` |Allowlisted original/CC0 `word-workshop-en-v1`; freezes dictionary and valid rack generator; pack has enough distinct racks of chosen size |
| `hint_budget` |1; literal 1; off rejects |
| `max_players` |20; 1–20; solo supported |

Pack includes a normalized curated dictionary and solvable rack bank; every rack must admit at least one 3+letter dictionary word. Generate/select seeded distinct racks; the same rack is public for all players. Accepted alphabet is ASCII `a–z`, canonicalize A–Z to lowercase and strip outer ASCII spaces; reject other characters/inner spaces/Unicode lookalikes. No stemming/proper nouns/abbreviations unless explicitly in the frozen dictionary. Frozen pack publication rejects duplicate normalized entries and excessive sizes (dictionary≤100000 words, each 3–9 characters; rack bank≤10000 entries).

Action `word(text, challengeIndex)` accepts one final string 3–rack_size using no letter more often than in the rack. Unknown dictionary words with valid shape/tile counts are **locked and score 0 at close**, not rejected immediately: otherwise repeated guesses become a dictionary oracle. UI can supply a public dictionary/help if desired, but never a hidden best-answer lookup. Malformed/repeated-tile words reject before locking because the rack constraints are public. Letter rearrangement and draft editing stay local.

Valid `roundScore=100*length^2 + 25*countOf(q,z,j,x)` in the word; invalid/missing=0. No submission-time or typing-rate bonus. Total is sum. Eligible if at least one valid word, then rank by total/seeded tie order. Publish all submitted words/validity only at close, without future racks or dictionary-derived optimal words before play. V1 does not award extra points for originality or other players' failure.

Hint `rack-sort`: private; 1/player/match, 0 cost; returns an alphabetical ordering/count summary of the **already-public** rack. No candidate word, optimal score, hidden dictionary membership or other player's draft. This is a readability aid, not a solver. Reject additional hints even under reconnect.

**Stage `WordForgeStage.tsx` / `WordForgeScene.tsx`.** Blue-violet `#6758DC`, ember `#FF8748`, gold `#FFD36A`, cream `#FFF8E6`. Chunky enamel alphabet blocks, textured oak tray, brass machine and idle tinkerer mascots. Each letter is mirrored as a semantic DOM tile; tap/drag/keyboard add/remove tiles without server round trips. Lock sends one word. Outcome animates only the published string, machine stamps score/invalid, confetti is bounded. Preserve readable text over decoration; no tiny canvas-only letters. Reduced-motion version uses static rearrangement and score stamp.

**Specific tests/wiring.** Duplicate letters, case/space normalization, ASCII rejection, pack solvability, unknown-word locked zero, empty/no choice, rare-letter bonus, deterministic rack deck and no opponent word in own receipt. Catalog “Word puzzle”; wizard binds English pack/rack size/rounds/time, labels language. Ranked rewards use valid-word eligibility; practice solo shares the same engine and frozen pack. Content provenance is required before release: author a modest dictionary/rack set or use a verified CC0 source, do not scrape a proprietary dictionary.

## 3. Prism Lines

**Pitch.** Two players sit across a luminous tabletop garden and drop coloured crystal pieces into columns, aiming to connect four before their rival. The pieces tumble and settle locally after a valid server move; each turn gives time to think. Familiar rules, visible tactics, a fresh seeded starting-seat draw on rematch and short two-player sessions make this the portfolio's strategy game.

**Rules — `PrismLinesRules`; module `center/games/prism_lines.py:PrismLinesEngine`.**

| Field | Default / bounds / invariant |
| --- | --- |
| `rows`, `columns` |5 and 5; rows 5–6, columns 5–7 |
| `connect_length` |Literal 4 |
| `turn_seconds` |15; 10–20 |
| `result_seconds` |3; 3–6 |
| `timeout_streak_limit` |Literal 2 consecutive **own** missed turns |
| `duration_seconds` |378; equals rows×columns×turn_seconds+result_seconds,≤600 (reject combinations above limit) |
| `hint_budget` |2; 1–2; off rejects |
| `min_players`, `max_players` |Literal 2; admission cap/min-ready exactly 2 |

At start, an independent seeded seat draw sets first player and published turn 0. Board starts empty; gravity chooses the lowest empty row in a column. Action `drop(column, turnIndex)` must come from current player, at a valid integer column, before the deadline; full columns and noncurrent players reject with no turn consumption. One accepted move changes the board, resets that player's timeout streak, checks horizontal/vertical/both diagonal lines, then passes the turn. Valid moves start the next full turn at their server acceptance time; deadline timeouts start the next turn at the elapsed logical deadline.

Each timeout consumes one turn, changes no tile, increments that player's own timeout streak and passes to the opponent. Reaching 2 consecutive own missed turns ends by forfeit only if the opponent made at least one legal drop; if the opponent made none, end `no-contest` with no eligible winner. Hard cap is `rows*columns` total turns **including passes**; no win by then is a draw. A full board without a four-line is a draw. This bounds a both-idle game without auto-playing for them. An accepted winning move ends input immediately, preserves result display for `result_seconds`, then settles; room deadline remains an upper bound, not a reason to wait to show victory.

Scores winner 1/other 0; draw/no-contest all 0. Eligible only a unique line/forfeit winner with≥1 legal drop; no consolation match rewards, so wizard allows a rank 1 match slot only. Ranking puts winner first, otherwise uses stable seeded seat order for display only. Opponents can wait to use their whole turn but cannot extend the deadline or obtain a strategic move through automatic timeout.

Hint `legal-columns`: private; 2/player/match, 0 cost; returns columns not full in the current **public** board, only on the asker's turn. It must not calculate a winning drop, block recommendation, search tree or hidden future move. All board state is already public; these hints are accessibility help. No timing extension, score advantage or extra turn.

**Stage `PrismLinesStage.tsx` / `PrismLinesScene.tsx`.** Mint `#49DBBE`, plum `#7A4FD0`, coral `#FF7B72`, cream `#FFF6E1`. Translucent gems on an original terraced garden table, soft ceramic column rails, textured felt underside and seated matching-palette characters. Tilt the view locally, but keep all columns visible. Full-height DOM column buttons and a keyboard grid mirror board state; shape/pattern distinguishes players as well as colour. Pending drop is a ghost, not a placed piece; confirmed move falls≤350 ms without delaying next turn. Win highlights the 4 cells with one growing vine; no perspective trick can hide a valid cell.

**Specific tests/wiring.** All 4 line directions, edge/corner/overlapping lines, full columns, late turn messages, pass-count cap, streak reset, one/both idle, no-contest, no rewards on draw, restored deadlines and legal-column non-solving hint. Catalog “Board strategy”; exact 2-person admission and rank 1 rewards; practice bot sees only the public board, uses fixed seeded legal-move logic, never clock cheating. Rematch uses the usual new match/seed; do not write alternating-seat state that changes a frozen config secretly.

## 4. Relic Auction

**Pitch.** Join a bright travelling auction house with a fixed pouch of virtual bidding credits. Each relic has a public value and colour; everyone secretly bids once, the highest bidder buys it, and completing colour sets adds a bonus. Spend too much early and a rival can outbid you later. Short sealed auctions bring bluffing and budget strategy to a token-aware audience without real price feeds, transfers or a market-resolution oracle.

**Rules — `RelicAuctionRules`; module `center/games/relic_auction.py:RelicAuctionEngine`.**

| Field | Default / bounds / invariant |
| --- | --- |
| `rounds` |5; 3–8 |
| `selection_seconds` |20; 15–30 |
| `result_seconds` |4; 3–6 |
| `duration_seconds` |120; rounds×(selection+result),≤600 |
| `starting_credits` |100; 50–200 **virtual game credits**, equal for all |
| `set_bonus` |30; 10–40; committed before play |
| `hint_budget` |2; 1–2; off rejects |
| `min_players`, `max_players` |2 and 8; min literal 2, max 2–8; admission min-ready≥2, cap≤max |

No external pack required: at start `StreamRNG` creates `rounds` relics with integer value 12–40 and colour chosen from amber/jade/violet, plus original allowlisted prop kind determined independently of value. Every player's credits start equal. Current item value/colour and completed inventories/balances are public; future items remain private until their auctions. The fixed generation algorithm is template-version 1 and replayable. Use first-price rules only; no custom creator valuations or side payments.

Action `bid(amount, auctionIndex)` accepts one integer 0–current balance. Zero explicitly passes. A bid does not debit/credit anyone before close; only one current bid exists, so balance cannot be double-reserved. Missing bid equals pass. At close, highest **positive** bid wins and pays that exact amount; losers pay 0. With all passes, relic remains unsold. Equal positive bids use the published seeded seat order rotated by auction index; waiting until the last instant cannot improve priority. Expose all bids only after close; do not publicize a highest-so-far price or give a pre-close affordability hint about an opponent's bid.

Final `sets=min(amberCount,jadeCount,violetCount)`; `profit=sum(valuesWon)+set_bonus*sets+remainingCredits-starting_credits`. Score is this signed integer (can be negative); no payout promise attached to virtual credits. Eligibility:≥1 won item and profit>0. Rank by profit/seeded final tie order. Rank 1 highest qualifying profit wins, all unprofitable/pass-only players get no match allocation. No result-time decision or client price oracle. Relic values/colours make chance visible; it is budget strategy with a seeded item deck, not guaranteed positive earnings.

Hint `budget-ledger`: private; 2/player/match, 0 cost; recaps the asker's confirmed balance, prior spending and colour counts, plus the **public** set-bonus formula. No proposed bid, rival sealed bid, future item, hidden valuation or best-response calculation. Current balances were already public, so this cannot exploit a private oracle. A hint never reserves/spends credits.

**Stage `RelicAuctionStage.tsx` / `RelicAuctionScene.tsx`.** Saffron `#F4B743`, magenta `#D75BB4`, jade `#39C7A0`, midnight `#29355C`. Textile canopy, embroidered original banners, rotating pottery/relic pedestal, wooden bid paddles and seated characters. Drag only the relic for inspection; bid UI is a large DOM keypad/slider with balance and a prominent “Pass” action. Lock folds a sealed envelope; resolution opens envelopes together, gavel hits once and the winner's confirmed relic moves to their shelf. Credit spend animations follow the outcome, never optimistic wallet movement. Everywhere label credits “Game credits”; do not use the ORBIX token symbol or wallet balance.

**Specific tests/wiring.** Bounds/boolean bids, zero/missing passes, overspend rejected, tie rotation, first-price debit/loser unchanged, balance conservation, partial/full/repeated colour sets, signed profit, no reward for unprofitable/pass-only play, secret bids/reconnect and every seeded deck replay. Catalog “Auction strategy”; wizard shows virtual budget/set bonus/player cap. Same shared rewards schema with a separate prize panel; no per-auction ERC20 call. Practice requires at least one seeded bot with bids based on public item/balance/history, never the user's current sealed bid.

## 5. Atlas Quest

**Pitch.** Place one pin for a named place on a colourful original world map laid across a floating explorer's desk. When the timer closes, everyone's pin stays put, the answer marker rises and a dotted route shows each distance. A locally rotatable globe provides decoration while the flat map supplies consistent hit targets. Players return for learning, improving their mental map and friendly comparisons; no rapid navigation or location service is required.

**Rules — `AtlasQuestRules`; module `center/games/atlas_quest.py:AtlasQuestEngine`.**

| Field | Default / bounds / invariant |
| --- | --- |
| `rounds` |5; 3–10; distinct prompts available in selected pack |
| `selection_seconds` |25; 15–40 |
| `result_seconds` |4; 3–6 |
| `duration_seconds` |145; rounds×(selection+result),≤600 |
| `pack_id`, `pack_sha256` |Allowlisted original/verified `atlas-world-v1`, frozen digest; regions/difficulty are separate packs, never live feeds |
| `grid_columns`, `grid_rows` |Literal 36 and 18, equirectangular 10° bins |
| `hint_budget` |2; 1–2; at most 1/challenge; off rejects |
| `hint_score_penalty` |Literal 100 points for the hinted challenge |
| `max_players` |20; 1–20; solo supported |

Pack records: unique `id`, place prompt≤200 characters, source citation/provenance, hidden canonical `answer_col` 0–35/`answer_row` 0–17, and verified hemisphere flag. Answer coordinates are validated against the exact original map projection. Content authors derive bins from reviewed lon/lat: normalize longitude into `[-180,180)`, `col=floor((lon+180)/10)`; `row=min(17,floor((90-lat)/10))` with latitude `[-90,90]`. Resolve boundary/dateline cases offline to stored integer cells; no geographic floating-point math in the engine. Require sufficient distinct approachable prompts in each pack and review factual accuracy before release; avoid disputed-border scoring prompts in v1.

Action `pin(col,row,challengeIndex)` accepts exactly one integer grid cell. Pin can be drafted/repositioned locally until locked; accepted pin is immutable. At close `dx=min(abs(col-answer_col),36-abs(col-answer_col))`, `dy=abs(row-answer_row)`, `distance=dx+dy`; `roundScore=max(0,1000-40*distance-100*hintUsedForThisChallenge)`. Missing pin scores 0. This is a **grid-distance learning game**, not an accurate great-circle kilometre estimate; publish that rule and don't label dotted lines in fake km. Longitude wraps, latitude does not. Total sums scores. Eligible if≥1 accepted pin has distance≤5; rank by total/seeded tie order. Hint penalty affects score, not the distance qualification.

Hint `hemisphere`: private; 2/player/match, 1/challenge, 100 score cost as above; indicates the correct broad **map half** (northern rows 0–8 or southern 9–17). Each half contains 324 cells; no country border, continent name, row/column, proximity from a draft, exact pin or other player's answer. Test that the payload is identical across every answer cell within the same half and never selects a single remaining tile. Hint reuse cannot reveal additional coordinates. Post-result answer pins/explanations are allowed.

**Stage `AtlasQuestStage.tsx` / `AtlasQuestScene.tsx`.** Azure `#3BA9EE`, leaf `#8AD66B`, vermilion `#FF8460`, sand `#FFF1C9`. Original low-detail continent outlines with painted-paper texture, carved desk, small brass compass and globe, traveller characters wearing textured jackets/dresses. Flat map region fills the main stage; keyboard/touch grid, pan/zoom and reset control keep pin placement accessible. Optional 3D globe rotation is local and cannot alter the accepted flat-cell mapping. At reveal the answer marker rises, routes/score cards unfold and a short learning note appears. Canvas fallback uses the same original SVG map and DOM grid, no Mapbox/Google tiles or downloaded proprietary map art.

**Specific tests/wiring.** Dateline wrap, polar rows, bounds/booleans, distance/penalty clamp, exact/hinted/near pins, all-idle/no eligibility, pack projection vector checks, non-leaking hemisphere and no server score from client latitude. Catalog “Geography”; wizard chooses approved pack/rounds/windows/hints. Practice solo needs no geolocation or bot; mobile keyboard pin controls and hit-target mapping must match the renderer. All rewards use the declared distance qualification. Original map art + source citations for factual place coordinates satisfy the art restriction without assuming a third-party map license is CC0.

## Visual/runtime acceptance for all five

The game is the central board/exhibit/map, not a tiny canvas above a long form. Use Three.js lighting/materials with a distinct stage palette and tactile authored textures; share scene/lifecycle/animation primitives from `framework/` and existing Three code. Port only renderer-neutral concepts from merged Babylon work (state-driven animation, bounded feedback, cleanup), not Havok or a second renderer for static boards. Reuse shared profile/cosmetic actors without assigning them invisible movement obligations.

Local presses/drafts react≤50 ms target; confirmations/results use authoritative receipts. Limit concurrently pending actions and show retries; never repeat final submissions automatically into another phase. Mobile Fast tier targets 30 FPS, DPR≤1, retained silhouette/texture colours, bounded shadows/effects. Three scene loads lazily; choose demand rendering while still and invalidate during short animations. Proposed selected-stage+default actor asset budget≤1.5 MB compressed incremental payload, 3D-ready≤3 s warm/≤6 s cold on the reference network; measure and report rather than claiming these already pass. All five provide semantic DOM controls, WebGL fallback, reduced motion, mute, server-clock countdown, and persistent shared Minimize.

BUILD completion requires the shared tests, each game's specific vectors, center regressions, TypeScript/build, and focused real browser/device cases under 150/300/600 ms RTT and reconnect. Check catalog creation/practice/deep links, hint secrecy, restart transcripts, results/forms, mocked funded claims and no-practice-money behavior. Preserve current unrelated financial tests; no new game may pay an idle participant. Release one complete slice at a time for review, but deliver all 5 before calling the five-game BUILD finished.
