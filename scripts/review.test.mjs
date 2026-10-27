// Tests for review.mjs: which reviewer a finished ticket gets, per depth and harness, from
// `models.review` in the layered config (DESIGN.md §20.2). No network, no Jev call.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DEFAULTS, deepMerge } from './jev.mjs'
import { REVIEWER_AGENTS, classify, pickReviewer } from './review.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'review.mjs')
const ROOT = join(HERE, '..')

function cfgWith(patch) {
  return deepMerge(DEFAULTS, patch)
}

function sandbox(files) {
  const cwd = mkdtempSync(join(tmpdir(), 'kss-review-'))
  mkdirSync(join(cwd, '.kss'))
  for (const [name, body] of Object.entries(files || {})) writeFileSync(join(cwd, '.kss', name), JSON.stringify(body))
  return { cwd, done: () => rmSync(cwd, { recursive: true, force: true }) }
}

function run(cwd, args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--cwd', cwd], { encoding: 'utf8', env: { ...process.env, KSS_HARNESS: 'claude-code' } })
  let json = null
  try {
    json = JSON.parse(r.stdout)
  } catch {
    /* leave null */
  }
  return { status: r.status, json, err: r.stderr }
}

test('defaults: full is the opus/high reviewer, light the sonnet/medium one', () => {
  const cfg = cfgWith({})
  const full = pickReviewer({ depth: 'full', harness: 'claude-code' }, cfg)
  assert.equal(full.depth, 'full')
  assert.equal(full.agent, 'kss-reviewer')
  assert.deepEqual([full.model, full.effort], ['opus', 'high'])
  assert.equal(full.source, 'default')

  const light = pickReviewer({ depth: 'light', harness: 'claude-code' }, cfg)
  assert.equal(light.agent, 'kss-reviewer-sonnet-medium')
  assert.deepEqual([light.model, light.effort], ['sonnet', 'medium'])
})

test('defaults on codex are a model and a reasoning_effort, never an agent name', () => {
  const cfg = cfgWith({})
  const full = pickReviewer({ depth: 'full', harness: 'codex' }, cfg)
  assert.deepEqual([full.model, full.reasoning_effort], ['gpt-6-astra', 'high'])
  assert.equal(full.agent, undefined)
  const light = pickReviewer({ depth: 'light', harness: 'codex' }, cfg)
  assert.deepEqual([light.model, light.reasoning_effort], ['gpt-5.6-terra', 'medium'])
})

test('no depth means full: a missing answer never buys a cheaper review', () => {
  const r = pickReviewer({ harness: 'claude-code' }, cfgWith({}))
  assert.equal(r.depth, 'full')
  assert.equal(r.agent, 'kss-reviewer')
})

test('any domain-risk category pins full, whatever depth was asked', () => {
  const r = pickReviewer({ depth: 'light', harness: 'claude-code', domain_risk: ['authorization'] }, cfgWith({}))
  assert.equal(r.depth, 'full')
  assert.equal(r.requested, 'light')
  assert.equal(r.agent, 'kss-reviewer')
  assert.match(r.reason, /domain risk/i)
  assert.match(r.reason, /authorization/)
})

test('an empty domain_risk list keeps the requested light depth', () => {
  const r = pickReviewer({ depth: 'light', harness: 'claude-code', domain_risk: [] }, cfgWith({}))
  assert.equal(r.depth, 'light')
})

test('models.review as {model, effort} resolves to the matching reviewer agent on Claude Code', () => {
  const cfg = cfgWith({ models: { review: { light: { 'claude-code': { model: 'opus', effort: 'medium' } } } } })
  const r = pickReviewer({ depth: 'light', harness: 'claude-code' }, cfg)
  assert.equal(r.agent, 'kss-reviewer-opus-medium')
  assert.equal(r.source, 'config')
})

test('models.review as an agent name is accepted, with or without the kss: namespace', () => {
  for (const name of ['kss-reviewer-sonnet-high', 'kss:kss-reviewer-sonnet-high']) {
    const cfg = cfgWith({ models: { review: { light: { 'claude-code': name } } } })
    const r = pickReviewer({ depth: 'light', harness: 'claude-code' }, cfg)
    assert.equal(r.agent, 'kss-reviewer-sonnet-high')
    assert.deepEqual([r.model, r.effort], ['sonnet', 'high'])
  }
})

