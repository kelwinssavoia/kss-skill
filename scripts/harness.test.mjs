// Tests for harness.mjs — which harness is running this phase (DESIGN.md §19).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { detect, record, fromEnv, fromAncestry, adapterPath, HARNESSES } from './harness.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'harness.mjs')

/** A project with a `.kss/current` naming a feature, which is what `record` annotates. */
function project(current = { feature: '007-thing', phase: 'execute' }) {
  const dir = mkdtempSync(join(tmpdir(), 'kss-harness-'))
  mkdirSync(join(dir, '.kss'), { recursive: true })
  if (current) writeFileSync(join(dir, '.kss', 'current'), JSON.stringify(current, null, 2) + '\n')
  return dir
}

const read = (dir) => JSON.parse(readFileSync(join(dir, '.kss', 'current'), 'utf8'))

test('adapterPath names one file per harness, nothing for unknown', () => {
  assert.equal(adapterPath('codex'), '.kss/references/harness-codex.md')
  assert.equal(adapterPath('claude-code'), '.kss/references/harness-claude-code.md')
  assert.equal(adapterPath('unknown'), '')
  assert.equal(adapterPath(undefined), '')
})

test('environment markers identify each harness', () => {
  assert.equal(fromEnv({ CLAUDECODE: '1' }), 'claude-code')
  assert.equal(fromEnv({ CLAUDE_CODE_ENTRYPOINT: 'cli' }), 'claude-code')
  assert.equal(fromEnv({ CODEX_HOME: '/Users/x/.codex' }), 'codex')
  assert.equal(fromEnv({ CODEX_SANDBOX: 'seatbelt' }), 'codex')
  assert.equal(fromEnv({}), null)
  assert.equal(fromEnv({ CODEX_HOME: '' }), null, 'an empty value is not a marker')
})

test('the ancestry walk stops at init, at a cycle and at a missing process', () => {
  const chain = { 100: { ppid: 50, comm: 'node' }, 50: { ppid: 1, comm: 'codex' } }
  assert.equal(fromAncestry(100, 8, (pid) => chain[pid] || null), 'codex')

  const claude = { 100: { ppid: 50, comm: 'node' }, 50: { ppid: 1, comm: 'claude' } }
  assert.equal(fromAncestry(100, 8, (pid) => claude[pid] || null), 'claude-code')

  assert.equal(fromAncestry(100, 8, () => null), null, 'no ps output')
  assert.equal(fromAncestry(1, 8, () => assert.fail('must not query init')), null)

  const cycle = { 100: { ppid: 101, comm: 'sh' }, 101: { ppid: 100, comm: 'sh' } }
  assert.equal(fromAncestry(100, 8, (pid) => cycle[pid] || null), null, 'a cycle terminates')

  const deep = { 100: { ppid: 101, comm: 'sh' }, 101: { ppid: 102, comm: 'sh' }, 102: { ppid: 103, comm: 'codex' } }
  assert.equal(fromAncestry(100, 2, (pid) => deep[pid] || null), null, 'depth is respected')
})

test('detection order: KSS_HARNESS, environment, ancestry, .kss/current, unknown', () => {
  const dir = project({ feature: '007-thing', phase: 'execute', harness: 'codex' })
  try {
    const noProc = { cwd: dir, ancestry: false }
    assert.deepEqual(detect({ ...noProc, env: { KSS_HARNESS: 'codex', CLAUDECODE: '1' } }), {
      name: 'codex',
      source: 'KSS_HARNESS',
    })
    assert.equal(detect({ ...noProc, env: { KSS_HARNESS: 'nonsense', CLAUDECODE: '1' } }).name, 'claude-code')
    assert.equal(detect({ ...noProc, env: { CLAUDECODE: '1' } }).source, 'environment')
    assert.deepEqual(detect({ ...noProc, env: {} }), { name: 'codex', source: '.kss/current' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  const blank = project({ feature: '007-thing', phase: 'execute' })
  try {
    assert.deepEqual(detect({ cwd: blank, ancestry: false, env: {} }), { name: 'unknown', source: 'undetermined' })
  } finally {
    rmSync(blank, { recursive: true, force: true })
  }
})

test('record annotates an active run and never creates .kss/current', () => {
  const dir = project()
  try {
    assert.equal(record('codex', dir), true)
    assert.equal(read(dir).harness, 'codex')
    assert.equal(read(dir).feature, '007-thing', 'the rest of the state survives')
    assert.equal(record('codex', dir), true, 'recording the same value again is a no-op')
    assert.equal(record('nonsense', dir), false)
    assert.equal(read(dir).harness, 'codex')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  const empty = mkdtempSync(join(tmpdir(), 'kss-harness-'))
  try {
    assert.equal(record('codex', empty), false, 'no run: nothing to annotate')
    assert.equal(spawnSync('ls', [join(empty, '.kss')], { encoding: 'utf8' }).status !== 0, true)
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})

test('CLI prints the name and the adapter, and --set records without detecting', () => {
  const dir = project()
  try {
    const run = (env, ...a) =>
      spawnSync(process.execPath, [SCRIPT, ...a], { encoding: 'utf8', cwd: dir, env: { ...process.env, ...env } })

    const missing = run({ KSS_HARNESS: 'codex' })
    assert.deepEqual(missing.stdout.trim().split('\n'), [
      'codex',
      '.kss/references/harness-codex.md (missing — re-run kss-init)',
    ])

    mkdirSync(join(dir, '.kss', 'references'), { recursive: true })
    for (const h of HARNESSES) writeFileSync(join(dir, '.kss', 'references', `harness-${h}.md`), '# adapter\n')

    const forced = run({ KSS_HARNESS: 'codex' })
    assert.deepEqual(forced.stdout.trim().split('\n'), ['codex', '.kss/references/harness-codex.md'])
    assert.equal(read(dir).harness, 'codex')

    assert.equal(run({ KSS_HARNESS: 'claude-code' }, '--name').stdout.trim(), 'claude-code')
    assert.equal(run({ KSS_HARNESS: 'codex' }, '--adapter').stdout.trim(), '.kss/references/harness-codex.md')

    const set = run({}, '--set', 'claude-code')
    assert.equal(set.status, 0)
    assert.equal(read(dir).harness, 'claude-code')
    assert.equal(run({}, '--set', 'nonsense').status, 1)

    run({ KSS_HARNESS: 'codex' }, '--no-write')
    assert.equal(read(dir).harness, 'claude-code', '--no-write touches nothing')

    assert.deepEqual(HARNESSES, ['claude-code', 'codex'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
