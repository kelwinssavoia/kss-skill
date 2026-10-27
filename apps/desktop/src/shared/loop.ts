// The review loop (DESIGN.md §26): review → execute → review … run by the app without asking, until
// the reviewer has nothing left to say. kss-execute can only be started by the person, never by a
// model (DESIGN.md §3.9), so the app is what carries each Next line on. Pure, so the tests pin it.

import { thenOf } from './board.ts'
import { parseNext } from './commands.ts'
import type { KssBoard } from './types.ts'

/** A loop the person switched on for a session; `stopped` once it ended, saying why. */
export type ReviewLoop = { startedAt: number; launches: number; stopped: string | null }

/** Ten rounds, each a review and an execute — kss-review's own cap (DESIGN.md §15.1). */
export const LOOP_MAX_LAUNCHES = 20

export const LOOP_ARG = '--loop'

const WHY: Record<string, string> = {
  clean: 'the reviewer found nothing new',
  timeout: '20 minutes without a new review',
  closed: 'the PR was merged or closed',
  cap: 'ten rounds reached',
  held: 'a finding needs your decision',
}

export type LoopStep = { run: { phase: string; args: string } } | { stop: string } | null

type Board = Pick<KssBoard, 'phase' | 'next' | 'isClosed' | 'isPhaseFinished' | 'ask' | 'review'>

/**
 * What the loop does with the board as it stands: run the Next phase, stop, or wait. `busy` is true
 * while a review process is still working its round (or polling the PR).
 */
export function loopStep(b: Board | null, loop: Pick<ReviewLoop, 'startedAt' | 'launches'>, busy: boolean): LoopStep {
  if (!b) return null
  if (b.isClosed) return { stop: 'the review was finished' }
  const mark = b.review?.loop
  if (b.phase === 'review' && mark?.state === 'stopped' && Date.parse(mark.at ?? '') >= loop.startedAt - 1000)
    return { stop: (mark.reason && WHY[mark.reason]) ?? mark.reason ?? 'the review stopped the loop' }
  // A question, a held finding, a blocked run: the person answers in place, then the phase goes on.
  if (b.ask) return null
  const next = parseNext(b.next)
  if (!next) return null
  if (loop.launches >= LOOP_MAX_LAUNCHES) return { stop: WHY.cap! }
  if (next.phase === 'execute') return b.phase !== 'execute' && thenOf(b.next) === 'review' ? { run: next } : null
  if (next.phase !== 'review') return { stop: `the track moved on to ${next.phase}` }
  // After an execute the review is due; in review itself, only once its process stopped working.
  if (b.phase !== 'execute' && busy) return null
  return { run: { phase: 'review', args: withLoop(next.args) } }
}

export const withLoop = (args: string) => (new RegExp(`(^|\\s)${LOOP_ARG}\\b`).test(args) ? args : `${args.trim()} ${LOOP_ARG}`.trim())
