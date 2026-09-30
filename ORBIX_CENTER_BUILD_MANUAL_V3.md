# ORBIX CENTER — EXECUTABLE BUILD MANUAL

Version 3.0 — **SUPERSEDED by ORBIX_CENTER_BUILD_MANUAL_V4.md** (V4 adds the Unified Liquidity Vault deposit model, the 4-digit Number Hunt variant, full per-game detail for the whole catalog, Orbix-matched design tokens and the per-game interface/brainstorm sections). Kept for history only.

Version 3.0 · Product specification, engineering contract, design system, implementation tasks, and AI handoff

## 0. Read this first: scope and authority

This document replaces the Vibe Arcade v1/v2 product direction. Build **Orbix Center**, a creator platform inside the existing Orbix website—not a standalone guessing-game demo. The latest user request overrides earlier suggestions to launch the token immediately, accept real stakes before escrow, or create a separate brand/domain.

Requested deliverable for this turn: this build instruction manual. The platform described below is **not yet implemented**. No contract deployment, token launch, DNS change, or wallet transaction is authorized by the existence of this document alone.

The user referred to `orbix.fun`; the working project domain verified in the browser is `orbixcore.fun`. Ownership of `orbix.fun` is not established. Implement relative routes under the existing site, using a configurable canonical origin. Do not purchase or change domains. All paths below are **proposed implementation routes**, not claims that those pages already exist.

### Binding product decisions

1. Product name: **Orbix Center**. Keep the Orbix protocol's other modules intact.
2. Main navigation gets a Center item. The Center contains Catalog, Rooms, Create, Rewards, and My Studio.
3. A visitor chooses a game, configures a room, assigns rewards, publishes a branded invitation, and hosts people playing together.
4. Creators will eventually burn a required quantity of the user's platform token **per published game session**. The new token does not exist yet. Implement a **preview burn overlay**, not a fake payment and not a token deployment.
5. Games can reward ERC-20 tokens, ERC-721 NFTs, ERC-1155 items, or bundles, subject to explicit asset support and prefunding.
6. Public discovery, unlisted share links, and genuinely private invite-gated rooms are distinct modes.
7. Winner rewards use a wallet-bound entitlement: claim immediately via wallet transaction, or save a code and return to Rewards later.
8. Every shipped game must have a real engine and creator settings. A catalog of decorative cards is not completion.
9. Build premium mobile-first UI with coherent assets, state feedback, accessibility, and excellent room/reward journeys.
10. Work first in preview with no assets, then isolated Robinhood testnet 46630. Mainnet disabled until independent security and legal gates are satisfied.

### What “done” means

A user can select every release-one game, configure it, preview its rules, create a public or private room, share it, join from two different browser sessions, play a full round, receive an accurate result, and claim prefunded test assets through the verified contract. Preview burn access remains clearly marked simulated until the owner selects and launches the actual platform token. Every named acceptance test in this manual passes. Do not substitute screenshots, placeholders, a tutorial, or one functional game for that outcome.

## 1. Current implementation audit

Files inspected: the project Markdown documents listed in Appendix A, `web/package.json`, `arcade/server/main.py`, and `arcade/server/static/index.html`. The live main site and arcade were opened in a real browser.

### Verified current state

- Existing frontend: Vite, React, TypeScript, viem, injected/WalletConnect wallet integration. Preserve its DeFi pages.
- Main site serves the Orbix cockpit with the work-in-progress banner.
- Arcade backend is a FastAPI application; one Number Jackpot demo is served from inline HTML.
- Current demo room was displayed as WON, with no active players. There is no verified automatic fresh-round lifecycle.
- No Center-specific token/NFT escrow, creator burn gate, reward claims, private invitations, persistent studio, or full game catalog exists in the inspected arcade code.
- Existing Solidity deployments are separate protocol modules. They are NOT evidence that Center escrow or game contracts exist.

### Bugs and gaps to remove, not inherit

1. `pot` and `entry_fee` are Python floats, not funded balances. They must not be called paid rewards.
2. Client supplies an arbitrary address; no wallet ownership is proven. All browsers use `0xguest`.
3. Guess budget belongs to the WebSocket, so reconnecting can reset it.
4. Room expiry occurs only when a player sends a message. Quiet rooms do not reliably finish.
5. `new_room` allows loose dictionaries; invalid values can raise exceptions or become misleading configurations.
6. Rooms are in memory and are not reclaimed safely; the room cap eventually blocks creation.
7. Broadcast awaits sockets sequentially; one slow consumer can delay others.
8. Creator names and feed strings are inserted using `innerHTML`: stored XSS risk.
9. Higher/lower hints allow binary search. A jackpot balanced as pure random guessing would be economically wrong.
10. First hit closes the room; the UI's “split pot” language is inaccurate.
11. Room state can overwrite WON with EXPIRED after the deadline.
12. No escrow, entry confirmation, randomness commitment, durable event log, recovery, or claim replay protection exists.
13. Wildcard CORS and unrestricted room creation are not suitable for funded rooms.
14. “New round soon” is not backed by a scheduler.
15. Raw wallet/config data must not be silently logged or exported to telemetry.

### Correct the old plan's unsupported claims

- Builder Tier, BPS fee shares, and Campaign Vault details in v2 came from **Vybes.fun**, not verified vibe/vibe documentation. Different projects must never be conflated. Remove any guaranteed fee-share revenue or corresponding integration until the exact launchpad contracts and official sources establish it.
- Even a verified one-percent builder pool would not mean one percent goes to us: our share would depend on our actual BPS allocation and applicable trade rules.
- Testnet participation does not guarantee an airdrop. The rendered vibe/vibe agreement says test artifacts have no monetary value and recognition is discretionary if a future token exists.
- “No competing platform exists,” fixed per-player RAM estimates, unlimited traffic, and automatic zero lag were not demonstrated. Do not reuse them as facts.
- Server-signed winners mean trust in the result signer. Commit-reveal proves a seed was not changed after commitment; it does not alone prove honest scores or stop secret leakage, seed selection, censorship, or withheld reveals.
- Sending tokens to a dead address may lock them but does not necessarily decrease `totalSupply`. Label true burns and permanent locks separately.
- An “AI-generated asset” is not automatically free of licensing concerns. Record provenance and rights.
- Do not promote trial-account rotation to bypass provider limits. Legitimate host migration is supported; funded game state is never disposable.

## 2. Product map and user journeys

### Proposed routes

```
/center                         discovery hub
/center/games                   all available games and categories
/center/games/:templateId       game detail, rules, preview, create CTA
/center/rooms                   public room browser
/center/create                  new room wizard
/center/create/:draftId         resumable wizard
/center/rooms/:roomId           room lobby, active play, result tabs
/center/sites/:slug             creator storefront with approved rooms
/center/rewards                 wallet entitlements and paste-code lookup
/center/rewards/:claimRef       entitlement detail
/center/studio                  creator rooms, funding, analytics
/center/studio/:roomId          room operation and history
/center/fairness/:roundId       commitment, reveal, transcript, verifier
/center/help                    rules, fees, trust model, support
```

Use React Router in the current Vite application. Do not introduce a second Next.js application solely because a toolkit defaults to it. Share the existing wallet connector and network context. Unknown routes render an actual not-found view. Refreshing any deep route works through the production server's SPA fallback. API requests must never accidentally return index.html.

### Creator journey

