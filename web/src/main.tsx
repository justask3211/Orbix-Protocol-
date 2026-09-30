import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { createPublicClient, createWalletClient, custom, http, parseEther, formatEther, formatUnits, type Address } from 'viem'
import { robinhoodTestnet } from 'viem/chains'
import { amountWithSlippage, parsePositiveAmount, validateLaunch, priceImpactPct, formatPriceImpact, impactSeverity, decodeRevertReason, friendlyError } from './trade'
import { CHAIN_ID, RPC_URL, ADDRESSES, LAUNCHPAD_ADDRESS, LZ, RH_BRIDGE_L1, explorerTxUrl, explorerAddressUrl } from './addresses'
import { ERC20_ABI, PAIR_ABI, FACTORY_ABI, ROUTER_ABI, LAUNCHPAD_ABI, CHEF_ABI, NFT_ABI, MARKET_ABI, OFT_ABI, RH_INBOX_ABI } from './abis'
import { findBestPath, loadGraph } from './smartRouter'
import { EthereumProvider } from '@walletconnect/ethereum-provider'

declare global { interface Window { ethereum?: { request(args: { method: string; params?: unknown[] }): Promise<unknown>; on?: (event: string, cb: (...args: unknown[]) => void) => void; removeListener?: (event: string, cb: (...args: unknown[]) => void) => void } } }

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

import { Activity, ArrowUpRight, BarChart3, Boxes, ChevronRight, CircleDollarSign, Cpu, GitBranch, LayoutDashboard, Menu, Network, Search, Settings2, ShieldCheck, Sparkles, Wallet, X, ExternalLink, RefreshCw, CheckCircle2, AlertTriangle, Loader2, ArrowLeftRight, Plus, Minus } from 'lucide-react'
import './styles.css'
import { CenterApp } from './center/CenterApp'

// ---- tx toast system (instant, submitted/confirmed/failed, explorer links) ----
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

// ---------- TokenSelect modal (dark, searchable, replaces native select) ----------
type TokenOption = { address: Address; symbol: string; source: 'base' | 'launch' | 'pool' | 'center'; hasPool: boolean }
function TokenSelectModal({ open, onClose, onPick, options, balances, title }: {
  open: boolean; onClose: () => void; onPick: (t: TokenOption) => void
  options: TokenOption[]; balances?: Map<string, string>; title: string
}) {
  const [q, setQ] = useState('')
  useEffect(() => { if (open) setQ('') }, [open])
  if (!open) return null
  const filtered = options.filter(t =>
    !q || t.symbol.toLowerCase().includes(q.toLowerCase()) || t.address.toLowerCase().includes(q.toLowerCase()))
  return <div className="modal-overlay" onClick={onClose}>
    <div className="token-modal" onClick={e => e.stopPropagation()}>
      <h3>Select a token</h3><p className="sub">{title}</p>
      <input className="token-search" autoFocus placeholder="Search name, symbol or 0x address…" value={q} onChange={e => setQ(e.target.value)}/>
      {filtered.map(t => <button key={t.address} className="token-row" onClick={() => { onPick(t); onClose() }}>
        <span className="tk-ic">{t.symbol.slice(0, 2).toUpperCase()}</span>
        <span className="tk-name"><b>{t.symbol}</b><small>{t.address.slice(0, 6)}…{t.address.slice(-4)}</small></span>
        <span className="tk-badges">
          {t.source === 'launch' && <span className="badge launch">LAUNCH</span>}
          {t.source === 'center' && <span className="badge center">CENTER · PREVIEW</span>}
          {t.hasPool && <span className="badge pool">LIQUID</span>}
          {!t.hasPool && <span className="badge zero">NO POOL</span>}
          {balances?.get(t.address.toLowerCase()) && <span className="tk-bal">{balances.get(t.address.toLowerCase())}</span>}
        </span>
      </button>)}
      {!filtered.length && <p className="sub" style={{ padding: 12 }}>No tokens match “{q}”.</p>}
    </div>
  </div>
}

// Token pill button that opens the modal (styled, no native select)
function TokenPill({ symbol, onClick }: { symbol: string; onClick: () => void }) {
  return <button className="token-pill" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }} onClick={onClick}>
    <span className="tk-ic" style={{ width: 18, height: 18, fontSize: 8 }}>{symbol.slice(0, 2).toUpperCase()}</span>
    {symbol} <span style={{ color: '#777', fontSize: 10 }}>▾</span>
  </button>
}

// ---------- Wallet connect modal (MetaMask / injected + WalletConnect v2) ----------
let wcProviderPromise: Promise<unknown> | null = null
async function getWcProvider() {
  if (!wcProviderPromise) wcProviderPromise = EthereumProvider.init({
    projectId: '8e6b92132523a1c0f149318f0f2c8f8d', // public demo-project id — replace with your own for production
    chains: [CHAIN_ID],
    optionalChains: [1, 11155111, 421614],
    showQrModal: true,
    metadata: { name: 'Orbix Protocol', description: 'Orbix super-DeFi cockpit', url: location.origin, icons: [] },
  })
  return wcProviderPromise
}
function WalletModal({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (kind: 'injected' | 'walletconnect') => void }) {
  if (!open) return null
  const hasInjected = Boolean(window.ethereum)
  return <div className="modal-overlay" onClick={onClose}>
    <div className="wallet-modal" onClick={e => e.stopPropagation()}>
      <h3>Connect a wallet</h3>
      <button className="wallet-option" onClick={() => onPick('injected')}>
        <span className="w-ic">🦊</span>
        <span><b>MetaMask / Browser wallet</b><small>{hasInjected ? 'Detected in your browser' : 'Not detected — install MetaMask'}</small></span>
        <span className={'w-tag' + (hasInjected ? '' : ' off')}>{hasInjected ? 'READY' : 'OFF'}</span>
      </button>
      <button className="wallet-option" onClick={() => onPick('walletconnect')}>
        <span className="w-ic">🔗</span>
        <span><b>WalletConnect</b><small>Rabby, Zerion, Trust, mobile wallets — scan or deep-link</small></span>
        <span className="w-tag">SECURE</span>
      </button>
      <button className="wallet-option" onClick={() => { location.href = 'https://metamask.io/download/' ; onClose() }}>
        <span className="w-ic">⬇️</span>
        <span><b>Get a wallet</b><small>Install MetaMask — open source, audited</small></span>
        <span className="w-tag off">NEW</span>
      </button>
      <p className="action-note" style={{ marginTop: 6 }}><ShieldCheck size={13}/> Keys never leave your wallet. We only request a read-only address + network switch.</p>
    </div>
  </div>
}

type NavItem = { label: string; icon: React.ComponentType<{size?: number}>; badge?: string }
const nav: NavItem[] = [
  { label: 'Overview', icon: LayoutDashboard }, { label: 'Discover', icon: Sparkles }, { label: 'Swap', icon: ArrowUpRight }, { label: 'Pools', icon: Boxes }, { label: 'Bridge', icon: ArrowLeftRight, badge: 'NEW' }, { label: 'Launch', icon: GitBranch }, { label: 'Staking', icon: CircleDollarSign }, { label: 'Orbix666', icon: Cpu }, { label: 'Marketplace', icon: BarChart3 },
]

async function connectWallet(): Promise<{ address: Address; chainId: number }> {
  if (!window.ethereum) throw new Error('No injected wallet found. Install MetaMask or Rabby.')
  const chainHex = `0x${CHAIN_ID.toString(16)}`
  try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex }] }) }
  catch { await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: chainHex, chainName: 'Robinhood Chain Testnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [RPC_URL], blockExplorerUrls: ['https://explorer.testnet.chain.robinhood.com'] }] }) }
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[]
  const chain = await window.ethereum.request({ method: 'eth_chainId' }) as string
  return { address: accounts[0] as Address, chainId: Number.parseInt(chain, 16) }
}

type WalletState = { address?: Address; chainId?: number; error?: string; via?: 'injected' | 'walletconnect' }
function useWallet() {
  const [wallet, setWallet] = useState<WalletState>({})
  const [walletModalOpen, setWalletModalOpen] = useState(false)
  const connect = async () => { setWalletModalOpen(true) }
  const pick = async (kind: 'injected' | 'walletconnect') => {
    setWalletModalOpen(false)
    try {
      if (kind === 'walletconnect') {
        const p = await getWcProvider() as { connect: () => Promise<void>; accounts: string[]; chainId: number; on: (e: string, cb: (...a: unknown[]) => void) => void }
        await p.connect()
        setWallet({ address: p.accounts[0] as Address, chainId: p.chainId, via: 'walletconnect' })
        p.on('accountsChanged', (a: unknown) => setWallet(x => ({ ...x, address: ((a as string[])[0] as Address) || undefined })))
        p.on('chainChanged', (c: unknown) => setWallet(x => ({ ...x, chainId: Number(c) })))
      } else {
        setWallet({ ...(await connectWallet()), via: 'injected' })
      }
    } catch (e) { setWallet({ error: friendlyError(e) }) }
  }
  useEffect(() => { const eth = window.ethereum; if (!eth?.on) return; const accountsChanged = (a: unknown) => setWallet(x => ({ ...x, address: (a as string[])[0] as Address | undefined })); const chainChanged = (c: unknown) => setWallet(x => ({ ...x, chainId: Number.parseInt(String(c), 16) })); eth.on('accountsChanged', accountsChanged); eth.on('chainChanged', chainChanged); return () => { eth.removeListener?.('accountsChanged', accountsChanged); eth.removeListener?.('chainChanged', chainChanged) } }, [])
  return { wallet, connect, pick, walletModalOpen, setWalletModalOpen }
}

