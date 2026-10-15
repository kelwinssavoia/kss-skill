// Tests for report.mjs — the feature's explained report (DESIGN.md §25).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { html, model, validate } from './report.mjs'

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