Browse without connecting → choose template → preview gameplay → create draft → select room rules → preview token-burn gate → unlock preview editor → define admission, rewards, fairness and branding → save → review → publish preview OR fund/deploy testnet room → share link → open registration → monitor players → play/settle → view remaining assets and claims.

The preview gate can be shown early to communicate the business model, but the future real burn occurs only after the final config is frozen. Do not burn for a draft or charge repeatedly for a retry of the same publication intent.

### Player journey

Open invitation → read rules/reward funding/trust label → inspect asset contracts → join preview as guest OR authenticate wallet for funded room → confirm entry if required → lobby and ready → play → see provisional result → settlement status → claim wallet transaction or save receipt code → return later to Rewards.

Never open a wallet popup on page load. Browse and preview are wallet-free. For funded participation, require the isolated test wallet and chain 46630 before approval or transaction.

### Creator storefront

One storefront aggregates a creator's rooms, token identity, banner, schedule, and contact links. A creator is authenticated by wallet, not by claiming to own a token symbol. Show “uses token” unless token ownership/launch provenance is verifiably established. Slugs are unique, normalized, moderated, and reservable only by the creator. The platform hosts templates plus configs—not arbitrary creator JavaScript, HTML, or executable uploads.

## 3. Release scope and complete game catalog

**Release one: eight fully functional configurable templates.** Subsequent templates remain in the implementation backlog with honest availability states. “All games” means implement the full catalog in ordered releases, not deceptively mark all cards live.

All templates implement the same lifecycle, participant identity, result transcript, reward adapter, and creator schema. Engines are different; a shared shell does not replace engine-specific validation.

### G01 — Number Hunt

Modes: exact jackpot with no hints; deduction with higher/lower hints; multi-target hunt with unique winning slots. Defaults: range 111111–999999, 20 guesses, 60-second round, no hints, one target, first valid hit wins. Creator can set minimum 1, maximum 999999, guesses 1–50, duration 15–300 seconds, targets 1–20, cooldown 300–2000ms, hints off/on, first-hit/split-at-end, and rollover off/on.

- Show a segmented numeric input, recent guesses, remaining budget, randomize icon, and submit button.
- Randomize draws locally using browser cryptographic RNG and unbiased rejection sampling; it picks a suggestion, never submits automatically. It never reads server secrets.
- Multi-target mode assigns each unique target a reward slot. The creator chooses total reward allocation first; no slot pays more than its reserved asset inventory.
- One wallet claiming the same target twice receives a duplicate response, not another reward.
- First-hit mode settles on one hit. Split-at-end records eligible winners until the deadline; divide fungible slots with explicit remainder policy. NFT slots have one designated winner, never fractional NFTs.
- Deduction mode must warn that binary search is effective. Do not market it as a low-probability random jackpot.
- Tests: endpoints, out-of-range rejection, duplicate guess, two simultaneous hits, budget survives reconnect, exact deadline boundary, no-hit outcome, multiple targets, randomize never reveals winner.

### G02 — Live Quiz

Creator enters 5–30 questions with 2–6 choices, one correct answer, explanation, and 10–60 seconds per question. Modes: accuracy-first or accuracy plus speed bonus. Optional image, category, order randomization, shuffle choices, pass percentage, top-N rewards, fixed milestone reward.

- Require a draft review; import CSV/JSON using a documented schema with length limits and row errors.
- Server stores answer key privately. Player receives only the current question and public options; API/HTML must not embed answers early.
- Score: 100 points per correct answer; optional speed bonus 0–20 based on server receipt time with a declared fairness/latency policy. Accuracy outranks speed by default.
- Emit question open, answer acknowledged, question closed, explanation revealed, leaderboard update.
- Lock one answer per question. Rejoining never resets answers. Use server question deadlines.
- Custom quizzes are **creator-authored**, not externally verified facts. Sponsored reward quizzes require moderation and rules disclosure.
- Tests: late answer, duplicate answer, invalid choice, reconnect midway, tie policy, shuffled option mapping, answer leakage.

### G03 — Memory Match

Creator sets 6–18 pairs, 30–180 seconds, move cap 10–100, theme icons, accuracy/time scoring, and top-N or threshold rewards.

- Players flip server-indexed cards; accept at most two unresolved flips; mismatches close after a common 600ms animation.
- Server validates revealed indices, pairs, move count and time. The board map remains secret until reveal; browser reports events, not final score.
- Repeated authorized card views are remembered; never claim complete bot prevention for a memory game.
- Tests: double click, same card twice, matched-card reuse, timeout, score forged, board restored after reconnect.

### G04 — Token Catch

Creator sets duration 30–120 seconds, spawn frequency 1–8/second, lanes 3–5, fall-speed preset, hazard chance 0–20%, score threshold/top-N, and optional combo cap 1–5.

- Discrete lane controls with keyboard/touch; client renders at display frame rate, network transmits input changes up to 10Hz.
- Server derives spawn stream from a committed round seed and validates catch windows using bounded latency tolerance. Score submissions alone are rejected.
- Do not network every animation frame. No real token drops occur during play; settlement creates reward entitlements.
- Tests: teleport between lanes, impossible catch, skipped tick, time skew, slow network, mobile controls, same-seed replay.

### G05 — Reaction Duel

Two players or a bracket; 3/5/7 rounds; response window 2–10 seconds; random cue delay 1–5 seconds; best-of result. Early tap loses that subround. Default rewards: one prefunded winner slot.

- Display Ready → Wait → Go with visible and accessible cues; color is not the only signal.
- Use server delivery/receipt timestamps and track baseline RTT. Declare that network conditions affect results; do not promise objective human reaction measurement.
- If latency skew exceeds configured safe threshold, mark subround void and retry once, then cancel/refund per policy.
- Tests: pre-cue tap, simultaneous tap, disconnect, missing readiness, high RTT, replay message, tie.

### G06 — Puzzle Sprint

Sliding puzzle or sequence puzzle; board 3x3/4x4, duration 60–300 seconds, move cap, difficulty, top-N/first-finish/threshold.

- Shuffle using valid moves to guarantee solvability. Server checks every move, puzzle state, completion, and score.
- Cosmetic board imagery comes from moderated token artwork or approved built-in assets.
- Tests: unsolvable board generation, invalid tile move, duplicate move, reconnect, forged completion, identical seed replay.

### G07 — Hash Hunt

Bot-friendly proof-of-work competition; duration 30–300 seconds; target difficulty preset; first valid hit or capped valid-hit leaderboard; per-wallet accepted-proof rate limit.

Exact preimage: ABI-encode `(bytes32 domain, uint256 chainId, address escrow, bytes32 roundId, bytes32 publicSeed, address player, uint256 nonce)` and hash with keccak256. Document domain constant. Accept `uint256(hash) < target`. The public seed is intentionally public; use an independent private settlement seed only where needed. Bind proof to player/round/contract to prevent copying/replay.

- Browser mining runs in Web Workers only after explicit Start mining action. Stop on exit, timeout, hidden tab by default, or user stop. Show CPU caution and throttle setting.
- Agent API accepts authenticated submissions under the same budget and rate policy. Server verifies, never mines.
- Adjust target only between rounds. Verify distribution with simulations; no profit, skill-equality, or energy-efficiency promises.
- Tests: copied proof, different wallet, chain, contract, round, nonce range, malformed uint, target boundary, duplicate nonce, client worker termination.

### G08 — Co-op Boss Raid

