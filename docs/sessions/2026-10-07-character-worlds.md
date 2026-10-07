# October 7: playable character worlds and feedback fixes

## Human request and intent

The user reported an Internal Error when their connected admin wallet removed
a room, and a connected wallet positioned beyond the mobile header. They
rejected the previous overhead arena experience: small real perspective spaces,
movable human characters, FPV/TPV, jump, aiming, combat and touch controls were
intended. Graphics should stay lightweight while the mechanics become playable.

Specific requests: split a Token Catch room's total pool into timed supply
crates and separately contested coin piles; add bomb spills, random guns,
10-second knockouts and 2-second punching. Boss crews choose formations and
fight with identical starting guns, collectible upgrades and varied attacks;
top one/two/three crews receive configurable rewards. Arena Duel should have
weapons, melee combinations and guard/dodge. Creator choices should use vibrant
cards and explanatory Info buttons. Commit/deploy the result and write durable
agent guidance and per-update history.

## Result and why

- Added explicit version-3 server reducers for 40×40 character worlds. Existing
  stored rules default to version 2 so prior rooms/replays do not change mechanics.
- Rebuilt arena rendering with human-shaped instanced characters, perspective
  follow/first-person cameras, animated limbs and weapons, cover, parachuting
  crates, real public loot and boss telegraphs. Original procedural art avoids
  heavy downloaded models/textures and copied commercial game assets.
- Camera-relative keyboard/touch movement, sprint, jump, guard, dodge and held
  attack release safely on blur/disconnect. Server finite-angle, sequence,
  lease, collision and cooldown checks remain authoritative; fresh action aim
  avoids stale-facing shots when movement is coalesced.
- Token Catch's 500/10/5 defaults implement ten 50-unit crates, each split into
  ten independently claimed piles. Opening does not claim everything. Server
  pickup uniqueness, minimum intervals and conservation guard contested loot,
  bomb spills and proportional reward allocations. Unclaimed units are withheld.
- Raid starting guns match; health/time upgrades improve damage and fire rate.
  Slam/wave/beam/meteor warnings, dodge/jump/cover and ten-second respawn create
  movement decisions. Podium presets and editable shares control crew rewards
  using exact integer allocations and qualifying-member splits.
- Duel supports light/heavy/kick combinations with fists/sword/spear and optional
  guns. Number Hunt and sealed Rock Paper Scissors remain separate working games.
- The admin failure was reproduced with a pre-hash audit-table schema. Added a
  startup migration preserving historical rows; archived metadata and audit now
  commit together. Failure rolls back, and existing hash chains are not repaired
  automatically. Signed UI archive/restore works locally; claim records remain.
- Fixed inherited wallet width/grid styles and compact phone spacing. Vault,
  connected address and disconnect control fit 320px and 390px screenshots.
- Creator fields now use themed illustrated cards, share editor and accessible
  Info disclosures with inline bounds/sum validation. Reward labels reflect the
  total Catch/raid pool rather than a misleading per-winner default.

Main files and design/authority details are mapped in `AGENTUSE.md`.
No new runtime dependency, contract deployment or production reward flag change
is part of this update. Existing generated banners are reused with their
provenance. Added session documentation avoids losing these product decisions.

## Verification

461 Python tests pass, including 25 new character-world tests and two added
admin regressions relative to the 434-test previous release. Coverage includes
physics/stop leases, finite aim, duplicate loot, exact scheduled budget, bomb
conservation, gun/punch recovery, cover projectile blocking, raid upgrades and
attacks, tie/podium large-integer payouts, snapshot/RNG restore and an
authenticated WebSocket jump/loot/settlement flow. TypeScript and Vite pass.
The build initially found an older Node on child-process PATH; using Node 24
consistently corrected the environment without changing app code.

Browser checks: perspective Catch/raid/duel scenes; first-person hands and
camera toggle; fresh duel jump/dodge controls; raid podium preset updates and
Info disclosure; local admin archive/restore; connected phone headers at 320px
and 390px. A stale completed practice session correctly disabled combat;
restart created a fresh playable trial. The temporary phone-check page was
removed before building.

Local raid reducer sample: 50 players, 600 ticks; tick p50 0.667ms/p95 1.472ms;
public-copy + JSON p50 2.760ms; final state 57,397 bytes. Timed tick excludes
submitted-action processing, checkpoints, websocket fanout, production/network
cost and browser frame rate. Renderer chunk is 953.64kB minified/253.33kB gzip
and lazy loaded. Fifty actual simultaneous clients and target-device FPS have
not been measured. Live funded automatic payouts were not tested and must not
be claimed complete because preview settlement passes.

## Publication procedure

Commit the verified source, this guidance/history, and both prebuilt SPA copies.
Use committed-tree archives excluding secrets, QA databases and bytecode. Deploy
API first, then site, preserving production storage and reward configuration.
Verify deployment status, readiness, served bundle hashes and new practice
protocol. Record verified deployment IDs/results in the release follow-up;
this entry describes the tested implementation, not an unobserved deployment.
