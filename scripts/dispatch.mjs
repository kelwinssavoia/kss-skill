#!/usr/bin/env node
// dispatch.mjs — cross-harness execution: run one ticket in the *other* harness's CLI.
//
//   node .kss/scripts/dispatch.mjs pick    '<json>'   which harness gets this ticket, per the split
//   node .kss/scripts/dispatch.mjs command '<json>'   the exact CLI command for a foreign run (dry)
//   node .kss/scripts/dispatch.mjs run     '<json>'   run it: brief in, report out, metrics written
//   node .kss/scripts/dispatch.mjs status  <feature-dir>   observed split so far
//
// The coordinator runs in one harness (`harness.mjs`), and `execution.cross_harness` in the
// gitignored `.kss/config.local.json` says which harnesses may execute tickets and in what
// proportion. `pick` keeps the observed split as close to the target as it can (largest-deficit
// assignment over the feature's `dispatch.jsonl`), and never sends a tier the config excludes.
// `run` is what the light `dispatcher` role executes: one command, one report back, one metrics
// line — the SubagentStop hook never fires for a CLI child, so this script writes the line itself
// (DESIGN.md §21). Exit codes: 0 answer · 3 cross-harness off / local · 2 the CLI failed · 1 usage.

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { delimiter } from 'node:path'

const lib = await (async () => {
  try {
    return await import('./kss-lib.mjs')
  } catch {
    return await import('../hooks/kss-lib.mjs')
  }
})()
const { readJsonFile, readCurrent, featureDir, appendMetric } = lib

export const HARNESSES = ['claude-code', 'codex']
export const LOCAL_CONFIG = '.kss/config.local.json'

/** Mirrors `references/tiers.md`; `models.tiers` in the local config overrides a row. */
export const TIER_DEFAULTS = {
  'claude-code': {
    T1: { model: 'sonnet', effort: 'low' },
    T2: { model: 'sonnet', effort: 'medium' },
    T3: { model: 'sonnet', effort: 'high' },
    T4: { model: 'opus', effort: 'medium' },
    T5: { model: 'opus', effort: 'high' },
  },
  codex: {
    T1: { model: 'gpt-5.6-luna', effort: 'low' },
    T2: { model: 'gpt-5.6-terra', effort: 'medium' },
    T3: { model: 'gpt-5.6-terra', effort: 'high' },
    T4: { model: 'gpt-6-astra', effort: 'medium' },
    T5: { model: 'gpt-6-astra', effort: 'high' },
  },
}

/** Claude Code agent name → model/effort, for a `models.tiers` override written as an agent name. */
const AGENT_TO_PAIR = {
  'kss-sonnet-low': { model: 'sonnet', effort: 'low' },
  'kss-sonnet-medium': { model: 'sonnet', effort: 'medium' },
  'kss-sonnet-high': { model: 'sonnet', effort: 'high' },
  'kss-opus-medium': { model: 'opus', effort: 'medium' },
  'kss-opus-high': { model: 'opus', effort: 'high' },
}

export const DEFAULTS = {
  enabled: false,
  split: { 'claude-code': 50, codex: 50 },
  tiers: ['T1', 'T2', 'T3'],
  timeout_ms: 3600000,
  cli: {
    'claude-code': {
      bin: 'claude',
      permission_mode: 'acceptEdits',
      allowed_tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash(git *)'],
      max_turns: 80,
    },
    codex: {
      bin: 'codex',
      sandbox: 'workspace-write',
      approval_policy: 'never',
    },
  },
}

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x)
}

function deepMerge(base, patch) {
  if (!isObj(patch)) return patch === undefined ? base : patch
  const out = isObj(base) ? { ...base } : {}
  for (const [k, v] of Object.entries(patch)) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v
  return out
}

