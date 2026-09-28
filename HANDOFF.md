# Orbix / vibevibe project — session handoff (grouped for new sessions)

This file is the single source of truth. Any new session: read this + ~/vibeswap/DEPLOYMENT.md and you're fully loaded.

## Status: ALL PHASES BUILT & DEPLOYED — live on Robinhood Chain testnet (46630)

## Contracts
- ORBIX (vibevibe launch): 0x0A7e1618582fbAd11c770670EF48048E236CC544, launchId 141266, curve 0xF7fb61d91c1F8c12f539981112565142477a5019
- WETH9: 0xf5CC840BD9529eaA67D2AbB8B13dF26cF7B4F1ac
- AMM Factory: 0x0229c777527CA7750b6b27b91e3F422BE70C8351 / Router: 0x8979aE333d624b6fCf580D22ba1D0EF179aC0691
- ORBIX-ECO: 0xC3D3f769441e60F6e8A3D022fA8f55b0c8c432c3 / MasterChef: 0xd79a78c40a36babf112502fa3dac78c308293f3d
- BridgeOut: 0x44e46ee9E3e900a018d1e2A6B969Af008720f4B2 (5M FREE locked)
- Orbix666 NFT: 0x2D11AD9d0388CbCA0A9E137F099C3fff97d1B29d (#1 minted via GPU PoW, 25% fee discount hook)
- Market: 0xf3C365Cc13bdc55ed710ac60729895b2c368DC83 / Registry: 0xA421e17E8e5B99B4CC625418e4fEC00B4c48862d
- FeeDiscountModule: 0x947cCAf13315cbAfbe18e59124B9Db9A648A8a12
- FREE token: 0x8527a10C2E7A35296253febf3B7647ac00c52edC

## Services
- Dapp (swap/stake/bridge): port 8301 (dapp/index.html), via cloudflared tunnel
- Hunt server (human-tier 666): port 8400 (hunt/hunt_server.py + hunt.html) — sig bug FIXED (abi.encodePacked addr = 20 bytes)
- Relayer: relayer/relayer.py

## Wallet
Foundry keystore 'vibes-test', password vibetest123, address 0x253db2d543b10c94918de97eb8499ee59ab9087e (~0.024 ETH, ~600M ORBIX, GGG/FREE balances)

## Critical gotchas
- vibevibe curve buy(uint256,uint256): --from must be real EOA (else InvalidRecipient); deadline = unix seconds
- Resolve curve via launchIdOfToken(token) — curveAt is offset by one
- ORBIX transfers locked until 5 ETH graduation

## Next steps (needs user)
1. GitHub auth → push ~/vibeswap
2. Post X thread (marketing/x-thread.md), tag @meta_alchemist
3. Buy ORBIX on curve → 5 ETH graduation
4. Then: marketplace listings, hunt public launch, frontend-toolbox skill for site redesigns

## User intent (verbatim log: USER_INSTRUCTIONS.md, 216 msgs from session 20260925_170813_ccb3be42)
- "Orbix is good, search the testnet launches, found the tokenomics of the tokens launched on vibevibe" → research, then "Yes, launch, and buy some ourselves little for testing and building and treasury little, not all"
- "Do all phases one by one, don't ask me input, all phases must be done continuously" (user was heading out — full autonomy granted)
- Launch → then full super-DeFi suite: AMM/swap → staking → bridge → NFT → marketplace (all delivered)
- Final order: "only group our vibevibe phase project into new session along with MCP and all details built and handoff md and deployment md"

## Tooling ready
- frontend-toolbox skill + MCPs (shadcn multi-registry, context7, playwright, iconify) — for building Orbix web presence. Playwright MCP needs `npx playwright install chrome` (done 2026-09-28). Dapp serves on :8301 (python3 -m http.server).