Creator configures 2–100 players, 60–180 seconds, shared boss health, one action every 300–2000ms, contribution cap, minimum contribution, and proportional/top-N/fixed-milestone reward rule.

- Browser animates hits immediately; server accepts rate-capped actions and broadcasts health/contribution at 5–10Hz.
- Cosmetic purchase is not damage unless explicitly funded and disclosed. Default equal access; no hidden pay-to-win multiplier.
- Set outcome to completed if boss health reaches zero; otherwise use disclosed no-win/refund/rollover behavior.
- Tests: action spam, negative damage, server-issued damage only, last-hit race, idle eligibility, exact reward allocations.

### Subsequent implementation queue

G09 Rock-paper-scissors duel: 3/5/7 rounds, committed choice then reveal, missing reveal forfeit under declared deadlines, no simultaneous cleartext choices.

G10 Six-digit reward grid: up to 100 tiles, 1–20 prefunded reward slots, reveal cap 1–20, server-authorized reveals, seed commitment; chance-based testnet/demo only initially.

G11 Token-logo bingo: 3x3/4x4 board, fixed call cadence, shared draw stream, first line/full-board mode, claim verified by server.

G12 Pattern Recall: 3–12 symbols, increasing sequence, bounded input window, threshold or ranked rewards; server validates order.

G13 Typing Sprint: moderated prompt, duration 30–120 seconds, accuracy floor, server input event bounds, no rewards based solely on client-reported WPM.

G14 Maze Race: seeded solvable maze, server checks adjacency and path, room race or solo threshold.

G15 Level Runner: deterministic lane-obstacle runner, server replays movement, capped duration and scores; no infinite farming loop.

G16 Contract Detective: curated educational question bank about mock contract snippets, explanation and answer proofs, not security audit certification.

G17 Gas Golf: optimize supplied sandbox examples; fixed compiler/harness, no arbitrary submitted code execution on API server. Isolated bounded worker required before availability.

G18 MEV Rush: simulated pending-transaction queue, not a real-chain frontrunning service; bot-allowed leaderboard, server-issued opportunities.

G19 Idle Rig: bounded sessions and scheduled progression, server clock, no perpetual payout, funded campaign inventory cap.

G20 Airdrop Quest: creator-authored achievements across approved Center templates, one wallet-bound entitlement per quest, budgeted campaign pool.

G21 Lucky Wheel, G22 Plinko, G23 Crash, G24 Candle Prediction: keep inactive for monetary/staked play pending specialist gambling/financial-product legal review. Demo/testnet templates may use valueless points. “Skill-based” does not automatically make paid reward games legal; geofencing alone is insufficient.

Each later template requires its own rules schema, deterministic reducer, server validator, frontend renderer, adversarial tests, and reward adapter. Copying another engine and changing the artwork is not acceptable.

## 4. Creator configuration and burn overlay

### Wizard: fixed steps

1. **Choose a game**: preview, category, multiplayer mode, bot policy support, rules summary.
2. **Access**: “Creator access requires burning the platform token. Token launch pending.” Overlay shows required amount as **Not configured**, not an invented quantity or ticker. Button: “Continue in preview”. No approval, burn transaction, or balance query for a zero address.
3. **Room rules**: name, description, public/unlisted/private, player cap, registration/start/deadline, game-specific settings, spectators, bots, reconnect policy.
4. **Rewards and entry**: preview points OR funded testnet assets; asset picker; winner distribution; entry fee; no-win/cancel/refund behavior.
5. **Brand and invitation**: logo, cover, theme preset, public slug, invite settings, link preview.
6. **Review and publish**: frozen rules summary, fees, supported assets, settlement trust, funding state, finality wait, publish action.

Use draft autosave after 500ms debounce. Display Saved/Saving/Offline; local draft recovery must not expose private invites or secrets. Public configs and private answers have separate payloads. Creator can go back without losing fields.

### Common bounds

- Name 3–60 characters; description maximum 1000; public slug 3–40 ASCII lower-case letters/numbers/hyphens.
- Player cap 2–100 for shared release-one rooms, or 1 for solo template; scheduled duration bounded per template.
- Reward slots at most 20 and assets at most 8 per room. Entry asset at most one ERC-20 initially; free entry supported. Native currency can be added with explicit accounting tests later.
- Amounts are decimal strings converted to integer base units after fetching asset decimals. Never use floats for money.
- Bot policy: `discouraged`, `allowlisted`, `allowed`. “Discouraged” does not mean proven human-only. Add accessibility-safe abuse review; no automatic confiscation based on uncertain heuristics.
- No creation-time unlimited recurring room. Repetition requires maximum rounds, campaign budget and stop date. Default one round.
- Freeze settings when registration opens. Any material edit creates a new version; it cannot alter existing funded entrants' rules.

### Canonical example config (illustrative test fixture, not actual funds)

```json
{
  "schemaVersion": 1,
  "templateId": "number-hunt",
  "templateVersion": 1,
  "name": "Community Number Hunt",
  "visibility": "unlisted",
  "mode": "testnet",
  "rules": {
    "min": 111111,
    "max": 999999,
    "guessBudget": 20,
    "durationSeconds": 60,
    "hints": "off",
    "targetCount": 1,
    "winMode": "first-hit",
    "guessCooldownMs": 500
  },
  "admission": {"playerCap": 20, "spectators": false, "botPolicy": "discouraged"},
  "access": {"burnMode": "preview", "token": null, "requiredAmount": null},
  "entry": {"kind": "free"},
  "rewards": {"kind": "preview-points", "slots": [{"rank": 1, "points": 1000}]},
  "branding": {"preset": "solar", "logoAssetId": null, "coverAssetId": null}
}
```

Generate matching TypeScript/Zod and Python/Pydantic schemas from one versioned JSON Schema. `additionalProperties:false` for external configs. Cross-field validation rejects impossible payout structures, targets exceeding range, timing conflicts, bot mode unsupported by template, and insufficient reward inventory.

## 5. Premium UI specification

### Design direction: a social game studio, not a casino terminal

Warm graphite surfaces, Orbix solar-orange identity, cool teal for connected/live state, and tactile game illustrations. The unique visual element is the **Room Capsule**: a framed miniature game stage with artwork, player avatars, rules chips, and an honest reward/funding strip. It becomes catalog card, lobby header, and share preview, giving continuity throughout the journey.

A design-database pass suggested heavy 3D/WebGL; reject that for the primary UI because mobile usability, frame stability and accessible forms matter more. Use pre-rendered/SVG artwork and restrained spatial motion, not a giant GPU-burning background.

### Tokens: exact source of truth

```css
:root {
  --oc-bg: #101216;
  --oc-surface: #191C22;
  --oc-raised: #232730;
  --oc-border: #3B414D;
  --oc-text: #F5F6F8;
  --oc-muted: #BBC2CD;
  --oc-accent: #FF985C;
  --oc-on-accent: #211207;
  --oc-live: #69D9C8;
  --oc-error: #FF929C;
  --oc-focus: #B8D4FF;
  --oc-space-1: 4px;
  --oc-space-2: 8px;
  --oc-space-3: 12px;
  --oc-space-4: 16px;
  --oc-space-5: 24px;
  --oc-space-6: 32px;
  --oc-space-7: 48px;
  --oc-radius-control: 10px;
  --oc-radius-card: 18px;
  --oc-radius-stage: 24px;
}
```

Validate contrast using tooling; these are proposed tokens, not certified accessible pairs. Teal is not a success/reward claim; use text labels as well. Never raw white native select boxes in dark UI.

