// The KSS model this mod draws from: pure functions over the text of `.kss/current`,
// `.kss/config.md` and the feature README. Nothing here touches `$`, so the tests drive it directly.
// The tracks mirror scripts/next.mjs (DESIGN.md §3.9), the one place that owns them.

import type { KssBoard, KssGrill, KssGrillCategory, KssLogEntry, KssPending, KssPhase, KssQuota, KssQuotaWindow, KssTicket } from '../types'

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

export type KssGraphRow = { title: string; blockedBy: string[]; tier: string | null; est: number | null }

/** `05-tickets/graph.md`'s multi-agent table: `| # | Ticket | Layer | Blocked by | Tier | Est. turns | Worktree |`. */
export function parseGraph(text: string | null): Record<string, KssGraphRow> {
  const out: Record<string, KssGraphRow> = {}
  for (const line of (text ?? '').split('\n')) {
    const cells = line.split('|').slice(1, -1).map(c => c.trim())
    if (cells.length < 6 || !/^\d{2}$/.test(cells[0]!)) continue
    const est = Number.parseInt(cells[5]!, 10)
    out[cells[0]!] = {
      title: cells[1] || '',
      blockedBy: (cells[3]!.match(/\d{2}/g) ?? []).filter(id => id !== cells[0]),
      tier: /^T\d$/.test(cells[4]!) ? cells[4]! : null,
      est: Number.isFinite(est) ? est : null,
    }
  }
  return out
}

