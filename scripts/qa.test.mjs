// Tests for qa.mjs — the pure parts of the blind acceptance test (DESIGN.md §22).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  extractSections, requirementMap, parseDotenv, buildServiceEnv, serviceLevels, validatePlan, combine,
  overallVerdict, buildDriverPrompt, renderReport, renderPlanMd, DEFAULTS, authConfig, personaRoles,
  dbCommand, schemaName, DB_DEFAULTS,
} from './qa.mjs'
import { buildQaJudge, DEFAULTS as JEV_DEFAULTS, deepMerge } from './jev.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

const SPEC = `# 042 · Thing

## Problem

It is broken.

## Decisions

- **D-01** Count approved only.

## Functional requirements

- **FR-01** Given approved and declined rows, then only approved
  rows count. [D-01]
- **FR-02** Given no scope, then the read is refused.

## Contract and implementation boundary

- Add an rpc.
`

test('extractSections keeps the title and only the named sections', () => {
  const out = extractSections(SPEC, ['Problem', 'Functional requirements'])
  assert.match(out, /^# 042 · Thing/)
  assert.match(out, /It is broken/)
  assert.match(out, /FR-02/)
  assert.doesNotMatch(out, /D-01\*\* Count/)
  assert.doesNotMatch(out, /Add an rpc/, 'implementation sections never reach the blind agents')
})

test('requirementMap joins continuation lines', () => {
  const m = requirementMap(SPEC)
  assert.equal(m['FR-01'], 'Given approved and declined rows, then only approved rows count. [D-01]')
  assert.equal(m['FR-02'], 'Given no scope, then the read is refused.')
  assert.ok(!('D-01' in m))
})

test('parseDotenv handles quotes, comments and export', () => {
  const env = parseDotenv('# c\nA=1\nexport B="two words"\nC=x # trailing\nD=\'q\'\nbad line\n')
  assert.deepEqual(env, { A: '1', B: 'two words', C: 'x', D: 'q' })
})

test('buildServiceEnv: overrides win over env files', () => {
  const cfg = deepMerge(DEFAULTS, { env: { files: [], overrides: { KEYCLOAK_URL: 'http://localhost:18080', N: 3 } } })
  const env = buildServiceEnv('/nonexistent', cfg, { KEYCLOAK_URL: 'https://staging', PATH: '/bin' })
  assert.equal(env.KEYCLOAK_URL, 'http://localhost:18080')
  assert.equal(env.N, '3')
  assert.equal(env.PATH, '/bin')
})

test('serviceLevels closes dependencies and orders them', () => {
  const cat = { auth: {}, merchant: {}, gw: { requires: ['auth', 'merchant'] }, portal: { requires: ['gw'] } }
  assert.deepEqual(serviceLevels(cat, ['portal']), [['auth', 'merchant'], ['gw'], ['portal']])
  assert.throws(() => serviceLevels(cat, ['nope']), /unknown service/)
  assert.throws(() => serviceLevels({ a: { requires: ['b'] }, b: { requires: ['a'] } }, ['a']), /cycle/)
})

const CFG = deepMerge(DEFAULTS, {
  services: { gw: {}, portal: { requires: ['gw'] } },
  apps: { web: { url: 'http://localhost:4200', service: 'portal' } },
  databases: { backoffice: { url: 'postgresql://x' } },
})
const PLAN = {
  services: ['portal'],
  personas: [{ key: 'owner', username: 'qa@kss.test', password: 'pw', notes: 'Owner of Acme' }],
  seed: { backoffice: 'seed/backoffice.sql' },
  scenarios: [{ id: 'S-01', title: 'Totals', covers: ['FR-01'], persona: 'owner', app: 'web', path: '/dashboard', steps: ['Log in', 'Open dashboard'], expected: ['Revenue shows $100.00'] }],
  not_covered: [{ fr: 'FR-02', reason: 'server-only' }],
}

test('validatePlan accepts a complete plan and names every gap', () => {
  assert.deepEqual(validatePlan(PLAN, CFG, ['FR-01', 'FR-02']), [])
  const bad = { ...PLAN, services: ['ghost'], not_covered: [], scenarios: [{ ...PLAN.scenarios[0], id: 'X', persona: 'nobody', app: 'nope', expected: [] }], seed: { other: 'x.sql' } }
  const errs = validatePlan(bad, CFG, ['FR-01', 'FR-02']).join('\n')
  for (const re of [/ghost/, /S-01/, /nobody/, /nope/, /no expected/, /unknown database "other"/, /under seed/, /FR-02 is neither covered/]) assert.match(errs, re)
})

test('combine: agreement above threshold keeps the verdict, anything else is inconclusive', () => {
  assert.equal(combine('pass', { verdict: 'auto', choice: 'pass', confidence: 0.97, threshold: 0.8 }).final, 'pass')
  assert.equal(combine('fail', { verdict: 'auto', choice: 'fail', confidence: 1, threshold: 0.8 }).final, 'fail')
  assert.equal(combine('pass', { verdict: 'auto', choice: 'fail', confidence: 0.9, threshold: 0.8 }).final, 'inconclusive')
  assert.equal(combine('pass', { verdict: 'open', choice: 'pass', confidence: 0.6, threshold: 0.8 }).final, 'inconclusive')
  assert.equal(combine('pass', null).final, 'pass', 'Jev off: the driver verdict stands')
  assert.equal(combine(undefined, null).final, 'blocked', 'a driver that never closed is blocked')
})

test('overallVerdict: any fail rejects, all pass approves, otherwise inconclusive', () => {
  assert.equal(overallVerdict(['pass', 'pass']), 'APPROVED')
  assert.equal(overallVerdict(['pass', 'fail', 'inconclusive']), 'REJECTED')
  assert.equal(overallVerdict(['pass', 'blocked']), 'INCONCLUSIVE')
  assert.equal(overallVerdict([]), 'INCONCLUSIVE')
})

test('the driver prompt carries the scenario, never the implementation', () => {
  const tpl = readFileSync(join(HERE, '../templates/qa/driver.md'), 'utf8')
  const p = buildDriverPrompt(tpl, { scenario: PLAN.scenarios[0], persona: PLAN.personas[0], app: CFG.apps.web, requirements: requirementMap(SPEC) })
  assert.match(p, /http:\/\/localhost:4200\/dashboard/)
  assert.match(p, /qa@kss\.test/)
  assert.match(p, /\*\*FR-01\*\* Given approved/)
  assert.match(p, /1\. Log in\n2\. Open dashboard/)
  assert.match(p, /- \*\*E1\*\* Revenue shows \$100\.00/)
  assert.doesNotMatch(p, /\{\{[A-Z_]+\}\}/, 'every placeholder is filled')
})

test('buildQaJudge sends the observations, not the tester verdict, as evidence', () => {
  const cfg = deepMerge(JEV_DEFAULTS, {})
  const b = buildQaJudge({ requirements: { 'FR-01': 'x' }, scenario: 'Totals', expected: ['$100'], steps: [{ title: 't', expected: '$100', observed: '$250', status: 'fail' }] }, cfg)
  assert.deepEqual(Object.keys(b.body.questions.qa_verdict.criteria), ['pass', 'fail', 'blocked'])
  assert.equal(b.body.state.recorded_steps[0].observed, '$250')
  assert.equal(b.threshold, 0.8)
  assert.throws(() => buildQaJudge({}, cfg), /judge needs/)
})

test('report and plan render every section with evidence links', () => {
  const md = renderReport({
    feature: '042-thing', runId: '20260922-1200', head: 'abc1234', branch: '042-thing', dirty: false,
    models: { planner: 'sonnet', driver: 'haiku' }, judge: 'jev-latest (≥ 0.8)', cost: 0.42, date: '2026-09-22 12:00',
    scenarios: [{ ...PLAN.scenarios[0], driver: 'fail', jev: { choice: 'fail', confidence: 1 }, final: 'fail', note: 'driver and Jev agree (1)', summary: 'Revenue wrong', issues: [{ kind: 'defect', title: 'counts declined' }, { kind: 'adjustment', title: 'label casing' }], steps: [{ i: 1, title: 'Read revenue', expected: '$100.00', observed: '$250.00', status: 'fail', screenshot: '01-read-revenue.jpg' }], cost: 0.1, turns: 9 }],
    coverage: [{ fr: 'FR-01', scenarios: ['S-01'], result: '❌ fail' }, { fr: 'FR-02', scenarios: [], result: '➖ not UI-testable' }],
    verdict: 'REJECTED', notCovered: PLAN.not_covered, assumptions: ['week starts Monday'], services: ['portal'], seed: ['seed/backoffice.sql'], personas: PLAN.personas,
  })
  for (const h of ['## Scenarios', '## Requirement coverage', '## Confirmed flows', '## Problems', '## Adjustments', '## Not covered by the UI test', '## Planner assumptions to confirm', '## Evidence', '## Environment']) assert.ok(md.includes(h), h)
  assert.match(md, /❌ \*\*REJECTED\*\*/)
  assert.match(md, /\(runs\/20260922-1200\/S-01\/01-read-revenue\.jpg\)/)
  assert.match(md, /label casing/)
  const plan = renderPlanMd('042-thing', PLAN, requirementMap(SPEC))
  assert.match(plan, /### S-01 · Totals/)
  assert.match(plan, /\*\*FR-02\*\* — server-only/)
})

test('auth: keycloak or a project command, and the legacy keycloak block still reads', () => {
  assert.equal(authConfig(deepMerge(DEFAULTS, {})), null)
  assert.equal(authConfig(deepMerge(DEFAULTS, { keycloak: { realm: 'r' } })).provider, 'keycloak')
  assert.equal(authConfig(deepMerge(DEFAULTS, { auth: { provider: 'command', command: 'node seed-users.js' } })).command, 'node seed-users.js')
  assert.throws(() => authConfig(deepMerge(DEFAULTS, { auth: { provider: 'command' } })), /needs auth.command/)
  assert.throws(() => authConfig(deepMerge(DEFAULTS, { auth: { provider: 'ldap' } })), /keycloak or command/)
  assert.deepEqual(personaRoles({ roles: ['a'] }), ['a'])
  assert.deepEqual(personaRoles({ realmRoles: ['b'] }), ['b'])
  assert.deepEqual(personaRoles({}), [])
})

test('databases: psql is only the default, and the schema keeps its own format', () => {
  assert.equal(dbCommand({}, 'seed'), DB_DEFAULTS.seed)
  assert.equal(dbCommand({ seed: 'mysql < "$KSS_QA_SEED_FILE"' }, 'seed'), 'mysql < "$KSS_QA_SEED_FILE"')
  assert.equal(schemaName({ schema: 'db/prisma/schema.prisma' }, 'main'), 'schema/main.prisma')
  assert.equal(schemaName({ schema: 'db/structure.sql' }, 'main'), 'schema/main.sql')
  assert.equal(schemaName({ schema: 'db/SCHEMA' }, 'main'), 'schema/main')
})

test('the planner prompt names no stack', () => {
  const tpl = readFileSync(join(HERE, '../templates/qa/planner.md'), 'utf8')
  assert.doesNotMatch(tpl, /prisma|postgres|keycloak|merchant|realm/i)
})