- Display: locally hosted Sora, semibold; body: locally hosted DM Sans; numeric/address: JetBrains Mono.
- Sizes: 40/48 desktop page title, 28/36 mobile, 24/32 section heading, 18/26 card title, 16/24 body, 13/20 captions; critical descriptions never below 14px.
- Content max width 1320px. Desktop Center sidebar 220px; main gap 24px; catalog three columns above 1100px, two above 640px, one below.
- Mobile uses four-item bottom navigation: Explore, Rooms, Create, Rewards. Studio lives under profile; no five-layer hamburger maze.
- App shell retains main Orbix navigation with Center highlighted; Center subnav stays predictable. WIP banner remains sticky and readable, not a moving marquee.
- All interactive controls at least 44px; game primary actions 48px minimum. Focus ring 2px with 2px offset.
- Motion: buttons 150ms; cards 180ms; dialogs 220ms; page transition 200ms. Animate transform/opacity only. Respect reduced motion; confetti optional and capped.
- No blanket neon gradients, emoji UI icons, constantly blinking counters, fake activity, fake burn charts or countdown pressure.

### Page composition

**Center home**

```
[Global Orbix shell / WIP banner]
[Orbix Center]                       [Create a room]
[Play together. Build your own token-powered room.]
[Featured Room Capsule, 2/3 width] [Your drafts / How it works, 1/3]
[Games / Quiz / Puzzles / Co-op / Agents] [Search]
[Illustrated template cards: preview + create]
[Live public rooms: real occupancy, actual status, reward funding]
[How rewards work / preview token access / trust labels]
```

No wallet wall. If public rooms are empty, show “No public rooms yet. Create the first one.” Show a demo card labeled DEMO, not invented online people.

**Game detail**: large stage preview, explanation, supported modes, all configurable settings summarized, bot/trust badge, reward examples clearly illustrative, Create this room CTA.

**Wizard**: desktop settings left (60%), sticky Room Capsule live preview right (40%); mobile separate Preview drawer. Stepper names, inline errors, help popovers, Back/Continue footer, save state. Advanced settings collapsed. Summary never silently differs from actual serialized config.

**Lobby**: game art and room name, verified creator wallet, readiness/avatar grid, rules, funding strip, entry/wallet panel, invite copy/QR, scheduled start. Host Start requires minimum ready entrants, confirmed funding and frozen config. Participant must explicitly join; spectator is clearly separate.

**Play**: game stage dominates; top status includes authoritative timer, room participants and connection health; secondary activity panel; primary action near thumb reach. No wallet prompt during a timed action. Reconnect overlay blocks input until server resync.

**Results**: ranked list, your outcome, provisional/final status, exact asset allocation, fairness receipt, Claim reward, Save code, play-again action only if a next room exists.

**Rewards**: paste code OR choose registered escrow + round; connect only to inspect wallet-specific entitlements. Show asset, amount/tokenId, contract, eligibility, claim status, and network. Errors distinguish not settled, wrong wallet, expired invitation, already claimed, unknown contract and RPC unavailable.

**Studio**: room list with Draft/Funded/Registration/Playing/Settling/Claimable/Cancelled, real inventory, participant counts, remaining claims, cancel policy, export. No fabricated revenue charts.

### Component and MCP choices

- Keep React/Vite/TypeScript. Add React Router, Tailwind, shadcn/Radix, React Hook Form + Zod, TanStack Query, Motion as needed. Reuse existing wallet provider; migrate to wagmi only with connector regression tests.
- shadcn MCP: search existing components before building forms. Select Button, Dialog, Sheet, Tabs, Card, Combobox, Slider, Switch, Tooltip, Progress, AlertDialog, Skeleton, Toast, Accordion, Avatar. Theme all to Center tokens. Form semantics and keyboard handling remain intact.
- Iconify MCP: use one family, Lucide; select gamepad-2, users, shield-check, gift, key-round, flame, shuffle, timer, trophy, link, lock. Verify identifiers in the actual collection before importing.
- Context7: fetch current APIs for React Router, viem signing, OpenZeppelin SafeERC20/MerkleProof, FastAPI/Pydantic, Motion, and query hooks. Lock versions in lockfiles; do not copy old examples blindly.
- Playwright: exercise every route and room flow at 375/768/1440 widths; screenshots, console errors, keyboard navigation, network failures, reduced motion.
- Do not install every registry/animation package. No Three.js, GSAP, or Lenis for ordinary form/game-page navigation.

### Asset manifest

Create `center/assets/manifest.json`: templateId, cover, thumbnail, alt, author/provenance, license, dimensions, dominant color. Release-one artwork: six-digit vault dial, quiz cards, memory tiles, falling token lanes, duel pulse rings, sliding puzzle, hash lattice, shared boss silhouette. They must be distinct scenes, not the same gradient with a different icon.

Use SVG for static vector covers and AVIF/WebP for raster art, reserve 16:10 space, lazy load below fold, maximum 150KB thumbnail target. Avoid creator-uploaded active SVG. Upload raster-only initially, maximum 2MB, re-encode server-side and strip metadata; validate actual MIME/decode, not extension.

## 6. System architecture and file structure

```
web/src/center/
  CenterLayout.tsx
  routes.tsx
  pages/{Explore,Games,GameDetail,Rooms,Room,Create,Rewards,Studio,Fairness,Help}.tsx
  components/{RoomCapsule,GameCard,BurnAccessOverlay,RewardPicker,
              FundingStrip,WalletActionSheet,InviteDialog,ConnectionBadge,
              ParticipantGrid,ResultReceipt,CreatorStepper}.tsx
  games/{number-hunt,live-quiz,memory-match,token-catch,
         reaction-duel,puzzle-sprint,hash-hunt,boss-raid}/
  lib/{api,ws,amounts,config-hash,claims,feature-flags}.ts
  state/{creator-draft,room-session}.ts
  styles/{tokens,center}.css
  assets/manifest.json
arcade/server/center/
  app.py
  models/{room,round,entry,reward,claim,invite}.py
  schemas/{config,api,events}.py
  engines/{base,number_hunt,live_quiz,memory_match,token_catch,
           reaction_duel,puzzle_sprint,hash_hunt,boss_raid}.py
  services/{auth,rooms,scheduler,rewards,claims,indexer,invites,uploads}.py
  storage/{db,repository,migrations}/
  security/{limits,origins,signing}.py
  tests/{unit,integration,adversarial}/
src/center/{CenterRegistry,CenterEscrow,CreatorAccess,SettlementVerifier}.sol
script/center/{DeployCenter,SmokeCenter}.s.sol
test/center/{Registry,Escrow,Access,Claims,Invariants}.t.sol
shared/center/{config.schema.json,api.openapi.json,events.schema.json,fixtures}/
docs/center/{STATUS,DEPLOYMENTS,TRUST_MODEL,RUNBOOK,DECISIONS}.md
```

Use Postgres for durable room configs, entrants, action receipts, commitments, settlement jobs, chain cursors, rewards and claims. RAM stores active sockets and hot state only. One authoritative worker owns each active room. Start with one backend replica; multi-replica mode requires distributed leases and routing, not two independent in-memory room maps.

Redis is optional for a single replica; add it for shared rate limits/presence and horizontal sharding. Do not use a low-command-quota HTTP Redis as a per-frame game bus. Durable transitions are persisted before broadcasting. A transactional outbox drives settlement/indexing side effects.

### Data model

