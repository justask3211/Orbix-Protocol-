import { PORTFOLIO_BANNERS } from './PortfolioBanners'
import { PORTFOLIO_GAMES } from './gamePortfolio'
// Per-game SVG artwork, one scene per template, drawn from each game's description.
// Pure inline SVG: no network fetches, crisp at any size, themeable via currentColor.

import type { ReactElement } from 'react'

export const TEMPLATE_META: Record<string, { blurb: string; hue: string }> = {
  ...Object.fromEntries(PORTFOLIO_GAMES.map(game=>[game.id,{blurb:game.description,hue:game.color}])),
  'number-hunt': { blurb: 'Crack the hidden number before your guesses run out.', hue: '#ff6b22' },
  'live-quiz': { blurb: 'Answer fast, answer right — the server holds the key.', hue: '#69d9c8' },
  'memory-match': { blurb: 'Flip, remember, match. Fewest moves wins.', hue: '#a4d46d' },
  'token-catch': { blurb: 'Catch falling tokens, dodge the hazards.', hue: '#ffb066' },
  'reaction-duel': { blurb: 'Commit your move, reveal, out-react your rival.', hue: '#c07bff' },
  'puzzle-sprint': { blurb: 'Solve the sliding puzzle against the clock.', hue: '#7fb2ff' },
  'hash-hunt': { blurb: 'Race the room to mine a valid hash.', hue: '#ffd166' },
  'boss-raid': { blurb: 'Team up, drain the boss, split the haul.', hue: '#ff5f5f' },
  'rps-duel': { blurb: 'Commit your move hash, reveal, beat your rival.', hue: '#c07bff' },
  'reward-grid': { blurb: 'Reveal tiles, hunt the hidden reward slots.', hue: '#ffd166' },
  'logo-bingo': { blurb: 'Shared calls, claim your line first.', hue: '#69d9c8' },
  'pattern-recall': { blurb: 'Repeat the growing sequence exactly.', hue: '#a4d46d' },
  'typing-sprint': { blurb: 'Type the pack, server-scored, no pasting.', hue: '#7fb2ff' },
  'maze-race': { blurb: 'First to the maze exit takes it.', hue: '#ffb066' },
  'level-runner': { blurb: 'Seeded obstacle lane, one crash ends it.', hue: '#ff6b22' },
  'contract-detective': { blurb: 'Spot the vulnerability in mock code.', hue: '#69d9c8' },
  'mev-rush': { blurb: 'Simulated queue race. Bots welcome.', hue: '#c07bff' },
  'idle-rig': { blurb: 'Upgrade the rig, server clock only.', hue: '#a4d46d' },
  'airdrop-quest': { blurb: 'Wallet-bound achievements, budget-capped.', hue: '#ffd166' },
}

const S = { width: '100%', height: '100%' } as const

function NumberHunt() {
  return (
    <svg viewBox="0 0 120 60" style={S} aria-hidden>
      <defs>
        <linearGradient id="nh-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2a1409" /><stop offset="1" stopColor="#120a05" />
        </linearGradient>
      </defs>
      <rect width="120" height="60" fill="url(#nh-g)" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x={14 + i * 24} y="18" width="18" height="24" rx="4"
            fill={i < 3 ? '#1c1008' : '#ff6b22'} stroke={i < 3 ? '#3a2c1c' : '#ffb066'} strokeWidth="1" />
          <text x={23 + i * 24} y="35" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="13"
            fontWeight="600" fill={i < 3 ? '#5c4a38' : '#140c06'}>
            {i < 3 ? '·' : '7'}
          </text>
        </g>
      ))}
      <text x="60" y="53" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="7" letterSpacing="2" fill="#8a6a4d">1111 – 9999</text>
    </svg>
  )
}

