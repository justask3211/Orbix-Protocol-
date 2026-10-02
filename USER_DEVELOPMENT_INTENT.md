# USER DEVELOPMENT INTENT — Orbix Protocol

This file records the user's (GRINCH's) direction, prompts, feedback, and what each
one produced. It is the human-side counterpart to the technical ledgers
(ORBIX_PROTOCOL_V6_DELIVERY.md, ORBIX_CENTER_V5_EXECUTION.md,
ORBIX_CENTER_A_TO_Z_PLAN.md, SESSION_MEMORY.md).

Repo of record: github.com/justask3211/Orbix-Protocol- (branch `main`).

## Core intent (standing)

Orbix is a connected Robinhood-testnet (chain 46630) DeFi ecosystem. Orbix Center
is a CREATOR PLATFORM — distinct games with real hint mechanics, clear room
economics, transparent wallet transactions, and properly funded, auditable reward
flows. Visual polish supports flows but never masks unimplemented settlement or
incomplete custody. Target: "make it 200x better than now", continuously.
Contract/mechanism work carries 2x the priority of UI work.

## Prompt log

### 1. Design + audit pass (2026-10-01)

Prompt: install tasteskill.dev, use Vercel Web Interface Guidelines as a quality
checklist (not a rebrand), install getdesign.md + Awesome Design MD, fix the
390px mobile wallet overflow, make reward-mode copy truthful, add skip link and
focus styling, make hint policies game-specific in the wizard, record the
remaining plan.

Delivered: mobile two-row header, truthful preview/funded copy, dynamic format
count, Orbix DESIGN.md, per-game hint policy panel with honest "not implemented"
states, V5 execution plan + design audit doc. Deployed (ff26c75f), verified in
Playwright.

### 2. "Continue toward the goal" (repeated, autonomous)

Delivered, in order:

- **CenterGamePot v2** (E8/E9) — settle() verifies an authority signature over
  the full payout payload (contract + chainId + roomId, replay-guarded);
  claimWinnings/claimReward bound to one-time nonces + deadline; refunds return
  exactly what was paid (fee-on-transfer truth); AUTO pushes atomically, MANUAL
  records liabilities for signed pull claims.
- **E3 conservation invariants** — custody >= liabilities, sweep-guard, exact
  rake/creator/winner splits to the wei, no double payout, settle replay refused.
- **E13 adversarial suite** — reentrant NFT receiver blocked mid-payout,
  fee-on-transfer reward reverts, fee-on-transfer entry books the actual amount.
- **D4–D22 hint ladder — ALL 19 formats** have typed, versioned, server-safe,
  budgeted, non-leaking hint feeds with regression guards. Notable: the tests
  found and fixed a REAL leak (Token Catch published spawns up to 500ms in the
  future, letting a bot pre-position; now fallen-only).
- **P1 token identity layer** — on-chain name/symbol/decimals/burn-bytecode
  probes, conservative entry_ok verdict, `GET /token/{address}`.
- **E5** — tamper-evident admin audit hash chain + verify endpoint.
- **F2** — transaction state machine (unsigned -> signed -> submitted ->
  confirmed -> finalized; reorg flip; admission gating at 3 confirmations;
  idempotent receipts; duplicate hash/intent rejection).
- **F4** — attacker model: identity comes from server tickets, payload
  score/winner fields are inert, entitlements come only from the engine,
  post-round forgeries refused.
- **F5** — pre-sign join disclosure (entry cost, reward-mode truth, payout
  authority, refund path, claim deadline, network warning).
- **C4** — live route audit at 1440 + 390: zero overflow, zero console errors.

### 3. "Auto compact everything"

Memory consolidated (fewer, denser entries); no behaviour change.

### 4. "How to connect to GitHub / what token"

Guided fine-grained PAT creation; verified scopes by calling the GitHub API and
reported the real limit (token could not create a new repo).

### 5. "Create a repo named orbix protocol, push all our works"

Token was scoped to `justask3211/Tech` only, so that repo was used; the user then
renamed it to **Orbix-Protocol-** and granted workflow scope. Full monorepo
pushed; CI workflow restored and fixed two real CI failures (forge fmt gate;
missing LayerZero npm contracts installed in CI). CI green on main.

### 6. "Also install this tasteskill.dev ... use all type of frontend skill ... improve 100x our site UI UX design game ... next main one, our entry and vault system"

Delivered:

- **Real wallet system** — removed every "demo wallet" label. Connect a browser
  wallet (MetaMask et al) OR generate a new EVM wallet in-browser. On generate,
  the private recovery key is shown once with a copy-gate and an unmissable
  warning; localStorage restores the same wallet on every later visit.
- **Vault redesign** — balance hero, two deposit paths. (First pass used a
  tx-hash verify form; the user later replaced that with QR + check-deposit.)
- **Game banners** — 19 unique generative SVG scenes (not one template with a
  hue swap): falling-token fields, versus commit/reveal, hidden reward grids,
  hash-mining ledgers, boss HP polygons, sprint paths, quest checklists.
