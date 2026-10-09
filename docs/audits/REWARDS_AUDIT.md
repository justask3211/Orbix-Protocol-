# Orbix reward contracts and mechanisms — self-audit

Date: 2026-10-09. Scope: Phase M/N source plus Phase O fixes in this repository. This is a development self-audit, not an independent security certification. No live financial transaction, contract deployment or Railway deployment was performed.

## Release status

**Do not enable new funding on the legacy RewardEngine.** Read-only calls on Robinhood testnet, chain 46630, returned authority `0x253db2d543b10c94918de97eb8499ee59ab9087e` and `poolCount() = 0` for `0x5b8d41421b9a6701cb7948e724234cb9b1eb8e1b`; `safetyVersion()` reverted. These observations describe the queried moment, not a guarantee about future state. The isolation fixes below exist in source; this session did not change deployed bytecode.

The API now checks chain ID and `safetyVersion() == 2` before preparing/verifying new funding. The wallet repeats that read before creation, allowance approvals or deposits. `/rewards/capabilities` and the wizard explain unavailability. Missing marker, unsupported version or failed read fails closed. Source updates alone cannot safely enable the legacy address. This marker is a capability check, not bytecode attestation: deployment configuration remains trusted.

Fresh hardened deployments require synchronized `CENTER_REWARD_ENGINE` in the API and `VITE_REWARD_ENGINE` at frontend build time, the correct authority signer, supported chain/RPC, and existing funded feature flags. Keep the existing gate/vault/pot addresses separate from RewardEngine. Gate, pot and vault fixes also require fresh deployments before relying on their new behavior. Do not silently point existing pool claims at a replacement engine; preserve old address/binding records if a migration later becomes necessary. The observed legacy engine had no pools, so no migration was attempted here.

## Reviewed paths and method

Contracts: `src/center/RewardEngine.sol`, `CreatorTokenGate.sol`, `CenterGamePot.sol`, `CenterVault.sol`, their OpenZeppelin dependencies, mocks and baseline tests. Mechanisms: `center/rewards.py`, `reward_flow.py`, schema, waitlist/store/API/room settlement integration; `FundedRewards.tsx`, `NftSelector.tsx`, `nftWallet.ts`, `rewardWallet.ts`, creator wizard and My rewards.

Review traced custody, allocation, transfer, receipt and reclaim paths; signature domains and replay flags; deadline boundaries; allowance scope; receiver callbacks; mutable bindings; integer aggregation; persistent versus process-local bookkeeping; provider/metadata failures and UI recovery. Regressions use actual local Solidity execution, fuzz cases, mocked RPC/wallets, and Chromium with a disposable real Python API. Live browser/RPC checks were read-only or authentication-only.

## Findings and disposition

