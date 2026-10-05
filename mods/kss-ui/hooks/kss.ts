// The KSS model this mod draws from: pure functions over the text of `.kss/current`,
// `.kss/config.md` and the feature README. Nothing here touches `$`, so the tests drive it directly.
// The tracks mirror scripts/next.mjs (DESIGN.md §3.9), the one place that owns them.

import type { KssBoard, KssGrill, KssGrillCategory, KssPhase, KssTicket } from '../types'

export const ORDER = [
  'clarify', 'investigate', 'review-decisions', 'grill', 'spec', 'plan', 'tickets', 'execute',
  'qa', 'review', 'docs-tech', 'docs-product',
]

export const TRACKS: Record<string, string[]> = {
  S: ['clarify', 'tickets', 'execute'],
  M: ['clarify', 'investigate', 'spec', 'plan', 'tickets', 'execute', 'review'],
  L: ['clarify', 'investigate', 'grill', 'spec', 'plan', 'tickets', 'execute', 'review', 'docs-tech', 'docs-product'],
}

export type KssConfig = { featuresRoot: string; docsRoot: string | null; domainDocs: string[] }

export type KssReadme = { size: string | null; track: string | null; state: string | null; next: string | null }

type Json = Record<string, unknown>

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null)

export function parseJson(text: string | null): Json | null {
  if (!text) return null
  try {
    return obj(JSON.parse(text))
  } catch {
    return null
  }
}

