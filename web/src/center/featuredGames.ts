/** The current player-facing lineup. Engine availability still comes from the API. */
export const FEATURED_GAMES = [
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
    instructions: 'Choose a crew of 2–5 players or let the lobby assign teams. Move, find weapons, break crates and fight the crystal boss. The team with most damage wins; a tied lead awards nobody. Reward slots and minimum contribution are shown before entry.',
  },
  {
    id: 'token-catch', name: 'Token Catch', category: 'Arcade', mode: 'Catch & dodge',
    color: '#95e7ef', ink: '#16434e',
    description: 'Roam a sunny park. Scoop up coins, find powers, and dodge falling bombs.',
    instructions: 'Move with WASD, arrows or touch. Collect landed coins and push power-ups. Push rivals away; bombs scatter half your collected coins for everyone to pick up. Collected coins are score; funded rewards are shown separately before entry.',
  },
  {
    id: 'combat-duel', name: 'Arena Duel', category: '1 vs 1', mode: 'Move. Guard. Strike.',
    color: '#ffab98', ink: '#63281f',
    description: 'One small arena. Two fighters. Find your weapon and land the knockout.',
    instructions: 'Move with WASD or arrows. Aim toward your rival, strike with Space or tap, hold Shift to guard, and break crates with E. Collect swords, spears and shields. Win by knockout, or finish with more health after dealing damage; a draw awards nobody.',
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
