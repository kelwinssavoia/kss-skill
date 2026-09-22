#!/usr/bin/env node
// render-cost.mjs <feature-dir>
//
// Aggregates <feature-dir>/metrics.jsonl per phase (and per ticket inside the
// execute phase) and rewrites the `## Cost` block of <feature-dir>/README.md
// between the markers <!-- kss:cost:start --> / <!-- kss:cost:end -->.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const START = '<!-- kss:cost:start -->'
const END = '<!-- kss:cost:end -->'

/**
 * One subagent's budget (DESIGN.md §3.6). Exceeding it is not an error, it is a
 * sizing signal: cost inside one agent grows with the SQUARE of its turns,
 * because every turn resends the whole context. An agent at twice the budget
 * costs roughly four times a right-sized one.
 */
export const TURN_BUDGET = 80
export const CTX_BUDGET = 150000

const PHASE_ORDER = [
  'clarify',
  'investigate',
  'review-decisions',
  'grill',
  'spec',
  'plan',
  'tickets',
  'execute',
  'review',
  'docs-tech',
  'docs-product',
]

function human(n) {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(n)
}

function wall(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const m = Math.round(ms / 60000)
  if (m < 60) return m + 'm'
  return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0')
}

function blank(label) {
  return {
    label,
    harnesses: new Set(),
    agents: 0,
    turns: 0,
    fresh_in: 0,
    cache_write: 0,
    cache_read: 0,
    out: 0,
    cumulative: 0,
    first: null,
    last: null,
    files: 0,
    added: 0,
    deleted: 0,
  }
}

function add(acc, o) {
  if (typeof o.harness === 'string' && o.harness) acc.harnesses.add(o.harness)
  // A `git` row is a ticket's diff, not an agent. Counting it was how a ticket
  // whose agents had been mislabelled still reported "1 agent, 0 turns".
  if (o.kind === 'subagent' || o.kind === 'session') acc.agents += 1
  acc.turns += num(o.turns)
  const t = o.tokens || {}
  acc.fresh_in += num(t.fresh_in)
  acc.cache_write += num(t.cache_write)
  acc.cache_read += num(t.cache_read)
  acc.out += num(t.out)
  acc.cumulative += num(t.cumulative)
  const g = o.git || {}
  acc.files += num(g.files)
  acc.added += num(g.added)
  acc.deleted += num(g.deleted)
  const end = Date.parse(o.ts || '')
  if (Number.isFinite(end)) {
    const start = end - num(o.duration_ms)
    if (acc.first === null || start < acc.first) acc.first = start
    if (acc.last === null || end > acc.last) acc.last = end
  }
}

function num(x) {
  return typeof x === 'number' && Number.isFinite(x) ? x : 0
}

/** Phases run from more than one harness print both — that is the handoff, visible in the table. */
function harnesses(a) {
  return a.harnesses.size ? [...a.harnesses].sort().join(' + ') : '—'
}

function row(a) {
  return `| ${a.label} | ${harnesses(a)} | ${a.agents} | ${a.turns} | ${human(a.fresh_in)} | ${human(a.cache_write)} | ${human(
    a.cache_read
  )} | ${human(a.out)} | ${human(a.cumulative)} | ${wall(a.first !== null && a.last !== null ? a.last - a.first : 0)} | ${
    a.files
  } | +${a.added}/−${a.deleted} |`
}

function rows(text) {
  const out = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const o = JSON.parse(line)
      if (o && typeof o === 'object') out.push(o)
    } catch {
      /* a half-written line is skipped, never fatal */
    }
  }
  return out
}

/**
 * metrics.jsonl → per-phase and per-ticket totals, plus the agents that ran
 * over budget.
 *
 * The ticket an agent is credited to comes from the `spawn` row the coordinator
 * writes when it creates the agent, matched on the tool-call id in `parent`.
 * The `ticket` the SubagentStop hook writes is whatever was live in
 * `.kss/current` when the agent stopped, which is the wrong answer for every
 * agent but the last one whenever tickets run in parallel.
 */