// ETH + token balances on Robinhood testnet.
function useBalances(address?: Address) {
  const [balances, setBalances] = useState<{ eth?: string; free?: string; orbix?: string; eco?: string; loading: boolean }>({ loading: false })
  const refresh = useCallback(async () => {
    if (!address) { setBalances({ loading: false }); return }
    setBalances(b => ({ ...b, loading: true }))
    try {
      const [ethWei, freeWei, orbixWei, ecoWei] = await Promise.all([
        publicClient.getBalance({ address }),
        publicClient.readContract({ address: ADDRESSES.FREE, abi: ERC20_ABI, functionName: 'balanceOf', args: [address] }),
        publicClient.readContract({ address: ADDRESSES.ORBIX, abi: ERC20_ABI, functionName: 'balanceOf', args: [address] }).catch(() => 0n),
        publicClient.readContract({ address: ADDRESSES.ECO, abi: ERC20_ABI, functionName: 'balanceOf', args: [address] }).catch(() => 0n),
      ])
      const trim = (s: string) => { const n = Number(s); return Number.isFinite(n) ? String(Number(n.toFixed(4))) : s }
      setBalances({ eth: trim(formatEther(ethWei)), free: trim(formatUnits(freeWei, 18)), orbix: trim(formatUnits(orbixWei, 18)), eco: trim(formatUnits(ecoWei, 18)), loading: false })
    } catch { setBalances(b => ({ ...b, loading: false })) }
  }, [address])
  useEffect(() => { refresh() }, [refresh])
  return { balances, refresh }
}

function App() {
  // /center is a separate product surface (creator game platform) with its own shell.
  const [inCenter, setInCenter] = useState(() => window.location.pathname.startsWith('/center'))
  useEffect(() => {
    const sync = () => setInCenter(window.location.pathname.startsWith('/center'))
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])
  if (inCenter) return <CenterApp/>
  return <Cockpit/>
}

function Cockpit() {
  const [active, setActive] = useState('Overview'); const [mobileOpen, setMobileOpen] = useState(false); const { wallet, connect, pick, walletModalOpen, setWalletModalOpen } = useWallet()
  const { toasts, push, dismiss, update } = useToasts()
  const connected = Boolean(wallet.address)
  const greeting = useMemo(() => active === 'Overview' ? 'Good evening, operator.' : active, [active])
  const header = <Header active={active} connected={connected} address={wallet.address} onConnect={connect} setMobileOpen={setMobileOpen}/>
  const toastLayer = <ToastStack toasts={toasts} dismiss={dismiss}/>
  const walletModal = <WalletModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} onPick={pick}/>
  const props = { wallet, onConnect: connect, pushToast: push, updateToast: update }
  if (active === 'Swap') return <div className="app"><Sidebar active={active} setActive={setActive} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen}/><main>{header}<SwapView {...props}/></main>{toastLayer}{walletModal}</div>
  if (active === 'Pools') return <div className="app"><Sidebar active={active} setActive={setActive} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen}/><main>{header}<PoolsView {...props}/></main>{toastLayer}{walletModal}</div>
  if (active === 'Bridge') return <div className="app"><Sidebar active={active} setActive={setActive} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen}/><main>{header}<BridgeView {...props}/></main>{toastLayer}{walletModal}</div>
  if (active === 'Launch') return <div className="app"><Sidebar active={active} setActive={setActive} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen}/><main>{header}<LaunchView {...props}/></main>{toastLayer}{walletModal}</div>
  if (active === 'Staking') return <div className="app"><Sidebar active={active} setActive={setActive} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen}/><main>{header}<StakingView {...props}/></main>{toastLayer}{walletModal}</div>
  if (active === 'Orbix666') return <div className="app"><Sidebar active={active} setActive={setActive} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen}/><main>{header}<NftView {...props}/></main>{toastLayer}{walletModal}</div>
  if (active === 'Marketplace') return <div className="app"><Sidebar active={active} setActive={setActive} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen}/><main>{header}<MarketView {...props}/></main>{toastLayer}{walletModal}</div>
  if (active === 'Overview') return <div className="app"><Sidebar active={active} setActive={setActive} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen}/><main>{header}<OverviewView setActive={setActive} wallet={wallet}/></main>{toastLayer}{walletModal}</div>
  if (active === 'Discover') return <div className="app"><Sidebar active={active} setActive={setActive} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen}/><main>{header}<DiscoverView setActive={setActive}/></main>{toastLayer}{walletModal}</div>
  return <div className="app">
    <Sidebar active={active} setActive={setActive} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen}/>
    <main><header><button className="mobile-menu" onClick={()=>setMobileOpen(true)} aria-label="Open menu"><Menu size={20}/></button><div className="crumb">COCKPIT <ChevronRight size={13}/> {active.toUpperCase()}</div><div className="header-actions"><button className="icon-btn" aria-label="Search"><Search size={18}/></button><button className="connect" onClick={connect}><Wallet size={16}/>{connected?'0x253d…9087':'Connect wallet'}</button></div></header>
      <section className="hero"><div><div className="eyebrow"><span className="live-dot"/> NETWORK LIVE <span className="rule"/> Robinhood Chain testnet</div><h1>{greeting}</h1><p>One interface for the entire Orbix ecosystem.</p></div><div className="hero-orbit"><div className="orbit-ring r1"/><div className="orbit-ring r2"/><div className="orbit-core">O</div><span className="sat s1"/><span className="sat s2"/></div></section>
      <section className="metric-grid"><Metric label="TOTAL VALUE LOCKED" value="—" foot="Awaiting indexer" icon={<ShieldCheck size={16}/>} muted/><Metric label="24H VOLUME" value="—" foot="No indexed trades" icon={<Activity size={16}/>} muted/><Metric label="ACTIVE POOLS" value="—" foot="Read from factory" icon={<Network size={16}/>} muted/><Metric label="YOUR PORTFOLIO" value="—" foot={connected?'Connected account':'Connect wallet to view'} icon={<Wallet size={16}/>} muted/></section>
      <div className="section-head"><div><span className="eyebrow orange">MARKET PULSE</span><h2>Watchlist</h2></div><button className="text-btn" onClick={()=>setActive('Discover')}>Explore ecosystem <ArrowUpRight size={15}/></button></div>
      <section className="watch-grid"><TokenCard token="ORBIX" pair="ORBIX / WETH · legacy launchpad" addr={ADDRESSES.ORBIX} color="orange" note="Legacy launchpad token"/><TokenCard token="CENTER" pair="CENTER · preview asset" addr={CENTER_TOKEN} color="teal" note="New Center token · preview only"/><TokenCard token="ECO" pair="ECO / ORBIX" addr={ADDRESSES.ECO} color="green"/><TokenCard token="FREE" pair="FREE / WETH" addr={ADDRESSES.FREE} color="purple"/></section>
      <section className="lower-grid"><article className="panel launch-panel"><div className="section-head compact"><div><span className="eyebrow orange">LAUNCHPAD</span><h2>Build the next signal.</h2></div><GitBranch size={24} className="panel-icon"/></div><p>Deploy into a direct pool with FREE collateral. Every launch is transparent, composable, and yours.</p><div className="launch-options"><button onClick={()=>setActive('Launch')}><span>01</span><b>Direct pool</b><small>Seed liquidity & lock LP</small><ArrowUpRight size={15}/></button><button onClick={()=>setActive('Launch')}><span>02</span><b>Launchpad</b><small>Permissionless launches</small><ArrowUpRight size={15}/></button></div></article><article className="panel activity-panel"><div className="section-head compact"><div><span className="eyebrow orange">CROSS-CHAIN</span><h2>Bridge is live</h2></div><button className="icon-btn" onClick={()=>setActive('Bridge')}><ArrowLeftRight size={17}/></button></div><div className="empty-state"><div className="empty-icon"><ArrowLeftRight size={19}/></div><b>Robinhood ↔ Ethereum ↔ Arbitrum</b><span>Bridge testnet ETH via the canonical inbox and xORBIX via LayerZero OFT. Click Bridge to start.</span><button className="secondary" onClick={()=>setActive('Bridge')}>Open Bridge</button></div></article></section>
      <footer><span><span className="pulse"/> All systems operational</span><span>Data is read from the configured testnet registry · <a href={explorerAddressUrl(ADDRESSES.ROUTER)} target="_blank" rel="noreferrer"><button>View explorer <ArrowUpRight size={12}/></button></a></span></footer>
    </main>
    {toastLayer}
  </div>
}

const CENTER_TOKEN = ADDRESSES.CENTER_TOKEN

