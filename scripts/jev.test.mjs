// Tests for jev.mjs: config merge, the confidence gate, request building, and the CLI against a
// fake TypeSafe endpoint (DESIGN.md §20). No network is ever touched.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { DEFAULTS, deepMerge, loadLocalConfig, resolveApiKey, redact, gate, assumptionThreshold, buildDecide, buildTier, buildClassify } from './jev.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'jev.mjs')

function sandbox(local) {
  const cwd = mkdtempSync(join(tmpdir(), 'kss-jev-'))
  mkdirSync(join(cwd, '.kss'))
  if (local) writeFileSync(join(cwd, '.kss', 'config.local.json'), JSON.stringify(local))
  return { cwd, done: () => rmSync(cwd, { recursive: true, force: true }) }
}

function parse(status, stdout, stderr) {
  let json = null
  try {
    json = JSON.parse(stdout)
  } catch {
    /* leave null */
  }
  return { status, json, err: stderr }
}

function run(cwd, args, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--cwd', cwd], { encoding: 'utf8', env: { ...process.env, TYPESAFE_API_KEY: '', ...env } })
  return parse(r.status, r.stdout, r.stderr)
}

/** Async variant for tests that host the fake endpoint in this process: spawnSync would block it. */
function runAsync(cwd, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args, '--cwd', cwd], { env: { ...process.env, TYPESAFE_API_KEY: '', ...env } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('close', (status) => resolve(parse(status, stdout, stderr)))
  })
}

/** A fake /v1/systemone that answers every choice question with `probs`, recording requests. */
function fakeJev(probs) {
  const requests = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      const parsed = JSON.parse(body)
      requests.push({ url: req.url, auth: req.headers.authorization, body: parsed })
      const answers = {}
      for (const [name, q] of Object.entries(parsed.questions)) {
        if (q.type === 'noul') answers[name] = { type: 'noul', noul: 0.99 }
        else {
          const p = probs(q)
          const top = Object.entries(p).sort((a, b) => b[1] - a[1])[0]
          answers[name] = { type: 'choice', choice: top[0], confidence: top[1], probabilities: p }
        }
      }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ model: 'jev-1.13.0', answers, usage: { input_tokens: 42, output_tokens: 0 } }))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() }))
  })
}

test('deepMerge: file values win, missing keys keep the defaults', () => {
  const cfg = deepMerge(DEFAULTS, { jev: { enabled: true, auto_assumptions: { confidence: 0.5 } } })
  assert.equal(cfg.jev.enabled, true)
  assert.equal(cfg.jev.auto_assumptions.confidence, 0.5)
  assert.equal(cfg.jev.auto_assumptions.by_category.layout, 0.9)
  assert.equal(cfg.jev.model, 'jev-latest')
  assert.equal(DEFAULTS.jev.enabled, false, 'defaults are never mutated')
})

test('loadLocalConfig: absent file is present:false with defaults', () => {
  const s = sandbox(null)
  try {
    const { present, cfg } = loadLocalConfig(s.cwd)
    assert.equal(present, false)
    assert.equal(cfg.jev.enabled, false)
  } finally {
    s.done()
  }
})

test('resolveApiKey: file first, then the named env var, else empty', () => {
  const cfg = deepMerge(DEFAULTS, {})
  assert.equal(resolveApiKey(cfg, {}), '')
  assert.equal(resolveApiKey(cfg, { TYPESAFE_API_KEY: ' ts-env ' }), 'ts-env')
  assert.equal(resolveApiKey(deepMerge(cfg, { jev: { api_key: 'ts-file' } }), { TYPESAFE_API_KEY: 'ts-env' }), 'ts-file')
  assert.equal(resolveApiKey(deepMerge(cfg, { jev: { api_key_env: 'OTHER' } }), { OTHER: 'x' }), 'x')
})

test('redact never prints the whole key', () => {
  const r = redact(deepMerge(DEFAULTS, { jev: { api_key: 'ts-0123456789abcdef' } }))
  assert.equal(r.jev.api_key, 'ts-0…cdef')
  assert.equal(redact(deepMerge(DEFAULTS, { jev: { api_key: 'short' } })).jev.api_key, '…')
})

test('gate: auto at or above the threshold, open below, ranked by probability', () => {
  const a = { choice: 'x', confidence: 0.9, probabilities: { x: 0.9, y: 0.07, z: 0.03 } }
  assert.equal(gate(a, 0.85).verdict, 'auto')
  assert.equal(gate(a, 0.9).verdict, 'auto')
  assert.equal(gate(a, 0.91).verdict, 'open')
  assert.deepEqual(gate(a, 0.5).ranked.map((r) => r.id), ['x', 'y', 'z'])
  assert.equal(gate({ choice: 'x' }, 0.1).verdict, 'open', 'no confidence → open')
  assert.equal(gate(a, undefined).verdict, 'open', 'no threshold → never auto')
})

