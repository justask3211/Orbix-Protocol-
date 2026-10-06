# Game center UI — October 2026

## Player experience

The homepage now features Number Hunt, Co-op Boss Raid, Token Catch and Duel.
Other templates are listed as coming soon. Existing room URLs and server engines
remain compatible. Duel uses the existing commit/reveal rock-paper-scissors
engine; the boss raid currently remains cooperative. Competitive teams of three
and playable 3D environments are the next gameplay phase.

The center has a new illustrated hero, four individual world previews, search,
category filters, instructions, public-room discovery, invite validation and
a genuine four-step create-room wizard. Only registration/ready public rooms
from the four featured games appear as joinable. Navigation resets scroll;
dialogs trap keyboard focus, close with Escape and restore the trigger.

Wallet holdings, on-chain vault credit, ledger credit and preview points have
distinct labels. Balance requests share one read-only resource, poll while
visible and discard late responses after session changes. Deposits require
verified live contract metadata, matching wallet account, chain 46630,
explicit review, approval when needed and a successful receipt. Direct transfers
are not advertised as vault deposits.

## Art and loading

Four world illustrations were generated with the built-in image-generation
tool and converted to 960px WebP previews (404 KB combined). They are concept
art, not screenshots of implemented 3D gameplay. Prompts, output hashes and
sizes are recorded in `web/public/center-art/provenance.json`; the conversion
script is `tools/prepare-center-art.mjs` and takes the recorded original files.

The center and cockpit now load separate JavaScript chunks. The center does
not need the cockpit's WalletConnect modules on initial load. Artwork loads
lazily except the hero; fixed artwork containers avoid layout shifts. Hover
depth and the limited hero animation honor reduced-motion preferences.

## Verification

- TypeScript checking and the Vite production build passed with Node 24.19.
- 41 tests passed: flow, deposit reconciliation, token identity, profiles and
  preview-entry guards, using isolated temporary databases.
- Browser checks covered all four loaded illustrations, search, category
  filtering, invalid external invites, wizard steps/name validation,
  disconnected vault, Escape dismissal and focus restoration.
- At the inspected 714px viewport there was no horizontal overflow; the CSS
  also contains dedicated phone breakpoints. A real phone performance run
  and funded browser-wallet transactions have not been executed.
- The lockfile's old HTTP registry mirror URLs were replaced with HTTPS npm
  registry URLs without changing pinned versions or integrity hashes.

## Verified limitations

The existing wizard submits `mode: preview`, `vault_mode: simulated` and
`rewards.kind: preview-points`. Its former token/NFT/native-prize inputs were
not connected to that request. Those ineffective controls and the claim that
publishing funds prizes have been removed. Preview fees are labeled credits.
Contracts and funded-reward API support remain unchanged; a complete funded
creation interface needs a dedicated implementation and contract validation.

## Publishing

The live domain is served by Railway project `orbixcore`, production environment,
service `orbixcore` (not the Python `orbix-center` service). It is currently
deployed by CLI uploads, with no connected GitHub source or autodeploy trigger.
Its container uses `deploy/site/Dockerfile` and serves the tracked prebuilt
`deploy/site/center-dist`. Build `web` with base `/center/`, copy its output to
that directory, commit, then upload a clean release containing only the committed
`deploy/site` tree. Keep all other site assets and the cockpit build intact.
The deployment directory retains prior hashed assets for existing cached clients.

For an isolated release archive, a root `railway.json` can select the existing
Dockerfile explicitly. Do not add a site-specific root config to the shared
repository: its other Railway services have different build requirements.
Never include local databases, credentials, node_modules or development tools
in the site upload. Verify `/health`, the Center API health and served bundle
hashes after deployment before reporting the UI live.
