// Tests for report.mjs — the feature's explained report (DESIGN.md §25).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { checkSnippets, html, model, readReports, validate, validateSection } from './report.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'report.mjs')

const ok = (phase, extra = {}) => ({ phase, lang: 'pt-BR', summary: 'Resumo.', did: ['Fiz isto'], ...extra })

function feature(reports, readme = '# 012-x\n\n**State:** spec · **Size:** M · **Track:** …\n**Next:** /kss-plan 012-x  <!-- note -->\n') {
  const dir = join(mkdtempSync(join(tmpdir(), 'report-')), '012-x')
  mkdirSync(join(dir, 'report'), { recursive: true })
  writeFileSync(join(dir, 'README.md'), readme)
  for (const r of reports) writeFileSync(join(dir, 'report', `${r.phase}.json`), JSON.stringify(r))
  return dir
}

test('a phase file needs its phase, language, summary and what was done', () => {
  assert.deepEqual(validate(ok('spec'), 'spec'), [])
  assert.ok(validate(ok('plan'), 'spec').some((e) => e.includes('"phase" must be "spec"')))
  assert.ok(validate({ phase: 'spec' }, 'spec').length >= 3)
  assert.ok(validate(ok('spec', { did: [] }), 'spec').some((e) => e.includes('"did"')))
  assert.ok(validate(ok('spec', { summary: 'x'.repeat(2000) }), 'spec').some((e) => e.includes('over')))
})

test('decisions: title and decision required, kind and status from the known lists', () => {
  assert.deepEqual(validate(ok('grill', { decisions: [{ id: 'D-01', title: 'T', decision: 'D', kind: 'business', status: 'decided', rejected: ['x'] }] }), 'grill'), [])
  const errs = validate(ok('grill', { decisions: [{ title: 'T', kind: 'vibes', status: 'maybe', rejected: 'x' }] }), 'grill')
  assert.equal(errs.length, 4)
})

test('the model: track order, the README Next, costs per phase from metrics.jsonl', () => {
  const dir = feature([ok('spec'), ok('clarify'), ok('investigate')])
  writeFileSync(join(dir, 'metrics.jsonl'), JSON.stringify({ ts: '2026-10-14T10:05:00Z', phase: 'spec', kind: 'session', harness: 'codex', turns: 7, duration_ms: 300000, tokens: { cumulative: 12000 } }) + '\n')
  const m = model(dir, '2026-10-15T00:00:00Z')
  assert.deepEqual(m.reports.map((r) => r.phase), ['clarify', 'investigate', 'spec'])
  assert.deepEqual(m.phases, ['clarify', 'investigate', 'spec', 'plan', 'tickets', 'execute', 'review'])
  assert.equal(m.next, '/kss-plan 012-x')
  assert.deepEqual(m.cost.spec, { agents: 1, turns: 7, tokens: 12000, minutes: 5, harnesses: ['codex'] })
  assert.equal(m.lang, 'pt-BR')
})

test('an optional phase that ran joins the track', () => {
  const m = model(feature([ok('clarify'), ok('qa')]))
  assert.ok(m.phases.includes('qa'))
  assert.ok(!m.phases.includes('grill'))
})

test('model-written text never becomes markup: it is embedded as escaped JSON', () => {
  const page = html(model(feature([ok('spec', { summary: '</script><img src=x onerror=alert(1)>' })])))
  assert.ok(!page.includes('</script><img'))
  assert.ok(page.includes('\\u003c/script>'))
  assert.ok(!/innerHTML/.test(page))
})

test('CLI: writes index.html, and refuses an invalid phase file with the reason', () => {
  const dir = feature([ok('clarify')])
  const good = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' })
  assert.equal(good.status, 0, good.stderr)
  assert.match(good.stdout, /report: .*report\/index\.html \(1 phase\)/)
  assert.match(readFileSync(join(dir, 'report/index.html'), 'utf8'), /id="kss-data"/)

  writeFileSync(join(dir, 'report/spec.json'), '{"phase":"spec"')
  const bad = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /spec\.json: invalid JSON/)

  writeFileSync(join(dir, 'report/spec.json'), JSON.stringify(ok('spec', { summary: '' })))
  const check = spawnSync(process.execPath, [SCRIPT, dir, '--check', 'spec'], { encoding: 'utf8' })
  assert.equal(check.status, 1)
  assert.match(check.stderr, /"summary" is required/)
})