Severity describes impact in the reviewed source before correction. “Fixed” means fixed in repository source, never a claim that an existing deployment was patched.

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| R01 | Critical | Expired RewardEngine pools swept contract-wide ETH/ERC-20 balances, including other creators' pools. | Fixed: reclaim iterates only the requested pool's remaining asset ledger. |
| R02 | High | RewardEngine reclaim missed unallocated NFTs/ERC-1155 and could repeat global sweeps. | Fixed: inventory-based reclaim covers every remaining asset, zeroes amounts and rejects repeat expiry. |
| R03 | High | Code/Open allocations could exceed custody or create invalid NFT shares and phantom Open slots. | Fixed: per-asset reservations, positive amounts, NFT share exactly 1, slot bounds, mode/recipient/cap validation. |
| R04 | High | One wallet could consume multiple Open prizes, contradicting “first N wallets.” | Fixed: one Open claim per address, with cap and claimed-slot guards. Sybil resistance is not provided. |
| R05 | Critical | CenterGamePot released manual winnings from `tokenCommitted` at settlement; treasury could sweep unpaid prizes. | Fixed: commitments decrease only on actual outgoing payments/refunds/reclaims; room residuals remain reserved. |
| R06 | High | Auto game-pot winners were also recorded as manual claim liabilities, enabling a second payout from shared custody. | Fixed: manual claims require Manual mode; Auto never records manual winnings. |
| R07 | High | Gate relay authorization omitted mutable token/fee/payout, allowing a later quote to charge more against an existing broad allowance. | Fixed: V2 digest binds the full quote; old V1 relay signatures are deliberately incompatible with new source. |
| R08 | Medium | Gate could emit full-fee admission after a fee-on-transfer underpayment; update accepted unreadable token addresses. | Fixed: exact recipient delta, self-payee rejection, deployed code and decimals read on bind/update. |
| R09 | Medium | Unsolicited safe NFT receipts were accepted without bookkeeping; deposit/reclaim callbacks could cross unguarded money paths. | Fixed: expected token/operator/from/ID/amount receipt context; guarded engine/pot/vault transfer paths; NFT owner and 1155 incoming delta checks. |
| R10 | Medium | Late deposits/allocations/Auto pushes and room writes could be accepted after expiry; zero recipients or malformed Auto arrays were insufficiently checked. | Fixed: active-state/deadline gates, equal nonempty Auto arrays, nonzero recipients and zero-share rejection. |
| R11 | Medium | Game-pot rounding/unallocated residuals lacked a bounded retrieval path. | Fixed: per-room residual ledger and creator `reclaimWinnings` only after deadline, once. |
| R12 | Medium | NFT/Merkle asset indices could differ from server aggregation; published pools could already contain allocations. | Fixed: exact canonical aggregated deposit order, inventory equality, uint256 totals and zero initial allocation count required. |
| R13 | Medium | Pool-wide Code claimed status hid still-unclaimed allocations; duplicate matching logs could assign the same slot twice. | Fixed: per-slot `allocationInfo` and distinct matched log indices; second allocation stays payable after first redemption. |
| R14 | Medium | Merkle claims could be consumed by a third-party caller, complicating wallet-bound claim/receipt attribution. | Fixed: sender must equal the committed winner. Transfers were already to winner; no third-party theft was established. |
| R15 | Medium | Vault and engine could silently short-pay if a token enabled outgoing transfer fees after deposit. | Fixed for these paths: exact outgoing recipient deltas revert atomically. Arbitrary rebasing/malicious tokens remain unsupported. |
| R16 | Low | Gate payout event reported the new payee as both old and new; pot accepted malleable raw ECDSA. | Fixed: truthful old/new event; OpenZeppelin low-s/v recovery, preserving the pot's existing raw digest protocol. |
| R17 | Product defect | Wizard type previews did not activate funded setup; one-NFT-only forms and match-entitlement-only Merkle discovery blocked waitlist/non-winner drops. | Fixed: actual per-type routing, held-NFT selection, independent fixed/Open distributions and owner-only waitlist snapshots. |
| R18 | Product defect | Failed preparation persisted/locked an attempt before validation. | Fixed: prepare first, then save; only unfunded attempts without journals/pending hashes can reopen. |

### Reproduction of the highest-impact accounting defects

R01: fund pool A with 100 ERC-20 units and pool B with 200 of the same token. Expire A; creator A calls `reclaimExpired(A)`. The previous global-balance path could send 300 to A. The regression now leaves 200 in custody with B's ledger unchanged. A fuzz test repeats isolation with two arbitrary positive ETH deposits. R02 additionally checks unallocated ERC-721 ID 7 and ERC-1155 ID 99/quantity 10 return to their own creator.

R05: collect 100 entry units, settle a Manual room with an 80-unit winner and 20-unit residual. Previously the full pot commitment became zero before any manual payment. Now treasury `sweepDust(..., 1)` reverts; the 80-unit claim leaves 20 committed, and after expiry only that room's 20-unit remainder is reclaimed. R06 confirms Auto's 100-unit payout cannot be repeated with a Manual signature.

R07: sign a relay quote for a 10-unit entry, then update the binding to 100 while the player has a 1,000-unit allowance. The previous signature did not bind the charge. The new signature fails, player balance stays 1,000 and admission remains false. Changing token or payout likewise changes the digest. Direct join still uses the current binding; see residuals below.

