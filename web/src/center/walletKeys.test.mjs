import test from 'node:test'
import assert from 'node:assert/strict'
import { recoverMessageAddress } from 'viem'
import { accountFromRecoveryKey, createWallet, saveGeneratedAccount, loadGeneratedAccount, KEY_STORAGE, TOKEN_STORAGE, WALLET_KIND } from './walletKeys.ts'

function storage(){const values=new Map();globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};return values}
test('generation and recovery preserve the same signing identity after storage loss',async()=>{
 const values=storage(),wallet=createWallet(),account=loadGeneratedAccount()
 assert.equal(account.address,wallet.address)
 values.clear()
 assert.equal(loadGeneratedAccount(),null)
 const restored=saveGeneratedAccount(` ${wallet.privateKey}\n`)
 assert.equal(restored.address,wallet.address)
 assert.equal(values.get(KEY_STORAGE),wallet.privateKey)
 assert.equal(values.get(WALLET_KIND),'generated')
 const message='Local recovery regression',signature=await loadGeneratedAccount().signMessage({message})
 assert.equal(await recoverMessageAddress({message,signature}),wallet.address)
})
test('malformed, zero and out-of-range keys cannot replace the existing wallet or token',()=>{
 const values=storage(),wallet=createWallet();values.set(TOKEN_STORAGE,'existing-session')
 for(const key of ['','0x123','0x'+'g'.repeat(64),'0x'+'0'.repeat(64),'0x'+'f'.repeat(64),wallet.privateKey.slice(2)]){
  assert.throws(()=>saveGeneratedAccount(key));assert.equal(values.get(KEY_STORAGE),wallet.privateKey);assert.equal(values.get(TOKEN_STORAGE),'existing-session')
 }
})
test('switching accounts clears the old session; corrupt stored keys and external kinds do not auto-sign',()=>{
 const values=storage();createWallet();values.set(TOKEN_STORAGE,'old-session');saveGeneratedAccount('0x'+'0'.repeat(63)+'1')
 assert.equal(values.has(TOKEN_STORAGE),false)
 values.set(WALLET_KIND,'injected');assert.equal(loadGeneratedAccount(),null)
 values.set(WALLET_KIND,'generated');values.set(KEY_STORAGE,'0x'+'0'.repeat(64));assert.equal(loadGeneratedAccount(),null)
 assert.equal(accountFromRecoveryKey('0x'+'0'.repeat(63)+'1').address,'0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf')
})
