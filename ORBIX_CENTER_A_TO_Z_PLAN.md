# Orbix UI Design and Mechanism Program, A-to-Z

This is the living checklist for the product overhaul. It deliberately assigns twice the effort to core contracts, game fairness, custody, payout and transaction correctness than to visual polish. **No plan item is “complete” until its tests, chain or browser evidence and live readback are recorded.** Mainnet remains excluded. The task-level checklist is `ORBIX_CENTER_A_TO_Z_PLAN.md`, updated 2026-10-02 to give mechanisms and contract correctness 2× priority over visual polish.

## Source of truth and user intent

- [ ] **A1** Read and reconcile USER_INSTRUCTIONS.md, V4 product manual, V5 execution/acceptance ledger, V6 delivery ledger, contract audits, deployed manifests, live site and active task list.
- [ ] **A2** Preserve product north star: Orbix is a connected Robinhood testnet DeFi ecosystem and Center is a creator-platform core product, not a decorative game gallery.
- [ ] **A3** Map journeys end-to-end: browse → inspect rules/economics → create → set game-specific rules/hints → select room access → select fee/reward/payout → review → sign → publish → invite/join → play → settle → claim/refund/reclaim → audit/creator studio.
- [ ] **A4** Keep real asset mode, preview points and simulations unmistakably distinct. Never claim an unintegrated contract path as live.

## B. Research, toolchain, and persistent design/dev guidance

- [x] **B1** Install Vercel Web Interface Guidelines skill and keep the fresh upstream review checklist accessible.
- [x] **B2** Install getdesign.md Vercel reference and Awesome Design MD brand library.
- [x] **B3** Keep the Taste Skill v2 and adapt for Hermes, existing Orbix tokens and this repository's React/Vite/no-Tailwind stack.
- [x] **B4** Add Orbix DESIGN.md source of truth including mechanisms, hint classes, funded-vs-preview truth, motion, accessibility and responsive rules.
- [ ] **B5** Ensure installed Taste Skill, Vercel skill and current brand references are reachable by default Hermes website work, not only inside project-specific .agents folders.
- [ ] **B6** Add a Hermes skill/tool workflow using Context7, Playwright MCP, shadcn registry and Iconify only where appropriate; real MCP call must prove each server usable for this project.
- [ ] **B7** Set tool routing so Taste/design guidance triggers for UI, while contract/security/recon/deploy skills trigger for protocol work; avoid routing a game wizard through a landing-page-only skill.
- [ ] **B8** Establish single project token package/CSS contract with versioned palette/type/radii/motion/accessibility and no conflicting root/site/Center tokens.

## C. Product and visual system

- [x] **C1** Browser-audit current Center/catalog/create flows and identify high-impact mobile and reward-truth errors.
- [x] **C2** Fix wallet header overflow at 390px, global preview wording, static “0 funded rewards” assertion, missing skip link/focus and false catalog copy.
- [x] **C3** Add truthful per-game hint policy disclosure; public/private control only appears for Number Hunt and other methods are explicitly marked inactive.
- [ ] **C4** Audit every route in cockpit and Center at 390, 768, 1024, 1440 widths: Overview/Discover/Swap/Pools/Bridge/Launch/Staking/Orbix666/Marketplace, Catalog, Create, every room stage/result, Vault, Rewards, Studio/admin.
- [ ] **C5** Capture named Playwright screenshots and DOM/accessibility notes for desktop, tablet, mobile, empty/loading/error/funded/preview states.
- [ ] **C6** Rebuild the Center IA so catalog segmentation, search, players/time/skill, game-specific preview, trust/economic mode and status are quickly scannable; preserve existing routes/navigation contracts.
- [ ] **C7** Replace 19+ same-weight format cards with a premium game-discovery system (categories/featured rotations/filters, comparison and honest availability); no false “live” for non-live formats.
- [ ] **C8** Make creator flow progressive: choose game → configure only relevant rules and hints → participants/privacy → payment model → reward lock and payout mode → persistent Room Capsule review → transaction review → publish.
- [ ] **C9** Upgrade Room Capsule, invitation/landing, lobby/readiness, game HUD, hint timeline, result and claim screens as one visual journey with motion continuity.
- [ ] **C10** Build consistent product art for each released game from real/approved assets, distinct silhouettes, readable contrast, reduced-motion and no false gameplay state.
- [ ] **C11** Add state-feedback patterns for signing, pending, submitted, mined/finalized, rejected, reverted, RPC outage, chain mismatch, refund available, claimed and no inventory.
- [ ] **C12** Audit accessibility (keyboard/touch/44px, focus, labels, aria-live, contrast, zoom), responsive safe areas, dark theme parity, copy quality and Vercel/Taste preflight.
- [ ] **C13** Motion system: short state transitions, commit/reveal sequences, shared room timeline, podium/result and transaction progress. Motion must communicate feedback/state, be interruptible, transform/opacity-led and honor reduced-motion. No ornamental perpetual motion.
- [ ] **C14** Load test media/asset weights, CLS and route performance; keep first meaningful room action fast on mobile networks.

