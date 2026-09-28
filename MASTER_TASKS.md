# Orbix / vibevibe master execution task list

This is the persistent source of truth for the rebuild. Work top-to-bottom, keep going without waiting for user input, and never mark a task complete without a real test or browser/readback. `AUDIT.md` records the baseline failures. `REBUILD_PLAN.md` records architecture and acceptance gates.

## Product north star

Build an industry-grade Robinhood testnet ecosystem, not a demo:
- a vibevibe-compatible bonding-curve launch mode with buy-driven price discovery, a fixed graduation target, automatic graduation, LP migration/locking, creator/platform fees, metadata, analytics, and full trade history;
- a second direct-liquidity launch mode with creator-selected collateral, initial pool, LP lock, and permissionless AMM trading;
- users can launch against approved ecosystem tokens or other launched tokens, pair any two launched assets when allowed, add/remove liquidity, trade routes, stake LP, earn rewards, bridge supported assets, mint/use Orbix666, and trade NFTs;
- every feature is connected through explicit interfaces, registry/config, events, read models, frontend flows, and tests.

## Rules for execution

- Use strict vertical slices: write a failing test, run it red, implement, run green, then refactor.
- Preserve current deployment as a frozen baseline. Do not silently pretend new code is deployed.
- Do not move funds or broadcast redeployments without a separately explicit user instruction.
- No feature is “done” from a contract-only stub. Prove contract, backend/indexing, frontend, and E2E behavior.
- Never claim a bridge is live while the relayer is print-only. Keep UI disabled or label lock-only until destination settlement works.
- Use the real Robinhood/vibevibe mechanics as references, but do not copy unknown bytecode or guess ABI behavior.
- Use shadcn/context7/iconify/playwright and frontend skills where they materially improve the result. Use one coherent design system, not a random component collage.

## Master checklist

### A. Baseline and architecture
- [x] Freeze baseline, run current tests, create AUDIT.md.
- [x] Create REBUILD_PLAN.md and this MASTER_TASKS.md.
- [ ] Add `ARCHITECTURE.md`: module graph, trust boundaries, roles, pause policy, upgrade policy, threat model, invariants, domain IDs.
- [ ] Decide and document immutable-vs-upgradeable boundaries. If upgradeable, implement audited UUPS + initializer + timelock/multisig. If not, remove upgradeability claims.
- [ ] Expand registry/config schema: token, factory, router, launchpad, curve factory, graduation adapter, staking, bridge source/destination, NFT, market, treasury, fee module, versions, chain/domain.
- [ ] Add two-step admin transfer, timelocked sensitive changes, code/readback checks.

### B. AMM core
- [x] Fix TWAP accumulator math and add regression test.
- [x] Fix MasterChef multi-pool settlement and pool-specific pending view.
- [ ] Add router path/token/recipient/pair validations and explicit errors.
- [ ] Add fee policy interface consumed atomically by swap path.
- [ ] Add holder fee discount without an arbitrary operator rebate drain.
- [ ] Differential tests against a trusted V2 reference.
- [ ] Fuzz/invariant tests for constant product, fees, reserves, mint/burn, donations, rounding, token ordering, and callback reentrancy.
- [ ] Add liquidity position read APIs, price impact, route/quote APIs.

### C. Launchpad mode 1: direct liquidity
- [x] Build initial `OrbixLaunchpad` direct-pool slice: token creation, approved collateral, AMM pair, seed liquidity, optional LP lock, treasury fee.
- [x] Test launched token trading and launched-token-to-launched-token pool mechanics.
- [ ] Fix direct launch creator accounting/LP ownership semantics and add creator withdraw/lock read model.
- [ ] Add metadata commitment/content validation and token naming/symbol/supply policy.
- [ ] Add launch config, fee, allowlist, pause, and creator role governance.
- [ ] Add frontend launch form, collateral selector, pool preview, lock preview, confirmation, and readback.

### D. Launchpad mode 2: bonding curve / current trending style
- [ ] Write `BONDING_CURVE_SPEC.md` with exact virtual/real reserves, fee, curve formula, supply allocation, creator/platform fee, graduation target, sell policy, transfer lock, and rounding rules. Match the chosen vibevibe-style observable behavior, not vague “pump style”.
- [ ] Add failing tests for create launch, quote buy, quote sell, min-out, deadline, recipient binding, fee, virtual reserves, and monotonic price.
- [ ] Implement isolated curve token/curve pair with explicit launch ID and reverse lookup.
- [ ] Implement buy/sell with quote-first slippage guard, deadline, fees, event schema, and replay-safe accounting.
- [ ] Add transfer lock before graduation and explicit exemptions for curve/locker/router as required.
- [ ] Add buy-driven graduation at configured raise target. Test exact boundary, overshoot/refund or allocation policy, and repeated graduation calls.
- [ ] Implement graduation migration: seed the AMM using the curve reserves, lock/burn LP according to policy, mark curve final, and emit migration receipt.
- [ ] Add creator/platform/treasury fee accounting and solvency invariants.
- [ ] Add launch priority/limits for Orbix666 holders only through tested policy.
- [ ] Add frontend mode selector: “Bonding curve” vs “Direct pool”, launch preview, curve chart, buy/sell, progress-to-graduation, holders/trades, graduation status, and migration receipt.