## Asset custody and conservation

For each RewardEngine asset, remaining inventory equals confirmed deposits minus successful claims/Auto transfers/reclaims. All outgoing paths check positive share within that asset's remaining amount; ERC-721 share is exactly 1. Code/Open outstanding reservations never exceed remaining inventory. A successful claim reduces both reservation and custody ledger; failure reverts both. Unallocated inventory and rounding residue remain held until expiry. ETH/20 reclaim does not inspect or sweep another pool's global balance.

Merkle roots are creator-selected immutable commitments. The generic contract cannot enumerate a root to prove total allocations equal deposits: a malicious creator can commit an unsatisfiable distribution, but transfers cannot exceed remaining inventory. The supported wizard/server validates distinct recipients, exact slot amounts, aggregated uint256 totals, canonical indices and exact inventory before publication. No protocol claim of arbitrary-root solvency is made.

Multiple ERC-721 prizes are distinct asset entries. Each free-read selector ID is an exact uint256 string; ownership is checked again by transfer. Single-token approvals authorize the engine for that ID only. Multi selection is a resumable sequence of approvals/deposits into one pool, not an atomic batch ABI. Partial deposits persist in a journal and may be resumed; unpublished leftovers can be reclaimed after the pool deadline. ERC-1155 requires standard collection-wide approval, explicitly disclosed with revocation guidance. ERC-20 allowances request the aggregate needed amount, not infinity. Existing sufficient allowances may be reused.

Game-pot commitment equals live entry/refund liabilities, unpaid Manual winnings and room residuals, plus unpaid locked ERC-20 rewards. Rake and creator share decrease commitments only when transferred. Cancelled entrants can withdraw their recorded incoming amount once. Entry fee-on-transfer accounting intentionally credits actual received units; outgoing taxed entry refunds/prizes may deliver less than those gross debits. This compatibility is not an exact-net-payout guarantee. Fixed locked rewards reject incoming transfer fees; use ordinary non-rebasing tokens for predictable outcomes.

Vault deposits credit exact incoming units. Deduction consumes one intent once; refund requires coordinator authorization, the original creator, original amount and one-time refund flag. Withdrawal rechecks uncommitted balance after its two-day delay, clears pending state before transfer and requires exact recipient delta. Failed withdrawals retain their pending request/balance by transaction rollback. No admin sweep was added.

## Replay, claims, roots and deadlines

Code signatures bind domain, engine address, chain, pool, allocation index, winner and nonce using EIP-191. Allocation claimed state is the durable on-chain replay guard; nonce uniqueness across different slots is not required because slot/domain/winner are signed. Production RewardFlow deterministically regenerates signatures from persistent bindings and entitlements; its nonce is slot index + 1. `RewardService.issue_claim_nonce` is a legacy process-local helper, not production replay protection. Its docstring now says so. Key-wallet registration helpers do not implement key delivery.

Merkle leaves use the existing packed single keccak of 20-byte winner + 32-byte asset index + 32-byte amount. Preimages are 84 bytes; sibling pairs are sorted. Python roots/proofs and Solidity two-NFT claims are covered. One claim per winner prevents multiple leaves for the same wallet in this mode; backend rejects duplicates rather than silently dropping them. Claims require the winner to submit. Code can award multiple distinct slots to one wallet, with independent status.

Open claims are intentionally public races, including selecting an available higher-value slot. A competing wallet may win a slot first; that is Open eligibility, not theft of a reserved Code/Merkle prize. Open has no identity/Sybil defense. Code's bound sender and Merkle's bound leaf/caller prevent another wallet taking the assigned reward. Game-pot relays can submit valid winner-bound signatures without changing transfer destination. Pot nonces are room-wide across claim kinds, so the authority must issue distinct nonces. Settlement arrays are hashed into contract/chain/room domains and settlement state prevents replay.

