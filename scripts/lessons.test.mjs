// Tests for lessons.mjs: the bug-class catalogue (DESIGN.md §27) — filing cases, matching a plan,
// a ticket or a diff to the classes it is exposed to, automatic checks and escalation.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, copyFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { addEntry, escalations, globRe, matchClasses, parseDiff, runChecks } from './lessons.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'lessons.mjs')
const STARTER = JSON.parse(readFileSync(join(HERE, '..', 'templates', 'lessons.json'), 'utf8'))

const fresh = () => ({ version: 1, classes: [] })
const NEW = { title: 'Side effect lost after the commit', signature: 'Row first, send after.', question: 'What sends it again?', triggers: ['kafka', '/\\balert/'] }

test('add: a new class gets the next id; a case files under it once', () => {
  let r = addEntry(fresh(), { ...NEW, case: { feature: '073-x', pr: '#382', rv: 'RV-03', summary: 'hold email lost on a Kafka failure' } })
  assert.equal(r.id, 'BC-01')
  assert.equal(r.cat.classes[0].gate, 'review')
  r = addEntry(r.cat, { class: 'BC-01', case: { feature: '073-x', pr: '#382', rv: 'RV-04', summary: 'pull alert lost' }, triggers: ['sendMail'] })
  assert.equal(r.added, true)
  r = addEntry(r.cat, { class: 'BC-01', case: { feature: '073-x', pr: '#382', rv: 'RV-04', summary: 'same finding again' } })
  assert.equal(r.added, false)
  assert.equal(r.cat.classes[0].cases.length, 2)
  assert.deepEqual(r.cat.classes[0].triggers, ['kafka', '/\\balert/', 'sendMail'])
  assert.equal(addEntry(r.cat, { ...NEW }).id, 'BC-02')
})

test('add: refuses what cannot be matched or filed', () => {
  assert.throws(() => addEntry(fresh(), { ...NEW, triggers: [] }), /at least one trigger/)
  assert.throws(() => addEntry(fresh(), { ...NEW, question: '' }), /needs "question"/)
  assert.throws(() => addEntry(fresh(), { class: 'BC-09', case: { summary: 'x' } }), /no class BC-09/)
  assert.throws(() => addEntry(fresh(), { ...NEW, gate: 'qa' }), /gate must be/)
  assert.throws(() => addEntry(fresh(), { ...NEW, check: { pattern: '(' } }))
})

test('match: triggers and paths, most-confirmed first', () => {
  let cat = addEntry(fresh(), { ...NEW, paths: ['apps/**/payouts/**'] }).cat
  cat = addEntry(cat, { title: 'Race', signature: 's', question: 'Who wins?', triggers: ['updateMany'] }).cat
  cat = addEntry(cat, { class: 'BC-02', case: { summary: 'cleared a newer hold' } }).cat
  const found = matchClasses(cat, { text: 'await this.kafka.emit(x); await prisma.hold.updateMany()', paths: [] })
  assert.deepEqual(found.map((f) => f.id), ['BC-02', 'BC-01'])
  assert.deepEqual(matchClasses(cat, { text: '', paths: ['apps/services/merchant/src/payouts/hold.ts'] }).map((f) => f.id), ['BC-01'])
  assert.deepEqual(matchClasses(cat, { text: 'nothing relevant', paths: ['README.md'] }), [])
})

test('the starter catalogue is valid and matches the PR #382 hold service', () => {
  for (const c of STARTER.classes) assert.ok(c.id && c.title && c.question && c.triggers.length, c.id)
  const text = 'await this.alerts.raise(...); await this.prisma.grossPayoutHold.updateMany({ where: { midId } })'
  const ids = matchClasses(STARTER, { text, paths: [] }).map((f) => f.id)
  assert.ok(ids.includes('BC-01') && ids.includes('BC-02'), ids.join(','))
})

test('parseDiff and runChecks: an amount turned into a number is caught on the added line', () => {
  const diff = ['diff --git a/src/fee.ts b/src/fee.ts', '--- a/src/fee.ts', '+++ b/src/fee.ts', '@@ -10,0 +11,2 @@', '+const total = Number(row.amount) + fee', '+const label = "ok"'].join('\n')
  const d = parseDiff(diff)
  assert.deepEqual(d.files, ['src/fee.ts'])
  assert.deepEqual(d.added.map((a) => a.line), [11, 12])
  const hits = runChecks(STARTER, d.added)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].file, 'src/fee.ts')
  assert.equal(hits[0].line, 11)
})

test('escalate: a class confirmed three times with no check', () => {
  let cat = addEntry(fresh(), NEW).cat
  for (const rv of ['RV-01', 'RV-02', 'RV-03']) cat = addEntry(cat, { class: 'BC-01', case: { rv, summary: rv } }).cat
  assert.deepEqual(escalations(cat), [{ id: 'BC-01', title: NEW.title, cases: 3 }])
  assert.deepEqual(escalations(cat, 4), [])
  cat = addEntry(cat, { class: 'BC-01', check: { pattern: 'kafka\\.emit\\(', message: 'send through the outbox' } }).cat
  assert.deepEqual(escalations(cat), [])
  assert.equal(runChecks(cat, [{ file: 'a.ts', line: 3, text: 'await this.kafka.emit(x)' }])[0].message, 'send through the outbox')
})

test('globRe: ** spans directories, * stays in one', () => {
  assert.ok(globRe('apps/**/payouts/**').test('apps/a/b/payouts/x.ts'))
  assert.ok(globRe('**/*.prisma').test('schema.prisma'))
  assert.ok(!globRe('src/*.ts').test('src/a/b.ts'))
})

test('CLI: reads the starter until the first case, then writes .kss/lessons.json', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'kss-lessons-'))
  try {
    mkdirSync(join(cwd, '.kss', 'templates'), { recursive: true })
    copyFileSync(join(HERE, '..', 'templates', 'lessons.json'), join(cwd, '.kss', 'templates', 'lessons.json'))
    const run = (...a) => spawnSync(process.execPath, [SCRIPT, ...a, '--cwd', cwd], { encoding: 'utf8' })
    assert.match(run('list', '--md').stdout, /\| BC-01 \| Side effect lost after the commit \| 0 \|/)
    const r = run('add', JSON.stringify({ class: 'BC-01', case: { feature: '073-x', rv: 'RV-03', summary: 'hold email lost' } }))
    assert.equal(r.status, 0, r.stdout)
    assert.equal(JSON.parse(r.stdout).cases, 1)
    assert.ok(existsSync(join(cwd, '.kss', 'lessons.json')))
    assert.match(run('match', '--text', 'kafka.emit', '--md').stdout, /BC-01 · Side effect lost after the commit\*\* \(confirmed 1×\)/)
    assert.equal(run('add', '{"class":"BC-77","case":{"summary":"x"}}').status, 1)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
