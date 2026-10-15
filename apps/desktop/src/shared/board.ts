// How the renderer reads a board; pure, so the tests pin it.

import type { KssBoard, KssPhase } from './types.ts'

/**
 * The band as the user reads it: once a phase has finished (its Next names another one) it is
 * done, and the phase Next names is the one waiting, even before `.kss/current` moves on.
 */
export function marks(b: Pick<KssBoard, 'phases' | 'isPhaseFinished' | 'isClosed' | 'nextPhase'>): KssPhase[] {
  if (!b.isPhaseFinished || b.isClosed) return b.phases
  const at = b.phases.findIndex(p => p.mark === 'current')
  const to = b.phases.findIndex(p => p.name === b.nextPhase)
  const next = (p: KssPhase): KssPhase => ({ ...p, mark: 'next' as KssPhase['mark'] })
  // A loop back (DESIGN.md §3.9): the running phase is not done — it waits on an earlier one.
  if (at >= 0 && to >= 0 && to < at) return b.phases.map((p, i) => (i === to ? next(p) : p))
  return b.phases.map(p => (p.mark === 'current' ? { ...p, mark: 'done' } : p.name === b.nextPhase ? next(p) : p))
}

/** The phase a loop back returns to: `(then: /kss-review …)` on the Next line. */
export function thenOf(next: string | null): string | null {
  return (next && /\(then:\s*[/$](?:kss:)?kss-([a-z-]+)/.exec(next)?.[1]) || null
}
