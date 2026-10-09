import {decodeFunctionResult, encodeFunctionData, parseAbi, type Address} from 'viem'
import {rewardWallet, type Wallet} from './rewardWallet'
const abi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner,uint256 index) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function uri(uint256 tokenId) view returns (string)',
])
export type Nft = {tokenId:string;name?:string;image?:string;metadata?:string}
export function nftUrl(value:unknown):string|undefined {
  if(typeof value!=='string')return
  if(value.startsWith('ipfs://'))return 'https://ipfs.io/ipfs/'+value.slice(7).replace(/^ipfs\//,'')
  try{const url=new URL(value);if(url.protocol==='https:')return url.href}catch{}
}
async function read(wallet:Wallet,collection:Address,name:'balanceOf'|'tokenOfOwnerByIndex'|'ownerOf'|'tokenURI'|'uri',args:readonly unknown[]) {
  const data=encodeFunctionData({abi,functionName:name,args:args as any})
  const raw=await wallet.request({method:'eth_call',params:[{to:collection,data},'latest']})
  return decodeFunctionResult({abi,functionName:name,data:raw})
}
export async function nftMetadata(collection:Address,tokenId:string,wallet:Wallet,kind:'erc721'|'erc1155'='erc721'):Promise<Nft> {
  const result:Nft={tokenId}
  try {
    let uri=String(await read(wallet,collection,kind==='erc721'?'tokenURI':'uri',[BigInt(tokenId)]))
    if(kind==='erc1155')uri=uri.replace(/\{id\}/g,BigInt(tokenId).toString(16).padStart(64,'0'))
    result.metadata=nftUrl(uri)
    let metadata:any
    if(uri.startsWith('data:application/json;base64,')&&uri.length<200000)metadata=JSON.parse(atob(uri.split(',')[1]))
    else if(uri.startsWith('data:application/json,')&&uri.length<200000)metadata=JSON.parse(decodeURIComponent(uri.slice('data:application/json,'.length)))
    else if(result.metadata){const response=await fetch(result.metadata,{signal:AbortSignal.timeout(5000),credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)throw Error('Metadata unavailable');const raw=await response.text();if(raw.length>200000)throw Error('Metadata too large');metadata=JSON.parse(raw)}
    if(typeof metadata?.name==='string')result.name=metadata.name.slice(0,100)
    result.image=nftUrl(metadata?.image)
  }catch{/* Optional metadata cannot block ownership or reward selection. */}
  return result
}
export async function heldNfts(address:string,collection:Address,manualIds:string[]=[],injected?:Wallet):Promise<{nfts:Nft[];notice:string}> {
  const wallet=await rewardWallet(address,injected)
  let ids=manualIds
  let notice='Ownership verified with ownerOf. Metadata may be unavailable.'
  if(!ids.length){
    const count=BigInt(await read(wallet,collection,'balanceOf',[address as Address]) as bigint)
    if(count===0n)return {nfts:[],notice:'This wallet holds no NFTs in this collection.'}
    const limit=Number(count>50n?50n:count)
    try{ids=await Promise.all(Array.from({length:limit},async(_,i)=>String(await read(wallet,collection,'tokenOfOwnerByIndex',[address as Address,BigInt(i)]))))}
    catch{throw new Error('This collection does not expose free enumerable ownership reads. Paste token IDs below and verify them with ownerOf; no paid indexer is required.')}
    notice=count>50n?'Showing the first 50 held NFTs. Verify additional IDs manually.':`${ids.length} held NFTs verified.`
  }
  if(ids.length>50||ids.some(id=>!/^\d+$/.test(id)||BigInt(id)>=2n**256n)||new Set(ids).size!==ids.length)throw new Error('Enter up to 50 distinct uint256 token IDs.')
  await Promise.all(ids.map(async id=>{const owner=String(await read(wallet,collection,'ownerOf',[BigInt(id)]));if(owner.toLowerCase()!==address.toLowerCase())throw new Error(`Your wallet does not own NFT #${id}.`)}))
  const nfts:Nft[]=[]
  // Bound concurrency and external metadata requests.
  for(let i=0;i<ids.length;i+=5)nfts.push(...await Promise.all(ids.slice(i,i+5).map(id=>nftMetadata(collection,id,wallet))))
  return {nfts,notice}
}

/** Public reads avoid account/chain prompts when rendering a claim card. */
export async function nftReadWallet():Promise<Wallet>{return {request:async ({method,params})=>{const response=await fetch('https://rpc.testnet.chain.robinhood.com',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(8000)});const result=await response.json();if(result.error)throw new Error('NFT read unavailable');return result.result}}}
