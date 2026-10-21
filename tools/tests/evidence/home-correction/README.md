# Corrected Orbix home — 2026-10-21

Supersedes the home restructure in `0d5a018f`. The original home JSX and CSS were
restored from `0d5a018f^`, then changed only for the requested catalog split,
final upcoming collage and tournament banner. The original navy/cream/lime/lavender
shell, lime hero, wallet, category pills, Games/More catalog tabs and always-visible
room invite/directory cards are retained. The catalog tab now reads “All games”.
The two-choice All games/Create & Join home navigation, Filter toggle, More expander
and charcoal/orange home overrides are removed.

The shared promo returns to the original top-of-body purple strip, gold text link,
14px typography and 16-second left-to-right motion. It retains Buy $ORBIX,
one-click full-CA copy, accessible feedback, pause, reduced motion and dismissal.
No newly branded orange conversion panel remains.

Evidence:

- `home-{1440,390}.png`, `home-top-*.png`: restored home with deterministic catalog
  fixtures, including live/create games in both original catalog placements.
- `tournament-collage-*.png`: large old-theme tournament banner immediately above
  the final visual collage, including hidden/maintenance/upcoming-tagged games.
- `featured-banner-*.png`, `small-promotion.png`, `tournament-editor-*.png`: real
  local API promotion edits, signed by the local fixture administrator, persisted
  with the existing banner fields. The editor filters by game, then selects a
  tournament; front-page promotion/star, headline, style and large/small placement
  are all backed by the existing signed PATCH endpoint.
- `active-tournaments-*.png`, `tournament-rules-code-*.png`, `tournament-joined-*.png`:
  directory, configured rules, code entry and completed API registration at both
  sizes. A tournament code is its existing 24-character ID; same-origin invite
  links are also accepted. Code entry opens rules and requires the existing
  consent/holding/admission checks before registration.
- `verification.json`, `tournaments.json`: assertions, zero unexpected page errors
  and zero axe WCAG A/AA violations in the tested home/promo and tournament views.
  Includes malformed/foreign links, missing-code recovery, terminal tournament
  exclusions, disabled/missing create permissions, hidden/offline/preview-only
  games, enabled upcoming tags/overlays, admin ordering, room controls, copy
  failure, reduced motion, promo settings/dismissal and 320px home overflow.
- `cockpit-promo-*.png`, `cockpit.json`: actual assembled root cockpit using the
  same legacy-style promo, configured buy destination and exact CA copy.

The home policy fixture does not represent production inventory. The tournament
checks use the real local API and signed wallet flow, an in-memory database,
preview credits and the existing deterministic holdings RPC stub. They establish
local registration and persisted settings, not a funded payment or production
holding balance. No Railway deployment or production settings change occurred.
No physical-phone or complete manual screen-reader audit is claimed.

Reproduce from the repository root, with the Python test environment installed:

```sh
(cd web && npm run build)
bash deploy/site/build-site.sh
PYTHONDONTWRITEBYTECODE=1 /tmp/orbix-build-venv/bin/python -m uvicorn tools.tests.home_correction_fixture:app --host 127.0.0.1 --port 8108
PORT=8110 CENTER_INTERNAL_URL=http://127.0.0.1:8108 node deploy/site/server.js
ORBIX_BASE_URL=http://127.0.0.1:8110 node tools/tests/home-promo-browser.cjs
ORBIX_BASE_URL=http://127.0.0.1:8110 node tools/tests/home-tournaments-browser.cjs
ORBIX_BASE_URL=http://127.0.0.1:8110 node tools/tests/cockpit-promo-browser.cjs
ORBIX_BASE_URL=http://127.0.0.1:8110 node tools/tests/tournaments-hold-browser.cjs
```

The pre-existing all-preview customization regression needs its original unrestricted
fixture (the corrected-home fixture intentionally disables hidden previews):

```sh
PYTHONDONTWRITEBYTECODE=1 /tmp/orbix-build-venv/bin/python -m uvicorn tools.tests.tournaments_hold_fixture:app --host 127.0.0.1 --port 8109
ORBIX_BASE_URL=http://127.0.0.1:8109 node tools/tests/game-customization-browser.cjs
```

Run servers in separate terminals. Restart the in-memory fixture between repeated
registration runs if its eight-player bracket fills up.

Deliberately updated existing tests:

- `home-promo-browser.cjs`: replaces assertions for the rejected two-view shell,
  Filter toggle, URL filters, More expander and orange promo with the restored
  home controls, original theme/motion, active-only grid and final collage.
- `game-customization-browser.cjs`: uses the restored More games tab, explicitly
  clears an upcoming overlay on its active fixture, and expects a hidden game's
  artwork in the collage while keeping it out of the active grid.
- `cockpit-promo-browser.cjs`: expects the original Buy $ORBIX copy and records
  the corrected purple promo evidence in this directory.

Added `homeCatalog.test.mjs` (three availability-policy tests),
`home-tournaments-browser.cjs` and the local-only `home_correction_fixture.py`.
No server, admission, settlement, tournament authority or per-game backend test
was changed. Full Python suite: 1,111 passed; frontend unit suite: 38 passed;
wallet regressions: 13 passed. Existing 25-stage customization and tournament/
hold/promo browser regressions passed. TypeScript, production Vite and dual-site
assembly passed; existing Starlette deprecation and Vite chunk warnings remain.
