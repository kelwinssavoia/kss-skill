// The Execute view's model (DESIGN.md §24.8): every ticket with what it is for, what its subagent
// is doing right now and how much it changed — read from the files execute already writes and
// the subagents' transcripts, so following a run needs no terminal. Read-only, like the board.

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { parseJson, parseLog } from '../../../../mods/kss-ui/hooks/kss.ts'
import type { ActivityEntry, ExecAgent, ExecOverview, ExecTicket, KssBoard, TicketActivity } from '../shared/types.ts'
import { git } from './git.ts'
import { parseTicket, ticketFile } from './inspector.ts'
import { read } from './project.ts'
import { locateTranscripts, readActivity } from './transcripts.ts'

const ACTIVE = new Set(['running', 'reviewing', 'rejected'])
const GOAL_MAX = 320

/** Transcripts are re-read only when they change: a run has a dozen of them, each megabytes. */
const activityCache = new Map<string, { mtime: number; activity: TicketActivity }>()

function activityOf(path: string): TicketActivity {
  let mtime = 0
  try {
    mtime = statSync(path).mtimeMs
  } catch {
    /* gone: read() returns the empty activity */
  }
  const hit = activityCache.get(path)
  if (hit && hit.mtime === mtime) return hit.activity
  const activity = readActivity(path)
  activityCache.set(path, { mtime, activity })
  return activity
}

const cut = (t: string | null, n: number) => (t && t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t)