## D. Game catalog truth and mechanics (core emphasis)

- [ ] **D1** Reconcile V4's 24 template specs, current 19 UI/backend templates and 8 release-one engines; publish precise catalog status and do not silently erase four documented games.
- [ ] **D2** For every implemented template create a typed versioned schema, server-authoritative reducer, event/transcript format, reconnect/resume rules, deadlines, anti-spam, forfeit/tie policy, client renderer, disclosure and adversarial tests.
- [ ] **D3** Add typed per-template HintPolicy: availability, kind, audience, budget/cost, cooldown, state trigger, transcript record and non-leak invariant. Rules/config hash freezes policy at publish.
- [ ] **D4** Number Hunt: public higher/lower with guesser+guess attribution or private; support off/on rules, target secrecy, budget, rate limit, room feed, reconnect and simultaneous guesses.
- [ ] **D5** Live Quiz: category/reasoning/elimination cues only, server-hidden answers and no premature explanation leaks.
- [ ] **D6** Memory Match: capped pair reveal that does not disclose/map the full board; reveal budget and shared vs private policy.
- [ ] **D7** Token Catch: tempo/lane cue that never reveals future spawns.
- [ ] **D8** Reaction Duel/RPS: only shared phase/commit/reveal state; never opponent move before allowed reveal.
- [ ] **D9** Puzzle Sprint: legal-move hint limited by budget; do not reveal path solution.
- [ ] **D10** Hash Hunt: truthful difficulty and own mining throughput; never solution nonce/private seed.
- [ ] **D11** Co-op Boss: shared phase/weakness cue and contribution data, no hidden player state.
- [ ] **D12** Reward Grid: only bounded proximity clue if fair distribution/budget/replay safety verified.
- [ ] **D13** Bingo: shared call history and accessible board state.
- [ ] **D14** Pattern Recall: capped replay/segment reveal without future sequence leakage.
- [ ] **D15** Typing Sprint: personal pace/accuracy cue; anti-cheat disclosure, do not leak other typed content.
- [ ] **D16** Maze Race: clue budget, no full route reveal.
- [ ] **D17** Level Runner: checkpoint telemetry, avoid future hazard leakage.
- [ ] **D18** Contract Detective: curated evidence clue tied to educational answer, not security-audit certification.
- [ ] **D19** MEV Rush: simulated queue state only, clearly not live mempool/MEV.
- [ ] **D20** Idle Rig: server-clock verified efficiency only; no off-chain hidden earning implication.
- [ ] **D21** Airdrop Quest: wallet-bound remaining requirements only; budget/date/eligibility clear.
- [ ] **D22** Each mode passes hint off/private/public/limited/reconnect/spam/fairness transcript/client-tampering/no-leak tests, as applicable.
- [ ] **D23** G09-G20 are individually implemented/reviewed. G21-G24 chance/prediction games remain legally gated or valueless demo-only until expert review.

## E. Contracts, custody, settlement, and economics (twice the UI priority)

- [ ] **E1** Source-of-truth inventory for deployed bytecode/source hashes, constructors, owners, authority/treasury, accepted assets, balances, liabilities, manifests, live/fork/local status. Do not treat fork broadcast as live deployment evidence.
- [ ] **E2** Threat-model each asset flow across deposit vault, game pot, reward escrow, registry, settlement authority, relayer/backend and frontends; independently review before value-bearing use.
- [ ] **E3** Formal accounting per token: user credit, creator deposits, entry pots, creator payout, protocol fee, locked reward reserve, refundable amounts, claimed amounts, reclaimable inventory, surplus. Invariants: balances >= liabilities; no sweep of committed assets; no double charge, payout, refund, or claim.
- [ ] **E4** Creator deposit: exact approve, balance readback, fee-on-transfer/rebase rejection, immutable unit/token identity; verified receipt and wallet/vault balance reconciliation.
- [ ] **E5** Treasury pathway: distinguish deposits directed into platform treasury from per-user credited deposits. Make hold/withdraw/manual burn treasury decision owner-only, exact amount, pause/guarded, audit and never accessible to a room settlement authority. Do not use unsupported burn semantics.
- [ ] **E6** Room economics: platform room fee separate from creator-chosen entry asset/amount. Creator selects creator payout wallet/share; validate range and display destination/split to every entrant before approval. Entry funds go exactly where pre-agreed.
- [ ] **E7** Reward lock: creator deposits ERC20/NFT/ERC1155 before registration; registry verifies token type; check exact inventory, receiver hooks, fee-on-transfer, rebase and malicious token callbacks.
- [ ] **E8** Auto payout is a true atomic push at settlement; manual payout is a wallet-bound pull claim with EIP-712/typed signature, nonce, deadline, domain chain/contract/room binding and replay protection. UI says which mode and consequence.
- [ ] **E9** Clarify current CenterGamePot implementation before use: signature arguments currently accepted but function body needs audit proving digest/signature validation actually exists; amount list must reconcile exactly with net pot; auto/manual branch behavior must match UI. Treat any failure as blocker, not as shipped.
- [ ] **E10** Refunds after cancel/failed start/settlement timeout and claim expiry; creator reclaim only after exact claim deadline; per-entrant refund once; no stuck liabilities.
- [ ] **E11** Admin signer rotation, treasury updates and fee changes require exact signer, bounded fee cap, delayed/dual approval as appropriate, events, readback and audit logs. Freeze immutable round economics.
- [ ] **E12** Treasury fee/sweep invariants: separate protocol fees accrued from user entries and rewards. Never derive “surplus” from off-chain values; on-chain tracked aggregate must be conservative and invariant-tested.
- [ ] **E13** Contract fuzz, invariant, adversarial malicious-asset, reentrancy, ERC721/1155 receiver, signature replay, expiry, callback, rounding/decimal, griefing and emergency/pause tests.
- [ ] **E14** Test actual transactions on chain 46630 via isolated wallets: deposit → create/fund → entry → game terminal state → settlement → auto/manual award → refund and reward reclaim. Record receipts, events, post-state and browser evidence.
- [ ] **E15** Token conversion is disabled unless exact route/liquidity verified; explicit user-signed swap, quote expiry, slippage/minOut, deadline, route whitelist, allowance bounds and failure isolation. No silent custodian conversion.