function TokenCard({ token, pair, addr, color, note }: { token: string; pair: string; addr: Address; color: string; note?: string }) {
  const [price, setPrice] = useState<string | null>(null)
  useEffect(() => { (async () => {
    try {
      const pairAddr = await publicClient.readContract({ address: ADDRESSES.FACTORY, abi: FACTORY_ABI, functionName: 'getPair', args: [addr, ADDRESSES.WETH] })
      if (pairAddr === '0x0000000000000000000000000000000000000000') return
      const [reserves, token0] = await Promise.all([
        publicClient.readContract({ address: pairAddr, abi: PAIR_ABI, functionName: 'getReserves' }),
        publicClient.readContract({ address: pairAddr, abi: PAIR_ABI, functionName: 'token0' }),
      ])
      const [r0, r1] = reserves
      const isToken0 = token0.toLowerCase() === addr.toLowerCase()
      const tokenReserve = isToken0 ? r0 : r1
      const wethReserve = isToken0 ? r1 : r0
      if (tokenReserve > 0n) setPrice(formatEther((wethReserve * 10n ** 18n) / tokenReserve).slice(0, 8))
    } catch {}
  })() }, [addr])
  return <article className="token-card"><div className="token-top"><div className={'token-icon '+color}>{token[0]}</div><div><b>{token}</b><small>{pair}</small>{note && <em className="token-note">{note}</em>}</div><button className="more" aria-label={`More ${token} options`}>•••</button></div><div className="token-price"><strong>{price ? `${price} ETH` : '—'}</strong><span className={price ? '' : 'down'}>{price ? 'live' : note?.includes('preview') ? 'preview' : 'no pool'}</span></div><div className="spark"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div><div className="card-foot"><span>{price ? 'Spot from reserves' : note?.includes('preview') ? 'No funded pool yet' : 'Pool data unavailable'}</span><ArrowUpRight size={14}/></div></article>
}

function Sidebar({active,setActive,mobileOpen,setMobileOpen}:{active:string,setActive:(x:string)=>void,mobileOpen:boolean,setMobileOpen:(x:boolean)=>void}){return <aside className={mobileOpen?'sidebar open':'sidebar'}><div className="brand"><div className="orb-mark"><span/></div><div><b>ORBIX</b><small>PROTOCOL</small></div><button className="close" onClick={()=>setMobileOpen(false)}><X size={18}/></button></div><div className="network"><span className="pulse"/> Robinhood testnet <span className="chain">46630</span></div><nav>{nav.map(({label,icon:Icon,badge})=><button key={label} className={active===label?'nav-item active':'nav-item'} onClick={()=>{setActive(label);setMobileOpen(false)}}><Icon size={17}/><span>{label}</span>{badge&&<em>{badge}</em>}</button>)}</nav><div className="sidebar-bottom"><button className="nav-item"><Settings2 size={17}/><span>Protocol status</span><span className="status-dot"/></button><div className="version">ORBIX OS <span>v0.9.0</span></div></div></aside>}

function Header({active,address,onConnect,setMobileOpen}:{active:string,connected:boolean,address?:Address,onConnect:()=>void,setMobileOpen:(x:boolean)=>void}){return <header><button className="mobile-menu" onClick={()=>setMobileOpen(true)}><Menu size={20}/></button><div className="crumb">COCKPIT <ChevronRight size={13}/> {active.toUpperCase()}</div><div className="header-actions"><button className="icon-btn"><Search size={18}/></button><button className="connect" onClick={onConnect}><Wallet size={16}/>{address?`${address.slice(0,6)}…${address.slice(-4)}`:'Connect wallet'}</button></div></header>}

type ViewProps = { wallet: WalletState; onConnect: () => void; pushToast: PushToast; updateToast: (id: number, patch: Partial<Omit<Toast, 'id'>>) => void }

