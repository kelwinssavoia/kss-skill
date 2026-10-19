// Tests for feature.mjs — the living feature model and its only writer (DESIGN.md §25.1).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { apply, mergeFeature } from './feature.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'feature.mjs')
const NOW = '2026-10-19T12:00:00.000Z'

/** A repository with one source file and an empty feature folder. */
function repo() {
  const root = mkdtempSync(join(tmpdir(), 'feature-'))
  mkdirSync(join(root, '.git'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/cutoff.ts'), 'export function cutoff(at: string) {\n  const h = Number(at.slice(0, 2))\n  return h >= 15 ? "next" : "same"\n}\n')
  const dir = join(root, 'specs/012-batch-cutoff')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'README.md'), '# 012-batch-cutoff\n\n**State:** spec · **Size:** M\n')
  return { root, dir }
}
const read = (dir) => JSON.parse(readFileSync(join(dir, 'report/feature.json'), 'utf8'))

const SPEC = {
  change: 'Spec: 2 requirements, the cutoff rule and its simulator',
  lang: 'pt-BR',
  product: { title: 'Corte do lote', problem: 'Lotes depois das 15h atrasam.', outcome: 'O corte é claro.', actors: ['Operador'], inScope: ['corte'], outOfScope: ['feriados'] },
  stories: [{ id: 'US-1', text: 'Como operador, sei quando o lote sai.' }],
  requirements: [
    { id: 'FR-01', text: 'Lote até 15h sai no mesmo dia.', stories: ['US-1'], decisions: ['D-01'] },
    { id: 'FR-02', text: 'Lote depois das 15h sai no dia seguinte.', stories: ['US-1'] },
  ],
  decisions: [{ id: 'D-01', title: 'Hora de corte', decision: '15h', why: 'O banco fecha às 16h.', kind: 'business', status: 'decided' }],
  rules: [{ id: 'R-01', title: 'Corte às 15h', text: 'A partir das 15h o lote vai para o dia seguinte.', fr: ['FR-01', 'FR-02'] }],
  simulators: [{
    id: 'cutoff', title: 'Corte', hit: 'first',
    inputs: [{ id: 'at', label: 'Hora', type: 'time', default: '10:00' }],
    rules: [
      { id: 'late', when: 'hour(at) >= 15', then: { day: "'next'" }, rule: 'R-01', fr: ['FR-02'] },
      { id: 'early', when: 'true', then: { day: "'same'" }, rule: 'R-01', fr: ['FR-01'] },
    ],
    outputs: [{ id: 'day', label: 'Dia', format: 'text' }],
    scenarios: [{ name: '14:59', inputs: { at: '14:59' }, expect: { day: 'same' } }, { name: '15:00', inputs: { at: '15:00' }, expect: { day: 'next' } }],
  }],
  states: [{ id: 'batch', initial: 'open', states: [{ id: 'open', label: 'Aberto' }, { id: 'sent', label: 'Enviado' }], transitions: [{ from: 'open', to: 'sent', event: 'enviar', guard: 'antes do corte', fr: ['FR-01'] }] }],
}

