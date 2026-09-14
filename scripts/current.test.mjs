// Tests for current.mjs end/clear and the isActive() rule the hooks share (DESIGN.md §3.8).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isActive } from '../hooks/kss-lib.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'current.mjs')

function sandbox() {
  const cwd = mkdtempSync(join(tmpdir(), 'kss-current-'))
  mkdirSync(join(cwd, '.kss'))
  return { cwd, done: () => rmSync(cwd, { recursive: true, force: true }) }
}

function current(cwd, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--cwd', cwd], { encoding: 'utf8' })
  return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() }
}

test('isActive: a named feature in any phase but done', () => {
  assert.equal(isActive(null), false)
  assert.equal(isActive({}), false)
  assert.equal(isActive({ phase: 'plan' }), false)
  assert.equal(isActive({ feature: '001-x', phase: 'plan' }), true)
  assert.equal(isActive({ feature: '001-x' }), true)
  assert.equal(isActive({ feature: '001-x', phase: 'done' }), false)
})

test('end closes the run: phase done, live keys dropped, feature kept', () => {
  const s = sandbox()
  try {
    current(s.cwd, 'set', JSON.stringify({
      feature: '001-x', phase: 'review', ticket: '04',
      tickets: { '04': { state: 'integrated' } }, execution: { total: 1 },
      review: { round: 2 }, explorers: { running: 1, returned: 0 }, session: { turns: 9 },
    }))
    const r = current(s.cwd, 'end')
    assert.equal(r.status, 0)
    const c = JSON.parse(readFileSync(join(s.cwd, '.kss', 'current'), 'utf8'))
    assert.equal(c.feature, '001-x')
    assert.equal(c.phase, 'done')
    for (const k of ['ticket', 'tickets', 'execution', 'review', 'explorers']) assert.equal(k in c, false, k)
    assert.deepEqual(c.session, { turns: 9 }, 'the Stop hook owns session; end leaves it alone')
    assert.equal(isActive(c), false)
  } finally {
    s.done()
  }
})

test('end refuses when no run is active', () => {
  const s = sandbox()
  try {
    const r = current(s.cwd, 'end')
    assert.equal(r.status, 1)
    assert.match(r.err, /no active run/)
  } finally {
    s.done()
  }
})

test('a later skill re-opens a closed run by setting phase', () => {
  const s = sandbox()
  try {
    current(s.cwd, 'set', '{"feature":"001-x","phase":"review"}')
    current(s.cwd, 'end')
    current(s.cwd, 'set', '{"phase":"docs-tech"}')
    assert.equal(isActive(JSON.parse(current(s.cwd, 'get').out)), true)
  } finally {
    s.done()
  }
})

test('clear removes the file and is idempotent', () => {
  const s = sandbox()
  try {
    current(s.cwd, 'set', '{"feature":"001-x","phase":"plan"}')
    assert.equal(current(s.cwd, 'clear').status, 0)
    assert.equal(existsSync(join(s.cwd, '.kss', 'current')), false)
    assert.equal(current(s.cwd, 'clear').status, 0)
    assert.equal(current(s.cwd, 'get').out, '{}')
  } finally {
    s.done()
  }
})
