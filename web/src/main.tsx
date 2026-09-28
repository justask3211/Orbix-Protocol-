import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { createPublicClient, createWalletClient, custom, http, parseEther, formatEther, formatUnits, type Address } from 'viem'
import { robinhoodTestnet } from 'viem/chains'
import { amountWithSlippage, parsePositiveAmount, validateLaunch, priceImpactPct, formatPriceImpact, impactSeverity, decodeRevertReason, friendlyError } from './trade'
import { CHAIN_ID, RPC_URL, ADDRESSES, LAUNCHPAD_ADDRESS, explorerTxUrl, explorerAddressUrl } from './addresses'

declare global { interface Window { ethereum?: { request(args: { method: string; params?: unknown[] }): Promise<unknown>; on?: (event: string, cb: (...args: unknown[]) => void) => void; removeListener?: (event: string, cb: (...args: unknown[]) => void) => void } } }

const ERC20_ABI = [{type:'function',name:'approve',stateMutability:'nonpayable',inputs:[{name:'spender',type:'address'},{name:'amount',type:'uint256'}],outputs:[{type:'bool'}]},{type:'function',name:'allowance',stateMutability:'view',inputs:[{name:'owner',type:'address'},{name:'spender',type:'address'}],outputs:[{type:'uint256'}]},{type:'function',name:'balanceOf',stateMutability:'view',inputs:[{name:'owner',type:'address'}],outputs:[{type:'uint256'}]},{type:'function',name:'symbol',stateMutability:'view',inputs:[],outputs:[{type:'string'}]},{type:'function',name:'decimals',stateMutability:'view',inputs:[],outputs:[{type:'uint8'}]}] as const
const PAIR_ABI = [{type:'function',name:'getReserves',stateMutability:'view',inputs:[],outputs:[{name:'r0',type:'uint112'},{name:'r1',type:'uint112'},{name:'ts',type:'uint32'}]},{type:'function',name:'token0',stateMutability:'view',inputs:[],outputs:[{type:'address'}]}] as const
const FACTORY_ABI = [{type:'function',name:'getPair',stateMutability:'view',inputs:[{name:'a',type:'address'},{name:'b',type:'address'}],outputs:[{type:'address'}]}] as const
const ROUTER_ABI = [
  {type:'function',name:'getAmountsOut',stateMutability:'view',inputs:[{name:'amountIn',type:'uint256'},{name:'path',type:'address[]'}],outputs:[{type:'uint256[]'}]},
  {type:'function',name:'swapExactETHForTokens',stateMutability:'payable',inputs:[{name:'amountOutMin',type:'uint256'},{name:'path',type:'address[]'},{name:'to',type:'address'},{name:'deadline',type:'uint256'}],outputs:[{type:'uint256[]'}]},
  {type:'function',name:'swapExactTokensForETH',stateMutability:'nonpayable',inputs:[{name:'amountIn',type:'uint256'},{name:'amountOutMin',type:'uint256'},{name:'path',type:'address[]'},{name:'to',type:'address'},{name:'deadline',type:'uint256'}],outputs:[{type:'uint256[]'}]},
  {type:'function',name:'swapExactTokensForTokens',stateMutability:'nonpayable',inputs:[{name:'amountIn',type:'uint256'},{name:'amountOutMin',type:'uint256'},{name:'path',type:'address[]'},{name:'to',type:'address'},{name:'deadline',type:'uint256'}],outputs:[{type:'uint256[]'}]}
] as const
const LAUNCHPAD_ABI = [{type:'function',name:'createLaunch',stateMutability:'payable',inputs:[{name:'name',type:'string'},{name:'symbol',type:'string'},{name:'supply',type:'uint256'},{name:'collateral',type:'address'},{name:'tokenSeed',type:'uint256'},{name:'collateralSeed',type:'uint256'},{name:'lockLiquidity',type:'bool'}],outputs:[{type:'address'},{type:'address'}]}] as const

const publicClient = createPublicClient({ chain: robinhoodTestnet, transport: http(RPC_URL) })

