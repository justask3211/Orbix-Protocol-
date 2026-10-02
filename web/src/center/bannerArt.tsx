/**
 * Generated banner art for every game format.
 *
 * Design read (tasteskill): the catalog is a "premium consumer" surface for a
 * dark-tech brand. Each card gets a distinct generative scene in its own hue,
 * drawn as pure SVG (crisp, zero network, themeable). Composition varies per
 * game family — not one template with a hue swap — so the grid reads as a
 * lineup of different worlds, not a spreadsheet.
 */

type SceneProps = { hue: string; seed: number }
type ReactElement = import('react').ReactElement

function mulberry(seed: number) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function hashId(id: string): number {
  let h = 7
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}

const W = 420
const H = 150

/** chase / falling-field family: token-catch, level-runner */
function FallingField({ hue, seed }: SceneProps) {
  const rnd = mulberry(seed)
  const items = Array.from({ length: 16 }, (_, i) => ({
    x: 18 + rnd() * (W - 40),
    y: 14 + ((i * 9 + rnd() * 30) % (H - 30)),
    r: 3 + rnd() * 6,
    o: 0.25 + rnd() * 0.6,
    square: rnd() > 0.72,
  }))
  return (
    <svg className="gcard-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width={W} height={H} fill="#0a0b0d" />
      {Array.from({ length: 5 }, (_, i) => (
        <line key={i} x1={30 + i * ((W - 60) / 4)} y1="0" x2={30 + i * ((W - 60) / 4)} y2={H} stroke={hue} strokeOpacity="0.06" />
      ))}
      {items.map((it, i) =>
        it.square ? (
          <rect key={i} x={it.x} y={it.y} width={it.r * 2} height={it.r * 2} rx="2" fill={it.o > 0.75 ? '#ff5f5f' : hue} opacity={it.o} />
        ) : (
          <circle key={i} cx={it.x} cy={it.y} r={it.r} fill={hue} opacity={it.o} />
        ),
      )}
      <path d={`M0 ${H - 14} Q ${W / 2} ${H - 26} ${W} ${H - 14}`} stroke={hue} strokeWidth="2" fill="none" strokeOpacity="0.5" />
    </svg>
  )
}

/** duel / versus family: reaction-duel, rps-duel */
function VersusScene({ hue }: SceneProps) {
  return (
    <svg className="gcard-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={`vs-${hue.slice(1)}`} x1="0" x2="1">
          <stop offset="0" stopColor={hue} stopOpacity="0.16" />
          <stop offset="0.5" stopColor="#0a0b0d" />
          <stop offset="1" stopColor={hue} stopOpacity="0.16" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="#0a0b0d" />
      <rect width={W} height={H} fill={`url(#vs-${hue.slice(1)})`} />
      <line x1={W / 2} y1="10" x2={W / 2} y2={H - 10} stroke="#fff" strokeOpacity="0.14" strokeDasharray="3 7" />
      <circle cx={W / 2 - 74} cy={H / 2} r="34" fill="none" stroke={hue} strokeWidth="1.5" strokeOpacity="0.85" />
      <circle cx={W / 2 + 74} cy={H / 2} r="34" fill="none" stroke="#e9e7e2" strokeWidth="1.5" strokeOpacity="0.5" />
      <text x={W / 2 - 74} y={H / 2 + 6} textAnchor="middle" fill={hue} fontSize="22" fontFamily="'DM Mono',monospace">?</text>
      <text x={W / 2 + 74} y={H / 2 + 6} textAnchor="middle" fill="#e9e7e2" fontSize="22" fontFamily="'DM Mono',monospace" opacity="0.6">?</text>
      <text x={W / 2} y={H / 2 - 12} textAnchor="middle" fill="#85888d" fontSize="9" fontFamily="'DM Mono',monospace" letterSpacing="3">VS</text>
      <text x={W / 2} y={H / 2 + 22} textAnchor="middle" fill={hue} fontSize="8.5" fontFamily="'DM Mono',monospace" letterSpacing="2" opacity="0.8">COMMIT·REVEAL</text>
    </svg>
  )
}

