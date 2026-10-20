# Tournament authority and entry accounting

The tournament is a durable SQLite record with an optimistic revision. Participant
admission, fee intent, pool balance, scheduling and advancement run in one transaction
(including nested Store operations through savepoints). A restart polls the current
round and restores normal room runtimes. No browser-provided winner is accepted.

1v1 templates (`reaction-duel`, `rps-duel`, `combat-duel`, `prism-lines`) use
elimination. Seeds occupy the standard mirrored power-of-two bracket; missing
seeds give the highest seeds first-round byes. Random seeding uses system entropy
at start; creator/admin ordered wallets must match the complete entrant set.
Round names can override Round N / Quarterfinal / Semifinal / Final.

Other templates use balanced rooms of at most K players; top M **eligible** players
advance. A short room advances at most its actual eligible population. Every
supported population must fit within the creator's maximum heat count. Solo games
run one room per entrant and halve the aggregate field each heat. Equal placements
between different rooms use the frozen tournament seed order; ties within a game
use that engine's rules. No eligible winner triggers a new room with the same
roster, without a second fee. The final room ranks the podium; earlier eliminated
players follow in reverse-round order. Preview-credit integer rounding remainder
goes to the first rewarded place so allocated points exactly equal the entry pool.

Registration -> running -> round-N -> final -> settled -> closed. Cancellation
from any pre-settlement stage refunds every original entry intent once. Registration
expiry cancels undersubscribed tournaments; auto-start tournaments otherwise start
at expiry or when full. Creator/manual tournaments await their authorized starter.
All players are pre-admitted to their assigned rooms; everyone still presses Ready.
The scheduler starts each fully ready match. An unrelated wallet cannot enter it.

Admin caps bound player count, entry fee, room size, heat count and registration
window. Creator edits are supported; entry price, game rules and payout terms freeze
when the first entrant joins. Only the admin can set a front-page banner (text,
size, preset style and placement). Signed admin writes use the existing fresh-proof
flow and audit chain. Creator controls use wallet sessions. Join lists, my tournaments,
scrollable bracket, room links, pre-entry disclosure and existing winner podium are
available in the web shell.

## Financial boundary

**This release supports preview-credit entry pools and standard preview-point
entitlements. It does not accept ERC20 tournament pool payments.**
The deployed CreatorTokenGate forwards tokens directly to a creator, custom payee,
or burn address. It has neither tournament escrow nor cancellation refunds.
RewardEngine accepts deposits only from a pool creator, so it cannot currently
aggregate joiner fees either. Calling those payments a refundable tournament pool
would be false. `fee_unit=erc20` fails closed before payment. Existing room token
entry, RewardEngine funding and claims remain intact.

The repo also contains `CenterGamePot`, with creator-only cancellation and a
permissionless room namespace. The existing audit records those restrictions;
it is not integrated with the REST room/reward wizard. Reusing it unchanged would
not satisfy admin cancellation/refunds or tournament admission binding.

A follow-up needs a reviewed tournament escrow/deposit adapter and, if based on
CenterGamePot, explicit admin cancellation and namespace/admission authorization, receipt indexing, explicit custody/expiry rules and RewardEngine settlement
binding before enabling ORBIX/creator-token entry pools. This is a spec limitation,
not a Cloudflare credential dependency.

## API

Under `/api/center/v1`: GET/POST `tournaments`, GET `tournaments/mine`, GET
`tournaments/caps`, GET/PATCH `tournaments/{id}`, POST `{id}/join`, `{id}/start`
(optional `seeds`), `{id}/cancel`, `{id}/close`, `{id}/report-match-result`
(`matchId`, results always read from room settlement). PATCH
`admin/tournaments/caps` requires a fresh admin proof.
