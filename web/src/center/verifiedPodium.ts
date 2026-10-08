import type { PodiumWinner } from './WinnerCelebration'

type ScoreRow = { who: string; score: number; rank?: number; eligible?: boolean }
type Result = { results: ScoreRow[]; allocations?: { winner: string }[]; finalPlacements?: ScoreRow[] }
type Input = {
  templateId: string
  settlement: Result | null | undefined
  state: Record<string, any>
  players?: string[]
  profiles?: Record<string, { name?: string; hasImage?: boolean }>
  characters?: Record<string, string>
}
const positiveRank = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1

/** Never infer an objective win from a display score such as Number Hunt's unused guesses. */
export function verifiedPodium({ templateId, settlement, state, players = [], profiles = {}, characters = {} }: Input): PodiumWinner[] {
  if (!settlement) return []
  const rows = settlement.finalPlacements ?? settlement.results ?? [], explicit = settlement.finalPlacements !== undefined || rows.some(row => typeof row.eligible === 'boolean')
  const rewarded = new Set((settlement.allocations ?? []).map(row => row.winner))
  let eligible: ScoreRow[]
  if (explicit) eligible = rows.filter(row => settlement.finalPlacements !== undefined ? row.eligible !== false : row.eligible === true)
  else if (templateId === 'number-hunt') {
    const found = new Set<string>((state.guessLog ?? []).filter((guess: any) => guess.hit === true && typeof guess.who === 'string').map((guess: any) => guess.who))
    eligible = rows.filter(row => found.has(row.who) || rewarded.has(row.who))
  } else if (templateId === 'reaction-duel') {
    const maximum = Math.max(0, ...rows.map(row => Number.isFinite(row.score) ? row.score : 0)), leaders = rows.filter(row => row.score === maximum)
    eligible = maximum > 0 && leaders.length === 1 ? leaders : []
  } else if (templateId === 'combat-duel') eligible = typeof state.winner === 'string' ? rows.filter(row => row.who === state.winner) : rows.filter(row => rewarded.has(row.who))
  else eligible = rows.filter(row => rewarded.has(row.who)) // Older servers: an allocation is evidence; a positive score alone is not.
  const eligibleSet = new Set(eligible.map(row => row.who))
  if (templateId === 'boss-raid' && Array.isArray(state.teamRankings)) {
    return state.teamRankings.filter((team: any) => team.eligible === true && positiveRank(team.rank) && team.rank <= 3 && eligible.some(row => state.teams?.[row.who] === team.team)).slice(0, 3).map((team: any) => {
      const representative = eligible.find(row => state.teams?.[row.who] === team.team)?.who || players.find(who => eligibleSet.has(who) && state.teams?.[who] === team.team) || String(team.team)
      return { wallet: representative, teamName: `Crew ${String(team.team).replace('team-', '')}`, score: team.damage, rank: team.rank, character: state.bodies?.[representative]?.character || characters[representative] }
    })
  }
  const seen = new Set<string>(), podium: PodiumWinner[] = []
  for (const row of eligible) {
    if (seen.has(row.who)) continue
    seen.add(row.who)
    const rank = positiveRank(row.rank) ? row.rank : rows.findIndex(other => other.who === row.who) + 1
    if (!positiveRank(rank) || rank > 3) continue
    podium.push({ wallet: row.who, name: profiles[row.who]?.name || undefined, avatar: profiles[row.who]?.hasImage ? `/api/center/v1/profile/image/${row.who}` : undefined, rank, score: row.score, character: state.bodies?.[row.who]?.character || characters[row.who] })
  }
  return podium.sort((left, right) => left.rank - right.rank).slice(0, 3)
}
