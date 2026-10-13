// The shapes that cross the IPC boundary between the main process and the renderer.
// The board itself is kss-ui's model (mods/kss-ui/types), so the app and the mod draw the same facts.

import type { KssBoard } from '../../../../mods/kss-ui/types/index.d.ts'

export type { KssBoard, KssTicket, KssPhase, KssLogEntry } from '../../../../mods/kss-ui/types/index.d.ts'

export type Harness = 'claude-code' | 'codex'

export type HarnessInfo = { claude: string | null; codex: string | null }

export type ProjectInfo = {
  root: string
  name: string
  hasKss: boolean
  featuresRoot: string | null
  baseBranch: string
  branchPrefix: string
  hasQaConfig: boolean
  harnesses: HarnessInfo
  /** Feature folders under `features_root` in the project checkout. */
  features: string[]
  sessionsDir: string
}

export type Session = {
  /** The worktree's absolute path — also its id. */
  path: string
  name: string
  branch: string | null
  isProject: boolean
  feature: string | null
  board: KssBoard | null
}

export type TerminalKind = 'shell' | 'chat' | 'phase'

export type TerminalSpec = {
  cwd: string
  kind: TerminalKind
  harness?: Harness
  /** For a phase: the skill without its prefix and its arguments, e.g. `spec` + `012-x`. */
  phase?: string
  args?: string
  cols?: number
  rows?: number
}

export type TerminalInfo = { id: string; cwd: string; title: string; kind: TerminalKind; harness: Harness | null }

export type ActivityEntry = { at: string | null; kind: 'prompt' | 'text' | 'tool' | 'result'; text: string }

export type TicketObjective = {
  file: string | null
  title: string | null
  header: string | null
  goal: string | null
  requirements: string | null
  files: string | null
  tests: string | null
  log: { at: string; event: string; detail: string }[]
}

export type TicketChanges = {
  worktree: string | null
  exists: boolean
  base: string | null
  commits: { sha: string; subject: string }[]
  stat: string
  diff: string
  uncommitted: string
}

export type TicketActivity = {
  transcript: string | null
  format: 'claude' | 'codex' | null
  turns: number
  tokens: number
  model: string | null
  updatedAt: string | null
  entries: ActivityEntry[]
}

/** `activity` is every subagent seen on the ticket's worktree, newest first: the executor, then its reviewer. */
export type TicketInspection = { id: string; objective: TicketObjective; changes: TicketChanges; activity: TicketActivity[] }

export type Prefs = {
  recent: string[]
  /** project root → phase → harness. */
  harnessByPhase: Record<string, Record<string, Harness>>
}
