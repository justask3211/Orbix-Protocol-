# SESSION MEMORY — Orbix Protocol (updated 2026-10-09, v2 hardening round)

Handoff document. Read this first in a new session, then the technical ledgers:
ORBIX_PROTOCOL_V6_DELIVERY.md, ORBIX_CENTER_V5_EXECUTION.md,
ORBIX_CENTER_A_TO_Z_PLAN.md, USER_DEVELOPMENT_INTENT.md.

Repo of record: **github.com/justask3211/Orbix-Protocol-** (branch `main`, CI green).

## Latest handoff — v2 reward hardening, 2026-10-09

This section supersedes the historical test baselines and reward-wiring gaps below.
R01–R18 are fixed in source and were re-verified against the original features.
**No on-chain deployment, live env update or hosting deployment was performed.**
Hermes handles deployment and environment changes. Legacy engine funding remains
fail-closed: the prior read found zero pools and no `safetyVersion()` marker;
Hermes must recheck zero pools immediately before cutover.

Preserve the user's design rationale in future changes:

- ONE universal RewardEngine, all four asset kinds and all four claim modes.
  New varieties belong in this contract's asset/mode model, not per-token deployments.
- Constructor-based, non-upgradeable custody. No proxy, admin sweep, custody pause,
  authority allocation privilege or migration extraction. Authority is immutable;
  replacement is an explicit new deployment behind the safetyVersion gate.
- Server confirms outcomes; contract holds custody; creator confirms Code/Open
  allocations; winner submits the claim. Contract AutoPush remains available and
  is tested with winner submission; wizard Auto prompt still uses Code on-chain.
- ERC-721 per-ID approve, ERC-20 exact aggregate allowance, ERC-1155 collection
  approval disclosed honestly with revocation guidance. Room binding needs no
  creator-token approval and now requests none.
- New funding fails closed in both API and wallet until safetyVersion == 2.

Additional changes: precise ERC-721 outgoing custody check allows recipient
forwarding/burning; chain/engine-scoped browser journals reject ambiguous legacy
attempts; Gate v3 pins a server-signed creator once, with no custody permissions or
owner replacement; `joinQuoted` binds token/fee/payee/payout/room/player/nonce and
reuses the V2 relay digest. Direct `join` remains for compatibility. Quote-changing
callbacks are blocked while ordinary creator updates/pause/payout routing remain.
Gate addresses are stored per token-entry room; old rooms without records use the
historical gate so an env cutover cannot erase already-paid admission. Legacy
joins retain mutable quotes and show that limitation. New room binding requires
Gate v3 and matching server ownership signer.

Full validation: **555 pytest tests**, **162 Forge tests** (141 first-round + 21
new feature/security regressions), **35 Node wallet/NFT/gate tests**, explicit
`tsc --noEmit`, production build. Both deployment scripts ran successfully in
local script VMs with chain ID 46630; these were neither RPC fork tests nor chain
deployments. Known notices remain Starlette/httpx deprecation and Vite chunk size.
Generated pycache and web/dist changes are excluded from the source commit.

Deployment artifacts and recipe:
`script/center/DeployRewardEngineV2.s.sol`,
`script/center/DeployCreatorGateV3.s.sol`, and
`python -m center.verify_reward_engine` (read-only bytecode/source-hash/authority/
version/confirmed-read-ABI verification). Use `FOUNDRY_PROFILE=rewards_v2`:
Solidity 0.8.37, Cancun, via-IR, optimizer 200. Target-chain fork simulation is a
Hermes release prerequisite. Full details, commands, residuals and migration
requirements are in `docs/audits/REWARDS_AUDIT.md`, "v2 hardening round".

