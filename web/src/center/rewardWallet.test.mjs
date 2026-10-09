import test from 'node:test'
import assert from 'node:assert/strict'
import { toFunctionSelector, encodeAbiParameters, encodeEventTopics, decodeFunctionData, parseAbi } from 'viem'
import { fundRewardPool, claimReward, allocateRewardPlan, waitRewardReceipt, rewardWallet, rewardAbi, REWARD_ENGINE } from './rewardWallet.ts'

const account='0x'+'ab'.repeat(20), token='0x'+'cd'.repeat(20), hash='0x'+'12'.repeat(32)
const prepared={roomId:'room',roomKey:'0x'+'34'.repeat(32),engine:REWARD_ENGINE,merkleRoot:'0x'+'00'.repeat(32)}
const tokenAbi=parseAbi(['function approve(address spender,uint256 amount) returns (bool)','function setApprovalForAll(address operator,bool approved)'])
function mock({allowance=0n,rejected=false,failed=false}={}) {
  const journal=new Map();globalThis.sessionStorage={getItem:k=>journal.get(k)??null,setItem:(k,v)=>journal.set(k,v),removeItem:k=>journal.delete(k)}
  const calls=[];let latest='',chain='0xb626'
  const wallet={request:async ({method,params})=>{
    calls.push({method,params})
    if(method==='eth_chainId')return chain
    if(method==='wallet_switchEthereumChain'){chain=params[0].chainId;return null}
    if(method==='eth_requestAccounts')return [account]
    if(method==='eth_call') {
      if(params[0].data===toFunctionSelector('safetyVersion()'))return '0x2'
      if(params[0].data.startsWith('0xdd62ed3e'))return '0x'+allowance.toString(16)
      if(params[0].data.startsWith('0xe985e9c5')||params[0].data.startsWith('0x081812fc'))return '0x0'
      return '0x'
    }
    if(method==='eth_sendTransaction'){
      if(rejected)throw {code:4001,message:'User rejected'}
      try{latest=decodeFunctionData({abi:rewardAbi,data:params[0].data}).functionName}catch{latest=decodeFunctionData({abi:tokenAbi,data:params[0].data}).functionName}
      return hash
    }
    if(method==='eth_getTransactionReceipt')return {status:failed?'0x0':'0x1',logs:latest==='createPool'?[{address:REWARD_ENGINE,topics:encodeEventTopics({abi:rewardAbi,eventName:'PoolCreated',args:{poolId:7n,roomId:prepared.roomKey,creator:account}}),data:encodeAbiParameters([{type:'uint8'},{type:'uint64'},{type:'uint256'}],[1,BigInt(Math.floor(Date.now()/1000)+86400),0n])}]:[]}
    throw new Error(method)
  }}
  globalThis.window={ethereum:wallet}
  return {wallet,calls,journal}
}
const config=(kind='erc20',mode='auto')=>({kind:'funded-assets',claim_mode:mode,claim_deadline:Math.floor(Date.now()/1000)+86400,merkle_winners:[],slots:[{rank:1,asset_kind:kind,asset_contract:kind==='eth'?'0x'+'00'.repeat(20):token,token_id:'8',amount:kind==='erc721'?'1':'100'}]})
const sends=calls=>calls.filter(c=>c.method==='eth_sendTransaction').map(c=>{try{return decodeFunctionData({abi:rewardAbi,data:c.params[0].data}).functionName}catch{return decodeFunctionData({abi:tokenAbi,data:c.params[0].data}).functionName}})

