// Tests for project-cost.mjs. The model is fitted against one real feature, so
// the assertions check its shape and its order of magnitude, not decimals.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { agentCost, project, render, PRICES, TIER_MODEL, OVERRUN } from './project-cost.mjs'

/** Feature 026's seven tickets, as /kss-tickets estimated them. */
const F026 = [
  { id: '01', tier: 'T3', est_turns: 35 },
  { id: '02', tier: 'T2', est_turns: 35 },
  { id: '03', tier: 'T3', est_turns: 55 },
  { id: '04', tier: 'T3', est_turns: 45 },
  { id: '05', tier: 'T2', est_turns: 35 },
  { id: '06', tier: 'T2', est_turns: 35 },
  { id: '07', tier: 'T5', est_turns: 40 },
]

test('cost grows faster than linearly in the turns, and slower than the square', () => {
  const short = agentCost(40, 'sonnet')
  const long = agentCost(80, 'sonnet')
  assert.ok(long.usd > short.usd * 2, 'doubling the turns more than doubles the cost')
  assert.ok(long.usd < short.usd * 4, 'the fixed context floor keeps it under a clean square')
})

test('an agent lands within 25% of what feature 026 actually spent on it', () => {
  // afe156054b ran ticket 03: 152 turns on Sonnet, 28.68M cache read, 595.7k
  // cache write, 18.8k out — $7.41 at the rates in PRICES.
  const { usd } = agentCost(152, 'sonnet')
  assert.ok(Math.abs(usd - 7.41) / 7.41 < 0.25, `projected $${usd.toFixed(2)} against an actual $7.41`)
})

test('an Opus agent costs more than the same work on Sonnet', () => {
  assert.ok(agentCost(50, 'opus').usd > agentCost(50, 'sonnet').usd)
})

test('the tier to model map matches references/tiers.md', () => {
  assert.deepEqual(TIER_MODEL, { T1: 'sonnet', T2: 'sonnet', T3: 'sonnet', T4: 'opus', T5: 'opus' })
})

test('every model in the tier map has a price', () => {
  for (const model of new Set(Object.values(TIER_MODEL))) {
    assert.ok(PRICES[model], `${model} has a price`)
    for (const k of ['in', 'out', 'cache_read', 'cache_write']) assert.equal(typeof PRICES[model][k], 'number')
  }
})

test('a ticket pays for an executor, a reviewer and an integrator', () => {
  const p = project([{ id: '01', tier: 'T3', est_turns: 35 }])
  assert.equal(p.agents, 3)
  assert.equal(p.rows[0].parts.reviewer.model, 'opus')
  assert.equal(p.rows[0].parts.integrator.model, 'sonnet')
})

test('the projection applies the measured overrun to the estimate', () => {
  const p = project(F026)
  assert.equal(p.tickets, 7)
  assert.equal(p.agents, 21)
  assert.equal(p.est_turns, 280)
  assert.equal(p.projected_turns, Math.round(280 * OVERRUN))
})

test('026 projects into the right order of magnitude', () => {
  // The execute phase cost about $47, of which roughly $32 was subagents.
  const p = project(F026)
  assert.ok(p.usd > 15 && p.usd < 70, `projected $${p.usd.toFixed(2)} against about $32 of real subagent spend`)
})

test('an unknown tier falls back to the cheap model rather than throwing', () => {
  const p = project([{ id: 'x', tier: 'T9', est_turns: 10 }])
  assert.equal(p.rows[0].parts.executor.model, 'sonnet')
})

test('render prints one row per ticket and a total', () => {
  const text = render(project(F026))
  for (const t of F026) assert.match(text, new RegExp(`\\| ${t.id} \\|`))
  assert.match(text, /\*\*Total\*\*/)
})
