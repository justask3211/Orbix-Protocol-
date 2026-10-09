import test from 'node:test'
import assert from 'node:assert/strict'
import { activeWalletProvider, selectWalletProvider, injectedConnectors, watchInjectedConnectors, walletConnectProvider } from './walletConnectors.ts'

test('EIP-6963 discovers multiple extensions without fetching their supplied icons',()=>{
 const target=new EventTarget(),a={request:async()=>[]},b={request:async()=>[]};globalThis.window=target
 target.ethereum={providers:[a,b]};let updates=0
 const stop=watchInjectedConnectors(()=>updates++)
 for(const [uuid,name,provider] of [['a','MetaMask',a],['b','Rainbow',b]]){
  const event=new Event('eip6963:announceProvider');Object.defineProperty(event,'detail',{value:{info:{uuid,name,rdns:`app.${name.toLowerCase()}`,icon:'https://never-fetch.example/logo.svg'},provider}});target.dispatchEvent(event)
 }
 assert.equal(updates,2);const found=injectedConnectors();assert.equal(found.length,2);assert.deepEqual(found.map(c=>c.brand),['metamask','rainbow']);assert(!('icon' in found[0]))
 selectWalletProvider(b);assert.equal(activeWalletProvider(),b);selectWalletProvider(null);stop()
})
test('WalletConnect refuses a missing project ID before opening any relay or requesting a key',async()=>{
 await assert.rejects(walletConnectProvider(),/not configured/)
})

test('WalletConnect pairing forwards the URI and removes listeners on success or cancellation',async()=>{
 const {pairWalletConnect}=await import('./walletConnectors.ts')
 const listeners=new Map(),address='0x'+'ab'.repeat(20),uris=[];let cancelled=0
 const provider={request:async()=>[address],on:(event,fn)=>listeners.set(event,fn),removeListener:event=>listeners.delete(event),enable:async()=>{listeners.get('display_uri')?.('wc:local-fixture@2?relay-protocol=irn');return [address]},signer:{abortPairingAttempt:()=>cancelled++}}
 assert.deepEqual(await pairWalletConnect(provider,uri=>uris.push(uri)),[address]);assert.equal(uris.length,1);assert.equal(listeners.size,0)
 const abort=new AbortController();provider.enable=()=>new Promise(()=>{})
 const pairing=pairWalletConnect(provider,()=>{},abort.signal);abort.abort()
 await assert.rejects(pairing,/cancelled/);assert.equal(cancelled,1);assert.equal(listeners.size,0)
 await assert.rejects(pairWalletConnect(provider,()=>{},abort.signal),/cancelled/)
})
