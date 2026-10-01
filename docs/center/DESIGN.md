# ORBIX CENTER — DESIGN.md

## Product and audience
Orbix Center is a creator platform for community game rooms anchored to the Orbix DeFi cockpit. Creators configure distinctive games, clear join rules and sponsored rewards; players preview rules, join, play, and understand exactly how outcomes and claims work. The interface must never imply real funds moved when a surface is in preview.

## Design direction
A high-trust, live competition instrument: dark graphite surfaces, one decisive Orbix signal-orange accent, precise technical typography, and game-specific visual language. The distinctive signature is a **Room Capsule** that previews game, visibility, fee mode, hint policy, funding status and payout route as one coherent object. Avoid generic DeFi-dashboard cards and vague “playground” messaging.

## Tokens
- Canvas: `#0b0c0e`
- Surface: `#121416`
- Raised surface: `#191b1e`
- Border: `#272a2d`
- Primary text: `#f2f0ec`
- Secondary text: `#a5a7aa`
- Muted text: `#85888d`
- Brand accent: `#ff6b22` (use for primary actions and focus, not decoration)
- Verified/live: `#69d9c8`
- Success/reward-ready: `#a4d46d`
- Error: `#ff6b6b`

## Typography
Use Manrope for UI and display; DM Mono for addresses, amounts, game telemetry and chain identifiers. Tabular numerals for balances. Prefer sentence case in product interfaces. Strong headings should be concise and left aligned; body copy should explain mode, consequence and next action.

## Layout
- One compact horizontal Center nav, responsive on small screens without clipping controls.
- Main surfaces use max-width and generous spacing; game catalog should be grouped by play style and explain player count, duration, skill loop, hint policy and reward mode.
- Creator wizard uses progressive disclosure: choose a game, configure that game's unique rules/hints, choose room visibility/economics, attach funded or preview reward, review a persistent summary, publish.
- Do not expose the full 19+ format list and every rules field as one overwhelming screen.
- Room Capsule updates as settings change and remains visible in review.

## Game-specific hint UX
Hints belong to each game's mechanics, not a universal “hint feed” toggle. Publish a typed per-game hint mode that avoids answer leakage: Number Hunt higher/lower (private or public attribution); Quiz category/elimination without answers; Memory Match bounded reveal; Token Catch lane/tempo cue; Reaction Duel progress only; Puzzle Sprint move suggestion; Hash Hunt difficulty/progress; Boss Raid phase cue; RPS commit/reveal progress; Reward Grid capped proximity; Bingo call history; Pattern Recall bounded replay; Typing accuracy/pace; Maze directional clue budget; Level Runner checkpoint; Contract Detective evidence clue; MEV Rush simulated sequence; Idle Rig efficiency; Airdrop Quest remaining-condition. Show hint cost/budget, audience (public/private), and remaining uses before play; show authoritative hints in a readable timeline during play.

## Financial truth and reward flows
Every room visibly distinguishes preview points from actual funded assets. Before join, state token/NFT, contract/address, entry fee, destination/payout split, possible refund path, reward amount, auto-push vs manual claim, and trust/settlement authority. Never silently convert assets or call a preview reward funded. Creator config must expose payout wallet, creator share, entry asset and amount, sponsored-fee setting, locked reward assets, payout mode and claim deadline. Require review/confirmation before signing transactions.

## Components and states
- Buttons: primary orange; secondary surface with border; tertiary text. 44px minimum touch target. Focus rings always visible.
- Forms: persistent labels, example placeholders, inline validation, paste-friendly inputs, dirty-draft recovery.
- Async UI: preserve button labels while showing progress; distinguish submitted/pending/finalized/failed/reverted. Explain next safe action.
- Empty: direct invitation to create/find a room. Error: clear cause and recovery action.
- Cards only when they communicate hierarchy; avoid 3 equal columns as the sole visual structure.

## Motion
Motion should communicate game identity, feedback, or state transition, never merely add spectacle. Use short transform/opacity transitions, stagger only for first reveal, satisfying win and transaction-confirmation moments, and per-game timing motifs. Respect `prefers-reduced-motion`; no continuous ambient loops behind dense interfaces.

## Responsive and accessibility
No horizontal overflow at 375px. Collapsed nav keeps all controls reachable. Keyboard-operable games require keyboard equivalents; pointer-only play needs accessible alternatives. Maintain WCAG AA contrast, semantic headings/labels, aria-live for async outcomes, visible focus, zoom support, safe areas and reduced motion.

## Do
- Name real consequences: “Join for 2 FREE”, “Winner claims 100 FREE”, “Preview points only”.
- Keep per-game mechanics distinct and explainable.
- Show provenance/status for on-chain balances and signed operations.
- Keep the interface calm outside the moment of competition.

## Avoid
- Generic game-grid-only product presentation.
- Treating all hints as the same reveal button.
- Hiding a fee, creator destination, or manual-claim step.
- Fake transaction states, fake liquidity, or unexplained claim codes.
- Unbounded scroll animations, decorative dots, neon glow, or arbitrary gradients.