/** grid / board family: reward-grid, logo-bingo, memory-match */
function GridScene({ hue, seed }: SceneProps) {
  const rnd = mulberry(seed)
  const cols = 9
  const size = 34
  const hidden = new Set(Array.from({ length: 3 }, () => Math.floor(rnd() * cols * 3)))
  return (
    <svg className="gcard-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width={W} height={H} fill="#0a0b0d" />
      {Array.from({ length: cols * 3 }, (_, i) => {
        const x = (i % cols) * (size + 8) + 12
        const y = Math.floor(i / cols) * (size / 1.55) + 8
        const isHidden = hidden.has(i)
        return (
          <rect key={i} x={x} y={y} width={size} height={size / 1.55} rx="5"
            fill={isHidden ? hue : '#15171a'} fillOpacity={isHidden ? 0.75 : 1}
            stroke={isHidden ? hue : '#26292c'} strokeOpacity={isHidden ? 0.9 : 1} />
        )
      })}
    </svg>
  )
}

/** mining / proof family: hash-hunt */
function HashScene({ hue }: SceneProps) {
  const rnd = mulberry(hashId('hash'))
  return (
    <svg className="gcard-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width={W} height={H} fill="#0a0b0d" />
      {Array.from({ length: 9 }, (_, i) => (
        <text key={i} x={10} y={20 + i * 15} fill={i === 2 ? hue : '#3a3d41'}
          fontSize="10" fontFamily="'DM Mono',monospace" opacity={i === 2 ? 1 : 0.7}>
          0x{Array.from({ length: 10 }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('')}…
        </text>
      ))}
      <text x={W - 12} y={H / 2 + 4} textAnchor="end" fill={hue} fontSize="10" fontFamily="'DM Mono',monospace" letterSpacing="2">✓ VALID</text>
    </svg>
  )
}

/** raid / co-op family: boss-raid */
function BossScene({ hue }: SceneProps) {
  return (
    <svg className="gcard-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width={W} height={H} fill="#0a0b0d" />
      <polygon points={`${W / 2},14 ${W / 2 + 66},58 ${W / 2 + 42},${H - 18} ${W / 2 - 42},${H - 18} ${W / 2 - 66},58`}
        fill="none" stroke={hue} strokeWidth="1.5" strokeOpacity="0.85" />
      <polygon points={`${W / 2},30 ${W / 2 + 48},62 ${W / 2 + 30},${H - 28} ${W / 2 - 30},${H - 28} ${W / 2 - 48},62`}
        fill={hue} fillOpacity="0.12" stroke={hue} strokeOpacity="0.4" />
      <circle cx={W / 2} cy={H / 2 - 8} r="12" fill={hue} fillOpacity="0.9" />
      <rect x={W / 2 - 80} y="18" width="160" height="7" rx="3.5" fill="#15171a" />
      <rect x={W / 2 - 80} y="18" width="102" height="7" rx="3.5" fill={hue} />
      <text x={W / 2 + 84} y="25" fill="#85888d" fontSize="9" fontFamily="'DM Mono',monospace">HP 72%</text>
    </svg>
  )
}

/** sprint / path family: puzzle-sprint, maze-race, pattern-recall */
function PathScene({ hue, seed }: SceneProps) {
  const rnd = mulberry(seed)
  const pts = Array.from({ length: 6 }, (_, i) => `${20 + i * ((W - 60) / 5)},${30 + rnd() * (H - 70)}`)
  return (
    <svg className="gcard-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width={W} height={H} fill="#0a0b0d" />
      <polyline points={pts.join(' ')} fill="none" stroke={hue} strokeWidth="1.5" strokeOpacity="0.7" strokeDasharray="6 5" />
      {pts.map((p, i) => {
        const [x, y] = p.split(',').map(Number)
        return <circle key={i} cx={x} cy={y} r={i === 5 ? 6 : 3.5} fill={i === 5 ? hue : '#15171a'} stroke={hue} strokeWidth="1.2" />
      })}
      <text x={W - 14} y={H - 16} textAnchor="end" fill={hue} fontSize="9" fontFamily="'DM Mono',monospace" letterSpacing="2" opacity="0.9">GOAL</text>
    </svg>
  )
}

/** number / quiz family: number-hunt, live-quiz */
function TargetScene({ hue, seed }: SceneProps) {
  const rnd = mulberry(seed)
  return (
    <svg className="gcard-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width={W} height={H} fill="#0a0b0d" />
      {[52, 38, 24, 10].map((r, i) => (
        <circle key={i} cx={W / 2} cy={H / 2} r={r + 6} fill="none" stroke={hue} strokeWidth="1" strokeOpacity={0.14 + i * 0.1} />
      ))}
      <text x={W / 2} y={H / 2 + 5} textAnchor="middle" fill={hue} fontSize="15" fontFamily="'DM Mono',monospace">4·8·2·1</text>
      {Array.from({ length: 5 }, (_, i) => (
        <text key={i} x={20 + i * 90 + rnd() * 20} y={26 + rnd() * 20} fill="#3a3d41" fontSize="9" fontFamily="'DM Mono',monospace">
          {Math.floor(1000 + rnd() * 8999)}
        </text>
      ))}
      <text x={W - 14} y={H - 16} textAnchor="end" fill="#a4d46d" fontSize="9" fontFamily="'DM Mono',monospace" letterSpacing="1">SERVER HOLDS THE KEY</text>
    </svg>
  )
}

/** quest / progress family: airdrop-quest, idle-rig, typing-sprint */
function QuestScene({ hue, seed }: SceneProps) {
  const rnd = mulberry(seed)
  return (
    <svg className="gcard-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width={W} height={H} fill="#0a0b0d" />
      {Array.from({ length: 4 }, (_, i) => (
        <g key={i}>
          <rect x={16 + i * 104} y={H / 2 - 16} width={88} height={32} rx="8" fill="#15171a" stroke={i < 2 ? hue : '#26292c'} strokeOpacity={i < 2 ? 0.9 : 1} />
          <text x={16 + i * 104 + 44} y={H / 2 + 4} textAnchor="middle" fill={i < 2 ? hue : '#5a5d61'} fontSize="12" fontFamily="'DM Mono',monospace">
            {i < 2 ? '✓' : '○'}
          </text>
        </g>
      ))}
      <rect x={16} y={H - 22} width={W - 32} height="6" rx="3" fill="#15171a" />
      <rect x={16} y={H - 22} width={(W - 32) * (0.35 + rnd() * 0.4)} height="6" rx="3" fill={hue} fillOpacity="0.8" />
    </svg>
  )
}

const SCENES: Record<string, (p: SceneProps) => ReactElement> = {
  'number-hunt': TargetScene,
  'live-quiz': TargetScene,
  'memory-match': GridScene,
  'token-catch': FallingField,
  'reaction-duel': VersusScene,
  'puzzle-sprint': PathScene,
  'hash-hunt': HashScene,
  'boss-raid': BossScene,
  'rps-duel': VersusScene,
  'reward-grid': GridScene,
  'logo-bingo': GridScene,
  'pattern-recall': PathScene,
  'typing-sprint': QuestScene,
  'maze-race': PathScene,
  'level-runner': FallingField,
  'contract-detective': HashScene,
  'mev-rush': HashScene,
  'idle-rig': QuestScene,
  'airdrop-quest': QuestScene,
}

export function GameBanner({ templateId, hue }: { templateId: string; hue: string }) {
  const Scene = SCENES[templateId] ?? TargetScene
  return <Scene hue={hue} seed={hashId(templateId)} />
}

export { W as BANNER_W, H as BANNER_H }
