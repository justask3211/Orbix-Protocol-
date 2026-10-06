# Compact arenas and game operations

## Behavior

New Token Catch and Boss Raid rooms use bounded 20 x 16 movement arenas. Existing
rooms without `arena_mode` retain their original engines and replay behavior.
`combat-duel` is a separate two-player combat template; `reaction-duel` remains
available as Rock Paper Scissors Duel. Number Hunt is preserved.

Number Hunt, Token Catch, movement Boss Raid, and Arena Duel support rounds up to
600 seconds. The creation wizard validates numeric limits while typing and uses
themed radio/toggle cards. Running rooms offer an expanded game view with chat
below, a Minimize button, and Escape. Admitted players reconnect through the
normal authenticated admission checks when returning to a running room.

Token Catch awards game score for landed coins, supports temporary push/shield
pickups, and scatters exactly half the collected score after bombs or knockouts.
Arena Duel supports hands, sword, spear, gun, guard, pickups, and knockout wins.
Boss Raid supports up to 50 admitted players and crews with 2–5 configured slots;
players choose a crew or receive a balanced assignment. The unique crew with the
highest positive boss damage wins; minimum contribution still governs eligibility.
Tied or inactive contests do not arbitrarily select a rewarded winner.

## Authority and durability

Clients submit finite movement directions, facing, and increasing input sequences,
never trusted coordinates, scores, damage, or weapon inventory. Server ticks at
30 Hz with a 250 ms input lease. Public room snapshots are sent at 10 Hz; movement
logging and snapshots share an atomic checkpoint once per second. Critical actions,
finish, and graceful shutdown flush the pending accepted batch. Sudden process
termination can lose the most recent uncheckpointed movement interval.

Shared instanced geometry renders up to 50 characters. The WebGL renderer loads
on entering a game, with a loading indicator and fallback. Character selection is
cosmetic. Temporary shields, stun, respawn, projectile ownership, crate damage,
and boss attack location all use authoritative server state.

## Admin and practice

The configured admin wallet can observe public or private rooms without admission,
an appearance in the roster, or a join announcement. Observation exposes only
public engine state and authorized moderation data, never seeds or sealed moves.
Mutations require fresh signed admin proofs and append audit records. Tools cover
chat/log visibility, clues, comment deletion, kick/ban/unban, room archival, and
game live/maintenance/offline status. Archival removes discovery/admission while
preserving settlement and claim evidence; it is not destructive financial deletion.

`/center/practice/<templateId>` runs bounded, memory-only bot sessions without a
wallet, room, entry payment, ledger write, or token rewards. Session tokens travel
in request headers or action bodies, not URLs. Practice handlers run on the same
event loop so concurrent input/poll requests cannot race their mutable simulations.

## Verified evidence and limits

- 434 Python regression tests pass, including arena authority, bomb conservation,
  restart checkpoints, 50-player assignment, private admin observation, signed proof
  replay rejection, and practice isolation. A subsequent focused check of the
  practice/admin handler change passed all 19 relevant tests.
- TypeScript checking and the production Vite build pass. Shared scene chunk:
  approximately 945 kB minified / 251 kB gzip, loaded on demand.
- Browser checks covered immediate rejection of 601 seconds, acceptance of 360,
  expanded/minimized play, rendered movement worlds, server-confirmed robot
  selection, and committing a Rock Paper Scissors practice move.
- Local 50-player reducer benchmark over 300 ticks: tick p50 0.227 ms / p95
  0.318 ms; public-state copy/serialization p50 0.787 ms; snapshot 34,473 bytes.
  These figures exclude WebSocket fanout, actual client networking, browser frame
  rate, and production hardware. Fifty simultaneous real clients remain untested.
- Funded rewards retain the existing escrow/entry/claim integration. This release
  does not verify or promise immediate automatic on-chain wallet credit. Contract
  addresses and payout integration require a separate funded end-to-end check.
