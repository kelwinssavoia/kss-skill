#!/usr/bin/env node
// next.mjs — the one place that knows the tracks (DESIGN.md §3.9).
//
//   node .kss/scripts/next.mjs <feature-dir> --after <phase> [--auto <n>] [--escalate grill]
//                                            [--harness claude-code|codex]
//       print the `Next:` line a skill ends with, for the feature's size (read from README.md)
//   node .kss/scripts/next.mjs <feature-dir> --check <phase>
//       print `on-track`, `optional` or `off-track` for running <phase> on this feature
//
// How a phase is invoked is the one harness-specific thing in the line: `/kss-spec` in Claude Code,
// `$kss-spec` in Codex (DESIGN.md §19). `--harness` forces it; otherwise it is detected.
//
// Sizes and tracks:
//   S  clarify → tickets → execute                                   (review, docs optional after)
//   M  clarify → investigate → spec → plan → tickets → execute → review   (docs optional after)
//   L  clarify → investigate → [review-decisions] → grill → spec → plan → tickets → execute
//      → review → docs-tech → docs-product
// kss-qa (the blind browser acceptance test, DESIGN.md §22) is optional on every track, right after
// execute; the Next line after execute offers it.
// On M the open decisions are settled inside kss-investigate (the decision check, §8.4); the grill
// runs on M only when the user escalates to it from that check.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ORDER = [
  'clarify', 'investigate', 'review-decisions', 'grill', 'spec', 'plan', 'tickets', 'execute',
  'qa', 'review', 'docs-tech', 'docs-product',
]

export const TRACKS = {
  S: ['clarify', 'tickets', 'execute'],
  M: ['clarify', 'investigate', 'spec', 'plan', 'tickets', 'execute', 'review'],
  L: ['clarify', 'investigate', 'grill', 'spec', 'plan', 'tickets', 'execute', 'review', 'docs-tech', 'docs-product'],
}

/** Phases a track does not require but may run: optional, never off-track. */
export const OPTIONAL = {
  S: ['qa', 'review', 'docs-tech', 'docs-product'],
  M: ['review-decisions', 'grill', 'qa', 'docs-tech', 'docs-product'],
  L: ['review-decisions', 'qa'],
}

export const TRACK_LINE = {
  S: 'clarify → tickets → execute',
  M: 'clarify → investigate → spec → plan → tickets → execute → review',
  L: 'clarify → investigate → grill → spec → plan → tickets → execute → review → docs-tech → docs-product',
}

/** `{ size, state, feature }` from the README header, or nulls for what is missing. */
export function readHeader(dir) {
  const out = { size: null, state: null, feature: null }
  try {
    const p = join(dir, 'README.md')
    if (!existsSync(p)) return out
    const text = readFileSync(p, 'utf8')
    const size = /\*\*Size:\*\*\s*([SML])\b/.exec(text)
    const state = /\*\*State:\*\*\s*([a-z][a-z-]*)/.exec(text)
    const title = /^#\s+(\d{3}-[a-z0-9-]+)/m.exec(text)
    if (size) out.size = size[1]
    if (state) out.state = state[1]
    if (title) out.feature = title[1]
  } catch {
    /* fall through with nulls */
  }
  return out
}

export function check(size, phase) {
  if (!TRACKS[size]) throw new Error(`unknown size ${size}`)
  if (TRACKS[size].includes(phase)) return 'on-track'
  if (OPTIONAL[size].includes(phase)) return 'optional'
  return 'off-track'
}

/**
 * The phase that follows `after` on the track of `size`, or null when the track is finished.
 * An optional or off-track phase that ran anyway resumes the track at the first phase whose
 * canonical position is later. Re-running review-decisions after the spec goes back to spec.
 */
export function nextPhase(size, after, opts = {}) {
  if (!TRACKS[size]) throw new Error(`unknown size ${size}`)
  if (!ORDER.includes(after)) throw new Error(`unknown phase ${after}`)
  if (after === 'investigate' && size === 'M' && opts.escalate === 'grill') return 'grill'
  if (after === 'review-decisions' && opts.state && ORDER.indexOf(opts.state) >= ORDER.indexOf('spec')) return 'spec'
  const pos = ORDER.indexOf(after)
  return TRACKS[size].find((p) => ORDER.indexOf(p) > pos) || null
}

/** How a phase is typed, per harness: `/kss-spec` here, `$kss-spec` there (DESIGN.md §19). */
export const PREFIX = { 'claude-code': '/', codex: '$' }

export function nextLine(size, after, feature, opts = {}) {
  const next = nextPhase(size, after, opts)
  const id = feature || 'NNN-slug'
  const p = PREFIX[opts.harness] || '/'
  if (next) {
    let line = `Next: ${p}kss-${next} ${id}`
    if (next === 'grill' && size === 'L' && Number(opts.auto) > 0) {
      line += ` (optional first: ${p}kss-review-decisions ${id})`
    }
    if (after === 'execute' && OPTIONAL[size].includes('qa')) line += ` (optional first: ${p}kss-qa ${id})`
    return line
  }
  const rest = OPTIONAL[size].filter((p2) => ORDER.indexOf(p2) > ORDER.indexOf(after))
  if (!rest.length) return `Next: feature ${id} is documented — nothing left to run.`
  const opt = rest.map((p2) => `${p}kss-${p2} ${id}`).join(' or ')
  return `Next: nothing on track ${size} — ${opt} ${rest.length > 1 ? 'are' : 'is'} optional.`
}

function arg(argv, name) {
  const i = argv.indexOf(name)
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}

async function resolveHarness(argv) {
  const forced = arg(argv, '--harness')
  if (forced) {
    if (!PREFIX[forced]) {
      console.error(`next.mjs: --harness must be one of ${Object.keys(PREFIX).join(', ')}`)
      process.exit(1)
    }
    return forced
  }
  try {
    const { detect } = await import('./harness.mjs')
    return detect().name
  } catch {
    return 'claude-code'
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const dir = argv[0] && !argv[0].startsWith('--') ? argv[0] : null
  if (!dir) {
    console.error('usage: node .kss/scripts/next.mjs <feature-dir> --after <phase> [--auto <n>] [--escalate grill] [--harness <name>] | --check <phase>')
    process.exit(1)
  }
  const h = readHeader(dir)
  if (!h.size) {
    console.error(`next.mjs: no "**Size:** S|M|L" in ${join(dir, 'README.md')}`)
    process.exit(1)
  }
  const checkPhase = arg(argv, '--check')
  if (checkPhase) {
    if (!ORDER.includes(checkPhase)) {
      console.error(`next.mjs: unknown phase ${checkPhase}`)
      process.exit(1)
    }
    process.stdout.write(check(h.size, checkPhase) + '\n')
    return
  }
  const after = arg(argv, '--after')
  if (!after || !ORDER.includes(after)) {
    console.error(`next.mjs: --after must be one of ${ORDER.join(', ')}`)
    process.exit(1)
  }
  const opts = {
    auto: arg(argv, '--auto'),
    escalate: arg(argv, '--escalate'),
    state: h.state,
    harness: await resolveHarness(argv),
  }
  process.stdout.write(nextLine(h.size, after, h.feature, opts) + '\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main()
