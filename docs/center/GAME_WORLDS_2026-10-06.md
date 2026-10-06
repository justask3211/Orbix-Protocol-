# Four-game experience release

The featured games now have distinct procedural 3D worlds and accessible controls:
Number Hunt's puzzle islands, Boss Raid's crystal arena, Token Catch's runway and
Duel's split coliseum. The renderer loads only when a game room needs it, bounds
pixel density, pauses hidden tabs and retains controls when WebGL is unavailable.

Boss Raid supports two teams of three with server-issued damage, lobby team
selection and winning-team eligibility. Existing cooperative configurations remain
compatible. Token Catch rejects future and expired spawns; Duel enforces commit and
reveal deadlines without exposing unrevealed choices. Accepted actions broadcast
public state to all room players. Reconnecting clients receive fresh authenticated
tickets and restored state; private hints remain private.

Join accepts room codes and invite links and filters active public rooms by game,
state, entry and reward type. Vault is beside the header wallet. Creation and room
controls share themed selections. Creators can set chat and visibility preferences,
schedule or send hints, delete comments and remove or ban players before play.
An authenticated creator roster includes names and wallets with safe CSV export.
Community messages refresh every five seconds while visible; gameplay uses WebSocket
updates. Removing players does not promise a refund of direct contract entry fees.

Paid admission now verifies the configured CreatorTokenGate on chain 46630, including
historical payment events, token decimals, confirmations and matching room terms.
Unavailable RPC or missing proof refuses admission. Existing paid members reconnect
without another frontend payment. No contracts were changed in this release.

Verification: Python regression suite, TypeScript and production build; browser
checks of all four rendered worlds, room creation, joining, readiness, Number Hunt
input/private hints, scheduled hints, creator roster and durable state recovery.
Dependency audit reported zero vulnerabilities. No target-device FPS measurement or
funded live prize transaction was performed. Automatic winner transfers are a
separate unfinished integration; preview entitlements are not proof of token payout.

Deployment uses separate committed-tree archives for the API and site, excludes QA
databases and bytecode, retains the production volume and publishes the API first.
The earlier STATUS.md contains historical evidence and should not be interpreted as
verification of the current production reward configuration.