/** `{ cross, tiers }`: the cross-harness block merged over DEFAULTS, and the models.tiers overrides. */
export function loadConfig(cwd = process.cwd()) {
  const raw = readJsonFile(resolve(cwd, LOCAL_CONFIG), null)
  const patch = isObj(raw) && isObj(raw.execution) && isObj(raw.execution.cross_harness) ? raw.execution.cross_harness : {}
  const cross = deepMerge(DEFAULTS, patch)
  // `split` and `tiers` are whole values, not maps to merge: `{codex: 100}` means codex only.
  if (isObj(patch.split)) cross.split = patch.split
  if (Array.isArray(patch.tiers)) cross.tiers = patch.tiers
  const tiers = isObj(raw) && isObj(raw.models) && isObj(raw.models.tiers) ? raw.models.tiers : {}
  return { present: isObj(raw), cross, tiers }
}

// ---------------------------------------------------------------- split

/** Normalise `{h: weight}` to shares summing to 1 over the harnesses with a positive weight. */
export function shares(split) {
  const entries = Object.entries(isObj(split) ? split : {}).filter(([h, w]) => HARNESSES.includes(h) && typeof w === 'number' && w > 0)
  const total = entries.reduce((s, [, w]) => s + w, 0)
  if (!total) return {}
  return Object.fromEntries(entries.map(([h, w]) => [h, w / total]))
}

/** Count dispatched tickets per harness from `<feature>/dispatch.jsonl`. */
export function observed(dir) {
  const counts = Object.fromEntries(HARNESSES.map((h) => [h, 0]))
  try {
    const p = join(dir, 'dispatch.jsonl')
    if (!existsSync(p)) return counts
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line) continue
      try {
        const o = JSON.parse(line)
        if (o && o.event === 'pick' && HARNESSES.includes(o.harness)) counts[o.harness]++
      } catch {
        /* skip */
      }
    }
  } catch {
    /* defaults */
  }
  return counts
}

/**
 * Largest-deficit assignment: the harness whose observed count is furthest below
 * `share × (n + 1)` gets the next ticket. Ties go to the local harness. Pure.
 */
export function choose({ local, split, counts, tier, allowedTiers, available }) {
  const sh = shares(split)
  const candidates = Object.keys(sh)
  if (!candidates.length || !candidates.includes(local)) return { harness: local, reason: 'split names no usable harness; staying local' }
  if (Array.isArray(allowedTiers) && !allowedTiers.includes(tier)) return { harness: local, reason: `tier ${tier} is not in cross_harness.tiers` }
  const n = candidates.reduce((s, h) => s + (counts[h] || 0), 0)
  let best = local
  let bestDeficit = -Infinity
  for (const h of candidates) {
    if (h !== local && available && !available[h]) continue
    const deficit = sh[h] * (n + 1) - (counts[h] || 0)
    if (deficit > bestDeficit + 1e-9 || (Math.abs(deficit - bestDeficit) <= 1e-9 && h === local)) {
      best = h
      bestDeficit = deficit
    }
  }
  return { harness: best, reason: best === local ? 'local has the largest deficit (or tie)' : 'foreign harness has the largest deficit', shares: sh, counts, n }
}

export function onPath(bin, env = process.env) {
  if (!bin) return false
  if (bin.includes('/')) return existsSync(bin)
  const dirs = String(env.PATH || '').split(delimiter).filter(Boolean)
  return dirs.some((d) => existsSync(join(d, bin)))
}

// ---------------------------------------------------------------- tier → model/effort

export function pairFor(harness, tier, overrides) {
  const base = (TIER_DEFAULTS[harness] || {})[tier]
  if (!base) return null
  const o = isObj(overrides) && isObj(overrides[tier]) ? overrides[tier][harness] : undefined
  if (harness === 'claude-code') {
    if (typeof o === 'string') return AGENT_TO_PAIR[o.replace(/^kss:/, '')] || base
    if (isObj(o) && typeof o.model === 'string') return { model: o.model, effort: typeof o.effort === 'string' ? o.effort : base.effort }
    return base
  }
  if (isObj(o) && typeof o.model === 'string') return { model: o.model, effort: typeof o.reasoning_effort === 'string' ? o.reasoning_effort : base.effort }
  return base
}

