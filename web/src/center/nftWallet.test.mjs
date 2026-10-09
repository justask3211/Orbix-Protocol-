import test from 'node:test'
import assert from 'node:assert/strict'
import {encodeAbiParameters,toFunctionSelector} from 'viem'
import {heldNfts,nftMetadata,nftUrl} from './nftWallet.ts'
const account='0x'+'ab'.repeat(20),collection='0x'+'cd'.repeat(20)
const encode=(type,value)=>encodeAbiParameters([{type}],[value])
function wallet({enumerable=true,owner=account}={}){const calls=[];return {calls,request:async args=>{
 calls.push(args)
 if(args.method==='eth_chainId')return '0xb626'
 if(args.method==='eth_requestAccounts')return [account]
 if(args.method==='eth_call'){
  const data=args.params[0].data
  if(data.startsWith(toFunctionSelector('balanceOf(address)')))return encode('uint256',2n)
  if(data.startsWith(toFunctionSelector('tokenOfOwnerByIndex(address,uint256)'))){if(!enumerable)throw Error('not enumerable');return encode('uint256',BigInt('0x'+data.slice(-64))===0n?7n:2n**200n)}
  if(data.startsWith(toFunctionSelector('ownerOf(uint256)')))return encode('address',owner)
  if(data.startsWith(toFunctionSelector('tokenURI(uint256)')))return encode('string','data:application/json;base64,'+Buffer.from(JSON.stringify({name:'Original NFT',image:'https://example.com/nft.png'})).toString('base64'))
 }
 throw Error('unexpected read '+args.method)
}}}
test('free enumerable ownership reads retain uint256 IDs and optional metadata',async()=>{
 const w=wallet(),result=await heldNfts(account,collection,[],w)
 assert.deepEqual(result.nfts.map(n=>n.tokenId),['7',(2n**200n).toString()]);assert.equal(result.nfts[0].name,'Original NFT')
 assert.equal(result.nfts[0].image,'https://example.com/nft.png');assert(!w.calls.some(c=>c.method==='eth_sendTransaction'))
})
test('non-enumerable collections require pasted IDs verified by ownerOf',async()=>{
 const w=wallet({enumerable:false})
 await assert.rejects(heldNfts(account,collection,[],w),/Paste token IDs/)
 assert.equal((await heldNfts(account,collection,['7'],w)).nfts[0].tokenId,'7')
 await assert.rejects(heldNfts(account,collection,['7'],wallet({owner:'0x'+'ef'.repeat(20)})),/does not own/)
})
test('untrusted metadata URLs cannot introduce script/file schemes or SVG data images',async()=>{
 for(const uri of ['javascript:alert(1)','file:///etc/passwd','data:image/svg+xml,<svg/>','http://example.com/nft.png'])assert.equal(nftUrl(uri),undefined)
 assert.equal(nftUrl('ipfs://test/nft.json'),'https://ipfs.io/ipfs/test/nft.json')
 const result=await nftMetadata(collection,'7',{request:async()=>{throw Error('URI missing')}})
 assert.deepEqual(result,{tokenId:'7'})
})