### E. Ecosystem tokens and liquidity
- [ ] Define approved collateral policy: native WETH, FREE, ECO, ORBIX, and launched-token pairs with risk/decimals checks.
- [ ] Build token registry/index events and token detail read model.
- [ ] Support pair creation between two launched tokens, direct LP management, route discovery, and pool analytics.
- [ ] Add LP staking position lifecycle: deposit, withdraw, emergency withdraw, harvest, reward solvency, NFT boost.
- [ ] Add pool creation governance, allocation schedule, caps, and emergency controls.

### F. Bridge
- [ ] Write explicit bridge domain/message spec.
- [ ] Build destination settlement token/escrow contract, source/destination address config, finality window, transfer ID, expiry, replay guard.
- [ ] Replace print-only relayer with durable DB/state, confirmation depth, retries, receipt verification, structured logs, health endpoint, metrics, and alerting.
- [ ] Use threshold/multisig or bounded testnet validator policy, signer rotation delay, pause, rate limits, rescue policy.
- [ ] Build bridge status/readback UI and only enable it after end-to-end local/fork tests.

### G. Orbix666
- [ ] Add phase state machine and public phase/supply stats.
- [ ] Harden HUMAN hunt with atomic durable persistence, claim IDs, expiration, rate limiting, signer rotation, chain reconciliation, and clear trust model.
- [ ] Add BOT burn/access policy, per-wallet limits, accounting, and UI.
- [ ] Initialize GPU salt before opening, lock it, define difficulty/epoch/tie policy, miner UI, and submission tests.
- [ ] Govern price/signer/difficulty/metadata changes.
- [ ] Connect 25% fee discount atomically, launch priority, staking boost, marketplace discount, holder profile.

### H. Marketplace and launch ecosystem
- [ ] Add NFT collection allowlist, royalties policy, listing validation, expiry, offers, bids, cancel, buy, fee recipient, indexing events.
- [ ] Add NFT inventory, collection, listing, offer, and activity screens.
- [ ] Add launchpad discovery, token detail, trades, holders, comments/status, pool and LP analytics.

### I. Frontend rebuild
- [ ] Replace static HTML shell with a coherent React/Next/TypeScript product surface while preserving tested contract behavior.
- [ ] Design direction: “protocol cockpit meets collectible observatory”: deep graphite, one Orbix orange/solar accent, technical mono for figures, distinctive sans display, restrained spatial motion, no generic purple/blue gradient.
- [ ] Global wallet/network/account state with accountChanged and chainChanged handling.
- [ ] Routes/surfaces: Overview, Discover, Swap, Pools, Launch, Bonding, Staking, Bridge, Orbix666, Marketplace, Portfolio, Activity, Protocol status.
- [ ] Every transaction gets quote, balance, allowance, simulation/gas, confirmation, pending, success receipt, explorer link, decoded error, retry/recovery.
- [ ] Responsive 375/768/1440, keyboard/accessibility, reduced motion, loading/empty/error states, metadata, favicon, CSP, no hardcoded duplicate address strings.
- [ ] Use MCPs: shadcn registry search/init, Context7 current docs, Iconify/approved icon family, Playwright browser tests and screenshots. Do not add libraries without checking package manifest.

### J. Backend/indexing/ops
- [ ] Build event indexer/read API for launches, curves, trades, pools, LP, staking, bridge, NFT and marketplace.
- [ ] Durable DB migrations, idempotent event cursors, reorg handling, RPC retries with browser-compatible headers, health/readiness endpoints.
- [ ] Secure secrets, no private keys in source, structured logs, alerting, rate limits, abuse controls.
- [ ] Make hunt server production-safe or keep it explicitly testnet-only.

### K. Security and verification
- [ ] Forge build with warnings reviewed.
- [ ] Unit, fuzz, invariant, fork, differential, adversarial and gas tests.
- [ ] Static analysis with Slither or available equivalent; review every finding.
- [ ] Browser E2E for all user flows and wallet/network errors.
- [ ] Test desktop/mobile, both color modes, reduced motion, keyboard and screen reader semantics.
- [ ] Run final full audit. Fix every discovered blocker. Repeat audit after fixes.
- [ ] Build/deploy ledger, bytecode/readback for every deployed module, verify registry entries, live smoke test.
- [ ] Final task: independent second audit of contracts, backend, frontend, UX, security, performance, and deployment docs. Do not report complete until all critical/high findings are closed or explicitly disabled and labeled.

## Current completed evidence

- Baseline audit: `AUDIT.md`
- Architecture/rebuild plan: `REBUILD_PLAN.md`
- User intent: `USER_INSTRUCTIONS.md`
- 22 Foundry tests currently pass, including direct launchpad tests, TWAP regression, multi-pool staking regression.
- Current launchpad code is a tested direct-pool prototype. Bonding-curve launch mode is not yet implemented.
