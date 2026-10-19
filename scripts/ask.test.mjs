// Tests for ask.mjs — the ask a phase publishes for kss-desktop and the answer it reads back (DESIGN.md §26).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { normalize, render } from './ask.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'ask.mjs')

function sandbox() {
  const cwd = mkdtempSync(join(tmpdir(), 'kss-ask-'))
  mkdirSync(join(cwd, '.kss'))
  writeFileSync(join(cwd, '.kss/config.md'), 'features_root: docs/features\n')
  mkdirSync(join(cwd, 'docs/features/001-x/notes'), { recursive: true })
  writeFileSync(join(cwd, '.kss/current'), JSON.stringify({ feature: '001-x', phase: 'plan' }))
  return { cwd, done: () => rmSync(cwd, { recursive: true, force: true }) }
}

const run = (cwd, args, input) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--cwd', cwd], { encoding: 'utf8', input })
  return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() }
}
const current = (cwd) => JSON.parse(readFileSync(join(cwd, '.kss/current'), 'utf8'))

test('normalize: a question keeps its options in order, keys default to letters', () => {
  const { ask, errs } = normalize({ phase: 'kss-spec', kind: 'question', title: 'Cutoff hour', options: [{ label: 'At 15h' }, { key: 'z', label: 'At 18h', lean: true }], category: 'technical' }, 'spec-1', 'T')
  assert.equal(errs, undefined)
  assert.equal(ask.phase, 'spec')
  assert.deepEqual(ask.options.map(o => [o.key, o.label, o.lean]), [['a', 'At 15h', false], ['z', 'At 18h', true]])
})

test('normalize: refuses what the app could not show', () => {
  assert.match(normalize({ phase: 'plan', kind: 'nope', title: 't' }, 'x', 'T').errs.join(), /kind must be/)
  assert.match(normalize({ phase: 'plan', kind: 'approve', title: 't' }, 'x', 'T').errs.join(), /needs a draft/)
  assert.match(normalize({ phase: 'plan', kind: 'question', title: 't', category: 'business', options: [{ label: 'a', lean: true }] }, 'x', 'T').errs.join(), /no lean/)
  assert.match(normalize({ phase: 'plan', kind: 'handoff', title: 't' }, 'x', 'T').errs.join(), /run must be/)
  assert.match(normalize({ phase: 'plan', kind: 'question', title: 'x'.repeat(81) }, 'x', 'T').errs.join(), /title is over/)
})

test('normalize: a handoff names the phase to run and the one to come back to', () => {
  const { ask } = normalize({ phase: 'plan', kind: 'handoff', title: 'Spec first', run: { phase: 'kss-spec', args: '001-x' }, then: { phase: 'plan', args: '001-x' } }, 'plan-1', 'T')
  assert.deepEqual(ask.run, { phase: 'spec', args: '001-x' })
  assert.deepEqual(ask.then, { phase: 'plan', args: '001-x' })
})

test('render: choice, free text and the draft verdict', () => {
  assert.equal(render({ choice: { key: 'b', label: 'Redis' }, text: 'with a TTL', draftEdited: false }, null), 'choice: b) Redis\ntext: with a TTL\ndraft: unchanged')
  assert.equal(render({ choice: null, text: null, draftEdited: true }, '.kss/inbox/plan-1.answer.md'), 'draft: edited — .kss/inbox/plan-1.answer.md')
  assert.equal(render(null, null), 'no answer recorded — ask again')
})

test('post → answer: the draft is snapshotted, the answer read back, the ask cleared and logged', () => {
  const s = sandbox()
  try {
    writeFileSync(join(s.cwd, 'docs/features/001-x/notes/plan-draft.md'), '# Plan\n')
    const p = run(s.cwd, ['post'], JSON.stringify({ phase: 'plan', kind: 'approve', title: 'Approve the plan', draft: 'notes/plan-draft.md' }))
    assert.equal(p.status, 0, p.err)
    assert.equal(p.out, 'plan-1')
    const c = current(s.cwd)
    assert.equal(c.ask.draft, '.kss/inbox/plan-1.draft.md')
    assert.equal(c.ask_seq, 1)
    assert.ok(existsSync(join(s.cwd, '.kss/inbox/plan-1.draft.md')))

    writeFileSync(join(s.cwd, '.kss/inbox/plan-1.answer.json'), JSON.stringify({ id: 'plan-1', choice: { key: 'approve', label: 'Approve' }, text: null, draftEdited: true }))
    writeFileSync(join(s.cwd, '.kss/inbox/plan-1.answer.md'), '# Plan v2\n')
    const a = run(s.cwd, ['answer', 'plan-1'])
    assert.equal(a.out, 'choice: approve) Approve\ndraft: edited — .kss/inbox/plan-1.answer.md')
    const after = current(s.cwd)
    assert.equal(after.ask, undefined)
    assert.equal(after.ask_log[0].title, 'Approve the plan')

    const q = run(s.cwd, ['post'], JSON.stringify({ phase: 'plan', kind: 'question', title: 'Which queue?' }))
    assert.equal(q.out, 'plan-2')
  } finally {
    s.done()
  }
})

test('post refuses an invalid ask and leaves the file alone', () => {
  const s = sandbox()
  try {
    const r = run(s.cwd, ['post'], JSON.stringify({ phase: 'plan', kind: 'approve', title: 'x' }))
    assert.equal(r.status, 1)
    assert.match(r.err, /needs a draft/)
    assert.equal(current(s.cwd).ask, undefined)
  } finally {
    s.done()
  }
})

test('clear drops the ask', () => {
  const s = sandbox()
  try {
    run(s.cwd, ['post'], JSON.stringify({ phase: 'plan', kind: 'confirm', title: 'Go?' }))
    assert.equal(run(s.cwd, ['clear']).status, 0)
    assert.equal(current(s.cwd).ask, undefined)
  } finally {
    s.done()
  }
})