test('ERC20 funding creates pool, approves only when needed, confirms every receipt and resumes',async()=>{
  const {calls}=mock();const progress=[]
  assert.deepEqual(await fundRewardPool(account,prepared,config(),s=>progress.push(s)),{poolId:'7',txHash:hash})
  assert.deepEqual(sends(calls),['createPool','approve','depositERC20'])
  for(const sent of calls.filter(c=>c.method==='eth_sendTransaction'))assert.equal(calls[calls.indexOf(sent)+1].method,'eth_getTransactionReceipt')
  await fundRewardPool(account,prepared,config(),()=>{})
  assert.equal(sends(calls).length,3)
  assert(progress.some(s=>s.includes('Waiting for confirmation')))
})
test('sufficient allowance skips approval',async()=>{
  const {calls}=mock({allowance:100n});await fundRewardPool(account,prepared,config(),()=>{})
  assert.deepEqual(sends(calls),['createPool','depositERC20'])
})
test('ETH funding includes the exact native value and no approval',async()=>{
  const {calls}=mock();await fundRewardPool(account,prepared,config('eth'),()=>{})
  assert.deepEqual(sends(calls),['createPool','depositETH'])
  assert.equal(calls.filter(c=>c.method==='eth_sendTransaction')[1].params[0].value,'0x64')
})
for(const kind of ['erc721','erc1155'])test(`${kind} uses deployed NFT approval and deposit functions`,async()=>{
 const {calls}=mock();await fundRewardPool(account,prepared,config(kind),()=>{})
 assert.deepEqual(sends(calls),['createPool',kind==='erc721'?'approve':'setApprovalForAll',kind==='erc721'?'depositERC721':'depositERC1155'])
})
test('rejection or failed receipt never reaches a deposit',async()=>{
 for(const option of [{rejected:true},{failed:true}]){
  const {calls}=mock(option);await assert.rejects(fundRewardPool(account,prepared,config(),()=>{}))
  assert(!sends(calls).includes('depositERC20'))
 }
})
test('receipt polling waits and rejects unconfirmed or failed transactions',async()=>{
 let reads=0
 const wallet={request:async()=>++reads<3?null:{status:'0x1',logs:[]}}
 assert.equal((await waitRewardReceipt(wallet,hash,100,async()=>{})).status,'0x1');assert.equal(reads,3)
 await assert.rejects(waitRewardReceipt({request:async()=>null},hash,0,async()=>{}),/pending/i)
 await assert.rejects(waitRewardReceipt({request:async()=>({status:'0x0'})},hash,100,async()=>{}),/failed/i)
})
test('wallet mismatch aborts before any transaction',async()=>{
 const {calls}=mock();await assert.rejects(rewardWallet(token),/Select the wallet/);assert.deepEqual(sends(calls),[])
})
for(const mode of ['claimByCode','claimByMerkle','claimOpen'])test(`${mode} sends the exact deployed claim and waits for its receipt`,async()=>{
 const {calls}=mock();const args=mode==='claimByCode'?['7',0,1,'0x'+'11'.repeat(65)]:mode==='claimByMerkle'?['7',[],account,0,'100']:['7',0]
 const claim={claimId:mode,poolId:'7',winner:account,engine:REWARD_ENGINE,chainId:46630,payable:true,claimed:false,deadline:Date.now()/1000+86400,function:mode,args}
 await claimReward(account,claim,()=>{});assert.deepEqual(sends(calls),[mode]);assert.equal(calls.at(-1).method,'eth_getTransactionReceipt')
})
test('creator allocation uses result plan and resumes at on-chain count',async()=>{
 const {calls}=mock();const plan={poolId:'7',engine:REWARD_ENGINE,settled:true,mode:'code',allocationCount:1,allocations:[{winner:account,assetIndex:0,amount:'50'},{winner:token,assetIndex:0,amount:'50'}]}
 await allocateRewardPlan(account,plan,()=>{});assert.deepEqual(sends(calls),['setAllocation'])
 const tx=calls.find(c=>c.method==='eth_sendTransaction');assert.equal(decodeFunctionData({abi:rewardAbi,data:tx.params[0].data}).args[1].toLowerCase(),token)
})