Go-live: keep funding off -> deploy engine v2 -> verify authority, marker 2,
bytecode, read ABI and zero inventory -> set `CENTER_REWARD_ENGINE` and build-time
`VITE_REWARD_ENGINE` to the SAME new address -> rebuild/release API and frontend ->
flip `CENTER_TESTNET_REWARDS=true`. Gate activation is separate: deploy Gate v3,
verify bindingAuthority/marker 3, set `CENTER_CREATOR_GATE` + `VITE_CREATOR_GATE`,
and match `CENTER_ROOM_BIND_SIGNER_KEY` (or explicitly matching existing signer
fallback). Keep old room gate records and receipts; do not charge paid entrants
again. No engine migration code is needed for the reported empty legacy engine.
If pools existed, multi-engine readers/discovery and original-engine claim/reclaim
routing would be required; no admin can sweep assets into a replacement.

## Contracts LIVE on chain 46630 (Robinhood testnet)

| Contract | Address | Role |
|---|---|---|
| ORBIX token | `0x16C5451763eC2E0E7f041E2DB761A0491FdB6db1` | the platform token (18 dec) |
| CenterVault v2 | `0x481529b7b3BdE423499B1E7f817aa7DFa689cbE4` | ORBIX deposits; software balance |
| RewardEngine | `0x5b8d41421b9a6701cb7948e724234cb9b1eb8e1b` | ERC20/721/1155/ETH rewards, 4 claim modes |
| CreatorTokenGate v2 | `0xcfc161d02225eceb97aa9b8ff791a407a3bb3cff` | any-ERC20 join token + payout routing |
| (deprecated) vault v1 | `0x33e0d64d1e894cd2bce673baeb0ff68153bd0aa3` | immutable, bound to FREE — do not use |
| (deprecated) gate v1 | `0x19ecd51d78b3836863e8161503b1273e2241c08a` | fixed-treasury payout only |

Manifest: `center/deployments/rewards_v1.json`.
Both v2 contracts verified as deployed (status 0x1 receipts) and their
constructors checked on-chain (vault `vaultToken()` returns ORBIX).

## Backend (Railway orbix-center)

- Env now: `CENTER_VAULT_TOKEN=0x16C5…6db1`, `CENTER_VAULT`/`CENTER_ESCROW`=`0x481529…cbE4`,
  `CENTER_VAULT_SYMBOL=ORBIX`, `CENTER_REAL_BURN=true`, `CENTER_SIGNER_KEY` present.
- Live endpoints verified: `/health/ready` (reports ORBIX + new vault),
  `/token/{address}` (on-chain identity → entry_ok true for ORBIX),
  `/wallet/deposit/check` (401 unauth = auth gate works).
- Live deploy: `0fc5ca8e` (plus later pushes).

## Frontend (orbixcore.fun/center)

Live and verified in the served bundle: Contract deposit + QR deposit tabs,
Check deposit, "Reward type" selector (preview/token/NFT/ETH), claim-mode
selector (auto/code/merkle/open), claim window, custom message, "Where join fees
go" (creator/custom/burn), join-token field, featured game, "Play now" hero.
Chain-switch to 46630 built into both deposit and join paths.

## Test baseline (all green)

- **Foundry: 119** (RewardEngine 17, CreatorTokenGate 20, CenterGamePot+invariants+
  adversarial, plus the rest of the project)
- **Python: 257** (`cd center && PYTHONPATH=~/vibeswap .venv/bin/pytest tests`)
- Frontend: `npx tsc -b --noEmit` clean, `npm run build` clean

## Key architecture facts

- **Fee policy**: ORBIX creation fee is waived platform-wide until ORBIX itself
  graduates; afterwards the standard fee applies to every creator (no exemption).
  Join-token binding is independent and always available.
- **Join token**: ANY ERC-20 — only requirement is that `decimals()` answers.
  No ownership/creation/graduation check (a test asserts the source has none).
  Binding requires the creator to absorb ORBIX joiner fees so joiners pay only
  the chosen token.
- **Payout routing**: per-room Payee enum → creator wallet (default), custom
  address, or burn (`0x…dEaD`). Creator may change it any time.
