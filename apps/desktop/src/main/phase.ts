// The phase view's model (DESIGN.md §26): what a running phase is doing, without its terminal — the
// main conversation's own words and commands, the subagents it spawned, and the file it is writing.
// Read-only, from the transcripts the harness writes and the feature folder.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { PhaseAgent, PhaseOverview, TerminalInfo, TicketActivity } from '../shared/types.ts'
import { claudeSlug, readActivity } from './transcripts.ts'

/** The file each phase writes, relative to the feature folder: what the view previews live. */
export const ARTIFACT: Record<string, string> = {
  clarify: '00-brief.md',
  investigate: '01-investigation.md',
  'review-decisions': 'auto-decisions.md',
  grill: '02-decisions.md',
  spec: '03-spec.md',
  plan: '04-plan.md',
  tickets: '05-tickets/graph.md',
  execute: '06-execution.md',
  review: '07-review.md',
}

const ARTIFACT_MAX = 60_000
const claudeHome = () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')

/** Transcripts are re-read only when they change. */
const cache = new Map<string, { mtime: number; activity: TicketActivity }>()

function activityAt(path: string): TicketActivity {
  let mtime = 0
  try {
    mtime = statSync(path).mtimeMs
  } catch {
    /* gone: readActivity returns the empty one */
  }
  const hit = cache.get(path)
  if (hit && hit.mtime === mtime) return hit.activity
  const activity = readActivity(path)
  cache.set(path, { mtime, activity })
  return activity
}

/** A Codex rollout is named `rollout-<time>-<id>.jsonl` under the day it started. */
function codexRollout(id: string, codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex')): string | null {
  for (let back = 0; back < 3; back++) {
    const d = new Date(Date.now() - back * 86_400_000)
    const dir = join(codexHome, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
    try {
      const n = readdirSync(dir).find(f => f.endsWith(`${id}.jsonl`))
      if (n) return join(dir, n)
    } catch {
      /* no rollouts that day */
    }
  }
  return null
}

export function transcriptOf(t: Pick<TerminalInfo, 'cwd' | 'harness' | 'conversation'>): string | null {
  if (!t.conversation) return null
  return t.harness === 'codex' ? codexRollout(t.conversation) : join(claudeHome(), 'projects', claudeSlug(t.cwd), `${t.conversation}.jsonl`)
}

const cut = (t: string | null, n: number) => (t && t.length > n ? `${t.slice(0, n - 1)}…` : t)

/** Claude Code writes each subagent beside its parent: `<conversation>/subagents/agent-*.jsonl` (+ `.meta.json`). */
export function subagentsOf(t: Pick<TerminalInfo, 'cwd' | 'harness' | 'conversation'>, since: number): PhaseAgent[] {
  if (t.harness === 'codex' || !t.conversation) return []
  const dir = join(claudeHome(), 'projects', claudeSlug(t.cwd), t.conversation, 'subagents')
  let names: string[] = []
  try {
    names = readdirSync(dir).filter(n => n.startsWith('agent-') && n.endsWith('.jsonl'))
  } catch {
    return []
  }
  const out: PhaseAgent[] = []
  for (const n of names) {
    const path = join(dir, n)
    let mtime = 0
    try {
      mtime = statSync(path).mtimeMs
    } catch {
      continue
    }
    if (mtime < since) continue
    let meta: { agentType?: string; description?: string } = {}
    try {
      meta = JSON.parse(readFileSync(path.replace(/\.jsonl$/, '.meta.json'), 'utf8'))
    } catch {
      /* no meta: the transcript alone */
    }
    const a = activityAt(path)
    const last = (k: string) => [...a.entries].reverse().find(e => e.kind === k)?.text ?? null
    out.push({ id: n.slice(6, -6), description: meta.description ?? null, type: meta.agentType ?? null, turns: a.turns, tokens: a.tokens, updatedAt: a.updatedAt, doing: last('tool'), saying: cut(last('text'), 280) })
  }
  return out.sort((x, y) => (y.updatedAt ?? '').localeCompare(x.updatedAt ?? ''))
}

export function phaseOverview(phase: string, featureDir: string | null, term: TerminalInfo | null, phaseStartedAt: string | null): PhaseOverview {
  const path = term ? transcriptOf(term) : null
  const full = path ? activityAt(path) : null
  const activity = full ? { ...full, entries: full.entries.filter(e => e.kind !== 'prompt').slice(-40) } : null
  const started = Date.parse(phaseStartedAt ?? '')
  const agents = term ? subagentsOf(term, Number.isFinite(started) ? started - 60_000 : 0) : []
  let artifact: PhaseOverview['artifact'] = null
  const rel = ARTIFACT[phase]
  if (featureDir && rel) {
    try {
      const file = join(featureDir, rel)
      const text = readFileSync(file, 'utf8')
      artifact = { path: rel, text: text.length > ARTIFACT_MAX ? `${text.slice(0, ARTIFACT_MAX)}\n\n…` : text, updatedAt: Math.round(statSync(file).mtimeMs) }
    } catch {
      /* not written yet */
    }
  }
  return { phase, activity, agents, artifact }
}