test('an executor agent is not a reviewer: refused, default kept, warning given', () => {
  const cfg = cfgWith({ models: { review: { light: { 'claude-code': 'kss-sonnet-medium' } } } })
  const r = pickReviewer({ depth: 'light', harness: 'claude-code' }, cfg)
  assert.equal(r.agent, 'kss-reviewer-sonnet-medium')
  assert.equal(r.source, 'default')
  assert.match(r.warning, /kss-sonnet-medium/)
})

test('a pair with no reviewer agent (opus/low) is refused', () => {
  const cfg = cfgWith({ models: { review: { light: { 'claude-code': { model: 'opus', effort: 'low' } } } } })
  const r = pickReviewer({ depth: 'light', harness: 'claude-code' }, cfg)
  assert.equal(r.source, 'default')
  assert.ok(r.warning)
})

test('a model outside models.allowed, or an effort outside models.efforts, is refused', () => {
  const notAllowed = cfgWith({
    models: { allowed: { 'claude-code': ['sonnet'] }, review: { light: { 'claude-code': { model: 'opus', effort: 'medium' } } } },
  })
  const a = pickReviewer({ depth: 'light', harness: 'claude-code' }, notAllowed)
  assert.equal(a.source, 'default')
  assert.match(a.warning, /models\.allowed/)

  const badEffort = cfgWith({
    models: { efforts: ['medium', 'high'], review: { light: { codex: { model: 'gpt-5.6-terra', reasoning_effort: 'low' } } } },
  })
  const b = pickReviewer({ depth: 'light', harness: 'codex' }, badEffort)
  assert.equal(b.source, 'default')
  assert.match(b.warning, /models\.efforts/)
})

test('codex: a configured pair is taken as given; a half pair inherits the default effort through the merge', () => {
  const ok = cfgWith({ models: { review: { light: { codex: { model: 'gpt-5.4-mini', reasoning_effort: 'high' } } } } })
  const r = pickReviewer({ depth: 'light', harness: 'codex' }, ok)
  assert.deepEqual([r.model, r.reasoning_effort, r.source], ['gpt-5.4-mini', 'high', 'config'])

  const half = cfgWith({ models: { review: { light: { codex: { model: 'gpt-5.4-mini' } } } } })
  const h = pickReviewer({ depth: 'light', harness: 'codex' }, half)
  assert.deepEqual([h.model, h.reasoning_effort, h.source], ['gpt-5.4-mini', 'medium', 'config'])

  const noEffort = { ...cfgWith({}), models: { ...DEFAULTS.models, review: { light: { codex: { model: 'gpt-5.4-mini' } } } } }
  const n = pickReviewer({ depth: 'light', harness: 'codex' }, noEffort)
  assert.equal(n.source, 'default')
  assert.match(n.warning, /reasoning_effort/)
})

test('a full review configured below the default is honoured and flagged', () => {
  const cfg = cfgWith({ models: { review: { full: { 'claude-code': { model: 'sonnet', effort: 'high' } } } } })
  const r = pickReviewer({ depth: 'full', harness: 'claude-code' }, cfg)
  assert.equal(r.agent, 'kss-reviewer-sonnet-high')
  assert.equal(r.below_default, true)
  const d = pickReviewer({ depth: 'full', harness: 'claude-code' }, cfgWith({}))
  assert.equal(d.below_default, false)
})

test('an unknown depth or harness is a usage error', () => {
  assert.throws(() => pickReviewer({ depth: 'medium', harness: 'claude-code' }, cfgWith({})), /depth/)
  assert.throws(() => pickReviewer({ depth: 'full', harness: 'vim' }, cfgWith({})), /harness/)
})

test('CLI pick: reads models.review from the committed policy and the local file', () => {
  const s = sandbox({
    'config.json': { models: { review: { light: { 'claude-code': { model: 'sonnet', effort: 'high' } } } } },
  })
  try {
    const r = run(s.cwd, ['pick', JSON.stringify({ depth: 'light' })])
    assert.equal(r.status, 0, r.err)
    assert.equal(r.json.harness, 'claude-code')
    assert.equal(r.json.agent, 'kss-reviewer-sonnet-high')

    writeFileSync(join(s.cwd, '.kss', 'config.local.json'), JSON.stringify({ models: { review: { light: { 'claude-code': 'kss-reviewer-opus-medium' } } } }))
    const l = run(s.cwd, ['pick', JSON.stringify({ depth: 'light' })])
    assert.equal(l.json.agent, 'kss-reviewer-opus-medium')
  } finally {
    s.done()
  }
})