export function aggregate(text) {
  const all = rows(text)

  const ticketOfParent = new Map()
  for (const o of all) {
    if (o.kind === 'spawn' && o.parent && o.ticket) ticketOfParent.set(String(o.parent), String(o.ticket))
  }

  const phases = new Map()
  const tickets = new Map()
  const totals = blank('**Total**')
  const offenders = []

  for (const o of all) {
    if (o.kind === 'spawn') continue

    const phase = typeof o.phase === 'string' && o.phase ? o.phase : 'unknown'
    if (!phases.has(phase)) phases.set(phase, blank(phase))
    add(phases.get(phase), o)
    add(totals, o)

    const claimed = o.parent ? ticketOfParent.get(String(o.parent)) : undefined
    const ticket = claimed ?? (o.ticket ? String(o.ticket) : null)
    if (phase === 'execute' && ticket) {
      if (!tickets.has(ticket)) tickets.set(ticket, blank(`　└ ticket ${ticket}`))
      add(tickets.get(ticket), o)
    }

    if (o.kind === 'subagent') {
      const turns = num(o.turns)
      const ctx = num((o.tokens || {}).ctx_end)
      const over = []
      if (turns > TURN_BUDGET) over.push('turns')
      if (ctx > CTX_BUDGET) over.push('context')
      if (over.length) {
        offenders.push({ ticket, agent_type: o.agent_type ?? null, agent_id: o.agent_id ?? null, turns, ctx_end: ctx, over })
      }
    }
  }

  // Worst first, by how far past its budget the agent went rather than by raw
  // turns: 309k of context on a 150k budget is the more useful headline.
  offenders.sort((a, b) => overage(b) - overage(a))

  return { phases, tickets, totals, offenders }
}

function overage(o) {
  return Math.max(o.turns / TURN_BUDGET, o.ctx_end / CTX_BUDGET)
}

function budgetLines(offenders) {
  if (!offenders.length) return []
  const lines = ['', `**Over budget** (${TURN_BUDGET} turns / ${human(CTX_BUDGET)} context per subagent):`, '']
  for (const o of offenders) {
    const what = o.over
      .map((k) =>
        k === 'turns' ? `${o.turns} turns (${Math.round((o.turns / TURN_BUDGET) * 100)}%)` : `${human(o.ctx_end)} context (${Math.round((o.ctx_end / CTX_BUDGET) * 100)}%)`
      )
      .join(', ')
    lines.push(`- ticket ${o.ticket ?? '—'} · ${o.agent_type ?? 'subagent'} — ${what}`)
  }
  return lines
}

function main() {
  const dir = resolve(process.argv[2] || '.')
  const metrics = join(dir, 'metrics.jsonl')
  const readme = join(dir, 'README.md')

  if (!existsSync(metrics)) {
    console.error(`render-cost: no metrics.jsonl in ${dir}`)
    process.exit(0)
  }

  const { phases, tickets, totals, offenders } = aggregate(readFileSync(metrics, 'utf8'))

  const ordered = [...phases.keys()].sort((a, b) => {
    const ia = PHASE_ORDER.indexOf(a)
    const ib = PHASE_ORDER.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

  const lines = [
    '| Phase | Harness | Agents | Turns | Fresh in | Cache write | Cache read | Out | Cumulative | Wall | Files | +/− |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const p of ordered) {
    lines.push(row(phases.get(p)))
    if (p === 'execute') {
      for (const k of [...tickets.keys()].sort()) lines.push(row(tickets.get(k)))
    }
  }
  lines.push(row(totals))
  lines.push(...budgetLines(offenders))

  const block = `${START}\n\n${lines.join('\n')}\n\n${END}`

  let text = existsSync(readme) ? readFileSync(readme, 'utf8') : `# ${dir.split('/').pop()}\n\n## Cost\n\n${START}\n${END}\n`

  if (text.includes(START) && text.includes(END)) {
    text = text.replace(new RegExp(`${START}[\\s\\S]*?${END}`), () => block)
  } else if (/^## Cost\s*$/m.test(text)) {
    text = text.replace(/^## Cost\s*$/m, `## Cost\n\n${block}`)
  } else {
    text = text.trimEnd() + `\n\n## Cost\n\n${block}\n`
  }

  writeFileSync(readme, text)
  const over = offenders.length ? `, ${offenders.length} agent(s) over budget` : ''
  console.log(`render-cost: wrote ${ordered.length} phase row(s) to ${readme}${over}`)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