/** The last `n` entries of `06-execution.md`'s Log, newest last. */
export function parseLog(text: string | null, n = 6): KssLogEntry[] {
  const out: KssLogEntry[] = []
  for (const line of (text ?? '').split('\n')) {
    const m = /^-\s*`([^`]+)`\s*·\s*(?:\*\*(\w+)\*\*\s*·\s*)?([^·]+?)\s*(?:·\s*(.*))?$/.exec(line.trim())
    if (!m || m[1]!.includes('{{')) continue
    out.push({ at: m[1]!, ticket: m[2] ?? null, event: m[3]!.trim(), detail: (m[4] ?? '').trim() })
  }
  return out.slice(-n)
}

function tickets(current: Json, graph: Record<string, KssGraphRow>): KssTicket[] {
  const map = obj(current.tickets) ?? {}
  const ids = new Set([...Object.keys(graph), ...Object.keys(map)])
  return [...ids]
    .map(id => {
      const r = obj(map[id]) ?? {}
      const g = graph[id]
      return {
        id,
        title: g?.title || null,
        state: str(r.state) ?? (g ? 'ready' : '—'),
        tier: str(r.tier) ?? str(r.agent_type) ?? g?.tier ?? null,
        turns: num(r.turns),
        est: num(r.est_turns) ?? g?.est ?? null,
        startedAt: str(r.started_at),
        blockedBy: g?.blockedBy ?? [],
      }
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

export type KssExtra = { graph?: string | null; log?: string | null }

export function buildBoard(current: Json | null, readme: KssReadme, tokens: number | null, extra: KssExtra = {}): KssBoard | null {
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
    tickets: tickets(current, parseGraph(extra.graph ?? null)),
    integrated: execution && num(execution.integrated),
    total: execution && num(execution.total),
    last: execution && str(execution.last),
    explorers: explorers ? { running: num(explorers.running) ?? 0, returned: num(explorers.returned) ?? 0 } : null,
    grill: phase === 'grill' ? grill(current) : null,
    review: review ? { round: num(review.round), watching: str(review.watching) } : null,
    turns: session && num(session.turns),
    ctx: session && num(session.ctx),
    tokens,
    phaseStartedAt: str(current.phase_started_at),
    log: parseLog(extra.log ?? null),
  }
}

/** `/kss-tickets 048-x` (or `/kss:kss-tickets 048-x`) as a command run → the phase it starts. */
export function invocation(command: string, args: string): KssPending | null {
  const phase = /^(?:kss:)?kss-([a-z-]+)$/.exec(command)?.[1]
  const feature = /^(\d{3}-[a-z0-9-]+)/.exec(args.trim())?.[1] ?? /^(\d{3})\b/.exec(args.trim())?.[1]
  return phase && ORDER.includes(phase) && feature ? { phase, feature } : null
}

/**
 * The board as it will be once the phase just started writes `.kss/current`: skills write the
 * phase on entry, but the band should not wait for the model to get there.
 */
export function withPending(b: KssBoard | null, pending: KssPending | null): KssBoard | null {
  if (!b || !pending || b.phase === pending.phase) return b
  // `/kss-tickets 048` names the feature by number alone; a different feature is another run.
  if (short(b.feature) !== short(pending.feature)) return b
  return {
    ...b,
    phase: pending.phase,
    isClosed: false,
    phases: phases(b.size, pending.phase, false),
    isPhaseFinished: false,
    grill: null,
    explorers: null,
  }
}

/** A Next line as a command to run: `/kss-tickets 048-x` → `{ command: 'kss-tickets', args: '048-x' }`. */
export function commandOf(next: string | null): { command: string; args: string } | null {
  const m = next ? /^\/([\w:-]+)\s*(.*)$/.exec(next.trim()) : null
  return m ? { command: m[1]!, args: m[2]!.trim() } : null
}

// ── Live execution ────────────────────────────────────────────────────────────────────────────

/**
 * The ticket an executor or reviewer spawn works on. kss-execute pastes the ticket and its
 * worktree path (`.kss/worktrees/NNN-slug/NN`) into the prompt; the description is the fallback.
 */
export function ticketOf(prompt: string, description: string): string | null {
  return (
    /worktrees\/[^/\s]+\/(\d{2})\b/.exec(prompt)?.[1] ??
    /\bticket\s*#?(\d{2})\b/i.exec(description)?.[1] ??
    /^#\s*(\d{2})\b/m.exec(prompt)?.[1] ??
    null
  )
}

const tail = (p: unknown) => (typeof p === 'string' ? p.split('/').slice(-2).join('/') : '')

/** One short line for what a tool call does: `Edit api/wallet.ts`, `$ git commit -m …`. */
export function describeTool(tool: string, input: Record<string, unknown>): string {
  const cut = (t: string, n = 56) => (t.length > n ? t.slice(0, n - 1) + '…' : t)
  switch (tool) {
    case 'Read':
    case 'Edit':
    case 'Write':
      return `${tool} ${tail(input.file_path)}`
    case 'Bash':
      return cut(`$ ${String(input.command ?? '').split('\n')[0]}`)
    case 'Grep':
      return cut(`Grep ${String(input.pattern ?? '')}`)
    case 'Glob':
      return cut(`Glob ${String(input.pattern ?? '')}`)
    case 'Agent':
      return cut(`Agent ${String(input.description ?? '')}`)
    default:
      return tool
  }
}

// ── Quota ─────────────────────────────────────────────────────────────────────────────────────

export type KssRateReading = { kind: string; percentUsed: number; resetsAt?: string }

/**
 * Folds a rate-limit reading into what this feature's execute has used. The first reading is the
 * baseline; a window that reset (a new `resetsAt`, a lower percent) carries what was used before it.
 */
export function trackQuota(prev: KssQuota | null, feature: string, readings: readonly KssRateReading[]): KssQuota {
  const before = prev && prev.feature === feature ? prev.windows : []
  const windows = readings
    .filter(r => r.kind === 'five_hour' || r.kind === 'seven_day')
    .map((r): KssQuotaWindow => {
      const w = before.find(x => x.kind === r.kind)
      const resetsAt = r.resetsAt ?? null
      if (!w) return { kind: r.kind, base: r.percentUsed, last: r.percentUsed, carried: 0, resetsAt }
      const hasReset = resetsAt !== null && w.resetsAt !== null && resetsAt !== w.resetsAt && r.percentUsed < w.last
      return hasReset
        ? { kind: r.kind, base: 0, last: r.percentUsed, carried: w.carried + Math.max(0, w.last - w.base), resetsAt }
        : { ...w, last: r.percentUsed, resetsAt: resetsAt ?? w.resetsAt }
    })
  // A window the reading left out keeps its last figures.
  for (const w of before) if (!windows.some(x => x.kind === w.kind)) windows.push(w)
  return { feature, windows }
}

/** Percent points of a window this run has used. */
export const usedBy = (w: KssQuotaWindow) => Math.round((w.carried + Math.max(0, w.last - w.base)) * 10) / 10

/** `session 62% (+18 this run) · resets in 2h10 │ week 41% (+6 this run)` */
export function quotaLine(q: KssQuota | null, nowMs: number): string | null {
  if (!q || q.windows.length === 0) return null
  const name = (k: string) => (k === 'five_hour' ? 'session' : 'week')
  const resets = (w: KssQuotaWindow) => {
    const t = w.resetsAt ? Date.parse(w.resetsAt) : NaN
    return w.kind === 'five_hour' && Number.isFinite(t) && t > nowMs ? ` · resets in ${since(nowMs, t)}` : ''
  }
  return [...q.windows]
    .sort((a, b) => a.kind.localeCompare(b.kind))
    .map(w => `${name(w.kind)} ${Math.round(w.last)}% (+${usedBy(w)} this run)${resets(w)}`)
    .join(' │ ')
}

/** `1h04`, `14m`, `38s`. */
export function since(fromMs: number | null, nowMs: number): string {
  if (fromMs === null || !Number.isFinite(fromMs)) return ''
  const s = Math.max(0, Math.round((nowMs - fromMs) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
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
