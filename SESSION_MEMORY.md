# SESSION MEMORY — Orbix Protocol (updated 2026-10-02)

## What is deployed LIVE (orbixcore.fun)

- Center: 19-format catalog, truthful reward banner, skip link, mobile-fixed header
- F5 pre-sign join disclosure ("Before you join - read the room terms")
- Hint wizard controls: number-hunt (higher/lower + visibility), live-quiz
  (eliminations per question), memory-match (reveals per player),
  puzzle-sprint (hints per player + move penalty)
- Live deploy: Railway service orbixcore (8fa652eb), deployment ef0fc11a SUCCESS
- Verified: bundle contains all new strings; 0 console errors; 390px no overflow

## Not yet live (code-complete, tested)

- Python API: token identity endpoint (GET /token/{address}), F2 tx-state
  module, E5 audit hash chain + verify endpoint -> deploy with the
  orbix-center backend service's next sync
- CenterGamePot v2 contract: signed settlement, nonce-protected claims,
  fee-true refunds, auto/manual split - deployed to LOCAL/fork test only,
  NOT yet on chain 46630 (funded gate: ORBIX curve-locked pre-graduation)

## Test baseline (all green)

- Foundry: 82/82 (CenterGamePot unit 7 + invariants 4 + adversarial 3 + 68 rest)
- Python: 231/231 (center/.venv, PYTHONPATH=~/vibeswap, pytest center/tests)
- Frontend: tsc clean, vite build clean

## Key architecture facts

- Settlement authority signs payloads; contracts verify (authority = backend key)
- tokenCommitted guards sweep: treasury can never touch pots/rewards
- Identity: WS who comes from server tickets; clients never nominate winners
- Admission gating: only FINALIZED (3-conf) receipts admit an entry (F2)
- Audit chain: SHA-256 prev_hash chain on admin_audit; verify endpoint detects
  any history edit or deletion
- Hint policies: center/games/hints.py registry, versioned, implemented flags;
  regression test asserts all 19 stay implemented

## Environments / access

- Railway: session credential at ~/.railway/sessions/; CLI via
  npx railway@latest (5.63.1) - project orbixcore e4e3ab3b-...
  services: orbixcore (site, 8fa652eb), orbix-center, orbix-arcade, orbix-hunt-backend
- Deploy recipe: bash deploy/site/build-site.sh && railway up --detach
  --service 8fa652eb-... from ~/vibeswap (repo root; Dockerfile path is
  deploy/site/Dockerfile relative to archive root)
- GitHub: token in ~/.orbix_github_env (GITHUB_TOKEN), scoped to
  justask3211/Tech only; repo of record: github.com/justask3211/Tech
  (could NOT create orbix-protocol: fine-grained token lacks repo-creation)
- RPC: rpc.testnet.chain.robinhood.com 403s plain curl - use browser UA

## Next up (priority)

1. Deploy orbix-center backend service (Python API endpoints live)
2. E14: on-chain E2E on 46630 once ORBIX graduates (funded gate opens)
3. F1: API/DB schema alignment with Solidity events; F3 durable event indexer
4. C4 remaining: per-route empty/loading/error states, keyboard pass, 768px
5. E5 remainder: Safe/timelock for registry governance (H-01)

## Honest gaps (never claim these done)

- Funded value flows unproven on-chain end-to-end
- No mainnet anywhere, by design
- 4 V4-documented templates absent from 19-format catalog (D1)
- G21-G24 chance/prediction games legally gated, demo-only