function LiveQuiz() {
  return (
    <svg viewBox="0 0 120 60" style={S} aria-hidden>
      <rect width="120" height="60" fill="#07211e" />
      <rect x="16" y="12" width="88" height="22" rx="5" fill="#0d302b" stroke="#1d4a43" />
      <text x="60" y="26" textAnchor="middle" fontFamily="Manrope, sans-serif" fontSize="9" fill="#bfeee6">Which chain is fastest?</text>
      {['A', 'B', 'C'].map((k, i) => (
        <g key={k}>
          <rect x={16 + i * 30} y="40" width="26" height="12" rx="3" fill={i === 1 ? '#69d9c8' : '#0d302b'}
            stroke={i === 1 ? '#69d9c8' : '#1d4a43'} />
          <text x={29 + i * 30} y="49" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="7"
            fill={i === 1 ? '#07211e' : '#6fa39b'}>{k}</text>
        </g>
      ))}
      <rect x="16" y="8" width="60" height="2" rx="1" fill="#69d9c8" opacity=".7" />
    </svg>
  )
}

function MemoryMatch() {
  const cols = ['#a4d46d', '#5c7a3a', '#a4d46d', '#5c7a3a', '#5c7a3a', '#a4d46d']
  const glyph = ['◆', '?', '◆', '?', '?', '◆']
  return (
    <svg viewBox="0 0 120 60" style={S} aria-hidden>
      <rect width="120" height="60" fill="#0d1408" />
      {cols.map((c, i) => {
        const x = 20 + (i % 3) * 28, y = 12 + Math.floor(i / 3) * 24
        const up = glyph[i] !== '?'
        return (
          <g key={i}>
            <rect x={x} y={y} width="22" height="18" rx="4" fill={up ? '#16220f' : '#131a10'} stroke={up ? c : '#2a3320'} />
            <text x={x + 11} y={y + 13} textAnchor="middle" fontSize="10" fill={up ? c : '#3a442f'}>{glyph[i]}</text>
          </g>
        )
      })}
      <text x="60" y="55" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="6.5" letterSpacing="2" fill="#5c7a3a">6 PAIRS · FEWEST MOVES</text>
    </svg>
  )
}

