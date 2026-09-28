# Rebuild status

Last verified: 2026-09-29

## Verified complete in this checkout

- Foundry executed with `forge test`: **38 passed, 0 failed, 0 skipped** across 38 tests.
- Existing AMM regressions pass: TWAP reserve-ratio math, multi-pool MasterChef settlement, swap/slippage paths.
- Direct launchpad tests pass: 9/9, including multiple launches, approved collateral, pair creation, LP lock, fees, and launched-token trading.
- Router safety tests pass: 10/10, including path/recipient/dependency checks and fuzzed donation, mint/burn, swap-invariant, and TWAP-wrap cases.
- Bonding-curve tests pass: 6/6, including quote monotonicity, buy/sell round-trip, deadline/slippage, pre-graduation transfer lock, exact-target graduation, overshoot refund, donation exclusion, reserve migration, and LP custody.
- `BONDING_CURVE_SPEC.md` documents the intended testnet curve accounting and migration model.
- Frontend production build passes with `npm run build`.
- Frontend utility tests pass: `node --test src/trade.test.mjs` — 3/3.
- Swap frontend now uses the deployed Router, live `getAmountsOut`, slippage/minOut, wallet network switching, pending state, receipt wait, and error state.
- Launch frontend now has validated direct-launch form and approval/transaction wiring, but remains disabled because no deployed OrbixLaunchpad address is present in the deployment ledger.
- Deployment remains a frozen baseline; no redeployment or fund-moving action was performed.
- Bridge scope remains **source-side lock-only**. The relayer is still print-only and destination settlement is not implemented.

## In progress / not yet verified

- Add and verify a deployed Launchpad address before enabling direct launch on the public frontend.
- Real-wallet browser E2E for approving and submitting a swap on Robinhood testnet.
- Remaining curve verification: fuzz/invariant, malicious-token, and broader adversarial coverage.
- Architecture, registry/dependency wiring, bridge domain and destination settlement, indexer/backend, Orbix666 hardening, marketplace controls, and full frontend rebuild.

## Blocked / explicitly not implemented

- Production bridge: no destination mint/unlock, durable relayer state, attestations, threshold signer policy, finality/replay protection, or E2E two-chain verification. UI must remain disabled or labeled lock-only.
- Direct Launch on the public UI: blocked until a real deployed OrbixLaunchpad address is recorded and bytecode/readback verified. The UI does not guess an address.
- Production deployment: frozen baseline only; no claim that the current deployment contains the unverified rebuild changes.
- Production readiness: not complete; critical/high findings remain in `AUDIT.md`.

## Evidence

- `AUDIT.md` — baseline findings and required gates.
- `DEPLOYMENT.md` — frozen testnet deployment record; its historical 10/10 test note predates the current 37-test checkout.
- `MASTER_TASKS.md` — execution checklist; unchecked items remain intentionally unchecked unless verified here.
- Command: `forge test` (run from repository root on 2026-09-29).
