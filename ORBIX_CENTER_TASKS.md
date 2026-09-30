# Orbix Center — Implementation Checklist

Source of truth: **ORBIX_CENTER_BUILD_MANUAL_V4.md** (supersedes V3). These tasks are pending; the manual itself is complete. Do not mark implementation done without the specified evidence (tests + browser proof).

Evidence standard: a task is only ticked when a command was actually run and its output recorded.
Rows marked **[partial]** name exactly what is missing; **[SKIP]** rows are deliberately not built.
Full evidence lives in `docs/center/STATUS.md`.

Order matters: do phases A→H in sequence. One active implementation task at a time. Every task ends with a `docs/center/STATUS.md` entry in the required shape.

## Phase A — Baseline and evidence

- [x] **A01** Record git status, package locks, current deploy ids, existing working UI and API routes; redact secrets. Create `docs/center/STATUS.md` with baseline evidence.
- [x] **A02** Document audit gaps from manual section 1; isolate the old demo. Rename the displayed "pot" to preview points until actual funding exists. Preserve the WIP banner.
- [x] **A03** Add feature flags: CENTER_PREVIEW=true, CENTER_TESTNET_REWARDS=false, CENTER_REAL_BURN=false, CENTER_MAINNET=false. Reject enabled funded flags if addresses/chain/storage are missing. Write startup tests.
- [x] **A04** Verify chainId 46630 via RPC, current launchpad version via official contract/ABI, and backend account limits before integration. If blocked, keep launchpad discovery optional; do not stop Center's ERC-standard work.

## Phase B — Product shell and design

- [x] **B01** Implement Center routes and nav in the current frontend (Wallet/Vault, Catalog, Rooms, Create, Rewards, Studio). Existing Swap/Bridge/Pools/Launch/NFT flows remain intact. Route refresh and back/forward tests.
- [x] **B02** Implement the Orbix-matched theme tokens (manual section 6: charcoal `#0b0c0e`, panel `#121416`, line `#272a2d`, muted `#85888d`, accent `#ff6b22`, live `#69d9c8`, green `#a4d46d`, `Manrope` + `DM Mono`), the Room Capsule, per-game marks/illustrations and the responsive shell. Screenshot review at mobile/tablet/desktop; contrast and keyboard checks. **Verify the palette actually matches `web/src/styles.css`, not an off-brand set.**
- [x] **B03** Catalog all templates with honest "Live preview" / "Coming later" states. Implement search and filters; every card opens a real detail page (no dead cards). **[partial]** free-text search and multi-filter chips are not built.
- [x] **B04** Implement the schema-driven creator wizard, live preview, autosave, draft restore, simulated-vault access overlay, reward picker, invitation configuration and publish review. Required error states tested. **[partial]** autosave of an in-progress draft is manual (Save draft), not continuous.
- [x] **B05** Implement the per-game stage layouts from manual section 20 (Number Hunt dial, Quiz card stack, Memory board, Catch lanes, Duel pads, Puzzle board, Hash rig, Boss raid) plus the cross-cutting smoothness rules (reduced motion, reconnect scrim, refund/timeout UX). **[partial]** the reduced-motion query and open-graph previews are not built.

## Phase C — Durable realtime foundation

- [x] **C01** JSON Schema + Pydantic + Zod consistency fixtures; reject extra fields and unsafe cross-field settings. **[partial]** the Zod mirror on the client is not wired as a validation pass.
- [x] **C02** DB migrations/repos, ownership/auth, idempotency and outbox. Test competing updates and restart persistence.
- [x] **C03** Room lifecycle and scheduler. Time-controlled tests with no connected clients; no terminal-state overwrite.
- [x] **C04** WebSocket protocol, bounded queues, stable identity, reconnect/resync, origin checks, deadlines, auth timeout, message limits.
- [x] **C05** Public/unlisted/private invite model; test a leaked URL cannot bypass true private eligibility.
- [x] **C06** **Unified Liquidity Vault**: deposit + exact approve, single `deduct` per publication intent, ledger export, simulated balance label, and the creator-absorbs-joiner-fee toggle. Test idempotent deduct, double-publish retry, over-balance refusal, per-wallet joiner-fee cap. **[partial]** the joiner-fee cap is one fee per (room, joiner); a rolling per-wallet cap across rooms is not implemented.

## Phase D — All release-one engines

- [x] **D01** Number Hunt: all three modes + randomize + budgets + tie policy + **4-digit mode with first-four-digit input truncation (typing and paste)** + `digits` width boundaries.
- [x] **D02** Live Quiz: authoring/import + private answer storage + score rules + timed answer lock.
- [x] **D03** Memory Match: server-authoritative flips + reconnect.
- [x] **D04** Token Catch: deterministic spawn + input validation + mobile lanes.
- [x] **D05** Reaction Duel: readiness/cue/latency/timeout logic.
- [x] **D06** Puzzle Sprint: solvable generator + move validation.
- [x] **D07** Hash Hunt: bound proofs + Web Worker + bot API + stop controls.
- [x] **D08** Boss Raid: authoritative actions + contribution allocation.

For EACH D task: engine reducer, rules schema, client renderer, host preview, lobby/play/results integration, private/public behaviour, reward allocation interface, replay tests and adversarial tests. All eight engines met this bar: a two-client WebSocket playthrough plus a mid-round restart/resume test. No dead "Play" buttons.

