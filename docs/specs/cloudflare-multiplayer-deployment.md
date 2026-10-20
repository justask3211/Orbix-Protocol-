# Cloudflare multiplayer scaffold deployment

This is **transport infrastructure, not enabled multiplayer gameplay**. All three
engine adapters report unavailable, new CF game publication is blocked, and no
settlement/reward authority runs on Cloudflare. The user deploys using their own
Cloudflare account. Hermes may not have Cloudflare credentials. This build does
not assume access to that account and does not deploy to Railway or Cloudflare.

## Local validation (no account needed)

Node 22.22+ and the Python Center test dependencies are needed. From the repo root:

```sh
cd web
npm ci
npm run build
cd ..
bash deploy/site/build-site.sh
cd workers/multiplayer
npm ci
npm run typecheck
npm test
npm run build
```

`npm run build` is Wrangler `deploy --dry-run`: it produces a local bundle and
validates bindings without uploading. `deploy/site/center-dist` must contain the
current `/center/` build first. The Worker strips `/center/` when reading this
asset directory; SPA navigation gets `index.html`, API requests go to Railway.

For the local DO/WebSocket smoke test create **local test secrets only**:

```sh
cd workers/multiplayer
cat > .dev.vars <<'EOF'
EDGE_TICKET_SECRET="test-edge-only-secret-32-characters-long"
PROVISION_SECRET="test-edge-only-secret-32-characters-long"
EOF
npx wrangler dev --ip 127.0.0.1 --port 8787 \
  --var TRANSPORT_SMOKE:true --var ALLOWED_ORIGINS:http://127.0.0.1:8787
```

In a second terminal from the same directory:

```sh
node tests/local-smoke.mjs
```

This tests signed provision, immutable commitment, nonce replay, first-frame
`session.hello`, `session.ready`, ping, action rejection and frontend deep links
against a real local workerd + SQLite DO. `TRANSPORT_SMOKE=true` still rejects all
game inputs with `ENGINE_PORT_PENDING`; it does not enable a game engine. Keep it
false on public deployments. Never reuse the published fixture secret outside local
tests. `.dev.vars` and `.wrangler` are ignored by Git.

## User-owned Cloudflare deployment

1. Install dependencies above. Edit `workers/multiplayer/wrangler.jsonc`:
   - `name` is the user's chosen Worker name.
   - Set `RAILWAY_ORIGIN` to the actual public HTTPS Center service origin. The
     supplied hostname is a deployment example; verify it for this account.
   - `ALLOWED_ORIGINS` must include the exact HTTPS Worker/custom-domain frontend
     origin and any primary-site origin permitted to open game sockets.
   - Keep `TRANSPORT_SMOKE` **false**. The engine/readiness code gate stays false.
   - Optional custom domain: add `"routes": [{"pattern":
     "multiplayer.orbixcore.fun", "custom_domain": true}]` after configuring the
     user's zone in Cloudflare. Default deployment uses `workers.dev`.

2. Authenticate with the user's account (or supply an account-scoped API token and
   `CLOUDFLARE_ACCOUNT_ID` through the user's secret manager):

```sh
cd workers/multiplayer
npx wrangler login
npx wrangler whoami
```

3. Generate two independent random secrets of at least 32 bytes. Enter them through
   interactive Wrangler prompts, never commit them or embed them in frontend env:

```sh
npx wrangler secret put EDGE_TICKET_SECRET
npx wrangler secret put PROVISION_SECRET
```

   When the full runtime integration ships, configure Railway's
   `CENTER_EDGE_TICKET_SECRET` to the same ticket secret and its provisioning secret
   to match `PROVISION_SECRET`. `CENTER_SESSION_SECRET` is a separate, optional
   durable wallet-session HMAC secret on Railway; it is not exposed to this Worker.
   No settlement signer, vault key or reward authority key belongs on Cloudflare.

4. Deploy the Worker and static multiplayer shell:

```sh
npm run typecheck
npm test
npm run build
npx wrangler deploy
npx wrangler tail
```

The checked-in config binds `ROOMS` to class `MultiplayerRoom` and creates a SQLite
DO namespace via migration `v1` / `new_sqlite_classes`. Keep that migration tag
stable after first deployment; add new tags for future class changes. Do not rename
or delete the namespace to clear live rooms. See [Cloudflare migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/).

5. Verify the printed deployment URL:

```sh
curl --fail https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/multiplayer/health
curl --fail -H 'Accept: text/html' \
  https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/center/rooms/aaaaaaaaaaaaaaaa
```

Health must return `ready:false` with
`V4_ENGINE_PORTS_AND_SETTLEMENT_BRIDGE_PENDING`. That is expected for this release.
Do not advertise playable CF rooms. Public `/internal/*` provisioning without a
valid HMAC must return 401. Direct public game sockets remain unavailable.

## Subsequent activation and rollback

The architecture doc lists required engine parity, recovery, result verification
and regional measurements. After those ship, deploy the completed Worker, configure
Railway's matching signed-ticket/provisioning bridge, then use the signed admin
**Play modes → Multiplayer host** selector on the three real-time templates.
Other templates reject Cloudflare host selection. Existing room host metadata never
changes with that preference; Railway rooms continue normally.

With the current scaffold, choosing Cloudflare blocks **new** rooms with
`CLOUDFLARE_RUNTIME_NOT_READY` before fees/funding. Choose Railway again to restore
publication. Never migrate an active reward-bearing room by changing this selector.
A future rollback needs existing CF room draining and outbox recovery, rather than
starting a duplicate Python simulation. Cloudflare deployments do not replace the
Railway REST/catalog/profile/wallet/reward service.

Hosting behavior references: [Workers static assets](https://developers.cloudflare.com/workers/static-assets/),
[DO WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).
