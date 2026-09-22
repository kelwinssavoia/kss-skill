#!/usr/bin/env node
// project-cost.mjs — what a planned feature will cost, BEFORE it is executed.
//
//   node .kss/scripts/project-cost.mjs '[{"id":"01","tier":"T3","est_turns":35}, ...]'
//   node .kss/scripts/project-cost.mjs --json '[...]'      machine-readable
//
// Why this exists: 026 was specified at 16:33, ticketed at 16:45 and cost about
// $47 by 19:50, and nothing between those points ever showed a number. The
// decisions that drove the bill were taken in the grill, where they were cheap
// to change. A projection is only useful if it lands before the spending does.
//
// ── The model ────────────────────────────────────────────────────────────────
// Cost inside one agent is dominated by cache reads, and cache reads grow with
// the SQUARE of the turns: the API is stateless, so every turn resends the whole
// conversation. Fitted against 026's metrics.jsonl (agents at 42, 78, 112 and
// 152 turns) this holds within about 10% for the agents that matter:
//
//     cache_read ≈ CTX_FLOOR·t + GROWTH·t²
//
// It over-estimates short agents, whose absolute cost is small either way.
// These are ESTIMATES from one feature on one repository. Re-fit them when the
// evidence disagrees; the point is an order of magnitude before the spend, not
// an invoice.

const CTX_FLOOR = 20000 // tokens of ticket + system prompt an agent carries from turn one
const GROWTH = 1000 // extra tokens the context gains per turn, halved into the t² term
const CTX_PER_TURN = 1750 // context growth per turn, for the cache-write estimate
const OUT_PER_TURN = 140 // output tokens per turn

/** USD per million tokens. Update when the price list moves. */
export const PRICES = {
  sonnet: { in: 2, out: 10, cache_read: 0.2, cache_write: 2.5 },
  opus: { in: 5, out: 25, cache_read: 0.5, cache_write: 6.25 },
  fable: { in: 10, out: 50, cache_read: 0.25, cache_write: 12.5 },
}

/** Which model a tier spawns. Mirrors `.kss/references/tiers.md`. */
export const TIER_MODEL = { T1: 'sonnet', T2: 'sonnet', T3: 'sonnet', T4: 'opus', T5: 'opus' }

/** The agents every ticket pays for besides its executor. */
export const REVIEWER_TURNS = 25
export const INTEGRATOR_TURNS = 6

/**
 * How much longer tickets actually run than they are estimated to.
 *
 * 026's board claimed 118% of estimate; the transcripts say the executors ran
 * 124, 152 and 97 turns against estimates of 35, 55 and 40. Until the board
 * records real turns (see render-cost's spawn join) this multiplier is the
 * honest correction.
 */
export const OVERRUN = 2.5

export function agentCost(turns, model) {
  const t = Math.max(0, turns)
  const p = PRICES[model] || PRICES.sonnet
  const cacheRead = CTX_FLOOR * t + GROWTH * t * t
  const cacheWrite = CTX_FLOOR + CTX_PER_TURN * t
  const out = OUT_PER_TURN * t
  const usd = (cacheRead * p.cache_read + cacheWrite * p.cache_write + out * p.out) / 1e6
  return { turns: t, model, cache_read: cacheRead, cache_write: cacheWrite, out, usd }
}

export function project(tickets, opts = {}) {
  const overrun = typeof opts.overrun === 'number' ? opts.overrun : OVERRUN
  const rows = []
  for (const t of tickets) {
    const tier = String(t.tier || 'T2').toUpperCase()
    const model = TIER_MODEL[tier] || 'sonnet'
    const est = Number(t.est_turns) || 0
    const executor = agentCost(Math.round(est * overrun), model)
    const reviewer = agentCost(REVIEWER_TURNS, 'opus')
    const integrator = agentCost(INTEGRATOR_TURNS, 'sonnet')
    rows.push({
      id: String(t.id ?? '?'),
      tier,
      est_turns: est,
      agents: 3,
      usd: executor.usd + reviewer.usd + integrator.usd,
      parts: { executor, reviewer, integrator },
    })
  }
  const usd = rows.reduce((a, r) => a + r.usd, 0)
  return {
    tickets: rows.length,
    agents: rows.reduce((a, r) => a + r.agents, 0),
    est_turns: rows.reduce((a, r) => a + r.est_turns, 0),
    projected_turns: Math.round(rows.reduce((a, r) => a + r.est_turns * overrun, 0)),
    overrun,
    usd,
    rows,
  }
}

export function render(p) {
  const lines = [
    `Projection · ${p.tickets} ticket(s) · ${p.agents} agents · ${p.est_turns} estimated turns (${p.projected_turns} at the observed ${p.overrun}× overrun)`,
    '',
    '| Ticket | Tier | Est. turns | Agents | ~USD |',
    '| --- | --- | ---: | ---: | ---: |',
  ]
  for (const r of p.rows) lines.push(`| ${r.id} | ${r.tier} | ${r.est_turns} | ${r.agents} | $${r.usd.toFixed(2)} |`)
  lines.push(`| **Total** | | **${p.est_turns}** | **${p.agents}** | **$${p.usd.toFixed(2)}** |`)
  lines.push('')
  lines.push('Executor + reviewer + integrator per ticket. Estimates, not an invoice: re-fit against metrics.jsonl when they drift.')
  return lines.join('\n')
}

function main() {
  const argv = process.argv.slice(2)
  const asJson = argv.includes('--json')
  const raw = argv.find((a) => !a.startsWith('--'))
  if (!raw) {
    process.stderr.write('usage: project-cost.mjs [--json] \'[{"id","tier","est_turns"}, ...]\'\n')
    process.exit(1)
  }
  let tickets
  try {
    tickets = JSON.parse(raw)
  } catch {
    process.stderr.write('project-cost: argument is not valid JSON\n')
    process.exit(1)
  }
  if (!Array.isArray(tickets)) {
    process.stderr.write('project-cost: expected an array of tickets\n')
    process.exit(1)
  }
  const p = project(tickets)
  process.stdout.write((asJson ? JSON.stringify(p, null, 2) : render(p)) + '\n')
}

const isMain = process.argv[1] && process.argv[1].endsWith('project-cost.mjs')
if (isMain) main()