- `creators`: id, chainId, wallet, displayName, moderatedAssetIds.
- `sites`: id, creatorId, uniqueSlug, brandingJson, visibility, version.
- `drafts`: id, creatorId/sessionId, schemaVersion, configJson, revision, updatedAt.
- `rooms`: UUID, siteId, creatorId, template/version, configHash, publicConfigJson, privateConfigRef, mode, visibility, lifecycleState, escrow, createdAt.
- `rounds`: UUID, roomId, ordinal, registrationEnd, startAt, endAt, commitment, revealRef, transcriptHash, settlementState.
- `participants`: roundId, wallet/sessionId, admissionState, entryEventRef, actionBudget, score, eligibility; unique round+identity.
- `actions`: roundId, participantId, clientActionId, serverSequence, receivedAt, payload, resultingStateHash; unique round+participant+clientActionId.
- `reward_inventory`: roundId, assetKind, contract, tokenId, deposited, reserved, claimed, refundable, baseUnits strings.
- `entitlements`: claimId bytes32, roundId, wallet, asset tuple, allocation, leafIndex, settlementRoot, claimedTx; unique claimId.
- `invites`: hash, roomId, expiry, maxUses, used, walletAllowlist, revoked; never store raw invitation secrets.
- `chain_events`: chainId, blockNumber/hash, txHash, logIndex, decoded event, status; unique chain+tx+log.
- `jobs/outbox`: id, kind, payloadHash, idempotencyKey, attempts, nextAttempt, state.

Use DB migrations, foreign keys, checks on nonnegative budgets and inventory, and cursor indices. Public queries never expose privateConfigRef contents, answers, raw invite codes or unrevealed secrets.

## 7. Room state machine, realtime protocol, and recovery

Room lifecycle:

```
DRAFT -> PREVIEW_PUBLISHED
DRAFT -> CONFIG_FROZEN -> FUNDING -> FUNDED -> REGISTRATION
REGISTRATION -> READY -> RUNNING -> RESULT_PENDING -> SETTLEMENT_PENDING -> CLAIMABLE -> CLOSED
REGISTRATION/READY -> CANCELLED -> REFUNDABLE -> CLOSED
RUNNING -> RECOVERY_REQUIRED -> resume OR deadline-based REFUNDABLE
```

Define allowed transitions in one module. An elapsed deadline is handled by scheduler even with zero connected users. Database compare-and-swap revision protects state transitions. Actor command order is authoritative, and the published tie policy governs same-time hits. Never overwrite final state because a timer ran later.

### WebSocket protocol

Path proposed: `/api/center/ws/rooms/:roomId`. Origin allowlist checked. Authenticate with short-lived room session ticket; never put long-lived auth or private keys in the URL. Use a one-time ticket or first-message authentication with handshake timeout.

Client envelope:

```json
{"v":1,"type":"action","roomId":"uuid","roundId":"uuid","actionId":"uuid","expectedRevision":17,"payload":{"kind":"guess","number":432100}}
```

Server envelope:

```json
{"v":1,"type":"action.ack","seq":18,"serverTimeMs":0,"roundId":"uuid","payload":{"actionId":"uuid","accepted":true,"remaining":19}}
```

Events: session.ready, room.snapshot, participant.joined/left/ready, round.started, action.ack/rejected, game.patch, round.finished, settlement.pending/finalized, reward.available, room.cancelled, connection.pong, resync.required, error.

- Snapshot has state revision and event sequence; reconnect sends last acknowledged seq and server provides missing events or a full snapshot.
- Guess/quiz games broadcast only on changes plus one-second clock sync. Catch/Boss use capped 5–10Hz snapshots; local render loop is independent.
- Ping interval proposed 20 seconds; disconnection detected after two missed intervals; validate hosting behavior. Client backoff with jitter 1/2/4/8 seconds, max 15, and a Stop retry button.
- Max inbound payload 8KB initially; bounded message rate per identity/IP/room. Gameplay rates are engine-specific, not one global arbitrary rate.
- Per-socket outgoing bounded queue; slow clients receive resync or disconnect, not server-wide blockage.
- Ready/entry state belongs to participant identity, never socket. A socket replacement invalidates stale control socket but can retain read-only spectator connection.
- Short disconnect preserves budget. Unconfirmed entry can observe lobby but cannot play or earn before chain confirmation/finality policy.
- Server restart restores round from snapshot plus actions. If safe restoration fails, invoke declared timeout/refund path; never invent winners or delete funded records.

## 8. Authentication, invitations, and anti-abuse

Use a wallet login nonce with origin, chain, wallet, issuedAt, expiry and one-time use; verify SIWE-compatible signatures including EIP-1271 for supported smart wallets. Session cookies HttpOnly/Secure/SameSite; CSRF protection for cookie-authenticated mutations. Guests get stable random session ids for preview only.

Private invite secret: at least 128 bits from CSPRNG, hashed at rest, expiry and usage cap. Unlisted links are not private authorization. Private rooms require invite validation plus authentication/allowlist as configured. Never expose secrets to analytics, referrer headers, public listings, OG previews or structured logs. Set appropriate referrer policy and strip secret before wallet connection where practical.

Creator permissions bind server session to wallet. Spectators cannot send gameplay actions. Room creation has daily caps and upload quotas. Bot eligibility is declared and enforced as far as technically reasonable; uncertainty goes to review, not arbitrary stake confiscation. Funding-age heuristics are not reliable wallet age or proof of bots.

Quiz content moderation, reporting, room takedown and abuse appeals must exist. Takedown hides discovery, not confiscates escrow; contracted claim/refund rules remain available.

## 9. Testnet contracts: prefunded rewards and bounded trust

Deploy a Center-specific contract suite only after implementation tests pass and deployment is explicitly authorized. Keep chain 46630 enforced in deployment scripts and web flags. No new real platform token is launched by these instructions.

### Contract design choices

Prefer non-upgradeable per-version escrow contracts initially, with new versions deployed explicitly. A registry lists approved versions. Do not add an upgradeable arbitrary admin execution path capable of stealing deposits. Keep contract modules small; a single “does everything” UI may use several contracts safely.

**CenterRegistry**: approved templates/escrows, immutable config hashes and room ownership, emitted creation records. Asset allowlist and maximum bounds. Registry updates do not rewrite old escrow terms.

**CreatorAccess**: preview/mock mode distinct from real burn. Future config: token address, amount per template, version, activation time. Real token integration must verify transferability, allowance, burn method and supply semantics. A nonzero token with locked transfers cannot enable access. Use exact-amount approval; no blanket approvals. Real burn intent binds creator, template, configHash and nonce, so retries cannot charge again. A mock token for tests must be explicitly labeled TEST MOCK, never presented as the user token.

**CenterEscrow**: records rounds, accepted entries, prefunded asset inventory, deadlines, fees, settlement root and claims. SafeERC20 and ReentrancyGuard; NFT receiver interfaces. Allow standard assets first. Reject rebasing/fee-on-transfer ERC-20 and unusual NFT behavior until explicitly supported. For ERC-20 deposits compare before/after balances and reject a mismatch; never assume transfer amount equals receipt. ERC-721 deposited tokenId unique; ERC-1155 quantity recorded.

**SettlementVerifier**: testnet result-signing authority constrained by escrow budgets, round config and epoch. Signer is a disclosed trusted component, not “trustless.” For independently verifiable templates later add on-chain verifier adapters. Never market a signature-only Merkle root as proof that winners were chosen fairly.

