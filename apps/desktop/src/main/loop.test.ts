import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loopStep, withLoop } from '../shared/loop.ts'
import { nextRunning } from '../shared/status.ts'

const T0 = Date.parse('2026-10-27T12:00:00Z')
const loop = { startedAt: T0, launches: 0 }
const board = (o: object = {}) => ({ phase: 'review', next: '/kss-review 073-x (finish: /kss-review 073-x --done)', isClosed: false, isPhaseFinished: false, ask: null, review: null, ...o }) as any
const idle = { live: false, working: false }
const working = { live: true, working: true }
const backToExecute = '/kss-execute 073-x --ticket 09 --ticket 10 (then: /kss-review 073-x)'

test('the Next phase runs only once the board entered it — an idle CLI of its last run does not count', () => {
  assert.equal(nextRunning({ phase: 'review', isClosed: false }, 'execute', true), false)
  assert.equal(nextRunning({ phase: 'execute', isClosed: false }, 'execute', true), true)
  assert.equal(nextRunning({ phase: 'execute', isClosed: false }, 'execute', false), false)
})

test('a review round that opened fix tickets runs execute; an execute that ended runs the next round with --loop', () => {
  assert.deepEqual(loopStep(board({ next: backToExecute, isPhaseFinished: true }), loop, idle), { run: { phase: 'execute', args: '073-x --ticket 09 --ticket 10' } })
  assert.deepEqual(loopStep(board({ phase: 'execute', isPhaseFinished: true }), loop, working), { run: { phase: 'review', args: '073-x --loop' } })
  assert.equal(loopStep(board({ phase: 'execute', next: backToExecute }), loop, working), null)
})

test('a review still working its round, or waiting on the person, is left alone', () => {
  assert.equal(loopStep(board(), loop, working), null)
  assert.equal(loopStep(board({ ask: { kind: 'question' } }), loop, idle), null)
  assert.deepEqual(loopStep(board(), loop, idle), { run: { phase: 'review', args: '073-x --loop' } })
})

test('a live round of this loop that ended a turn is not replaced; one left by an earlier loop, or a closed process, is', () => {
  const mark = (state: string, at: string) => board({ waiting: { since: at }, review: { round: 20, watching: null, loop: { state, reason: null, until: null, at } } })
  assert.equal(loopStep(mark('running', '2026-10-27T12:05:00Z'), loop, { live: true, working: false }), null)
  assert.equal(loopStep(mark('waiting', '2026-10-27T12:05:00Z'), loop, { live: true, working: false }), null)
  assert.deepEqual(loopStep(mark('running', '2026-10-27T12:05:00Z'), loop, { live: false, working: false }), { run: { phase: 'review', args: '073-x --loop' } })
  assert.deepEqual(loopStep(mark('running', '2026-10-27T11:00:00Z'), loop, { live: true, working: false }), { run: { phase: 'review', args: '073-x --loop' } })
})

test('the loop stops on the review’s own stop mark, the end of the review, or the round cap', () => {
  const stopped = (at: string, reason = 'clean') => board({ review: { round: 3, watching: null, loop: { state: 'stopped', reason, until: null, at } } })
  assert.deepEqual(loopStep(stopped('2026-10-27T12:30:00Z'), loop, idle), { stop: 'the reviewer found nothing new' })
  assert.deepEqual(loopStep(stopped('2026-10-27T12:30:00Z', 'timeout'), loop, idle), { stop: '20 minutes without a new review' })
  // A mark left by an earlier loop does not stop the one just switched on.
  assert.deepEqual(loopStep(stopped('2026-10-27T11:00:00Z'), loop, idle), { run: { phase: 'review', args: '073-x --loop' } })
  assert.deepEqual(loopStep(board({ isClosed: true }), loop, idle), { stop: 'the review was finished' })
  assert.deepEqual(loopStep(board({ next: '/kss-docs-tech 073-x' }), loop, idle), { stop: 'the track moved on to docs-tech' })
  assert.deepEqual(loopStep(board(), { startedAt: T0, launches: 20 }, idle), { stop: 'ten rounds reached' })
})

test('a review the loop started is never started again while its process lives — it may only wait on its own subagent', () => {
  const waitingOnAgent = { live: true, working: false }
  assert.equal(loopStep(board(), { startedAt: T0, launches: 1 }, waitingOnAgent), null)
  // Switched on over an idle review: that one is started once.
  assert.deepEqual(loopStep(board(), loop, waitingOnAgent), { run: { phase: 'review', args: '073-x --loop' } })
  // Its process gone: the loop starts it again.
  assert.deepEqual(loopStep(board(), { startedAt: T0, launches: 1 }, idle), { run: { phase: 'review', args: '073-x --loop' } })
  // After an execute, the idle review of the previous round is replaced.
  assert.deepEqual(loopStep(board({ phase: 'execute', isPhaseFinished: true }), { startedAt: T0, launches: 2 }, waitingOnAgent), { run: { phase: 'review', args: '073-x --loop' } })
})

test('--loop is added once', () => {
  assert.equal(withLoop('073-x'), '073-x --loop')
  assert.equal(withLoop('073-x --loop'), '073-x --loop')
})