test('assumptionThreshold: category override, default, business impossible by default', () => {
  const cfg = deepMerge(DEFAULTS, {})
  assert.equal(assumptionThreshold(cfg, 'technical'), 0.85)
  assert.equal(assumptionThreshold(cfg, 'Layout'), 0.9)
  assert.equal(assumptionThreshold(cfg, 'business') > 1, true)
  assert.equal(assumptionThreshold(cfg, 'other'), 0.85)
})

test('buildDecide: options become criteria, category picks the threshold, too many options is refused', () => {
  const cfg = deepMerge(DEFAULTS, {})
  const { body, threshold } = buildDecide(
    { question: 'Which ORM?', category: 'technical', options: [{ id: 'a', label: 'Prisma', description: 'used in 9/10 places' }, { id: 'b', label: 'Knex' }] },
    cfg,
  )
  assert.deepEqual(Object.keys(body.questions.decision.criteria), ['a', 'b'])
  assert.equal(body.questions.decision.criteria.a, 'Prisma — used in 9/10 places')
  assert.equal(body.questions.decision.criteria.b, 'Knex')
  assert.equal(body.state.question, 'Which ORM?')
  assert.equal(threshold, 0.85)
  assert.throws(() => buildDecide({ question: 'q', options: [{ id: 'a' }] }, cfg), /decide needs/)
  const many = Array.from({ length: 13 }, (_, i) => ({ id: `o${i}` }))
  assert.throws(() => buildDecide({ question: 'q', options: many }, cfg), /max_options/)
})

test('buildTier: five tiers, threshold from tier_selection', () => {
  const cfg = deepMerge(DEFAULTS, { jev: { tier_selection: { confidence: 0.6 } } })
  const { body, threshold } = buildTier({ title: 'Add column', layer: 'db' }, cfg)
  assert.deepEqual(Object.keys(body.questions.tier.criteria), ['T1', 'T2', 'T3', 'T4', 'T5'])
  assert.equal(threshold, 0.6)
  assert.throws(() => buildTier({}, cfg), /tier needs/)
})

test('buildClassify: only kinds listed in reasoning.decisions are asked', () => {
  const cfg = deepMerge(DEFAULTS, {})
  assert.equal(buildClassify({ kind: 'size', state: {} }, cfg).disabled.includes('size'), true)
  const { body } = buildClassify({ kind: 'escalation_class', state: { findings: ['x'] } }, cfg)
  assert.deepEqual(Object.keys(body.questions.escalation_class.criteria), ['execution', 'reasoning'])
  assert.throws(() => buildClassify({ kind: 'nope' }, cfg), /classify needs/)
})

test('CLI: no local file → enabled:false, exit 3; config prints redacted', () => {
  const s = sandbox(null)
  try {
    const r = run(s.cwd, ['decide', JSON.stringify({ question: 'q', options: [{ id: 'a' }, { id: 'b' }] })])
    assert.equal(r.status, 3)
    assert.equal(r.json.enabled, false)
    const c = run(s.cwd, ['config'])
    assert.equal(c.status, 0)
    assert.equal(c.json.present, false)
  } finally {
    s.done()
  }
})

test('CLI: enabled but a feature switched off → exit 3; no key → exit 2', () => {
  const s = sandbox({ jev: { enabled: true, tier_selection: { enabled: false } } })
  try {
    const r = run(s.cwd, ['tier', JSON.stringify({ title: 't' })])
    assert.equal(r.status, 3)
    assert.match(r.json.reason, /tier_selection/)
    const k = run(s.cwd, ['check'])
    assert.equal(k.status, 2)
    assert.match(k.json.error, /no API key/)
  } finally {
    s.done()
  }
})