## F. Room transactions, backend, indexing, and player experience

- [ ] **F1** API/DB schema aligns with Solidity events/contracts and versioned room/hint policy hashes.
- [ ] **F2** Transaction state machine persisted and idempotent: unsigned → wallet requested → submitted → confirmed/finalized or failed/replaced/reorged; backend admits only after verified receipt.
- [ ] **F3** Durable event indexer with reorg/finality handling, dedupe, replay, monitoring, reconciliation report and recovery queue; not just live RPC balance polling.
- [ ] **F4** Attacker model for API/client hints, result submissions, wallet ownership, admission and settlement signer; clients never nominate authoritative winner or score.
- [ ] **F5** Join screen shows creator/payout wallet, entry amount/token, platform fee, reward reserve, preview/funded distinction, settlement mode, network, gas and refund/claim terms before wallet signing.
- [ ] **F6** Player can inspect contract/token provenance and state; unsupported tokens disabled with reason.
- [ ] **F7** Private invitation truly requires wallet allow-list/access credential; unlisted means share-link; public discoverability separate.
- [ ] **F8** Run two-wallet/browser end-to-end play with disconnect/resume and duplicate transaction attempts.

## G. MCP/tools and implementation systems

- [x] **G1** Taste Skill v2 installed in project Hermes skills; load before web design/review.
- [x] **G2** Vercel Web Interface Guidelines skill installed and current upstream checklist saved.
- [x] **G3** Awesome Design MD collection available to Taste skill; getdesign Vercel reference vendored and Orbix-specific design guide created.
- [ ] **G4** Verify Context7 MCP against real React/Motion docs, Playwright MCP against live Orbix routes, shadcn registry and Iconify search using mcp-server-verification skill. Record per-server observed result.
- [ ] **G5** Choose a coherent icon source/library compatible with current dependencies; no hand-drawn path proliferation or unnecessary dependency installs.
- [ ] **G6** Add repeatable scripts/task workflow for contract checks and Vite/browser checks, then document simple invocation and artifacts.

## H. Full browser QA/deploy/release

- [ ] **H1** Baseline console errors, network errors, accessibility snapshot, bundle sizes and route map.
- [ ] **H2** Playwright screenshots at desktop 1440, tablet 768 and mobile 390 for cockpit and each high-value Center route.
- [ ] **H3** Test keyboard, focus, reduced motion, hint-feed privacy, wallet connection, every wizard step, refresh/deep link/back-forward, errors and no-horizontal-overflow.
- [ ] **H4** Run Vercel guideline audit and Taste preflight; fix high-severity findings before visual polish.
- [ ] **H5** Run TypeScript, frontend build, all backend tests, Foundry build/test/invariant/security suite with counts and exact artifact hashes.
- [ ] **H6** Deploy only build artifacts that passed tests; do not modify backend env/security config blindly.
- [ ] **H7** Wait for Railway SUCCESS and verify live SPA title/body, bundle, API health/readiness and server environment.
- [ ] **H8** Verify real browser routes/flows post-deploy and attach screenshots. Deployment success alone is not feature success.
- [ ] **H9** Update V5/V6/checklist with shipped vs partial vs gated. Mainnet remains disabled.

## Priority rule
Complete E (mechanisms/contracts) and D (distinct game logic/hints) before claiming the product is near-complete. Visual work supports the flows but must not mask unimplemented settlement, uncertain custody or incomplete per-game engines. Aim for at least 2× effort on protocol/game correctness versus cosmetic design.