// ---------------- SWAP ----------------
function SwapView({ wallet, onConnect, pushToast, updateToast }: ViewProps) {
  type Side = { kind: 'eth' } | { kind: 'erc20'; address: Address; symbol: string }
  const ETH: Side = { kind: 'eth' }
  const FREE: Side = { kind: 'erc20', address: ADDRESSES.FREE, symbol: 'FREE' }
  const ORBIX: Side = { kind: 'erc20', address: ADDRESSES.ORBIX, symbol: 'ORBIX' }
  const ECO: Side = { kind: 'erc20', address: ADDRESSES.ECO, symbol: 'ECO' }
  const WETH: Side = { kind: 'erc20', address: ADDRESSES.WETH, symbol: 'WETH' }
  const tokens: Side[] = [ETH, WETH, FREE, ORBIX, ECO]
  const [from, setFrom] = useState<Side>(ETH); const [to, setTo] = useState<Side>(FREE)
  const [pickSide, setPickSide] = useState<null | 'from' | 'to'>(null)
  // token options: base list + everything the smart router discovers (launchpad tokens etc.)
  const [extraTokens, setExtraTokens] = useState<TokenOption[]>([])
  useEffect(() => { (async () => {
    try {
      const { tokens: discovered } = await loadGraph()
      const baseSet = new Set(tokens.map(t => t.kind === 'erc20' ? t.address.toLowerCase() : 'eth'))
      const opts: TokenOption[] = []
      for (const [addrL, meta] of discovered) {
        if (baseSet.has(addrL)) continue
        opts.push({ address: meta.address as Address, symbol: meta.symbol, source: 'launch', hasPool: true })
      }
      setExtraTokens(opts)
    } catch { /* graph load is best-effort */ }
  })() }, [])
  const allOptions: TokenOption[] = [
    ...tokens.map(t => t.kind === 'eth'
      ? { address: '0x0000000000000000000000000000000000000000' as Address, symbol: 'ETH', source: 'base' as const, hasPool: true }
      : { address: t.address, symbol: t.symbol, source: 'base' as const, hasPool: true }),
    { address: CENTER_TOKEN, symbol: 'CENTER', source: 'center' as const, hasPool: false },
    ...extraTokens,
  ]
  const applyPick = (side: 'from' | 'to', t: TokenOption) => {
    const isEthSel = t.symbol === 'ETH'
    const next: Side = isEthSel ? { kind: 'eth' } : { kind: 'erc20', address: t.address, symbol: t.symbol }
    if (side === 'from') setFrom(next); else setTo(next)
  }
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
  const [pathState, setPathState] = useState<Address[]>(path)
  const effectivePath = pathState.length && pathState[0].toLowerCase() === (from.kind === 'eth' ? ADDRESSES.WETH : from.address).toLowerCase() ? pathState : path
  const needsApprove = from.kind === 'erc20' && allowance !== null && amount && (() => { try { return allowance < parsePositiveAmount(amount, 18) } catch { return false } })()

  // Debounced live quote + price impact from reserves. Uses the smart router: best path over all factory pairs.
  const runQuote = useCallback(async (amt: string, fromSide: Side, toSide: Side) => {
    const seq = ++quoteSeq.current
    setQuoting(true); setStatus('')
    try {
      const input = parsePositiveAmount(amt, 18)
      const src = fromSide.kind === 'eth' ? ADDRESSES.WETH : fromSide.address
      const dst = toSide.kind === 'eth' ? ADDRESSES.WETH : toSide.address
      const best = await findBestPath(src as Address, dst as Address, input)
      if (seq !== quoteSeq.current) return
      if (!best) { setQuote(''); setImpact(null); setStatus('No route found — no liquidity path between these tokens yet.'); return }
      const outAmt = best.amounts[best.amounts.length - 1]
      setQuote(formatEther(outAmt))
      setPathState(best.path)
      try {
        const pair = await publicClient.readContract({ address: ADDRESSES.FACTORY, abi: FACTORY_ABI, functionName: 'getPair', args: [best.path[0], best.path[1]] })
        if (pair !== '0x0000000000000000000000000000000000000000' && seq === quoteSeq.current) {
          const [reserves, token0] = await Promise.all([
            publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'getReserves' }),
            publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'token0' }),
          ])
          const rIn = best.path[0].toLowerCase() === token0.toLowerCase() ? reserves[0] : reserves[1]
          const rOut = best.path[0].toLowerCase() === token0.toLowerCase() ? reserves[1] : reserves[0]
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
    debounce.current = setTimeout(() => { runQuote(amount, from, to) }, 500)
    return () => clearTimeout(debounce.current)
  }, [amount, from, to, runQuote])

  // Check allowance for the token side.
  useEffect(() => {
    if (from.kind !== 'erc20' || !address) { setAllowance(null); return }
    publicClient.readContract({ address: from.address, abi: ERC20_ABI, functionName: 'allowance', args: [address, ADDRESSES.ROUTER] })
      .then(setAllowance).catch(() => setAllowance(null))
  }, [from, address])

  const approve = async () => {
    if (!address) return onConnect()
    if (from.kind !== 'erc20') return
    setBusy(true); setStatus('Approve token spending…')
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
      const out = await publicClient.readContract({ address: ADDRESSES.ROUTER, abi: ROUTER_ABI, functionName: 'getAmountsOut', args: [input, effectivePath] })
      outAmt = out[out.length - 1]
      minOut = amountWithSlippage(outAmt, slippage)
    } catch (e) { return setStatus(`Quote failed: ${decodeRevertReason(e)}`) }
    const client = getWalletClient()
    const sim = from.kind === 'eth'
      ? () => publicClient.simulateContract({ address: ADDRESSES.ROUTER, abi: ROUTER_ABI, functionName: 'swapExactETHForTokens', args: [minOut, effectivePath, address, deadlineTs()], account: address, value: input }) as never
      : from.kind === 'erc20' && to.kind === 'eth'
        ? () => publicClient.simulateContract({ address: ADDRESSES.ROUTER, abi: ROUTER_ABI, functionName: 'swapExactTokensForETH', args: [input, minOut, effectivePath, address, deadlineTs()], account: address }) as never
        : () => publicClient.simulateContract({ address: ADDRESSES.ROUTER, abi: ROUTER_ABI, functionName: 'swapExactTokensForTokens', args: [input, minOut, effectivePath, address, deadlineTs()], account: address }) as never
    try { await sim() } catch (e) {
      const reason = decodeRevertReason(e)
      setRetryTx(() => () => doSwap())
      return setStatus(`Simulation failed: ${reason}`)
    }
    setBusy(true); setStatus('Confirm the swap in your wallet…')
    const ok = await sendWithToasts(pushToast, updateToast, 'Swap', async () => {
      if (from.kind === 'eth') return client.writeContract({ account: address, address: ADDRESSES.ROUTER, abi: ROUTER_ABI, functionName: 'swapExactETHForTokens', args: [minOut, effectivePath, address, deadlineTs()], value: input })
      if (to.kind === 'eth') return client.writeContract({ account: address, address: ADDRESSES.ROUTER, abi: ROUTER_ABI, functionName: 'swapExactTokensForETH', args: [input, minOut, effectivePath, address, deadlineTs()] })
      return client.writeContract({ account: address, address: ADDRESSES.ROUTER, abi: ROUTER_ABI, functionName: 'swapExactTokensForTokens', args: [input, minOut, effectivePath, address, deadlineTs()] })
    })
    setBusy(false)
    if (ok) { setStatus(`Swap confirmed. Received ~${formatEther(outAmt).slice(0, 10)} ${to.kind === 'eth' ? 'ETH' : to.symbol}.`); setRetryTx(null); refreshBalances() }
    else { setRetryTx(() => () => doSwap()) }
  }

  const flip = () => { const f = from; setFrom(to); setTo(f); setAmount(''); setQuote(''); setImpact(null) }
  const severity = impact === null ? 'ok' : impactSeverity(impact)
  const minReceived = (() => { try { return formatEther(amountWithSlippage(parseEther(quote), slippage)) } catch { return '—' } })()
  const balFor = (s: Side) => s.kind === 'eth' ? balances.eth : s.address.toLowerCase() === ADDRESSES.FREE.toLowerCase() ? balances.free : s.address.toLowerCase() === ADDRESSES.ORBIX.toLowerCase() ? balances.orbix : s.address.toLowerCase() === ADDRESSES.ECO.toLowerCase() ? balances.eco : '—'

  return <section className="action-page"><div className="eyebrow orange">SWAP / ROUTER</div><h1>Move value<br/><i>without friction.</i></h1><p className="lead">Trade ETH, WETH, FREE, ORBIX and ECO through the deployed Orbix router on Robinhood Chain testnet.</p>
    {wrongNetwork && <div className="action-note error-note">Wrong network — switch to Robinhood Chain testnet (46630) and reconnect.</div>}
    <div className="swap-card panel">
      <div className="swap-tabs"><button className="selected">Swap</button><span className="action-note">Router {ADDRESSES.ROUTER.slice(0,8)}…</span></div>
      <div className="swap-field"><label>You pay{address && <span className="balance-chip">{balFor(from) ?? '—'} {from.kind === 'eth' ? 'ETH' : from.symbol}</span>}</label>
        <div><input value={amount} onChange={e=>{setAmount(e.target.value)}} placeholder="0.00" inputMode="decimal"/>
        <TokenPill symbol={from.kind === 'eth' ? 'ETH' : from.symbol} onClick={() => setPickSide('from')}/></div><small>{quoting ? 'Fetching quote…' : quote ? `Live quote via ${path.length - 1} hop${path.length > 2 ? 's' : ''} · smart-routed` : 'Enter an amount to quote'}</small></div>
      <div className="swap-switch"><button onClick={flip} aria-label="Flip direction"><ArrowUpRight size={15}/></button></div>
      <div className="swap-field"><label>You receive{address && <span className="balance-chip">{balFor(to) ?? '—'} {to.kind === 'eth' ? 'ETH' : to.symbol}</span>}</label>
        <div><input value={quoting ? '…' : quote} readOnly placeholder="Quote"/><TokenPill symbol={to.kind === 'eth' ? 'ETH' : to.symbol} onClick={() => setPickSide('to')}/></div><small>{quote ? `Minimum received ${minReceived} ${to.kind === 'eth' ? 'ETH' : to.symbol}` : 'Enter an amount to quote'}</small></div>
      <div className="swap-details">
        <span>Slippage</span><label><input className="slippage-input" value={slippage} onChange={e=>setSlippage(e.target.value)} aria-label="Slippage percentage"/> %</label>
        <span>Deadline</span><b>20 minutes</b>
        <span>Price impact</span><b className={severity === 'high' ? 'impact-high' : severity === 'warn' ? 'impact-warn' : ''}>{impact === null ? '—' : formatPriceImpact(impact)}</b>
        <span>Path</span><b>{effectivePath.map(a => a.toLowerCase() === ADDRESSES.WETH.toLowerCase() ? 'WETH' : a.toLowerCase() === ADDRESSES.FREE.toLowerCase() ? 'FREE' : a.toLowerCase() === ADDRESSES.ORBIX.toLowerCase() ? 'ORBIX' : a.toLowerCase() === ADDRESSES.ECO.toLowerCase() ? 'ECO' : allOptions.find(o => o.address.toLowerCase() === a.toLowerCase())?.symbol ?? '→').join(' → ')}</b>
        <span>Balances</span><b>{balances.loading ? '…' : `${balances.eth ?? '—'} ETH · ${balances.free ?? '—'} FREE · ${balances.orbix ?? '—'} ORBIX`}{address && <button className="icon-btn inline" onClick={refreshBalances} aria-label="Refresh balances"><RefreshCw size={13}/></button>}</b>
      </div>
      {needsApprove
        ? <button className="primary full" disabled={busy} onClick={approve}>{busy ? 'Waiting…' : `Approve ${from.kind==='erc20'?from.symbol:'token'} for router`} <ShieldCheck size={16}/></button>
        : <button className="primary full" disabled={busy || !amount} onClick={doSwap}>{busy ? 'Waiting…' : address ? 'Swap' : 'Connect wallet'} <ArrowUpRight size={16}/></button>}
      {(status || wallet.error) && <p className="action-note error-note">{status || wallet.error}</p>}
      {retryTx && <button className="secondary full" onClick={retryTx}><RefreshCw size={15}/> Retry swap</button>}
      <p className="action-note"><ShieldCheck size={14}/> Debounced quote, price impact, minOut, approval, simulation, pending receipt and explorer links handled before send.</p>
      <TokenSelectModal open={pickSide !== null} onClose={() => setPickSide(null)} title={pickSide === 'from' ? 'Token you pay with' : 'Token you receive'}
        options={allOptions} onPick={t => applyPick(pickSide!, t)}
        balances={address ? new Map(allOptions.map(o => [o.address.toLowerCase(), balFor({ kind: 'erc20', address: o.address, symbol: o.symbol }) ?? ''])) : undefined}/>
    </div></section>
}

