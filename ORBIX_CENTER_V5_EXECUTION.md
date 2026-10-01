# Orbix Center V5 — execution plan and acceptance ledger

Status: AUDIT IN PROGRESS. Supersedes no security gates from V4. This document is a work plan, not evidence that any funded feature is live.

## Verified baseline

- Current site serves the cockpit and Center; Center catalog renders 19 playable preview formats, while its hero incorrectly says “Eight game formats.” Browser audit captured rendered controls and copy.
- Existing `CenterVault`, `CenterEscrow`, `CenterRegistry`, and `SettlementVerifier` are local/test contracts; V4 E06 (live-chain deployment and readback) is NOT complete. Production Center explicitly says vault balances are simulated and funded payouts are disabled.
- Supplied token `0x16C5451763eC2E0E7f041E2DB761A0491FdB6db1` answers `symbol() = ORBIX`, `name() = ORBIX`, `decimals() = 18` on Robinhood testnet chain 46630; bytecode exists. The `owner()` call reverted, so do not assume ownable ERC-20 semantics or burn support without ABI/bytecode review. The admin address from prior deployment records is `0x253db2d543b10c94918de97eb8499ee59ab9087e`; wallet suffix alone is NOT authorization.
- `RoomRuntime.join` has a TODO for paid entry; there is no confirmed on-chain deposit/admission binding today. The current claim code is an eight-hex-character prefix of a claim ID: it is a lookup convenience, not a secret or authorization. Real claim entitlement is wallet-bound and Merkle-verified. Do not market preview codes as paid claims.

## Product and UI direction

- Audience: creators who want their own tokens, NFTs and communities to have a playable use-case, and players who want real rooms with clear rules. Page job: enter a live room or create one with no ambiguity about the money mode.
- Palette: charcoal `#0b0c0e`, panel `#121416`, line `#272a2d`, signal orange `#ff6b22`, live teal `#69d9c8`, earned green `#a4d46d`.
- Type: Manrope for display/body and DM Mono for monetary states, proofs, and wallet identifiers (V4 theme). Structure: Center as the main product, cockpit as its DeFi rails. Signature: an interactive room-capsule preview where the creator’s chosen asset, join gate, hint policy and reward route update together.
- Keep animations purposeful (room state transitions and win feedback), respect reduced motion, 44px touch targets, keyboard navigation and contrast. No misleading “real reward” claims on preview routes.

## Delivery phases and hard acceptance gates

### P0 — baseline and evidence
- [x] Read V4 manual/checklist, critical code and live browser copy. Record the discrepancy between preview-only product copy and desired token activation.
- [ ] Audit all current routes on desktop/mobile, console/network errors, all 19 formats and wizard/lobby/results flows; preserve screenshots/DOM notes.
- [ ] Run existing Python, Foundry and Vite tests as baseline; record commands and output in STATUS.md.

### P1 — trust boundaries, token and admin
- [ ] Inspect token bytecode and ABI (ERC-20 transfer, approvals, burn method, transfer-tax, pausing, blacklist, freeze mechanics) on chain 46630. Establish pool liquidity and safe conversion routes, not an assumed price.
- [ ] Add a read-only token identity/status API and UI badge with independently verified chain ID; no automatic crediting of balances from a mere client claim.
- [ ] Implement admin authentication via signed wallet nonce and exact address `0x253db2d543b10c94918de97eb8499ee59ab9087e` on the SERVER. Every admin mutation needs owner check, audit log, caps, and readback. A hidden page or suffix comparison is not security.
- [ ] Owner-configurable creator price, joiner platform fee, treasury, accepted assets and caps. Immutable fee snapshot per published room; never retroactively alter open rooms.

### P2 — fund custody and room economics
- [ ] Design token charge as an on-chain, wallet-signed transfer/deduction (or real burn ONLY if token implements burn and owner opts in). `CenterVault.deduct` currently spends the caller's own balance, so backend cannot deduct a user's balance without their signature; never substitute a backend wallet.
- [ ] Separate platform ORBIX creation charge, ORBIX joiner platform fee, and creator-defined entry asset/amount (ERC-20 or native ETH). A creator may sponsor platform join fees but not silently override creator-defined entry stakes.
- [ ] On-chain entry confirmation MUST precede server admission/ready; bind `(chainId, escrow, roundId, player, amount, nonce)` to durable event receipt. Handle failed/reorged/repeated transactions and refunds.
- [ ] Reward inventory: creator pre-funds accepted ERC-20, ERC-721, ERC-1155, and native ETH under a new audited version of escrow; verify reserves before registration; no arbitrary “anything” that cannot be safely transferred.
- [ ] Claim code is a convenient lookup reference only. Claim by the winning wallet, with Merkle proof + chain/escrow/round binding + one-time claim ID. Immediate claim and delayed claim share the same entitlement; no password-like code that someone can steal. Claims must remain valid until a disclosed deadline, followed by creator reclaim.
- [ ] Creator-selected paid-entry token: player can pay exact entry asset directly; optional ORBIX→entry-asset conversion MUST be an explicit user-signed swap against a whitelisted liquid pool/route with fresh quote, `amountOutMin`, deadline, price-impact/slippage and gas disclosure. No automatic selling from an app-managed balance, no synthetic conversion ratio, and never send payment to an arbitrary address. If no liquidity or quote, disable conversion and offer direct payment.
- [ ] Security tests: fee-on-transfer and rebasing rejection, malicious receiver/reentrancy, NFT callback, quote staleness, sandwich/price manipulation, rounding and decimals, replay, front-run, double charge/claim, cancelled/refund deadlines, insolvent reward inventory, signer compromise/rotation, chain reorg, race on join cap.

