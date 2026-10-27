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
  design: 'the fixes stopped converging — the design needs a look',
}

/** `design: credit reservation` → the reason's sentence, with what follows the colon. */
function whyOf(reason: string | null): string {
  if (!reason) return 'the review stopped the loop'
  const [key, ...rest] = reason.split(':')
  const why = WHY[key!.trim()]
  const detail = rest.join(':').trim()
  return why ? (detail ? `${why} (${detail})` : why) : reason
}

export type LoopStep = { run: { phase: string; args: string } } | { stop: string } | null

type Board = Pick<KssBoard, 'phase' | 'next' | 'isClosed' | 'isPhaseFinished' | 'ask' | 'review'>

/** The review's process: alive at all, and working a turn right now. */
export type ReviewProcess = { live: boolean; working: boolean }

/**
 * What the loop does with the board as it stands: run the Next phase, stop, or wait.
 *
 * A review the loop started keeps its process while it lives. Its turn may end with nothing for the
 * person — waiting on a subagent it sent to the background, or on the PR — and that reads as
 * waiting; starting it again would kill it mid-round (and the next one, and the next). The loop
 * starts review only after an execute, when the switch was just turned on, or once the process is gone.
 */
export function loopStep(b: Board | null, loop: Pick<ReviewLoop, 'startedAt' | 'launches'>, review: ReviewProcess): LoopStep {
  if (!b) return null
  if (b.isClosed) return { stop: 'the review was finished' }
  const mark = b.review?.loop
  if (b.phase === 'review' && mark?.state === 'stopped' && Date.parse(mark.at ?? '') >= loop.startedAt - 1000)
    return { stop: whyOf(mark.reason) }
  // A question, a held finding, a blocked run: the person answers in place, then the phase goes on.
  if (b.ask) return null
  const next = parseNext(b.next)
  if (!next) return null
  if (loop.launches >= LOOP_MAX_LAUNCHES) return { stop: WHY.cap! }
  if (next.phase === 'execute') return b.phase !== 'execute' && thenOf(b.next) === 'review' ? { run: next } : null
  if (next.phase !== 'review') return { stop: `the track moved on to ${next.phase}` }
  // After an execute the review is due; in review itself, only when nothing of it runs.
  if (b.phase !== 'execute' && (review.working || (review.live && loop.launches > 0))) return null
  return { run: { phase: 'review', args: withLoop(next.args) } }
}

export const withLoop = (args: string) => (new RegExp(`(^|\\s)${LOOP_ARG}\\b`).test(args) ? args : `${args.trim()} ${LOOP_ARG}`.trim())