const unquote = (s: string) => s.trim().replace(/^['"`]|['"`]$/g, '')

export function parseConfig(text: string | null): KssConfig | null {
  if (!text) return null
  const field = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(text)?.[1]?.trim() ?? null
  const root = field('features_root')
  if (!root) return null
  const docs = field('domain_docs')
  const domainDocs = docs
    ? docs.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean)
    : []
  return { featuresRoot: unquote(root).replace(/\/$/, ''), docsRoot: field('docs_root') ? unquote(field('docs_root')!) : null, domainDocs }
}

export function parseReadme(text: string | null): KssReadme {
  const t = text ?? ''
  return {
    size: /\*\*Size:\*\*\s*([SML])\b/.exec(t)?.[1] ?? null,
    track: /\*\*Track:\*\*\s*([^·\n]+)/.exec(t)?.[1]?.trim() ?? null,
    state: /\*\*State:\*\*\s*([a-z][a-z-]*)/.exec(t)?.[1] ?? null,
    next: /\*\*Next:\*\*\s*`([^`]+)`/.exec(t)?.[1]?.trim() ?? null,
  }
}

/** `metrics.jsonl` → the summed `tokens.cumulative`, as the statusline counts it. */
export function sumTokens(text: string | null): number | null {
  if (!text) return null
  let sum = 0
  for (const line of text.split('\n')) {
    if (!line) continue
    try {
      const c = JSON.parse(line)?.tokens?.cumulative
      if (typeof c === 'number' && Number.isFinite(c)) sum += c
    } catch {
      /* a malformed line is skipped, as render-cost does */
    }
  }
  return sum
}

/** The phase a Next line points at: `/kss-spec 012-x` and `$kss-spec 012-x` → `spec`. */
export function phaseOf(next: string | null): string | null {
  return next ? (/[/$]kss-([a-z-]+)/.exec(next)?.[1] ?? null) : null
}

export function phases(size: string | null, phase: string, isClosed: boolean): KssPhase[] {
  const track = (size && TRACKS[size]) || ORDER
  const names = track.includes(phase) || isClosed || !ORDER.includes(phase)
    ? [...track]
    : [...track, phase].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
  const at = ORDER.indexOf(phase)
  return names.map(name => ({
    name,
    mark: isClosed ? 'done' : name === phase ? 'current' : ORDER.indexOf(name) < at ? 'done' : 'todo',
  }))
}

function tickets(current: Json): KssTicket[] {
  const map = obj(current.tickets)
  if (!map) return []
  return Object.entries(map)
    .map(([id, v]) => {
      const r = obj(v) ?? {}
      return { id, state: str(r.state) ?? '—', tier: str(r.tier) ?? str(r.agent_type), turns: num(r.turns), est: num(r.est_turns) }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

function category(v: unknown): KssGrillCategory | null {
  const r = obj(v)
  const total = r && num(r.total)
  return r && total !== null ? { done: num(r.done) ?? 0, total } : null
}

/** `.kss/current.grill`, written by kss-grill as it asks (DESIGN.md §3.3). */
function grill(current: Json): KssGrill | null {
  const g = obj(current.grill)
  if (!g) return null
  return {
    asked: num(g.asked) ?? 0,
    total: num(g.total) ?? 0,
    deferred: num(g.deferred) ?? 0,
    business: category(g.business),
    layout: category(g.layout),
    technical: category(g.technical),
    current: str(g.current),
  }
}

export function buildBoard(current: Json | null, readme: KssReadme, tokens: number | null): KssBoard | null {
  const feature = current && str(current.feature)
  if (!current || !feature) return null
  const phase = str(current.phase) ?? readme.state ?? '—'
  const isClosed = phase === 'done'
  const nextPhase = phaseOf(readme.next)
  const execution = obj(current.execution)
  const explorers = obj(current.explorers)
  const review = obj(current.review)
  const session = obj(current.session)
  return {
    feature,
    phase,
    isClosed,
    size: readme.size,
    track: readme.track,
    harness: str(current.harness),
    phases: phases(readme.size, phase, isClosed),
    next: readme.next,
    nextPhase,
    // The README's Next line is rewritten when a phase ends; while it still names the running
    // phase, that phase has not finished.
    isPhaseFinished: isClosed || (nextPhase !== null && nextPhase !== phase),
    tickets: tickets(current),
    integrated: execution && num(execution.integrated),
    total: execution && num(execution.total),
    last: execution && str(execution.last),
    explorers: explorers ? { running: num(explorers.running) ?? 0, returned: num(explorers.returned) ?? 0 } : null,
    grill: phase === 'grill' ? grill(current) : null,
    review: review ? { round: num(review.round), watching: str(review.watching) } : null,
    turns: session && num(session.turns),
    ctx: session && num(session.ctx),
    tokens,
  }
}

/** The toasts owed for the change from one board to the next: integrations, rejections, a phase ending. */
export function events(prev: KssBoard | null, next: KssBoard | null): string[] {
  if (!prev || !next || prev.feature !== next.feature) return []
  const out: string[] = []
  const before = new Map(prev.tickets.map(t => [t.id, t.state]))
  for (const t of next.tickets) {
    const was = before.get(t.id)
    if (was === t.state || was === undefined) continue
    if (t.state === 'integrated') out.push(`kss ${short(next.feature)} · ticket ${t.id} integrated`)
    if (t.state === 'rejected') out.push(`kss ${short(next.feature)} · ticket ${t.id} rejected by review`)
  }
  if (!prev.isPhaseFinished && next.isPhaseFinished && prev.phase === next.phase) {
    out.push(next.isClosed ? `kss ${short(next.feature)} · run closed` : `kss ${short(next.feature)} · ${next.phase} done → ${next.next}`)
  }
  return out
}

export const short = (feature: string) => /^(\d+)/.exec(feature)?.[1] ?? feature

export function human(n: number | null): string {
  if (n === null || n <= 0) return '0'
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k'
  return String(n)
}

export function bar(done: number, total: number, width = 10): string {
  if (!total) return ''
  const filled = Math.max(0, Math.min(width, Math.round((done / total) * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

// ── The read guard ────────────────────────────────────────────────────────────────────────────
// Each skill's "Do not read" list (skills/kss-*/SKILL.md), as files of the feature folder. A
// trailing slash is a folder. Only the main loop is guarded: explorers and executors read source
// by design.

export const FORBIDDEN: Record<string, string[]> = {
  investigate: ['03-spec.md', '04-plan.md', '05-tickets/', '06-execution.md', '07-review.md'],
  'review-decisions': ['00-brief.md', '01-investigation.md', '03-spec.md', '04-plan.md', '05-tickets/'],
  grill: ['00-brief.md', '03-spec.md', '04-plan.md', '05-tickets/'],
  spec: ['04-plan.md', '05-tickets/', '06-execution.md'],
  plan: ['05-tickets/', '06-execution.md'],
  tickets: ['01-investigation.md', '06-execution.md'],
  execute: ['01-investigation.md', '02-decisions.md', '03-spec.md', '04-plan.md'],
  qa: ['04-plan.md', '05-tickets/'],
  'docs-tech': ['01-investigation.md', '03-spec.md'],
  'docs-product': ['01-investigation.md', '04-plan.md', '06-execution.md'],
}

/** Phases whose coordinator never reads application source (strict mode). */
export const NO_SOURCE = new Set([
  'clarify', 'investigate', 'review-decisions', 'grill', 'spec', 'plan', 'tickets', 'execute', 'qa',
  'review', 'docs-tech', 'docs-product',
])

export type GuardMode = 'phase-files' | 'strict' | 'off'

const norm = (p: string) => p.replace(/\/+/g, '/').replace(/\/$/, '')

function under(path: string, root: string): boolean {
  const r = norm(root)
  return path === r || path.startsWith(r + '/')
}

/**
 * The reason a Read of `path` is refused in `phase`, or null. `path` is absolute, `cwd` the
 * session's working directory. A path outside `cwd` is never refused (`~/.kss/preferences.md`).
 */
export function guard(mode: GuardMode, phase: string, path: string, cwd: string, config: KssConfig | null, feature: string | null): string | null {
  if (mode === 'off' || !config) return null
  const p = norm(path)
  const root = norm(cwd)
  if (!under(p, root)) return null
  const rel = p.slice(root.length + 1)
  const featuresRoot = norm(config.featuresRoot)

  const files = FORBIDDEN[phase] ?? []
  if (feature && files.length && under(rel, `${featuresRoot}/${feature}`)) {
    const inFeature = rel.slice(featuresRoot.length + feature.length + 2)
    const hit = files.find(f => (f.endsWith('/') ? inFeature.startsWith(f) : inFeature === f))
    if (hit) return `kss-${phase} does not read ${hit} — the rule in its SKILL.md "Do not read" list. Work from the README and the inputs the skill names.`
  }

  if (mode !== 'strict' || !NO_SOURCE.has(phase)) return null
  const allowed = [featuresRoot, '.kss', '.claude', 'docs', config.docsRoot, ...config.domainDocs, 'CONTEXT.md', 'CLAUDE.md', 'AGENTS.md']
    .filter((a): a is string => !!a)
    .map(a => norm(a.replace(/^\.\//, '')))
  if (allowed.some(a => under(rel, a))) return null
  return `kss-${phase} does not read application source (${rel}). Spawn an explorer for a repository fact, as the skill says.`
}
