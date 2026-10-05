export type KssPhaseMark = 'done' | 'current' | 'todo'

export type KssPhase = { name: string; mark: KssPhaseMark }

export type KssTicket = {
  id: string
  state: string
  tier: string | null
  turns: number | null
  est: number | null
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
}

/** A phase the person just started with `/kss-<phase> NNN-slug`, shown until `.kss/current` says so too. */
export type KssPending = { feature: string; phase: string }

declare module 'claude-code' {
  interface PluginState {
    'kss-ui': { board: KssBoard | null; isBandHidden: boolean; pending: KssPending | null }
  }
}
