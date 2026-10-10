# Build round 4: phases 4 and 5

Implemented all five v1 templates: Closest Call, Word Forge, Prism Lines, Relic Auction and Atlas Quest. Existing restored engines and packs were retained and completed. Each has strict rules, engine registration, private bounded hints, objective eligibility, a deterministic deck/seat order, durable receipts, JSON-safe snapshots, semantic input controls, a Three.js tabletop, original SVG fallback banner and its own WebP illustration. The browser sends only intentions. Content answers/dictionary/decks remain server-only; approved pack bytes and SHA-256 digests freeze before publication and start. Restores use stored pack bytes.

Creation/rematch forms preserve pack hashes and hint settings, compute the full duration from game windows, enforce the player caps, and limit Prism Lines match rewards to rank 1. Custom host/admin hints are disabled for these templates. Existing reward/entry contracts and money paths were not changed. Qualified final ranks now match the eligibility-filtered allocation order, including cases where an unqualified player has the largest total display score.

The catalog reports placement separately from availability and classifies latency sensitivity. The five new games, Number Hunt and RPS are featured. Movement worlds appear in More games. Admin Offline hides a game from discovery and creation and pauses anonymous practice; historical room routes, results and claims remain accessible. No availability settings were changed by this build.

## Verification

- `PYTHONPATH=/home/agentuser/vibeswap center/.venv/bin/pytest center/tests tests/test_center_community.py --tb=short -ra`: **799 passed**. This includes scoring/eligibility vectors, full matches, exact deadlines, immutable choices, hint budgets, sealed dictionary membership, JSON snapshots, socket secrecy/private reconnect, zero-client restart/settlement transcripts, and rematches.
- `/home/agentuser/.foundry/bin/forge test`: **162 passed**, unchanged total.
- `cd web && npx tsc --noEmit`: passed.
- `cd web && npm run build`: passed. Vite reports its existing large-chunk warning for lazy Three/Babylon payloads.
- Real Chromium headless, 1280×900 and 390×844 touch/reduced-motion contexts: every new stage rendered a Canvas, accepted input, and displayed a private hint without page errors or horizontal document overflow. Immersion retained its Minimize button; portrait play remained usable.
- Chromium CDP network emulation: selection/result and reconnect checks under 150/300/600 ms added latency and a 2.5-second offline interval. Detailed observations are recorded below. These are local browser tests, not measurements from an Indian physical Android phone. CDP delay plus local automation/rendering load is not a measured geographical RTT. No p95/FPS or loss/jitter claims are made.

Only three existing regression expectations were deliberately adjusted: engine registry count 20→25, API catalog count 20→25, and the generic patch-safety fixture's admission minimum for the two new multiplayer-only games. Patch safety is retained; the reducers keep public patch value types stable. Existing financial tests remain green.

## Network observations

Every game retained one Canvas and recovered after the offline interval at each added-latency band. Closest Call, Word Forge, Relic Auction and Atlas Quest displayed their server result after reconnect. Prism Lines retained the acknowledged placement on its board. The combined runs reported no page errors. Raw observations are in `build-round4-network.json`.

The recorded `ackMs` covers the automation click (including waiting for a enabled turn/control), scrolling, rendering and visible acknowledgment. Five software-GPU pages ran concurrently. Observations ranged from 948 to 9,717 ms; these are functional checks and do **not** establish the spec's acknowledgment performance target. No physical Android, geographical RTT, loss/jitter, p95 or FPS measurement was performed. A separate cold-cache run interrupted an optional character-model fetch: its error boundary kept the tabletop and inputs available, while Chromium still reported the failed asset request. This remains a limitation of optional-model loading during a cold-cache disconnect.

## Artwork and provenance

The five `web/public/center-art/<templateId>.webp` files were generated with the built-in image generation tool in the existing colorful floating-island style. Their exact prompts, SHA-256 values and saved paths are in `web/public/center-art/provenance.json`. Code-native original fallback illustrations are in `web/src/center/PortfolioBanners.tsx`, registered in both bannerArt and gameArt. Server content provenance and hashes are in `center/content/manifest.json`; the map outlines are original simplified artwork, with factual place coordinate sources in the server pack.

## Funding contract check

The current funding API uses `center/reward_flow.py:RewardFlow` and the existing `src/center/RewardEngine.sol`. That pool/receipt route has no per-template registry and retains its safety-version, flag, verified-funding, allocation and claim checks. The separate legacy `CenterEscrow.sol` path does call `CenterRegistry.isTemplate`; using these IDs through that path would require owner approval of their template hashes. This build did not register templates on chain, sign funding transactions, change funding flags, deploy contracts or deploy Railway.

## Preserved work and delivery

The restored homepage notice was retained, with its shared asset references refreshed. Static Center artifacts were rebuilt for the existing image/site paths. Before refreshing generated artifacts, a local backup was saved at `/tmp/orbix-restored-artifacts-preserved`. Tracked Python bytecode is excluded from source commits and preserved in that backup; no restored source or game logic was discarded.