const getWalletClient = () => createWalletClient({ chain: robinhoodTestnet, transport: custom(window.ethereum!) })
const deadlineTs = () => BigInt(Math.floor(Date.now() / 1000) + 1200)
const isEth = (a: Address) => a.toLowerCase() === ADDRESSES.WETH.toLowerCase()
// Token→token routes via FREE (the only fully liquid non-WETH side on this testnet).
const routePath = (from: Address, to: Address): Address[] => {
  if (isEth(from) && isEth(to)) return [ADDRESSES.WETH, ADDRESSES.FREE, ADDRESSES.WETH]
  if (isEth(from)) return [ADDRESSES.WETH, to]
  if (isEth(to)) return [from, ADDRESSES.WETH]
  if (from.toLowerCase() === ADDRESSES.FREE.toLowerCase() || to.toLowerCase() === ADDRESSES.FREE.toLowerCase()) return [from, to]
  return [from, ADDRESSES.FREE, to]
}

import { Activity, ArrowUpRight, BarChart3, Boxes, ChevronRight, CircleDollarSign, Cpu, GitBranch, LayoutDashboard, Menu, Network, Search, Settings2, ShieldCheck, Sparkles, Wallet, X, ExternalLink, RefreshCw, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import './styles.css'

// ---- W6: tx toast system (instant, submitted/confirmed/failed, explorer links) ----
type ToastKind = 'pending' | 'success' | 'error'
type Toast = { id: number; kind: ToastKind; title: string; hash?: string; message?: string }
type PushToast = (t: Omit<Toast, 'id'>) => number

const toastIcons: Record<ToastKind, React.ReactNode> = {
  pending: <Loader2 size={16} className="toast-spin" />,
  success: <CheckCircle2 size={16} />,
  error: <AlertTriangle size={16} />,
}

function ToastStack({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  if (!toasts.length) return null
  return <div className="toast-stack" aria-live="polite">{toasts.map(t =>
    <div key={t.id} className={`toast toast-${t.kind}`}>
      <span className="toast-icon">{toastIcons[t.kind]}</span>
      <div className="toast-body">
        <b>{t.title}</b>
        {t.message && <span>{t.message}</span>}
        {t.hash && <a className="toast-link" href={explorerTxUrl(t.hash)} target="_blank" rel="noreferrer">View on explorer <ExternalLink size={12}/></a>}
      </div>
      <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss"><X size={13}/></button>
    </div>)}</div>
}

function useToasts(): { toasts: Toast[]; push: PushToast; dismiss: (id: number) => void; update: (id: number, patch: Partial<Omit<Toast, 'id'>>) => void } {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = nextId.current++
    setToasts(x => [...x, { ...t, id }])
    return id
  }, [])
  const dismiss = useCallback((id: number) => setToasts(x => x.filter(t => t.id !== id)), [])
  const update = useCallback((id: number, patch: Partial<Omit<Toast, 'id'>>) => setToasts(x => x.map(t => t.id === id ? { ...t, ...patch } : t)), [])
  // Auto-dismiss settled toasts after 8s (pending ones persist).
  useEffect(() => {
    if (!toasts.length) return
    const timers = toasts.filter(t => t.kind !== 'pending').map(t => setTimeout(() => dismiss(t.id), 8000))
    return () => timers.forEach(clearTimeout)
  }, [toasts, dismiss])
  return { toasts, push, dismiss, update }
}

// Shared send helper: toast submitted → wait receipt → toast confirmed/failed. Returns hash or null.
async function sendWithToasts(push: PushToast, update: (id: number, patch: Partial<Omit<Toast, 'id'>>) => void, title: string, send: () => Promise<Address>): Promise<Address | null> {
  const id = push({ kind: 'pending', title: `${title} submitted`, message: 'Waiting for confirmation…' })
  try {
    const hash = await send()
    update(id, { kind: 'pending', title: `${title} pending`, hash, message: 'Waiting for block confirmation…' })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status === 'success') { update(id, { kind: 'success', title: `${title} confirmed`, hash }); return hash }
    update(id, { kind: 'error', title: `${title} reverted`, hash, message: 'The transaction was mined but reverted.' })
    return null
  } catch (e) {
    update(id, { kind: 'error', title: `${title} failed`, message: decodeRevertReason(e) })
    return null
  }
}