test('CLI: bad JSON or a missing command is exit 1', () => {
  const s = sandbox()
  try {
    assert.equal(run(s.cwd, ['pick', '{nope']).status, 1)
    assert.equal(run(s.cwd, []).status, 1)
  } finally {
    s.done()
  }
})

test('every reviewer agent ships: file, frontmatter pair, read-only tools, the same brief', () => {
  const base = readFileSync(join(ROOT, 'agents', 'kss-reviewer.md'), 'utf8')
  const body = (t) => t.slice(t.indexOf('---', 3) + 3)
  const plugin = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'))
  for (const [name, pair] of Object.entries(REVIEWER_AGENTS)) {
    const p = join(ROOT, 'agents', `${name}.md`)
    assert.ok(existsSync(p), `${name}.md exists`)
    const t = readFileSync(p, 'utf8')
    assert.match(t, new RegExp(`^name: ${name}$`, 'm'))
    assert.match(t, new RegExp(`^model: ${pair.model}$`, 'm'))
    assert.match(t, new RegExp(`^effort: ${pair.effort}$`, 'm'))
    assert.match(t, /^tools: Read, Grep, Glob, Bash$/m)
    assert.equal(body(t), body(base), `${name} carries the kss-reviewer brief verbatim`)
    assert.ok(plugin.agents.includes(`./agents/${name}.md`), `plugin.json lists ${name}`)
  }
})

// ---------------------------------------------------------------- wait (kss-review --loop)

const SINCE = '2026-10-27T12:00:00Z'
const ME = 'kelwin'
const bot = { login: 'chatgpt-codex-connector[bot]' }

test('classify: a reviewer that found nothing ends the loop clean', () => {
  const snap = { state: 'OPEN', comments: [{ author: bot, createdAt: '2026-10-27T12:04:00Z', body: "Codex Review: Didn't find any major issues. Keep them coming!" }] }
  assert.deepEqual(classify(snap, { since: SINCE, me: ME }), { outcome: 'clean', events: [] })
  assert.equal(classify({ state: 'OPEN', reviews: [{ author: { login: 'ana' }, submittedAt: '2026-10-27T12:05:00Z', state: 'APPROVED', body: '' }] }, { since: SINCE, me: ME }).outcome, 'clean')
  assert.equal(classify({ state: 'OPEN', reactions: [{ content: '+1', user: bot, created_at: '2026-10-27T12:05:00Z' }] }, { since: SINCE, me: ME }).outcome, 'clean')
})

test('classify: new inline comments, reviews and failed checks are a round to run — and outweigh a clean pass', () => {
  const snap = {
    state: 'OPEN',
    reviews: [{ author: bot, submittedAt: '2026-10-27T12:06:00Z', state: 'COMMENTED', body: '' }],
    inline: [{ user: bot, created_at: '2026-10-27T12:06:00Z', path: 'src/a.ts', line: 12, body: 'P1 Badge: tenant filter missing' }],
    checks: [{ name: 'ci', conclusion: 'FAILURE', completedAt: '2026-10-27T12:07:00Z' }],
    comments: [{ author: bot, createdAt: '2026-10-27T12:06:00Z', body: "Didn't find any major issues" }],
  }
  const r = classify(snap, { since: SINCE, me: ME })
  assert.equal(r.outcome, 'new')
  assert.deepEqual(r.events.map((e) => e.kind), ['inline', 'check'])
  assert.match(r.events[0].text, /^src\/a\.ts:12 P1/)
})

test('classify: what came before the push, and the person’s own replies, are not news', () => {
  const snap = {
    state: 'OPEN',
    comments: [{ author: { login: ME }, createdAt: '2026-10-27T12:03:00Z', body: 'Fixed in abc123' }],
    inline: [{ user: bot, created_at: '2026-10-27T11:50:00Z', body: 'old finding' }],
    reactions: [{ content: '+1', user: { login: 'ana' }, created_at: '2026-10-27T12:05:00Z' }],
  }
  assert.deepEqual(classify(snap, { since: SINCE, me: ME }), { outcome: null, events: [] })
  assert.equal(classify({ state: 'MERGED' }, { since: SINCE, me: ME }).outcome, 'closed')
})

test('wait: refuses to run without --pr and --since', () => {
  const r = spawnSync(process.execPath, [SCRIPT, 'wait', '--pr', '12'], { encoding: 'utf8' })
  assert.equal(r.status, 1)
  assert.match(r.stdout, /wait needs --pr and --since/)
})
