// Tests for qa.mjs — the pure parts of the blind acceptance test (DESIGN.md §22).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  extractSections, requirementMap, parseDotenv, buildServiceEnv, serviceLevels, validatePlan, combine,
  overallVerdict, buildDriverPrompt, renderReport, renderPlanMd, DEFAULTS, authConfig, personaRoles,
  dbCommand, schemaName, DB_DEFAULTS, LIVE, liveRecord, triageLogs, mergeRecipes, environmentDoc,
} from './qa.mjs'
import { matchPath, findRoute, renderBody } from './qa-stub.mjs'
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

test('live.json names the scenario being driven and the Chrome to watch (DESIGN.md §24.5)', () => {
  assert.equal(LIVE, '.kss/qa/.runtime/live.json')
  const r = liveRecord({ runId: '20261013-2240', scenario: { id: 'S-02', title: 'Export a batch' }, evidence: '/f/qa/runs/20261013-2240/S-02', cdp: 'http://127.0.0.1:9555', now: '2026-10-13T22:40:00.000Z' })
  assert.deepEqual(r, {
    runId: '20261013-2240', scenario: 'S-02', title: 'Export a batch', evidence: '/f/qa/runs/20261013-2240/S-02',
    cdp: 'http://127.0.0.1:9555', startedAt: '2026-10-13T22:40:00.000Z',
  })
})

test('serviceLevels: `uses` pulls a service in without ordering it, so mutual callers start', () => {
  const cat = { merchant: { uses: ['integrations'] }, integrations: { uses: ['merchant'] }, gw: { requires: ['merchant'], uses: ['integrations'] } }
  assert.deepEqual(serviceLevels(cat, ['gw']), [['integrations', 'merchant'], ['gw']])
  assert.deepEqual(serviceLevels(cat, ['merchant']), [['integrations', 'merchant']])
  assert.throws(() => serviceLevels({ a: { uses: ['ghost'] } }, ['a']), /unknown service "ghost"/)
})

test('triageLogs names a missing service, an external call with no stub and a stub miss', () => {
  const services = { merchant: { ready: { tcp: 50052 } }, integrations: { ready: { tcp: 50054 } } }
  const stubs = { pay: { port: 18190 } }
  const logs = {
    merchant: [
      'ERROR 14 UNAVAILABLE: No connection established. Last error: Error: connect ECONNREFUSED 0.0.0.0:50054. Resolution note:',
      'Error: connect ECONNREFUSED 0.0.0.0:50054. again',
      'connect ECONNREFUSED 127.0.0.1:9',
      'connect ECONNREFUSED 0.0.0.0:50052',
    ].join('\n'),
    'stub-pay': '[kss-qa stub pay] 2 routes on 18190\n{"method":"GET","path":"/accounts/a/bank-accounts","matched":false,"status":404}\n{"method":"POST","path":"/oauth2/token","matched":true,"status":200}',
  }
  const issues = triageLogs({ services, stubs, started: ['merchant', 'stub-pay'], logs })
  assert.deepEqual(issues.map((i) => i.kind), ['missing-service', 'unreachable', 'stub-miss'])
  assert.equal(issues[0].service, 'integrations')
  assert.equal(issues[0].port, 50054)
  assert.equal(issues[1].target, '127.0.0.1:9')
  assert.match(issues[2].detail, /GET \/accounts\/a\/bank-accounts/)
  assert.deepEqual(triageLogs({ services, started: ['merchant', 'integrations'], logs: { merchant: 'connect ECONNREFUSED [::1]:50054' } }), [], 'a started service refusing is not a catalog gap')
})

test('combine: the environment turns a blocked scenario into `environment` and a fail into inconclusive', () => {
  const env = [{ kind: 'missing-service', detail: 'merchant called integrations on port 50054, which was not started' }]
  const agree = (c) => ({ verdict: 'auto', choice: c, confidence: 0.95, threshold: 0.8 })
  assert.equal(combine('blocked', agree('blocked'), env).final, 'environment')
  assert.equal(combine('blocked', { verdict: 'open', choice: 'blocked', confidence: 0.4, threshold: 0.8 }, env).final, 'environment')
  assert.equal(combine('fail', agree('fail'), env).final, 'inconclusive')
  assert.equal(combine('pass', agree('pass'), env).final, 'pass')
  assert.match(combine('pass', agree('pass'), env).note, /environment warnings/)
  assert.equal(overallVerdict(['pass', 'environment']), 'INCONCLUSIVE')
})

