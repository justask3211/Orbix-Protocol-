# USER DEVELOPMENT INTENT — Orbix Protocol

This file records the user's (GRINCH's) direction, verbatim prompts, and what each
one produced. It is the human-side counterpart to the technical ledgers
(ORBIX_PROTOCOL_V6_DELIVERY.md, ORBIX_CENTER_V5_EXECUTION.md,
ORBIX_CENTER_A_TO_Z_PLAN.md).

## Core intent (standing)

Orbix is a connected Robinhood-testnet (chain 46630) DeFi ecosystem. Orbix Center
is a CREATOR PLATFORM — distinct games with real hint mechanics, clear room
economics, transparent wallet transactions, and properly funded, auditable reward
flows. Visual polish supports flows but never masks unimplemented settlement or
incomplete custody. Target: "make it 200x better than now", continuously.
Contract/mechanism work carries 2x the priority of UI work.

## Prompt log (condensed, in order)

1. Design + audit pass (Vercel guidelines, tasteskill.dev install, evidence-led):
   mobile wallet overflow at 390px fixed; truthful reward-mode copy; skip link +
   focus styles; game-specific hint policies in the wizard; plan recorded in V5
   execution plan + design audit. -> Delivered, deployed (ff26c75f).

2. "Continue toward the goal" (repeated, autonomous):
   - CenterGamePot v2: signed settlement, replay-protected manual claims,
     fee-on-transfer-true refunds, auto/manual payout split (E8/E9).
   - E3 conservation invariants (Foundry): custody >= liabilities, sweep-guard,
     exact splits, no double payout.
   - E13 adversarial suite: reentrant NFT receiver blocked; skimming reward
     reverts; fee-on-transfer entry books actual amount.
   - D4-D22 hint ladder: ALL 19 game formats now have typed, versioned,
     server-safe, budgeted, non-leaking hint feeds with regression guards
     (number-hunt higher/lower; quiz elimination; memory bounded pair reveal;
     token-catch fallen-only window — fixed a REAL future-spawn leak; duels
     commit/reveal invariants; hash-hunt verified throughput; boss raid shared
     phase; puzzle legal-move + penalty; grid proximity bands; bingo call
     history; recall bounded replay; typing private pace cue; maze directional
     budget; detective evidence clue; mev simulated queue; idle server-clock
     efficiency; airdrop wallet-bound remaining requirements).
   - P1 token identity layer: on-chain name/symbol/decimals/burn-bytecode probes,
     conservative entry_ok verdict, GET /token/{address}.
   - E5: tamper-evident admin audit hash chain + verify endpoint.
   - F2: transaction state machine (unsigned->...->finalized, reorg handling,
     admission gating at 3 confirmations, idempotent receipts).
   - F4: attacker-model suite (server-ticket identity, inert payload
     score/winner fields, engine-only entitlements).
   - F5: pre-sign join disclosure (entry cost, reward truth, payout authority,
     refunds, claim deadline, network warning).
   - C4: live route audit at 1440/390 - zero overflow, zero console errors.

3. "Auto compact everything": memory consolidated.

4. "How to connect to GitHub / what token": guided fine-grained PAT creation.

5. "Here the token ... create a repo named orbix protocol push all our works ...":
   -> This repository. Token was scoped to justask3211/Tech only, so that repo
   is the target.

## Honesty rules the user demanded

- Never claim an unintegrated contract path as live.
- Deployment success is not feature success - verify in a real browser.
- Preview points and funded assets must be unmistakably distinct everywhere.
- Mainnet stays out of scope.
