#!/usr/bin/env node
// review.mjs — which reviewer a finished ticket gets.
//
//   node .kss/scripts/review.mjs pick '<json>'    {depth?, harness?, domain_risk?} → the reviewer to spawn
//   node .kss/scripts/review.mjs wait --pr <n|url> --since <ISO> [--until <ISO>] [--every 60] [--slice 540]
//       kss-review --loop: poll the PR every `--every` seconds for what came after `--since` (the
//       push), and print one JSON line once there is an answer — `new` (comments, a review, a failed
//       check: run a round), `clean` (the reviewer says it found nothing), `closed` (merged or
//       closed), `timeout` (`--until` passed with nothing). A call returns `pending` after `--slice`
//       seconds so it fits one foreground command; call it again with the same `--until`.
//
// `kss-execute` reviews every finished ticket. The depth is `full` unless the coordinator was told
// `light` — by Jev's `review_depth` classification, gated at `jev.reasoning.confidence`. This script
// only turns a depth into a reviewer: `models.review.<depth>.<harness>` from the layered config
// (DEFAULTS ← `.kss/config.json` ← `.kss/config.local.json`, the same files `jev.mjs` reads), checked
// against the reviewer agents that exist and against `models.allowed` / `models.efforts`.
//
// Two rules hold whatever the config says (DESIGN.md §20.2): a ticket carrying any domain-risk
// category is reviewed `full`, and a missing or refused value falls back to the default row — a
// broken config never buys a cheaper review than the default. Exit 0 carries the JSON answer,
// exit 1 is a usage error.

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULTS, loadLocalConfig } from './jev.mjs'
import { detect } from './harness.mjs'

export const DEPTHS = ['full', 'light']
export const HARNESSES = ['claude-code', 'codex']

/** Claude Code reviewer agents → the pair each carries in its frontmatter. */
export const REVIEWER_AGENTS = {
  'kss-reviewer-sonnet-low': { model: 'sonnet', effort: 'low' },
  'kss-reviewer-sonnet-medium': { model: 'sonnet', effort: 'medium' },
  'kss-reviewer-sonnet-high': { model: 'sonnet', effort: 'high' },
  'kss-reviewer-opus-medium': { model: 'opus', effort: 'medium' },
  'kss-reviewer': { model: 'opus', effort: 'high' },
}

// Capability order, for flagging a full review configured below the default.
const MODEL_RANK = { sonnet: 1, opus: 2 }
const EFFORT_RANK = { low: 1, medium: 2, high: 3 }

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x)
}

function agentFor(pair) {
  return Object.keys(REVIEWER_AGENTS).find((n) => REVIEWER_AGENTS[n].model === pair.model && REVIEWER_AGENTS[n].effort === pair.effort)
}

/** One configured value → `{ ok, row }` or `{ ok: false, why }`. `row` is the resolved reviewer. */
function resolveValue(value, harness, models) {
  const allowed = isObj(models.allowed) && Array.isArray(models.allowed[harness]) ? models.allowed[harness] : []
  const efforts = Array.isArray(models.efforts) ? models.efforts : []
  const checkPair = (model, effort) => {
    if (allowed.length && !allowed.includes(model)) return `${model} is not in models.allowed.${harness}`
    if (efforts.length && !efforts.includes(effort)) return `${effort} is not in models.efforts`
    return null
  }

  if (harness === 'claude-code') {
    let pair
    if (typeof value === 'string') {
      const name = value.replace(/^kss:/, '')
      if (!REVIEWER_AGENTS[name]) return { ok: false, why: `${value} is not a reviewer agent (${Object.keys(REVIEWER_AGENTS).join(', ')})` }
      pair = REVIEWER_AGENTS[name]
    } else if (isObj(value) && typeof value.model === 'string' && typeof value.effort === 'string') {
      pair = { model: value.model, effort: value.effort }
      if (!agentFor(pair)) return { ok: false, why: `no reviewer agent carries ${pair.model}/${pair.effort}` }
    } else {
      return { ok: false, why: 'a claude-code value is {model, effort} or a kss-reviewer* agent name' }
    }
    const bad = checkPair(pair.model, pair.effort)
    if (bad) return { ok: false, why: bad }
    return { ok: true, row: { agent: agentFor(pair), model: pair.model, effort: pair.effort } }
  }

  if (!isObj(value) || typeof value.model !== 'string' || typeof value.reasoning_effort !== 'string') {
    return { ok: false, why: 'a codex value is {model, reasoning_effort}' }
  }
  const bad = checkPair(value.model, value.reasoning_effort)
  if (bad) return { ok: false, why: bad }
  return { ok: true, row: { model: value.model, reasoning_effort: value.reasoning_effort } }
}

