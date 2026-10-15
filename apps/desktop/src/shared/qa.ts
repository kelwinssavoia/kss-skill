// What the QA panel offers after a failure (DESIGN.md §24.5): a fix task per failed scenario, the
// loop back to execute, and a re-run of what was fixed. Pure, so the tests pin it.

import { thenOf } from './board.ts'
import { parseNext } from './commands.ts'
import type { QaFix, QaScenarioRun } from './types.ts'

/** A scenario's verdict: Jev's final when judged, else the driver's. */
export const verdictOf = (run: QaScenarioRun | undefined) => run?.final ?? run?.status ?? null

/** The fix written from a scenario's latest run, if any — a newer failing run needs its own. */
export function fixFor(fixes: QaFix[], scenario: string, run: QaScenarioRun | undefined): QaFix | null {
  return [...fixes].reverse().find(f => f.scenario === scenario && (!f.run || !run || f.run === run.runId)) ?? null
}

export type QaFixActions = {
  /** Failed scenarios with no fix ticket for their latest run yet. */
  toFix: string[]
  /** The README's loop back to execute for QA's fix tickets, while it is pending. */
  execute: { phase: string; args: string; tickets: string[] } | null
  /** Scenarios whose fix has run (Next is back off execute) but whose latest run predates it. */
  rerun: string[]
}

export function fixActions(ids: string[], latest: Record<string, QaScenarioRun>, fixes: QaFix[], next: string | null): QaFixActions {
  const n = parseNext(next)
  const execute = n && n.phase === 'execute' && thenOf(next) === 'qa' ? { ...n, tickets: [...n.args.matchAll(/--ticket\s+(\S+)/g)].map(m => m[1]!) } : null
  const failed = ids.filter(id => verdictOf(latest[id]) === 'fail')
  return {
    toFix: failed.filter(id => !fixFor(fixes, id, latest[id])),
    execute,
    rerun: execute ? [] : failed.filter(id => fixFor(fixes, id, latest[id])),
  }
}
