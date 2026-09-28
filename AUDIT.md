# Orbix / vibevibe protocol audit

Status: preliminary audit in progress. No deployment or fund-moving actions performed.
Scope: Solidity core, cross-module wiring, bridge/relayer, NFT mint system, frontend execution paths, tests and deployment claims.

## Executive assessment

The repository is a small proof-of-concept, not yet a production-grade super-DeFi ecosystem. `forge test` currently passes, but the test suite proves happy-path mechanics only. Several documented product promises are not implemented or are disconnected from the contracts that were deployed.

## Critical / blocker findings

### C-01: The bridge is not an operational bridge
- `relayer/relayer.py` only watches and prints `Locked` events. It never signs attestations and never calls a destination-chain mint/unlock contract.
- `OrbixBridgeOut` only implements source-side locking and a same-contract `unlock`; there is no destination mint contract or destination-chain configuration.
- The dapp says the relayer will attest, but the relayer cannot do that.
- Required rebuild: explicit source/destination domains, canonical message ID, nonce management, finality confirmations, signer threshold/multisig or audited validator set, destination mint/release contract, replay protection per domain, rate limits, pause/emergency recovery, and end-to-end two-chain tests.

### C-02: Claimed upgradeability does not exist
- `OrbixRegistry` comments say modules can be upgraded/re-pointed, but every core module is deployed as an ordinary immutable contract or has immutable addresses.
- There are no UUPS proxies, implementations, initializer guards, upgrade authorization, storage-layout checks, or upgrade tests.
- Registry is not consulted by Router, MasterChef, Bridge, NFT, or Market for runtime dependency resolution. It is an address book, not ecosystem wiring.
- Required rebuild: either implement audited UUPS architecture with a timelocked/multisig upgrade authority, or remove the upgradeability promise and freeze immutable modules intentionally.

### C-03: Human 666 hunt does not enforce the actual game rules on-chain
- `mintHuman` accepts any `luckyNumber`; the contract only verifies a signer signature. The server is the sole source of truth.
- The contract does not enforce the documented 111111-999999 range, uniqueness of winning numbers, or any prime/randomness rule.
- `hunt_server.py` generates random numbers but the claim protocol has no on-chain commitment or public proof that a number was a winner.
- Required rebuild: commit/reveal or a verifiable signed claim format with explicit winner registry, claim expiry semantics, server key rotation, rate limiting, abuse resistance, and a public audit trail. Keep the off-chain UX, but make the trust boundary explicit.

### C-04: GPU mint can operate before salt initialization and is far too easy by default
- `gpuSalt` starts as zero and `mintGPU` does not require it to be locked/set.
- Default difficulty `2 ** 240` means approximately 1 in 256 hashes, not an aggressive GPU competition target.
- There is no epoch/claim reservation mechanism, no anti-bot fairness policy, and no difficulty calibration or gas-aware submission strategy.
- Required rebuild: initialize and lock salt before mint activation, publish a difficulty policy, add mint windows/epochs, define tie/ordering rules, and test the miner and submission race behavior.

## High severity findings

### H-01: Pair TWAP accumulator math is not Uniswap V2-compatible
- `OrbixPair._update` calculates `price0CumulativeLast` using current `bal1 / reserve1` and `price1` using `bal0 / reserve0`.
- It does not use UQ112x112 encoded reserve ratios. `kLast` is never maintained or used.
- Any future oracle or price-protection feature built on these accumulators would be unsafe.

### H-02: MasterChef reward accounting is incomplete for multiple pools
- `harvest()` calls `_updatePool(0)` only, then reads all pools without updating pools 1..N.
- The code supports multiple pools but does not correctly settle each pool before harvest.
- Rewards are paid from the contract balance; there is no emission funding invariant, solvency check, or controlled mint interface.
- The frontend hardcodes pool 0 and gives no pool discovery or reward solvency visibility.

### H-03: Fee-discount module is disconnected from swaps
- `OrbixFeeDiscountModule` is a separate operator-driven rebate system; Router never calls it.
- The documented 25% swap-fee discount is therefore not applied to actual AMM swaps. `accrue()` can be called only by a centralized operator and `claim()` ignores the boolean return from `eco.transfer`.
- Required rebuild: integrate fee policy into the swap path or clearly expose a verifiable rebate adapter with bounded operator authority and solvency accounting.

