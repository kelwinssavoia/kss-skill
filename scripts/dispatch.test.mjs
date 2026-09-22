// Tests for dispatch.mjs: the split, the command lines, the two output parsers, and `run` against
// fake `claude` / `codex` binaries that print what the real CLIs printed (DESIGN.md §21).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, chmodSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { shares, choose, pairFor, buildCommand, parseClaude, parseCodex, observed, loadConfig, DEFAULTS } from './dispatch.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'dispatch.mjs')

function sandbox(local) {
  const cwd = mkdtempSync(join(tmpdir(), 'kss-dispatch-'))
  mkdirSync(join(cwd, '.kss'))
  mkdirSync(join(cwd, 'docs', 'features', '001-x'), { recursive: true })
  if (local) writeFileSync(join(cwd, '.kss', 'config.local.json'), JSON.stringify(local))
  return { cwd, dir: join(cwd, 'docs', 'features', '001-x'), done: () => rmSync(cwd, { recursive: true, force: true }) }
}

function run(cwd, args, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--cwd', cwd], { encoding: 'utf8', env: { ...process.env, ...env } })
  let json = null
  try {
    json = JSON.parse(r.stdout)
  } catch {
    /* null */
  }
  return { status: r.status, json, err: r.stderr }
}

/** Write an executable node script at `path` that behaves like a CLI printing `body`. */
function fakeBin(path, body) {
  writeFileSync(path, `#!/usr/bin/env node\n${body}\n`)
  chmodSync(path, 0o755)
}

const CLAUDE_RESULT = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  num_turns: 7,
  duration_ms: 2391,
  total_cost_usd: 0.0497,
  result: 'Ticket: 04-x · done\nBranch: b (worktree w)\nCommits: a test: … / b feat: …\nFiles: f\nTests: s · not run\nDeviations: none',
  usage: { input_tokens: 9, cache_creation_input_tokens: 24693, cache_read_input_tokens: 100, output_tokens: 61 },
  modelUsage: { 'claude-sonnet-5': {} },
}

test('shares: normalises positive weights over known harnesses', () => {
  assert.deepEqual(shares({ 'claude-code': 60, codex: 40 }), { 'claude-code': 0.6, codex: 0.4 })
  assert.deepEqual(shares({ 'claude-code': 1, codex: 0, other: 5 }), { 'claude-code': 1 })
  assert.deepEqual(shares({}), {})
})

test('choose: largest deficit, ties to local, excluded tiers stay local, unavailable foreign stays local', () => {
  const base = { local: 'claude-code', split: { 'claude-code': 50, codex: 50 }, allowedTiers: ['T1', 'T2', 'T3'], available: { 'claude-code': true, codex: true } }
  assert.equal(choose({ ...base, counts: { 'claude-code': 0, codex: 0 }, tier: 'T2' }).harness, 'claude-code', 'tie → local')
  assert.equal(choose({ ...base, counts: { 'claude-code': 1, codex: 0 }, tier: 'T2' }).harness, 'codex')
  assert.equal(choose({ ...base, counts: { 'claude-code': 1, codex: 1 }, tier: 'T2' }).harness, 'claude-code')
  assert.equal(choose({ ...base, counts: { 'claude-code': 0, codex: 0 }, tier: 'T5' }).harness, 'claude-code', 'T5 excluded')
  assert.equal(choose({ ...base, counts: { 'claude-code': 3, codex: 0 }, tier: 'T1', available: { 'claude-code': true, codex: false } }).harness, 'claude-code')
  const seq = []
  const counts = { 'claude-code': 0, codex: 0 }
  for (let i = 0; i < 10; i++) {
    const h = choose({ ...base, split: { 'claude-code': 70, codex: 30 }, counts, tier: 'T2' }).harness
    counts[h]++
    seq.push(h)
  }
  assert.deepEqual(counts, { 'claude-code': 7, codex: 3 }, `70/30 over ten tickets: ${seq.join(',')}`)
  assert.equal(choose({ local: 'codex', split: { 'claude-code': 100 }, counts: {}, tier: 'T1' }).harness, 'codex', 'local not in split → local')
})

