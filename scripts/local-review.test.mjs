// Tests for local-review.mjs: kss-review's local saturation — the PR's reviewer CLI run on the
// feature branch, pass after pass, until a pass finds nothing new (DESIGN.md §15.2). No network:
// the reviewer CLI is a fake script that answers from a fixture.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DEFAULTS } from './jev.mjs'
import { FINDING_SCHEMA, buildPrompt, decide, mergeFindings, parseVersion, pickCli, sameFinding } from './local-review.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'local-review.mjs')

const f = (file, line, title, priority = 'P2') => ({ priority, file, line, title, scenario: 's', mechanism: 'm' })

// ---------------------------------------------------------------- defaults and schema

test('defaults: review_local is on, sol medium, 2 runs per pass, 6 passes at most', () => {
  const r = DEFAULTS.review_local
  assert.equal(r.enabled, true)
  assert.equal(r.cli, 'auto')
  assert.equal(r.model, 'gpt-6.1-sol')
  assert.equal(r.reasoning_effort, 'medium')
  assert.equal(r.parallel, 2)
  assert.equal(r.max_passes, 6)
})

test('schema: every property is required and nothing else is allowed (strict structured output)', () => {
  assert.equal(FINDING_SCHEMA.additionalProperties, false)
  assert.deepEqual(FINDING_SCHEMA.required, ['findings'])
  const item = FINDING_SCHEMA.properties.findings.items
  assert.equal(item.additionalProperties, false)
  assert.deepEqual([...item.required].sort(), Object.keys(item.properties).sort())
})

// ---------------------------------------------------------------- prompt

test('prompt: names the diff against the base, the settled files, and forbids running the suite', () => {
  const p = buildPrompt({ base: 'dev', featureDir: 'specs/113-x', exclude: [], pending: [], excludeText: '' })
  assert.match(p, /git diff origin\/dev\.\.\.HEAD/)
  assert.match(p, /specs\/113-x\/02-decisions\.md/)
  assert.match(p, /specs\/113-x\/auto-decisions\.md/)
  assert.match(p, /specs\/113-x\/07-review\.md/)
  assert.match(p, /no cap on the number of findings/i)
  assert.match(p, /Do not run tests/)
})

test('prompt: lists every known finding and every pending fix ticket as do-not-re-raise', () => {
  const p = buildPrompt({
    base: 'dev',
    featureDir: 'specs/113-x',
    exclude: [f('a.ts', 10, 'Guard FindBatches'), f('b.ts', 3, 'Snapshot detail')],
    pending: ['specs/113-x/05-tickets/25-walked.md'],
    excludeText: 'RV-11 — gateway export truncates',
  })
  assert.match(p, /1\. a\.ts:10 — Guard FindBatches/)
  assert.match(p, /2\. b\.ts:3 — Snapshot detail/)
  assert.match(p, /25-walked\.md/)
  assert.match(p, /would NOT fix it/)
  assert.match(p, /RV-11 — gateway export truncates/)
})

// ---------------------------------------------------------------- dedupe

test('same finding: same file and nearby line, or same file and most title words shared', () => {
  assert.ok(sameFinding(f('a.ts', 10, 'x'), f('a.ts', 22, 'y')))
  assert.ok(!sameFinding(f('a.ts', 10, 'x'), f('a.ts', 80, 'y')))
  assert.ok(sameFinding(f('a.ts', 10, 'Authenticate FindBatches before exposing debits'), f('./a.ts', 300, 'Authenticate the FindBatches RPC before exposing coverage debits')))
  assert.ok(!sameFinding(f('a.ts', 10, 'x'), f('b.ts', 10, 'x')))
})

test('same finding: absolute paths and a leading ./ compare equal to the repo path', () => {
  assert.ok(sameFinding(f('/Users/me/wt/apps/x.ts', 5, 'a'), f('apps/x.ts', 6, 'b'), '/Users/me/wt'))
})