type NavItem = { label: string; icon: React.ComponentType<{size?: number}>; badge?: string }
const nav: NavItem[] = [
  { label: 'Overview', icon: LayoutDashboard }, { label: 'Discover', icon: Sparkles }, { label: 'Swap', icon: ArrowUpRight }, { label: 'Pools', icon: Boxes }, { label: 'Launch', icon: GitBranch }, { label: 'Staking', icon: CircleDollarSign }, { label: 'Orbix666', icon: Cpu, badge: 'NEW' }, { label: 'Marketplace', icon: BarChart3 },
]
const live = [{ token: 'ORBIX', pair: 'ORBIX / WETH', price: '0.00482', change: '+12.8%', color: 'orange' }, { token: 'ECO', pair: 'ECO / ORBIX', price: '0.00019', change: '+4.2%', color: 'green' }, { token: 'FREE', pair: 'FREE / WETH', price: '0.1284', change: '-1.6%', color: 'purple' }]
async function connectWallet(): Promise<{ address: Address; chainId: number }> {
  if (!window.ethereum) throw new Error('No injected wallet found. Install MetaMask or Rabby.')
  const chainHex = `0x${CHAIN_ID.toString(16)}`
  try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex }] }) }
  catch { await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: chainHex, chainName: 'Robinhood Chain Testnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [RPC_URL], blockExplorerUrls: ['https://explorer.testnet.chain.robinhood.com'] }] }) }
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[]
  const chain = await window.ethereum.request({ method: 'eth_chainId' }) as string
  return { address: accounts[0] as Address, chainId: Number.parseInt(chain, 16) }
}

type WalletState = { address?: Address; chainId?: number; error?: string }
function useWallet() {
  const [wallet, setWallet] = useState<WalletState>({})
  const connect = async () => { try { setWallet({ ...(await connectWallet()) }) } catch (e) { setWallet({ error: friendlyError(e) }) } }
  useEffect(() => { const eth = window.ethereum; if (!eth?.on) return; const accountsChanged = (a: unknown) => setWallet(x => ({ ...x, address: (a as string[])[0] as Address | undefined })); const chainChanged = (c: unknown) => setWallet(x => ({ ...x, chainId: Number.parseInt(String(c), 16) })); eth.on('accountsChanged', accountsChanged); eth.on('chainChanged', chainChanged); return () => { eth.removeListener?.('accountsChanged', accountsChanged); eth.removeListener?.('chainChanged', chainChanged) } }, [])
  return { wallet, connect }
}

// W5: ETH + FREE (and any ERC20) balance readout after connect.
function useBalances(address?: Address) {
  const [balances, setBalances] = useState<{ eth?: string; free?: string; loading: boolean }>({ loading: false })
  const refresh = useCallback(async () => {
    if (!address) { setBalances({ loading: false }); return }
    setBalances(b => ({ ...b, loading: true }))
    try {
      const [ethWei, freeWei] = await Promise.all([
        publicClient.getBalance({ address }),
        publicClient.readContract({ address: ADDRESSES.FREE, abi: ERC20_ABI, functionName: 'balanceOf', args: [address] }),
      ])
      const ethStr = formatEther(ethWei)
      const freeStr = formatUnits(freeWei, 18)
      const trim = (s: string) => { const n = Number(s); return Number.isFinite(n) ? String(Number(n.toFixed(4))) : s }
      setBalances({ eth: trim(ethStr), free: trim(freeStr), loading: false })
    } catch { setBalances(b => ({ ...b, loading: false })) }
  }, [address])
  useEffect(() => { refresh() }, [refresh])
  return { balances, refresh }
}