test('pairFor: adapter defaults, agent-name override on Claude Code, pair override on Codex', () => {
  assert.deepEqual(pairFor('codex', 'T3', {}), { model: 'gpt-5.6-terra', effort: 'high' })
  assert.deepEqual(pairFor('claude-code', 'T2', { T2: { 'claude-code': 'kss:kss-sonnet-high' } }), { model: 'sonnet', effort: 'high' })
  assert.deepEqual(pairFor('codex', 'T2', { T2: { codex: { model: 'gpt-6-astra', reasoning_effort: 'low' } } }), { model: 'gpt-6-astra', effort: 'low' })
  assert.equal(pairFor('codex', 'T9', {}), null)
})

test('buildCommand: claude -p and codex exec with the tier pair and the config flags', () => {
  const c = buildCommand({ harness: 'claude-code', worktree: '/w', tier: 'T2', cross: DEFAULTS, overrides: {} })
  assert.equal(c.argv[0], 'claude')
  assert.ok(c.argv.includes('-p') && c.argv.includes('--output-format') && c.argv.includes('json'))
  assert.equal(c.argv[c.argv.indexOf('--model') + 1], 'sonnet')
  assert.equal(c.argv[c.argv.indexOf('--effort') + 1], 'medium')
  assert.ok(c.argv.includes('Bash(git *)'))
  assert.equal(c.cwd, '/w')
  const x = buildCommand({ harness: 'codex', worktree: '/w', tier: 'T3', cross: DEFAULTS, overrides: {}, lastMessageFile: '/w/last.txt' })
  assert.deepEqual(x.argv.slice(0, 3), ['codex', 'exec', '--json'])
  assert.equal(x.argv[x.argv.indexOf('-m') + 1], 'gpt-5.6-terra')
  assert.ok(x.argv.includes('model_reasoning_effort="high"'))
  assert.ok(x.argv.includes('approval_policy="never"'))
  assert.equal(x.argv[x.argv.length - 1], '-', 'brief comes from stdin')
  assert.throws(() => buildCommand({ harness: 'nope', worktree: '/w', tier: 'T1', cross: DEFAULTS }), /unknown harness|no tier/)
})

test('pairFor: kss-haiku is a T1–T3 executor with no effort, since Haiku rejects the effort parameter', () => {
  const byName = { T1: { 'claude-code': 'kss-haiku' } }
  assert.deepEqual(pairFor('claude-code', 'T1', byName), { model: 'haiku', effort: null })
  assert.deepEqual(pairFor('claude-code', 'T2', { T2: { 'claude-code': 'kss:kss-haiku' } }), { model: 'haiku', effort: null })
  // A pair naming haiku never inherits the tier's effort, nor keeps one it was given.
  assert.deepEqual(pairFor('claude-code', 'T1', { T1: { 'claude-code': { model: 'haiku' } } }), { model: 'haiku', effort: null })
  assert.deepEqual(pairFor('claude-code', 'T3', { T3: { 'claude-code': { model: 'haiku', effort: 'high' } } }), { model: 'haiku', effort: null })
  // T4 and T5 carry real judgement: a haiku override there is refused and the adapter row stands.
  assert.deepEqual(pairFor('claude-code', 'T4', { T4: { 'claude-code': 'kss-haiku' } }), { model: 'opus', effort: 'medium' })
  assert.deepEqual(pairFor('claude-code', 'T5', { T5: { 'claude-code': { model: 'haiku' } } }), { model: 'opus', effort: 'high' })
})

test('buildCommand: a haiku run passes --model haiku and no --effort', () => {
  const c = buildCommand({ harness: 'claude-code', worktree: '/w', tier: 'T1', cross: DEFAULTS, overrides: { T1: { 'claude-code': 'kss-haiku' } } })
  assert.equal(c.argv[c.argv.indexOf('--model') + 1], 'haiku')
  assert.equal(c.argv.includes('--effort'), false)
})

