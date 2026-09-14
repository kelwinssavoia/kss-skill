// Tests for next.mjs — the track table (DESIGN.md §3.9).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { nextPhase, nextLine, check, TRACKS, ORDER } from './next.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'next.mjs')

test('every track is a subsequence of the canonical order', () => {
  for (const [size, track] of Object.entries(TRACKS)) {
    const idx = track.map((p) => ORDER.indexOf(p))
    assert.ok(idx.every((i) => i >= 0), size)
    assert.deepEqual(idx, [...idx].sort((a, b) => a - b), `${size} is ordered`)
  }
})

test('S: clarify → tickets → execute, then only optional phases', () => {
  assert.equal(nextPhase('S', 'clarify'), 'tickets')
  assert.equal(nextPhase('S', 'tickets'), 'execute')
  assert.equal(nextPhase('S', 'execute'), null)
  assert.equal(nextLine('S', 'execute', '001-x'), 'Next: nothing on track S — /kss-review 001-x or /kss-docs-tech 001-x or /kss-docs-product 001-x are optional.')
  // investigate ran anyway on an S: resume the track after it
  assert.equal(nextPhase('S', 'investigate'), 'tickets')
  assert.equal(check('S', 'investigate'), 'off-track')
  assert.equal(check('S', 'review'), 'optional')
})

test('M: no grill — investigate goes straight to spec unless the user escalates', () => {
  assert.equal(nextPhase('M', 'clarify'), 'investigate')
  assert.equal(nextPhase('M', 'investigate'), 'spec')
  assert.equal(nextPhase('M', 'investigate', { escalate: 'grill' }), 'grill')
  assert.equal(nextPhase('M', 'grill'), 'spec')
  assert.equal(nextPhase('M', 'review-decisions'), 'spec')
  assert.equal(nextPhase('M', 'execute'), 'review')
  assert.equal(nextLine('M', 'review', '001-x'), 'Next: nothing on track M — /kss-docs-tech 001-x or /kss-docs-product 001-x are optional.')
  assert.equal(check('M', 'grill'), 'optional')
  assert.equal(check('M', 'spec'), 'on-track')
})

test('L: grill always, review-decisions offered first when there are auto decisions', () => {
  assert.equal(nextPhase('L', 'investigate'), 'grill')
  assert.equal(nextLine('L', 'investigate', '001-x', { auto: 3 }), 'Next: /kss-grill 001-x (optional first: /kss-review-decisions 001-x)')
  assert.equal(nextLine('L', 'investigate', '001-x', { auto: 0 }), 'Next: /kss-grill 001-x')
  assert.equal(nextPhase('L', 'review-decisions'), 'grill')
  assert.equal(nextPhase('L', 'review-decisions', { state: 'spec' }), 'spec', 're-run after the spec revises the spec')
  assert.equal(nextPhase('L', 'review'), 'docs-tech')
  assert.equal(nextLine('L', 'docs-product', '001-x'), 'Next: feature 001-x is documented — nothing left to run.')
})

test('CLI reads size, state and id from the README header', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kss-next-'))
  try {
    writeFileSync(join(dir, 'README.md'), '# 007-thing\n\n**State:** investigate · **Size:** M · **Track:** clarify → …\n')
    const run = (...a) => spawnSync(process.execPath, [SCRIPT, dir, ...a], { encoding: 'utf8' })
    assert.equal(run('--after', 'investigate').stdout.trim(), 'Next: /kss-spec 007-thing')
    assert.equal(run('--after', 'investigate', '--escalate', 'grill').stdout.trim(), 'Next: /kss-grill 007-thing')
    assert.equal(run('--check', 'grill').stdout.trim(), 'optional')
    assert.equal(run('--check', 'docs-tech').stdout.trim(), 'optional')
    const bad = run('--after', 'nope')
    assert.equal(bad.status, 1)
    writeFileSync(join(dir, 'README.md'), '# 007-thing\n\nno header\n')
    assert.equal(run('--after', 'spec').status, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