// ---------------------------------------------------------------- command

/** argv for the foreign CLI. The brief goes in on stdin; the report comes out as text. */
export function buildCommand({ harness, worktree, tier, cross, overrides, lastMessageFile }) {
  const pair = pairFor(harness, tier, overrides)
  if (!pair) throw new Error(`no tier mapping for ${harness} ${tier}`)
  const cli = cross.cli[harness] || {}
  if (harness === 'claude-code') {
    const argv = [cli.bin || 'claude', '-p', '--model', pair.model, '--effort', pair.effort, '--output-format', 'json', '--no-session-persistence']
    if (cli.permission_mode) argv.push('--permission-mode', cli.permission_mode)
    if (Array.isArray(cli.allowed_tools) && cli.allowed_tools.length) argv.push('--allowedTools', ...cli.allowed_tools)
    if (cli.max_turns) argv.push('--max-turns', String(cli.max_turns))
    return { argv, cwd: worktree, pair }
  }
  if (harness === 'codex') {
    const argv = [cli.bin || 'codex', 'exec', '--json', '--cd', worktree, '-m', pair.model, '-c', `model_reasoning_effort="${pair.effort}"`]
    if (cli.sandbox) argv.push('-s', cli.sandbox)
    if (cli.approval_policy) argv.push('-c', `approval_policy="${cli.approval_policy}"`)
    if (lastMessageFile) argv.push('-o', lastMessageFile)
    argv.push('-')
    return { argv, cwd: worktree, pair }
  }
  throw new Error(`unknown harness ${harness}`)
}

// ---------------------------------------------------------------- output parsing

/** Claude `--output-format json` result → { report, usage, turns, duration_ms, cost_usd }. */
export function parseClaude(stdout) {
  let o = null
  for (const line of String(stdout).split('\n').reverse()) {
    if (!line.trim()) continue
    try {
      const j = JSON.parse(line)
      if (j && j.type === 'result') {
        o = j
        break
      }
    } catch {
      /* skip */
    }
  }
  if (!o) return { report: String(stdout).trim(), usage: null, turns: 0, duration_ms: 0, cost_usd: null, ok: false }
  const u = o.usage || {}
  const n = (x) => (typeof x === 'number' ? x : 0)
  return {
    ok: !o.is_error,
    report: typeof o.result === 'string' ? o.result.trim() : '',
    usage: {
      fresh_in: n(u.input_tokens),
      cache_write: n(u.cache_creation_input_tokens),
      cache_read: n(u.cache_read_input_tokens),
      out: n(u.output_tokens),
    },
    turns: n(o.num_turns),
    duration_ms: n(o.duration_ms),
    cost_usd: typeof o.total_cost_usd === 'number' ? o.total_cost_usd : null,
    model: o.modelUsage ? Object.keys(o.modelUsage)[0] || null : null,
  }
}

/** Codex `exec --json` events → summed usage; the report is the -o file, else the last agent message. */
export function parseCodex(stdout, lastMessage) {
  const n = (x) => (typeof x === 'number' ? x : 0)
  const usage = { fresh_in: 0, cache_write: 0, cache_read: 0, out: 0 }
  let turns = 0
  let failed = null
  let lastText = ''
  for (const line of String(stdout).split('\n')) {
    if (!line.trim()) continue
    let e
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (!e || typeof e !== 'object') continue
    if (e.type === 'turn.completed' && isObj(e.usage)) {
      turns++
      const cr = n(e.usage.cached_input_tokens)
      const cw = n(e.usage.cache_write_input_tokens)
      usage.fresh_in += Math.max(0, n(e.usage.input_tokens) - cr - cw)
      usage.cache_read += cr
      usage.cache_write += cw
      usage.out += n(e.usage.output_tokens)
    }
    if (e.type === 'turn.failed') failed = e.error && e.error.message ? e.error.message : 'turn.failed'
    if (e.type === 'item.completed' && e.item && e.item.type === 'agent_message' && typeof e.item.text === 'string') lastText = e.item.text
  }
  const report = typeof lastMessage === 'string' && lastMessage.trim() ? lastMessage.trim() : lastText.trim()
  return { ok: !failed, error: failed, report, usage, turns, duration_ms: 0, cost_usd: null, model: null }
}

