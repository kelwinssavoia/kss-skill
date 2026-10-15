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
  report: SessionReport | null
}

/** The feature's report/index.html (DESIGN.md §25): which phases explained themselves, the newest last. */
export type SessionReport = { file: string; phases: string[]; latest: string | null; updatedAt: number }

export type TerminalKind = 'shell' | 'chat' | 'phase' | 'qa'

export type TerminalSpec = {
  cwd: string
  kind: TerminalKind
  harness?: Harness
  /** Start the CLI in bypass-permissions mode; set by the main process from the prefs, never by the renderer. */
  bypass?: boolean
  /** For a phase: the skill without its prefix and its arguments, e.g. `spec` + `012-x`. */
  phase?: string
  args?: string
  /** For `qa`: one step of scripts/qa.mjs (DESIGN.md §24.5). */
  qa?: { step: QaStep; feature: string; only?: string; force?: boolean }
  /** For a chat: its first message, e.g. the grill side chat's briefing. */
  prompt?: string
  /** For a chat: read-only — Claude Code in plan mode, Codex in its read-only sandbox; never bypass. */
  readonly?: boolean
  /** A title shown instead of the derived one. */
  title?: string
  /** Resume this conversation (`claude --resume <id>`, `codex resume <id>`) instead of starting one. */
  resume?: string
  /** Claude Code only: the id the new conversation gets (`--session-id`); set by the main process. */
  sessionId?: string
  /** The saved tab this terminal belongs to (DESIGN.md §24.3); set by the main process. */
  tab?: string
  cols?: number
  rows?: number
}

export type TerminalInfo = {
  id: string
  cwd: string
  title: string
  kind: TerminalKind
  harness: Harness | null
  phase: string | null
  /** The harness's conversation id, once known; what a reopened session resumes. */
  conversation: string | null
  tab: string | null
  /** True when this terminal is a resumed conversation. */
  resumed: boolean
}

/** A chat or phase tab remembered per session, so its conversation comes back when the session reopens. */
export type SavedTab = {
  key: string
  cwd: string
  kind: 'chat' | 'phase'
  harness: Harness
  phase: string | null
  args: string | null
  /** The tab's own title, when it had one; otherwise derived again on resume. */
  title: string | null
  readonly: boolean
  conversation: string | null
  createdAt: string
}

/** `prompt` the brief, `message` anything sent to the agent later (the coordinator), `text` the agent's own words. */
export type ActivityEntry = { at: string | null; kind: 'prompt' | 'message' | 'text' | 'tool' | 'result'; text: string }

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
  /** Chats and phases start with the harness's bypass-permissions flag. */
  bypass: boolean
}

export type QaStep = 'plan' | 'up' | 'run' | 'judge' | 'report' | 'down' | 'status'

export type QaScenario = {
  id: string
  title: string
  persona: string | null
  app: string | null
  covers: string[]
  steps: string[]
  expected: string[]
}

export type QaStepRecord = {
  i: number
  at: string | null
  title: string
  expected: string
  observed: string
  status: string
  url: string | null
  /** Absolute path of the step's screenshot, read through `qa:image`. */
  screenshot: string | null
}

export type QaScenarioRun = {
  runId: string
  status: string | null
  final: string | null
  note: string | null
  summary: string | null
  issues: { kind: string; title: string; detail?: string }[]
  turns: number | null
  cost: number | null
  steps: QaStepRecord[]
}

/** A fix ticket kss-qa --fix wrote for a failed scenario (`qa/fixes.json`), tied to the run it came from. */
export type QaFix = { scenario: string; run: string | null; tickets: string[]; fr: string[]; title: string | null; at: string | null }

export type QaLive = { runId: string; scenario: string; title: string; cdp: string; startedAt: string }

/** Who holds the one QA environment (DESIGN.md §24.5): the session whose runtime has live pids. */
export type QaEnv = { state: 'down' | 'starting' | 'up'; feature: string | null; startedAt: string | null; readyAt: string | null; services: { name: string; alive: boolean }[] }

export type QaInfo = {
  hasConfig: boolean
  /** Whether the project's copy of qa.mjs writes live.json — older copies need `kss-init` again. */
  hasLive: boolean
  feature: string | null
  plan: { scenarios: QaScenario[]; notCovered: { fr: string; reason?: string }[]; assumptions: string[] } | null
  env: QaEnv
  /** The session holding the environment when it is not this one. */
  heldBy: string | null
  live: QaLive | null
  runs: string[]
  latest: Record<string, QaScenarioRun>
  verdict: string | null
  fixes: QaFix[]
}

export type QaFrame = { session: string; scenario: string; data: string }

// ── Execute view (DESIGN.md §24.8) ──────────────────────────────────────────────────────────────

export type ExecState = 'blocked' | 'ready' | 'running' | 'reviewing' | 'rejected' | 'integrated'

/** What a ticket's current subagent is doing, read from its transcript. */
export type ExecAgent = {
  role: 'executor' | 'reviewer' | 'integrator'
  turns: number
  tokens: number
  model: string | null
  updatedAt: string | null
  /** The last thing it said it is doing, in its own words. */
  saying: string | null
  /** Its last tool call, described. */
  doing: string | null
  recent: ActivityEntry[]
}

export type ExecTicket = {
  id: string
  title: string | null
  state: string
  tier: string | null
  est: number | null
  blockedBy: string[]
  startedAt: string | null
  /** The ticket's Goal, cut short: what is being implemented. */
  goal: string | null
  agent: ExecAgent | null
  diff: { files: number; added: number; deleted: number; uncommitted: number } | null
  events: { at: string; event: string; detail: string }[]
}

export type ExecOverview = {
  feature: string
  phaseStartedAt: string | null
  integrated: number
  total: number
  criticalPath: string[]
  last: string | null
  tokens: number | null
  tickets: ExecTicket[]
  /** Tickets by dependency depth: wave 1 needs nothing, wave n needs something from wave n-1. */
  waves: string[][]
  log: { at: string; ticket: string | null; event: string; detail: string }[]
}

