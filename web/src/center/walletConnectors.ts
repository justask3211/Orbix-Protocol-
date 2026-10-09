/** EIP-6963 discovery and a lazy WalletConnect v2 relay. No remote icon loading. */
export type WalletProvider = {
  request: (args: {method:string; params?: unknown[]})=>Promise<any>
  on?: (event:string,listener:(value:any)=>void)=>unknown
  removeListener?: (event:string,listener:(value:any)=>void)=>unknown
  signer?: {abortPairingAttempt:()=>void}
  enable?: ()=>Promise<string[]>
  disconnect?: ()=>Promise<void>
  accounts?: string[]
  session?: unknown
}
export type InjectedConnector = {id:string;name:string;brand:'metamask'|'rainbow'|'trust'|'browser';provider:WalletProvider}
let selectedProvider: WalletProvider | null = null
export function activeWalletProvider(): WalletProvider | null {return selectedProvider}
export function selectWalletProvider(provider: WalletProvider | null) {selectedProvider=provider}
const providers=new Map<string,InjectedConnector>()
const subscribers=new Set<()=>void>()
let listening=false
function brand(name:string,rdns=''):InjectedConnector['brand'] {
  if(/metamask/i.test(name+' '+rdns))return 'metamask'
  if(/rainbow/i.test(name+' '+rdns))return 'rainbow'
  if(/trust/i.test(name+' '+rdns))return 'trust'
  return 'browser'
}
export function startWalletDiscovery() {
  if(typeof window==='undefined')return
  if(!listening){
    listening=true
    window.addEventListener('eip6963:announceProvider',event=>{
      const detail=(event as CustomEvent).detail
      if(!detail?.info || typeof detail.provider?.request!=='function')return
      const {uuid,name,rdns}=detail.info
      if(typeof uuid!=='string'||typeof name!=='string')return
      providers.set(uuid,{id:uuid,name:name.slice(0,60),brand:brand(name,rdns),provider:detail.provider})
      subscribers.forEach(update=>update())
    })
  }
  window.dispatchEvent(new Event('eip6963:requestProvider'))
}
export function injectedConnectors(): InjectedConnector[] {
  const result=[...providers.values()]
  const ethereum=(window as any).ethereum
  const legacy=ethereum?.providers ?? (ethereum?[ethereum]:[])
  for(const provider of legacy){
    if(typeof provider?.request!=='function'||result.some(c=>c.provider===provider))continue
    const name=provider.isRainbow?'Rainbow':provider.isTrust || provider.isTrustWallet?'Trust Wallet':provider.isMetaMask?'MetaMask':'Browser wallet'
    result.push({id:`legacy-${result.length}`,name,brand:brand(name),provider})
  }
  return result
}
export function watchInjectedConnectors(update:()=>void) {
  subscribers.add(update);startWalletDiscovery()
  return ()=>{subscribers.delete(update)}
}
export function walletConnectProjectId(): string {
  return (import.meta as unknown as {env?:Record<string,string>}).env?.VITE_WALLETCONNECT_PROJECT_ID?.trim() ?? ''
}
let relayPromise:Promise<WalletProvider> | null=null
export async function walletConnectProvider():Promise<WalletProvider> {
  const projectId=walletConnectProjectId()
  if(!/^[0-9a-f]{32}$/i.test(projectId))throw new Error('WalletConnect QR is not configured yet. Choose a browser wallet, generate a wallet, or recover with your saved key.')
  if(!relayPromise)relayPromise=(async()=>{
    const {EthereumProvider}=await import('@walletconnect/ethereum-provider')
    return await EthereumProvider.init({projectId,chains:[1],optionalChains:[46630],showQrModal:false,
      methods:['personal_sign'],optionalMethods:['eth_sendTransaction','wallet_switchEthereumChain','wallet_addEthereumChain'],
      rpcMap:{1:'https://ethereum-rpc.publicnode.com',46630:'https://rpc.testnet.chain.robinhood.com'},
      metadata:{name:'Orbix Center',description:'Play together on Orbix',url:window.location.origin,icons:[]},
}) as unknown as WalletProvider
  })().catch(error=>{relayPromise=null;throw error})
  return relayPromise
}

/** Relay pairing cleanup is shared by QR cancellation and component teardown. */
export async function pairWalletConnect(provider:WalletProvider, onUri:(uri:string)=>void, signal?:AbortSignal):Promise<string[]> {
  if(signal?.aborted)throw new Error('WalletConnect connection cancelled.')
  const display=(uri:string)=>{if(!signal?.aborted)onUri(uri)}
  let abort=()=>{}
  const cancelled=new Promise<never>((_,reject)=>{
    abort=()=>{provider.signer?.abortPairingAttempt();reject(new Error('WalletConnect connection cancelled.'))}
    signal?.addEventListener('abort',abort,{once:true})
  })
  provider.on?.('display_uri',display)
  try {
    return await Promise.race([provider.enable ? provider.enable() : provider.request({method:'eth_requestAccounts'}),cancelled])
  } finally {
    provider.removeListener?.('display_uri',display)
    signal?.removeEventListener('abort',abort)
  }
}
