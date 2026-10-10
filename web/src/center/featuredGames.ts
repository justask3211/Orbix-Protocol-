import { PORTFOLIO_GAMES } from './gamePortfolio'
/** The current player-facing lineup. Engine availability still comes from the API. */
export const FEATURED_GAMES = [
  ...PORTFOLIO_GAMES,
  {
    id: 'number-hunt', name: 'Number Hunt', category: 'Brain game', mode: 'Guess & discover',
    color: '#e0f77c', ink: '#25391d',
    description: 'A hidden number. A handful of guesses. Make every one count.',
    instructions: 'Pick a number within the room’s range. Each guess uses your budget; find a hidden target before your guesses run out. The host chooses the range and round rules.',
  },
  {
    id: 'boss-raid', name: 'Co-op Boss Raid', category: 'Co-op', mode: 'Team up',
    color: '#bcb2ff', ink: '#34246f',
    description: 'Bring your crew. Take on one big boss. Put your damage on the board.',
    instructions: 'Choose a crew of 2–5 players. Start with equal guns, move and jump to dodge the guardian’s attacks, then collect upgrades as its health falls. Crews rank by damage; the host chooses prizes for the first one, two or three crews. Tied positions share their allocated prizes. Check the member split and contribution requirement before entry.',
  },
  {
    id: 'token-catch', name: 'Token Catch', category: 'Arcade', mode: 'Catch & dodge',
    color: '#95e7ef', ink: '#16434e',
    description: 'Race to supply drops. Open shared loot, outplay rivals, and bring your share home.',
    instructions: 'Run and jump with a third-person character or switch to first person. Open a landed airdrop within reach, then click individual shared loot piles. Bombs scatter half your coins; punches stun and guns temporarily knock out rivals. The host sets the total pool, drop count and pile size. Preview loot is game score; funded rewards and claims are separate.',
  },
  {
    id: 'combat-duel', name: 'Arena Duel', category: '1 vs 1', mode: 'Move. Guard. Strike.',
    color: '#ffab98', ink: '#63281f',
    description: 'One small arena. Two fighters. Find your weapon and land the knockout.',
    instructions: 'Move with WASD or the joystick, drag to look and aim, and switch between first- and third-person views. Jump, dodge, guard, and chain light attacks, heavy strikes and kicks. Loot swords, spears and shields. Win by knockout or finish with more health after dealing damage; a draw awards nobody.',
  },
  {
    id: 'reaction-duel', name: 'Rock Paper Scissors Duel', category: '1 vs 1', mode: 'Choose. Lock. Reveal.',
    color: '#ffab98', ink: '#63281f',
    description: 'You and one rival. Lock in your choice. Let the reveal decide.',
    instructions: 'Play rock, paper, scissors against another player. Both players lock a choice before revealing it. Win the majority of the room’s configured rounds.',
  },
] as const

export type FeaturedGameId = typeof FEATURED_GAMES[number]['id']
export const FEATURED_GAME_IDS: readonly string[] = FEATURED_GAMES.map((game) => game.id)
export function isFeaturedGame(id: string): id is FeaturedGameId {
  return FEATURED_GAME_IDS.includes(id)
}

export const REALTIME_GAMES = new Set(['token-catch','boss-raid','combat-duel'])
export function gamePlacement(id:string): 'featured'|'more' {return REALTIME_GAMES.has(id)?'more':'featured'}
export const RELEASED_GAME_IDS:readonly string[]=[...FEATURED_GAME_IDS,'rps-duel','hash-hunt','reward-grid','logo-bingo','maze-race','contract-detective','mev-rush','airdrop-quest']
export const isReleasedGame=(id:string)=>RELEASED_GAME_IDS.includes(id)