// ---------------- POOLS (add / remove liquidity) ----------------
function PoolsView({ wallet, onConnect, pushToast, updateToast }: ViewProps) {
  const [pairToken, setPairToken] = useState<Address>(ADDRESSES.FREE)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [poolSymbols, setPoolSymbols] = useState<Map<string, string>>(new Map())
  useEffect(() => { (async () => { try { const { tokens } = await loadGraph(); setPoolSymbols(new Map([...tokens.entries()].map(([k, v]) => [k, v.symbol]))) } catch {} })() }, [])
  const [amountA, setAmountA] = useState('') // token
  const [amountETH, setAmountETH] = useState('') // ETH side
  const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false)
  const [lpRemove, setLpRemove] = useState('')
  const [pool, setPool] = useState<{ pair: Address; token: string; reserveToken: string; reserveWeth: string; lp: string } | null>(null)
  const address = wallet.address
  const wrongNetwork = Boolean(address) && wallet.chainId !== CHAIN_ID

  const loadPool = useCallback(async () => {
    try {
      const pair = await publicClient.readContract({ address: ADDRESSES.FACTORY, abi: FACTORY_ABI, functionName: 'getPair', args: [pairToken, ADDRESSES.WETH] })
      if (pair === '0x0000000000000000000000000000000000000000') { setPool(null); return }
      const [reserves, token0, sym, _ts, lpBal] = await Promise.all([
        publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'getReserves' }),
        publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'token0' }),
        publicClient.readContract({ address: pairToken, abi: ERC20_ABI, functionName: 'symbol' }),
        publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'totalSupply' }),
        address ? publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'balanceOf', args: [address] }).catch(() => 0n) : Promise.resolve(0n),
      ] as const) as [readonly [bigint, bigint, number], Address, string, bigint, bigint]
      const isToken0 = token0.toLowerCase() === pairToken.toLowerCase()
      setPool({ pair, token: sym, reserveToken: formatUnits(isToken0 ? reserves[0] : reserves[1], 18), reserveWeth: formatUnits(isToken0 ? reserves[1] : reserves[0], 18), lp: formatUnits(lpBal, 18) })
    } catch { setPool(null) }
  }, [pairToken, address])
  useEffect(() => { loadPool() }, [loadPool])

  const approveIfNeeded = async (token: Address, spender: Address, amount: bigint): Promise<boolean> => {
    if (!address) return false
    const allowance = await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'allowance', args: [address, spender] })
    if (allowance >= amount) return true
    const ok = await sendWithToasts(pushToast, updateToast, 'Approval', () => getWalletClient().writeContract({ account: address, address: token, abi: ERC20_ABI, functionName: 'approve', args: [spender, amount] }))
    return ok !== null
  }

  const addLiq = async () => {
    if (!address) return onConnect()
    if (wrongNetwork) return setStatus('Wrong network. Switch to Robinhood Chain testnet.')
    try {
      const tokenAmt = parsePositiveAmount(amountA, 18)
      const ethAmt = parseEther(amountETH)
      if (!pool) {
        // create pool via addLiquidity on fresh pair (router will create pair via factory)
        setStatus('Creating pool — approving both tokens…')
        const okA = await approveIfNeeded(pairToken, ADDRESSES.ROUTER, tokenAmt)
        if (!okA) return
        const okB = await approveIfNeeded(ADDRESSES.WETH, ADDRESSES.ROUTER, ethAmt)
        if (!okB) return
        setBusy(true)
        await sendWithToasts(pushToast, updateToast, 'Create pool', () => getWalletClient().writeContract({ account: address, address: ADDRESSES.ROUTER, abi: ROUTER_ABI, functionName: 'addLiquidity', args: [pairToken, ADDRESSES.WETH, tokenAmt, ethAmt, (tokenAmt*95n)/100n, (ethAmt*95n)/100n, address, deadlineTs()] }))
      } else {
        setStatus('Approving token…')
        const okA = await approveIfNeeded(pairToken, ADDRESSES.ROUTER, tokenAmt)
        if (!okA) return
        setBusy(true)
        setStatus('Adding liquidity — confirm in wallet…')
        await sendWithToasts(pushToast, updateToast, 'Add liquidity', () => getWalletClient().writeContract({ account: address, address: ADDRESSES.ROUTER, abi: ROUTER_ABI, functionName: 'addLiquidityETH', args: [pairToken, tokenAmt, (tokenAmt*95n)/100n, (ethAmt*95n)/100n, address, deadlineTs()], value: ethAmt }))
      }
      setStatus('Liquidity added. LP tokens sent to your wallet.')
      setAmountA(''); setAmountETH(''); setBusy(false); loadPool()
    } catch (e) { setBusy(false); setStatus(`Add failed: ${decodeRevertReason(e)}`) }
  }

  const removeLiq = async () => {
    if (!address) return onConnect()
    if (!pool || !lpRemove) return setStatus('Enter an LP amount to remove.')
    try {
      const lp = parsePositiveAmount(lpRemove, 18)
      setBusy(true); setStatus('Removing liquidity…')
      await sendWithToasts(pushToast, updateToast, 'Remove liquidity', () => getWalletClient().writeContract({ account: address, address: ADDRESSES.ROUTER, abi: ROUTER_ABI, functionName: 'removeLiquidityETH', args: [pairToken, lp, 0n, 0n, address, deadlineTs()] }))
      setStatus('Liquidity removed — tokens and ETH returned.')
      setLpRemove(''); setBusy(false); loadPool()
    } catch (e) { setBusy(false); setStatus(`Remove failed: ${decodeRevertReason(e)}`) }
  }

  return <section className="action-page"><div className="eyebrow orange">POOLS / LP</div><h1>Provide liquidity,<br/><i>earn your share.</i></h1><p className="lead">Add or remove liquidity on the Orbix AMM. Your LP tokens are yours — the launchpad holds LP only for locked launches.</p>
    {wrongNetwork && <div className="action-note error-note">Wrong network — switch to Robinhood Chain testnet (46630).</div>}
    <div className="swap-card panel">
      <div className="swap-tabs"><button className="selected">Add</button><span className="action-note">Pool: {pool ? `${pool.token}/WETH · ${Number(pool.reserveToken).toFixed(2)} / ${Number(pool.reserveWeth).toFixed(4)} ETH` : 'not created yet'}</span></div>
      <div className="swap-field"><label>Token side</label><div><input value={amountA} onChange={e=>setAmountA(e.target.value)} placeholder="0.00 token" inputMode="decimal"/>
        <TokenPill symbol={poolSymbols.get(pairToken.toLowerCase()) ?? 'FREE'} onClick={() => setPickerOpen(true)}/>
        </div><small>Half of the pool</small></div>
      <div className="swap-field"><label>ETH side</label><div><input value={amountETH} onChange={e=>setAmountETH(e.target.value)} placeholder="0.00 ETH" inputMode="decimal"/><span className="token-pill">ETH</span></div><small>Paid as native ETH</small></div>
      <button className="primary full" disabled={busy || !amountA || !amountETH} onClick={addLiq}>{busy ? 'Working…' : address ? (pool ? 'Add liquidity' : 'Create pool + add liquidity') : 'Connect wallet'} <Plus size={16}/></button>
      <div className="swap-tabs" style={{marginTop:16}}><button className="selected">Remove</button><span className="action-note">{pool ? `Your LP: ${pool.lp}` : '—'}</span></div>
      <div className="swap-field"><label>LP amount</label><div><input value={lpRemove} onChange={e=>setLpRemove(e.target.value)} placeholder="0.00 LP" inputMode="decimal"/><button className="token-pill" style={{cursor:'pointer'}} onClick={()=>setLpRemove(pool?.lp || '')}>MAX</button></div><small>Burn LP to get {pool?.token ?? 'tokens'} + ETH back</small></div>
      <button className="secondary full" disabled={busy || !lpRemove || !pool} onClick={removeLiq}>{busy ? 'Working…' : 'Remove liquidity'} <Minus size={16}/></button>
      {(status || wallet.error) && <p className="action-note error-note">{status || wallet.error}</p>}
      <p className="action-note"><ShieldCheck size={14}/> 5% slippage guard, approval checks and receipt tracking included.</p>
      <TokenSelectModal open={pickerOpen} onClose={() => setPickerOpen(false)} title="Pool token (paired with WETH)"
        options={[...poolSymbols.entries()].filter(([a]) => a !== ADDRESSES.WETH.toLowerCase()).map(([a, sym]) => ({ address: a as Address, symbol: sym, source: 'pool' as const, hasPool: true }))}
        onPick={t => setPairToken(t.address)}/>
    </div></section>
}

