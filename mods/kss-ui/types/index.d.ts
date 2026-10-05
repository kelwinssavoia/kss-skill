export type KssPhaseMark = 'done' | 'current' | 'todo'

export type KssPhase = { name: string; mark: KssPhaseMark }

export type KssTicket = {
  id: string
  title: string | null
  state: string
  tier: string | null
  turns: number | null
  est: number | null
  startedAt: string | null
  blockedBy: string[]
}

/** One line of `06-execution.md`'s Log: `- \`ts\` · **NN** · event · detail`. */
export type KssLogEntry = { at: string; ticket: string | null; event: string; detail: string }

/** What a ticket's subagent is doing right now, seen by the mod as it happens. */
export type KssLive = {
  agentId: string
  role: 'executor' | 'reviewer'
  turns: number
  startedAt: number
  action: string | null
  actionAt: number | null
  isDone: boolean
}

export type KssGrillCategory = { done: number; total: number }

export type KssGrill = {
  asked: number
  total: number
  deferred: number
  business: KssGrillCategory | null
  layout: KssGrillCategory | null
  technical: KssGrillCategory | null
  current: string | null
}

export type KssBoard = {
  feature: string
  phase: string
  isClosed: boolean
  size: string | null
  track: string | null
  harness: string | null
  phases: KssPhase[]
  next: string | null
  nextPhase: string | null
  isPhaseFinished: boolean
  tickets: KssTicket[]
  integrated: number | null
  total: number | null
  last: string | null
  explorers: { running: number; returned: number } | null
  grill: KssGrill | null
  review: { round: number | null; watching: string | null } | null
  turns: number | null
  ctx: number | null
  tokens: number | null
  phaseStartedAt: string | null
  log: KssLogEntry[]
}

/**
 * One rate-limit window as this execute has used it: `base` the percent when the run started,
 * `last` the latest reading, `carried` what was used in windows that have since reset.
 */
export type KssQuotaWindow = { kind: string; base: number; last: number; carried: number; resetsAt: string | null }

export type KssQuota = { feature: string; windows: KssQuotaWindow[] }

/** A phase the person just started with `/kss-<phase> NNN-slug`, shown until `.kss/current` says so too. */
export type KssPending = { feature: string; phase: string }

declare module 'claude-code' {
  interface PluginState {
    'kss-ui': {
      board: KssBoard | null
      isBandHidden: boolean
      pending: KssPending | null
      /** Ticket id → its live subagent. */
      live: Record<string, KssLive>
      /** The clock the elapsed times are drawn against, ticked while tickets run. */
      now: number
      /** The session and weekly quota this feature's execute has used, while it runs. */
      quota: KssQuota | null
    }
  }
}
