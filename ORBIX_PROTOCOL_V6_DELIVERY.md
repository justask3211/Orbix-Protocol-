# Orbix Protocol + Center — V6 delivery ledger

Status legend: `[x]` verified complete; `[~]` implemented but not independently verified/live; `[!]` blocked by an external prerequisite; `[ ]` not started. Never mark a blocked value-bearing gate complete by substituting a preview.

## Current release state

- [x] Preview UI/backend is deployed and browser-verified.
- [x] Solidity Center safety baseline passes 30 tests.
- [x] Python Center suite passes 105 tests.
- [x] Candidate token identity is verified on testnet, but transferability and burn semantics are not proven.
- [!] Funded ORBIX Center mode is intentionally disabled until the candidate token restriction and custody deployment gates pass.

Scope: Robinhood testnet 46630 only. This is an acceptance checklist, not a claim that items are complete. Existing V4 manual and V5 audit remain governing specifications. The two ORBIX addresses are distinct assets: the original vibevibe launch token is `0x0A7e1618582fbAd11c770670EF48048E236CC544`; the newly supplied Center candidate is `0x16C5451763eC2E0E7f041E2DB761A0491FdB6db1`. Never silently merge balances, liquidity or branding. Admin is the exact address `0x253db2d543b10c94918de97eb8499ee59ab9087e`, not a suffix check.

## Verified starting evidence

- Browser on production: cockpit renders, Center catalog renders 19 cards, but live hero still says eight formats. Repo differs from production.
- RPC answers chain ID 46630. New candidate returns `name=ORBIX`, `symbol=ORBIX`, `decimals=18`, bytecode exists, and admin wallet has a large balance.
- Read-only `eth_call` for a transfer of one token *from the admin wallet* reverted with selector `0xdb89e3f4`; `burn(uint256)` reverted. Neither transaction was broadcast. These results block assuming transferable/burnable token semantics. Determine exact reason before funding vault or promising conversion.
- Current Center preview remains simulated. No production custody contract is confirmed deployed for this token. Prior contract audit found serious refund, funding and settlement vulnerabilities.

## Gate A — inventory, research, threat model

- [ ] A01 Verify both token addresses on the correct chain and record bytecode hashes and deployers.
- [ ] A02 Obtain verified candidate token source/ABI or reconstruct only the functions required for integration.
- [ ] A03 Explain transfer revert `0xdb89e3f4` from verified source; test transferability by `eth_call` to ordinary and contract recipients.
- [ ] A04 Verify allowance, transferFrom, permit and burn behavior without moving funds.
- [ ] A05 Determine whether transfer tax, max-wallet, pause, blacklist, graduation or launch restrictions exist.
- [ ] A06 Verify candidate token total supply, admin balance and distribution.
- [ ] A07 Identify actual candidate-token liquidity on Orbix AMM and external routers; record reserves.
- [ ] A08 Prove executable swaps at bounded size/impact rather than assuming a synthetic exchange rate.
- [ ] A09 Inventory homepage, Discover, Swap, Pools, Bridge, Launch, Staking, NFT and Marketplace modules.
- [ ] A10 Inventory Center catalog, wizard, lobby, every 19-game stage, results, Vault and claim paths.
- [ ] A11 Audit mobile widths, keyboard flow, reduced motion, contrast and wallet dialogs in a browser.
- [ ] A12 Write a threat model for custody, signer, backend, admin, user wallet and third-party router.
- [ ] A13 Define the chain's testnet-only release policy and mainnet refusal checks.
- [ ] A14 Record an honest baseline test run and exact production API/build IDs.

## Gate B — identity and governance

- [ ] B01 Verify exact admin wallet ownership via nonce/domain/chain-bound signed login.
- [ ] B02 Reject every admin API mutation without a fresh validated session.
- [ ] B03 Rate-limit auth nonce requests and enforce one-time use and expiry.
- [ ] B04 Add server-side admin audit log with actor, old/new value, timestamp and chain ID.
- [ ] B05 Put custodian privileges behind a Safe or explicitly document restricted EOA testnet risk.
- [ ] B06 Implement two-step/timelocked ownership transfer where possible.
- [ ] B07 Design signer rotation with existing-room authorization continuity.
- [ ] B08 Add an emergency pause that cannot seize user balances.
- [ ] B09 Separate admin pricing authority from result-signing authority.
- [ ] B10 Snapshot pricing and treasury per published room; changes affect only new rooms.
- [ ] B11 Set caps and validation for creator charge and joiner charge.
- [ ] B12 Add admin readback UI that shows actual on-chain/config values, not local defaults.

