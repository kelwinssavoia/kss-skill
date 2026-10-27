// When the app closes a CLI by itself (DESIGN.md §24.9): its phase finished, or it sat idle. A
// Claude Code or Codex process holds hundreds of MB; a finished one is only kept for its
// conversation, and that is reopened with `--resume` from the tab or the Sessions view.

import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { EndReason, KssBoard, TerminalInfo } from '../shared/types.ts'
import { transcriptOf } from './phase.ts'
import { claudeSlug } from './transcripts.ts'
import type { Activity } from './pty.ts'

/** A phase whose Next moved on is closed once its summary is written and nobody typed for this long. */
export const FINISHED_QUIET_MS = 20_000
/** Any conversation nobody typed into and that wrote nothing for this long is closed. */
export const IDLE_MS = 5 * 60_000
/** …provided its screen is still: a spinner (a tool running, a subagent awaited) repaints constantly. */
const STILL_MS = 15_000
const FINISHED_STILL_MS = 5_000

type Board = Pick<KssBoard, 'phase' | 'isPhaseFinished' | 'isClosed'>

/**
 * Pure: why to close this terminal now, or null. `lastWrite` is the newest write to its transcript
 * or its subagents' — the conversation's own sign of life, which output alone is not (a status line
 * redraws) and input alone is not (a long tool call types nothing).
 */
export function closeReason(t: Pick<TerminalInfo, 'kind' | 'phase'>, a: Activity, lastWrite: number, board: Board | null, now: number): Extract<EndReason, 'finished' | 'idle'> | null {
  if (t.kind !== 'phase' && t.kind !== 'chat') return null
  const quiet = now - Math.max(a.startedAt, a.lastInput, lastWrite)
  const still = now - a.lastOutput
  const done = t.kind === 'phase' && !!board && t.phase === board.phase && (board.isPhaseFinished || board.isClosed)
  if (done && quiet >= FINISHED_QUIET_MS && still >= FINISHED_STILL_MS) return 'finished'
  if (quiet >= IDLE_MS && still >= STILL_MS) return 'idle'
  return null
}

const mtime = (p: string) => {
  try {
    return statSync(p).mtimeMs
  } catch {
    return 0
  }
}

/** The newest write to a terminal's conversation: its transcript, or one of its subagents'. */
export function lastWriteOf(t: Pick<TerminalInfo, 'cwd' | 'harness' | 'conversation'>): number {
  const main = transcriptOf(t)
  let at = main ? mtime(main) : 0
  if (t.harness !== 'codex' && t.conversation) {
    const dir = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects', claudeSlug(t.cwd), t.conversation, 'subagents')
    try {
      for (const n of readdirSync(dir)) at = Math.max(at, mtime(join(dir, n)))
    } catch {
      /* no subagents */
    }
  }
  return at
}
