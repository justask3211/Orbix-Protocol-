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