### Illustrative contract interface contract

Implement structs fully in code and publish ABI after compilation. These signatures describe responsibilities, not a ready-to-deploy contract:

```solidity
function createRound(RoundSpec calldata spec) external returns (bytes32 roundId);
function fundERC20(bytes32 roundId, address token, uint256 amount) external;
function fundERC721(bytes32 roundId, address token, uint256 tokenId) external;
function fundERC1155(bytes32 roundId, address token, uint256 tokenId, uint256 amount) external;
function openRegistration(bytes32 roundId) external;
function enter(bytes32 roundId) external;
function publishSettlement(Settlement calldata result, bytes calldata signature) external;
function claim(Entitlement calldata entitlement, bytes32[] calldata proof) external;
function refundEntry(bytes32 roundId) external;
function reclaimUnusedReward(bytes32 roundId, Asset calldata asset) external;
```

RoundSpec includes creator, immutable configHash, template/version, entry asset/amount, admission cap, registration/start/end/finalization/refund/claim deadlines, settlement authority, asset policy hash, payout policy hash and maximum fee bps. Validate chronology, contract addresses and bounds. Contract-level state and backend state must map explicitly.

### Accounting and safety requirements

- Separate creator-sponsored prize inventory from player entries. Rake disabled by default for release one. A future rake must be specified before entry and deducted under bounded immutable terms, never retrospectively.
- Reserve reward allocations before registration. A room cannot advertise funded unless chain events and inventory prove it.
- `claimed + reserved + refundable <= actually deposited` for each asset tuple.
- Settlement authority cannot select arbitrary external recipients; entitlements restricted to admitted eligible identities and configured allocations. However honest result eligibility still depends on trusted off-chain validation—disclose this.
- Invalid or unavailable settlement before deadline triggers deterministic refunds of player entries. Creator-sponsored unused inventory follows the fixed refund/claim deadline policy.
- No creator withdrawal of committed prizes while participation/claims are active. No emergency admin “sweep” of reserved assets.
- Pausing stops new entries; it should not indefinitely block valid pull claims/refunds. Asset-transfer failures affect only that claim, not a loop of all winners.
- ERC-721 ties resolved by predeclared deterministic rank/slot rule. ERC-20 split uses integer division; residual units return to explicit leftover bucket after claims, never silently disappear.
- Events contain asset contracts, amounts and claim identifiers, never plaintext private invites.
- Permit/approval transaction is not a reward claim. Reward claims never request approval to spend winner assets.
- Burn conversion/rake swaps are deferred. If added later, isolated worker with slippage/deadline/route checks and fallback accounting, not a swap that can brick reward withdrawal.

## 10. Reward codes, wallet claim flow, and replay protection

The code is a receipt/reference, **not a bearer secret that lets whoever pastes it steal a prize**. An ERC contract address alone identifies a vault but does not identify the winner or reward.

### Entitlement leaf and typed settlement

```text
claimId = keccak256(abi.encode(chainId, escrow, roundId, winner, slotId, allocationNonce))
leaf = keccak256(abi.encode(claimId, chainId, escrow, roundId,
                           winner, assetKind, assetContract, tokenId, amount))
```

Use a precisely specified Merkle convention. Recommended OpenZeppelin-compatible standard double-hashed leaf and sorted pairs; adapt the above conceptual payload into that exact encoder. Publish matching TS/Python/Solidity test vectors; do not mix single hash and double hash. Settlement EIP-712 domain includes name, version, chainId and verifyingContract. Result payload includes roundId, configHash, Merkle root, transcriptHash, allocations hash, authority epoch and deadline.

`claimed[claimId]` flips before transfer. Recipient fixed to entitlement winner; caller may be the winner or a relayer, but destination must never become msg.sender by accident. Prevent replay across chain, escrow, round and signer epoch.

### Code format

User code: `OC1-<publicClaimReference>-<checksum>`. Reference is an opaque id to lookup a proof bundle. Checksum detects typing errors; it is not authentication. Provide copy, download JSON receipt, and optional QR. Do not put wallet keys, signing secrets or private game answers into a code.

Proof receipt contains schemaVersion, chainId, escrow, roundId, claimId, recipient, asset tuples, root, proof, settlementTx and transcriptHash. Export it so winner claims can remain possible during API downtime.

### Immediate claim

Result → “Reward pending settlement” until finalized → exact asset and recipient review → switch to testnet if necessary → simulate claim → wallet confirmation → pending receipt → finalized receipt → claimed readback. Signing a transaction sends the claim; a message signature alone does not transfer reward assets unless a separately implemented relayer executes it.

### Later claim

Rewards page → paste code or choose registered escrow and round → resolve verified proof → verify chain/escrow is in our deployed registry → check on-chain root/claimed flag → connect correct wallet → claim. If user pastes a random contract, do not call arbitrary ABI functions or request approvals. “Unsupported contract” is an actionable error.

Wrong wallet sees “This reward belongs to a different wallet” with masked recipient. Already claimed shows transaction receipt; duplicates never pay again. No expiry that silently confiscates winner funds: fixed documented deadline policy and adequate recovery window. Privacy: avoid revealing wallet entitlements through publicly enumerable short codes.

## 11. Fairness and randomness

A seed commitment alone is not enough. For each seeded game:

1. Freeze config before registration.
2. Generate CSPRNG server seed; commit a domain-separated hash including room/round/configHash.
3. Anchor commitment before play. Mix independently contributed entropy or supported verifiable randomness where applicable; define last-revealer/withheld-reveal behavior.
4. Select the target via rejection sampling, not biased modulo, using exact specified byte encoding.
5. Keep private secrets encrypted at rest, separate from public APIs and client bundle.
6. Record ordered accepted actions and authoritative timestamps.
7. Reveal after round and publish transcript hash plus verifier inputs. Never reveal while another active participant can exploit it.
8. Failed reveal/settlement follows bounded refund deadlines. No discretionary pot seizure.

For first-hit games server ordering and censorship remain trusted. For casual scores deterministic replay verifies accepted action streams but does not prove human input. Quiz server controls answer timing and question truth. Proof-of-work verification is objective for a bound proof, but bot/hardware fairness is not guaranteed. State these differences on each template page.

## 12. APIs and event indexing

Prefix all new endpoints `/api/center/v1`.

- GET `/templates`: capabilities and exact schema versions; disabled games have reason.
- POST `/auth/nonce`, POST `/auth/verify`, POST `/auth/logout`.
- GET/POST/PATCH `/drafts`: authenticated ownership, optimistic revision.
- POST `/rooms`: frozen-config publication intent, idempotency key.
- GET `/rooms`: public-only pagination and filters, no private secrets.
- GET `/rooms/:id`: access-filtered public config.
- POST `/rooms/:id/invites`: host-only issuance/revocation.
- POST `/rooms/:id/join`: invite/wallet/entry eligibility; issues short-lived WS ticket.
- POST `/rooms/:id/ready`, POST `/rooms/:id/start`, POST `/rooms/:id/cancel`: explicit state/permission checks.
- GET `/rounds/:id/results`, GET `/rounds/:id/fairness`.
- GET `/claims/:ref`: proof receipt with privacy checks; POST `/claims/lookup` for entered codes.
- GET `/assets/:chainId/:address`: supported standard metadata, escaped fields, timeout/caching.
- POST `/uploads`: authenticated, bounded raster files.
- GET `/health/live`, GET `/health/ready`: readiness includes DB and scheduler state; no secrets.

