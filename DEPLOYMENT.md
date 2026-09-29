# Orbix Protocol — deployment record (all phases, 2026-09-28)

Chain: Robinhood Chain testnet, chainId 46630, RPC https://rpc.testnet.chain.robinhood.com
Wallet: foundry keystore 'vibes-test' (pw vibetest123), address 0x253db2d543b10c94918de97eb8499ee59ab9087e
Repo: ~/vibeswap (git committed). Dapp served on VPS port 8301.

## Contracts
- ORBIX (vibevibe launch): 0x0A7e1618582fbAd11c770670EF48048E236CC544, launchId 141266, curve 0xF7fb61d91c1F8c12f539981112565142477a5019, launch tx 0x5c6f87171a639fe3638961616f2af9a60fcd618fd9724d07369b2b608be49465
- WETH9: 0xf5CC840BD9529eaA67D2AbB8B13dF26cF7B4F1ac
- AMM Factory: 0x0229c777527CA7750b6b27b91e3F422BE70C8351
- AMM Router: 0x8979aE333d624b6fCf580D22ba1D0EF179aC0691
- FREE test token: 0x8527a10C2E7A35296253febf3B7647ac00c52edC
- ORBIX-ECO: 0xC3D3f769441e60F6e8A3D022fA8f55b0c8c432c3 (200M minted to treasury)
- MasterChef: 0xd79a78c40a36babf112502fa3dac78c308293f3d (pool 0 = FREE/WETH LP 0xea7d222013877c362ac78c3c80f4ee6910b5b711, 10 ECO/block)
- BridgeOut: 0x44e46ee9E3e900a018d1e2A6B969Af008720f4B2 (5,000,000 FREE locked live; relayer relayer/relayer.py)
- Orbix666 NFT: 0x2D11AD9d0388CbCA0A9E137F099C3fff97d1B29d — GPU salt 0x91c38445b1a3d68e6f8036cc55e84ec543fc5829680ba046634427acaa4160be, token #1 minted via PoW (nonce 15388), tier GPU(2), feeDiscountBps=2500 for holder
- OrbixMarket: 0xf3C365Cc13bdc55ed710ac60729895b2c368DC83 (list/cancel/buy flow tested end-to-end)
- OrbixLaunchpad: 0xbd3a9263bc366735a8678099123ea4e72a20878a (deploy tx 0xe1bcdff85e1791245047b1e5be5e8dc1cde51f2b18bd291299ee4605051123ec, creationFee 0.001 ETH, lock 7d, treasury = deployer)
  - FREE approved as collateral: tx 0xadfa9693759b8e225d69fc2b8b0c5f84c2ead92fca05d402e076039962540d33
  - Bytecode verified on-chain (forge verify-bytecode): creation + runtime FULL match vs src/OrbixLaunchpad.sol:OrbixLaunchpad
  - Live launch #1: OTT 0x2F2ED74d8288ab3C334752320e92c09b5F14790d, tx 0x8e1ff70d0dc734795e9154039ac44475dd6461aea9830f66c8476116493d5a0f, pair 0x55a0984bfaa9ec5658a4df528f69e118f52b8907 seeded 100k OTT / 1000 FREE, 900k to creator, LP held by pad (lockLiquidity=false)

## Web app (deployed + browser-verified 2026-09-29)
- URL: https://dozens-geographical-mountain-appearing.trycloudflare.com (cloudflared tunnel → local http.server :8302 serving web/dist; daemon processes 4dc0d8397492/909dc5fb6642 must stay alive)
- Build: web/ React+TS, `npm run build` clean (0 TS errors), UI wired to all contracts above via web/src/addresses.ts + abis.ts
- UI v2 (2026-09-29, user feedback round 1):
  - Smart router (web/src/smartRouter.ts): scans ALL factory pairs (launchpad pools included), finds best-rate path up to 3 hops via getAmountsOut — verified live: 1 ETH → OTT routed WETH→FREE→OTT (launchpad pool), 87029 OTT quoted
  - Token select: dark searchable modal with LAUNCH/LIQUID badges replaces native <select> (Swap from/to + Pools token); Bridge direction = styled buttons
  - Wallet modal: MetaMask/injected + WalletConnect v2 (@walletconnect/ethereum-provider, projectId 8e6b9213… REPLACE with own projectId before mainnet)
  - Overview: 4 image cards (swap/bridge/pools/launch, generated web/public/card-*.jpg) click into modules; Discover merged into it
- Tabs browser-verified live: Discover (all contract addresses + explorer links), Swap (5-token router quotes), Pools (add/remove LP, live FREE/WETH reserves 8337.50/0.0001), Bridge (RH ETH canonical inbox lane + xORBIX LayerZero OFT lane, live proofs shown), Launch (reads live launch count from nextLaunchId — showed 1), Staking (MasterChef), Orbix666, Marketplace
- Bridge live proofs: RH ETH 0xe08abf02…188587 (Sepolia→RH delivered), xORBIX OFT 0xc6194e4f…2fc08 (Sepolia→Arb Sepolia via LayerZero V2)
- Launchpad collateral getter is `collateralAllowed(address)` (NOT collateralEnabled) — returns true for FREE 0x8527a10C…52edC, confirmed on-chain 2026-09-29

## Gotchas (learned the hard way)
- vibevibe curve buy(uint256,uint256) reverts InvalidRecipient unless --from is the real EOA; deadline is UNIX seconds not block number
- curveAt(launchId) is offset by one: our launch event said id 141265 in one view, launchIdOfToken(token)=141266 is authoritative; ALWAYS resolve curve via launchIdOfToken before trading
- ORBIX transfers locked until bonding graduation (5 ETH raise); early liquidity for ORBIX itself impossible until then
- OZ ERC20 forbids mint to address(0) — pair burn-slot minted to address(1)

## Tests
forge test: 10/10 passing (factory determinism, liquidity add/remove, swaps incl ETH routes, slippage guard, fee math, chef pro-rata rewards, eco max supply)

## Remaining
- GitHub push (no auth available on VPS — needs user's gh auth)
- Pump ORBIX bonding curve to 5 ETH graduation (social/marketing)
- Human-tier click-hunt frontend page for Orbix666
- Cross-chain: LayerZero OFT for ORBIX/FREE — see CROSSCHAIN_PLAN.md (LZ live on RH mainnet EID 30416; Wormhole not deployed on RH; CCIP is RH's official partner)