test('kss-haiku ships: model haiku, no effort line, the executor brief verbatim, listed in plugin.json', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const body = (t) => t.slice(t.indexOf('---', 3) + 3)
  const haiku = readFileSync(join(root, 'agents', 'kss-haiku.md'), 'utf8')
  const low = readFileSync(join(root, 'agents', 'kss-sonnet-low.md'), 'utf8')
  assert.match(haiku, /^name: kss-haiku$/m)
  assert.match(haiku, /^model: haiku$/m)
  assert.doesNotMatch(haiku.slice(0, haiku.indexOf('---', 3)), /^effort:/m)
  assert.match(haiku, /^tools: Read, Grep, Glob, Bash, Edit, Write, Agent\(kss-explorer\)$/m)
  assert.equal(body(haiku), body(low))
  const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'))
  assert.ok(plugin.agents.includes('./agents/kss-haiku.md'))
})

test('parseClaude: the result line gives report, usage, turns, cost', () => {
  const p = parseClaude(JSON.stringify(CLAUDE_RESULT))
  assert.equal(p.ok, true)
  assert.match(p.report, /^Ticket: 04-x · done/)
  assert.deepEqual(p.usage, { fresh_in: 9, cache_write: 24693, cache_read: 100, out: 61 })
  assert.equal(p.turns, 7)
  assert.equal(p.cost_usd, 0.0497)
  assert.equal(p.model, 'claude-sonnet-5')
  assert.equal(parseClaude('garbage').ok, false)
})

test('parseCodex: sums turn.completed usage, reads the -o file first, flags turn.failed', () => {
  const events = [
    { type: 'thread.started', thread_id: 't' },
    { type: 'turn.completed', usage: { input_tokens: 19065, cached_input_tokens: 6912, cache_write_input_tokens: 0, output_tokens: 6 } },
    { type: 'item.completed', item: { id: 'i', type: 'agent_message', text: 'from events' } },
    { type: 'turn.completed', usage: { input_tokens: 1000, cached_input_tokens: 500, cache_write_input_tokens: 100, output_tokens: 10 } },
  ]
  const p = parseCodex(events.map((e) => JSON.stringify(e)).join('\n'), 'Ticket: 04 · done')
  assert.equal(p.ok, true)
  assert.equal(p.turns, 2)
  assert.deepEqual(p.usage, { fresh_in: 19065 - 6912 + 400, cache_write: 100, cache_read: 7412, out: 16 })
  assert.equal(p.report, 'Ticket: 04 · done')
  assert.equal(parseCodex(events.map((e) => JSON.stringify(e)).join('\n'), '').report, 'from events')
  const f = parseCodex(JSON.stringify({ type: 'turn.failed', error: { message: 'model not supported' } }), '')
  assert.equal(f.ok, false)
  assert.equal(f.error, 'model not supported')
})

test('CLI pick: off → exit 3 with the local harness; on → foreign when the deficit says so, logged', () => {
  const off = sandbox(null)
  try {
    const r = run(off.cwd, ['pick', JSON.stringify({ feature: '001-x', ticket: '01', tier: 'T2', local: 'claude-code' })])
    assert.equal(r.status, 3)
    assert.equal(r.json.enabled, false)
  } finally {
    off.done()
  }
  const on = sandbox({ execution: { cross_harness: { enabled: true, split: { 'claude-code': 50, codex: 50 }, cli: { codex: { bin: process.execPath } } } } })
  try {
    const first = run(on.cwd, ['pick', JSON.stringify({ feature: '001-x', ticket: '01', tier: 'T2', local: 'claude-code' })])
    assert.equal(first.status, 3, 'tie → local → exit 3')
    assert.equal(first.json.harness, 'claude-code')
    const second = run(on.cwd, ['pick', JSON.stringify({ feature: '001-x', ticket: '02', tier: 'T2', local: 'claude-code' })])
    assert.equal(second.status, 0)
    assert.equal(second.json.harness, 'codex')
    assert.equal(second.json.foreign, true)
    assert.equal(second.json.model, 'gpt-5.6-terra')
    assert.deepEqual(observed(on.dir), { 'claude-code': 1, codex: 1 })
    const t5 = run(on.cwd, ['pick', JSON.stringify({ feature: '001-x', ticket: '03', tier: 'T5', local: 'claude-code' })])
    assert.equal(t5.status, 3)
    assert.match(t5.json.reason, /T5/)
    const st = run(on.cwd, ['status', '001-x'])
    assert.equal(st.json.counts['claude-code'], 2)
  } finally {
    on.done()
  }
})

