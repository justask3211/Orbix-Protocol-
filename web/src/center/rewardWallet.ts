import { activeWalletProvider } from './walletConnectors.ts'
import { decodeEventLog, encodeFunctionData, parseAbi, type Address, type Hex } from 'viem'

export const REWARD_ENGINE: Address = '0x5b8d41421b9a6701cb7948e724234cb9b1eb8e1b'
export const rewardAbi = parseAbi([
  'function createPool(bytes32 roomId,uint8 mode,uint64 claimDeadline,uint32 maxOpenClaims,bytes32 merkleRoot,string message) returns (uint256)',
  'function depositERC20(uint256 poolId,address token,uint256 amount)',
  'function depositERC721(uint256 poolId,address token,uint256 tokenId)',
  'function depositERC1155(uint256 poolId,address token,uint256 tokenId,uint256 amount,bytes data)',
  'function depositETH(uint256 poolId) payable',
  'function setAllocation(uint256 poolId,address winner,uint256 assetIndex,uint256 subAmount)',
  'function claimByCode(uint256 poolId,uint256 allocIndex,uint256 nonce,bytes signature)',
  'function claimByMerkle(uint256 poolId,bytes32[] proof,address winner,uint256 assetIndex,uint256 subAmount)',
  'function claimOpen(uint256 poolId,uint256 allocIndex)',
  'event PoolCreated(uint256 indexed poolId,bytes32 indexed roomId,address indexed creator,uint8 claimMode,uint64 deadline,uint256 assetCount)',
])
const tokenAbi = parseAbi([
  'function allowance(address owner,address spender) view returns (uint256)',
  'function approve(address spender,uint256 amount) returns (bool)',
  'function getApproved(uint256 tokenId) view returns (address)',
  'function isApprovedForAll(address owner,address operator) view returns (bool)',
  'function setApprovalForAll(address operator,bool approved)',
])
export type Wallet = { request: (args: {method: string; params?: unknown[]}) => Promise<any> }
export type Receipt = {status: string; logs: {address: string; data: Hex; topics: [Hex, ...Hex[]]}[]}
export type RewardSlot = {rank: number; asset_kind: 'erc20'|'erc721'|'erc1155'|'eth'; asset_contract: Address; token_id: string; amount: string}
export type FundedConfig = {kind: 'funded-assets'; claim_mode: 'auto'|'code'|'merkle'|'open'; claim_deadline: number; merkle_winners: string[]; distribution?:'match'|'drop'; waitlist_source?:string; slots: RewardSlot[]}
export type Funding = {poolId: string; txHash: string}
export type RewardClaim = {claimId: string; roomId: string; poolId: string; engine: Address; chainId: number; winner: string; assetKind: string; assetContract: string; tokenId: string; amount: string; deadline: number; payable: boolean; claimed: boolean; reason?: string; function?: string; args?: unknown[]; code?: string}
export type RewardPlan = {poolId: string; engine: Address; mode: string; settled: boolean; allocationCount: number; allocations: {winner: string; assetIndex: number; amount: string; allocated?:boolean}[]}
const ZERO: Address = '0x0000000000000000000000000000000000000000'
const storage = () => typeof sessionStorage === 'undefined' ? undefined : sessionStorage
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function waitRewardReceipt(wallet: Wallet, hash: string, timeout = 180000, pause = delay): Promise<Receipt> {
  const started = Date.now()
  do {
    const receipt = await wallet.request({method: 'eth_getTransactionReceipt', params: [hash]})
    if (receipt) {
      if (receipt.status !== '0x1') throw Object.assign(new Error('Transaction failed on chain. No reward confirmation was recorded.'), {receiptFailed:true})
      return receipt
    }
    await pause(1500)
  } while (Date.now() - started < timeout)
  throw new Error(`Transaction is still pending. Retry to check its receipt (${hash}).`)
}
export async function rewardWallet(address: string, injected?: Wallet): Promise<Wallet> {
  const wallet = injected ?? activeWalletProvider() ?? (window as unknown as {ethereum?: Wallet}).ethereum
  if (!wallet) throw new Error('Connect a browser wallet to fund or claim rewards.')
  if (String(await wallet.request({method:'eth_chainId'})).toLowerCase() !== '0xb626') {
    try { await wallet.request({method:'wallet_switchEthereumChain', params:[{chainId:'0xb626'}]}) }
    catch (e) {
      if ((e as {code?: number}).code !== 4902) throw e
      await wallet.request({method:'wallet_addEthereumChain', params:[{chainId:'0xb626', chainName:'Robinhood Chain Testnet', nativeCurrency:{name:'Test ETH',symbol:'ETH',decimals:18},rpcUrls:['https://rpc.testnet.chain.robinhood.com'],blockExplorerUrls:['https://explorer.testnet.chain.robinhood.com']}]})
      await wallet.request({method:'wallet_switchEthereumChain', params:[{chainId:'0xb626'}]})
    }
  }
  if (String(await wallet.request({method:'eth_chainId'})).toLowerCase() !== '0xb626') throw new Error('Switch to Robinhood testnet (46630) first.')
  const accounts: string[] = await wallet.request({method:'eth_requestAccounts'})
  if (accounts[0]?.toLowerCase() !== address.toLowerCase()) throw new Error('Select the wallet you connected to Orbix before continuing.')
  return wallet
}
async function confirmed(wallet: Wallet, address: string, to: Address, data: Hex, progress: (s: string)=>void, key: string, value?: string) {
  const saved = storage()?.getItem(key)
  let hash = saved
  if (!hash) {
    // Simulate the exact call from the connected wallet before opening its tx prompt.
    await wallet.request({method:'eth_call',params:[{from:address,to,data,...(value?{value}:{})},'latest']})
    hash = await wallet.request({method:'eth_sendTransaction',params:[{from:address,to,data,...(value?{value}:{})}]}) as string
    storage()?.setItem(key, hash)
  }
  progress(`Transaction submitted. Waiting for confirmation: ${hash}`)
  let receipt: Receipt
  try { receipt = await waitRewardReceipt(wallet, hash) }
  catch (error) { if ((error as {receiptFailed?:boolean}).receiptFailed) storage()?.removeItem(key); throw error }
  storage()?.removeItem(key)
  return {hash,receipt}
}
export async function fundRewardPool(address: string, prepared: {roomId:string;roomKey:Hex;engine:Address;merkleRoot:Hex}, config: FundedConfig, progress: (s:string)=>void, injected?: Wallet): Promise<Funding> {
  if (prepared.engine.toLowerCase() !== REWARD_ENGINE) throw new Error('Unexpected reward contract. Refresh before funding.')
  const wallet = await rewardWallet(address, injected)
  const key = `orbix-reward-fund:${address.toLowerCase()}:${prepared.roomId}`
  let journal: {poolId?:string; deposited:number; txHash?:string} = JSON.parse(storage()?.getItem(key) ?? '{"deposited":0}')
  if (journal.poolId === undefined) {
    progress('Confirm pool creation in your wallet.')
    const {receipt} = await confirmed(wallet,address,REWARD_ENGINE,encodeFunctionData({abi:rewardAbi,functionName:'createPool',args:[prepared.roomKey,config.claim_mode==='merkle'?2:config.claim_mode==='open'?3:1,BigInt(config.claim_deadline),config.claim_mode==='open'?config.slots.length:0,prepared.merkleRoot,'Orbix room rewards']}),progress,`${key}:create`)
    const log = receipt.logs.find(log=> log.address.toLowerCase()===REWARD_ENGINE && (()=>{try{return decodeEventLog({abi:rewardAbi,...log}).eventName==='PoolCreated'}catch{return false}})())
    if (!log) throw new Error('Confirmed creation has no PoolCreated event. Check your transaction before retrying.')
    const decoded = decodeEventLog({abi:rewardAbi,...log})
    if (decoded.eventName !== 'PoolCreated') throw new Error('Pool creation could not be verified.')
    journal = {poolId:decoded.args.poolId.toString(),deposited:0}
    storage()?.setItem(key,JSON.stringify(journal))
  }
  const assets = new Map<string,RewardSlot>()
  for (const slot of config.slots) {
    const identity = `${slot.asset_kind}:${slot.asset_contract.toLowerCase()}:${slot.token_id}`
    const old = assets.get(identity)
    assets.set(identity,{...slot,amount:(BigInt(slot.amount)+BigInt(old?.amount??0)).toString()})
  }
  const grouped = [...assets.values()]
  for (let i=journal.deposited;i<grouped.length;i++) {
    const asset = grouped[i], poolId=BigInt(journal.poolId!)
    if (asset.asset_kind !== 'eth') {
      progress('Checking reward approval on chain.')
      let approved = false
      if (asset.asset_kind==='erc20') {
        const allowance = await wallet.request({method:'eth_call',params:[{to:asset.asset_contract,data:encodeFunctionData({abi:tokenAbi,functionName:'allowance',args:[address as Address,REWARD_ENGINE]})},'latest']})
        approved=BigInt(allowance)>=BigInt(asset.amount)
      } else {
        const all = await wallet.request({method:'eth_call',params:[{to:asset.asset_contract,data:encodeFunctionData({abi:tokenAbi,functionName:'isApprovedForAll',args:[address as Address,REWARD_ENGINE]})},'latest']})
        approved = BigInt(all)===1n
        if (!approved && asset.asset_kind==='erc721') {
          const owner = await wallet.request({method:'eth_call',params:[{to:asset.asset_contract,data:encodeFunctionData({abi:tokenAbi,functionName:'getApproved',args:[BigInt(asset.token_id)]})},'latest']})
          approved=String(owner).slice(-40).toLowerCase()===REWARD_ENGINE.slice(2)
        }
      }
      if (!approved) {
        progress('Confirm reward approval in your wallet.')
        const data=asset.asset_kind==='erc1155'?encodeFunctionData({abi:tokenAbi,functionName:'setApprovalForAll',args:[REWARD_ENGINE,true]}):encodeFunctionData({abi:tokenAbi,functionName:'approve',args:[REWARD_ENGINE,BigInt(asset.asset_kind==='erc721'?asset.token_id:asset.amount)]})
        await confirmed(wallet,address,asset.asset_contract,data,progress,`${key}:approve:${i}`)
      }
    }
    progress('Confirm reward deposit in your wallet.')
    const data=asset.asset_kind==='eth'?encodeFunctionData({abi:rewardAbi,functionName:'depositETH',args:[poolId]}):asset.asset_kind==='erc20'?encodeFunctionData({abi:rewardAbi,functionName:'depositERC20',args:[poolId,asset.asset_contract,BigInt(asset.amount)]}):asset.asset_kind==='erc721'?encodeFunctionData({abi:rewardAbi,functionName:'depositERC721',args:[poolId,asset.asset_contract,BigInt(asset.token_id)]}):encodeFunctionData({abi:rewardAbi,functionName:'depositERC1155',args:[poolId,asset.asset_contract,BigInt(asset.token_id),BigInt(asset.amount),'0x']})
    const {hash}=await confirmed(wallet,address,REWARD_ENGINE,data,progress,`${key}:deposit:${i}`,asset.asset_kind==='eth'?`0x${BigInt(asset.amount).toString(16)}`:undefined)
    journal={...journal,deposited:i+1,txHash:hash}
    storage()?.setItem(key,JSON.stringify(journal))
  }
  return {poolId:journal.poolId!,txHash:journal.txHash!}
}
export async function allocateRewardPlan(address:string,plan:RewardPlan,progress:(s:string)=>void,injected?:Wallet) {
  if (plan.engine.toLowerCase()!==REWARD_ENGINE || !plan.settled) throw new Error('Wait for confirmed server results before allocating prizes.')
  if (plan.mode==='merkle') return
  const wallet=await rewardWallet(address,injected)
  for (let i=0;i<plan.allocations.length;i++) {
    const a=plan.allocations[i]
    if (a.allocated ?? i<plan.allocationCount) continue
    await confirmed(wallet,address,REWARD_ENGINE,encodeFunctionData({abi:rewardAbi,functionName:'setAllocation',args:[BigInt(plan.poolId),plan.mode==='open'?ZERO:a.winner as Address,BigInt(a.assetIndex),BigInt(a.amount)]}),progress,`orbix-reward-allocation:${address}:${plan.poolId}:${i}`)
  }
}
export async function claimReward(address:string,claim:RewardClaim,progress:(s:string)=>void,injected?:Wallet) {
  if (!claim.payable || claim.claimed || claim.deadline<=Date.now()/1000) throw new Error(claim.reason??'This reward is not currently claimable.')
  if (claim.winner.toLowerCase()!==address.toLowerCase() || claim.engine.toLowerCase()!==REWARD_ENGINE || claim.chainId!==46630) throw new Error('Reward wallet, chain or contract does not match.')
  if (!claim.args || !['claimByCode','claimByMerkle','claimOpen'].includes(claim.function??'')) throw new Error('No verified reward call is available.')
  const wallet=await rewardWallet(address,injected)
  const data=encodeFunctionData({abi:rewardAbi,functionName:claim.function as 'claimByCode',args:claim.args.map((arg,index)=>index===0||claim.function==='claimByCode'&&[1,2].includes(index)||claim.function==='claimOpen'&&index===1||claim.function==='claimByMerkle'&&[3,4].includes(index)?BigInt(arg as string):arg) as [bigint,bigint,bigint,Hex]})
  return confirmed(wallet,address,REWARD_ENGINE,data,progress,`orbix-reward-claim:${address}:${claim.claimId}`)
}