function TokenCatch() {
  return (
    <svg viewBox="0 0 120 60" style={S} aria-hidden>
      <rect width="120" height="60" fill="#1b0f05" />
      {[0, 1, 2].map((l) => (
        <line key={l} x1={30 + l * 30} y1="6" x2={30 + l * 30} y2="54" stroke="#3a2c1c" strokeDasharray="3 4" />
      ))}
      <circle cx="45" cy="20" r="7" fill="#132015" stroke="#a4d46d" />
      <text x="45" y="23" textAnchor="middle" fontSize="7" fill="#a4d46d" fontFamily="DM Mono, monospace">T</text>
      <circle cx="90" cy="34" r="7" fill="#200f0f" stroke="#ff5f5f" />
      <text x="90" y="37" textAnchor="middle" fontSize="8" fill="#ff5f5f">✕</text>
      <circle cx="60" cy="46" r="7" fill="#132015" stroke="#a4d46d" />
      <text x="60" y="49" textAnchor="middle" fontSize="7" fill="#a4d46d" fontFamily="DM Mono, monospace">T</text>
      <path d="M 28 54 L 92 54" stroke="#ffb066" strokeWidth="2" strokeLinecap="round" />
      <path d="M 56 50 l 4 4 l 4 -4" stroke="#ffb066" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function ReactionDuel() {
  return (
    <svg viewBox="0 0 120 60" style={S} aria-hidden>
      <rect width="120" height="60" fill="#150b20" />
      <rect x="14" y="14" width="40" height="32" rx="6" fill="#1d1129" stroke="#c07bff" />
      <rect x="66" y="14" width="40" height="32" rx="6" fill="#1d1129" stroke="#4a3a5c" />
      <text x="34" y="35" textAnchor="middle" fontSize="13" fill="#c07bff">✊</text>
      <text x="86" y="35" textAnchor="middle" fontSize="13" fill="#6a5a7c">?…</text>
      <text x="60" y="33" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="8" fill="#8a7a9c">VS</text>
      <text x="60" y="55" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="6.5" letterSpacing="2" fill="#8a7a9c">COMMIT · REVEAL</text>
    </svg>
  )
}

function PuzzleSprint() {
  const tiles = [2, 8, 1, 0, 4, 3, 7, 6, 5]
  return (
    <svg viewBox="0 0 120 60" style={S} aria-hidden>
      <rect width="120" height="60" fill="#0a1220" />
      {tiles.map((t, i) => {
        const x = 33 + (i % 3) * 19, y = 6 + Math.floor(i / 3) * 16
        return t === 0 ? (
          <rect key={i} x={x} y={y} width="16" height="13" rx="3" fill="none" stroke="#243247" strokeDasharray="2 3" />
        ) : (
          <g key={i}>
            <rect x={x} y={y} width="16" height="13" rx="3" fill="#122033" stroke={t === 1 ? '#7fb2ff' : '#243247'} />
            <text x={x + 8} y={y + 10} textAnchor="middle" fontSize="8" fontFamily="DM Mono, monospace"
              fill={t === 1 ? '#7fb2ff' : '#5c7a9c'}>{t}</text>
          </g>
        )
      })}
      <text x="60" y="56" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="6.5" letterSpacing="2" fill="#3c6fbf">SOLVE · 3×3</text>
    </svg>
  )
}

function HashHunt() {
  return (
    <svg viewBox="0 0 120 60" style={S} aria-hidden>
      <rect width="120" height="60" fill="#1d1706" />
      {['9f…c2', '00…1a', 'ab…77'].map((_h, i) => (
        <text key={i} x={18} y={16 + i * 12} fontFamily="DM Mono, monospace" fontSize="7"
          fill={i === 1 ? '#ffd166' : '#6a5c2a'}>{i === 1 ? '0000ab12… ✓' : '9f3ec2a1…'}</text>
      ))}
      <path d="M 88 12 l 6 6 l -10 10" stroke="#ffd166" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="84" y="36" width="24" height="8" rx="4" fill="#241c08" stroke="#6a5c2a" />
      <text x="96" y="42.5" textAnchor="middle" fontSize="6" fontFamily="DM Mono, monospace" fill="#ffd166">MINE</text>
      <text x="60" y="55" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="6.5" letterSpacing="2" fill="#8a7433">KECCAK RACE</text>
    </svg>
  )
}

function BossRaid() {
  return (
    <svg viewBox="0 0 120 60" style={S} aria-hidden>
      <rect width="120" height="60" fill="#1c0808" />
      <path d="M 60 8 L 74 22 L 70 40 L 50 40 L 46 22 Z" fill="#2b0f0f" stroke="#ff5f5f" />
      <circle cx="55" cy="20" r="2.4" fill="#ff8a6a" />
      <circle cx="65" cy="20" r="2.4" fill="#ff8a6a" />
      <rect x="24" y="46" width="72" height="6" rx="3" fill="#160707" />
      <rect x="24" y="46" width="28" height="6" rx="3" fill="url(#boss-grad)" />
      <defs>
        <linearGradient id="boss-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7d2b2b" /><stop offset="1" stopColor="#ff5f5f" />
        </linearGradient>
      </defs>
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={32 + i * 28} cy="30" r="4" fill="#132015" stroke="#a4d46d" />
      ))}
      <text x="60" y="13" textAnchor="middle" fontSize="6" fontFamily="DM Mono, monospace" fill="#8a4a3a">HP 72%</text>
    </svg>
  )
}


function RpsDuel() {
  return (
    <svg viewBox="0 0 120 60" style={S} aria-hidden>
      <rect width="120" height="60" fill="#150b20" />
      <rect x="16" y="16" width="26" height="26" rx="5" fill="#1d1129" stroke="#c07bff" />
      <rect x="78" y="16" width="26" height="26" rx="5" fill="#1d1129" stroke="#4a3a5c" />
      <text x="29" y="34" textAnchor="middle" fontSize="12" fill="#c07bff">🔒</text>
      <text x="91" y="34" textAnchor="middle" fontSize="12" fill="#6a5a7c">?</text>
      <text x="60" y="34" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="8" fill="#8a7a9c">KECCAK</text>
      <text x="60" y="55" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="6.5" letterSpacing="2" fill="#8a7a9c">COMMIT · REVEAL</text>
    </svg>
  )
}