Errors: `{code,message,fieldErrors,requestId,retryable}`. Specific codes: WRONG_CHAIN, ROOM_FULL, INVITE_REQUIRED, INVITE_EXPIRED, ROUND_NOT_OPEN, BUDGET_EXHAUSTED, ACTION_DUPLICATE, STALE_REVISION, UNFUNDED_REWARD, UNSUPPORTED_ASSET, SETTLEMENT_PENDING, WRONG_CLAIM_WALLET, ALREADY_CLAIMED, RPC_UNAVAILABLE. Do not send stack traces to users.

Indexer: receipt/event verification uses actual contract address, event signature, wallet, room, asset, amount, canonical block hash and configured finality depth. Track reorgs and idempotent cursors. A hash supplied by a client is not proof of payment. Public launchpad-token discovery requires the exact current factory/ABI; Until verified, support user-supplied ERC contract addresses with standard metadata checks. Do not call another similarly named launchpad's API.

## 13. Deployment, cost, migration and observability

Keep the main frontend on existing hosting while integrating Center. Mount API and WS through a same-origin proxy or dedicated configured backend origin with narrow CORS. A same-origin proxy must preserve WebSocket upgrade and forward timeouts. Test it end-to-end; ordinary HTTP reverse proxy code does not automatically support sockets.

Railway: the official Free Trial page currently describes up to 30 days and a one-time $5 credit, followed by $1/month free credit. These are credits, not a promise that any number of services runs continuously at no charge. Read actual account usage before choosing budgets. Do not fabricate capacity or assume a trial lasts the whole month after credit is spent.

- One Center API/WS container, one authoritative replica to start.
- Durable DB chosen from a verified available plan; if current trial cannot support it, label funded rooms disabled until durable storage exists.
- Static assets served with content-hash caching; no arbitrary memory-heavy image generation in request handlers.
- Set PORT and domain target port explicitly. Container runs non-root where practical, fixed dependency locks, graceful shutdown drains sockets and checkpoints rounds.
- No secrets in images, `.env` examples, handoff documents or frontend variables. Browser receives only public addresses/API origins.
- Monthly provider migration is allowed with backups and terms compliance; recurring new trials to evade account restrictions is not a deployment plan.
- Before move: stop new rooms, drain or checkpoint active rounds, backup DB, export claim proofs, deploy new service, restore, verify chain cursors and claims, change routing, retain fallback. Do not erase escrow state.
- Set usage alerts and service hard limits where provider supports them. Budget alerts alone are not a spending cap.

Performance targets are **test targets**, not promises: 100 concurrent sockets in baseline test, room action acknowledgment p95 below 250ms on the selected measured region/network, no dropped accepted actions, process RAM below 512MB baseline target. Measure 500 sockets as a scaling experiment; optimize based on evidence. No fixed per-socket memory assumption.

Structured logs: requestId, roomId, roundId, engine version, transition, latency, error code, job retry; redact cookies, invite codes and secrets. Metrics: socket count, queue length, ack p95, rejected actions, restart recovery, settlement lag, claim success, DB latency, RPC errors and resource usage. Alerts on unhealthy DB, scheduler stall, signing failure, funded room deadline, insufficient escrow inventory and credit exhaustion.

## 14. Implementation tasks in exact order

Do not skip phases. Each task produces code, tests and status evidence. Add all tasks to the work tracker. One active implementation task at a time; independent reviews may be delegated.

### Phase A — Baseline and evidence

A01 Record git status, package locks, current deploy ids, existing working UI and API routes; redact secrets. Create `docs/center/STATUS.md` with baseline evidence.

A02 Document audit gaps from section 1; isolate old demo. Rename displayed pot to preview points until actual funding exists. Preserve WIP warning.

A03 Add feature flags: CENTER_PREVIEW=true, CENTER_TESTNET_REWARDS=false, CENTER_REAL_BURN=false, CENTER_MAINNET=false. Reject enabled funded flags if addresses/chain/storage missing. Write startup tests.

A04 Verify chainId via RPC, current launchpad version via official contract/ABI, and backend account limits before integration. If blocked, keep launchpad discovery optional; do not stop Center's ERC-standard work.

### Phase B — Product shell and design

B01 Implement Center routes and nav in the current frontend. Existing Swap/Bridge/Pools/Launch/NFT flows remain intact. Route refresh and back/forward tests.

B02 Implement theme tokens, local fonts, shared controls, Room Capsule, illustrated assets and responsive shell. Screenshot review at mobile/tablet/desktop; contrast and keyboard checks.

B03 Catalog all templates with honest Live preview/Coming later states. Implement search and filters; every card opens a real detail page.

B04 Implement schema-driven creator wizard, live preview, autosave, draft restore, burn overlay, reward picker, invitation configuration and publish review. Required error states tested.

### Phase C — Durable realtime foundation

C01 JSON Schema + Pydantic + Zod consistency fixtures; reject extra fields and unsafe cross-field settings.

C02 DB migrations/repos, ownership/auth, idempotency and outbox. Test competing updates and restart persistence.

C03 Room lifecycle and scheduler. Time-controlled tests with no connected clients; no terminal-state overwrite.

C04 WebSocket protocol, bounded queues, stable identity, reconnect/resync, origin checks, deadlines, auth timeout, message limits.

C05 Public/unlisted/private invite model; test leaked URL cannot bypass true private eligibility.

### Phase D — All release-one engines

D01 Number Hunt all three modes + randomize + budgets + tie policy.

D02 Live Quiz authoring/import + private answer storage + score rules.

D03 Memory Match server-authoritative flips + reconnect.

D04 Token Catch deterministic spawn and input validation + mobile lanes.

D05 Reaction Duel readiness/cue/latency/timeout logic.

D06 Puzzle Sprint solvable generator and move validation.

D07 Hash Hunt bound proofs + Web Worker + bot API + stop controls.

D08 Boss Raid authoritative actions + contribution allocation.

For EACH D task: engine reducer, rules schema, client renderer, host preview, lobby/play/results integration, private/public behavior, reward allocation interface, replay tests and adversarial tests. Mark complete only after two-client playthrough plus restart/reconnect scenario. No dead “Play” buttons.

### Phase E — Escrow and claims

E01 Write the escrow threat model and integer accounting tests before contract code.

E02 Implement registry/escrow/settlement verifier and mock-access adapter. No user-token launch.

E03 Unit/fuzz/invariant tests, malicious asset tests, reentrancy tests, duplicate/cross-chain/contract replay tests and refund timeout tests. Review findings independently.

E04 Implement receipt/code generation, proof persistence/export, Rewards UI and exact-amount wallet flows.

E05 Deploy to local Anvil and run full prefund → entry → play → settle → claim with ERC-20, ERC-721 and ERC-1155 mock assets. Funded flags stay off until this passes.

E06 After authorization: deploy verified build to Robinhood testnet 46630, read bytecode/config/signers/deadlines back, record addresses/txs/ABIs in deployment manifest, repeat live flow using isolated wallet.

### Phase F — Integration and polish

F01 Creator storefront, Studio room operations, real inventory and claim dashboard.

F02 Transaction state sheet, pending/finalized, rejected wallet request, insufficient test gas, wrong chain, wrong recipient, already claimed, API outage and RPC outage.

F03 Sound opt-in, reduced motion, restrained win animation, SVG artwork, OG previews and mobile ergonomics.

