# Bonding-curve launch mode specification

## Purpose
A second launch mode alongside direct-pool launches. Creators launch a fixed-supply ERC20, buyers purchase from a deterministic curve using native ETH, and the launch graduates into the Orbix AMM when the configured raise target is reached.

## Accounting
Each launch has immutable `virtualQuote`, `virtualToken`, `tokenAllocation`, `graduationTarget`, and `feeBps`. Buy fee is `floor(gross * feeBps / 10_000)` and net quote increases `raised`. Buy output is `floor(net * (virtualToken - tokensSold) / (virtualQuote + raised + net))`. Sell gross quote is `floor(tokens * (virtualQuote + raised) / (virtualToken - tokensSold + tokens))`; sell fee is floored and proceeds are gross minus fee. Quotes are execution-parity views.

## Lifecycle and safety
Buy input above the remaining target is capped and excess is refunded. Graduation occurs exactly at the target; donated ETH is excluded. The curve holds the initial supply, locks transfers between non-curve accounts before graduation, and unlocks them on graduation. Buys and sells are deadline/min-out protected and non-reentrant, state updates precede external value transfers, and treasury fees are tracked in `feeAccrued`.

At graduation, `virtualToken - tokensSold` tokens and exactly `graduationTarget` WETH seed the Orbix pair. LP is sent to `OrbixLPLocker`, which has a single release after its unlock timestamp. The curve is terminal after graduation.

## Initial testnet policy
- Quote asset: native ETH, wrapped internally as WETH for migration.
- Supply/allocation and fee are creator-selected within constructor hard bounds.
- Recipient is `msg.sender` in this slice.
- Approved ERC20 quote assets and factory/discovery wrappers remain future work.

## Required verification and status
Tests cover quote parity, monotonic pricing, deadline/slippage, transfer lock, sell accounting, exact target graduation, donation exclusion, reserve migration, LP custody, and post-graduation terminal behavior. Fuzz/invariant and malicious-token suites remain required. This is a testnet protocol primitive, not production-ready or audited.

## Purpose
A second launch mode alongside direct-pool launches. Creators launch a fixed-supply ERC20, buyers purchase from a deterministic curve using approved quote assets/native ETH, and the launch graduates into the Orbix AMM when the configured raise target is reached.

## Initial testnet policy
- Quote asset: native ETH, wrapped internally as WETH for migration.
- Token supply: creator-selected in the contract prototype; production policy must match the chosen vibevibe-compatible standard before deployment.
- Curve allocation: a configured portion is held by the curve contract and sold; unsold allocation is handled explicitly at graduation.
- Price: constant-product virtual-reserve curve in the first slice: `x = virtualQuote + quoteRaised`, `y = virtualToken - tokensSold`; buy output is the reserve delta after fees.
- Fee: configurable basis points, bounded by a hard maximum, paid to treasury.
- Graduation: when net quote raised reaches target, buys stop, token transfers unlock, curve reserves migrate to WETH/token AMM liquidity, and LP is locked for the configured period.
- Exact-boundary behavior: quote is capped to the remaining curve allocation and graduation target. Over-target ETH is rejected in the first slice, not silently retained.
- Every buy/sell includes deadline and min-out. Recipient is `msg.sender` in the first slice.

## Required events and read APIs
`CurveCreated`, `Buy`, `Sell`, `Graduated`, `LiquidityMigrated`, `TransferLockChanged`, `quoteBuy`, `quoteSell`, `raised`, `tokensSold`, `graduated`, `pair`, `launchId`.

## Trust and controls
The owner creates no user-specific curve state after launch. Treasury and fee are configured at creation. Administrative changes are timelocked in the production version. The prototype must expose parameters and hard bounds so the frontend can display them.

## Not complete until
- Buy/sell quote parity and monotonic price tests pass.
- Graduation migration is an actual transaction into the AMM and LP custody is verifiable.
- Transfer lock is tested before/after graduation.
- Frontend displays progress and migration receipt.
- Fuzz/invariant tests cover conservation and no over-mint/over-release.
