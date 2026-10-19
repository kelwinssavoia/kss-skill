import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { askOf, buildBoard, parseReadme } from '../../../../mods/kss-ui/hooks/kss.ts'
import { answerLine, readDraft, safeId, summaryOf, writeAnswer } from './ask.ts'

const none = { choice: null, text: null, draft: null }

test('the answer line: the id, then what the person did in a few words', () => {
  const ask = { id: 'plan-3', kind: 'approve' as const }
  assert.equal(answerLine(ask, none), '[kss-app] answer plan-3: approved')
  assert.equal(answerLine(ask, { ...none, draft: '# v2' }), '[kss-app] answer plan-3: draft edited')
  assert.equal(answerLine({ id: 'spec-1', kind: 'question' }, { choice: { key: 'b', label: 'Redis' }, text: 'with a\nTTL', draft: null }), '[kss-app] answer spec-1: b) Redis — with a TTL')
  assert.equal(summaryOf({ kind: 'blocked' }, { ...none, text: 'x'.repeat(200) }).length, 120)
})

test('a grill from before the ask gets the bare answer it always read', () => {
  assert.equal(answerLine({ id: 'grill-q4', kind: 'question', legacy: true }, { choice: { key: 'a', label: 'At 15h' }, text: null, draft: null }), 'a) At 15h')
  assert.equal(answerLine({ id: 'grill-q4', kind: 'question', legacy: true }, { ...none, text: 'neither' }), 'neither')
})

test('answers land in the inbox; drafts are read from it and nowhere else', () => {
  const s = mkdtempSync(join(tmpdir(), 'kss-inbox-'))
  writeAnswer(s, { id: 'plan-3' }, { choice: { key: 'approve', label: 'Approve' }, text: ' ', draft: '# v2' }, 'T')
  assert.deepEqual(JSON.parse(readFileSync(join(s, '.kss/inbox/plan-3.answer.json'), 'utf8')), { id: 'plan-3', choice: { key: 'approve', label: 'Approve' }, text: null, draftEdited: true, at: 'T' })
  assert.equal(readFileSync(join(s, '.kss/inbox/plan-3.answer.md'), 'utf8'), '# v2')
  writeAnswer(s, { id: 'spec-1' }, none, 'T')
  assert.ok(!existsSync(join(s, '.kss/inbox/spec-1.answer.md')))
  assert.throws(() => writeAnswer(s, { id: '../x-1' }, none))
  assert.equal(safeId('review-decisions-12'), true)
  writeFileSync(join(s, 'secret'), 'no')
  assert.equal(readDraft(s, '.kss/inbox/plan-3.answer.md'), '# v2')
  assert.equal(readDraft(s, '.kss/inbox/../../secret'), null)
  assert.equal(readDraft(s, 'secret'), null)
})

const README = '# 012-x\n\n**State:** plan · **Size:** M\n**Next:** `/kss-plan 012-x`\n'

test('the board carries the ask of the running phase only, the waiting mark and the progress', () => {
  const current = {
    feature: '012-x', phase: 'plan', phase_started_at: '2026-10-19T10:00:00Z',
    ask: { id: 'plan-2', phase: 'plan', kind: 'approve', title: 'Approve the plan', draft: '.kss/inbox/plan-2.draft.md', at: '2026-10-19T10:05:00Z' },
    session: { turns: 3, waiting: { since: '2026-10-19T10:05:01Z', last: 'Approve?' } },
    progress: { step: 7, total: 9, label: 'Approval turn' },
    ask_log: [{ id: 'plan-1', phase: 'plan', title: 'New dependency: zod', answer: 'choice: yes) Confirm', at: 'x' }],
  }
  const b = buildBoard(current, parseReadme(README), null)!
  assert.equal(b.ask?.kind, 'approve')
  assert.equal(b.ask?.draft, '.kss/inbox/plan-2.draft.md')
  assert.equal(b.waiting?.last, 'Approve?')
  assert.deepEqual(b.progress, { step: 7, total: 9, label: 'Approval turn' })
  assert.equal(b.askLog.length, 1)
  // A precondition's ask comes before its phase enters: shown, under its own phase.
  assert.equal(askOf({ ...current, phase: 'spec' }, 'spec')?.phase, 'plan')
})

test('a handoff names the phase to run and the one to come back to', () => {
  const a = askOf({ phase: 'plan', ask: { id: 'plan-1', phase: 'plan', kind: 'handoff', title: 'Spec first', run: { phase: 'spec', args: '012-x' }, then: { phase: 'plan', args: '012-x' } } }, 'plan')
  assert.deepEqual([a?.run, a?.then], [{ phase: 'spec', args: '012-x' }, { phase: 'plan', args: '012-x' }])
})

test('an old grill question still shows, as a legacy ask', () => {
  const a = askOf({ phase: 'grill', grill: { question: { n: 4, text: 'Where?', options: [{ key: 'a', label: 'Top' }] } } }, 'grill')
  assert.equal(a?.legacy, true)
  assert.equal(a?.options[0]?.label, 'Top')
})