Pool creation requires more than one hour to deadline. Deposits, allocation and claims remain allowed at the deadline second; reclaim requires strictly later. Pot room creation requires a future deadline; entry, locking, settlement and claims stop after it. Cancellation supports entry refunds; settled residuals/locked rewards reclaim only after deadline. A failed transfer, bad signature/proof, reused claim or callback rolls back the entire operation. Auto pushes are atomic and may be blocked by one recipient rejecting an NFT/ETH receipt; Code pull claims isolate recipients and are the wizard's Auto-prompt implementation.

## Waitlist, API and browser verification

Waitlist collection is voluntary and does not promise a reward. Owner-only snapshot/export APIs include both winner and non-winner opt-ins, deduplicate nonzero addresses, enforce limits and audit/rate controls. The UI does not silently truncate lists over 50; prepare/publish rechecks source ownership and that each recipient belongs to the submitted source snapshot. Creators can choose a subset of collected wallets. Later submissions never mutate a committed root. Distribution mode prevents independent drops creating game entitlements or depending on match completion. My rewards discovers Merkle drops for members and Open drops for signed-in wallets.

Publishing checks chain, pool creator, room key, mode, active state, deadline, Merkle root/Open cap, inventory, initial allocation count and a confirmed pool-specific deposit receipt. A failed schema/chain check cannot publish or charge. The existing idempotent publication path and pool uniqueness remain in place. Creator confirmation is still required for Code/Open `setAllocation`; the server does not move creator funds or grant itself allocation permission. Claims expose exact methods, simulate payability, and only show confirmed delivery after receipt `0x1`. RPC read failure produces unavailable/unpayable status, never an invented claim.

Live Chromium reproduced the old wizard's panel-only type selection and exposed its single-NFT/setup restrictions through source inspection. Authenticated `/wallet/rewards` returned 200/empty with no JavaScript errors. Requests to nonexistent `/health` and `/meta` were exploratory 404s, not diagnosed reward failures. Local 390px Chromium checks real auth/API plus mocked free NFT reads: IDs 7/9 enumeration, multiple selection, per-recipient assignment, waitlist error and rejected-prepare editing recovery. Wallet send count and page errors are both zero. All three V4 worlds are tested separately for loading, rendered V4 scene and accepted server movement/jump; this is software Chromium evidence, not physical-device FPS.

Metadata uses free `tokenURI`/`uri` reads, optional client-side JSON fetching, timeout and scheme restrictions. HTTPS/IPFS images are optional; scripts/file URLs and SVG data images are rejected. There is no backend arbitrary-URL fetch and no paid NFT indexer. Third-party HTTPS metadata remains untrusted and may be missing or change. Enumeration is limited to 50 held IDs; non-enumerable collections use manually supplied IDs verified by `ownerOf`.

## Residual risks and intentionally unavailable routes