test('failed creation receipt can be retried instead of remaining stuck in the journal',async()=>{
 const {wallet,calls}=mock({failed:true});await assert.rejects(fundRewardPool(account,prepared,config(),()=>{}),/failed/)
 const request=wallet.request
 wallet.request=async a=>a.method==='eth_getTransactionReceipt'?{status:'0x1',logs:[{address:REWARD_ENGINE,topics:encodeEventTopics({abi:rewardAbi,eventName:'PoolCreated',args:{poolId:7n,roomId:prepared.roomKey,creator:account}}),data:encodeAbiParameters([{type:'uint8'},{type:'uint64'},{type:'uint256'}],[1,BigInt(Math.floor(Date.now()/1000)+86400),0n])}]}:request(a)
 await fundRewardPool(account,prepared,config(),()=>{})
 assert.equal(sends(calls).filter(n=>n==='createPool').length,2)
})
test('wallet network addition and subsequent verification happen before transactions',async()=>{
 const {wallet,calls}=mock();const request=wallet.request;let chain='0x1',added=false
 wallet.request=async a=>{
  if(a.method==='eth_chainId')return chain
  if(a.method==='wallet_switchEthereumChain'){if(!added)throw {code:4902};chain='0xb626';return null}
  if(a.method==='wallet_addEthereumChain'){added=true;return null}
  return request(a)
 }
 await rewardWallet(account,wallet);assert.equal(chain,'0xb626');assert(added);assert.deepEqual(sends(calls),[])
})
test('friendly selectors never reveal revert payloads',async()=>{
 const {explainError}=await import('./api.ts')
 for(const [error,pattern] of [[{code:4001},/rejected/i],[new Error('execution reverted 0xdb89e3f4'),/curve graduates/i],[{data:'0xfb8f41b2'},/allowance/i],[new Error('execution reverted 0x646cf558'),/already claimed/i],[new Error('execution reverted 0xdeadbeef'),/contract rejected/i]]){
  const message=explainError(error);assert.match(message,pattern);assert(!/0x[a-f0-9]{8}/i.test(message))
 }
})

test('multiple ERC721 IDs lock into one pool with per-ID approvals and deposits',async()=>{
 const {calls}=mock(),cfg=config('erc721')
 cfg.slots.push({...cfg.slots[0],rank:2,token_id:'99'})
 await fundRewardPool(account,prepared,cfg,()=>{})
 assert.deepEqual(sends(calls),['createPool','approve','depositERC721','approve','depositERC721'])
 const deposits=calls.filter(c=>c.method==='eth_sendTransaction').map(c=>{try{return decodeFunctionData({abi:rewardAbi,data:c.params[0].data})}catch{return null}}).filter(c=>c?.functionName==='depositERC721')
 assert.deepEqual(deposits.map(d=>[d.args[0],d.args[1].toLowerCase(),d.args[2]]),[[7n,token,8n],[7n,token,99n]])
 assert(!sends(calls).includes('setApprovalForAll'))
})


test('unsafe legacy engine is rejected before pool creation, approval or deposit',async()=>{
 const {wallet,calls}=mock(),request=wallet.request
 wallet.request=async args=>args.method==='eth_call'&&args.params[0].data===toFunctionSelector('safetyVersion()')?'0x':request(args)
 await assert.rejects(fundRewardPool(account,prepared,config(),()=>{},wallet),/pool-isolation/)
 assert.equal(sends(calls).length,0)
})

test('engine-scoped journal resumes this engine and refuses ambiguous legacy attempts',async()=>{
 const {calls,journal}=mock()
 journal.set(`orbix-reward-fund:${account}:${prepared.roomId}`,JSON.stringify({poolId:'9',deposited:1,txHash:hash}))
 await assert.rejects(fundRewardPool(account,prepared,config(),()=>{}),/earlier engine configuration/)
 assert.equal(sends(calls).length,0)
 journal.clear()
 await fundRewardPool(account,prepared,config(),()=>{})
 assert(journal.has(`orbix-reward-fund:${account}:46630:${REWARD_ENGINE}:${prepared.roomId}`))
 await fundRewardPool(account,prepared,config(),()=>{})
 assert.equal(sends(calls).filter(n=>n==='createPool').length,1)
})

test('ERC20 exact aggregate approval still serves multiple winners',async()=>{
 const {calls}=mock(),cfg=config('erc20','open')
 cfg.slots.push({...cfg.slots[0],rank:2,amount:'250'})
 await fundRewardPool(account,prepared,cfg,()=>{})
 const approval=calls.find(c=>c.method==='eth_sendTransaction'&&c.params[0].data.startsWith('0x095ea7b3'))
 assert.equal(decodeFunctionData({abi:tokenAbi,data:approval.params[0].data}).args[1],350n)
 assert.deepEqual(sends(calls),['createPool','approve','depositERC20'])
})
