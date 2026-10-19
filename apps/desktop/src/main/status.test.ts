import assert from 'node:assert/strict'
import { test } from 'node:test'

import { phaseStatus } from '../shared/status.ts'

const board = (o: object = {}) => ({ phase: 'plan', isPhaseFinished: false, isClosed: false, ask: null, waiting: null, tickets: [], explorers: null, ...o }) as any
const base = { live: true, exited: false, launching: false }

test('a phase is working while its process runs, finished once its Next moves on', () => {
  assert.equal(phaseStatus({ ...base, board: board() }), 'working')
  assert.equal(phaseStatus({ ...base, board: board({ isPhaseFinished: true }) }), 'finished')
  assert.equal(phaseStatus({ ...base, launching: true, board: board() }), 'starting')
  assert.equal(phaseStatus({ ...base, live: false, exited: true, board: board() }), 'exited')
  assert.equal(phaseStatus({ ...base, live: false, board: board() }), 'idle')
})

test('an ask says what kind of wait it is', () => {
  assert.equal(phaseStatus({ ...base, board: board({ ask: { kind: 'approve' } }) }), 'waiting')
  assert.equal(phaseStatus({ ...base, board: board({ ask: { kind: 'blocked' } }) }), 'blocked')
  assert.equal(phaseStatus({ ...base, board: board({ ask: { kind: 'handoff' } }) }), 'handoff')
})

test('the Stop mark is waiting — unless subagents still work, or the person already answered it', () => {
  const waiting = { since: 'T1', last: 'Third suite run failed.' }
  assert.equal(phaseStatus({ ...base, board: board({ waiting }) }), 'waiting')
  assert.equal(phaseStatus({ ...base, board: board({ waiting }), answered: 'T1' }), 'working')
  assert.equal(phaseStatus({ ...base, board: board({ waiting, tickets: [{ state: 'running' }] }) }), 'working')
  assert.equal(phaseStatus({ ...base, board: board({ waiting, explorers: { running: 3, returned: 1 } }) }), 'working')
  assert.equal(phaseStatus({ ...base, board: board({ waiting, isPhaseFinished: true }) }), 'finished')
})