function belowDefault(row, def, harness) {
  if (harness === 'claude-code') {
    return (MODEL_RANK[row.model] ?? 0) < (MODEL_RANK[def.model] ?? 0) || (EFFORT_RANK[row.effort] ?? 0) < (EFFORT_RANK[def.effort] ?? 0)
  }
  // Codex model names carry no order KSS can trust; only the effort is compared.
  return (EFFORT_RANK[row.reasoning_effort] ?? 0) < (EFFORT_RANK[def.reasoning_effort] ?? 0)
}

/** Pure: `{depth?, harness, domain_risk?}` + effective config → the reviewer to spawn. */
export function pickReviewer(input, cfg) {
  const inp = isObj(input) ? input : {}
  const requested = inp.depth === undefined || inp.depth === null ? 'full' : inp.depth
  if (!DEPTHS.includes(requested)) throw new Error(`depth must be one of ${DEPTHS.join(', ')}`)
  if (!HARNESSES.includes(inp.harness)) throw new Error(`harness must be one of ${HARNESSES.join(', ')}`)
  const harness = inp.harness

  const risk = Array.isArray(inp.domain_risk) ? inp.domain_risk.filter((r) => typeof r === 'string' && r.trim()) : []
  let depth = requested
  let reason = requested === 'full' ? 'full review' : 'light review requested'
  if (risk.length && depth !== 'full') {
    depth = 'full'
    reason = `domain risk pins a full review: ${risk.join(', ')}`
  }

  const models = isObj(cfg && cfg.models) ? cfg.models : DEFAULTS.models
  const defaults = DEFAULTS.models.review
  const configured = isObj(models.review) && isObj(models.review[depth]) ? models.review[depth][harness] : undefined
  const defaultRow = (d) => resolveValue(defaults[d][harness], harness, { allowed: {}, efforts: [] }).row
  const def = defaultRow(depth)

  let row = def
  let source = 'default'
  let warning
  const isDefault = configured === undefined || JSON.stringify(configured) === JSON.stringify(defaults[depth][harness])
  if (!isDefault) {
    const r = resolveValue(configured, harness, models)
    if (r.ok) {
      row = r.row
      source = 'config'
    } else {
      warning = `models.review.${depth}.${harness} refused: ${r.why}; the default reviewer stands`
    }
  }

  const result = { depth, requested, harness, ...row, source, reason, below_default: depth === 'full' && belowDefault(row, def, harness) }
  if (warning) result.warning = warning
  return result
}

// ---------------------------------------------------------------- wait (kss-review --loop)

/** What a reviewer writes when its pass found nothing — Codex's `Didn't find any major issues`, and kin. */
export const CLEAN = [
  /didn[’']?t find any (major |new )?(issues|problems|bugs)/i,
  /no (major |new )?(issues|problems|bugs) (were )?found/i,
  /found no (major |new )?(issues|problems|bugs)/i,
  /nothing (new )?to (report|flag)/i,
]

const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])

