// Orbix Center join-token gate: binds rooms on-chain at publish, pays at join.
//
// The flow the user sees:
//   PUBLISH (creator):
//     1. A signing-preview modal shows exactly what the approve + bindRoom calls
//        will do (contract address, selector, arguments, human-readable summary).
//     2. Creator approves their token for the gate, then signs bindRoom.
//     3. The backend records the binding (roomId → pool) and publishes the room.
//   JOIN (joiner):
//     1. A signing-preview modal shows the approve + join calls with the amount,
//        token name, and destination (creator wallet / custom / burn).
//     2. Approve (if needed) then gate.join(roomIdBytes32).
//     3. Revert reasons are decoded into human-readable messages.

import { encodeFunctionData, parseUnits, formatUnits, decodeFunctionResult } from 'viem'

const ERC20_ABI = [
  { name: 'approve', type: 'function', stateMutability: 'nonpayable',
    inputs: [{name:'spender',type:'address'},{name:'amount',type:'uint256'}], outputs:[{type:'bool'}] },
  { name: 'allowance', type: 'function', stateMutability: 'view',
    inputs: [{name:'owner',type:'address'},{name:'spender',type:'address'}], outputs:[{type:'uint256'}] },
  { name: 'decimals', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{type:'uint8'}] },
  { name: 'symbol', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{type:'string'}] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [{name:'account',type:'address'}], outputs: [{type:'uint256'}] },
] as const

const GATE_ABI = [
  { name: 'bindRoom', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      {name:'roomId',type:'bytes32'},
      {name:'token',type:'address'},
      {name:'joinFee',type:'uint256'},
      {name:'payee',type:'uint8'},
      {name:'payout',type:'address'},
    ], outputs: [] },
  { name: 'join', type: 'function', stateMutability: 'nonpayable',
    inputs: [{name:'roomId',type:'bytes32'}], outputs: [] },
  { name: 'bindingOf', type: 'function', stateMutability: 'view',
    inputs: [{name:'roomId',type:'bytes32'}], outputs: [
      {name:'creator',type:'address'},{name:'token',type:'address'},
      {name:'joinFee',type:'uint256'},{name:'payout',type:'address'},
      {name:'payee',type:'uint8'},{name:'paused',type:'bool'}] },
] as const

const GATE_ADDRESS = '0xcfc161d02225eceb97aa9b8ff791a407a3bb3cff'
const CHAIN_46630 = '0xb626'
const BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD'

// Known custom error selectors from our contracts
const GATE_ERRORS: Record<string, string> = {
  '0x627a29f9': 'NotCreator — only the room creator can call this.',
  '0x82b42900': 'NotAuthority — the signature is not from the settlement authority.',
  '0x949fbf37': 'AlreadyBound — this room already has a join token bound.',
  '0x7dc0f5f6': 'NotBound — this room has no join token bound yet. The creator must bind it first.',
  '0xd3c45fbc': 'Paused — the creator has paused joining for this room.',
  '0x3c9818fc': 'AlreadyJoined — this wallet already joined this room.',
  '0x2c35dbf3': 'ZeroFee — the join fee cannot be zero.',
  '0x5b8d4142': 'ZeroAddress — the token or payout address cannot be zero.',
  '0x6b1c69bf': 'BadToken — that address does not behave like an ERC-20 token.',
  '0x2b7c5e6c': 'NonceUsed — this claim code was already used.',
  '0x1f2a2005': 'ZeroAmount — the amount cannot be zero.',
  '0xfb8f41b2': 'TransferMismatch — the token did not deliver the expected amount (fee-on-transfer or rebasing token).',
}

const ERC20_ERRORS: Record<string, string> = {
  '0x13be252b': 'Insufficient allowance — you need to approve the contract to spend your tokens first.',
  '0x08c379a0': 'reverted with a message from the token.',
}

function decodeRevert(data: string, context: 'gate' | 'erc20'): string {
  const sel = data.slice(0, 10).toLowerCase()
  const tables = context === 'gate' ? { ...GATE_ERRORS, ...ERC20_ERRORS } : { ...ERC20_ERRORS, ...GATE_ERRORS }
  return tables[sel] ?? `The contract reverted (error ${sel}). Check the explorer for details.`
}

async function getEth(): Promise<any> {
  const eth = (window as any).ethereum
  if (!eth) throw new Error('No browser wallet found. Generate or connect one first.')
  return eth
}