function App() {
  const [active, setActive] = useState('Overview'); const [mobileOpen, setMobileOpen] = useState(false); const { wallet, connect } = useWallet()
  const { toasts, push, dismiss, update } = useToasts()
  const connected = Boolean(wallet.address)
  const greeting = useMemo(() => active === 'Overview' ? 'Good evening, operator.' : active, [active])
  const header = <Header active={active} connected={connected} address={wallet.address} onConnect={connect} setMobileOpen={setMobileOpen}/>
  const toastLayer = <ToastStack toasts={toasts} dismiss={dismiss}/>
  if (active === 'Swap') return <div className="app"><Sidebar active={active} setActive={setActive} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen}/><main>{header}<SwapView wallet={wallet} onConnect={connect} pushToast={push} updateToast={update}/></main>{toastLayer}</div>
  if (active === 'Launch') return <div className="app"><Sidebar active={active} setActive={setActive} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen}/><main>{header}<LaunchView wallet={wallet} onConnect={connect} pushToast={push} updateToast={update}/></main>{toastLayer}</div>
  return <div className="app">
    <Sidebar active={active} setActive={setActive} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen}/>
    <main><header><button className="mobile-menu" onClick={()=>setMobileOpen(true)} aria-label="Open menu"><Menu size={20}/></button><div className="crumb">COCKPIT <ChevronRight size={13}/> {active.toUpperCase()}</div><div className="header-actions"><button className="icon-btn" aria-label="Search"><Search size={18}/></button><button className="connect" onClick={connect}><Wallet size={16}/>{connected?'0x253d…9087':'Connect wallet'}</button></div></header>
      <section className="hero"><div><div className="eyebrow"><span className="live-dot"/> NETWORK LIVE <span className="rule"/> BLOCK 19,442,081</div><h1>{greeting}</h1><p>One interface for the entire Orbix ecosystem.</p></div><div className="hero-orbit"><div className="orbit-ring r1"/><div className="orbit-ring r2"/><div className="orbit-core">O</div><span className="sat s1"/><span className="sat s2"/></div></section>
      <section className="metric-grid"><Metric label="TOTAL VALUE LOCKED" value="—" foot="Awaiting indexer" icon={<ShieldCheck size={16}/>} muted/><Metric label="24H VOLUME" value="—" foot="No indexed trades" icon={<Activity size={16}/>} muted/><Metric label="ACTIVE POOLS" value="—" foot="Read from factory" icon={<Network size={16}/>} muted/><Metric label="YOUR PORTFOLIO" value="—" foot={connected?'Connected account':'Connect wallet to view'} icon={<Wallet size={16}/>} muted/></section>
      <div className="section-head"><div><span className="eyebrow orange">MARKET PULSE</span><h2>Watchlist</h2></div><button className="text-btn" onClick={()=>setActive('Discover')}>Explore ecosystem <ArrowUpRight size={15}/></button></div>
      <section className="watch-grid">{live.map((item)=><article className="token-card" key={item.token}><div className="token-top"><div className={'token-icon '+item.color}>{item.token[0]}</div><div><b>{item.token}</b><small>{item.pair}</small></div><button className="more">•••</button></div><div className="token-price"><strong>{item.price}</strong><span className={item.change.startsWith('-')?'down':''}>{item.change}</span></div><div className="spark"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div><div className="card-foot"><span>Pool data unavailable</span><ArrowUpRight size={14}/></div></article>)}</section>
      <section className="lower-grid"><article className="panel launch-panel"><div className="section-head compact"><div><span className="eyebrow orange">LAUNCHPAD</span><h2>Build the next signal.</h2></div><GitBranch size={24} className="panel-icon"/></div><p>Deploy into a direct pool or let the curve find your market. Every launch is transparent, composable, and yours.</p><div className="launch-options"><button onClick={()=>setActive('Launch')}><span>01</span><b>Direct pool</b><small>Seed liquidity & lock LP</small><ArrowUpRight size={15}/></button><button onClick={()=>setActive('Launch')}><span>02</span><b>Bonding curve</b><small>Progressive price discovery</small><ArrowUpRight size={15}/></button></div></article><article className="panel activity-panel"><div className="section-head compact"><div><span className="eyebrow orange">NETWORK ACTIVITY</span><h2>Recent signals</h2></div><button className="icon-btn"><Activity size={17}/></button></div><div className="empty-state"><div className="empty-icon"><Activity size={19}/></div><b>No indexed activity yet</b><span>Connect to the testnet and your activity will appear here.</span></div></article></section>
      <footer><span><span className="pulse"/> All systems operational</span><span>Data is read from the configured testnet registry · <a href={explorerAddressUrl(ADDRESSES.ROUTER)} target="_blank" rel="noreferrer"><button>View explorer <ArrowUpRight size={12}/></button></a></span></footer>
    </main>
    {toastLayer}
  </div>
}
function Sidebar({active,setActive,mobileOpen,setMobileOpen}:{active:string,setActive:(x:string)=>void,mobileOpen:boolean,setMobileOpen:(x:boolean)=>void}){return <aside className={mobileOpen?'sidebar open':'sidebar'}><div className="brand"><div className="orb-mark"><span/></div><div><b>ORBIX</b><small>PROTOCOL</small></div><button className="close" onClick={()=>setMobileOpen(false)}><X size={18}/></button></div><div className="network"><span className="pulse"/> Robinhood testnet <span className="chain">46630</span></div><nav>{nav.map(({label,icon:Icon,badge})=><button key={label} className={active===label?'nav-item active':'nav-item'} onClick={()=>{setActive(label);setMobileOpen(false)}}><Icon size={17}/><span>{label}</span>{badge&&<em>{badge}</em>}</button>)}</nav><div className="sidebar-bottom"><button className="nav-item"><Settings2 size={17}/><span>Protocol status</span><span className="status-dot"/></button><div className="version">ORBIX OS <span>v0.8.4</span></div></div></aside>}
function Header({active,address,onConnect,setMobileOpen}:{active:string,connected:boolean,address?:Address,onConnect:()=>void,setMobileOpen:(x:boolean)=>void}){return <header><button className="mobile-menu" onClick={()=>setMobileOpen(true)}><Menu size={20}/></button><div className="crumb">COCKPIT <ChevronRight size={13}/> {active.toUpperCase()}</div><div className="header-actions"><button className="icon-btn"><Search size={18}/></button><button className="connect" onClick={onConnect}><Wallet size={16}/>{address?`${address.slice(0,6)}…${address.slice(-4)}`:'Connect wallet'}</button></div></header>}