- **Wizard redesign** — 4-step stepper (Pick a game / Room basics / Game rules &
  hints / Fees & rewards), grouped fields, purpose copy, explainer chips.
- **Admin panel** — server-enforced fee caps, admin-wallet-signed mutations,
  hash-chained audit.
- **Design-guidelines pass** — color-scheme dark, aria-live on async regions,
  beforeunload guard, room-cancel confirmation, touch-action, overscroll-contain,
  tabular-nums, safe-area insets, text-wrap balance, select option colors,
  truncation.

### 7. Designer Master Prompt (docx) — cinematic game center

Delivered (first half): new gaming hero ("Play. Explore. Compete." with Play now /
Explore games), **Featured Game** section (Boss Raid, cinematic), atmospheric
background environment, card hover with artwork zoom + glow + CTA reveal, mobile
safe fallbacks, reduced-motion respected. The remaining half (per-game generated
key-art + WebP/WebM animated posters with lazy loading) needs a generated-asset
pipeline and is still open.

### 8. "Remove every free token thing ... token CA is 0x16C5...6db1, not free token ... check the deposit works and no gas estimation problem"

Root cause found: the deployed vault (0x33e0...) is **immutable** and
constructor-bound to FREE — it can never be repointed. Fix: deployed a NEW
CenterVault bound to ORBIX, repointed the backend env (token/vault/escrow/symbol),
and made the deposit a **real contract invocation** (approve -> deposit via the
browser wallet, with automatic chain-switch to 46630 and human-readable gas
errors). All FREE/demo text removed.

### 9. "First option normal deposit contract, second by QR ... don't need hash verify ... check deposit button that verifies the received fund against the user wallet"

Delivered: the vault's deposit section became two tabs, **Contract deposit
(default)** and **Deposit via QR**. The QR tab shows a QR of the vault address +
a copyable address; after sending, the user presses **Check deposit** and the
backend reads the vault contract's `balanceOf(wallet)` on-chain and credits the
software balance by the delta — once, rate-limited (10s/wallet), auth-required,
audit-logged, and unable to mint balance.

### 10. "Add a creator treasury option ... where the joiner token goes ... my wallet, another wallet, or burn"

Delivered: **CreatorTokenGate v2** with a per-room `Payee` enum
(CreatorWallet / CustomWallet / Burn). Join fees route to the creator's own
wallet by default, to any pasted address, or to the Robinhood testnet burn
address (`0x…dEaD`) for a provably irreversible burn. The creator can change
payout at any time. Wizard gained a payout selector plus a burn warning.
20 gate tests cover all three destinations.

### 11. "I need a single dynamic contract ... rewards can be tokens, NFT, auto, claimable by contract or a copiable hash ... private key as reward ... add 1155"

Delivered: **RewardEngine** — ONE contract handling ERC-20 / ERC-721 / ERC-1155 /
ETH with four claim modes (Auto push, wallet-bound Claim Code, Merkle proof,
first-N Open), per-pool custom message, claim deadline, creator reclaim after
expiry, fee-on-transfer rejection, `tokenCommitted` sweep-guard, authority
signatures for auto-push, and 1155 receiver callbacks. Private-key rewards: the
creator generates a fresh EVM wallet, funds it, and registers the derived address
as the reward; the key is delivered off-chain to the winner. 17 tests.

### 12. "Creators can choose ANY token they hold or not hold, created or not — don't force their own token"

Delivered: join-token validation reduced to "the address answers decimals()". No
ownership check, no balance check, no creation check, no graduation requirement —
and a test asserts the source has no reference to those concepts. ORBIX creation
fees are waived platform-wide until ORBIX itself graduates; after graduation the
standard fee applies to everyone with no exemption.

### 13. Fix feedback — "payout_mode rejected on creation; there is no reward wizard"

Two real bugs found and fixed:
1. The backend `Access` model rejected `payout_mode`/`payout_address`
   ("Extra inputs are not permitted"). Added the fields; a schema regression test
   now pins them.
2. A second guard (`preview rooms cannot require on-chain entry payment`) blocked
   any paid join. Relaxed: a joiner's token payment runs through the deployed
   CreatorTokenGate, not the simulated vault — the vault's preview simulation is
   unaffected.
3. The wizard had no reward customization at all. Added a full rewards section:
   reward type (preview points / creator token / NFT / ETH), the relevant
   contract + amount or tokenId, claim mode (auto / code / merkle / open), claim
   window, and a custom message for the winner.

Proof: an authenticated publish against the LIVE API with the exact wizard
payload (join token + amount 25 + payout_mode burn) returned HTTP 200 and created
room `f5ea6592ba0895c2`.

## Honesty rules the user demanded

- Never claim an unintegrated contract path as live.
- Deployment success is not feature success — verify in a real browser.
- Preview points and funded assets must be unmistakably distinct everywhere.
- Report what is proven vs. what is merely written: state the evidence.
- Mainnet stays out of scope.