async function ensureChain46630(eth: any): Promise<void> {
  const current: string = await eth.request({ method: 'eth_chainId' })
  if (String(current).toLowerCase() === CHAIN_46630) return
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_46630 }] })
  } catch (e: any) {
    if (e?.code === 4902 || /Unrecognized chain/i.test(String(e?.message))) {
      await eth.request({ method: 'wallet_addEthereumChain', params: [{
        chainId: CHAIN_46630,
        chainName: 'Robinhood Chain Testnet',
        nativeCurrency: { name: 'Test ETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: ['https://rpc.testnet.chain.robinhood.com'],
        blockExplorerUrls: ['https://explorer.testnet.chain.robinhood.com'],
      }] })
      return
    }
    throw new Error('Please switch your wallet to the Robinhood testnet (chain 46630) to continue.')
  }
}

/** roomId string (e.g. "f5ea6592ba0895c2") → bytes32 hex for the gate contract. */
function roomIdToBytes32(roomId: string): `0x${string}` {
  const clean = roomId.replace(/[^0-9a-fA-F]/gi, '').toLowerCase().padStart(64, '0').slice(0, 64)
  return ('0x' + clean) as `0x${string}`
}

async function waitMined(eth: any, txHash: string, timeoutMs = 180_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const r = await eth.request({ method: 'eth_getTransactionReceipt', params: [txHash] })
    if (r) {
      if (String(r.status).toLowerCase() !== '0x1') {
        // Try to decode the revert reason
        const debug = await eth.request({ method: 'debug_traceTransaction', params: [txHash] }).catch(() => null)
        const revertData = debug?.revertReason
          ? '0x' + debug.revertReason
          : (await eth.request({ method: 'eth_call', params: [{ to: r.to, data: r.input }, 'latest'] }).catch(() => null))
        throw new Error(decodeRevert(typeof revertData === 'string' && revertData.startsWith('0x') && revertData.length > 10 ? revertData : '0x', 'gate'))
      }
      return
    }
    await new Promise((res) => setTimeout(res, 3000))
  }
  throw new Error('Timed out waiting for the transaction to confirm. Check the explorer.')
}

/** Fetch the creator token's symbol and the user's wallet balance of it. */
export async function fetchTokenInfo(token: string, wallet: string): Promise<{ symbol: string; balance: string; decimals: number }> {
  const eth = await getEth()
  await ensureChain46630(eth)
  const call = async (data: string) => {
    const hex: string = await eth.request({
      method: 'eth_call',
      params: [{ to: token, data }, 'latest'],
    })
    return hex
  }
  const symHex = await call(encodeFunctionData({ abi: ERC20_ABI, functionName: 'symbol' }))
  const symbol = decodeFunctionResult({ abi: ERC20_ABI, functionName: 'symbol', data: symHex as `0x${string}` }) as string
  const balHex = await call(encodeFunctionData({ abi: ERC20_ABI, functionName: 'balanceOf', args: [wallet as `0x${string}`] }))
  const balanceWei = decodeFunctionResult({ abi: ERC20_ABI, functionName: 'balanceOf', data: balHex as `0x${string}` }) as bigint
  const decHex = await call(encodeFunctionData({ abi: ERC20_ABI, functionName: 'decimals' }))
  const decimals = decodeFunctionResult({ abi: ERC20_ABI, functionName: 'decimals', data: decHex as `0x${string}` }) as number
  return { symbol, balance: formatUnits(balanceWei, decimals), decimals }
}