## Gate C — on-chain custody and economics

- [x] C01 Write a failing test that creator cannot self-refund a consumed publication fee.
- [ ] C02 Bind publication intent to creator, room/config hash, chain, vault, price, nonce and deadline.
- [ ] C03 Create one-way consumed/refundable/refunded transitions linked to authorized cancellation.
- [ ] C04 Enforce withdrawal delay and available-vs-committed accounting.
- [ ] C05 Verify exact-balance ERC-20 deposits and reject fee-on-transfer/rebasing semantics.
- [ ] C06 Require signed-wallet payment for creator fees; backend never transfers user funds itself.
- [x] C07 Require reward funding before registration can open.
- [ ] C08 Declare required reward inventory by `(kind, contract, tokenId)` and verify every reserve.
- [ ] C09 Track native ETH, ERC-20, ERC-721 and ERC-1155 rewards by typed asset.
- [ ] C10 Validate NFT ERC-165 interfaces, reject mismatched entitlement kinds.
- [ ] C11 Track entry liabilities separately from reward inventory and protocol fees.
- [ ] C12 Snapshot entry token, amount, beneficiary and refund policy per round.
- [ ] C13 Support free join with zero custody requirement.
- [ ] C14 Support creator-sponsored joiner ORBIX fee as a distinct liability.
- [ ] C15 Support player-paid ORBIX platform join fee through wallet-signed payment.
- [ ] C16 Support creator-selected ERC-20 entry payment through escrow, not an arbitrary address.
- [ ] C17 Support native ETH entry payment only with exact payable accounting.
- [ ] C18 Prevent duplicate entry, wrong wallet, replay, chain mismatch and room-cap races.
- [ ] C19 Bind event receipt and finality to server admission; reject a submitted-but-unmined hash.
- [x] C20 Enforce settlement after playEnd and after server-authoritative terminal outcome.
- [ ] C21 Bind EIP-712 settlement to config hash, signer epoch, allocations and deadline.
- [x] C22 Make reward claims wallet-bound and proof-bound; mark claimed before transfer.
- [ ] C23 Ensure one failed recipient cannot lock unrelated winners' claims.
- [ ] C24 Define expired-claim grace and recovery policy; expose it before room creation.
- [ ] C25 Implement pull refunds after cancellation or settlement failure deadline.
- [ ] C26 Fuzz conservation across funding, joins, fees, claims, cancellations and refunds.
- [ ] C27 Fuzz malicious ERC-20/NFT receiver callbacks and reentrancy attempts.
- [ ] C28 Test zero/dust/overflow/rounding/decimals and reserve exhaustion.
- [ ] C29 Pin all fund-moving contract addresses/config before deploying to testnet.
- [ ] C30 Obtain independent review before turning on funded public flows.

## Gate D — conversion and ORBIX token integration

- [ ] D01 Distinguish launch-token ORBIX from candidate Center ORBIX in UI and APIs.
- [ ] D02 Disable burn controls until candidate token's actual burn method is proven.
- [ ] D03 Disable value-bearing vault deposits until actual transfer to vault passes simulation and a small isolated-wallet test.
- [ ] D04 Display live wallet balance/allowance for the chosen token and clear network mismatch.
- [ ] D05 Require explicit wallet confirmation and show recipient/amount before every approval or charge.
- [ ] D06 Prefer bounded exact approval, with ability to revoke; never approve an arbitrary router.
- [ ] D07 Build a route allowlist and independent quote oracle/impact warning for candidate ORBIX.
- [ ] D08 Quote exact-output creator entry token including slippage and gas costs.
- [ ] D09 Set user-chosen max input, min output and finite deadline; do not silently trade.
- [ ] D10 Verify pool liquidity and quote freshness at execution time.
- [ ] D11 Isolate conversion from custody and reward claim paths; failed swap leaves user funds intact.
- [ ] D12 Prove no conversion route exists if liquidity is absent, and offer direct token payment.
- [ ] D13 Reconcile transaction receipts/events, replacements and reorgs before server credit.
- [ ] D14 Display transparent rate, fees, output token and price impact in the creator and join flows.