const login = (a) => (a && (a.login ?? a.name)) || null
const after = (at, since) => !!at && Date.parse(at) > Date.parse(since)
const cut = (t, n = 200) => { const x = String(t ?? '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x }

/**
 * Pure: one snapshot of the PR → what happened after `since`, leaving out the person's own replies
 * (`me`, the account kss-review replies with). A finding — an inline comment, a review or comment
 * that is not a clean pass, a failed check — outweighs a clean pass in the same snapshot.
 */
export function classify(snap, { since, me }) {
  if (snap.state === 'MERGED' || snap.state === 'CLOSED') return { outcome: 'closed', events: [] }
  const theirs = (who) => who && who !== me
  const events = []
  let clean = false
  for (const c of snap.comments ?? []) {
    if (!after(c.createdAt, since) || !theirs(login(c.author))) continue
    if (CLEAN.some((r) => r.test(c.body ?? ''))) clean = true
    else events.push({ kind: 'comment', author: login(c.author), at: c.createdAt, text: cut(c.body) })
  }
  for (const r of snap.reviews ?? []) {
    if (!after(r.submittedAt, since) || !theirs(login(r.author))) continue
    if (r.state === 'APPROVED' || CLEAN.some((x) => x.test(r.body ?? ''))) clean = true
    // A review with no body only carries its inline comments, counted below.
    else if ((r.body ?? '').trim()) events.push({ kind: 'review', author: login(r.author), at: r.submittedAt, text: cut(r.body) })
  }
  for (const c of snap.inline ?? []) {
    if (!after(c.created_at, since) || !theirs(login(c.user))) continue
    events.push({ kind: 'inline', author: login(c.user), at: c.created_at, text: cut(`${c.path ?? ''}${c.line ? `:${c.line}` : ''} ${c.body ?? ''}`) })
  }
  for (const k of snap.checks ?? []) {
    if (FAILED.has(k.conclusion) && after(k.completedAt, since)) events.push({ kind: 'check', author: null, at: k.completedAt, text: cut(`${k.name ?? k.context ?? 'check'} ${k.conclusion}`) })
  }
  // A thumbs-up from a bot on the PR is how some reviewers say "looked, nothing found".
  for (const x of snap.reactions ?? []) {
    if (x.content === '+1' && after(x.created_at, since) && /\[bot\]$/.test(login(x.user) ?? '')) clean = true
  }
  if (events.length) return { outcome: 'new', events }
  return { outcome: clean ? 'clean' : null, events: [] }
}

function gh(args, cwd) {
  const r = spawnSync('gh', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error((r.stderr || r.error?.message || `gh ${args[0]} failed`).trim())
  return r.stdout
}

const pages = (text) => JSON.parse(`[${text.trim().replace(/\]\s*\[/g, '],[')}]`).flat()

function snapshot(pr, cwd) {
  const view = JSON.parse(gh(['pr', 'view', pr, '--json', 'number,state,comments,reviews,statusCheckRollup'], cwd))
  const n = view.number
  return {
    state: view.state,
    comments: view.comments,
    reviews: view.reviews,
    checks: view.statusCheckRollup,
    inline: pages(gh(['api', '--paginate', `repos/{owner}/{repo}/pulls/${n}/comments?per_page=100`], cwd)),
    reactions: pages(gh(['api', '--paginate', `repos/{owner}/{repo}/issues/${n}/reactions?per_page=100`], cwd)),
  }
}

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

function wait(flags, cwd) {
  const { pr, since } = flags
  if (!pr || !since || !Number.isFinite(Date.parse(since))) out({ error: 'wait needs --pr and --since <ISO>' }, 1)
  const until = flags.until ?? new Date(Date.now() + 20 * 60_000).toISOString()
  const every = Math.max(10, Number(flags.every ?? 60)) * 1000
  const stopAt = Date.now() + Math.max(30, Number(flags.slice ?? 540)) * 1000
  let me = null
  try {
    me = gh(['api', 'user', '--jq', '.login'], cwd).trim()
  } catch {
    /* unknown: no reply is left out, at worst a round finds nothing new */
  }
  let checks = 0
  let failures = 0
  for (;;) {
    checks++
    try {
      const r = classify(snapshot(pr, cwd), { since, me })
      failures = 0
      if (r.outcome) out({ ...r, pr, since, until, checks, at: new Date().toISOString() })
    } catch (e) {
      if (++failures >= 3) out({ outcome: 'error', error: e.message, pr, since, until, checks }, 2)
    }
    const now = Date.now()
    if (now >= Date.parse(until)) out({ outcome: 'timeout', events: [], pr, since, until, checks, at: new Date(now).toISOString() })
    if (now + every > stopAt) out({ outcome: 'pending', events: [], pr, since, until, checks, at: new Date(now).toISOString() })
    pause(Math.min(every, Math.max(0, Date.parse(until) - now)))
  }
}

// ---------------------------------------------------------------- CLI

function out(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n')
  process.exit(code)
}

function usage() {
  process.stderr.write('usage: review.mjs wait --pr <n|url> --since <ISO> [--until <ISO>] [--every 60] [--slice 540] [--cwd <dir>]\n')
  process.stderr.write("usage: review.mjs pick '{\"depth\":\"full|light\",\"harness\":\"claude-code|codex\",\"domain_risk\":[…]}' [--cwd <dir>]\n")
  process.exit(1)
}

function main() {
  const argv = process.argv.slice(2)
  const i = argv.indexOf('--cwd')
  const cwd = i !== -1 && argv[i + 1] ? argv[i + 1] : process.cwd()
  const rest = i === -1 ? argv : argv.filter((a, k) => !(k === i || k === i + 1))
  const [cmd, json] = rest
  if (cmd === 'wait') {
    const flags = {}
    for (let k = 1; k < rest.length; k++) if (rest[k].startsWith('--')) flags[rest[k].slice(2)] = rest[++k]
    return wait(flags, cwd)
  }
  if (cmd !== 'pick') usage()

  let input = {}
  if (json !== undefined) {
    try {
      input = JSON.parse(json)
    } catch {
      out({ error: 'argument is not valid JSON' }, 1)
    }
  }
  if (!isObj(input)) out({ error: 'argument must be a JSON object' }, 1)
  if (input.harness === undefined) {
    const h = detect({ cwd }).name
    input = { ...input, harness: HARNESSES.includes(h) ? h : 'claude-code' }
  }

  const { cfg } = loadLocalConfig(cwd)
  try {
    out(pickReviewer(input, cfg))
  } catch (e) {
    out({ error: e.message }, 1)
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