F04 Load/recovery tests and structured monitoring. Audit origin/cookies/CSP/upload sanitization, dependency vulnerabilities, chain-event forgery and XSS.

F05 Railway staging deploy, browser playthrough of eight templates, readback exact targets, verify warning and preview-vs-funded labels. Do not switch public production blindly.

F06 Production preview release, observed logs and smoke tests; no mainnet stakes. Document missing features as disabled, not completed.

### Phase G — Remaining catalog and token activation

G01 Implement G09–G20 one template at a time using D-task checklist. Keep casino-style G21–G24 behind legal/demo restrictions.

G02 Token launch is a separate owner-approved action after metadata/name/ticker/supply/launchpad compatibility review. Verify transfers/burn semantics, contract metadata and public description. Never substitute the legacy token without approval.

G03 Activate true creator burn per immutable publication intent only after end-to-end testnet review. Restore failed-publish access through consumed-intent retry, not a second burn. Owner sets required amount.

G04 Optional rake conversion and creator economics after reviewed accounting, route safety and explicit fee disclosure. No unverified ecosystem rewards or guaranteed appreciation claims.

## 15. Mandatory acceptance test matrix

### Product and UX

- Every release-one game configured and played by two independent sessions.
- Visitor can explore without wallet; no unexpected signature prompt.
- Creator can resume draft and change game without silently preserving incompatible fields.
- Preview gate has no token address, fake balance or successful burn claim.
- Public room discoverable; unlisted absent from discovery; private blocks unauthorized player even with room URL.
- Real participant counts, live join/leave, host readiness and invite copy work.
- All template bounds, game timers and outcomes work; no stale expired demo appears as live.
- Browser refresh/reconnect retains guesses, answers, entry and result.
- No white native selects, horizontal overflow, hidden primary action, unlabeled icon button or inaccessible modal.
- 375/768/1440 responsive screenshots; keyboard, reduced motion, offline/loading/empty/error paths verified.

### Rewards and trust

- Prefunded ERC-20 token, ERC-721 tokenId, ERC-1155 quantity and a mixed bundle claim correctly.
- Unfunded config cannot advertise claimable asset rewards.
- Creator cannot withdraw reserved prizes; unauthorized signer cannot settle.
- Wallet B cannot redirect wallet A reward; duplicate code cannot double claim.
- Wrong chain/escrow/round/signature epoch/amount/proof all rejected.
- No approval required to claim a reward; simulation matches displayed action.
- No-win, cancellation, failed reveal, backend crash and settlement timeout follow exact refund rules.
- Claim readback confirms on-chain claimed flag and receipt, not merely wallet popup completion.
- Offline exported proof can recover a claim using verified deployed contract.

### Engineering

- TS typecheck/build, frontend unit tests and browser E2E pass.
- Backend schema/engine/auth/integration/reconnect/restart tests pass.
- Forge unit/fuzz/invariants pass; static security review has no unresolved critical/high findings for enabled flows.
- No uploaded script execution, answer leakage, stored XSS, unauthenticated forged wallet, fake payment receipt or unbounded queue/loop.
- Load test reports measured p50/p95, memory, error rates and region; no unsupported “zero lag” declaration.
- Durable DB and chain cursor survive deployment migration.

## 16. AI execution protocol: make this usable by a smaller model

1. Read sections 0, 1 and 14 before any edits. Read the specific feature section before its task.
2. Load relevant skills and retrieve current dependency docs. Do not invent API names.
3. Inspect actual files and git status. Make a safe branch; never overwrite unrelated user edits.
4. Copy one task into the tracker as in progress. State its inputs, files, tests and acceptance criterion.
5. Write failing tests for business/security logic. Implement the smallest complete slice, not an incomplete scaffold.
6. Use exact design tokens and common components. Do not improvise a new color system per game.
7. After edits, run tests and actual UI; record output and evidence. Never mark a task done based on code written.
8. Update `docs/center/STATUS.md` with completed IDs, exact commands/results, new files, routes, deployed ids, open blockers and next task.
9. If information is missing, use the lookup tools. If credentials/deployment authority are missing, keep the feature disabled and ask; do not fake external responses.
10. If nearing context limit, checkpoint file/task/evidence and the next action. Never rely on chat memory alone.
11. Do not say “everything works” unless all relevant acceptance criteria passed. Clearly separate preview, local tests, testnet and production evidence.
12. Existing Orbix protocol features must not regress. Run their tests before shipping Center integration.

### Required status entry shape

```text
Task ID:
Status: pending | in-progress | verified | blocked
Scope/files:
Tests executed and actual result:
Browser evidence:
Deployment target/receipt if any:
Known limitations:
Next exact task:
```

### Commands: inspect manifest before selecting script names

Existing frontend supports `npm run build`. Add explicit test/typecheck/E2E scripts as part of B01; use `npm ci` only with a lockfile. Backend uses a dedicated environment managed by uv/venv; no global pip mismatch. Foundry commands are `forge build`, `forge test`, and `forge test --match-path 'test/center/*'` after these tests exist. Write repeatable smoke scripts instead of ad-hoc secret-bearing shell commands. Deploy commands must identify exact service, project and environment, then read back the deployed target.

## 17. Research evidence and decisions still open

Authoritative chain docs were retrieved and rendered: Robinhood EVM, ETH gas, mainnet 4663, testnet 46630. That does not prove vibe/vibe mainnet operation or any specific launchpad version.

Rendered vibe/vibe testnet terms: operator SPARK LABS ORGANIZATION, S.A.; testnet artifacts have no monetary value; recognition conditional/discretionary. A current v6 ABI/metadata/burn mechanism must be verified separately before token integration.

Railway trial docs were retrieved and rendered. Actual account credit/resources must be checked at implementation time; no unlimited free-service assumption.

Open owner decisions are deliberately not guessed: new token name/ticker/CA, real burn amount, whether a new domain is controlled, final legal geography, funded game fee policy, and settlement trust acceptable for a public mainnet release. None block the requested preview design or schema/engine work.

## Appendix A — Documents reviewed

AUDIT.md; BONDING_CURVE_SPEC.md; CROSSCHAIN_PLAN.md; DEPLOYMENT.md; EXECUTION_PLAN.md; HANDOFF.md; MASTER_TASKS.md; README.md; REBUILD_PLAN.md; REBUILD_STATUS.md; USER_INSTRUCTIONS.md; VIBE_ARCADE_MASTER_PLAN_V2.md; marketing/x-thread.md. These are historical context, not proof of currently verified live behavior. Existing deployment documentation contains sensitive legacy details: never copy secrets into new public files.

## Appendix B — Sources verified for this manual

- Robinhood official contract deployment documentation: `https://docs.robinhood.com/chain/deploy-smart-contracts/`.
- vibe/vibe testnet agreement rendered from `https://testnet.vibevibe.fun/` and agreement text retrieved separately.
- Railway official Free Trial documentation: `https://docs.railway.com/pricing/free-trial`.

These citations are research references, not instructions to accept terms, buy tokens, or submit transactions. Proposed Center routes remain unimplemented at this document's creation.

## Final instruction to the builder

Build the **platform**: catalog → configurable creator wizard → prefunded shared room → authoritative game → honest result → wallet-bound reward claim. Preserve the existing Orbix site. Ship all eight release-one templates with one coherent premium design and full lifecycle, then implement the remaining catalog. Keep the user's new token unlaunched and burn access in labeled preview until owner approval. Never replace this vision with another single-game demo.