// ---------------------------------------------------------------- run

function runChild(argv, { cwd, input, timeoutMs, env = process.env }) {
  return new Promise((resolveP) => {
    const started = Date.now()
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      resolveP({ status: null, stdout, stderr: `${stderr}\n${e.message}`, timedOut, duration_ms: Date.now() - started })
    })
    child.on('close', (status) => {
      clearTimeout(timer)
      resolveP({ status, stdout, stderr, timedOut, duration_ms: Date.now() - started })
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

function appendDispatch(dir, line) {
  try {
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'dispatch.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...line }) + '\n')
  } catch {
    /* never fatal */
  }
}

// ---------------------------------------------------------------- CLI

function out(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n')
  process.exit(code)
}

function usage() {
  process.stderr.write(
    'usage: dispatch.mjs <pick|command|run> <json> | status <feature-dir>   [--cwd <dir>]\n' +
      '  pick    {feature, ticket, tier, local}\n' +
      '  command {harness, worktree, tier}\n' +
      '  run     {feature, ticket, tier, harness, worktree, brief_file}\n',
  )
  process.exit(1)
}

function parseArgs(argv) {
  const i = argv.indexOf('--cwd')
  const cwd = i !== -1 && argv[i + 1] ? argv[i + 1] : process.cwd()
  const rest = i === -1 ? argv : argv.filter((a, k) => !(k === i || k === i + 1))
  return { cwd, cmd: rest[0], arg: rest[1] }
}

function dirOf(cwd, feature) {
  if (!feature) return null
  if (isAbsolute(feature)) return feature
  const cur = { feature }
  return featureDir(cwd, cur)
}

async function main() {
  const { cwd, cmd, arg } = parseArgs(process.argv.slice(2))
  if (!cmd) usage()
  const { present, cross, tiers } = loadConfig(cwd)

  if (cmd === 'status') {
    const dir = dirOf(cwd, arg)
    if (!dir) usage()
    const counts = observed(dir)
    out({ enabled: cross.enabled, target: shares(cross.split), counts })
  }

  if (!['pick', 'command', 'run'].includes(cmd)) usage()
  if (!arg) usage()
  let input
  try {
    input = JSON.parse(arg)
  } catch {
    out({ error: 'argument is not valid JSON' }, 1)
  }

  if (cmd === 'command') {
    try {
      const built = buildCommand({ harness: input.harness, worktree: input.worktree, tier: input.tier, cross, overrides: tiers, lastMessageFile: input.last_message_file })
      out({ argv: built.argv, cwd: built.cwd, model: built.pair.model, effort: built.pair.effort })
    } catch (e) {
      out({ error: e.message }, 1)
    }
  }

  if (!cross.enabled) out({ enabled: false, harness: input.local || null, reason: present ? 'execution.cross_harness.enabled is false' : `${LOCAL_CONFIG} not found` }, 3)

  if (cmd === 'pick') {
    const local = HARNESSES.includes(input.local) ? input.local : null
    if (!local || !input.tier) out({ error: 'pick needs {feature, ticket, tier, local}' }, 1)
    const dir = dirOf(cwd, input.feature)
    const counts = dir ? observed(dir) : {}
    const available = Object.fromEntries(HARNESSES.map((h) => [h, h === local || onPath((cross.cli[h] || {}).bin)]))
    const c = choose({ local, split: cross.split, counts, tier: input.tier, allowedTiers: cross.tiers, available })
    const foreign = c.harness !== local
    if (dir && input.ticket) appendDispatch(dir, { event: 'pick', ticket: input.ticket, tier: input.tier, harness: c.harness, local, reason: c.reason })
    const pair = pairFor(c.harness, input.tier, tiers)
    out({ harness: c.harness, foreign, reason: c.reason, model: pair ? pair.model : null, effort: pair ? pair.effort : null, shares: c.shares || shares(cross.split), counts, unavailable: HARNESSES.filter((h) => !available[h]) }, foreign ? 0 : 3)
  }

  // run
  const { feature, ticket, tier, harness, worktree, brief_file } = input
  if (!HARNESSES.includes(harness) || !worktree || !tier || !brief_file) out({ error: 'run needs {feature, ticket, tier, harness, worktree, brief_file}' }, 1)
  if (!existsSync(worktree)) out({ error: `worktree does not exist: ${worktree}` }, 1)
  if (!existsSync(brief_file)) out({ error: `brief file does not exist: ${brief_file}` }, 1)
  const brief = readFileSync(brief_file, 'utf8')
  const dir = dirOf(cwd, feature)
  const lastMessageFile = harness === 'codex' ? join(worktree, '.kss-last-message.txt') : null
  let built
  try {
    built = buildCommand({ harness, worktree, tier, cross, overrides: tiers, lastMessageFile })
  } catch (e) {
    out({ error: e.message }, 1)
  }
  if (!onPath(built.argv[0])) out({ error: `${built.argv[0]} is not on PATH` }, 2)

  const r = await runChild(built.argv, { cwd: worktree, input: brief, timeoutMs: cross.timeout_ms })
  let parsed
  if (harness === 'claude-code') parsed = parseClaude(r.stdout)
  else {
    let last = ''
    try {
      last = existsSync(lastMessageFile) ? readFileSync(lastMessageFile, 'utf8') : ''
    } catch {
      /* ignore */
    }
    parsed = parseCodex(r.stdout, last)
    try {
      if (existsSync(lastMessageFile)) writeFileSync(lastMessageFile, '')
    } catch {
      /* ignore */
    }
  }
  const ok = r.status === 0 && !r.timedOut && parsed.ok !== false
  const tokens = parsed.usage || { fresh_in: 0, cache_write: 0, cache_read: 0, out: 0 }
  tokens.cumulative = tokens.fresh_in + tokens.cache_write + tokens.cache_read + tokens.out
  tokens.ctx_end = 0

  if (dir) {
    const cur = readCurrent(cwd)
    appendMetric(dir, {
      ts: new Date().toISOString(),
      phase: (cur && cur.phase) || 'execute',
      harness,
      ticket: ticket || null,
      kind: 'subagent',
      agent_type: `cross:${harness}:${tier}`,
      agent_id: null,
      model: parsed.model || built.pair.model,
      effort: built.pair.effort,
      parent: 'dispatcher',
      depth: 1,
      turns: parsed.turns || 0,
      duration_ms: parsed.duration_ms || r.duration_ms,
      tool_uses: 0,
      tokens,
      cost_usd: parsed.cost_usd,
      git: { files: 0, added: 0, deleted: 0, commits: 0 },
    })
    appendDispatch(dir, { event: 'run', ticket, tier, harness, ok, status: r.status, timed_out: r.timedOut, turns: parsed.turns || 0, duration_ms: r.duration_ms, tokens })
  }

  const result = {
    harness,
    ticket,
    tier,
    model: built.pair.model,
    effort: built.pair.effort,
    ok,
    status: r.status,
    timed_out: r.timedOut,
    turns: parsed.turns || 0,
    duration_ms: r.duration_ms,
    tokens,
    cost_usd: parsed.cost_usd,
    report: parsed.report || '',
  }
  if (!ok) result.error = parsed.error || (r.timedOut ? 'timed out' : `exit ${r.status}`) + (r.stderr ? `: ${r.stderr.trim().split('\n').slice(-5).join(' | ')}` : '')
  out(result, ok ? 0 : 2)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((e) => out({ error: e && e.message ? e.message : String(e) }, 2))
}