test('sections: each type needs its fields, and stays short', () => {
  assert.deepEqual(validateSection({ type: 'flow', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }] }, 0), [])
  assert.match(validateSection({ type: 'flow', nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'z' }] }, 0)[0], /must join two node ids/)
  assert.match(validateSection({ type: 'sequence', participants: ['A'], messages: [{ from: 'A', to: 'B', text: 'x' }] }, 0)[0], /among the participants/)
  assert.match(validateSection({ type: 'text', body: 'x'.repeat(800) }, 0)[0], /show it instead/)
  assert.match(validateSection({ type: 'code', code: 'x' }, 0)[0], /"file"|\.file/)
  assert.match(validateSection({ type: 'chart' }, 0)[0], /type — one of/)
  assert.deepEqual(validateSection({ type: 'example', cases: [{ name: 'ok', steps: [{ label: 'go', input: 'GET /' }] }] }, 0), [])
})

test('the succinct limits bind the phase being written; an older, longer report stays valid', () => {
  const long = ok('spec', { summary: 'x'.repeat(900) })
  const dir = feature([long])
  assert.equal(readReports(dir).errors.length, 0)
  assert.match(readReports(dir, 'spec').errors[0], /"summary" is over 600/)
})

test('code is quoted: every line found in order, elisions allowed, real line numbers recorded', () => {
  const root = mkdtempSync(join(tmpdir(), 'repo-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/a.ts'), 'import x from "x"\n\nexport function f(a) {\n  const b = a + 1\n  log(b)\n  return b\n}\n')
  const r = { phase: 'execute', sections: [{ type: 'code', file: 'src/a.ts', line: 3, code: 'export function f(a) {\n  // …\n  return b\n}' }] }
  assert.deepEqual(checkSnippets(r, root), [])
  assert.deepEqual(r.sections[0].lines, [3, null, 6, 7])
  const made = { phase: 'execute', sections: [{ type: 'code', file: 'src/a.ts', code: 'return a * 2' }] }
  assert.match(checkSnippets(made, root)[0], /is not in src\/a\.ts.*copy the code verbatim/)
  const order = { phase: 'execute', sections: [{ type: 'code', file: 'src/a.ts', code: 'return b\nconst b = a + 1' }] }
  assert.equal(checkSnippets(order, root).length, 1)
  assert.match(checkSnippets({ phase: 'execute', sections: [{ type: 'code', file: 'src/nope.ts', code: 'x' }] }, root)[0], /does not exist/)
  assert.match(checkSnippets({ phase: 'execute', sections: [{ type: 'code', file: 'src/a.ts', line: 9, code: 'export function f(a) {' }] }, root)[0], /starts at line 3/)
})

test('CLI --phase: refuses an invented snippet, accepts and annotates a quoted one', () => {
  const root = mkdtempSync(join(tmpdir(), 'repo-'))
  mkdirSync(join(root, '.git'))
  writeFileSync(join(root, 'svc.ts'), 'export const LIMIT = 10\n')
  const dir = join(root, 'specs/012-x')
  mkdirSync(join(dir, 'report'), { recursive: true })
  writeFileSync(join(dir, 'README.md'), '# 012-x\n\n**Size:** S\n')
  const write = (code) => writeFileSync(join(dir, 'report/execute.json'), JSON.stringify(ok('execute', { sections: [{ type: 'code', file: 'svc.ts', line: 1, code }] })))
  write('export const LIMIT = 99')
  const bad = spawnSync(process.execPath, [SCRIPT, dir, '--phase', 'execute'], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /copy the code verbatim/)
  write('export const LIMIT = 10')
  const good = spawnSync(process.execPath, [SCRIPT, dir, '--phase', 'execute'], { encoding: 'utf8' })
  assert.equal(good.status, 0, good.stderr)
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'report/execute.json'), 'utf8')).sections[0].lines, [1])
})

test('the page embeds the client and builds nothing from markup', () => {
  const page = html(model(feature([ok('execute', { sections: [{ type: 'callout', body: '<b>x</b>' }] })])))
  assert.match(page, /function client\(\)/)
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(page))
  assert.ok(page.includes('\\u003cb>x\\u003c/b>'))
})

const MACHINE = { type: 'states', id: 'batch', initial: 'open', states: [{ id: 'open', label: 'Open' }, { id: 'sent', label: 'Sent' }], transitions: [{ from: 'open', to: 'sent', event: 'send', guard: 'before cutoff' }] }
const SIM = {
  type: 'simulator', id: 'fee', title: 'Fee', hit: 'first',
  inputs: [{ id: 'amount', label: 'Amount', type: 'number', default: 100 }, { id: 'plan', label: 'Plan', type: 'enum', options: ['free', 'pro'], default: 'free' }],
  rules: [{ id: 'pro', when: 'plan == "pro"', then: { fee: '0' } }, { id: 'base', when: 'true', then: { fee: 'round(amount * 0.01, 2)' } }],
  outputs: [{ id: 'fee', label: 'Fee', format: 'money' }],
  scenarios: [{ name: 'free', inputs: { amount: 250 }, expect: { fee: 2.5 } }],
}