1. **Legacy deployments / pot namespace — gate room-ID reservation/front-running.** `bindRoom(bytes32,...)` is permissionless and first-write-wins; another wallet can reserve a known room key. The API's historical binding validation rejects a mismatched creator/token/fee/payee, preventing that binding granting legitimate room admission, but it does not recover a squatted key. Fixing on-chain ownership requires an authority-bound room authorization or a creator-scoped key protocol and coordinated backend/client migration. The v2 hardening round below resolves this in fresh Gate v3 source with creator authorization. Existing immutable gates retain the risk. Pot room keys have the same permissionless namespace assumption; the funded wizard uses separate RewardEngine pools, whose creator/room binding is verified.
2. **Legacy/direct compatibility — mutable direct Gate join quote.** V2 fixes relayed signatures. The existing direct `join(roomId)` ABI still accepts the current fee/payee at execution. A creator may change payout after simulation. Exact allowance constrains a raised fee where no preexisting broad allowance exists, but cannot bind the destination. The v2 hardening round adds `joinQuoted` with the full V2 tuple. New Gate v3 rooms use it; historically paid legacy rooms retain direct joins with an explicit mutable-quote notice. Explicit calls to the retained `join` ABI still accept the current binding.
3. **Trust/availability — authority and supported tokens.** Authority signatures determine server outcomes and manual pot reward recipients; a compromised authority can misdirect allocations where permitted by the contract. Creator controls Code/Open allocations and must confirm them. Unsettled expired pot rooms still need creator cancellation for entry refunds. Malicious token implementations, asynchronous negative rebases, blacklist/pause changes, lying balance reads and rejecting recipient contracts are unsupported and may block transfers. SafeERC20 and delta checks cannot attest arbitrary token economics.
4. **Unavailable in UI.** Private-key reward delivery, paid NFT indexing, atomic multi-NFT batch deposit, transactions from generated/recovered local wallets, and a dedicated creator reclaim button are explicitly unavailable. Browser wallet/WalletConnect is required for transactions; production WalletConnect still requires its own configured project ID. Creators may call `reclaimExpired(poolId)` directly after expiry; the form states this. Source completion does not claim live wallet interoperability or real funded execution.
5. **Operational boundaries.** No server worker executes contract AutoPush; wizard “Auto prompt” deliberately uses Code and a winner transaction. Direct/forced transfers bypassing safe receipt methods are not credited inventory and may be unrecoverable; always use deposit methods. Pool/claim discovery relies on a correctly configured trusted RPC and accessible event history; provider limits must fail closed. Separate multi-transaction funding may be abandoned before publication and remains creator-owned until expiry.

## Storage and deployment safety

All four contracts are constructor-based, non-upgradeable contracts; no proxy migration was assumed or performed. The first round preserved engine/pot struct layouts and appended new top-level bookkeeping; the v2 round makes the engine signer immutable and adds gate namespace state, so storage positions may differ in fresh deployments; allocation getter/capability methods extend their ABI. Gate V2 deliberately changes relay digest semantics. Vault's added ReentrancyGuard changes inherited storage slots. `forge inspect ... storage-layout` was reviewed for engine/vault. None of this authorizes replacing live storage or attempting an in-place upgrade. Deploy new versions with constructor arguments and verify bytecode, authority, read interfaces and all client/server address configuration before enabling funding in a separate authorized release.

## v2 hardening round

Date: 2026-10-09. This round preserves the original design: **one RewardEngine for ERC-20, ERC-721, ERC-1155 and ETH across Auto, Code, Merkle and Open**. It remains constructor-based and non-upgradeable. There is no proxy, authority rotation, emergency sweep, admin allocation, custody pause or pool migration transaction. RewardEngine's constructor and external function selectors remain compatible; `safetyVersion() == 2` remains mandatory for new funding. Its authority is now explicitly immutable. A future reward variety belongs in this engine's mode/asset model, never in a token-specific deployment.

### Changes beyond the first round

