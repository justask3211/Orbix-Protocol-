/** Current authority sends full body maps. Explicit deltas require a matching baseline. */
export function applyWorldPatch(previous: Record<string, any> | null, patch: Record<string, any>): Record<string, any> | null {
  if (previous && typeof patch.serverTimeMs === 'number' && patch.serverTimeMs < Number(previous.serverTimeMs ?? 0)) return previous
  if (patch.delta === true) {
    if (!previous || patch.baseTick !== previous.tick) return null
    const bodies = {...(previous.bodies ?? {})}
    for (const [who, fields] of Object.entries(patch.bodyDelta ?? {})) bodies[who] = {...(bodies[who] ?? {}), ...(fields as object)}
    for (const who of patch.removedBodies ?? []) delete bodies[who]
    const {bodyDelta: _delta, removedBodies: _removed, baseTick: _base, delta: _flag, ...fields} = patch
    return {...previous, ...fields, bodies}
  }
  const phaseChanged = previous && (previous.roundId !== patch.roundId || previous.index !== patch.index)
  return {...(previous ?? {}), ...(phaseChanged ? {ownSubmission:null,hintReceipt:null} : {}), ...patch}
}
