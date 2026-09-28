import type { Address } from 'viem'

// Central registry of deployed addresses (source: DEPLOYMENT.md).
// Every contract address used by the frontend must come from here — no hardcoded dupes.
export const CHAIN_ID = 46630
export const RPC_URL = 'https://rpc.testnet.chain.robinhood.com'
export const EXPLORER_URL = 'https://explorer.testnet.chain.robinhood.com'

export const ADDRESSES = {
  WETH: '0xf5CC840BD9529eaA67D2AbB8B13dF26cF7B4F1ac' as Address,
  FREE: '0x8527a10C2E7A35296253febf3B7647ac00c52edC' as Address,
  ROUTER: '0x8979aE333d624b6fCf580D22ba1D0EF179aC0691' as Address,
  FACTORY: '0x0229c777527CA7750b6b27b91e3F422BE70C8351' as Address,
  ECO: '0xC3D3f769441e60F6e8A3D022fA8f55b0c8c432c3' as Address,
  MASTER_CHEF: '0xd79a78c40a36babf112502fa3dac78c308293f3d' as Address,
  BRIDGE_OUT: '0x44e46ee9E3e900a018d1e2A6B969Af008720f4B2' as Address,
  ORBIX666: '0x2D11AD9d0388CbCA0A9E137F099C3fff97d1B29d' as Address,
  MARKET: '0xf3C365Cc13bdc55ed710ac60729895b2c368DC83' as Address,
  REGISTRY: '0xA421e17E8e5B99B4CC625418e4fEC00B4c48862d' as Address,
  FEE_DISCOUNT_MODULE: '0x947cCAf13315cbAfbe18e59124B9Db9A648A8a12' as Address,
} as const

// No deployed OrbixLaunchpad address is present in DEPLOYMENT.md; keep disabled rather than guessing.
export const LAUNCHPAD_ADDRESS: Address | undefined = undefined

export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`
}

export function explorerAddressUrl(address: string): string {
  return `${EXPLORER_URL}/address/${address}`
}