test('a patch creates the model; the change line is required and logged with phase and time', () => {
  const { dir } = repo()
  assert.match(apply(dir, { requirements: [] }, 'spec', NOW).errors[0], /"change" is required/)
  assert.ok(!existsSync(join(dir, 'report/feature.json')))
  const r = apply(dir, SPEC, 'spec', NOW)
  assert.ok(r.ok, r.errors?.join('\n'))
  const f = read(dir)
  assert.equal(f.feature, '012-batch-cutoff')
  assert.equal(f.updatedBy, 'spec')
  assert.deepEqual(f.changes, [{ at: NOW, phase: 'spec', text: SPEC.change }])
  assert.equal(f.decisions[0].phase, 'spec')
  assert.match(readFileSync(join(dir, 'report/index.html'), 'utf8'), /"living":\{/)
})

test('arrays with ids are upserted by id, fields merge; arrays without ids are replaced', () => {
  const base = mergeFeature({ feature: 'x' }, SPEC, 'spec', NOW).feature
  const next = mergeFeature(base, {
    change: 'plan refines',
    requirements: [{ id: 'FR-02', status: 'building' }, { id: 'FR-03', text: 'Novo.' }],
    product: { actors: ['Operador', 'Banco'] },
  }, 'plan', NOW).feature
  assert.deepEqual(next.requirements.map((r) => r.id), ['FR-01', 'FR-02', 'FR-03'])
  assert.equal(next.requirements[1].text, SPEC.requirements[1].text)
  assert.equal(next.requirements[1].status, 'building')
  assert.deepEqual(next.product.actors, ['Operador', 'Banco'])
  assert.equal(next.product.title, 'Corte do lote')
  // Nested keyed arrays upsert too: one simulator rule changes, the other stays.
  const sim = mergeFeature(base, { change: 'x', simulators: [{ id: 'cutoff', rules: [{ id: 'late', when: 'hour(at) >= 16' }] }] }, 'plan', NOW).feature.simulators[0]
  assert.equal(sim.rules.length, 2)
  assert.equal(sim.rules[0].when, 'hour(at) >= 16')
  assert.deepEqual(sim.rules[0].then, { day: "'next'" })
})

test('a decision whose text changes keeps the previous one in history; the model never writes it', () => {
  const base = mergeFeature({ feature: 'x' }, SPEC, 'grill', '2026-10-18T00:00:00Z').feature
  const same = mergeFeature(base, { change: 'x', decisions: [{ id: 'D-01', status: 'accepted' }] }, 'plan', NOW)
  assert.equal(same.feature.decisions[0].history, undefined)
  const r = mergeFeature(base, { change: 'cutoff moves', decisions: [{ id: 'D-01', decision: '16h', why: 'Banco estendeu.', history: [{ phase: 'fake', decision: 'forged' }] }] }, 'plan', NOW)
  const d = r.feature.decisions[0]
  assert.equal(d.decision, '16h')
  assert.equal(d.phase, 'plan')
  assert.deepEqual(d.history, [{ at: '2026-10-18T00:00:00Z', phase: 'grill', decision: '15h', why: 'O banco fecha às 16h.' }])
  assert.deepEqual(r.changed, ['D-01'])
  assert.deepEqual(r.feature.changes.at(-1).changed, ['D-01'])
})

test('removed: a requirement is dropped, anything else removed, and the change log says so', () => {
  const base = mergeFeature({ feature: 'x' }, SPEC, 'spec', NOW).feature
  const r = mergeFeature(base, { change: 'scope cut', requirements: [{ id: 'FR-02', removed: true }], stories: [{ id: 'US-1', removed: true }] }, 'plan', NOW)
  assert.equal(r.feature.requirements.find((x) => x.id === 'FR-02').status, 'dropped')
  assert.equal(r.feature.stories.length, 0)
  assert.deepEqual(r.feature.changes.at(-1).removed.sort(), ['FR-02', 'US-1'])
  // Remove and re-add in one patch replaces the item whole.
  const swap = mergeFeature(base, { change: 'x', stories: [{ id: 'US-1', removed: true }, { id: 'US-1', text: 'Outra.' }] }, 'plan', NOW)
  assert.deepEqual(swap.feature.stories, [{ id: 'US-1', text: 'Outra.' }])
})

test('validation refuses bad shapes and dangling links, leaving the file untouched', () => {
  const { dir } = repo()
  assert.ok(apply(dir, SPEC, 'spec', NOW).ok)
  const before = readFileSync(join(dir, 'report/feature.json'), 'utf8')
  const bad = (patch) => apply(dir, { change: 'x', ...patch }, 'plan', NOW).errors?.join('\n') ?? ''
  assert.match(bad({ requirements: [{ id: 'FR-09', text: 'x', status: 'soon' }] }), /status — one of planned/)
  assert.match(bad({ rules: [{ id: 'R-02', title: 'T', text: 'x', fr: ['FR-77'] }] }), /rules\[R-02\]\.fr names FR-77/)
  assert.match(bad({ decisions: [{ id: 'D-02', title: 'T', decision: 'x'.repeat(500) }] }), /decision is over 400/)
  assert.match(bad({ states: [{ id: 'batch', initial: 'gone' }] }), /initial must be one of the state ids/)
  assert.match(bad({ simulators: [{ id: 'cutoff', rules: [{ id: 'late', when: 'hour(at) >= cutoff' }] }] }), /late\)\.when: unknown name 'cutoff'/)
  assert.match(bad({ wat: 1 }), /unknown key "wat"/)
  assert.match(apply(dir, { change: 'x' }, 'lunch', NOW).errors[0], /unknown phase/)
  assert.equal(readFileSync(join(dir, 'report/feature.json'), 'utf8'), before)
})

test('a scenario whose expectation the rules do not meet is refused with the rule and the mismatch', () => {
  const { dir } = repo()
  const patch = structuredClone(SPEC)
  patch.simulators[0].rules[0].when = 'hour(at) > 15'
  const errs = apply(dir, patch, 'spec', NOW).errors.join('\n')
  assert.match(errs, /scenarios\[1\] "15:00": expected day = "next", the rules give "same" \(rule early \(R-01\) fired\)/)
})

test('rule code is quoted from the repository; an invented line is refused', () => {
  const { dir } = repo()
  assert.ok(apply(dir, SPEC, 'spec', NOW).ok)
  const made = apply(dir, { change: 'execute', rules: [{ id: 'R-01', code: { file: 'src/cutoff.ts', line: 1, code: 'return h > 15' } }] }, 'execute', NOW)
  assert.match(made.errors[0], /rules\[R-01\]\.code — "return h > 15" is not in src\/cutoff\.ts/)
  const ok = apply(dir, {
    change: 'execute: the rule lives in cutoff.ts',
    rules: [{ id: 'R-01', code: { file: 'src/cutoff.ts', line: 1, code: 'export function cutoff(at: string) {\n  // …\n  return h >= 15 ? "next" : "same"\n}', highlight: [3] } }],
    code: [{ id: 'cutoff', file: 'src/cutoff.ts', line: 2, code: '  const h = Number(at.slice(0, 2))' }],
  }, 'execute', NOW)
  assert.ok(ok.ok, ok.errors?.join('\n'))
  const f = read(dir)
  assert.deepEqual(f.rules[0].code.lines, [1, null, 3, 4])
  assert.deepEqual(f.code[0].lines, [2])
  assert.equal(f.rules[0].title, 'Corte às 15h')
})

test('CLI: the patch on stdin or --patch; prints the counts, or the problem and exit 1', () => {
  const { dir, root } = repo()
  const good = spawnSync(process.execPath, [SCRIPT, dir, '--phase', 'spec'], { encoding: 'utf8', input: JSON.stringify(SPEC) })
  assert.equal(good.status, 0, good.stderr)
  assert.match(good.stdout, /^feature: .*report\/feature\.json \(2 requirements, 1 rules, 1 decisions\)/)
  writeFileSync(join(root, 'p.json'), JSON.stringify({ decisions: [] }))
  const bad = spawnSync(process.execPath, [SCRIPT, dir, '--phase', 'plan', '--patch', join(root, 'p.json')], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /^feature: "change" is required/)
  const junk = spawnSync(process.execPath, [SCRIPT, dir, '--phase', 'plan'], { encoding: 'utf8', input: '{' })
  assert.match(junk.stderr, /feature: the patch is not valid JSON/)
})