function RewardGrid() {
  const hot = new Set([5, 12, 22])
  return (
    <svg viewBox="0 0 120 60" style={S} aria-hidden>
      <rect width="120" height="60" fill="#1d1706" />
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x={20 + (i % 4) * 20} y={8 + Math.floor(i / 4) * 16} width="15" height="12" rx="3"
          fill={hot.has(i) ? '#241c08' : '#141208'} stroke={hot.has(i) ? '#ffd166' : '#3a3212'} />
      ))}
      <text x="60" y="56" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="6.5" letterSpacing="2" fill="#8a7433">3 SLOTS HIDDEN</text>
    </svg>
  )
}

function LogoBingo() {
  const marks = new Set([0, 1, 4, 6])
  return (
    <svg viewBox="0 0 120 60" style={S} aria-hidden>
      <rect width="120" height="60" fill="#07211e" />
      {Array.from({ length: 9 }, (_, i) => (
        <rect key={i} x={33 + (i % 3) * 19} y={7 + Math.floor(i / 3) * 15} width="15" height="12" rx="3"
          fill={marks.has(i) ? '#0d302b' : '#0a1a17'} stroke={marks.has(i) ? '#69d9c8' : '#1d4a43'} />
      ))}
      <text x="60" y="56" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="6.5" letterSpacing="2" fill="#3b8f84">LINE WINS</text>
    </svg>
  )
}

function PatternRecall() {
  const seq = [2, 0, 3, 1, 4]
  return (
    <svg viewBox="0 0 120 60" style={S} aria-hidden>
      <rect width="120" height="60" fill="#0d1408" />
      {seq.map((_v, i) => (
        <circle key={i} cx={26 + i * 17} cy="28" r="9" fill={i < 3 ? '#16220f' : '#0f1608'}
          stroke={i < 3 ? '#a4d46d' : '#2a3320'} />
      ))}
      <text x="60" y="52" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="6.5" letterSpacing="2" fill="#5c7a3a">REPEAT IT EXACTLY</text>
    </svg>
  )
}

function TypingSprint() {
  return (
    <svg viewBox="0 0 120 60" style={S} aria-hidden>
      <rect width="120" height="60" fill="#0a1220" />
      <rect x="22" y="34" width="76" height="12" rx="3" fill="#122033" stroke="#243247" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} x={28 + i * 11} y={22} width="8" height="8" rx="2" fill={i < 4 ? '#1d3050' : '#141f30'} stroke="#243247" />
      ))}
      <text x="60" y="17" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="8" fill="#7fb2ff">120 wpm</text>
      <text x="60" y="55" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="6.5" letterSpacing="2" fill="#3c6fbf">SERVER SCORED</text>
    </svg>
  )
}

function MazeRace() {
  return (
    <svg viewBox="0 0 120 60" style={S} aria-hidden>
      <rect width="120" height="60" fill="#1b0f05" />
      <path d="M 24 10 h 72 v 40 h -72 z M 34 10 v 12 h 24 M 68 22 h 18 v 14 h -30 M 44 36 h 14 v 14"
        stroke="#3a2c1c" strokeWidth="3" fill="none" strokeLinecap="square" />
      <circle cx="29" cy="15" r="4" fill="#132015" stroke="#a4d46d" />
      <circle cx="91" cy="45" r="4" fill="#200f0f" stroke="#ff6b22" />
      <text x="60" y="56" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="6.5" letterSpacing="2" fill="#8a6a4d">FIRST OUT WINS</text>
    </svg>
  )
}

function LevelRunner() {
  return (
    <svg viewBox="0 0 120 60" style={S} aria-hidden>
      <rect width="120" height="60" fill="#1b0f05" />
      {[0, 1, 2].map((l) => (
        <line key={l} x1="24" y1={14 + l * 16} x2="96" y2={14 + l * 16} stroke="#3a2c1c" strokeDasharray="3 4" />
      ))}
      <rect x="34" y="10" width="10" height="10" fill="#200f0f" stroke="#ff5f5f" rx="2" />
      <rect x="64" y="42" width="10" height="10" fill="#200f0f" stroke="#ff5f5f" rx="2" />
      <circle cx="52" cy="30" r="6" fill="#132015" stroke="#ffb066" />
      <text x="60" y="57" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="6.5" letterSpacing="2" fill="#8a6a4d">DON'T CRASH</text>
    </svg>
  )
}

