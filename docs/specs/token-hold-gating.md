# ORBIX and creator-token hold requirements

`Entry.hold_threshold` is an integer number of **whole tokens**, maximum 10^15.
`entry.kind=hold` requires a token, positive threshold, zero payment amount,
`access.payout_mode=hold`, and explicit creator sponsorship. It never binds a gate,
approves tokens or transfers tokens. `erc20` entry can additionally specify a
hold threshold, retaining its original confirmed-payment requirement.

Creators must satisfy the per-room threshold at publish; joiners satisfy it at
admission. Admin-controlled ORBIX create/join/tournament thresholds are mandatory
whenever positive. The tournament floor is max(global join, tournament). Requirements
on the same token merge with max(), never sum or override downwards; requirements
on different tokens must both pass. ORBIX per-room thresholds are admin-only.
The platform asset is the Center ORBIX at `0x16c5451763ec2e0e7f041e2db761a0491fdb6db1`,
not the legacy cockpit launch asset. `CENTER_ORBIX_TOKEN` can pin another deployment.

The server validates the RPC chain, obtains the latest block, and reads `decimals()`
and `balanceOf(wallet)` using that same block. Strict uint256 results are required.
Only balance is considered: transfer lock, graduation, allowance and token-transfer
scans have no part in holding eligibility. Failed RPC checks return 503, insufficient
holdings return 403, and neither produces an admission, debit or payment signature.

Default cache TTL is zero: preflight and admission each read again. Admins may set
`hold_cache_ttl_seconds` from 0–300 seconds. Cache entries are bounded, wallet/token
scoped and cleared on policy writes; negative clock age is never a cache hit.
Positive global thresholds imply forcible enforcement; there is no creator override.

GET `/api/center/v1/orbix-policy` is public and supports cross-origin promo reads.
PATCH `/admin/orbix-policy` requires the existing wallet session plus fresh single-use
admin proof, updates the audit chain atomically, and owns all thresholds, TTL, promo
text, HTTPS buy URL and enabled switch. POST `/hold-check` accepts `action`
(create/join/tournament) and a draft config, room_id or tournament_id; it is display
preflight only. Actual publish, room admission, tournament create/join independently
enforce the policy. All quantities shown in responses are exact strings.

The create/join modal shows a spinner, per-token green ticks/balance or red failure
with Buy ORBIX, and requests no wallet transaction. Paid-entry disclosure still
precedes the existing payment flow. Creator-token entry remains disabled in the
wizard until “I pay all ORBIX joiner fees” is explicitly checked.

`web/public/orbix-promo.js` is the shared standalone strip, shipped at
`/center/orbix-promo.js` by the Center static build and embedded in the cockpit,
Center, hunt, arcade and Formies source shells. It reads public policy, scrolls
left-to-right, displays the exact contract with a copy button, and supports session
dismissal and reduced motion. Offline preview deliberately makes no policy request,
maintaining its existing network-isolation guarantee. Additional externally hosted
sub-sites can embed `<script src="https://orbixcore.fun/center/orbix-promo.js" defer></script>`.
The default buy page uses vibevibe's `/token/:address` route, verified against its
published frontend on 2026-10-20; the administrator can replace the link.