test('merge: only findings unlike every known one are added, ids continue', () => {
  const known = [{ id: 'L-01', ...f('a.ts', 10, 'one') }]
  const { all, added } = mergeFindings(known, [f('a.ts', 12, 'one again'), f('b.ts', 1, 'two'), f('b.ts', 2, 'two dup')], 3)
  assert.equal(added.length, 1)
  assert.equal(added[0].id, 'L-02')
  assert.equal(added[0].pass, 3)
  assert.equal(all.length, 2)
})

// ---------------------------------------------------------------- stop rule

test('decide: a pass with a successful run and nothing new saturates', () => {
  assert.equal(decide({ pass: 3, added: 0, ok: 1, failed: 1 }, { max_passes: 6 }), 'saturated')
})

test('decide: new findings go on, until the cap', () => {
  assert.equal(decide({ pass: 2, added: 4, ok: 2, failed: 0 }, { max_passes: 6 }), 'continue')
  assert.equal(decide({ pass: 6, added: 1, ok: 2, failed: 0 }, { max_passes: 6 }), 'cap')
})

test('decide: a pass where every run failed is an error, never a clean saturation', () => {
  assert.equal(decide({ pass: 1, added: 0, ok: 0, failed: 2 }, { max_passes: 6 }), 'error')
})

// ---------------------------------------------------------------- cli choice

test('cli: the newest version among the candidates wins (a stale codex on PATH loses)', () => {
  assert.deepEqual(parseVersion('codex-cli 0.166.0-alpha.5.1'), [0, 166, 0])
  const pick = pickCli([
    { path: '/home/.local/bin/codex', version: 'codex-cli 0.153.0' },
    { path: '/Applications/ChatGPT.app/codex', version: 'codex-cli 0.166.0-alpha.5.1' },
    { path: '/broken', version: null },
  ])
  assert.equal(pick, '/Applications/ChatGPT.app/codex')
  assert.equal(pickCli([{ path: '/broken', version: null }]), null)
})

// ---------------------------------------------------------------- end to end, with a fake reviewer

