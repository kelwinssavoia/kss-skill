// Where a session's phase stands, as the person needs to know it (DESIGN.md §26): working, or
// waiting on them — and why. Pure, so the tests pin it; the sidebar, the header, the tabs and the
// phase view all read the same answer.

import type { KssBoard } from './types.ts'

export type PhaseStatus = 'idle' | 'starting' | 'working' | 'waiting' | 'blocked' | 'handoff' | 'finished' | 'exited'

export const STATUS_LABEL: Record<PhaseStatus, string> = {
  idle: 'Not running',
  starting: 'Starting…',
  working: 'Working',
  waiting: 'Waiting for you',
  blocked: 'Blocked — needs you',
  handoff: 'Running an earlier phase first',
  finished: 'Finished',
  exited: 'Process ended',
}

/** The statuses that need the person: what the sidebar badges and the dock counts. */
export const NEEDS_YOU = new Set<PhaseStatus>(['waiting', 'blocked'])

type Inputs = {
  board: Pick<KssBoard, 'phase' | 'isPhaseFinished' | 'isClosed' | 'ask' | 'waiting' | 'tickets' | 'explorers'> | null
  /** A live terminal runs this phase. */
  live: boolean
  /** A terminal ran it in this run of the app and has exited. */
  exited: boolean
  /** The app launched it moments ago and the phase has not written `.kss/current` yet. */
  launching: boolean
  /** The waiting mark the person already answered (its `since`), not yet cleared by the hook. */
  answered?: string | null
}

export function phaseStatus({ board: b, live, exited, launching, answered }: Inputs): PhaseStatus {
  if (launching) return 'starting'
  if (!b || b.isClosed) return live ? 'working' : 'idle'
  if (b.ask?.kind === 'handoff') return 'handoff'
  if (b.ask?.kind === 'blocked') return 'blocked'
  if (b.ask) return live || !exited ? 'waiting' : 'exited'
  if (b.isPhaseFinished) return 'finished'
  // The main agent ended its turn — unless it only waits on its own subagents.
  const busy = b.tickets.some(t => t.state === 'running' || t.state === 'reviewing') || (b.explorers ? b.explorers.running > b.explorers.returned : false)
  if (b.waiting && b.waiting.since !== answered && !busy && live) return 'waiting'
  if (live) return 'working'
  return exited ? 'exited' : 'idle'
}
