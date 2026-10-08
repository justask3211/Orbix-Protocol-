/** Presentation uses the server's final ranks, including players outside the podium. */
export function localPlacement(results: { who: string; rank?: number }[], me: string, teams?: Record<string, string>, rankings?: { team: string; rank: number }[]): number | undefined {
  const crew = teams?.[me.toLowerCase()]
  const rank = crew && rankings ? rankings.find(row => row.team === crew)?.rank : results.find(row => row.who.toLowerCase() === me.toLowerCase())?.rank
  return typeof rank === 'number' && Number.isInteger(rank) && rank >= 1 ? rank : undefined
}
export function celebrationTitle(winner: string, placement?: number): string {
  return placement && placement > 1 ? `You placed #${placement}` : `Congratulations, ${winner}!`
}
