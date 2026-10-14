// The subagent inspector: a ticket's objective, its changes and its activity (DESIGN.md §24.4).

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { parseJson, parseLog } from '../../../../mods/kss-ui/hooks/kss.ts'
import type { TicketChanges, TicketInspection, TicketObjective } from '../shared/types.ts'
import { git } from './git.ts'
import { read } from './project.ts'
import { locateTranscripts, readActivity } from './transcripts.ts'

const MAX_DIFF = 400_000

/** A `## Heading` section of a ticket file, without the heading, or null. */
export function section(text: string, heading: string): string | null {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, 'm')
  const m = re.exec(text)
  if (!m) return null
  const rest = text.slice(m.index + m[0].length)
  const end = rest.search(/^##\s+/m)
  const body = (end === -1 ? rest : rest.slice(0, end)).replace(/<!--[\s\S]*?-->/g, '').trim()
  return body || null
}

export function parseTicket(text: string | null, file: string | null): Omit<TicketObjective, 'log'> {
  if (!text) return { file, title: null, header: null, goal: null, requirements: null, files: null, tests: null }
  const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? null
  const first = text.search(/^##\s+/m)
  const header = (first === -1 ? '' : text.slice(0, first)).replace(/^#.*$/m, '').replace(/<!--[\s\S]*?-->/g, '').trim() || null
  return {
    file,
    title,
    header,
    goal: section(text, 'Goal'),
    requirements: section(text, 'Requirements covered'),
    files: section(text, 'Files'),
    tests: section(text, 'Tests'),
  }
}

export function ticketFile(featureDir: string, id: string): string | null {
  const dir = join(featureDir, '05-tickets')
  try {
    const n = readdirSync(dir).find(f => f.startsWith(`${id}-`) && f.endsWith('.md'))
    return n ? join(dir, n) : null
  } catch {
    return null
  }
}

async function changes(worktree: string | null, base: string | null): Promise<TicketChanges> {
  const none: TicketChanges = { worktree, exists: false, base, commits: [], stat: '', diff: '', uncommitted: '' }
  if (!worktree || !existsSync(worktree)) return none
  const range = base ? `${base}...HEAD` : 'HEAD~1...HEAD'
  const [log, stat, diff, wip, untracked] = await Promise.all([
    git(worktree, ['log', '--format=%h%x09%s', base ? `${base}..HEAD` : '-1']),
    git(worktree, ['diff', '--stat', range]),
    git(worktree, ['diff', range]),
    git(worktree, ['diff', 'HEAD']),
    git(worktree, ['ls-files', '--others', '--exclude-standard']),
  ])
  // New files the subagent has not committed yet: shown whole, as a diff against nothing.
  const fresh = untracked.stdout.split('\n').filter(Boolean).slice(0, 30)
  const added = await Promise.all(fresh.map(f => git(worktree, ['diff', '--no-index', '--', '/dev/null', f])))
  const extra = added.map(r => r.stdout).join('')
  return {
    worktree,
    exists: true,
    base,
    commits: log.stdout.split('\n').filter(Boolean).map(l => {
      const [sha, ...rest] = l.split('\t')
      return { sha: sha!, subject: rest.join('\t') }
    }),
    stat: stat.stdout,
    diff: diff.stdout.slice(0, MAX_DIFF),
    uncommitted: (wip.stdout + extra).slice(0, MAX_DIFF),
  }
}

/** Everything the inspector shows for ticket `id` of the feature running in session `session`. */
export async function inspectTicket(session: string, featureDir: string, feature: string, id: string): Promise<TicketInspection> {
  const current = parseJson(read(join(session, '.kss/current')))
  const t = (current?.tickets as Record<string, any> | undefined)?.[id] ?? {}
  const worktree: string = typeof t.worktree === 'string' && t.worktree ? t.worktree : join(session, '.kss/worktrees', feature, id)
  const branch = await git(session, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const base = branch.ok && branch.stdout.trim() !== 'HEAD' ? branch.stdout.trim() : null

  const file = ticketFile(featureDir, id)
  const log = parseLog(read(join(featureDir, '06-execution.md')), 10_000)
    .filter(e => e.ticket === id)
    .map(({ at, event, detail }) => ({ at, event, detail }))

  const startedAt = typeof t.started_at === 'string' ? Date.parse(t.started_at) : NaN
  const phaseAt = typeof current?.phase_started_at === 'string' ? Date.parse(current.phase_started_at) : NaN
  const since = Number.isFinite(startedAt) ? startedAt - 60_000 : Number.isFinite(phaseAt) ? phaseAt : Date.now() - 7 * 86_400_000

  return {
    id,
    objective: { ...parseTicket(file ? read(file) : null, file), log },
    changes: await changes(worktree, base),
    activity: locateTranscripts({ session, worktree, since }).map(readActivity),
  }
}