test('CLI decide against a fake endpoint: bearer auth, model, gate, trace in the feature folder', async () => {
  const jev = await fakeJev(() => ({ a: 0.93, b: 0.07 }))
  const s = sandbox({ jev: { enabled: true, api_key: 'ts-test', base_url: jev.url } })
  try {
    mkdirSync(join(s.cwd, 'docs', 'features', '001-x'), { recursive: true })
    writeFileSync(join(s.cwd, '.kss', 'current'), JSON.stringify({ feature: '001-x', phase: 'investigate' }))
    const r = await runAsync(s.cwd, ['decide', JSON.stringify({ question: 'q', category: 'technical', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] })])
    assert.equal(r.status, 0, r.err)
    assert.equal(r.json.verdict, 'auto')
    assert.equal(r.json.choice, 'a')
    assert.equal(r.json.threshold, 0.85)
    assert.equal(jev.requests[0].url, '/v1/systemone')
    assert.equal(jev.requests[0].auth, 'Bearer ts-test')
    assert.equal(jev.requests[0].body.model, 'jev-latest')
    const trace = join(s.cwd, 'docs', 'features', '001-x', 'jev-trace.jsonl')
    assert.equal(existsSync(trace), true)
    const line = JSON.parse(readFileSync(trace, 'utf8').trim())
    assert.equal(line.cmd, 'decide')
    assert.equal(line.verdict, 'auto')
  } finally {
    jev.close()
    s.done()
  }
})

test('CLI decide: layout needs 0.9, so 0.88 stays open; business never auto', async () => {
  const jev = await fakeJev(() => ({ a: 0.88, b: 0.12 }))
  const s = sandbox({ jev: { enabled: true, api_key: 'ts-test', base_url: jev.url, trace: false } })
  try {
    const opts = [{ id: 'a' }, { id: 'b' }]
    const lay = await runAsync(s.cwd, ['decide', JSON.stringify({ question: 'q', category: 'layout', options: opts })])
    assert.equal(lay.json.verdict, 'open')
    const tech = await runAsync(s.cwd, ['decide', JSON.stringify({ question: 'q', category: 'technical', options: opts })])
    assert.equal(tech.json.verdict, 'auto')
    const biz = await runAsync(s.cwd, ['decide', JSON.stringify({ question: 'q', category: 'business', options: opts })])
    assert.equal(biz.json.verdict, 'open')
  } finally {
    jev.close()
    s.done()
  }
})

test('CLI tier: low confidence reports the configured fallback', async () => {
  const jev = await fakeJev(() => ({ T1: 0.1, T2: 0.45, T3: 0.4, T4: 0.05, T5: 0 }))
  const s = sandbox({ jev: { enabled: true, api_key_env: 'MY_KEY', base_url: jev.url, trace: false } })
  try {
    const r = await runAsync(s.cwd, ['tier', JSON.stringify({ title: 'Wire the API client' })], { MY_KEY: 'ts-env' })
    assert.equal(r.status, 0, r.err)
    assert.equal(r.json.verdict, 'open')
    assert.equal(r.json.choice, 'T2')
    assert.equal(r.json.fallback, 'rubric')
    assert.equal(jev.requests[0].auth, 'Bearer ts-env')
  } finally {
    jev.close()
    s.done()
  }
})

test('CLI classify: reasoning disabled by default → exit 3; enabled → gated answer', async () => {
  const jev = await fakeJev(() => ({ execution: 0.95, reasoning: 0.05 }))
  const off = sandbox({ jev: { enabled: true, api_key: 'k', base_url: jev.url } })
  const on = sandbox({ jev: { enabled: true, api_key: 'k', base_url: jev.url, trace: false, reasoning: { enabled: true } } })
  try {
    const input = JSON.stringify({ kind: 'escalation_class', state: { findings: ['missing null check'] } })
    assert.equal((await runAsync(off.cwd, ['classify', input])).status, 3)
    const r = await runAsync(on.cwd, ['classify', input])
    assert.equal(r.status, 0, r.err)
    assert.equal(r.json.kind, 'escalation_class')
    assert.equal(r.json.choice, 'execution')
    assert.equal(r.json.verdict, 'auto')
  } finally {
    jev.close()
    off.done()
    on.done()
  }
})

test('CLI: an HTTP error is a fallback (exit 2), never a crash', async () => {
  const server = createServer((_, res) => {
    res.statusCode = 429
    res.end('{"error":"rate limited"}')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const s = sandbox({ jev: { enabled: true, api_key: 'k', base_url: `http://127.0.0.1:${server.address().port}`, trace: false } })
  try {
    const r = await runAsync(s.cwd, ['check'])
    assert.equal(r.status, 2)
    assert.equal(r.json.status, 429)
    assert.equal(r.json.fallback, 'use the phase rubric')
  } finally {
    server.close()
    s.done()
  }
})

test('CLI without --cwd: the first argument is the command, not dropped', () => {
  const r = spawnSync(process.execPath, [SCRIPT, 'config'], { encoding: 'utf8', cwd: tmpdir() })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(typeof JSON.parse(r.stdout).jev.enabled, 'boolean')
})
