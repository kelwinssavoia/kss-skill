import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { reportOf, reportUrl, servable } from './report.ts'

test("a session's report: the page, its phases, the newest last", () => {
  const f = join(mkdtempSync(join(tmpdir(), 'rep-')), 'specs/012-x')
  assert.equal(reportOf(f), null)
  mkdirSync(join(f, 'report'), { recursive: true })
  writeFileSync(join(f, 'report/clarify.json'), '{}')
  writeFileSync(join(f, 'report/investigate.json'), '{}')
  utimesSync(join(f, 'report/clarify.json'), 1000, 1000)
  assert.equal(reportOf(f), null, 'no page until report.mjs built it')
  writeFileSync(join(f, 'report/index.html'), '<!doctype html>')
  const r = reportOf(f)!
  assert.deepEqual([r.phases, r.latest, r.file], [['clarify', 'investigate'], 'investigate', join(f, 'report/index.html')])
})

test('only a session’s own report page is served', () => {
  const sessions = ['/w/repo', '/w/repo.kss-sessions/a']
  assert.equal(servable('/w/repo.kss-sessions/a/specs/012-x/report/index.html', sessions), true)
  assert.equal(servable('/w/repo/specs/012-x/report/../../../../etc/passwd', sessions), false)
  assert.equal(servable('/w/repo/specs/012-x/03-spec.md', sessions), false)
  assert.equal(servable('/elsewhere/report/index.html', sessions), false)
  assert.equal(servable('/w/repo/../other/report/index.html', sessions), false)
})

test('the framed URL carries the file, a version that busts the cache, and the phase', () => {
  assert.equal(reportUrl('/w/r/report/index.html', 5, 'spec'), 'kss-report://local/?f=%2Fw%2Fr%2Freport%2Findex.html&v=5#phase-spec')
})