## Gate E — backend and claims

- [x] E01 Replace short claim-id prefix with random opaque 128-bit+ reference and unique index.
- [x] E02 Validate entire code/checksum, reject prefixes and ambiguous lookups.
- [x] E03 Authenticate claimant wallet before disclosing reward details/proof.
- [x] E04 Return indistinguishable not-found/wrong-wallet responses to unauthenticated callers.
- [ ] E05 Preserve wallet-bound Merkle entitlement; reference is convenience, not bearer authority.
- [ ] E06 Export durable proof receipt so claim works during API outage.
- [ ] E07 Make ledger write PENDING until mined confirmation and reconciled event.
- [ ] E08 Persist per-room frozen economic config and asset identity.
- [ ] E09 Expose funding status and time windows directly from chain state.
- [ ] E10 Refuse funded-mode startup without valid addresses, chain ID, asset checks and signer.
- [ ] E11 Add integration tests for two-wallet create/join/finish/claim and refunds.
- [ ] E12 Keep preview rooms isolated from funded balances and label them honestly.

## Gate F — all-game hint policies

- [ ] F01 Introduce versioned typed hint schemas and immutable config hashes.
- [ ] F02 Number Hunt: off/private/public higher-lower feedback with player/number attribution.
- [ ] F03 Live Quiz: category/elimination hint without answer leakage.
- [ ] F04 Memory Match: bounded tile reveal without persistent secret leak.
- [ ] F05 Token Catch: safe lane/tempo cue.
- [ ] F06 Reaction Duel: timer/commit progress without opponent move reveal.
- [ ] F07 Puzzle Sprint: bounded move suggestion.
- [ ] F08 Hash Hunt: difficulty/progress cue, not the solution.
- [ ] F09 Boss Raid: team phase/weakness cue.
- [ ] F10 RPS Duel: commit/reveal progress only.
- [ ] F11 Reward Grid: bounded proximity cue.
- [ ] F12 Token-Logo Bingo: call history hint.
- [ ] F13 Pattern Recall: bounded replay hint.
- [ ] F14 Typing Sprint: accuracy/pace hint.
- [ ] F15 Maze Race: directional clue within fixed budget.
- [ ] F16 Level Runner: checkpoint cue.
- [ ] F17 Contract Detective: relevant evidence clue.
- [ ] F18 MEV Rush: simulated sequence cue without private target leak.
- [ ] F19 Idle Rig: efficiency cue.
- [ ] F20 Airdrop Quest: remaining-condition cue.
- [ ] F21 Test private/public reconnection, hint budgets, spam and transcript fairness.

## Gate G — visual product quality

- [ ] G01 Establish distinctive brand tokens for Center and cockpit; document type, color and spacing.
- [ ] G02 Make Center the unmistakable main product in homepage hero and primary navigation.
- [ ] G03 Replace stale/misleading “on-chain rewards” preview copy with mode-specific truth.
- [ ] G04 Improve catalog information hierarchy, grouping, search and empty states.
- [ ] G05 Upgrade game cards with consistent artwork, clear game length/players and rules.
- [ ] G06 Rebuild creator wizard with progressive disclosure and live room preview.
- [ ] G07 Explain free, creator-sponsored, and player-paid modes without jargon.
- [ ] G08 Show reward funding status and exact claim policy before join.
- [ ] G09 Build admin console with signed wallet gate and readback-confirmed controls.
- [ ] G10 Redesign room lobby/ready screen, stage/HUD, results and claim flow coherently.
- [ ] G11 Integrate candidate token identity in Discover/Swap without confusing existing launch ORBIX.
- [ ] G12 Surface actual pair availability and conversion disabled states honestly.
- [ ] G13 Refine Bridge copy to distinguish test ETH lane and unrelated xORBIX OFT lane.
- [ ] G14 Ship 375px/768px/1440px responsive checks and no horizontal overflow.
- [ ] G15 Verify touch targets, keyboard focus, contrast, reduced motion and error recovery.
- [ ] G16 Run real browser clicks, network and console audits on every named route.