function ContractDetective() {
  return (
    <svg viewBox="0 0 120 60" style={S} aria-hidden>
      <rect width="120" height="60" fill="#07211e" />
      {['function withdraw() {', '  call.value(amt)("");', '  balances[msg.sender] = 0;'].map((l, i) => (
        <text key={i} x={16} y={16 + i * 11} fontFamily="DM Mono, monospace" fontSize="6.5" fill={i === 1 ? '#ff8a6a' : '#6fa39b'}>{l}</text>
      ))}
      <text x="60" y="54" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="6.5" letterSpacing="2" fill="#3b8f84">FIND THE BUG</text>
    </svg>
  )
}

function MevRush() {
  return (
    <svg viewBox="0 0 120 60" style={S} aria-hidden>
      <rect width="120" height="60" fill="#150b20" />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={18} y={12 + i * 13} width="70" height="9" rx="3" fill="#1d1129" stroke={i === 0 ? '#c07bff' : '#4a3a5c'} />
          <text x={24} y={19 + i * 13} fontFamily="DM Mono, monospace" fontSize="6" fill={i === 0 ? '#c07bff' : '#6a5a7c'}>tx 0x{(i + 3).toString(16)}…a{ i }f</text>
        </g>
      ))}
      <text x="60" y="55" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="6.5" letterSpacing="2" fill="#8a7a9c">SIMULATED QUEUE</text>
    </svg>
  )
}

function IdleRig() {
  return (
    <svg viewBox="0 0 120 60" style={S} aria-hidden>
      <rect width="120" height="60" fill="#0d1408" />
      {[1, 2, 3, 4].map((t) => (
        <rect key={t} x={26 + (t - 1) * 18} y={40 - t * 7} width="12" height={8 + t * 7} rx="2"
          fill={t <= 2 ? '#16220f' : '#0f1608'} stroke={t <= 2 ? '#a4d46d' : '#2a3320'} />
      ))}
      <text x="60" y="16" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="8" fill="#a4d46d">LVL 2 → 3</text>
      <text x="60" y="56" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="6.5" letterSpacing="2" fill="#5c7a3a">SERVER CLOCK ONLY</text>
    </svg>
  )
}

function AirdropQuest() {
  return (
    <svg viewBox="0 0 120 60" style={S} aria-hidden>
      <rect width="120" height="60" fill="#1d1706" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <circle cx={30 + i * 20} cy="26" r="8" fill={i < 2 ? '#241c08' : '#141208'} stroke={i < 2 ? '#ffd166' : '#3a3212'} />
          <text x={30 + i * 20} y="29" textAnchor="middle" fontSize="7" fill={i < 2 ? '#ffd166' : '#3a3212'}>{i < 2 ? '✓' : ''}</text>
        </g>
      ))}
      <text x="60" y="50" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="6.5" letterSpacing="2" fill="#8a7433">WALLET-BOUND</text>
    </svg>
  )
}

const ART: Record<string, () => ReactElement> = {
  ...PORTFOLIO_BANNERS,
  'number-hunt': NumberHunt,
  'live-quiz': LiveQuiz,
  'memory-match': MemoryMatch,
  'token-catch': TokenCatch,
  'reaction-duel': ReactionDuel,
  'puzzle-sprint': PuzzleSprint,
  'hash-hunt': HashHunt,
  'boss-raid': BossRaid,
  'rps-duel': RpsDuel,
  'reward-grid': RewardGrid,
  'logo-bingo': LogoBingo,
  'pattern-recall': PatternRecall,
  'typing-sprint': TypingSprint,
  'maze-race': MazeRace,
  'level-runner': LevelRunner,
  'contract-detective': ContractDetective,
  'mev-rush': MevRush,
  'idle-rig': IdleRig,
  'airdrop-quest': AirdropQuest,
}

export function GameArt({ templateId }: { templateId: string }) {
  const Art = ART[templateId]
  if (!Art) return <div className="ct-card-art" aria-hidden />
  return (
    <div className={`ct-art t-${templateId}`} aria-hidden>
      <Art />
    </div>
  )
}