test('states: an initial among the states, transitions joining them, at most 12 states', () => {
  assert.deepEqual(validateSection(MACHINE, 0), [])
  assert.match(validateSection({ ...MACHINE, initial: 'x' }, 0).join('\n'), /initial must be one of the state ids/)
  assert.match(validateSection({ ...MACHINE, transitions: [{ from: 'open', to: 'gone', event: 'e' }] }, 0).join('\n'), /must join two state ids/)
  const many = Array.from({ length: 13 }, (_, i) => ({ id: 's' + i, label: 'S' }))
  assert.match(validateSection({ ...MACHINE, states: many, initial: 's0', transitions: [{ from: 's0', to: 's1', event: 'e' }] }, 0).join('\n'), /more than 12 states/)
})

test('simulator: typed inputs, compiled expressions, scenarios held to their expectation', () => {
  assert.deepEqual(validateSection(SIM, 0), [])
  const bad = (patch) => validateSection({ ...SIM, ...patch }, 0).join('\n')
  assert.match(bad({ inputs: [{ id: 'min', label: 'x', type: 'number', default: 1 }] }), /reserved word/)
  assert.match(bad({ inputs: [{ id: 'a', label: 'x', type: 'enum', options: ['p'], default: 'q' }] }), /one of its options/)
  assert.match(bad({ rules: [{ id: 'r', when: 'amount >', then: { fee: '1' } }] }), /\(r\)\.when: unexpected the end/)
  assert.match(bad({ rules: [{ id: 'r', when: 'true', then: { cost: '1' } }] }), /then\.cost is not an output/)
  assert.match(bad({ scenarios: [{ name: 'pro', inputs: { plan: 'pro' }, expect: { fee: 1 } }] }), /"pro": expected fee = 1, the rules give 0 \(rule pro fired\)/)
})

test('the feature model joins the page, with requirement progress derived from the tickets', () => {
  const root = mkdtempSync(join(tmpdir(), 'repo-'))
  mkdirSync(join(root, '.git'))
  mkdirSync(join(root, '.kss'))
  const dir = join(root, 'specs/012-x')
  mkdirSync(join(dir, 'report'), { recursive: true })
  mkdirSync(join(dir, '05-tickets'))
  writeFileSync(join(dir, 'README.md'), '# 012-x\n\n**Size:** M\n')
  writeFileSync(join(dir, '05-tickets/01-a.md'), '# 01 · Contract\n\n**Layer:** domain · **Blocked by:** — \n\n## Requirements covered\n- **FR-01** · x\n- **FR-2** · y\n\n## Plan excerpt\nFR-09 is mentioned elsewhere\n')
  writeFileSync(join(dir, '05-tickets/02-b.md'), '# 02 · Endpoint\n\n**Layer:** api · **Blocked by:** 01\n\n## Requirements covered\n- **FR-02** · y\n')
  writeFileSync(join(dir, '06-execution.md'), '- `t` · **01** · spawn · T2\n- `t` · **01** · integrate · ok\n')
  writeFileSync(join(root, '.kss/current'), JSON.stringify({ feature: '012-x', tickets: { '02': { state: 'running' } } }))
  const f = {
    feature: '012-x', lang: 'en',
    requirements: [{ id: 'FR-01', text: 'a' }, { id: 'FR-02', text: 'b' }, { id: 'FR-03', text: 'c' }, { id: 'FR-04', text: 'd', status: 'dropped' }],
    states: [MACHINE], simulators: [SIM],
  }
  writeFileSync(join(dir, 'report/feature.json'), JSON.stringify(f))
  const m = model(dir)
  assert.deepEqual(m.errors, [])
  assert.deepEqual(m.reports, [])
  const p = m.living.progress
  assert.equal(p.requirements['FR-01'].status, 'done')
  assert.equal(p.requirements['FR-02'].status, 'building')
  assert.deepEqual(p.requirements['FR-02'].tickets, ['01', '02'])
  assert.equal(p.requirements['FR-03'].status, 'planned')
  assert.equal(p.requirements['FR-04'].status, 'dropped')
  assert.deepEqual([p.done, p.total], [1, 3])
  assert.deepEqual(m.living.ticketFlow.edges, [{ from: '01', to: '02' }])
  assert.deepEqual(m.living.ticketFlow.nodes.map((n) => n.tone), ['ok', 'accent'])
  // A plain rebuild includes it and embeds the expression language for the simulators.
  const r = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /\(0 phases, feature\)/)
  const page = readFileSync(join(dir, 'report/index.html'), 'utf8')
  assert.match(page, /var kssExpr = \(function exprLib\(\)/)
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|\beval\(|new Function/.test(page))
  // An invalid feature.json fails the rebuild with the reason.
  writeFileSync(join(dir, 'report/feature.json'), JSON.stringify({ ...f, rules: [{ id: 'R-01', title: 'T', text: 't', fr: ['FR-99'] }] }))
  const bad = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /feature\.json: rules\[R-01\]\.fr names FR-99/)
})