test('mergeRecipes appends only new rules, ignoring case and spacing', () => {
  const first = mergeRecipes('', ['A MID shows its deposit account only when MidMoovMirror.pullBankAccountId equals MidMoovConfig.bankAccountId.'])
  assert.match(first, /^# kss-qa recipes/)
  assert.equal(mergeRecipes(first, ['a mid shows its deposit account only when  MidMoovMirror.pullBankAccountId equals MidMoovConfig.bankAccountId.']), first)
  const second = mergeRecipes(first, ['Screens with a bank picker list the provider accounts.', ''])
  assert.equal(second.split('\n').filter((l) => l.startsWith('- ')).length, 2)
})

test('environmentDoc tells the planner about stubs and learned recipes', () => {
  const cfg = deepMerge(CFG, { stubs: { pay: { port: 18190, description: 'Payment provider API' } } })
  const doc = environmentDoc(cfg, '# kss-qa recipes\n\nintro\n- Rule one.\n')
  assert.match(doc, /## External providers \(stubbed\)/)
  assert.match(doc, /\*\*pay\*\* — Payment provider API/)
  assert.match(doc, /provider_state/)
  assert.match(doc, /## Seed recipes[^\n]*\n\n[^\n]+\n\n- Rule one\./)
  assert.doesNotMatch(environmentDoc(CFG, ''), /stubbed|Seed recipes/)
})

test('validatePlan refuses provider_state for a provider that is not stubbed', () => {
  const cfg = deepMerge(CFG, { stubs: { pay: { port: 1 } } })
  assert.deepEqual(validatePlan({ ...PLAN, provider_state: { pay: ['x'] } }, cfg, ['FR-01', 'FR-02']), [])
  assert.match(validatePlan({ ...PLAN, provider_state: { bank: ['x'] } }, cfg, ['FR-01', 'FR-02']).join('\n'), /"bank", which is not a stub/)
})

test('report: environment problems and the audit get their own sections, out of Problems', () => {
  const md = renderReport({
    feature: '042-thing', runId: 'r1', head: 'abc', branch: 'b', dirty: false, models: { planner: 'sonnet', driver: 'haiku' }, judge: 'off', cost: 0, date: '',
    scenarios: [{ ...PLAN.scenarios[0], driver: 'blocked', jev: null, final: 'environment', note: 'the environment broke', summary: 'no accounts', issues: [], steps: [{ i: 1, title: 'Pick', expected: 'list', observed: 'error', status: 'blocked' }], environment: [{ kind: 'missing-service', detail: 'merchant called integrations' }] }],
    coverage: [], verdict: 'INCONCLUSIVE', notCovered: [], assumptions: [], services: [], seed: [], personas: [],
    audit: { model: 'sonnet', seed_changes: [{ file: 'seed/backoffice.sql', change: 'set pullBankAccountId', reason: 'depositPullBank.ts:23' }], spec_conflicts: [{ scenario: 'S-01', detail: 'filters verified only' }], recipes: ['Rule.'] },
  })
  assert.match(md, /## Problems\n\n_None\._/)
  assert.match(md, /## Environment problems[\s\S]*missing-service[\s\S]*requires` or `uses`/)
  assert.match(md, /## Environment audit[\s\S]*set pullBankAccountId[\s\S]*possible defects[\s\S]*filters verified only/)
  assert.match(md, /🧰 environment/)
})

test('the audit prompt keeps the plan read-only and forbids seeding around a defect', () => {
  const tpl = readFileSync(join(HERE, '../templates/qa/audit.md'), 'utf8')
  assert.match(tpl, /Never change `input\/plan\.json`/)
  assert.match(tpl, /Never seed around a defect/)
  assert.match(tpl, /\{\{REPO\}\}/)
})

test('qa-stub: path patterns, first match wins, placeholders resolve against the request', () => {
  assert.deepEqual(matchPath('/accounts/:id/bank-accounts', '/accounts/a%201/bank-accounts'), { params: { id: 'a 1' } })
  assert.equal(matchPath('/accounts/:id', '/accounts/a/extra'), null)
  assert.deepEqual(matchPath('/files/*', '/files/x/y'), { params: {} })
  const routes = [
    { method: 'GET', path: '/accounts/:id', query: { full: 'true' }, body: 'full' },
    { method: 'GET', path: '/accounts/:id', body: 'short' },
    { path: '/oauth2/token', body: { access_token: 't', expires_in: '{{now+3600}}', scope: '{{body.scope}}' } },
  ]
  assert.equal(findRoute(routes, { method: 'GET', path: '/accounts/a', query: { full: 'true' } }).route.body, 'full')
  assert.equal(findRoute(routes, { method: 'GET', path: '/accounts/a', query: {} }).route.body, 'short')
  assert.equal(findRoute(routes, { method: 'DELETE', path: '/accounts/a', query: {} }), null)
  const tok = findRoute(routes, { method: 'POST', path: '/oauth2/token', query: {} })
  assert.deepEqual(renderBody(tok.route.body, { params: tok.params, query: {}, body: { scope: '/accounts.read' } }, 1000), { access_token: 't', expires_in: 4600, scope: '/accounts.read' })
  assert.equal(renderBody('{{param.id}}', { params: { id: 'x' } }), 'x')
  assert.equal(renderBody('not {{now}} alone', {}), 'not {{now}} alone')
})