// W7: explorer link chip for a tx hash (exported for reuse in activity panels).
export function TxLink({ hash }: { hash: string }) {
  return <a className="tx-link" href={explorerTxUrl(hash)} target="_blank" rel="noreferrer">{hash.slice(0, 10)}…{hash.slice(-6)} <ExternalLink size={12}/></a>
}

function SwapView({ wallet, onConnect, pushToast, updateToast }: { wallet: WalletState; onConnect: () => void; pushToast: PushToast; updateToast: (id: number, patch: Partial<Omit<Toast, 'id'>>) => void }) {
  type Side = { kind: 'eth' } | { kind: 'erc20'; address: Address; symbol: string }
  const ETH: Side = { kind: 'eth' }
  const FREE: Side = { kind: 'erc20', address: ADDRESSES.FREE, symbol: 'FREE' }
  const [from, setFrom] = useState<Side>(ETH); const [to, setTo] = useState<Side>(FREE)
  const [amount, setAmount] = useState(''); const [slippage, setSlippage] = useState('2.5')
  const [quote, setQuote] = useState(''); const [quoting, setQuoting] = useState(false)
  const [impact, setImpact] = useState<number | null>(null)
  const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false)
  const [retryTx, setRetryTx] = useState<null | (() => void)>(null)
  const [allowance, setAllowance] = useState<bigint | null>(null)
  const { balances, refresh: refreshBalances } = useBalances(wallet.address)
  const address = wallet.address
  const wrongNetwork = Boolean(address) && wallet.chainId !== CHAIN_ID
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const quoteSeq = useRef(0)

  const path = useMemo(() => routePath(from.kind === 'eth' ? ADDRESSES.WETH : from.address, to.kind === 'eth' ? ADDRESSES.WETH : to.address), [from, to])
  const needsApprove = from.kind === 'erc20' && allowance !== null && amount && (() => { try { return allowance < parsePositiveAmount(amount, 18) } catch { return false } })()

  // S1: debounced live quote + S2 price impact from reserves.
  const runQuote = useCallback(async (amt: string, p: Address[]) => {
    const seq = ++quoteSeq.current
    setQuoting(true); setStatus('')
    try {
      const input = parsePositiveAmount(amt, 18)
      const out = await publicClient.readContract({ address: ADDRESSES.ROUTER, abi: ROUTER_ABI, functionName: 'getAmountsOut', args: [input, p] })
      if (seq !== quoteSeq.current) return
      const outAmt = out[out.length - 1]
      setQuote(formatEther(outAmt))
      try {
        const pair = await publicClient.readContract({ address: ADDRESSES.FACTORY, abi: FACTORY_ABI, functionName: 'getPair', args: [p[0], p[1]] })
        if (pair !== '0x0000000000000000000000000000000000000000' && seq === quoteSeq.current) {
          const [reserves, token0] = await Promise.all([
            publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'getReserves' }),
            publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'token0' }),
          ])
          const rIn = p[0].toLowerCase() === token0.toLowerCase() ? reserves[0] : reserves[1]
          const rOut = p[0].toLowerCase() === token0.toLowerCase() ? reserves[1] : reserves[0]
          setImpact(priceImpactPct(rIn, rOut, input, outAmt))
        } else setImpact(null)
      } catch { setImpact(null) }
    } catch (e) {
      if (seq === quoteSeq.current) { setQuote(''); setImpact(null); setStatus(`Quote unavailable: ${decodeRevertReason(e)}`) }
    } finally { if (seq === quoteSeq.current) setQuoting(false) }
  }, [])

  useEffect(() => {
    if (!amount) { setQuote(''); setImpact(null); return }
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { runQuote(amount, path) }, 500)
    return () => clearTimeout(debounce.current)
  }, [amount, path, runQuote])

  // S4: check allowance for the token side.
  useEffect(() => {
    if (from.kind !== 'erc20' || !address) { setAllowance(null); return }
    publicClient.readContract({ address: from.address, abi: ERC20_ABI, functionName: 'allowance', args: [address, ADDRESSES.ROUTER] })
      .then(setAllowance).catch(() => setAllowance(null))
  }, [from, address])

  const approve = async () => {
    if (!address) return onConnect()
    if (from.kind !== 'erc20') return
    setBusy(true); setStatus('Approve FREE spending…')
    try {
      const input = parsePositiveAmount(amount, 18)
      await sendWithToasts(pushToast, updateToast, 'Approval', () => getWalletClient().writeContract({ account: address, address: from.address, abi: ERC20_ABI, functionName: 'approve', args: [ADDRESSES.ROUTER, input] }))
      setAllowance(await publicClient.readContract({ address: from.address, abi: ERC20_ABI, functionName: 'allowance', args: [address, ADDRESSES.ROUTER] }))
      setStatus('Approval confirmed. You can swap now.')
      refreshBalances()
    } catch (e) { setStatus(`Approval failed: ${decodeRevertReason(e)}`) } finally { setBusy(false) }
  }

  const doSwap = async () => {
    if (!address) return onConnect()
    if (wrongNetwork) return setStatus('Wrong network. Reconnect to switch to Robinhood Chain testnet.')
    let input: bigint, minOut: bigint, outAmt: bigint
    try {
      input = parsePositiveAmount(amount, 18)
      const out = await publicClient.readContract({ address: ADDRESSES.ROUTER, abi: ROUTER_ABI, functionName: 'getAmountsOut', args: [input, path] })
      outAmt = out[out.length - 1]
      minOut = amountWithSlippage(outAmt, slippage)
    } catch (e) { return setStatus(`Quote failed: ${decodeRevertReason(e)}`) }
    // S5: simulate before broadcast, decode revert reason.
    const client = getWalletClient()
    const sim = from.kind === 'eth'
      ? () => publicClient.simulateContract({ address: ADDRESSES.ROUTER, abi: ROUTER_ABI, functionName: 'swapExactETHForTokens', args: [minOut, path, address, deadlineTs()], account: address, value: input }) as never
      : from.kind === 'erc20' && to.kind === 'eth'
        ? () => publicClient.simulateContract({ address: ADDRESSES.ROUTER, abi: ROUTER_ABI, functionName: 'swapExactTokensForETH', args: [input, minOut, path, address, deadlineTs()], account: address }) as never
        : () => publicClient.simulateContract({ address: ADDRESSES.ROUTER, abi: ROUTER_ABI, functionName: 'swapExactTokensForTokens', args: [input, minOut, path, address, deadlineTs()], account: address }) as never
    try { await sim() } catch (e) {
      const reason = decodeRevertReason(e)
      setRetryTx(() => () => doSwap())
      return setStatus(`Simulation failed: ${reason}`)
    }
    setBusy(true); setStatus('Confirm the swap in your wallet…')
    const ok = await sendWithToasts(pushToast, updateToast, 'Swap', async () => {
      if (from.kind === 'eth') return client.writeContract({ account: address, address: ADDRESSES.ROUTER, abi: ROUTER_ABI, functionName: 'swapExactETHForTokens', args: [minOut, path, address, deadlineTs()], value: input })
      if (to.kind === 'eth') return client.writeContract({ account: address, address: ADDRESSES.ROUTER, abi: ROUTER_ABI, functionName: 'swapExactTokensForETH', args: [input, minOut, path, address, deadlineTs()] })
      return client.writeContract({ account: address, address: ADDRESSES.ROUTER, abi: ROUTER_ABI, functionName: 'swapExactTokensForTokens', args: [input, minOut, path, address, deadlineTs()] })
    })
    setBusy(false)
    if (ok) { setStatus(`Swap confirmed. Received ~${formatEther(outAmt).slice(0, 10)} ${to.kind === 'eth' ? 'ETH' : to.symbol}.`); setRetryTx(null); refreshBalances() }
    else { setRetryTx(() => () => doSwap()) }
  }

  const flip = () => { const f = from; setFrom(to); setTo(f); setAmount(''); setQuote(''); setImpact(null) }
  const severity = impact === null ? 'ok' : impactSeverity(impact)
  const minReceived = (() => { try { return formatEther(amountWithSlippage(parseEther(quote), slippage)) } catch { return '—' } })()

  return <section className="action-page"><div className="eyebrow orange">SWAP / ROUTER</div><h1>Move value<br/><i>without friction.</i></h1><p className="lead">Trade ETH and tokens through the deployed Orbix router on Robinhood Chain testnet.</p>
    {wrongNetwork && <div className="action-note error-note">Wrong network — switch to Robinhood Chain testnet (46630) and reconnect.</div>}
    <div className="swap-card panel">
      <div className="swap-tabs"><button className="selected">Swap</button><span className="action-note">Router {ADDRESSES.ROUTER.slice(0,8)}…</span></div>
      <div className="swap-field"><label>You pay · {from.kind === 'eth' ? 'ETH' : from.symbol}{address && <span className="balance-chip">{from.kind === 'eth' ? (balances.eth ?? '—') : (from.address.toLowerCase() === ADDRESSES.FREE.toLowerCase() ? balances.free ?? '—' : '—')} {from.kind === 'eth' ? 'ETH' : from.symbol}</span>}</label><div><input value={amount} onChange={e=>{setAmount(e.target.value)}} placeholder="0.00" inputMode="decimal"/><span className="token-pill">{from.kind === 'eth' ? 'ETH' : from.symbol}</span></div><small>{quoting ? 'Fetching quote…' : quote ? 'Live quote · debounced 500ms' : 'Enter an amount to quote'}</small></div>
      <div className="swap-switch"><button onClick={flip} aria-label="Flip direction"><ArrowUpRight size={15}/></button></div>
      <div className="swap-field"><label>You receive · {to.kind === 'eth' ? 'ETH' : to.symbol}</label><div><input value={quoting ? '…' : quote} readOnly placeholder="Quote"/><span className="token-pill">{to.kind === 'eth' ? 'ETH' : to.symbol}</span></div><small>{quote ? `Minimum received ${minReceived} ${to.kind === 'eth' ? 'ETH' : to.symbol}` : 'Enter an amount to quote'}</small></div>
      <div className="swap-details">
        <span>Slippage</span><label><input className="slippage-input" value={slippage} onChange={e=>setSlippage(e.target.value)} aria-label="Slippage percentage"/> %</label>
        <span>Deadline</span><b>20 minutes</b>
        <span>Price impact</span><b className={severity === 'high' ? 'impact-high' : severity === 'warn' ? 'impact-warn' : ''}>{impact === null ? '—' : formatPriceImpact(impact)}</b>
        <span>Path</span><b>{path.map(a => a.toLowerCase() === ADDRESSES.WETH.toLowerCase() ? 'WETH' : a.toLowerCase() === ADDRESSES.FREE.toLowerCase() ? 'FREE' : '?').join(' → ')}</b>
        <span>Balances</span><b>{balances.loading ? '…' : `${balances.eth ?? '—'} ETH · ${balances.free ?? '—'} FREE`}{address && <button className="icon-btn inline" onClick={refreshBalances} aria-label="Refresh balances"><RefreshCw size={13}/></button>}</b>
      </div>
      {needsApprove
        ? <button className="primary full" disabled={busy} onClick={approve}>{busy ? 'Waiting…' : 'Approve FREE for router'} <ShieldCheck size={16}/></button>
        : <button className="primary full" disabled={busy || !amount} onClick={doSwap}>{busy ? 'Waiting…' : address ? 'Swap' : 'Connect wallet'} <ArrowUpRight size={16}/></button>}
      {(status || wallet.error) && <p className="action-note error-note">{status || wallet.error}</p>}
      {retryTx && <button className="secondary full" onClick={retryTx}><RefreshCw size={15}/> Retry swap</button>}
      <p className="action-note"><ShieldCheck size={14}/> Debounced quote, price impact, minOut, approval, simulation, pending receipt and explorer links handled before send.</p>
    </div></section>
}
function LaunchView({wallet,onConnect,pushToast,updateToast}:{wallet:WalletState,onConnect:()=>void,pushToast:PushToast,updateToast:(id:number,patch:Partial<Omit<Toast,'id'>>)=>void}){
  const [name,setName]=useState(''); const [symbol,setSymbol]=useState(''); const [supply,setSupply]=useState(''); const [tokenSeed,setTokenSeed]=useState(''); const [collateralSeed,setCollateralSeed]=useState(''); const [lock,setLock]=useState(true); const [status,setStatus]=useState(''); const [busy,setBusy]=useState(false)
  const launch=async()=>{ if(!wallet.address)return onConnect(); if(!LAUNCHPAD_ADDRESS)return setStatus('Direct launch unavailable: no deployed OrbixLaunchpad address is recorded in DEPLOYMENT.md.'); if(wallet.chainId!==CHAIN_ID)return setStatus('Wrong network. Reconnect to Robinhood Chain testnet.'); try { const values=validateLaunch(name,symbol,supply,tokenSeed,collateralSeed); const client=getWalletClient(); setBusy(true); setStatus('Approve FREE collateral, then confirm the launch…'); const allowance=await publicClient.readContract({address:ADDRESSES.FREE,abi:ERC20_ABI,functionName:'allowance',args:[wallet.address,LAUNCHPAD_ADDRESS]}); if(allowance<values.collateralSeed){ await sendWithToasts(pushToast,updateToast,'Approval',()=>client.writeContract({account:wallet.address,address:ADDRESSES.FREE,abi:ERC20_ABI,functionName:'approve',args:[LAUNCHPAD_ADDRESS,values.collateralSeed]})) } const hash=await sendWithToasts(pushToast,updateToast,'Launch',()=>client.writeContract({account:wallet.address,address:LAUNCHPAD_ADDRESS,abi:LAUNCHPAD_ABI,functionName:'createLaunch',args:[name,symbol,values.supply,ADDRESSES.FREE,values.tokenSeed,values.collateralSeed,lock],value:parseEther('0.001')})); setStatus(hash?`Launch confirmed: `:'Launch failed'); if(hash)setStatus(`Launch confirmed: ${hash.slice(0,10)}…`) } catch(e){setStatus(`Launch failed: ${decodeRevertReason(e)}`)} finally {setBusy(false)} }
  return <section className="action-page"><div className="eyebrow orange">LAUNCHPAD / DIRECT POOL</div><h1>Put your idea<br/><i>on the market.</i></h1><p className="lead">Creates a token and FREE-backed pool using the deployed launchpad. Bonding curves are not deployed.</p><div className="launch-choice"><article className="panel choice featured"><div className="choice-number">01</div><GitBranch size={24}/><h2>Direct pool</h2><div className="launch-form"><input placeholder="Token name" value={name} onChange={e=>setName(e.target.value)}/><input placeholder="Symbol" value={symbol} onChange={e=>setSymbol(e.target.value)}/><input placeholder="Total supply (18 decimals)" value={supply} onChange={e=>setSupply(e.target.value)}/><input placeholder="Token seed" value={tokenSeed} onChange={e=>setTokenSeed(e.target.value)}/><input placeholder="FREE collateral seed" value={collateralSeed} onChange={e=>setCollateralSeed(e.target.value)}/><label className="check"><input type="checkbox" checked={lock} onChange={e=>setLock(e.target.checked)}/> Lock LP for launchpad lock period</label></div><button className="primary full" disabled={busy} onClick={launch}>{busy?'Deploying…':wallet.address?'Create direct launch':'Connect wallet'} <ArrowUpRight size={16}/></button></article><article className="panel choice"><div className="choice-number">02</div><Sparkles size={24}/><h2>Bonding curve</h2><p>Unavailable: no deployed curve contract is recorded for this testnet.</p><button className="secondary full" disabled>Unavailable</button></article></div>{(status||wallet.error)&&<div className="action-note error-note">{status||wallet.error}</div>}<div className="action-note"><ShieldCheck size={14}/> Creation fee: 0.001 ETH · collateral: FREE · contract address is required before enabling this flow.</div></section>}

function Metric({label,value,foot,icon,muted}:{label:string,value:string,foot:string,icon:React.ReactNode,muted?:boolean}){return <article className={'metric '+(muted?'muted':'')}><div className="metric-label"><span>{icon}</span>{label}</div><strong>{value}</strong><small>{foot}</small></article>}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