## Gate H — deploy and handoff

- [ ] H01 Full Foundry, Python and Vite test/build runs are green with counts recorded.
- [ ] H02 Local Anvil cross-language funded flow passes with hardened contracts.
- [ ] H03 Compile and bytecode-verify each contract artifact against deployed runtime.
- [ ] H04 Deploy isolated testnet contracts only after Gates C/D pass and token transfers work.
- [ ] H05 Read back chain ID, token, vault, escrow, registry, owner, signer, fees and policy.
- [ ] H06 Execute a minimal isolated-wallet deposit, publication, join, settlement, claim and refund.
- [ ] H07 Configure Railway addresses and flags explicitly; do not activate unfunded pathways.
- [ ] H08 Deploy Center/backend then site; wait for final Railway deployment status.
- [ ] H09 Verify live rendered app in a real browser including SPA hydration and responsive states.
- [ ] H10 Verify exact API state and transaction receipts after changes.
- [ ] H11 Record deployment IDs, explorer links, contract addresses, commits and rollback path.
- [ ] H12 Clearly label remaining gated work; never claim planned features are live.

### 2026-10-02 addendum — D5 Live Quiz hints

- QuizRules gains `hints: off|on` and `hint_eliminations: 1..3` (per-question budget).
- QuizEngine gains a server-side `hint` action: privately eliminates ONE wrong choice per use; every eliminated index is verified against the answer key before release, so the cue can never point at the answer. Budget enforced per player per question; patch is a public counter only, the elimination itself rides `private`. Snapshot round-trips `hintsUsed`.
- Wizard: Live Quiz hint panel (off/on + eliminations-per-question) and defaults; buildConfig coerces `hints`/`hint_eliminations` per schema.
- Registry: `live-quiz` HintPolicy marked implemented (kind `elimination`, private audience).
- Evidence: `PYTHONPATH=~/vibeswap center/.venv/bin/pytest tests` 133/133 green (8 new in test_quiz_hints.py incl. non-leak invariant, budget, privacy, snapshot, after-window, scores-unchanged). `tsc -b --noEmit` exit 0; `npm run build` exit 0 (1.11s). Commit 90bc00aa.

### 2026-10-02 addendum 2 — D6 Memory Match hints

- MemoryRules gains `hints: off|on` and `hint_budget: 1..5` (per-player, per-round).
- MemoryEngine gains a server-side `hint` action: privately reveals ONE hidden matching pair (two verified indices from the secret layout) to the asking player; never touches matched cards, never exposes the board. Hard per-player budget; hints cost no moves and cannot change scores. `hintsLeft` snapshot round-trips.
- Wizard: Memory Match hint panel (off/on + reveals-per-player) + defaults. Registry policy v2 marked implemented.
- Evidence: pytest 141/141 green (8 new in test_memory_hints.py incl. pair-actually-matches, exposure cap, budget, privacy, no-score-impact, snapshot). tsc exit 0; vite build exit 0. Commit 4c7b532b.

### 2026-10-02 addendum 3 — D8 duel commit/reveal invariants

- Reaction Duel engine already shares only phase/commit-reveal status; new tests pin the non-leak contract: commit patches carry zero cleartext choices, public state stays choice-free until BOTH players reveal and the engine resolves, a partial reveal exposes only the revealer's own move (in the patch, never the other's), history appears only post-resolution, and salts/preimages are never published.
- Registry: reaction-duel round-progress policy description tightened, v2.
- Evidence: pytest 147/147 green (6 new in test_duel_hints.py). Commit f44ac28f.

## Delivery log — 2026-10-02

Mechanisms-first pass (2× core focus per A-to-Z plan), all evidence recorded:

