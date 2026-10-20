# 2026-10-21 — Cloudflare multiplayer implementation and live deployment

User: finish the deferred Cloudflare multiplayer update now, deploy CF by API,
keep Railway deployment for Hermes, and enable only Token Catch as the first canary.

The three V4 engines were ported to TypeScript and run authoritatively in SQLite
Durable Objects. Railway provisions its immutable initial snapshot, issues scoped
room tickets, verifies signed callback transcripts by replaying the original Python
engine, and performs its existing settlement atomically and idempotently. The Center
routes game actions through a second Worker socket while preserving the Railway
lobby/control socket. Host preferences are signed per-game admin configuration;
room creation and tournament matches pin their effective host. Only configured new
Token Catch rooms default to CF. The other two templates retain Railway defaults.

Actual script `multiplayer` is deployed at
https://multiplayer.justask3211.workers.dev, DO namespace
`070dc75792f349b79a83c819f47a86c3`; three independent HMAC secrets were installed via
API. Secret values remain outside Git. Final production upstream and deployment ID
are in [the public manifest](../specs/cloudflare-multiplayer-live.json).
Existing Worker patient-hill-3575 was not changed. No gameplay custom domain added.

[Live evidence](../../tools/tests/evidence/cloudflare/live-round.json) records two
players, fresh-ticket reconnect, 30Hz sim, 9.78 received patches/sec across reconnect,
100 collected/verified points, matching peer final state, 390px immersive layout,
and zero browser errors. The signed callback reached the updated **local** API
through a temporary CF tunnel and persisted a verified receipt/entitlement. The
tunnel and DNS record were deleted and the Worker upstream restored afterward.
This does not claim the old deployed Railway API passed the new bridge.

Validation: 1132 Python tests; 15 final targeted tests after small cleanup; 16 Worker
tests including Python-generated full-state parity fixtures for all three engines;
Worker/frontend typechecks, workerd SQLite/WS smoke including read-only spectator
admission/action rejection/suspension, production/static builds and
snapshot/result/wallet client regressions. See [validation record](../../tools/tests/evidence/cloudflare/validation.json).
Large Vite chunks and a Starlette deprecation warning remain. Mobile layering and
podium heading CSS issues exposed by the browser run were fixed.

Railway was **not deployed**. Hermes must deploy API/site and install the matching
settings listed in [the deployment guide](../specs/cloudflare-multiplayer-deployment.md),
then repeat a production round. Physical-phone FPS, funded payouts, forced isolate
recovery, large rooms and multi-region latency remain unverified. Timer targets are
not hard real-time guarantees. The active reducer retains Python's gap/catch-up
behavior; uncheckpointed movement can roll back about a second. Keep the other
hosts on Railway until their live checks pass.

The guide records actual resources, masked secrets, API upload commands, custom-domain
option, canary activation and rollback. Earlier scaffold-only documentation is
superseded, without rewriting earlier session history. Pre-existing Python cache
changes are excluded from the source commit. No Railway deployment was performed.