### P3 — 19 game hints and creator wizard
- [ ] Add a typed, versioned, per-template hint policy with creator choice: off, public feedback, private feedback, or budgeted reveal where meaningful. Server computes hints from committed seed/answer; clients NEVER send truth/score. Publish configuration is immutable and hashed.
- [ ] Number Hunt: public higher/lower in room feed with number and player identity; preserve a separate private-only mode and off. The UI must show the server-authored feedback in real time, clearly distinguish “too low” and “too high,” and reject spam/duplicate guesses without leaking target.
- [ ] Define distinct, non-answer-leaking hint methods for Live Quiz, Memory Match, Token Catch, Reaction Duel, Puzzle Sprint, Hash Hunt, Boss Raid, RPS Duel, Reward Grid, Token-Logo Bingo, Pattern Recall, Typing Sprint, Maze Race, Level Runner, Contract Detective, MEV Rush, Idle Rig and Airdrop Quest. No one-size-fits-all reskin.
- [ ] Add wizard controls, a preview explanation for each format, room lobby fee/reward disclosures, and stage badges/feed feedback. Test off/private/public/budget exhausted, reconnection, fairness transcript, privacy and client patch safety for every engine.

### P4 — release criteria
- [ ] Foundry fuzz/invariant and local Anvil ERC-20/ERC-721/ERC-1155/native ETH flows; Python API and 19-engine suites; Vite typecheck/build; browser desktop/mobile click-through including two-wallet join/claim, and accessibility audit.
- [ ] Independent contract/security review before enabling funded flags; reconcile all events and liabilities against backend ledger.
- [ ] Testnet deploy ONLY after bytecode/source/owner/fee/signer/chain readback, isolated funded E2E and rollback plan. Keep production funded flags OFF until all above are true. No mainnet.
- [ ] Deploy and verify exact live routes in a real browser, status API, transaction receipt and explorer state. Update STATUS.md/task ledger with honest completed/partial/blocked labels.

## External security audit findings (verified against current code)

The contract review confirms the current local escrow/vault suite is meaningful but not production-safe. These are blocking findings, not optional polish:

- **C-01 Critical:** `CenterVault.refundDeduction()` lets the creator refund immediately after any deduction; it is not bound to cancellation or room lifecycle. Replace it with coordinator-authorized `CONSUMED -> REFUNDABLE -> REFUNDED` state transitions.
- **C-02 High:** `CenterEscrow.enter()` accepts entrants before rewards are fully funded. Split `Created -> Funded -> Registration`; registration must require declared inventory conservation.
- **C-03 High:** `publishSettlement()` does not require `block.timestamp >= playEnd` or a terminal game state. Pin round state and signer authority before enabling funded mode.
- **C-04 High:** claim lookup exposes winner, amount and Merkle proof unauthenticated, accepts an 8-hex prefix, and treats the code as a lookup rather than authentication. Use an opaque 128-bit reference, authenticated ownership lookup, and generic unauthenticated failures.
- **C-05 High:** assets are address-allowlisted without binding an approved standard/kind or verifying ERC-165. Add typed asset configuration and kind matching.
- **H-01 High:** registry/verifier administration is single-step EOA control. Use a Safe/timelock or explicitly keep funded deployment disabled until governance is hardened.
- **H-03 High:** entry liabilities and reward reserves are not represented by a single conservation invariant. Separate accounting buckets and test mixed entry/fee/refund/claim flows.
- **M-02 Medium:** off-chain on-chain deductions are recorded before mined receipt reconciliation. Use pending transaction state, receipt finality and event indexing.
- **M-04 Medium:** no conversion contract exists. Conversion must remain outside custody, use allowlisted routes, exact input, `minOut`, deadline, route hash, bounded approvals, fixed recipient and failure isolation.

Local Foundry coverage reported by the audit: **27 Center contract tests passing**. It does not cover the findings above. Therefore the supplied ORBIX token remains identified on testnet but is not activated for value-bearing Center flows.

## Immediate next vertical slices

1. Add failing Foundry tests for C-01 through C-04 before changing custody contracts.
2. Implement the coordinator/refund state machine and funded-registration gate.
3. Fix authenticated opaque claim references and add API privacy tests.
4. Add typed AssetRegistry and conservation invariants.
5. Only then wire ORBIX testnet transfers and run isolated-wallet end-to-end flows.

## Priority order for this implementation pass

1. Fix truthfulness and usability now: accurate catalog count, token identity and wallet-gated admin read-only surface, better Center/homepage hierarchy.
2. Test-first backend: admin config/auth/ledger and Number Hunt public higher/lower with proper client feed.
3. Contract-level multiasset and fee pipeline with full tests. Stay preview-only until real testnet deployment gates pass.
4. Roll per-game hint menus and premium UI through all 19 formats, then comprehensive verification and deploy.

No value-bearing feature is “done” just because a form exists. A fee, burn, conversion, or claim is complete only when wallet signatures, on-chain receipt, server readback, refunds, and adverse-path tests agree.

## Update 2026-10-01

See ORBIX_PROTOCOL_V6_DELIVERY.md "Delivery log — 2026-10-01": admin pricing backend shipped and tested (117 green), top bar + wizard + digit-pad UX shipped and browser-verified live on Railway (deploys 28962928, 704af5c8). Funded paths remain gated: candidate ORBIX is curve-locked pre-graduation.

See ORBIX_PROTOCOL_V6_DELIVERY.md (2026-10-01): funded rewards live — DepositVault deployed + 500k FREE, live balance monitor, verified in browser.
