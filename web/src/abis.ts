// Shared ABIs for all wired views (swap, pools, bridge, launch, staking, NFT, market).
export const ERC20_ABI = [
  { type:'function', name:'approve', stateMutability:'nonpayable', inputs:[{name:'spender',type:'address'},{name:'amount',type:'uint256'}], outputs:[{type:'bool'}] },
  { type:'function', name:'allowance', stateMutability:'view', inputs:[{name:'owner',type:'address'},{name:'spender',type:'address'}], outputs:[{type:'uint256'}] },
  { type:'function', name:'balanceOf', stateMutability:'view', inputs:[{name:'owner',type:'address'}], outputs:[{type:'uint256'}] },
  { type:'function', name:'symbol', stateMutability:'view', inputs:[], outputs:[{type:'string'}] },
  { type:'function', name:'decimals', stateMutability:'view', inputs:[], outputs:[{type:'uint8'}] },
  { type:'function', name:'totalSupply', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { type:'function', name:'transfer', stateMutability:'nonpayable', inputs:[{name:'to',type:'address'},{name:'amount',type:'uint256'}], outputs:[{type:'bool'}] },
] as const

export const PAIR_ABI = [
  { type:'function', name:'getReserves', stateMutability:'view', inputs:[], outputs:[{name:'r0',type:'uint112'},{name:'r1',type:'uint112'},{name:'ts',type:'uint32'}] },
  { type:'function', name:'token0', stateMutability:'view', inputs:[], outputs:[{type:'address'}] },
  { type:'function', name:'totalSupply', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { type:'function', name:'balanceOf', stateMutability:'view', inputs:[{name:'owner',type:'address'}], outputs:[{type:'uint256'}] },
] as const

export const FACTORY_ABI = [
  { type:'function', name:'getPair', stateMutability:'view', inputs:[{name:'a',type:'address'},{name:'b',type:'address'}], outputs:[{type:'address'}] },
  { type:'function', name:'allPairsLength', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { type:'function', name:'allPairs', stateMutability:'view', inputs:[{name:'i',type:'uint256'}], outputs:[{type:'address'}] },
] as const

export const ROUTER_ABI = [
  { type:'function', name:'getAmountsOut', stateMutability:'view', inputs:[{name:'amountIn',type:'uint256'},{name:'path',type:'address[]'}], outputs:[{type:'uint256[]'}] },
  { type:'function', name:'swapExactETHForTokens', stateMutability:'payable', inputs:[{name:'amountOutMin',type:'uint256'},{name:'path',type:'address[]'},{name:'to',type:'address'},{name:'deadline',type:'uint256'}], outputs:[{type:'uint256[]'}] },
  { type:'function', name:'swapExactTokensForETH', stateMutability:'nonpayable', inputs:[{name:'amountIn',type:'uint256'},{name:'amountOutMin',type:'uint256'},{name:'path',type:'address[]'},{name:'to',type:'address'},{name:'deadline',type:'uint256'}], outputs:[{type:'uint256[]'}] },
  { type:'function', name:'swapExactTokensForTokens', stateMutability:'nonpayable', inputs:[{name:'amountIn',type:'uint256'},{name:'amountOutMin',type:'uint256'},{name:'path',type:'address[]'},{name:'to',type:'address'},{name:'deadline',type:'uint256'}], outputs:[{type:'uint256[]'}] },
  { type:'function', name:'addLiquidityETH', stateMutability:'payable', inputs:[{name:'token',type:'address'},{name:'amountTokenDesired',type:'uint256'},{name:'amountTokenMin',type:'uint256'},{name:'amountETHMin',type:'uint256'},{name:'to',type:'address'},{name:'deadline',type:'uint256'}], outputs:[{type:'uint256'},{type:'uint256'},{type:'uint256'}] },
  { type:'function', name:'addLiquidity', stateMutability:'nonpayable', inputs:[{name:'tokenA',type:'address'},{name:'tokenB',type:'address'},{name:'amountADesired',type:'uint256'},{name:'amountBDesired',type:'uint256'},{name:'amountAMin',type:'uint256'},{name:'amountBMin',type:'uint256'},{name:'to',type:'address'},{name:'deadline',type:'uint256'}], outputs:[{type:'uint256'},{type:'uint256'},{type:'uint256'}] },
  { type:'function', name:'removeLiquidityETH', stateMutability:'nonpayable', inputs:[{name:'token',type:'address'},{name:'liquidity',type:'uint256'},{name:'amountTokenMin',type:'uint256'},{name:'amountETHMin',type:'uint256'},{name:'to',type:'address'},{name:'deadline',type:'uint256'}], outputs:[{type:'uint256'},{type:'uint256'}] },
  { type:'function', name:'removeLiquidity', stateMutability:'nonpayable', inputs:[{name:'tokenA',type:'address'},{name:'tokenB',type:'address'},{name:'liquidity',type:'uint256'},{name:'amountAMin',type:'uint256'},{name:'amountBMin',type:'uint256'},{name:'to',type:'address'},{name:'deadline',type:'uint256'}], outputs:[{type:'uint256'},{type:'uint256'}] },
  { type:'function', name:'quote', stateMutability:'view', inputs:[{name:'amountA',type:'uint256'},{name:'reserveA',type:'uint256'},{name:'reserveB',type:'uint256'}], outputs:[{type:'uint256'}] },
] as const

export const LAUNCHPAD_ABI = [
  { type:'function', name:'createLaunch', stateMutability:'payable', inputs:[{name:'name',type:'string'},{name:'symbol',type:'string'},{name:'supply',type:'uint256'},{name:'collateral',type:'address'},{name:'tokenSeed',type:'uint256'},{name:'collateralSeed',type:'uint256'},{name:'lockLiquidity',type:'bool'}], outputs:[{type:'address'},{type:'address'}] },
  { type:'function', name:'creationFee', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { type:'function', name:'collateralAllowed', stateMutability:'view', inputs:[{name:'token',type:'address'}], outputs:[{type:'bool'}] },
  { type:'function', name:'nextLaunchId', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { type:'function', name:'allLaunchTokens', stateMutability:'view', inputs:[{name:'i',type:'uint256'}], outputs:[{type:'address'}] },
  { type:'function', name:'tokenLaunchId', stateMutability:'view', inputs:[{name:'token',type:'address'}], outputs:[{type:'uint256'}] },
  { type:'function', name:'getLaunch', stateMutability:'view', inputs:[{name:'id',type:'uint256'}], outputs:[{type:'tuple',components:[{name:'creator',type:'address'},{name:'token',type:'address'},{name:'collateral',type:'address'},{name:'pair',type:'address'},{name:'tokenSupply',type:'uint256'},{name:'collateralSeed',type:'uint256'},{name:'tokenSeed',type:'uint256'},{name:'createdAt',type:'uint256'},{name:'active',type:'bool'},{name:'liquidityLocked',type:'bool'}]}] },
] as const

export const CHEF_ABI = [
  { type:'function', name:'poolLength', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { type:'function', name:'poolInfo', stateMutability:'view', inputs:[{name:'pid',type:'uint256'}], outputs:[{type:'tuple',components:[{name:'lpToken',type:'address'},{name:'allocPoint',type:'uint256'},{name:'lastRewardBlock',type:'uint256'},{name:'accEcoPerShare',type:'uint256'}]}] },
  { type:'function', name:'userInfo', stateMutability:'view', inputs:[{name:'pid',type:'uint256'},{name:'user',type:'address'}], outputs:[{type:'tuple',components:[{name:'amount',type:'uint256'},{name:'rewardDebt',type:'uint256'}]}] },
  { type:'function', name:'pendingEco', stateMutability:'view', inputs:[{name:'pid',type:'uint256'},{name:'user',type:'address'}], outputs:[{type:'uint256'}] },
  { type:'function', name:'deposit', stateMutability:'nonpayable', inputs:[{name:'pid',type:'uint256'},{name:'amount',type:'uint256'}], outputs:[] },
  { type:'function', name:'withdraw', stateMutability:'nonpayable', inputs:[{name:'pid',type:'uint256'},{name:'amount',type:'uint256'}], outputs:[] },
] as const

export const NFT_ABI = [
  { type:'function', name:'balanceOf', stateMutability:'view', inputs:[{name:'owner',type:'address'}], outputs:[{type:'uint256'}] },
  { type:'function', name:'tokenOfOwnerByIndex', stateMutability:'view', inputs:[{name:'owner',type:'address'},{name:'index',type:'uint256'}], outputs:[{type:'uint256'}] },
  { type:'function', name:'mintHuman', stateMutability:'nonpayable', inputs:[{name:'sig',type:'bytes'}], outputs:[] },
  { type:'function', name:'mintWithPow', stateMutability:'nonpayable', inputs:[{name:'nonce',type:'uint256'},{name:'salt',type:'bytes32'}], outputs:[] },
] as const

export const MARKET_ABI = [
  { type:'function', name:'listings', stateMutability:'view', inputs:[{name:'tokenId',type:'uint256'}], outputs:[{type:'tuple',components:[{name:'seller',type:'address'},{name:'price',type:'uint256'},{name:'active',type:'bool'}]}] },
  { type:'function', name:'list', stateMutability:'nonpayable', inputs:[{name:'tokenId',type:'uint256'},{name:'price',type:'uint256'}], outputs:[] },
  { type:'function', name:'cancel', stateMutability:'nonpayable', inputs:[{name:'tokenId',type:'uint256'}], outputs:[] },
  { type:'function', name:'buy', stateMutability:'payable', inputs:[{name:'tokenId',type:'uint256'}], outputs:[] },
] as const

// LayerZero V2 OFT
export const OFT_ABI = [
  { type:'function', name:'quoteSend', stateMutability:'view', inputs:[{name:'sendParam',type:'tuple',components:[{name:'dstEid',type:'uint32'},{name:'to',type:'bytes32'},{name:'amountLD',type:'uint256'},{name:'minAmountLD',type:'uint256'},{name:'extraOptions',type:'bytes'},{name:'composeMsg',type:'bytes'},{name:'oftCmd',type:'bytes'}]},{name:'payInLzToken',type:'bool'}], outputs:[{name:'msgFee',type:'tuple',components:[{name:'nativeFee',type:'uint256'},{name:'lzTokenFee',type:'uint256'}]}] },
  { type:'function', name:'send', stateMutability:'payable', inputs:[{name:'sendParam',type:'tuple',components:[{name:'dstEid',type:'uint32'},{name:'to',type:'bytes32'},{name:'amountLD',type:'uint256'},{name:'minAmountLD',type:'uint256'},{name:'extraOptions',type:'bytes'},{name:'composeMsg',type:'bytes'},{name:'oftCmd',type:'bytes'}]},{name:'msgFee',type:'tuple',components:[{name:'nativeFee',type:'uint256'},{name:'lzTokenFee',type:'uint256'}]},{name:'refundAddress',type:'address'}], outputs:[{type:'tuple',components:[{name:'guid',type:'bytes32'},{name:'nonce',type:'uint64'}]},{type:'tuple',components:[{name:'dstEid',type:'uint32'},{name:'from',type:'address'},{name:'guid',type:'bytes32'},{name:'nonce',type:'uint64'}]},{type:'tuple',components:[{name:'nativeFee',type:'uint256'},{name:'lzTokenFee',type:'uint256'}]}] },
  { type:'function', name:'balanceOf', stateMutability:'view', inputs:[{name:'owner',type:'address'}], outputs:[{type:'uint256'}] },
  { type:'function', name:'peer', stateMutability:'view', inputs:[{name:'eid',type:'uint32'}], outputs:[{type:'bytes32'}] },
] as const

// Arbitrum-style delayed inbox (Robinhood Chain testnet L1 deposit): depositEth()
export const RH_INBOX_ABI = [
  { type:'function', name:'depositEth', stateMutability:'payable', inputs:[], outputs:[{type:'uint256'}] },
] as const