### H-04: NFT utility promises are mostly interfaces, not integrated features
- `feeDiscountBps()` and `isPriority()` exist, but there is no actual launchpad contract and no staking-boost implementation.
- Marketplace holder discount works only if `setOrbix666` was configured correctly; the registry is not used as the source of truth.

### H-05: Frontend swap paths are incomplete and unsafe for real users
- UI exposes ETH/FREE, but token-to-token and correct direction handling are not implemented as a complete matrix.
- `amountOutMin` is hardcoded to zero in both swap handlers, providing no slippage protection.
- No quote preview, price impact, minimum received, deadline control, allowance state, transaction simulation, chain-change handling, or error decoding.
- The displayed frontend is a 158-line single HTML page with three tabs, not the ecosystem product described in the requirements.

### H-06: Marketplace lacks production controls
- `list()` does not reject zero price.
- No collection allowlist, royalties, offer/bid flow, expiration, cancellation-on-transfer handling, fee recipient separation, or marketplace indexing/query layer.
- A single owner can change fee settings and withdraw all fees.

## Medium severity findings

- Registry has only six keys and omits marketplace, fee module, launchpad, ECO, WETH, NFT, and version/domain metadata.
- Registry admin transfer is one-step, with no pending-admin acceptance.
- Bridge signer change is one-step and has no timelock, rotation event policy, threshold signatures, or pause switch.
- Custom signature recovery does not enforce low-s / malleability rules explicitly.
- NFT `setDifficulty`, `setBotBurnPrice`, and `setBaseURI` are centralized owner controls with no timelock or announced phase state.
- `mintHuman` timestamp checks only the upper bound and does not define a server-clock tolerance or lower bound.
- Dapp uses external CDN ethers without integrity pinning and has no CSP, metadata, error boundary, loading states, or responsive product architecture.
- Relayer uses a bare Python RPC request without the browser user-agent workaround known to be required for this RPC and has no durable cursor, confirmations, persistence, retries, or alerting.
- Test count is 10/10, but there are no fuzz, invariant, fork, adversarial bridge, signature malleability, upgrade, or frontend E2E tests.

## Required rebuild gates before calling this production-ready

1. Freeze current deployment as a testnet baseline. Do not label it complete.
2. Produce an architecture spec with trust boundaries, module interfaces, upgrade policy, roles, pause policy, and threat model.
3. Replace the current registry/address-book approach with real dependency wiring and versioned module interfaces.
4. Rebuild and test bridge lifecycle end-to-end, or explicitly scope it as a source-side lock demo.
5. Rebuild AMM math and oracle surfaces against a known audited reference; add fuzz/invariant tests.
6. Rebuild staking emission and multi-pool accounting with solvency and emergency withdrawal policies.
7. Complete Orbix666 phase state machine: HUMAN, BOT, GPU activation, commitments, public stats, metadata, anti-abuse, and utility integrations.
8. Build the launchpad contract and connect priority/fee/staking utility to actual call paths.
9. Rebuild frontend as a real responsive product surface, not a static tab demo. Every transaction needs quote, simulation, slippage, pending, success, failure, and readback states.
10. Add security gates: Slither/Mythril or equivalent, fuzz/invariant suite, fork tests, static analysis, coverage, deployment verification, and browser E2E at mobile and desktop widths.
11. Only after local gates pass, redeploy a new version and verify every address, registry entry, bytecode, and live readback on Robinhood testnet.

## Evidence files

- `src/OrbixPair.sol`
- `src/OrbixRouter.sol`
- `src/OrbixMasterChef.sol`
- `src/OrbixBridgeOut.sol`
- `src/Orbix666.sol`
- `src/OrbixMarket.sol`
- `src/OrbixFeeDiscountModule.sol`
- `src/OrbixRegistry.sol`
- `relayer/relayer.py`
- `dapp/index.html`
- `hunt/hunt_server.py`
- `test/VibeSwap.t.sol`
- `USER_INSTRUCTIONS.md`
