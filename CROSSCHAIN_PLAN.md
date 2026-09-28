# Orbix × Robinhood Chain — Cross-Chain Plan (drafted 2026-09-29)

Goal: move ORBIX / FREE / launchpad assets between Robinhood Chain (4663 main / 46630 test)
and other chains, using existing bridge protocols rather than our custom BridgeOut where possible.

## Verified network facts (checked 2026-09-29)
- Robinhood Chain = Arbitrum Orbit (Nitro) L2, settles to Ethereum, ETH gas.
  - Mainnet: chainId 4663, RPC https://rpc.mainnet.chain.robinhood.com
  - Testnet: chainId 46630, RPC https://rpc.testnet.chain.robinhood.com
  - Canonical bridge contracts (docs.robinhood.com/chain/protocol-contracts/):
    - Testnet L1 Bridge 0x96295BDad104eaD97cC08797b3dC68efF59CcF30, Outbox 0x8D180Caf588f3Da027BEf1F42a106Da93F90b166,
      L1 Gateway Router 0xF6F11aAEE80875776C264d93B37B34cE437382D1
- Chainlink CCIP is the official cross-chain oracle on mainnet (live at launch, 2026-07-01).
- 0x Cross-Chain API supports Robinhood Chain from launch (RFQ + swaps for the Robinhood Wallet).

## LayerZero V2 — VERIFIED LIVE on Robinhood mainnet
Per docs.layerzero.network/v2/deployments/chains/robinhood (rendered in browser):
- Chain ID 4663, Endpoint ID (EID) 30416
- EndpointV2:        0x6F475642a6e85809B1c36Fa62763669b1b48DD5B
- SendUln302:        0xC39161c743D0307EB9BCc9FEF03eeb9Dc4802de7
- ReceiveUln302:     0xe1844c5D63a9543023008D332Bd3d2e6f1FE1043
- Executor:          0x4208D6E27538189bB48E603D6123A94b8Abe0A0b
- DVNs incl. LayerZero Labs, Nethermind, P2P, Luganodes, BitGo.
- NO LayerZero testnet deployment for Robinhood (testnet endpoints list has no Robinhood entry).
- OFT records on the chain: 0 (we would be first-mover).

## Wormhole — NOT deployed on Robinhood (mainnet or testnet)
- Not in supported-networks table, not in chain-ids table (docs checked 2026-09-29).
- BUT: Wormhole NTT + Executor model is deploy-friendly:
  - Core Wormhole (Guardian-set) contract can be deployed by anyone on a new EVM chain
    (custom-chain integration), then Guardians observe it.
  - NTT managers can be deployed on any EVM chain (ntt add-chain); relaying via our own
    relayer-engine or Wormhole Executor providers.
  - Executor framework: permissionless quote-based relaying marketplace.
- Verdict: Wormhole on Robinhood = custom chain onboarding + own relayer infra. Heavier lift
  than LayerZero, which is already live.

## Recommendation
Use LayerZero V2 OFT (Omnichain Fungible Token) for ORBIX/FREE:
1. Test path on two chains we control today: deploy OFT on Sepolia + Arbitrum Sepolia,
   wire peers, send tokens both ways. (LayerZero testnets are supported on those chains.)
2. Port to Robinhood MAINNET (4663, EID 30416) — LayerZero is live there, fees ~nothing on an Orbit chain.
3. Keep our custom BridgeOut for FREE test-token games; ORBIX goes omnichain via OFT.
4. Watch Chainlink CCIP: it's Robinhood's official partner; long-term, a CCIP lane for
   Stock Tokens ↔ ORBIX swaps is the institutional path.
5. Wormhole NTT: park until LayerZero lane is live; revisit if we want Solana reach
   (Wormhole NTT reaches Solana; LayerZero OFT also supports Solana — compare then).

## Subchain idea (user's "subchain")
Our own Orbit rollup would inherit Arbitrum's native bridge; LayerZero endpoint can be
deployed there the same way (EVM chain onboarding). Non-blocking; revisit after mainnet lane works.

## Launchpad cross-chain angle
- OrbixLaunchpad (0xbd3a…878a) works with any allowed ERC20 collateral. An OFT-wrapped
  collateral token (e.g. USDC-OFT) could let other-chain users seed Robinhood launches.
- Next concrete step: deploy OFT version of FREE and register as launchpad collateral.