- **Rewards**: RewardEngine pools with Auto / Code (wallet-bound, one-time
  nonce) / Merkle / Open claims; deadline then creator reclaim; fee-on-transfer
  rejected; `tokenCommitted` prevents sweep of committed assets.
- **Private-key rewards**: creator generates a fresh wallet, funds it, registers
  the address; the key is handed over off-chain. On-chain it is a normal transfer.
- **Deposits**: contract path = approve + `vault.deposit()`; QR path = send then
  `POST /wallet/deposit/check` reconciles on-chain `balanceOf` → software credit
  (delta only, 10s rate-limit, audit-logged).
- Identity: WS `who` comes from server tickets; clients never nominate winners.

## Deploy recipe

```bash
# site (static cockpit + Center SPA)
cd ~/vibeswap && bash deploy/site/build-site.sh
RAILWAY_API_TOKEN=<project token> railway up --detach \
  --project e4e3ab3b-70f4-4503-917b-e6011904dd69 \
  --environment c53306c8-52f9-4c8b-bd25-2b0fdbb6aa79 \
  --service 8fa652eb-710a-48f1-a24b-bcdd26f7eaf9      # orbixcore (site)

# backend API
RAILWAY_API_TOKEN=<project token> railway up --detach \
  --project e4e3ab3b-... --environment c53306c8-... \
  --service 2edb9c98-7055-4a1e-b00f-3f1f20443629      # orbix-center (API)
```

**Important**: the Railway CLI needs `RAILWAY_API_TOKEN` (account/workspace token),
NOT `RAILWAY_TOKEN`. Site uploads must run from the repo ROOT (the Dockerfile is
resolved as `deploy/site/Dockerfile` relative to the archive root). `web/dist` must
NOT be gitignored by `.railwayignore` — the API image COPYs it.

CLI path: `~/.npm/_npx/79fa66f96c8fdacf/node_modules/@railway/cli/bin/railway`.

## Access / secrets (files on this machine)

- Ethereum signer (coordinator `0x253db2…`): `~/.orbix_signer_env`
- Railway project token: `~/.orbix_railway_env`
- GitHub fine-grained PAT: `~/.orbix_github_env` (has workflow scope)
- RPC: `rpc.testnet.chain.robinhood.com` — **403s plain curl; send a browser User-Agent**

## ORBIX token lock (important)

The ORBIX token blocks transfers from team/curve-locked balances pre-graduation
(custom error `0xdb89e3f4`). Verified on-chain: the coordinator holds ~2.9M ORBIX
and cannot transfer; a curve buyer *can*. Mechanism: ORBIX is a vibe.fun bonding
curve token whose `curve()` (`0xa8805f42…cb18`) reports `complete() == 0` — not
graduated. **We cannot force graduation**; the honest options are (a) wait, or
(b) run Center value flows on a transferable token in the meantime. Deposits work
today for any wallet that can actually transfer ORBIX.

## Next up (priority)

1. **RewardEngine wiring**: creator-side approve + deposit + allocation calls from
   the publish flow (the contract and UI exist; the on-chain publish step needs
   the wallet calls wired end-to-end).
2. Designer Master Prompt second half: per-game generated key-art + WebP/WebM
   animated posters with poster-first lazy loading.
3. E14: full on-chain E2E on 46630 (create → join → play → settle → claim) once
   ORBIX graduates.
4. F1/F3: API/DB schema alignment with events; durable event indexer.
5. C4 remainder: 768px sweep, per-route empty/loading/error states, keyboard pass.
6. E5 remainder: Safe/timelock for registry governance (audit H-01).

## Honest gaps (never claim these done)

- RewardEngine is deployed and tested, but the creator-side publish→deposit wallet
  flow is not yet wired end-to-end.
- Funded value flows are unproven end-to-end on-chain (blocked by the ORBIX lock).
- 4 V4-documented templates are absent from the 19-format catalog (D1).
- G21–G24 chance/prediction games remain legally gated / demo-only.
- No mainnet anywhere, by design.