- R01–R18 were re-traced against custody, server and wallet code and exercised by their existing regressions. Per-pool reclaim, Code/Open reservations, creator-only allocation, all asset kinds, NFT multi-selection, waitlist Merkle discovery and rejected-prepare recovery remain present. No allocation or reclaim privilege was granted to the authority. AutoPush still accepts an authority-signed array and can be submitted by a winner; the creator-facing wizard's Auto prompt continues to use Code plus a winner transaction. This round does not introduce a server AutoPush worker.
- ERC-721 outgoing delivery now rejects a token that leaves ownership in engine custody. The check allows receiver forwarding **and receiver burning during callbacks**; requiring final ownership to equal the initial recipient would have narrowed valid NFT flows. Nonstandard/malicious token contracts remain unsupported. Dynamic outgoing ERC-20 fees atomically roll back both claims and expiry reclaim.
- Browser funding, allocation and claim journals include chain and engine address. Ambiguous old funding journals fail closed and retain their receipts for review, rather than being applied to a new engine's pool ID. The existing wizard's retry/edit safeguards remain intact. ERC-721 approves individual IDs; ERC-20 approves exact aggregate inventory. ERC-1155's collection-wide approval remains disclosed with revoke guidance.
- **CreatorTokenGate v3** adds immutable `bindingAuthority` and once-pinned `roomCreators`. The API signs only a persisted room's authenticated creator, with gate/chain/room/creator/deadline domain separation. Anyone may relay the registration proof, but nobody else may bind that room, and even a later authority proof cannot replace its pinned creator. The authority authenticates namespace ownership only; it cannot allocate rewards, change creator quotes or move funds. This anchors the server's existing room-ownership policy on-chain and adds signer availability dependency for *new room binding*, without new custody trust. If the server signs a false owner before registration, that false namespace claim can still be pinned; signing policy remains trusted.
- `bindRoomAuthorized` combines registration and the creator's binding into one transaction. The old `bindRoom` selector remains usable after registration. Binding no longer requests an unnecessary creator-token allowance. Matching confirmed bindings are idempotent on retry. The Gate constructor now requires `(treasury, bindingAuthority)`; this is a fresh deployment, not an update to existing bytecode.
- Gate `joinQuoted(roomId, nonce, signature)` signs `(token, fee, payee, payout, roomId, player, nonce)` plus gate/chain domain using the existing V2 relay digest. The wallet computes the digest from the displayed binding, then submits its own payment. Mutations revert even with a preexisting broad allowance. `joinRelayed` uses the same implementation, and direct `join(bytes32)` remains available. Creator quote updates, pause/resume and creator/custom/burn payouts remain supported. Transfer callbacks cannot mutate the quote while payment/events are being produced.
- Gate addresses are pinned per published token-entry room. Existing records without a pin use the historical deployed Gate v2 address; changing `CENTER_CREATOR_GATE` affects new rooms and never repoints old paid admission history. The frontend receives the pin in `entryGate`, verifies creator/token/fee/payee/payout before approval, and retains explicit legacy direct-join compatibility. New bindings require the Gate v3 marker and correct signer. No fallback creates a new unanchored binding.

### Feature and finding verification

| Findings | Feature retained and evidence |
| --- | --- |
| R01–R03 | Mixed inventory, partial Code/Open claims and per-pool creator reclaim; `RewardsAudit.t.sol`, `RewardEngineFeatures.t.sol`. |
| R04 | Distinct first-N Open wallets can claim mixed assets; same-wallet repeat remains rejected. |
| R05–R06, R11 | Manual pot claims/residual reclaim stay funded; Auto pays once; existing pot tests and audit regressions. |
| R07–R08, R16 | Relay and quoted wallet joins, exact token delivery, truthful payout events; existing gate tests plus `CreatorGateFeatures.t.sol`. |
| R09–R10, R14–R15 | Expected NFT receipts, callback protection, winner-bound Merkle, exact deadline boundary, NFT forwarding/burning, rollback on failed outgoing payment. |
| R12–R13 | Canonical aggregated Merkle inventory and independently redeemable Code slots; `test_reward_flow.py`, existing audit and wallet tests. |
| R17–R18 | NFT multi-locking in one pool via per-ID approvals/deposits, waitlist/fixed drops without match results, prepare recovery; existing API/NFT tests remain green. |

`RewardEngineFeatures.t.sol` exercises all four asset kinds in each of the four claim modes, Code claim-later, allocations after partial claims, partial Auto settlement followed by creator reclaim, deadline equality, least-privilege allowances and authority privilege boundaries. `CreatorGateFeatures.t.sol` covers authorization theft/front-running, cross-domain proofs, pinned creator immutability, quote mutations, replay, callbacks and successful updated quotes. Python and Node cover persisted ownership, per-room gate cutover, signatures, engine journals, idempotent binding and legacy paid reconnects. These prove supported functionality as well as exploit rejection; no real funded chain test is claimed.

### Engine deployment plan — Hermes executes separately

Use `script/center/DeployRewardEngineV2.s.sol`; it deploys exactly one engine, requires chain 46630 and explicit `CENTER_REWARD_AUTHORITY`, then checks authority/version/empty pool count. `FOUNDRY_PROFILE=rewards_v2` pins Solidity **0.8.37+commit.f401782d**, Cancun EVM, via-IR and 200 optimizer runs for reproducible compilation and verification. Keep that profile for dry-run, broadcast and explorer verification. A successful fork simulation is required before broadcast; no chain deployment was performed in this round.