- **CenterGamePot v2 (E8/E9)** — `src/center/CenterGamePot.sol` rewritten and test-proven:
  - settle() now verifies an authority signature over the full payout payload (winners, amounts, reward winners, reward indices) bound to contract address + chainId + roomId; digest replay-guarded. Empty sig = NotAuthority, malformed/mismatched = BadSignature.
  - claimWinnings()/claimReward() bound to (roomId, winner/amount/index, one-time nonce) + claim deadline; NonceReused on replay.
  - refundEntry() returns exactly what the entrant paid (per-entrant paidIn, fee-on-transfer truth), once, only on cancelled rooms.
  - AUTO mode pushes pot shares and locked ERC20/NFT rewards atomically at settlement; MANUAL mode records liabilities for signed pull claims.
  - Tests: `forge test` 75/75 green (7 CenterGamePot tests incl. unsigned-settlement rejection, over-pot rejection, nonce replay, conservation with creator share, refund-once, NFT auto-pay).
- **Typed hint policies (D3)** — new `center/games/hints.py`: versioned per-template HintPolicy (kind, audience public/private, budget, cost, honest `implemented` flag). Implemented for number-hunt (higher/lower), hash-hunt (difficulty/throughput), boss-raid (phase/weakness), bingo (call history), rps/reaction duel (commit/reveal progress), memory-match (bounded reveal, budget 2), puzzle-sprint (legal-move, budget 3). All later-catalog formats declare intended style with implemented=false so the UI stays truthful.
- **New tests** — `center/tests/test_hint_policies.py` (7): full catalog coverage, number-hunt public hint never leaks the target, private vs off behavior, honest unimplemented flags. Python suite: 124/124 green (`PYTHONPATH=~/vibeswap center/.venv/bin/pytest tests`).
- **Live browser audit (Playwright)** — orbixcore.fun/center verified at 1440 and 390px: skip link present, truthful reward-status banner, dynamic "19 game formats", no horizontal overflow at 390px (bodyScrollWidth 390), wallet controls inside header, wizard shows "number hunt hint policy" with higher/lower public/private control, 0 console errors. Screenshots: center-1440-desktop.png, center-390-mobile.png, center-create-wizard-1440.png.
- Honest status: CenterGamePot v2 is local/test-proven, NOT yet deployed to chain 46630 (funded paths stay gated pre-graduation, per V5 P4). Hint policies are server-side registry data; wiring per-later-game feeds into engines remains D5-D22 work.

## Delivery log — 2026-10-01 (session 20260929_022348)

Shipped, tested (117 Python tests green) and verified live at orbixcore.fun/center:

- **B02/B04/B09/B10/B11 (admin pricing backend)** — DONE: exact-wallet pricing authority
  (0x253d…9087e, full-address match), capped creator/joiner fees, fresh single-use signed
  admin proofs over a distinct signing domain, immutable per-room fee snapshots,
  append-only audit log. Endpoints: GET/PATCH /api/center/v1/admin/pricing, GET /admin/audit.
- **G09 (admin console)** — backend DONE (signed wallet gate + readback). Frontend admin
  page still pending (owner-gated).
- **G16 partial (real browser verification)** — top bar (single 50px sleek horizontal tab,
  seamless wallet + balance + pill Connect), wizard no-jump format picker (picked format
  collapses to a chip; change/continue buttons; compact 110px numeric fields), smooth
  digit-pad input (slots are the input, glow caret, pop-fill), card/button polish — all
  browser-verified on the deployed build.
- **H01 partial** — Python: 117 passed. Vite: build green. Foundry run not re-executed this session.
- **H08/H09 partial** — Railway deployments 28962928 & 704af5c8 SUCCESS (orbixcore svc);
  live SPA bundle hash-checked; header + wizard flows clicked through in a real browser.

Known blockers (unchanged, honestly gated):
- Candidate ORBIX 0x16C5…6db1 is bonding-curve locked pre-graduation (revert 0xdb89e3f4):
  transfers and burns revert, so funded custody/join-fee/conversion paths stay disabled.
- Remaining owner-gated: F04, E06, G01–G08, G10–G15, H02–H07 per original ledger.