test('CLI pick: a foreign CLI missing from PATH keeps the ticket local and says which', () => {
  const s = sandbox({ execution: { cross_harness: { enabled: true, split: { 'claude-code': 0, codex: 100 }, cli: { codex: { bin: '/definitely/not/here/codex' } } } } })
  try {
    const r = run(s.cwd, ['pick', JSON.stringify({ feature: '001-x', ticket: '01', tier: 'T1', local: 'claude-code' })])
    assert.equal(r.json.harness, 'claude-code')
    assert.deepEqual(r.json.unavailable, ['codex'])
  } finally {
    s.done()
  }
})

test('CLI command: dry-run prints argv without touching anything', () => {
  const s = sandbox({ execution: { cross_harness: { enabled: false } } })
  try {
    const r = run(s.cwd, ['command', JSON.stringify({ harness: 'codex', worktree: '/w', tier: 'T1' })])
    assert.equal(r.status, 0, 'command works even when cross-harness is off — it is a dry run')
    assert.equal(r.json.model, 'gpt-5.6-luna')
    assert.equal(r.json.argv[1], 'exec')
  } finally {
    s.done()
  }
})

test('CLI run (fake claude): brief on stdin, report out, metrics and dispatch lines written', () => {
  const s = sandbox(null)
  try {
    const bin = join(s.cwd, 'fake-claude')
    fakeBin(
      bin,
      `let input='';process.stdin.on('data',d=>input+=d).on('end',()=>{require('fs').writeFileSync(process.argv[process.argv.length-1]==='--max-turns'?'/dev/null':'${join(s.cwd, 'seen-brief.txt')}',input);console.log(JSON.stringify(${JSON.stringify(CLAUDE_RESULT)}))})`,
    )
    writeFileSync(join(s.cwd, '.kss', 'config.local.json'), JSON.stringify({ execution: { cross_harness: { enabled: true, cli: { 'claude-code': { bin } } } } }))
    writeFileSync(join(s.cwd, '.kss', 'current'), JSON.stringify({ feature: '001-x', phase: 'execute' }))
    const wt = join(s.cwd, 'wt')
    mkdirSync(wt)
    const brief = join(s.cwd, 'brief.md')
    writeFileSync(brief, '# 04 · the ticket\nWorktree: ' + wt)
    const r = run(s.cwd, ['run', JSON.stringify({ feature: '001-x', ticket: '04', tier: 'T2', harness: 'claude-code', worktree: wt, brief_file: brief })])
    assert.equal(r.status, 0, r.err + JSON.stringify(r.json))
    assert.equal(r.json.ok, true)
    assert.match(r.json.report, /^Ticket: 04-x · done/)
    assert.equal(r.json.turns, 7)
    assert.equal(r.json.tokens.cumulative, 9 + 24693 + 100 + 61)
    assert.equal(readFileSync(join(s.cwd, 'seen-brief.txt'), 'utf8'), '# 04 · the ticket\nWorktree: ' + wt)
    const metrics = readFileSync(join(s.dir, 'metrics.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    assert.equal(metrics.length, 1)
    assert.equal(metrics[0].kind, 'subagent')
    assert.equal(metrics[0].harness, 'claude-code')
    assert.equal(metrics[0].agent_type, 'cross:claude-code:T2')
    assert.equal(metrics[0].ticket, '04')
    assert.equal(metrics[0].turns, 7)
    const disp = readFileSync(join(s.dir, 'dispatch.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    assert.equal(disp[disp.length - 1].event, 'run')
    assert.equal(disp[disp.length - 1].ok, true)
  } finally {
    s.done()
  }
})

test('CLI run (fake codex): -o file is the report, usage summed from events; failure → exit 2', () => {
  const s = sandbox(null)
  try {
    const okBin = join(s.cwd, 'fake-codex')
    fakeBin(
      okBin,
      `const fs=require('fs');const o=process.argv.indexOf('-o');let input='';process.stdin.on('data',d=>input+=d).on('end',()=>{fs.writeFileSync(process.argv[o+1],'Ticket: 05 · done\\nBranch: b');console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:19065,cached_input_tokens:6912,cache_write_input_tokens:0,output_tokens:6}}))})`,
    )
    const badBin = join(s.cwd, 'fake-codex-bad')
    fakeBin(badBin, `process.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({type:'turn.failed',error:{message:'model not supported'}}));process.exit(0)})`)
    const wt = join(s.cwd, 'wt')
    mkdirSync(wt)
    const brief = join(s.cwd, 'brief.md')
    writeFileSync(brief, 'ticket')
    const input = JSON.stringify({ feature: '001-x', ticket: '05', tier: 'T1', harness: 'codex', worktree: wt, brief_file: brief })

    writeFileSync(join(s.cwd, '.kss', 'config.local.json'), JSON.stringify({ execution: { cross_harness: { enabled: true, cli: { codex: { bin: okBin } } } } }))
    const ok = run(s.cwd, ['run', input])
    assert.equal(ok.status, 0, ok.err + JSON.stringify(ok.json))
    assert.equal(ok.json.report, 'Ticket: 05 · done\nBranch: b')
    assert.equal(ok.json.tokens.cache_read, 6912)
    assert.equal(ok.json.model, 'gpt-5.6-luna')
    assert.equal(existsSync(join(wt, '.kss-last-message.txt')), true, 'file exists but is emptied')
    assert.equal(readFileSync(join(wt, '.kss-last-message.txt'), 'utf8'), '')

    writeFileSync(join(s.cwd, '.kss', 'config.local.json'), JSON.stringify({ execution: { cross_harness: { enabled: true, cli: { codex: { bin: badBin } } } } }))
    const bad = run(s.cwd, ['run', input])
    assert.equal(bad.status, 2)
    assert.equal(bad.json.ok, false)
    assert.match(bad.json.error, /model not supported/)
  } finally {
    s.done()
  }
})

test('CLI run: a timeout kills the child and reports exit 2', () => {
  const s = sandbox(null)
  try {
    const bin = join(s.cwd, 'fake-slow')
    fakeBin(bin, `process.stdin.resume();setTimeout(()=>{},60000)`)
    writeFileSync(join(s.cwd, '.kss', 'config.local.json'), JSON.stringify({ execution: { cross_harness: { enabled: true, timeout_ms: 300, cli: { 'claude-code': { bin } } } } }))
    const wt = join(s.cwd, 'wt')
    mkdirSync(wt)
    const brief = join(s.cwd, 'brief.md')
    writeFileSync(brief, 'ticket')
    const r = run(s.cwd, ['run', JSON.stringify({ feature: '001-x', ticket: '06', tier: 'T1', harness: 'claude-code', worktree: wt, brief_file: brief })])
    assert.equal(r.status, 2)
    assert.equal(r.json.timed_out, true)
  } finally {
    s.done()
  }
})

test('loadConfig: cross block merges over defaults and exposes models.tiers', () => {
  const s = sandbox({ execution: { cross_harness: { enabled: true, split: { codex: 100 } } }, models: { tiers: { T1: { codex: { model: 'x', reasoning_effort: 'low' } } } } })
  try {
    const { cross, tiers } = loadConfig(s.cwd)
    assert.equal(cross.enabled, true)
    assert.deepEqual(cross.split, { codex: 100 })
    assert.deepEqual(cross.tiers, ['T1', 'T2', 'T3'])
    assert.equal(tiers.T1.codex.model, 'x')
  } finally {
    s.done()
  }
})

test('CLI without --cwd: the first argument is the command, not dropped', () => {
  const r = spawnSync(process.execPath, [SCRIPT, 'command', JSON.stringify({ harness: 'codex', worktree: '/w', tier: 'T2' })], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(JSON.parse(r.stdout).model, 'gpt-5.6-terra')
})