/** Creator: approve the gate to spend their token, then bindRoom. */
export async function bindRoomOnChain(
  roomId: string,
  token: string,
  amount: number,
  payoutMode: 'creator' | 'custom' | 'burn',
  payoutAddress: string | undefined,
  wallet: string,
  onStep: (step: string, detail?: string) => void,
): Promise<void> {
  const eth = await getEth()
  await ensureChain46630(eth)
  const wei = parseUnits(String(amount), 18)
  const roomBytes = roomIdToBytes32(roomId)

  // resolve payee + payout
  const payee = payoutMode === 'creator' ? 0 : payoutMode === 'custom' ? 1 : 2
  const payout = payoutMode === 'creator' ? wallet
    : payoutMode === 'custom' ? (payoutAddress ?? '')
    : BURN_ADDRESS
  if (!payout) throw new Error('A payout address is required for the custom-wallet option.')

  onStep('approve', `Asking your wallet to approve the gate (0x${GATE_ADDRESS.slice(2, 8)}…) to transfer your token.`)
  const approveData = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve',
    args: [GATE_ADDRESS as `0x${string}`, wei] })
  const approveTx: string = await eth.request({
    method: 'eth_sendTransaction',
    params: [{ from: wallet, to: token, data: approveData }],
  })
  onStep('approve-mined', `Approve sent: ${approveTx.slice(0, 14)}… waiting for it to confirm.`)
  await waitMined(eth, approveTx)

  onStep('bind', `Asking your wallet to bind the join token to this room (room: ${roomId.slice(0, 10)}…, fee: ${amount} tokens, payout: ${payoutMode === 'burn' ? 'burn' : payout.slice(0, 10) + '…'}).`)
  const bindData = encodeFunctionData({ abi: GATE_ABI, functionName: 'bindRoom',
    args: [roomBytes, token as `0x${string}`, wei, payee, payout as `0x${string}`] })
  const bindTx: string = await eth.request({
    method: 'eth_sendTransaction',
    params: [{ from: wallet, to: GATE_ADDRESS, data: bindData }],
  })
  onStep('bind-mined', `Bind sent: ${bindTx.slice(0, 14)}… waiting for it to confirm.`)
  await waitMined(eth, bindTx)
  onStep('done', 'Join token bound on-chain. Joiners can now pay with your token.')
}

/** Joiner: approve the gate to spend their token, then gate.join. */
export async function payJoinToken(
  roomId: string,
  token: string,
  amount: number,
  wallet: string,
  onStep: (step: string, detail?: string) => void,
): Promise<void> {
  const eth = await getEth()
  await ensureChain46630(eth)
  const wei = parseUnits(String(amount), 18)
  const roomBytes = roomIdToBytes32(roomId)
  if (wei <= 0n) throw new Error('Join amount must be positive.')

  // Verify the room is bound on-chain before sending anything: bindingOf returns
  // (creator, token, joinFee, payout, payee, paused). A zero creator means unbound.
  const bindData = encodeFunctionData({ abi: GATE_ABI, functionName: 'bindingOf', args: [roomBytes] })
  const bindingHex: string = await eth.request({
    method: 'eth_call', params: [{ from: wallet, to: GATE_ADDRESS, data: bindData }, 'latest'],
  })
  const creatorSlot = bindingHex && bindingHex.length >= 66 ? '0x' + bindingHex.slice(26, 66) : '0x' + '0'.repeat(40)
  if (creatorSlot === '0x' + '0'.repeat(40)) {
    throw new Error('This room has no join token bound on-chain yet. The creator must republish the room so the binding is written.')
  }

  // 1) allowance
  onStep('checking', 'Checking your token allowance for the gate…')
  const allowanceData = encodeFunctionData({ abi: ERC20_ABI, functionName: 'allowance',
    args: [wallet as `0x${string}`, GATE_ADDRESS as `0x${string}`] })
  const allowanceHex: string = await eth.request({
    method: 'eth_call', params: [{ from: wallet, to: token, data: allowanceData }, 'latest'],
  })
  const allowance = BigInt(allowanceHex)
  if (allowance < wei) {
    onStep('approve', `Approving the gate to transfer ${amount} tokens from your wallet. Your wallet will ask you to sign this.`)
    const approveData = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve',
      args: [GATE_ADDRESS as `0x${string}`, wei] })
    const approveTx: string = await eth.request({
      method: 'eth_sendTransaction', params: [{ from: wallet, to: token, data: approveData }],
    })
    onStep('approve-mined', 'Approve sent. Waiting for confirmation…')
    await waitMined(eth, approveTx)
  }

  // 2) gate.join
  onStep('join', `Joining the room — the gate will transfer ${amount} tokens from your wallet to the room's payout destination.`)
  const joinData = encodeFunctionData({ abi: GATE_ABI, functionName: 'join', args: [roomBytes] })
  const joinTx: string = await eth.request({
    method: 'eth_sendTransaction',
    params: [{ from: wallet, to: GATE_ADDRESS, data: joinData }],
  })
  onStep('join-mined', 'Join sent. Waiting for confirmation…')
  await waitMined(eth, joinTx)
  onStep('done', 'Join complete. You are now in the room.')
}
