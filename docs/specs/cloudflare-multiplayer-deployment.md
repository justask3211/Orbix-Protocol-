# Cloudflare multiplayer deployment — 2026-10-21

The V4 engines and signed result bridge are implemented. Cloudflare was deployed
through its multipart API using the account token; Railway was **not deployed**.
Hermes must deploy this revision's API and site and install the matching settings
below before production room creation can use the canary.

## Deployed resources

The machine-readable record is [cloudflare-multiplayer-live.json](cloudflare-multiplayer-live.json).

| Resource | Actual value |
| --- | --- |
| Worker script | `multiplayer` |
| Account | `0d91ccc5789d50ce43aa35c2ad8e38d8` |
| Public URL | `https://multiplayer.justask3211.workers.dev` |
| Gameplay socket | `wss://multiplayer.justask3211.workers.dev/multiplayer/v1/ws/rooms/{roomId}` |
| DO binding / class | `ROOMS` / `MultiplayerRoom` |
| SQLite DO namespace | `070dc75792f349b79a83c819f47a86c3` |
| Migration | `v1`, `new_sqlite_classes: [MultiplayerRoom]` |
| Compatibility | `2026-10-20`, `nodejs_compat` |
| Result upstream | `https://orbix-center-production.up.railway.app` |
| Secrets installed by API | `EDGE_TICKET_SECRET`, `PROVISION_SECRET`, `RESULT_SECRET`; values **MASKED** |
| Zone route / custom domain | None installed for gameplay; workers.dev enabled |

`patient-hill-3575` was not changed. This API upload contains the Worker module and
DO binding, without a static asset upload. `/center/*` and `/api/center/*` proxy the
fixed Railway origin when the optional local `ASSETS` binding is absent. The primary
site continues to serve its existing Center build.

## Hermes handoff — required before production activation

Secret values exist only in the mode-0600 file `~/.orbix_multiplayer.env` on this
machine. Transfer them through the deployment secret manager; never paste them into
Git, logs, frontend variables or documentation. The mapping is:

| Railway variable | Matching Worker secret |
| --- | --- |
| `CENTER_EDGE_TICKET_SECRET` | `EDGE_TICKET_SECRET` |
| `CENTER_CF_PROVISION_SECRET` | `PROVISION_SECRET` |
| `CENTER_CF_RESULT_SECRET` | `RESULT_SECRET` |

Also configure Railway `CENTER_CF_ENABLED=true` and
`CENTER_CF_ORIGIN=https://multiplayer.justask3211.workers.dev`. Deploy both the API
and site from this revision. Existing room hosts stay pinned. Once these settings
are present, the default for **new token-catch rooms only** is Cloudflare; combat-duel
and boss-raid default to Railway. Without a complete configuration, the default
remains Railway. Explicit previously saved per-game admin preferences take precedence;
check **Play modes → Multiplayer host** and select Cloudflare for Token Catch if an
older Railway preference exists. Other templates reject Cloudflare selection.

The wallet session stays on Railway. The Center requests a fresh 120-second scoped
edge ticket with that Bearer session and sends it in `session.hello`. Admitted spectators receive read-only edge tickets and cannot act. The browser
keeps the Railway control socket for lobby, ready, rematch and settlement, and sends
gameplay actions and sync requests to the Worker. A reconnect requests a new ticket.

## Reproduce the account-token deployment

Build and validate before uploading:

```sh
cd workers/multiplayer
npm ci
npm run typecheck
npm test  # python on PATH must have the Center test dependencies
npm run build
python deploy_api.py --evidence ../../docs/specs/cloudflare-multiplayer-live.json
```

`npm run build` bundles with Wrangler's dry-run mode. The Python uploader reads
`CF_ACCOUNT_TOKEN` from `~/.cf_env`, uploads **only** script `multiplayer`, installs
its three secrets with the secrets API, and enables workers.dev. No Wrangler login
or standalone namespace-create call is required. On first creation, multipart
metadata includes `main_module: worker.js`, the DO binding and SQLite migration;
subsequent deploys preserve the namespace and secrets. The module form part is
`worker.js` with `application/javascript+module`. The script writes a public manifest
containing resource IDs and secret **names**, never token or secret values.

