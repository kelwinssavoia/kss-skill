// Tests for render-cost.mjs: which ticket an agent is credited to, and which
// agents went over budget. No files are written; `aggregate` is pure.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { aggregate, TURN_BUDGET, CTX_BUDGET } from './render-cost.mjs'

const SPAWN = (ticket, parent) => JSON.stringify({ kind: 'spawn', phase: 'execute', ticket, parent })

const AGENT = (o) =>
  JSON.stringify({
    kind: 'subagent',
    phase: 'execute',
    ticket: o.ticket ?? null,
    parent: o.parent ?? null,
    agent_type: o.agent_type ?? 'kss-sonnet-high',
    turns: o.turns ?? 10,
    duration_ms: o.duration_ms ?? 60000,
    ts: o.ts ?? '2026-09-21T21:00:00.000Z',
    tokens: { fresh_in: 0, cache_write: 0, cache_read: o.cache_read ?? 0, out: 0, cumulative: 0, ctx_end: o.ctx_end ?? 1000 },
  })

const GIT = (ticket) => JSON.stringify({ kind: 'git', phase: 'execute', ticket, git: { files: 7, added: 164, deleted: 1, commits: 3 } })

test('an agent is credited to the ticket it was spawned for, not the one that was live', () => {
  // What the SubagentStop hook writes is whatever `.kss/current` said when the
  // agent stopped. With four tickets in flight that is the wrong answer for all
  // but the last: feature 026 reported tickets 04 and 05 with zero turns and
  // ticket 02 with 438.
  const text = [
    SPAWN('04', 'toolu_A'),
    SPAWN('05', 'toolu_B'),
    AGENT({ ticket: '02', parent: 'toolu_A', turns: 50 }),
    AGENT({ ticket: '02', parent: 'toolu_B', turns: 35 }),
  ].join('\n')

  const { tickets } = aggregate(text)
  assert.equal(tickets.get('04').turns, 50)
  assert.equal(tickets.get('05').turns, 35)
  assert.equal(tickets.has('02'), false, 'the stale label creates no phantom ticket')
})

test('an agent no spawn row claims keeps the ticket on its own row', () => {
  const { tickets } = aggregate(AGENT({ ticket: '07', parent: 'toolu_Z', turns: 12 }))
  assert.equal(tickets.get('07').turns, 12)
})

test('a spawn row is bookkeeping, not an agent', () => {
  const { totals } = aggregate([SPAWN('01', 'toolu_A'), AGENT({ ticket: '01', parent: 'toolu_A' })].join('\n'))
  assert.equal(totals.agents, 1)
})

test('a git row carries the diff, not an agent count', () => {
  const { tickets, totals } = aggregate([GIT('04'), AGENT({ ticket: '04', parent: 'p' })].join('\n'))
  assert.equal(totals.agents, 1, 'the git row is not a second agent')
  assert.equal(tickets.get('04').added, 164, 'but its diff still lands on the ticket')
})

test('every agent past the turn or context budget is reported, worst first', () => {
  const text = [
    AGENT({ ticket: '03', parent: 'p1', turns: 152, ctx_end: 308737 }),
    AGENT({ ticket: '05', parent: 'p2', turns: 35, ctx_end: 25000 }),
    AGENT({ ticket: '06', parent: 'p3', turns: 40, ctx_end: 160000 }),
  ].join('\n')

  const { offenders } = aggregate(text)
  assert.equal(offenders.length, 2)
  assert.equal(offenders[0].turns, 152)
  assert.ok(offenders[0].over.includes('turns'))
  assert.ok(offenders[0].over.includes('context'))
  assert.deepEqual(offenders[1].over, ['context'])
})

test('a half-written line is skipped rather than fatal', () => {
  const { totals } = aggregate(['{"kind":"subagent"', AGENT({ ticket: '01', parent: 'p' })].join('\n'))
  assert.equal(totals.agents, 1)
})

test('the budgets are the ones DESIGN.md sets', () => {
  assert.equal(TURN_BUDGET, 80)
  assert.equal(CTX_BUDGET, 150000)
})
