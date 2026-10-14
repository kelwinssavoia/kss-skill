// How the renderer reads a board; pure, so the tests pin it.

import type { KssBoard, KssPhase } from './types.ts'

/**
 * The band as the user reads it: once a phase has finished (its Next names another one) it is
 * done, and the phase Next names is the one waiting, even before `.kss/current` moves on.
 */
export function marks(b: Pick<KssBoard, 'phases' | 'isPhaseFinished' | 'isClosed' | 'nextPhase'>): KssPhase[] {
  if (!b.isPhaseFinished || b.isClosed) return b.phases
  return b.phases.map(p => (p.mark === 'current' ? { ...p, mark: 'done' } : p.name === b.nextPhase ? { ...p, mark: 'next' as KssPhase['mark'] } : p))
}