If generating new secrets on another machine, coordinate both ends before switching
production; the uploader reuses its local handoff file rather than rotating on every
deploy. Keep the migration stable; introduce a new tag for future schema/class changes.

Build the site handoff with `cd web && npm run build`, then from the root run
`bash deploy/site/build-site.sh`. The latter assembles both cockpit and Center assets,
leaving `web/dist` built for `/center/`. It does not deploy Railway.

## Verification and its limits

[Live round evidence](../../tools/tests/evidence/cloudflare/live-round.json) and its
adjacent mobile screenshots record a real deployed Worker, authoritative WebSocket
inputs, collected points and the signed callback accepted by Python replay. The API
used for that verification was the updated **local** Center through a temporary named
Cloudflare tunnel. It was not the old deployed Railway API. The temporary hostname
and tunnel are removed after verification, and the Worker upstream is restored to
the production Railway hostname. Production end-to-end completion therefore remains
Hermes's post-deployment check; `/multiplayer/health` alone does not prove it.

The final canary measured 30 Hz simulation and 9.78 Hz received broadcasts across a
forced reconnect (10 Hz target) with two connected players,
including fresh-ticket reconnect, real move/jump/dodge/open/loot actions and a visible
settlement. See JSON for exact rates, intervals, IDs and zero browser console/page
errors. This is a software-rendered Chromium run at 390×844, not a physical-phone
frame-rate or regional latency benchmark. No funded payout was exercised.

Unit tests compare all three TS reducers against snapshots produced by the unchanged
Python reducers, including inputs, errors, terrain, RNG, eligibility and restore.
The HTTP result integration test uses signatures generated by the actual TS bridge
and checks tampering, stale signatures, forged scores, atomic rollback, idempotent
settlement and restart restore. Local workerd smoke tests cover the SQLite DO,
immutable bootstrap, ticket replay, stale inputs, acknowledgements, live patches,
read-only spectators and suspension. The final spectator authorization addition was
checked locally after the live two-player run.

Active DOs use a 33.33ms timer and cannot hibernate while simulating. Cloudflare does
not promise a hard real-time 30Hz timer. The port preserves Python's fixed-step and
long-gap behavior (clear expired inputs, bounded catch-up); checkpoints every second
plus critical actions can lose up to roughly one second of uncheckpointed movement
on isolate failure. Finished checkpoints retry signed callbacks every 15 seconds.
The result journal is limited to 100,000 events and the API body to 8MiB; high-player
600-second rounds need load/recovery verification before wider activation. Keep
combat-duel/boss-raid on Railway until their live checks pass. No lower simulation
rate was needed for this two-player canary.

During verification, Workers rejected `redirect: error`; fetch now uses `manual`
and rejects non-success statuses. Broadcast scheduling also now accumulates the
100ms cadence rather than losing ticks to interval rounding. Those failures were
fixed before the successful evidence run.

## Custom domain and rollback

An optional `mp.orbixcore.fun` hostname must be configured inside the orbixcore.fun
zone using a Worker custom domain, or a proxied DNS record plus the zone route
`mp.orbixcore.fun/* → multiplayer`. A zone route does not apply to workers.dev.
Use the zone-scoped token for zone routes, add the exact browser origins to
`ALLOWED_ORIGINS`, and update `CENTER_CF_ORIGIN` before new connections switch.
No custom gameplay domain was installed in this release.

For rollback, set the per-game admin host to Railway for future publications. Drain
existing CF rounds and their result outboxes; never start a duplicate Python sim for
a room pinned to Cloudflare. Leave matching bridge secrets available until those
rounds settle. The Worker holds no vault/signing key and never creates allocations.

References: [DO WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/),
[alarms](https://developers.cloudflare.com/durable-objects/api/alarms/),
[migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/).
