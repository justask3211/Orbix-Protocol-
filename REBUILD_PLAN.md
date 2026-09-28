# Orbix / vibevibe rebuild plan

## Target
Turn the current Robinhood testnet proof-of-concept into a coherent, verifiable super-DeFi ecosystem: launchpad, AMM, liquidity, staking, bridge, Orbix666 minting, marketplace, and a premium product frontend. Preserve the testnet baseline for comparison, but do not treat it as production-ready or move user funds.

## Non-negotiable acceptance gates

- Every module has an explicit interface, role model, pause/emergency policy, upgrade policy, events, and readback checks.
- No contract advertises a feature that is not connected to a real call path.
- All value-moving functions have deadline/expiry, slippage or output protection, recipient validation, replay protection, and useful errors.
- Core accounting passes unit, fuzz, invariant, and adversarial tests.
- Bridge passes a two-domain local/fork simulation with finality, retries, replay protection, and verified destination settlement.
- NFT phases are explicit and auditable. Human, bot, and GPU rules are visible and parameter changes are governed.
- Frontend exposes the actual ecosystem, not only three demo tabs. Every transaction has preview, wallet/network checks, pending, success, failure, recovery, receipt, and explorer states.
- Browser tests pass at 375px, 768px, and 1440px, in reduced-motion mode and both color modes. Accessibility uses semantic controls, labels, focus states, and aria-live transaction status.
- Deployment is serialized, addresses are written to the ledger, every bytecode and registry entry is read back, and only then is a new testnet deployment announced.

## Workstreams and order

### 0. Baseline and threat model
- Freeze the current deployment addresses and create a baseline report.
- Map trust boundaries: owner/admin, relayer, hunt signer, GPU miner, frontend, user wallet, token issuer.
- Decide what remains immutable and what is upgradeable. No vague “UUPS” claim.
- Define roles: protocol admin, upgrade admin, pause guardian, bridge validator, hunt signer, emission manager, fee collector.

### 1. Protocol foundation
- Replace the address-book-only registry with versioned module records, interface IDs, chain/domain metadata, code-hash checks, two-step admin transfer, and timelocked sensitive changes.
- Add role separation and emergency pause strategy.
- Define common errors/events and deployment interfaces.
- If UUPS is required, use audited OpenZeppelin UUPS patterns with initializer protection, upgrade authorization, timelock/multisig control, and storage-layout checks. Otherwise explicitly freeze immutable modules.

### 2. AMM and pricing safety
- Differential-test pair behavior against a trusted Uniswap V2 reference.
- Fix TWAP accumulation using prior reserves and encoded reserve ratios, or remove oracle fields until a real oracle design exists.
- Validate zero addresses, path length, adjacent token uniqueness, pair existence, recipient, reserves, and overflow boundaries.
- Add quote, price impact, minimum received, deadline, fee, and route APIs.
- Decide the NFT-holder fee discount architecture and make it atomic with swaps, not an operator-maintained after-the-fact rebate.

### 3. Staking and emissions
- Correct every-pool reward settlement and pool-specific pending accounting.
- Add withdraw, emergency withdraw, reward funding/solvency checks, emission schedule, caps, and admin timelocks.
- Integrate NFT staking boost through an explicit, tested policy rather than a placeholder hook.
- Add multi-pool tests, zero-liquidity tests, fee-on-transfer tests, rounding tests, and long-running reward invariants.

### 4. Bridge
- Define supported source and destination domains and token representation.
- Implement destination settlement contract or explicitly relabel current code as lock-only demo.
- Use a domain-separated transfer ID containing source chain, destination chain, source bridge, destination bridge, token, amount, recipient, nonce, and expiry.
- Add finality confirmations, durable event cursor, idempotent processing, retries, receipt verification, rate limits, pause, rescue policy, and monitoring.
- Replace one mutable signer with threshold/multisig validation or a clearly bounded testnet validator design.
- Test duplicate events, reorg/finality delay, malformed attestations, signer rotation, insufficient destination liquidity, and recovery.

### 5. Orbix666
- Add an explicit phase state machine: configured, human open, bot open, GPU open, closed, metadata finalized.
- HUMAN: preserve the click-hunt idea, but make claim IDs, expiry, signer rotation, rate limits, durable atomic state, chain reconciliation, and public winner accounting explicit. Decide whether the server signature is intentionally trusted or a commit/reveal proof is required.
- BOT: implement burn pricing, access-code/session policy if desired, per-wallet limits, burn accounting, and public supply metrics.
- GPU: initialize salt before activation, lock it, publish difficulty policy, calibrate realistic competition, define epoch/tie rules, and add miner/submission tests.
- Govern or timelock difficulty, price, signer, and metadata controls.
- Connect actual fee policy, launchpad priority, staking boost, profile, and marketplace benefits.

### 6. Launchpad
- Build the missing launchpad contract and lifecycle: creation, metadata validation, sale/curve, graduation, liquidity handoff, allocation, creator controls, pause, and fees.
- Resolve curve addresses from factory getters, not ID arithmetic.
- Add tokenomics only after utility and allocation rules are represented in code.
- Add launchpad-priority use of Orbix666 with tests.

### 7. Marketplace
- Add collection allowlist, listing validation, expiry, offers/bids, cancellation, royalties policy, fee recipient, holder discount, safe transfer handling, events for indexing, and admin governance.
- Add read APIs for active listings, collection stats, user inventory, and activity.
- Test transfer failures, stale listings, zero price, fee rounding, malicious ERC721/ERC20 behavior, and reentrancy.

### 8. Product frontend
- Replace the static HTML shell with the existing supported frontend stack, while preserving contract behavior during migration.
- Shared wallet/network/session layer with account and chain listeners.
- Shared chain config from one source, not repeated address literals.
- Screens: overview, swap, liquidity, staking, bridge, Orbix666 hunt, bot mint, GPU miner, NFT inventory, marketplace, launchpad, activity, and protocol status.
- Every transaction: balance/allowance check, quote, impact, slippage, confirmation summary, gas estimate, pending state, receipt, explorer link, decoded failure, and retry path.
- Fix known blockers immediately: missing LP `allowance()` ABI and missing ethers import in hunt page.
- Use the loaded frontend MCP/skills for search, current docs, responsive browser testing, accessibility, and visual consistency. Use Motion only for meaningful feedback/hierarchy, not decoration.

### 9. Verification and deployment
- Solidity: forge build, unit, fuzz, invariant, fork tests, static analysis, coverage, and gas snapshots.
- Backend: typed config, browser-UA RPC compatibility, durable state, structured logs, health endpoint, metrics, alerts, and integration tests.
- Frontend: Playwright E2E, console/network error budget, mobile/desktop, keyboard, reduced motion, both themes.
- Deploy one module at a time. Append addresses and constructor args to DEPLOYMENT.md. Read back every registry entry and bytecode. Run live smoke tests. Update HANDOFF.md only from verified state.

## Current blockers before a rebuild claim

1. Bridge is lock-only and relayer is print-only.
2. Upgradeability is absent despite documentation claiming it.
3. Registry is not runtime-connected.
4. AMM TWAP is incorrect.
5. MasterChef multi-pool accounting is incorrect.
6. NFT phase/game governance is incomplete.
7. Launchpad and staking boost are missing.
8. Fee discount is not atomic with swaps.
9. Frontend staking and hunt flows have known runtime bugs.
10. Frontend represents only a fraction of the intended product.

## Audit evidence

See `AUDIT.md` for file-level evidence. Independent contract and frontend audits confirmed the findings above. Existing `forge test` passing 10/10 is a baseline only, not a production gate.