// ---------------- BRIDGE (RH↔ETH canonical + xORBIX via LayerZero) ----------------
function BridgeView({ wallet, onConnect, pushToast, updateToast }: ViewProps) {
  const { update } = { update: updateToast }
  const [tab, setTab] = useState<'rh_eth' | 'oft'>('rh_eth')
  const [ethAmount, setEthAmount] = useState('')
  const [oftAmount, setOftAmount] = useState('')
  const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false)
  const [dir, setDir] = useState<'sepolia_to_arb' | 'arb_to_sepolia'>('sepolia_to_arb')
  const address = wallet.address
  const [balances, setBalances] = useState<{ rh?: string; sepOft?: string; arbOft?: string }>({})

  const refresh = useCallback(async () => {
    if (!address) return
    const sep = createPublicClient({ transport: http(LZ.SEPOLIA.rpc) })
    const arb = createPublicClient({ transport: http(LZ.ARB_SEPOLIA.rpc) })
    try {
      const [rh, sepBal, arbBal] = await Promise.all([
        publicClient.getBalance({ address }),
        sep.readContract({ address: LZ.SEPOLIA.oft, abi: OFT_ABI, functionName: 'balanceOf', args: [address] }),
        arb.readContract({ address: LZ.ARB_SEPOLIA.oft, abi: OFT_ABI, functionName: 'balanceOf', args: [address] }),
      ])
      const t = (s: string) => String(Number(Number(s).toFixed(4)))
      setBalances({ rh: t(formatEther(rh)), sepOft: t(formatUnits(sepBal, 18)), arbOft: t(formatUnits(arbBal, 18)) })
    } catch {}
  }, [address])
  useEffect(() => { refresh() }, [refresh])

  const bridgeEthToRh = async () => {
    // On Robinhood testnet the canonical deposit runs from L1 Sepolia via the delayed inbox.
    // We do it directly from here using the wallet switched to Sepolia.
    if (!window.ethereum) return setStatus('No wallet')
    try {
      const chainHex = `0x${LZ.SEPOLIA.chainId.toString(16)}`
      try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex }] }) } catch {}
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[]
      const from = accounts[0] as Address
      const value = parseEther(ethAmount)
      const sepWallet = createWalletClient({ transport: custom(window.ethereum!) }) as unknown as ReturnType<typeof getWalletClient>
      const sepPublic = createPublicClient({ transport: http(LZ.SEPOLIA.rpc) })
      setStatus('Submitting depositEth to the RH testnet delayed inbox on Sepolia…')
      const hash = await sepWallet.writeContract({ account: from, address: RH_BRIDGE_L1.DELAYED_INBOX, abi: RH_INBOX_ABI, functionName: 'depositEth', value }) as `0x${string}`
      const id = pushToast({ kind: 'pending', title: 'ETH bridge pending', message: 'Deposit submitted on Sepolia — RH testnet credit follows the batch (~10-30 min).' })
      const receipt = await sepPublic.waitForTransactionReceipt({ hash })
      update(id, receipt.status === 'success' ? { kind: 'success', title: 'ETH bridge submitted', message: 'Funds arrive on Robinhood testnet after the next batch.' } : { kind: 'error', title: 'Bridge reverted' })
      setEthAmount('')
    } catch (e) { setStatus(`Bridge failed: ${decodeRevertReason(e)}`) }
  }

  const sendOft = async () => {
    if (!address) return onConnect()
    try {
      const src = dir === 'sepolia_to_arb' ? LZ.SEPOLIA : LZ.ARB_SEPOLIA
      const dstEid = dir === 'sepolia_to_arb' ? LZ.ARB_SEPOLIA.eid : LZ.SEPOLIA.eid
      const chainHex = `0x${src.chainId.toString(16)}`
      try { await window.ethereum!.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex }] }) } catch {}
      const accounts = await window.ethereum!.request({ method: 'eth_requestAccounts' }) as string[]
      const from = accounts[0] as Address
      const client = createWalletClient({ transport: custom(window.ethereum!) })
      const pub = createPublicClient({ transport: http(src.rpc) })
      const amount = parsePositiveAmount(oftAmount, 18)
      const sendParam = { dstEid, to: `0x${address.slice(2).padStart(64, '0')}` as `0x${string}`, amountLD: amount, minAmountLD: (amount * 90n) / 100n, extraOptions: '0x' as `0x${string}`, composeMsg: '0x' as `0x${string}`, oftCmd: '0x' as `0x${string}` }
      setStatus('Quoting LayerZero fee…')
      const fee = await (pub.readContract as any)({ address: src.oft, abi: OFT_ABI, functionName: 'quoteSend', args: [sendParam, false] } as never) as unknown as { nativeFee: bigint; lzTokenFee: bigint }
      setBusy(true)
      setStatus(`Sending ${oftAmount} xORBIX — LayerZero fee ~${formatEther(fee.nativeFee)} ETH. Confirm in wallet…`)
      const id = pushToast({ kind: 'pending', title: 'OFT transfer pending', message: 'Message in flight via LayerZero. Delivery is usually 1-5 minutes.' })
      const hash = await (client.writeContract as any)({ account: from, address: src.oft, abi: OFT_ABI, functionName: 'send', args: [sendParam, { nativeFee: fee.nativeFee, lzTokenFee: fee.lzTokenFee }, from], value: fee.nativeFee }) as `0x${string}`
      const receipt = await pub.waitForTransactionReceipt({ hash })
      update(id, receipt.status === 'success' ? { kind: 'success', title: 'OFT sent', message: `Track on layerzeroscan.com — GUID emitted in tx ${hash.slice(0,10)}…` } : { kind: 'error', title: 'OFT send reverted' })
      setOftAmount(''); setBusy(false); refresh()
    } catch (e) { setBusy(false); setStatus(`OFT send failed: ${decodeRevertReason(e)}`) }
  }

  return <section className="action-page"><div className="eyebrow orange">BRIDGE / CROSS-CHAIN</div><h1>Move assets<br/><i>between chains.</i></h1><p className="lead">Two lanes: <b>Robinhood testnet ETH</b> via the canonical L1 inbox (Sepolia ⇄ Robinhood), and <b>xORBIX</b> via LayerZero V2 OFT (Sepolia ⇄ Arbitrum Sepolia; RH mainnet lane at EID 30416 is next).</p>
    <div className="swap-card panel">
      <div className="swap-tabs"><button className={tab==='rh_eth'?'selected':''} onClick={()=>setTab('rh_eth')}>Robinhood ETH</button><button className={tab==='oft'?'selected':''} onClick={()=>setTab('oft')}>xORBIX (LayerZero)</button></div>
      {tab === 'rh_eth' ? <>
        <div className="swap-details"><span>Your RH ETH</span><b>{balances.rh ?? '—'}</b><span>Lane</span><b>Ethereum Sepolia → Robinhood testnet (canonical)</b></div>
        <div className="swap-field"><label>Amount of ETH to bridge (on Sepolia)</label><div><input value={ethAmount} onChange={e=>setEthAmount(e.target.value)} placeholder="0.01" inputMode="decimal"/><span className="token-pill">ETH</span></div><small>Deposit goes to the RH testnet delayed inbox 0xF293…B7a4; credited after the next L1→L2 batch (~10-30 min). Proof-of-concept verified live 2026-09-29.</small></div>
        <button className="primary full" disabled={busy || !ethAmount} onClick={bridgeEthToRh}>{busy ? 'Working…' : 'Bridge ETH → Robinhood testnet'} <ArrowLeftRight size={16}/></button>
      </> : <>
        <div className="swap-details"><span>xORBIX on Sepolia</span><b>{balances.sepOft ?? '—'}</b><span>xORBIX on Arbitrum</span><b>{balances.arbOft ?? '—'}</b></div>
        <div className="swap-field"><label>Direction</label><div style={{ display: 'grid', gap: 6, width: '100%' }}>
          <button className={'wallet-option' + (dir === 'sepolia_to_arb' ? '' : ' dim')} style={{ padding: 10 }} onClick={() => setDir('sepolia_to_arb')}>
            <span><b style={{ fontSize: 12 }}>Sepolia → Arbitrum Sepolia</b><small>EID 40161 → EID 40231</small></span>
          </button>
          <button className={'wallet-option' + (dir === 'arb_to_sepolia' ? '' : ' dim')} style={{ padding: 10 }} onClick={() => setDir('arb_to_sepolia')}>
            <span><b style={{ fontSize: 12 }}>Arbitrum Sepolia → Sepolia</b><small>EID 40231 → EID 40161</small></span>
          </button>
        </div><small>Wallet must hold gas on the source chain</small></div>
        <div className="swap-field"><label>Amount of xORBIX</label><div><input value={oftAmount} onChange={e=>setOftAmount(e.target.value)} placeholder="1.0" inputMode="decimal"/><span className="token-pill">xORBIX</span></div><small>90% min-out guard; fee quoted live via LayerZero EndpointV2</small></div>
        <button className="primary full" disabled={busy || !oftAmount} onClick={sendOft}>{busy ? 'Working…' : address ? 'Send via LayerZero' : 'Connect wallet'} <ArrowLeftRight size={16}/></button>
      </>}
      {(status || wallet.error) && <p className="action-note error-note">{status || wallet.error}</p>}
      <p className="action-note"><ShieldCheck size={14}/> Live proofs: RH bridge deposit 0xe08abf02…188587 (Sepolia→RH) and OFT send 0xc6194e4f…2fc08 (Sepolia→Arb Sepolia), 2026-09-29.</p>
    </div></section>
}

// ---------------- LAUNCH (live launchpad) ----------------
function LaunchView({wallet,onConnect,pushToast,updateToast}:ViewProps){
  const [name,setName]=useState(''); const [symbol,setSymbol]=useState(''); const [supply,setSupply]=useState(''); const [tokenSeed,setTokenSeed]=useState(''); const [collateralSeed,setCollateralSeed]=useState(''); const [lock,setLock]=useState(true); const [status,setStatus]=useState(''); const [busy,setBusy]=useState(false)
  const [launchCount,setLaunchCount]=useState<string>('…')
  useEffect(()=>{ (async()=>{ const n = await publicClient.readContract({address:LAUNCHPAD_ADDRESS,abi:LAUNCHPAD_ABI,functionName:'nextLaunchId'}).catch(()=>0n) as bigint; setLaunchCount(n > 0n ? String(n - 1n) : '—') })() },[])
  const launch=async()=>{ const account=wallet.address; if(!account)return onConnect(); if(wallet.chainId!==CHAIN_ID)return setStatus('Wrong network. Reconnect to Robinhood Chain testnet.'); try { const values=validateLaunch(name,symbol,supply,tokenSeed,collateralSeed); const client=getWalletClient(); setBusy(true); setStatus('Approve FREE collateral, then confirm the launch…'); const allowance=await publicClient.readContract({address:ADDRESSES.FREE,abi:ERC20_ABI,functionName:'allowance',args:[account,LAUNCHPAD_ADDRESS]}); if(allowance<values.collateralSeed){ await sendWithToasts(pushToast,updateToast,'Approval',()=>client.writeContract({account,address:ADDRESSES.FREE,abi:ERC20_ABI,functionName:'approve',args:[LAUNCHPAD_ADDRESS,values.collateralSeed]})) } const hash=await sendWithToasts(pushToast,updateToast,'Launch',()=>client.writeContract({account,address:LAUNCHPAD_ADDRESS,abi:LAUNCHPAD_ABI,functionName:'createLaunch',args:[name,symbol,values.supply,ADDRESSES.FREE,values.tokenSeed,values.collateralSeed,lock],value:parseEther('0.001')})); if(hash) setStatus(`Launch confirmed! Token + pool created. Tx ${hash.slice(0,12)}…`) } catch(e){setStatus(`Launch failed: ${decodeRevertReason(e)}`)} finally {setBusy(false)} }
  return <section className="action-page"><div className="eyebrow orange">LAUNCHPAD / DIRECT POOL</div><h1>Put your idea<br/><i>on the market.</i></h1><p className="lead">Creates a token and FREE-backed pool using the deployed OrbixLaunchpad ({LAUNCHPAD_ADDRESS.slice(0,8)}…). {launchCount} launch(es) so far.</p><div className="launch-choice"><article className="panel choice featured"><div className="choice-number">01</div><GitBranch size={24}/><h2>Direct pool</h2><div className="launch-form"><input placeholder="Token name" value={name} onChange={e=>setName(e.target.value)}/><input placeholder="Symbol" value={symbol} onChange={e=>setSymbol(e.target.value)}/><input placeholder="Total supply (18 decimals)" value={supply} onChange={e=>setSupply(e.target.value)}/><input placeholder="Token seed" value={tokenSeed} onChange={e=>setTokenSeed(e.target.value)}/><input placeholder="FREE collateral seed" value={collateralSeed} onChange={e=>setCollateralSeed(e.target.value)}/><label className="check"><input type="checkbox" checked={lock} onChange={e=>setLock(e.target.checked)}/> Lock LP for launchpad lock period (7 days)</label></div><button className="primary full" disabled={busy} onClick={launch}>{busy?'Deploying…':wallet.address?'Create direct launch (0.001 ETH fee)':'Connect wallet'} <ArrowUpRight size={16}/></button></article><article className="panel choice"><div className="choice-number">02</div><Sparkles size={24}/><h2>FREE collateral</h2><p>FREE is the only approved collateral right now. More collaterals can be enabled by the launchpad owner via <code>setCollateral</code>.</p><a href={explorerAddressUrl(LAUNCHPAD_ADDRESS)} target="_blank" rel="noreferrer"><button className="secondary full">View launchpad on explorer <ExternalLink size={14}/></button></a></article></div>{(status||wallet.error)&&<div className="action-note error-note">{status||wallet.error}</div>}<div className="action-note"><ShieldCheck size={14}/> Live proof: launch #1 (OTT) executed on-chain 2026-09-29 — tx 0x8e1ff70d…3d5a0f.</div></section>
}

