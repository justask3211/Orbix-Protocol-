# Orbix Center home + shared promo — 2026-10-21

Production builds served locally through `deploy/site/server.js` on port 8110,
with the local `tools.tests.tournaments_hold_fixture` API on 8108. No Railway deploy.

- `games-1440.png`, `games-390.png`, `mobile-top.png`: game discovery and promo.
- `rooms-1440.png`, `rooms-390.png`: Create & Join, wallet and public rooms.
- `cockpit-promo-*.png`: the same script rendered on the actual root cockpit.
- `verification.json`: deterministic catalog/admin fixtures, browser interactions,
  zero unexpected console/page errors, zero axe WCAG A/AA violations for the home
  and promo at 1440px and 390px. Includes 320px overflow and keyboard checks.
- `cockpit.json`: actual root cockpit + local API settings, exact CA copy, no errors.

The catalog fixture intentionally includes live creatable games, join-only,
maintenance, offline, hidden, More and Upcoming entries. It does not represent live
production inventory or token price. Existing generative banner artwork is reused.
The legacy default announcement `Buy $ORBIX` receives the richer default message;
custom admin text and HTTPS links remain authoritative. No price data is shown.

Reproduce from the repository root after `cd web && npm run build` and
`bash deploy/site/build-site.sh`:

```sh
PYTHONDONTWRITEBYTECODE=1 /tmp/orbix-build-venv/bin/python -m uvicorn tools.tests.tournaments_hold_fixture:app --host 127.0.0.1 --port 8108
PORT=8110 CENTER_INTERNAL_URL=http://127.0.0.1:8108 node deploy/site/server.js
ORBIX_BASE_URL=http://127.0.0.1:8110 node tools/tests/home-promo-browser.cjs
ORBIX_BASE_URL=http://127.0.0.1:8110 node tools/tests/cockpit-promo-browser.cjs
ORBIX_BASE_URL=http://127.0.0.1:8108 node tools/tests/game-customization-browser.cjs
ORBIX_BASE_URL=http://127.0.0.1:8108 node tools/tests/tournaments-hold-browser.cjs
```

Run servers in separate terminals; use a Python environment with the project test
requirements. Review applied the [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md):
semantic controls, visible focus, live copy/error feedback, full-size touch targets,
links for navigation, URL-persisted views/filters, explicit animation pause and
reduced motion. Automated checks complement the desktop/mobile screenshot review;
they do not constitute a complete manual assistive-technology audit.