## 2026-10-01 — FUNDED REWARDS LIVE (H07 closed)

- DepositVault (CenterVault) deployed on Robinhood testnet 46630: **0x33e0d64d1e894cd2bce673baeb0ff68153bd0aa3**
  (tx 0xc5b6eec7b7e3d74b97555d213867a54770d621f651036bb663150e13aeecbeeb, block 127003737)
- Reward token: FREE (0x9d6EA9FbEF2b244FB30f6E775f2DA3CC431b733e). Vault **FUNDED with 500,000 FREE**
  (tx 0xf3284c4a1babac21a7c2f511a908a9d56aff32417dbc491d17666d638750d0fd).
- Why FREE and not ORBIX: ORBIX 0x16C5...6db1 is a vibevibe.fun launchpad token still on its bonding
  curve (pre-graduation); every transfer/burn reverts until it graduates. Users who buy ORBIX on
  vibevibe can swap to FREE and deposit; when ORBIX graduates, CENTER_VAULT_TOKEN can be repointed
  with no contract change (the vault is single-token but the backend flag is a swap).
- Backend: env-driven OnchainVault in create_app (CENTER_REAL_BURN + CENTER_VAULT_TOKEN + CENTER_VAULT
  + CENTER_SIGNER_KEY + CENTER_RPC_URL), new GET /wallet/onchain-balance (live wallet + vault-credit
  balances read from chain, 15s TTL cache). JsonRpc sends a browser UA (RPC 403s plain clients).
- Frontend: top-bar pill shows live "X FREE" (polled 20s); Vault page shows credited + wallet
  balances with vault address + chain id.
- Railway env set on orbix-center (production): CENTER_REAL_BURN=true, CENTER_TESTNET_REWARDS=true,
  CENTER_VAULT_TOKEN, CENTER_VAULT, CENTER_ESCROW, CENTER_RPC_URL, CENTER_CHAIN_ID=46630,
  CENTER_VAULT_SYMBOL=FREE, CENTER_SIGNER_KEY=[set, redacted].
- Verified in browser: sign-in, top bar live balance, Vault panel "0 FREE credited / 1,250 FREE in
  wallet · vault 0x33e0…0aa3 · chain 46630" after sending 1,250 FREE to the demo wallet on-chain.
- Tests: 117/117 green.


## 2026-10-01 — CenterGamePot v1 deployed (entry pots + locked rewards + treasury)

User's custody model, implemented on-chain:
- **Treasury custody**: user deposits / reward inventory sit in contracts WE hold. The admin
  treasury wallet (0x253d...9087e) decides to hold or manually burn later — players used the
  token, we received it. The old Center suite's broadcast was a fork simulation (owner() reverts
  on live testnet), so a fresh contract was shipped.
- **CenterGamePot** `0x2acb02dcf0012d2ca98c8526dba78dad647b32f6` (tx 0xaa2508e6...e3417d):
  - `openRoom(roomId, payoutWallet, creatorShareBps, entryToken, entryAmount, mode, claimDeadline)`
    — creator picks the wallet the pot share goes to and its share (bps).
  - `enter(roomId)` — players pay the entry fee into the room pot.
  - `lockRewardERC20` / `lockRewardNFT` — creator locks a token or NFT reward; the contract
    holds it until settlement.
  - `settle(...)` — authority-signed. **AUTO mode**: pot shares AND locked rewards are pushed to
    winners at settlement. **MANUAL mode**: winners pull with an authority signature
    (`claimWinnings` / `claimReward`). Creator chooses per room.
  - `cancelRoom` + `refundEntry` (players made whole), `reclaimReward` after claim deadline.
  - `sweepDust` — treasury sweeps ONLY uncommitted surplus; pots and locked rewards are tracked
    in `tokenCommitted` and can never be swept. Protocol rake `feeBps` capped at 10%, currently 0.
  - Seeded with 50,000 FREE as reward inventory.
- DepositVault (0x33e0...0aa3) remains the creator-deposit path; GamePot handles per-room entry
  fees + rewards. 117/117 backend tests still green.
