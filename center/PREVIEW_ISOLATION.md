# Per-game customization and offline preview

`PATCH /api/center/v1/admin/games/{templateId}/config` saves a complete, strictly
validated configuration through the existing administrator session and single-use
`X-Admin-Proof`. Editable fields are `placement`, `overlay`, `tag`, `modes` and
`sort_order`. Unknown fields, including nested fields and client-supplied evidence,
are rejected. Metadata and the `game.customization` audit entry commit in one
SQLite transaction. Stored evidence includes the actor, proof digest and
`updated_at`; public catalog responses exclude this evidence.

Placement is `catalog`, `more`, `upcoming` or `hidden`. Overlay defaults to an
enabled blue “Coming soon” badge in the top-right corner. Its text and tag text
support at most 40 characters. Colors accept six-digit `#RRGGBB` or blue, purple,
green, amber, red and slate. Corners are top-left, top-right, bottom-left and
bottom-right. Tag styles are subtle, solid and outline. Sort order is a strict
integer from -100000 to 100000; lower values appear first.

The public `/templates` API preserves the existing descriptive `modes` string
and publishes effective toggles in `available_modes`, together with placement,
overlay, tag and sort order. `/rooms` and room detail also carry `gameConfig`.
Upcoming games expose only enabled preview; hidden games expose no public play
modes. Maintenance pauses server play, and offline status hides discovery.
Saved toggles remain intact when a game changes placement. Room publishing,
draft creation, reward preparation and joining enforce their relevant modes
before creating or charging anything. Existing admitted matches keep their
server-controlled engine, scores, actions and settlement.

## Preview isolation

`/center/preview/{templateId}` is a separate client-only route. The site forwards
only the initial preview HTML request to the Center backend to check its current
preview policy. Disabled, hidden and unknown previews return 404. The HTML is
not cached. Catalog preview links perform this page navigation. Assets are then
loaded normally. There are no API requests after the initial page load, no
WebSocket, no account requirement and no room creation.

`CenterApp` selects `PreviewArena` before mounting `useSession`, so even a saved
generated wallet cannot probe a token, fetch balances or sign in. Preview does
not mount practice polling, room channels, community, vault, result or reward
components. `OfflinePreviewEngine` holds a cloned public fixture and local demo
reducers in memory; it has no transport, credentials, database, browser storage
or settlement interface. Reset and unmount discard state. Its local seed setting
controls deterministic demo choices. Fixtures cover all 25 game templates and
are generated at build time from the public demonstration seed
`orbix-offline-demo-v1`, authored sample rules and the registered engines:

```sh
PYTHONPATH=. center/.venv/bin/python tools/center/generate_preview_fixtures.py
```

Preview reuses `FOUR_STAGE_VIEWS` / `STAGES` and the shared 3D assets with
`state._offline`. Local arena motion bypasses network interpolation and input
coalescing. Turn-based previews do not continuously rerender their boards.
The “Preview — offline demo” badge stays inside the immersion subtree, including
fullscreen. Demo scores and results are illustrative; preview is a playground,
not a port of server adjudication or a source of rewards.

Try now remains the separate server practice flow: requests, bounded in-memory
matches, polling, server action validation and cleanup. Contrary to the initial
brief’s DB wording, existing practice already does **not** persist rooms,
ledger records or entitlements. That behavior remains intact. The existing
practice presets are preserved; other registered templates can now opt into
this same server practice shell through their individual toggle using authored
sample rules. They remain disabled by default where practice was unavailable.
The historic room configuration `mode="preview"` still means a real
server-controlled points room; it is not the offline preview route.

## Verification

- `center/tests/test_game_customization.py`: placement transitions, badges,
  ordering, strict validation, persistence/reopen, exact administrator and
  single-use proofs, server mode gates before side effects, opt-in practice
  across all templates, and atomic audit rollback/chain verification.
- `center/tests/test_offline_preview.py`: anonymous preview pages across all
  engines leave every DB table unchanged, allocate no runtimes or practice
  matches, reject disabled previews and reproduce the bundled fixtures.
- `node tools/tests/offline-preview-regression.mjs`: local inputs, seeded
  determinism and arena movement/jump/attack with all network and storage access
  configured to throw.
- `ORBIX_BASE_URL=http://127.0.0.1:8118 node tools/tests/game-customization-browser.cjs`:
  all 25 preview routes with a stored wallet, no API/WebSocket, real local UI
  inputs, signed configuration saves, live banners, draft preservation,
  catalog placement/mode gates, and reduced-motion 390px layouts. Start the
  existing site server with `CENTER_DIST_DIR` pointing to a production build and
  `CENTER_INTERNAL_URL` pointing to a disposable local Center backend.

Intentional existing-test changes: the portfolio catalog assertion now expects
`catalog` instead of `featured`; the admin browser banner assertion accepts the
shared original image artwork and its vector fallback.
