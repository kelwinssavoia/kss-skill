#!/usr/bin/env node
// render-cost.mjs <feature-dir>
//
// Aggregates <feature-dir>/metrics.jsonl per phase (and per ticket inside the
// execute phase) and rewrites the `## Cost` block of <feature-dir>/README.md
// between the markers <!-- kss:cost:start --> / <!-- kss:cost:end -->.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const START = '<!-- kss:cost:start -->'
const END = '<!-- kss:cost:end -->'

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
  acc.agents += 1
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

function row(a) {
  return `| ${a.label} | ${a.agents} | ${a.turns} | ${human(a.fresh_in)} | ${human(a.cache_write)} | ${human(
    a.cache_read
  )} | ${human(a.out)} | ${human(a.cumulative)} | ${wall(a.first !== null && a.last !== null ? a.last - a.first : 0)} | ${
    a.files
  } | +${a.added}/−${a.deleted} |`
}

function main() {
  const dir = resolve(process.argv[2] || '.')
  const metrics = join(dir, 'metrics.jsonl')
  const readme = join(dir, 'README.md')

  if (!existsSync(metrics)) {
    console.error(`render-cost: no metrics.jsonl in ${dir}`)
    process.exit(0)
  }

  const phases = new Map()
  const tickets = new Map()
  const totals = blank('**Total**')

  for (const line of readFileSync(metrics, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let o
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    if (!o || typeof o !== 'object') continue
    const phase = typeof o.phase === 'string' && o.phase ? o.phase : 'unknown'
    if (!phases.has(phase)) phases.set(phase, blank(phase))
    add(phases.get(phase), o)
    add(totals, o)
    if (phase === 'execute' && o.ticket) {
      const key = String(o.ticket)
      if (!tickets.has(key)) tickets.set(key, blank(`　└ ticket ${key}`))
      add(tickets.get(key), o)
    }
  }

  const ordered = [...phases.keys()].sort((a, b) => {
    const ia = PHASE_ORDER.indexOf(a)
    const ib = PHASE_ORDER.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

  const lines = [
    '| Phase | Agents | Turns | Fresh in | Cache write | Cache read | Out | Cumulative | Wall | Files | +/− |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const p of ordered) {
    lines.push(row(phases.get(p)))
    if (p === 'execute') {
      for (const k of [...tickets.keys()].sort()) lines.push(row(tickets.get(k)))
    }
  }
  lines.push(row(totals))

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
  console.log(`render-cost: wrote ${ordered.length} phase row(s) to ${readme}`)
}

main()