/** The subagent's own latest words and latest action, from its transcript entries. */
export function agentOf(a: TicketActivity, role: ExecAgent['role']): ExecAgent {
  const last = (kind: ActivityEntry['kind']) => [...a.entries].reverse().find(e => e.kind === kind)?.text ?? null
  // Its words, not a code fence or a table rule: the first line of its last message that reads as prose.
  const prose = (t: string | null) => t?.split('\n').map(l => l.replace(/^[#>*\-\s]+/, '').trim()).find(l => !l.startsWith('```') && /\p{L}{3}/u.test(l)) ?? null
  return {
    role,
    turns: a.turns,
    tokens: a.tokens,
    model: a.model,
    updatedAt: a.updatedAt,
    saying: cut(prose([...a.entries].reverse().find(e => e.kind === 'text' && prose(e.text))?.text ?? null), 240),
    doing: last('tool'),
    recent: a.entries.filter(e => e.kind !== 'prompt').slice(-14),
  }
}

/**
 * Who the transcript belongs to. Claude Code writes `agent-<id>.meta.json` beside a subagent's
 * transcript with its type and description ("Integrate ticket 12"); a cross-harness CLI has none,
 * and is the executor unless the ticket is in review.
 */
export function roleOf(transcript: string, state: string): ExecAgent['role'] {
  try {
    const meta = JSON.parse(readFileSync(transcript.replace(/\.jsonl$/, '.meta.json'), 'utf8'))
    const type = String(meta.agentType ?? '')
    const what = String(meta.description ?? '')
    if (/reviewer/i.test(type) || /^review/i.test(what)) return 'reviewer'
    if (/^integrat/i.test(what)) return 'integrator'
    return 'executor'
  } catch {
    return state === 'reviewing' ? 'reviewer' : 'executor'
  }
}

/**
 * The transcript that matches what the ticket is doing: an implementing ticket shows its executor
 * even when the reviewer that just sent it back is newer (the next executor may not have written
 * anything yet); a ticket in review shows its reviewer. Otherwise the newest.
 */
export function pickTranscript(paths: string[], state: string, role = roleOf): { path: string; role: ExecAgent['role'] } | null {
  const want: ExecAgent['role'][] = state === 'running' || state === 'rejected' ? ['executor'] : state === 'reviewing' ? ['reviewer'] : []
  const roles = paths.map(p => ({ path: p, role: role(p, state) }))
  return roles.find(r => want.includes(r.role)) ?? roles[0] ?? null
}

/** Dependency depth of each ticket: wave 1 has no blocker, wave n waits on wave n-1. */
export function waves(tickets: { id: string; blockedBy: string[] }[]): string[][] {
  const by = new Map(tickets.map(t => [t.id, t.blockedBy.filter(b => b !== t.id)]))
  const depth = new Map<string, number>()
  const visit = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!
    if (seen.has(id)) return 0 // a cycle in a hand-edited graph: do not loop
    seen.add(id)
    const d = Math.max(0, ...(by.get(id) ?? []).filter(b => by.has(b)).map(b => visit(b, seen) + 1))
    depth.set(id, d)
    return d
  }
  for (const t of tickets) visit(t.id, new Set())
  const out: string[][] = []
  for (const t of [...tickets].sort((a, b) => a.id.localeCompare(b.id))) (out[depth.get(t.id)!] ??= []).push(t.id)
  return out.filter(Boolean)
}

/** `3 files changed, 40 insertions(+), 2 deletions(-)` → numbers. */
export function shortstat(text: string): { files: number; added: number; deleted: number } {
  const n = (re: RegExp) => Number(re.exec(text)?.[1] ?? 0)
  return { files: n(/(\d+) files? changed/), added: n(/(\d+) insertions?\(\+\)/), deleted: n(/(\d+) deletions?\(-\)/) }
}

async function diffOf(worktree: string, base: string | null): Promise<ExecTicket['diff']> {
  const [committed, wip, untracked] = await Promise.all([
    git(worktree, ['diff', '--shortstat', base ? `${base}...HEAD` : 'HEAD~1...HEAD']),
    git(worktree, ['diff', '--shortstat', 'HEAD']),
    git(worktree, ['ls-files', '--others', '--exclude-standard']),
  ])
  if (!committed.ok && !wip.ok) return null
  const c = shortstat(committed.stdout)
  const w = shortstat(wip.stdout)
  const fresh = untracked.stdout.split('\n').filter(Boolean).length
  return { files: c.files, added: c.added, deleted: c.deleted, uncommitted: w.files + fresh }
}

export async function executeOverview(session: string, featureDir: string, board: KssBoard): Promise<ExecOverview> {
  const current = parseJson(read(join(session, '.kss/current'))) ?? {}
  const entries = (current.tickets && typeof current.tickets === 'object' ? current.tickets : {}) as Record<string, any>
  const execution = (current.execution ?? {}) as Record<string, unknown>
  const log = parseLog(read(join(featureDir, '06-execution.md')), 10_000)
  const branch = await git(session, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const base = branch.ok && branch.stdout.trim() !== 'HEAD' ? branch.stdout.trim() : null
  const phaseAt = Date.parse(board.phaseStartedAt ?? '')

  const tickets = await Promise.all(
    board.tickets.map(async (t): Promise<ExecTicket> => {
      const e = entries[t.id] ?? {}
      const file = ticketFile(featureDir, t.id)
      const goal = cut(parseTicket(file ? read(file) : null, file).goal?.replace(/\s+/g, ' ').trim() ?? null, GOAL_MAX)
      const worktree: string | null = typeof e.worktree === 'string' && e.worktree ? e.worktree : null
      let agent: ExecAgent | null = null
      let diff: ExecTicket['diff'] = null
      if (worktree && t.state !== 'blocked' && t.state !== 'ready') {
        const started = Date.parse(t.startedAt ?? '')
        const since = Number.isFinite(started) ? started - 60_000 : Number.isFinite(phaseAt) ? phaseAt : Date.now() - 86_400_000
        const found = pickTranscript(locateTranscripts({ session, worktree, since }), t.state)
        if (found) agent = agentOf(activityOf(found.path), found.role)
        diff = await diffOf(worktree, base)
      }
      return {
        id: t.id,
        title: t.title,
        state: t.state,
        tier: t.tier,
        est: t.est,
        blockedBy: t.blockedBy,
        startedAt: t.startedAt,
        goal,
        agent,
        diff,
        events: log.filter(l => l.ticket === t.id).map(({ at, event, detail }) => ({ at, event, detail })),
      }
    }),
  )

  const path = typeof execution.critical_path === 'string' ? execution.critical_path.match(/\d{2}/g) ?? [] : []
  return {
    feature: board.feature,
    phaseStartedAt: board.phaseStartedAt,
    integrated: board.integrated ?? tickets.filter(t => t.state === 'integrated').length,
    total: board.total ?? tickets.length,
    criticalPath: path,
    last: board.last,
    tokens: board.tokens,
    tickets,
    waves: waves(tickets),
    log: log.slice(-60),
  }
}

export const isActive = (state: string) => ACTIVE.has(state)
