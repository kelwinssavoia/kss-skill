import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { launchOf } from '../shared/commands.ts'
import { pickTarget } from './live.ts'
import { envOf, holder, imageData, latestRuns, parseScenarios, parseSteps, qaInfo, runIds } from './qa.ts'

test('qa terminals run qa.mjs; down and status name no feature', () => {
  const l = (step: any, extra = {}) => launchOf({ cwd: '/s', kind: 'qa', qa: { step, feature: '012-x', ...extra } }, '/bin/zsh')
  assert.deepEqual(l('run', { only: 'S-02' }), { file: 'node', args: ['.kss/scripts/qa.mjs', 'run', '--feature', '012-x', '--only', 'S-02'], title: 'qa run S-02' })
  assert.deepEqual(l('plan', { force: true }).args, ['.kss/scripts/qa.mjs', 'plan', '--feature', '012-x', '--force'])
  assert.deepEqual(l('down').args, ['.kss/scripts/qa.mjs', 'down'])
})

test('plan scenarios and recorded steps', () => {
  assert.deepEqual(parseScenarios({ scenarios: [{ id: 'S-01', title: 'Export', persona: 'ops', app: 'web', covers: ['FR-01'], steps: ['open'], expected: ['a file'] }, { nope: 1 }] }), [
    { id: 'S-01', title: 'Export', persona: 'ops', app: 'web', covers: ['FR-01'], steps: ['open'], expected: ['a file'] },
  ])
  const steps = parseSteps('{"i":1,"title":"open","expected":"list","observed":"list","status":"pass","screenshot":"01-open.jpg"}\nbad\n{"i":2,"title":"x","status":"fail","screenshot":null}\n', '/run/S-01')
  assert.deepEqual(steps.map(s => [s.i, s.status, s.screenshot]), [[1, 'pass', '/run/S-01/01-open.jpg'], [2, 'fail', null]])
})

test('the latest run per scenario, its verdicts, the environment and its holder', async () => {
  const base = mkdtempSync(join(tmpdir(), 'kss-qa-'))
  const a = join(base, 'a')
  const b = join(base, 'b')
  const qa = join(a, 'docs/features/012-x/qa')
  const run = (id: string, scenarios: string[]) => {
    mkdirSync(join(qa, 'runs', id), { recursive: true })
    writeFileSync(join(qa, 'runs', id, 'run.json'), JSON.stringify({ scenarios }))
  }
  run('20261013-1000', ['S-01', 'S-02'])
  run('20261013-1100', ['S-02'])
  mkdirSync(join(qa, 'runs/20261013-1100/S-02'), { recursive: true })
  writeFileSync(join(qa, 'runs/20261013-1100/S-02/result.json'), JSON.stringify({ status: 'fail', summary: 'no file', issues: [{ kind: 'defect', title: 'empty CSV' }] }))
  writeFileSync(join(qa, 'runs/20261013-1100/S-02/judge.json'), JSON.stringify({ final: 'fail', note: 'agree' }))
  writeFileSync(join(qa, 'runs/20261013-1100/S-02/01-x.jpg'), 'jpg')
  mkdirSync(join(qa, 'runs/broken'), { recursive: true })
  writeFileSync(join(qa, 'plan.json'), JSON.stringify({ scenarios: [{ id: 'S-01', title: 'a' }], not_covered: [{ fr: 'FR-09', reason: 'batch job' }] }))
  writeFileSync(join(qa, 'result.json'), JSON.stringify({ verdict: 'REJECTED' }))

  assert.deepEqual(runIds(qa), ['20261013-1000', '20261013-1100'])
  const latest = latestRuns(qa, runIds(qa))
  assert.equal(latest['S-01']!.runId, '20261013-1000')
  assert.equal(latest['S-01']!.status, null)
  assert.deepEqual([latest['S-02']!.runId, latest['S-02']!.status, latest['S-02']!.final, latest['S-02']!.issues[0]!.title], ['20261013-1100', 'fail', 'fail', 'empty CSV'])

  assert.equal(envOf(a).state, 'down')
  const sleeper = spawn('sleep', ['30'])
  try {
    mkdirSync(join(b, '.kss/qa/.runtime'), { recursive: true })
    writeFileSync(join(b, '.kss/qa/.runtime/state.json'), JSON.stringify({ feature: '013-y', readyAt: 'now', pids: { web: sleeper.pid, api: 999999 } }))
    writeFileSync(join(b, '.kss/qa/.runtime/live.json'), JSON.stringify({ runId: 'r', scenario: 'S-01', title: 't', cdp: 'http://127.0.0.1:1' }))
    assert.deepEqual(envOf(b).services, [{ name: 'web', alive: true }, { name: 'api', alive: false }])
    assert.equal(envOf(b).state, 'up')
    assert.equal(holder(a, [a, b]), b)
    assert.equal(holder(b, [a, b]), null)

    const info = qaInfo(a, join(a, 'docs/features/012-x'), '012-x', [a, b])
    assert.equal(info.heldBy, b)
    assert.equal(info.verdict, 'REJECTED')
    assert.deepEqual(info.plan?.notCovered, [{ fr: 'FR-09', reason: 'batch job' }])
    assert.equal(info.hasConfig, false)
    assert.equal(qaInfo(b, null, null, [a, b]).live?.scenario, 'S-01')
  } finally {
    sleeper.kill()
  }

  assert.match(imageData(join(qa, 'runs/20261013-1100/S-02/01-x.jpg'), [a])!, /^data:image\/jpeg;base64,/)
  assert.equal(imageData(join(qa, 'runs/20261013-1100/S-02/01-x.jpg'), [b]), null)
  assert.equal(imageData(join(qa, 'plan.json'), [a]), null)
})

test('the live view follows the real page, not about:blank or devtools', () => {
  const t = (type: string, url: string) => ({ type, url, webSocketDebuggerUrl: `ws://${url}` })
  assert.equal(pickTarget([t('page', 'about:blank'), t('service_worker', 'http://a'), t('page', 'http://app/login')])?.url, 'http://app/login')
  assert.equal(pickTarget([t('page', 'about:blank')])?.url, 'about:blank')
  assert.equal(pickTarget([t('page', 'devtools://x')]), null)
})