The official [Robinhood deployment guide](https://docs.robinhood.com/chain/deploy-smart-contracts/) specifies testnet chain 46630 and its Blockscout verifier endpoint. [Foundry verification documentation](https://getfoundry.sh/forge/reference/verify-contract/) describes the compiler/constructor/verifier flags used below. Commands are a release recipe, **not evidence that they ran on-chain**. Use an encrypted Foundry account or another existing secure signer setup; no private key belongs in a command, manifest or Git.

```bash
export FOUNDRY_PROFILE=rewards_v2
export CENTER_REWARD_AUTHORITY=0x253db2d543b10c94918de97eb8499ee59ab9087e
export CENTER_RPC_URL=https://rpc.testnet.chain.robinhood.com
forge build
# Dry-run on the actual target fork; no --broadcast here.
forge script script/center/DeployRewardEngineV2.s.sol:DeployRewardEngineV2 \
  --rpc-url "$CENTER_RPC_URL" --rpc-headers "User-Agent: Mozilla/5.0" \
  --account orbix-deployer --sender <DEPLOYER_ADDRESS>
# Hermes broadcasts the same reviewed script/settings after reviewing the simulation.
# Add --broadcast to the command above only for that release.

# Substitute the NEW engine address returned by its confirmed creation receipt.
forge verify-contract <NEW_REWARD_ENGINE> src/center/RewardEngine.sol:RewardEngine \
  --chain 46630 --verifier blockscout \
  --verifier-url https://explorer.testnet.chain.robinhood.com/api/ \
  --constructor-args "$(cast abi-encode 'constructor(address)' "$CENTER_REWARD_AUTHORITY")" --watch

# Read-only bytecode/authority/version/empty-inventory verification at a confirmed block.
PYTHONPATH=. center/.venv/bin/python -m center.verify_reward_engine \
  --engine <NEW_REWARD_ENGINE> --authority "$CENTER_REWARD_AUTHORITY"
```

The verifier compares actual runtime to the release artifact with authority immutable references substituted, verifies each artifact source hash matches the checkout, and rejects wrong compiler/profile, wrong chain, bytecode mismatch, signer mismatch, missing marker or nonzero pools. It reads `poolInfo`, `poolAssets`, `roomPoolIds` and `isClaimed` at one block with three confirmations. Archive its JSON report, artifact/ABI, source commit, constructor arguments, deployment transaction and explorer verification with the deployment record. Do not publish a placeholder address as a deployment manifest. `safetyVersion` remains a fail-closed client capability check; deployer verification supplies bytecode attestation, not the marker by itself.

### Go-live checklist and exact environment updates

1. Keep `CENTER_TESTNET_REWARDS=false` while preparing the release; re-read the **old** engine's `poolCount()` immediately before cutover and confirm the expected zero pools. A previous zero read is not permanent evidence.
2. Deploy one v2 engine on chain 46630 using the reviewed release profile and intended authority.
3. Wait for confirmations; verify source on Blockscout and run the read-only verifier above. Authority must equal the configured reward signing key's address, `safetyVersion` must be exactly 2 and fresh read ABI/inventory must match. Confirm the legacy engine remains empty.
4. Set backend **`CENTER_REWARD_ENGINE=<NEW_REWARD_ENGINE>`** and frontend build-time **`VITE_REWARD_ENGINE=<THE_SAME_NEW_REWARD_ENGINE>`**. Existing `CENTER_REWARD_SIGNER_KEY` (or the supported signer fallback) must match the constructor authority. Keep vault/escrow/pot addresses in their own variables; never alias them to this engine.
5. Rebuild frontend (`cd web && npx tsc --noEmit && npm run build`) with the new build-time address, release API/frontend together with funding off, and confirm the served bundle/capabilities use the same engine/chain. On release, verify unsupported-marker/read failure stops funding before any approval/deposit prompt.
6. Flip **`CENTER_TESTNET_REWARDS=true`** only after those checks. Existing persistent DB, RPC and feature prerequisites still apply. Perform a separately authorized small testnet create/fund/publish/allocate/claim/reclaim smoke test before broadly opening funding. This round did not perform it.

No real environment file or remote environment was edited or pushed by this session. Hermes owns the deployment and environment cutover.

### Separate gate release and migration impact

Engine cutover does not upgrade the gate. To activate the two gate fixes for new rooms, Hermes must separately deploy `script/center/DeployCreatorGateV3.s.sol` with explicit `CENTER_ROOM_BIND_AUTHORITY` and `CENTER_GATE_TREASURY`; verify `bindingAuthority()`, `safetyVersion() == 3`, ABI/bytecode and the two-address constructor on the explorer. Set **`CENTER_CREATOR_GATE=<NEW_GATE_V3>`** and build with **`VITE_CREATOR_GATE=<THE_SAME_NEW_GATE_V3>`**. Configure `CENTER_ROOM_BIND_SIGNER_KEY` to match that immutable authority, or deliberately use the existing reward/server signer fallback when it matches. These are separate gate addresses/markers, not RewardEngine versions. Creator binding APIs and the wallet fail closed until the matching gate/signing configuration is available.

Retain the legacy gate deployment and per-room address records: existing `joined` mappings and historical `CreatorJoined` receipts cannot be copied to v3 or charged again. New rooms get the configured v3 pin, existing rooms continue against their original pin. Rebinding a legacy room would require an explicit room-level policy and preservation of paid admission history; this session does not silently rebind it. Legacy direct joins keep their mutable-quote risk; the UI states it. Namespace protection is not retroactive on the old immutable gate, and the pot's standalone permissionless room namespace remains a residual outside the funded RewardEngine wizard.

### If RewardEngine pools existed during replacement

There is no custody migration or admin extraction mechanism. Keep old engine addresses, creators, pool IDs, asset indices, roots, deadlines, allocations, claims and funding journals; identify pools by **(chain, engine address, pool ID)**, never pool ID alone. Route reads, original-domain claim signatures and creator expiry reclaim to each pool's original engine and keep its authority signer/history available. The current backend primarily serves one configured engine; supporting old nonempty engines would require explicit per-binding engine readers and multi-engine discovery before switching. Only new pools belong on the replacement. Creators may reclaim their own expired balances and voluntarily fund new pools with new wallet consent; an authority cannot sweep or copy them. Keep engine-specific token approvals/revocations explicit. The reported zero-pool legacy state is why no such migration implementation is needed for this cutover.

## Validation

First-round checks before the v2 round: **541 Python tests**, **141 Forge tests** (baseline 119 plus 22 added contract regressions, with 256 runs per fuzz case), **26 wallet/NFT Node tests**, explicit TypeScript checking and production build. Browser scripts: `tools/tests/rewards-wizard-browser.cjs` and `tools/tests/v4-worlds-browser.cjs`. Contract regressions are in `RewardsAudit.t.sol`, `CreatorGateAudit.t.sol`, `VaultAudit.t.sol`; existing engine/gate expectations were updated only for intentional safer semantics (bound Merkle sender, Open reservation cap, nonzero root, V2 relay digest).

v2 round final checks: **555 Python tests**, **162 Forge tests** (21 added feature/security cases), **35 Node wallet/NFT/gate tests**, explicit `npx tsc --noEmit` and `npm run build`. Both deployment scripts passed **local script-VM dry runs with chain ID 46630**, without RPC, broadcast or real transactions. The read-only verifier successfully instantiated the reviewed 12,504-byte runtime locally with authority immutable references substituted. Target-chain fork simulation, explorer verification and funded smoke tests remain Hermes release steps.

Known test notices: one existing Starlette/httpx deprecation warning; Vite's existing large-chunk notice. No static analyzer/formal verification claim, mainnet/testnet financial execution claim, live bytecode patch, performance certification or Railway deployment claim is made. The final session record identifies phase commits and generated bundle validation.