## Phase E — Escrow, vault contracts and claims

- [x] **E01** Write the escrow threat model and integer accounting tests before contract code.
- [x] **E02** Implement CenterVault + registry + escrow + settlement verifier and the mock-access adapter. No user-token launch.
- [x] **E03** Unit/fuzz/invariant tests, malicious asset tests, reentrancy tests, duplicate/cross-chain/contract replay tests and refund timeout tests. Review findings independently.
- [x] **E04** Implement receipt/code generation, proof persistence/export, Rewards UI and exact-amount wallet flows.
- [x] **E05** Deploy to local Anvil and run full prefund → entry → play → settle → claim with ERC-20, ERC-721 and ERC-1155 mock assets. Funded flags stay off until this passes.
- [ ] **E06** After explicit authorization: deploy the verified build to Robinhood testnet 46630, read bytecode/config/signers/deadlines back, record addresses/txs/ABIs in the deployment manifest, repeat the live flow using an isolated wallet. **Not done** — the manual requires explicit owner authorization for a real deployment; nothing was deployed to a live chain.

## Phase F — Integration and polish

- [x] **F01** Creator storefront, Studio room operations, real inventory and claim dashboard. **[partial]** real inventory browsing is not built (no token exists yet).
- [x] **F02** Transaction state sheet: pending/finalized, rejected wallet request, insufficient test gas, wrong chain, wrong recipient, already claimed, API outage and RPC outage. **[partial]** the preview build has no on-chain transaction path to surface; only API and round errors are shown.
- [x] **F03** Sound opt-in, reduced motion, restrained win animation, SVG artwork, OG previews and mobile ergonomics. **[partial]** per-format CSS artwork exists; sound and OG images do not.
- [ ] **F04** Load/recovery tests and structured monitoring. Audit origin/cookies/CSP/upload sanitization, dependency vulnerabilities, chain-event forgery and XSS. **Not done** — no formal load/recovery run and no security audit.
- [x] **F05** Railway staging deploy, browser playthrough of all eight templates, readback of exact targets, verify the warning banner and preview-vs-funded labels. Do not switch public production blindly.
- [x] **F06** Production preview release, observed logs and smoke tests; no mainnet stakes. Document missing features as disabled, not completed.

## Phase G — Remaining catalog, token activation and economics

- [ ] **G01** Implement G09–G20 one template at a time using the D-task checklist (full specs in manual section 3). Keep casino-style G21–G24 behind legal/demo restrictions.
- [ ] **G02** Token launch is a separate owner-approved action after metadata/name/ticker/supply/launchpad compatibility review. Verify transfers/burn semantics, contract metadata and public description. Never substitute the legacy token without approval.
- [ ] **G03** Activate the true creator **vault deduction** per immutable publication intent only after end-to-end testnet review. Restore a failed-publish access through a consumed-intent retry, never a second deposit. Owner sets the required per-room amount and the optional joiner fee.
- [ ] **G04** Optional rake conversion and creator economics after reviewed accounting, route safety and explicit fee disclosure. No unverified ecosystem rewards or guaranteed appreciation claims.

## Phase H — Brainstorming backlog (manual section 19.2, not release one)

- [ ] **[SKIP]** **H01** Season boards: most-played/most-created rooms and a creator reputation score from completed rooms.
- [ ] **H02** Team rooms: shared rosters and team scores for Boss Raid and Quiz.
- [x] **F08** Browser-driven bug hunt on the live domain found and fixed four real defects: (1) mev-rush `tick()` patch sent `live` as an int over the snapshot's array — SPA white-screened on round start; (2) logo-bingo `tick()` sent `calls` as a count over the array — same crash class; (3) the wizard sent `duration_seconds`/`max_players` into rules that forbid them — publish rejected for live-quiz, reaction-duel, memory-match; (4) the start check clamped min_ready by player count, letting a host start a 2-ready room alone. Added `center/tests/test_patch_safety.py` (19 parametrized patch-type collision tests, whole bug class). 100 tests green. Verified on production: all 19 formats publish → join → ready → start → stage renders; premature start now refused ("Not enough players are ready yet"). Deploys 60349e83 (center), 490bcbef (center), 4c7fb1dc (site), c9f4d882 (center), 2026-09-30.
- [ ] **H03** Watch-party / spectate replay: read-only spectator socket replaying an ordered action stream.
- [ ] **H04** Referral attribution: creator-funded bounty pool, never funded from player entries.
- [ ] **H05** Vault loyalty perks (higher balance or lower per-room price), disclosed, never a guaranteed return.
- [ ] **H06** Gift-a-room: first N joiners free, capped and deducted from the creator's vault.
- [ ] **H07** Scheduled recurring rooms: bounded series with hard campaign budget and stop date.

## Refused / deferred (do not build without review)

- [ ] **X01** Rake-to-burn with any buyback or appreciation promise — deferred to legal review.
- [ ] **X02** Client-authoritative scoring or client-selected randomness — never.
- [ ] **X03** Executing creator-submitted code on the API process — never (Gas Golf only, in an isolated bounded worker).
- [ ] **X04** Trial-rotation to bypass provider limits — never; migrate legitimately with backups.
- [ ] **X05** Re-skinning an existing engine as a "new game" — never; each template needs its own reducer, validator and tests.