function fakeRepo(answers) {
  const cwd = mkdtempSync(join(tmpdir(), 'kss-local-review-'))
  spawnSync('git', ['init', '-q'], { cwd })
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd })
  mkdirSync(join(cwd, '.kss'))
  mkdirSync(join(cwd, 'specs', '113-x'), { recursive: true })
  // One run per pass (parallel 1) so calls are ordered; each takes the next answer, past the end none.
  writeFileSync(join(cwd, 'answers.json'), JSON.stringify(answers))
  const fake = join(cwd, 'fake-codex.mjs')
  writeFileSync(
    fake,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
const a = process.argv
if (a.includes('--version')) { console.log('codex-cli 9.9.9'); process.exit(0) }
const out = a[a.indexOf('-o') + 1]
const dir = ${JSON.stringify(cwd)}
const counter = dir + '/calls'
const n = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0
writeFileSync(counter, String(n + 1))
writeFileSync(dir + '/args-' + n + '.json', JSON.stringify(a))
const answers = JSON.parse(readFileSync(dir + '/answers.json', 'utf8'))
const ans = answers[n] ?? { findings: [] }
if (ans === 'fail') process.exit(3)
writeFileSync(out, JSON.stringify(ans))
`,
  )
  chmodSync(fake, 0o755)
  writeFileSync(join(cwd, '.kss', 'config.json'), JSON.stringify({ review_local: { cli: fake, parallel: 1, max_passes: 6 } }))
  return { cwd, done: () => rmSync(cwd, { recursive: true, force: true }) }
}

function run(cwd, args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--cwd', cwd], { encoding: 'utf8' })
  let json = null
  try {
    json = JSON.parse(r.stdout)
  } catch {
    /* leave null */
  }
  return { status: r.status, json, err: r.stderr }
}

test('end to end: passes run until one adds nothing, then the findings are written', () => {
  const { cwd, done } = fakeRepo([
    { findings: [f('a.ts', 10, 'Guard FindBatches', 'P1')] },
    { findings: [f('a.ts', 12, 'Guard the FindBatches rpc', 'P1'), f('b.ts', 4, 'Snapshot detail')] },
    { findings: [f('c.ts', 1, 'Old portal paging')] },
    { findings: [] },
  ])
  try {
    const s = run(cwd, ['start', '--feature', 'specs/113-x', '--round', '8', '--base', 'dev'])
    assert.equal(s.status, 0, s.err)
    assert.equal(s.json.outcome, 'started')
    let w
    for (let i = 0; i < 5; i++) {
      w = run(cwd, ['wait', '--feature', 'specs/113-x', '--round', '8', '--slice', '20', '--every', '1'])
      if (w.json && w.json.outcome !== 'pending') break
    }
    assert.equal(w.json.outcome, 'saturated', JSON.stringify(w.json))
    assert.equal(w.json.passes, 4)
    assert.deepEqual(w.json.findings.map((x) => x.id), ['L-01', 'L-02', 'L-03'])
    assert.equal(w.json.findings[0].priority, 'P1')
    const md = readFileSync(join(cwd, 'specs', '113-x', 'notes', 'review-8-local', 'findings.md'), 'utf8')
    assert.match(md, /L-02 · P2 · b\.ts:4 — Snapshot detail/)
    // Pass 2 told the reviewer what pass 1 found.
    const prompt2 = readFileSync(join(cwd, 'specs', '113-x', 'notes', 'review-8-local', 'prompt-2.md'), 'utf8')
    assert.match(prompt2, /a\.ts:10 — Guard FindBatches/)
    // Read-only sandbox, the configured model and effort, the strict schema.
    const args = JSON.parse(readFileSync(join(cwd, 'args-0.json'), 'utf8'))
    assert.ok(args.includes('read-only'))
    assert.ok(args.includes('gpt-6.1-sol'))
    assert.ok(args.includes('model_reasoning_effort=medium'))
    assert.ok(args.includes('--output-schema'))
  } finally {
    done()
  }
})

test('end to end: every run of a pass failing is an error, not a saturation', () => {
  const { cwd, done } = fakeRepo(['fail', 'fail'])
  try {
    run(cwd, ['start', '--feature', 'specs/113-x', '--round', '1', '--base', 'dev'])
    let w
    for (let i = 0; i < 3; i++) {
      w = run(cwd, ['wait', '--feature', 'specs/113-x', '--round', '1', '--slice', '20', '--every', '1'])
      if (w.json && w.json.outcome !== 'pending') break
    }
    assert.equal(w.json.outcome, 'error')
  } finally {
    done()
  }
})

test('start on a finished round with the same head answers the stored outcome without rerunning', () => {
  const { cwd, done } = fakeRepo([{ findings: [] }, { findings: [] }])
  try {
    run(cwd, ['start', '--feature', 'specs/113-x', '--round', '2', '--base', 'dev'])
    let w
    for (let i = 0; i < 3; i++) {
      w = run(cwd, ['wait', '--feature', 'specs/113-x', '--round', '2', '--slice', '20', '--every', '1'])
      if (w.json && w.json.outcome !== 'pending') break
    }
    assert.equal(w.json.outcome, 'saturated')
    const again = run(cwd, ['start', '--feature', 'specs/113-x', '--round', '2', '--base', 'dev'])
    assert.equal(again.json.outcome, 'saturated')
    assert.equal(readFileSync(join(cwd, 'calls'), 'utf8'), '1')
  } finally {
    done()
  }
})

test('disabled in config: start answers skipped and runs nothing', () => {
  const { cwd, done } = fakeRepo([])
  try {
    writeFileSync(join(cwd, '.kss', 'config.json'), JSON.stringify({ review_local: { enabled: false } }))
    const s = run(cwd, ['start', '--feature', 'specs/113-x', '--round', '1', '--base', 'dev'])
    assert.equal(s.json.outcome, 'skipped')
    assert.ok(!existsSync(join(cwd, 'calls')))
  } finally {
    done()
  }
})