// ---------------- STAKING (MasterChef) ----------------
function StakingView({ wallet, onConnect, pushToast, updateToast }: ViewProps) {
  const [pid] = useState<bigint>(0n)
  const [amount, setAmount] = useState('')
  const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<{ staked: string; pending: string; pools: number } | null>(null)
  const address = wallet.address
  const load = useCallback(async () => {
    if (!address) return
    try {
      const [pools, user, pending] = await Promise.all([
        publicClient.readContract({ address: ADDRESSES.MASTER_CHEF, abi: CHEF_ABI, functionName: 'poolLength' }),
        publicClient.readContract({ address: ADDRESSES.MASTER_CHEF, abi: CHEF_ABI, functionName: 'userInfo', args: [BigInt(pid), address] }).catch(() => [0n, 0n] as const),
        publicClient.readContract({ address: ADDRESSES.MASTER_CHEF, abi: CHEF_ABI, functionName: 'pendingEco', args: [BigInt(pid), address] }).catch(() => 0n),
      ])
      const u = user as unknown as [bigint, bigint]
      setInfo({ staked: formatUnits(u[0], 18), pending: formatUnits(pending as bigint, 18), pools: Number(pools) })
    } catch (e) { setStatus(`Chef read failed: ${decodeRevertReason(e)}`) }
  }, [address, pid])
  useEffect(() => { load() }, [load])

  const approveLp = async (amt: bigint) => {
    if (!address) return false
    const allowance = await publicClient.readContract({ address: ADDRESSES.FREE, abi: ERC20_ABI, functionName: 'allowance', args: [address, ADDRESSES.MASTER_CHEF] }).catch(() => 0n)
    if (allowance >= amt) return true
    return (await sendWithToasts(pushToast, updateToast, 'Approval', () => getWalletClient().writeContract({ account: address, address: ADDRESSES.FREE, abi: ERC20_ABI, functionName: 'approve', args: [ADDRESSES.MASTER_CHEF, amt] }))) !== null
  }

  const deposit = async () => {
    if (!address) return onConnect()
    try { const amt = parsePositiveAmount(amount, 18); if (!(await approveLp(amt))) return; setBusy(true)
      await sendWithToasts(pushToast, updateToast, 'Stake', () => getWalletClient().writeContract({ account: address, address: ADDRESSES.MASTER_CHEF, abi: CHEF_ABI, functionName: 'deposit', args: [pid, amt] }))
      setStatus('Staked.'); setAmount(''); setBusy(false); load()
    } catch (e) { setBusy(false); setStatus(`Stake failed: ${decodeRevertReason(e)}`) }
  }
  const withdraw = async () => {
    if (!address) return onConnect()
    try { const amt = parsePositiveAmount(amount, 18); setBusy(true)
      await sendWithToasts(pushToast, updateToast, 'Unstake', () => getWalletClient().writeContract({ account: address, address: ADDRESSES.MASTER_CHEF, abi: CHEF_ABI, functionName: 'withdraw', args: [pid, amt] }))
      setStatus('Withdrawn.'); setAmount(''); setBusy(false); load()
    } catch (e) { setBusy(false); setStatus(`Unstake failed: ${decodeRevertReason(e)}`) }
  }

  return <section className="action-page"><div className="eyebrow orange">STAKING / MASTERCHEF</div><h1>Stake LP,<br/><i>harvest ECO.</i></h1><p className="lead">MasterChef {ADDRESSES.MASTER_CHEF.slice(0,8)}… · {info?.pools ?? '…'} pool(s) · pool {pid} = FREE/WETH LP, 10 ECO/block.</p>
    <div className="swap-card panel">
      <div className="swap-details"><span>Your staked LP</span><b>{info?.staked ?? '—'}</b><span>Pending ECO</span><b>{info?.pending ?? '—'}</b>{info && info.pending !== '0' && <span></span>}{info && info.pending !== '0' && <b><button className="secondary" onClick={withdraw as never} style={{display:'inline-flex'}}>Harvest</button></b>}</div>
      <div className="swap-field"><label>LP amount</label><div><input value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00 LP" inputMode="decimal"/><span className="token-pill">FREE/WETH LP</span></div><small>Get LP on the Pools page first.</small></div>
      <button className="primary full" disabled={busy || !amount} onClick={deposit}>{busy ? 'Working…' : address ? 'Stake LP' : 'Connect wallet'} <CircleDollarSign size={16}/></button>
      <button className="secondary full" disabled={busy || !amount} onClick={withdraw}>Unstake LP <Minus size={16}/></button>
      {(status || wallet.error) && <p className="action-note error-note">{status || wallet.error}</p>}
    </div></section>
}

// ---------------- ORBIX666 NFT ----------------
function NftView({ wallet }: ViewProps) {
  const [owned, setOwned] = useState<string[] | null>(null)
  const [status] = useState('')
  const address = wallet.address
  useEffect(() => { (async () => {
    if (!address) return setOwned(null)
    try {
      const bal = await publicClient.readContract({ address: ADDRESSES.ORBIX666, abi: NFT_ABI, functionName: 'balanceOf', args: [address] })
      const ids: string[] = []
      for (let i = 0; i < Number(bal) && i < 20; i++) {
        ids.push(String(await publicClient.readContract({ address: ADDRESSES.ORBIX666, abi: NFT_ABI, functionName: 'tokenOfOwnerByIndex', args: [address, BigInt(i)] }).catch(() => '—')))
      }
      setOwned(ids)
    } catch { setOwned(null) }
  })() }, [address])
  return <section className="action-page"><div className="eyebrow orange">ORBIX666 / NFT</div><h1>Six hundred sixty six.<br/><i>Three tiers.</i></h1><p className="lead">HUMAN (click-hunt + signed claim), BOT (burn ECO), GPU (proof-of-work keccak). Perks: 25% fee discount, launchpad priority, staking boost.</p>
    <div className="swap-card panel">
      <div className="swap-details"><span>Your balance</span><b>{owned ? String(owned.length) : '—'}</b><span>Token IDs</span><b>{owned && owned.length ? owned.join(', ') : (owned ? 'none yet' : '—')}</b></div>
      <p className="action-note"><ShieldCheck size={14}/> Human-tier hunt page and PoW miner are served separately (hunt server :8400). Mint #1 was done via PoW nonce 15388.</p>
      <a href={explorerAddressUrl(ADDRESSES.ORBIX666)} target="_blank" rel="noreferrer"><button className="secondary full">View collection on explorer <ExternalLink size={14}/></button></a>
      {(status || wallet.error) && <p className="action-note error-note">{status}</p>}
    </div></section>
}

