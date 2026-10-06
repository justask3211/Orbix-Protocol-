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
    instructions: 'Everyone attacks the same boss. Time your hits around the cooldown and watch your contribution. This version is cooperative; competing teams of three are coming in the gameplay update.',
  },
  {
    id: 'token-catch', name: 'Token Catch', category: 'Arcade', mode: 'Catch & dodge',
    color: '#95e7ef', ink: '#16434e',
    description: 'Choose your lane, catch the good stuff, and steer clear of trouble.',
    instructions: 'Move between lanes and catch tokens as they arrive. Hazards reduce your score. Collected objects are game points; a room’s reward is shown separately before entry.',
  },
  {
    id: 'reaction-duel', name: 'Duel', category: '1 vs 1', mode: 'Choose. Lock. Reveal.',
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
