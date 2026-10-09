import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeFunctionData, encodeAbiParameters, keccak256, encodePacked, toFunctionSelector } from 'viem'
import { GATE_ABI,GATE_ADDRESS,LEGACY_GATE,bindRoomOnChain,payJoinToken,quotedJoinDigest,roomIdToBytes32 } from './gate.ts'

const room='0123456789abcdef',wallet='0x'+'11'.repeat(20),token='0x'+'22'.repeat(20)
const zero='0x'+'00'.repeat(20)
const auth={gate:GATE_ADDRESS,chainId:46630,creator:wallet,roomKey:roomIdToBytes32(room),deadline:Math.floor(Date.now()/1000)+1800,signature:'0x'+'01'.repeat(65)}
function mock({version=3,joined=false,bound=false}={}) {
 const calls=[]
 globalThis.window={ethereum:{request:async args=>{
  calls.push(args)
  if(args.method==='eth_chainId')return '0xb626'
  if(args.method==='eth_requestAccounts')return [wallet]
  if(args.method==='eth_call'){
   const selector=args.params[0].data.slice(0,10)
   if(selector===toFunctionSelector('safetyVersion()')){if(version===null)throw new Error('unsupported');return '0x'+version.toString(16)}
   if(selector===toFunctionSelector('symbol()'))return encodeAbiParameters([{type:'string'}],['T'])
   if(selector===toFunctionSelector('decimals()'))return encodeAbiParameters([{type:'uint8'}],[0])
   if(selector===toFunctionSelector('balanceOf(address)'))return encodeAbiParameters([{type:'uint256'}],[100n])
   if(selector===toFunctionSelector('bindingOf(bytes32)'))return encodeAbiParameters([{type:'address'},{type:'address'},{type:'uint256'},{type:'address'},{type:'uint8'},{type:'bool'}],[bound?wallet:zero,token,7n,wallet,0,false])
   if(selector===toFunctionSelector('hasJoined(bytes32,address)'))return encodeAbiParameters([{type:'bool'}],[joined])
   return '0x'
  }
  if(args.method==='eth_sendTransaction')return '0x'+'01'.repeat(32)
  if(args.method==='eth_getTransactionReceipt')return {status:'0x1',blockNumber:'0x10'}
  if(args.method==='eth_blockNumber')return '0x12'
  throw new Error(args.method)
 }}}
 return calls
}
test('creator binding is one consent transaction and never approves creator tokens',async()=>{
 const calls=mock()
 await bindRoomOnChain(room,token,7,'creator',undefined,wallet,()=>{},auth)
 const sends=calls.filter(c=>c.method==='eth_sendTransaction')
 assert.equal(sends.length,1)
 const call=decodeFunctionData({abi:GATE_ABI,data:sends[0].params[0].data})
 assert.equal(call.functionName,'bindRoomAuthorized')
 assert.deepEqual(call.args,[roomIdToBytes32(room),token,7n,0,wallet,BigInt(auth.deadline),auth.signature])
})
test('retry after confirmed matching binding sends no transaction',async()=>{
 const calls=mock({bound:true})
 await bindRoomOnChain(room,token,7,'creator',undefined,wallet,()=>{},auth)
 assert.equal(calls.filter(c=>c.method==='eth_sendTransaction').length,0)
})
test('unsupported gate and mismatched ownership proof fail before approvals or binding',async()=>{
 for(const version of [2,null]){
  const calls=mock({version})
  await assert.rejects(bindRoomOnChain(room,token,7,'creator',undefined,wallet,()=>{},auth),/hardened gate/)
  assert.equal(calls.filter(c=>c.method==='eth_sendTransaction').length,0)
 }
 const calls=mock()
 await assert.rejects(bindRoomOnChain(room,token,7,'creator',undefined,wallet,()=>{},{...auth,creator:token}),/authorization differs/)
 assert.equal(calls.filter(c=>c.method==='eth_sendTransaction').length,0)
})
test('existing legacy paid entrant reconnects without paying again',async()=>{
 const calls=mock({bound:true,joined:true,version:null})
 await payJoinToken(room,token,7,wallet,()=>{},LEGACY_GATE)
 assert.equal(calls.filter(c=>c.method==='eth_sendTransaction'||c.method==='personal_sign').length,0)
})
test('full quote digest preserves Solidity domain and changes for each payment field',()=>{
 const key=roomIdToBytes32(room)
 const fields=[key,wallet,9n,token,7n,wallet,0]
 const digest=quotedJoinDigest(...fields)
 assert.equal(digest,keccak256(encodePacked(['string','address','uint256','bytes32','address','uint256','address','uint256','address','uint8'],['ORBIX_CREATOR_JOIN_V2',GATE_ADDRESS,46630n,...[key,wallet,9n,token,7n,wallet,0]])))
 for(const [index,value] of [[0,'0x'+'33'.repeat(32)],[1,token],[2,10n],[3,wallet],[4,8n],[5,token],[6,1]]){
  const changed=[...fields];changed[index]=value
  assert.notEqual(quotedJoinDigest(...changed),digest)
 }
 assert.notEqual(quotedJoinDigest(...fields,token),digest)
})
test('room encoding rejects malformed identifiers instead of stripping collisions',()=>{
 for(const bad of ['../../../room','1'.repeat(17),'1'.repeat(65)])assert.throws(()=>roomIdToBytes32(bad))
 assert.equal(roomIdToBytes32(room),'0x'+'0'.repeat(48)+room)
})

test('a mismatched historical creator or payout cannot receive a wallet payment',async()=>{
 const calls=mock({bound:true,version:null})
 await assert.rejects(payJoinToken(room,token,7,wallet,()=>{},LEGACY_GATE,{creator:token,payout:wallet,payee:0}),/creator or payout differs/)
 assert.equal(calls.filter(c=>c.method==='eth_sendTransaction'||c.method==='personal_sign').length,0)
})