// ---------------- MARKETPLACE ----------------
function MarketView({ wallet, onConnect, pushToast, updateToast }: ViewProps) {
  const [tokenId, setTokenId] = useState('')
  const [price, setPrice] = useState('')
  const [listing, setListing] = useState<{ seller: string; price: string; active: boolean } | null>(null)
  const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false)
  const address = wallet.address
  const lookup = useCallback(async () => {
    if (!tokenId) return setListing(null)
    try {
      const l = await publicClient.readContract({ address: ADDRESSES.MARKET, abi: MARKET_ABI, functionName: 'listings', args: [BigInt(tokenId)] }) as unknown as [Address, bigint, boolean]
      setListing({ seller: l[0], price: formatEther(l[1]), active: l[2] })
    } catch { setListing(null) }
  }, [tokenId])
  useEffect(() => { lookup() }, [lookup])

  const list = async () => {
    if (!address) return onConnect()
    const NFT_APPROVE_ABI = [{type:'function',name:'approve',stateMutability:'nonpayable',inputs:[{name:'to',type:'address'},{name:'tokenId',type:'uint256'}],outputs:[]}] as const
    try { setBusy(true); await sendWithToasts(pushToast, updateToast, 'Approve NFT', () => getWalletClient().writeContract({ account: address, address: ADDRESSES.ORBIX666, abi: NFT_APPROVE_ABI, functionName: 'approve', args: [ADDRESSES.MARKET, BigInt(tokenId)] }))
      await sendWithToasts(pushToast, updateToast, 'List', () => getWalletClient().writeContract({ account: address, address: ADDRESSES.MARKET, abi: MARKET_ABI, functionName: 'list', args: [BigInt(tokenId), parseEther(price)] }))
      setStatus('Listed.'); setBusy(false); lookup()
    } catch (e) { setBusy(false); setStatus(`List failed: ${decodeRevertReason(e)}`) }
  }
  const cancel = async () => {
    if (!address) return onConnect()
    try { setBusy(true); await sendWithToasts(pushToast, updateToast, 'Cancel', () => getWalletClient().writeContract({ account: address, address: ADDRESSES.MARKET, abi: MARKET_ABI, functionName: 'cancel', args: [BigInt(tokenId)] })); setBusy(false); lookup() }
    catch (e) { setBusy(false); setStatus(`Cancel failed: ${decodeRevertReason(e)}`) }
  }
  const buy = async () => {
    if (!address) return onConnect()
    if (!listing) return
    try { setBusy(true); await sendWithToasts(pushToast, updateToast, 'Buy', () => getWalletClient().writeContract({ account: address, address: ADDRESSES.MARKET, abi: MARKET_ABI, functionName: 'buy', args: [BigInt(tokenId)], value: parseEther(listing.price) })); setBusy(false); lookup() }
    catch (e) { setBusy(false); setStatus(`Buy failed: ${decodeRevertReason(e)}`) }
  }

  return <section className="action-page"><div className="eyebrow orange">MARKETPLACE / ORBIX666</div><h1>Trade the 666.<br/><i>ECO-priced, holder-discounted.</i></h1><p className="lead">Market {ADDRESSES.MARKET.slice(0,8)}… · 2.5% fee, 25% off for Orbix666 holders.</p>
    <div className="swap-card panel">
      <div className="swap-field"><label>Token ID</label><div><input value={tokenId} onChange={e=>setTokenId(e.target.value)} placeholder="1" inputMode="numeric"/><span className="token-pill">#</span></div><small>{listing ? (listing.active ? `Listed by ${listing.seller.slice(0,8)}… for ${listing.price} ECO` : 'Not currently listed') : 'Enter a token ID to look up'}</small></div>
      <div className="swap-field"><label>Price in ECO (for listing)</label><div><input value={price} onChange={e=>setPrice(e.target.value)} placeholder="100" inputMode="decimal"/><span className="token-pill">ECO</span></div></div>
      <button className="primary full" disabled={busy || !tokenId || !price} onClick={list}>{busy ? 'Working…' : 'Approve + List'} <BarChart3 size={16}/></button>
      <button className="secondary full" disabled={busy || !listing?.active} onClick={cancel}>Cancel listing</button>
      <button className="secondary full" disabled={busy || !listing?.active} onClick={buy}>Buy for {listing ? `${listing.price} ECO` : '—'}</button>
      {(status || wallet.error) && <p className="action-note error-note">{status || wallet.error}</p>}
      <p className="action-note"><ShieldCheck size={14}/> list/cancel/buy flow tested end-to-end on-chain (see DEPLOYMENT.md).</p>
    </div></section>
}

function DiscoverView({ setActive }: { setActive: (x: string) => void }) {
  const entries = [
    { symbol: 'CENTER', title: 'Center token', detail: 'New ecosystem asset · preview only', addr: CENTER_TOKEN, color: 'teal', action: 'Open Center', onClick: () => { window.location.assign('/center') } },
    { symbol: 'ORBIX', title: 'Legacy launchpad token', detail: 'Original ORBIX asset · keep distinct', addr: ADDRESSES.ORBIX, color: 'orange', action: 'Swap', onClick: () => setActive('Swap') },
    { symbol: 'FREE', title: 'Routing collateral', detail: 'Core liquidity route asset', addr: ADDRESSES.FREE, color: 'purple', action: 'Swap', onClick: () => setActive('Swap') },
  ]
  return <section className="action-page discover-page"><div className="eyebrow orange">COCKPIT / DISCOVER</div><h1>Know what<br/><i>you’re touching.</i></h1><p className="lead">A clear view of the assets that power Orbix. Preview assets are labelled; no funded liquidity is implied.</p><div className="discover-grid">{entries.map(e => <article className="panel discover-card" key={e.symbol}><div className={'token-icon '+e.color}>{e.symbol[0]}</div><div><span className="eyebrow">{e.symbol}</span><h2>{e.title}</h2><p>{e.detail}</p><code>{e.addr}</code></div><button className="secondary" onClick={e.onClick}>{e.action} <ArrowUpRight size={13}/></button></article>)}</div></section>
}

// ---------------- OVERVIEW (hero image cards → click into Swap/Bridge/Pools) ----------------
function OverviewView({ setActive, wallet }: { setActive: (x: string) => void; wallet: WalletState }) {
  const cards: { tab: string; img: string; title: string; sub: string }[] = [
    { tab: 'Swap', img: 'card-swap.jpg', title: 'Swap', sub: 'Smart-routed trades across every Orbix pool' },
    { tab: 'Bridge', img: 'card-bridge.jpg', title: 'Bridge', sub: 'RH ⇄ Sepolia ⇄ Arbitrum — canonical + LayerZero' },
    { tab: 'Pools', img: 'card-pools.jpg', title: 'Pools', sub: 'Provide liquidity, earn LP and staking yield' },
    { tab: 'Launch', img: 'card-launch.jpg', title: 'Launch', sub: 'Permissionless token launches with FREE collateral' },
  ]
  return <section className="action-page" style={{ maxWidth: 1100 }}>
    <div className="eyebrow orange">COCKPIT / OVERVIEW</div>
    <h1 style={{ fontSize: 38 }}>One cockpit.<br/><i>Everything connected.</i></h1>
    <p className="lead">Pick an action — every module shares the same liquidity, router and wallet.</p>
    <div className="ov-cards">
      <a className="ov-card ov-card-main" href="/center" onClick={(e)=>{e.preventDefault(); window.location.assign('/center')}}>
        <img src="card-center.jpg" alt="Orbix Center"/>
        <span className="ov-tag">MAIN PRODUCT</span>
        <span className="ov-go"><ArrowUpRight size={17}/></span>
        <div className="ov-body"><b>Orbix Center</b><span>Create a live game room, share a link and play together. 19 formats with preview points and claim codes; rewards are not funded on-chain.</span></div>
      </a>
      {cards.map(c => <div key={c.tab} className="ov-card" onClick={() => setActive(c.tab)}>
        <img src={c.img} alt={c.title}/>
        <span className="ov-go"><ArrowUpRight size={17}/></span>
        <div className="ov-body"><b>{c.title}</b><span>{c.sub}</span></div>
      </div>)}
    </div>
    <div className="launch-choice" style={{ marginTop: 14, maxWidth: 'none' }}>
      <article className="panel choice" style={{ minHeight: 0, padding: 18 }}>
        <div className="choice-number">LIVE</div><h2 style={{ fontSize: 16 }}>Protocol status</h2>
        <p style={{ minHeight: 0 }}>Launchpad, AMM, staking, NFT market and two bridge lanes are live on Robinhood testnet 46630. Wallet: {wallet.address ? `${wallet.address.slice(0,6)}…${wallet.address.slice(-4)}` : 'not connected'}.</p>
        <a href={explorerAddressUrl(ADDRESSES.REGISTRY)} target="_blank" rel="noreferrer"><button className="secondary full">Registry on explorer <ExternalLink size={13}/></button></a>
      </article>
      <article className="panel choice" style={{ minHeight: 0, padding: 18 }}>
        <div className="choice-number">DOCS</div><h2 style={{ fontSize: 16 }}>How routing works</h2>
        <p style={{ minHeight: 0 }}>The smart router scans every factory pair (including launchpad pools) and picks the best-rate path up to 3 hops — like Jumper, on-chain.</p>
        <button className="secondary full" onClick={() => setActive('Swap')}>Try the smart router <ArrowUpRight size={13}/></button>
      </article>
    </div>
  </section>
}


function Metric({label,value,foot,icon,muted}:{label:string,value:string,foot:string,icon:React.ReactNode,muted?:boolean}){return <article className={'metric '+(muted?'muted':'')}><div className="metric-label"><span>{icon}</span>{label}</div><strong>{value}</strong><small>{foot}</small></article>}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
