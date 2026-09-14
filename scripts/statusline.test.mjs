// Regression tests for the statusline fallback (DESIGN.md §18.1). Run: node --test scripts/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync, execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isSelfReferencing, resolveBackupCommand } from './statusline.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'statusline.mjs')
const PAYLOAD = JSON.stringify({ model: { display_name: 'Fable' }, context_window: { used_percentage: 42 } })

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'kss-sl-'))
  const home = join(root, 'home')
  const cwd = join(root, 'project')
  mkdirSync(join(home, '.kss'), { recursive: true })
  mkdirSync(join(cwd, '.kss'), { recursive: true })
  return { root, home, cwd, done: () => rmSync(root, { recursive: true, force: true }) }
}

function backup(dir, command) {
  writeFileSync(join(dir, '.kss', 'statusline.backup.json'), JSON.stringify({ type: 'command', command }))
}

/** Run the statusline as Claude Code would: payload on stdin, HOME pointed at the sandbox. */
function run(cwd, home, extraEnv = {}) {
  const env = { ...process.env, HOME: home, ...extraEnv }
  if (!('KSS_STATUSLINE_CHILD' in extraEnv)) delete env.KSS_STATUSLINE_CHILD
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd,
    input: JSON.stringify({ ...JSON.parse(PAYLOAD), cwd }),
    encoding: 'utf8',
    timeout: 10000,
    env,
  })
  return { out: (r.stdout || '').trim(), ms: Date.now() - t0, status: r.status }
}

function countProcs(marker) {
  try {
    return execSync(`pgrep -f ${JSON.stringify(marker)} | wc -l`, { encoding: 'utf8' }).trim() * 1
  } catch {
    return 0
  }
}

test('isSelfReferencing flags every way of naming the KSS statusline', () => {
  assert.equal(isSelfReferencing('node /x/kss/0.1.0/scripts/statusline.mjs'), true)
  assert.equal(isSelfReferencing('node .kss/scripts/statusline.mjs'), true)
  assert.equal(isSelfReferencing('kss-statusline'), true)
  assert.equal(isSelfReferencing('node ~/bin/my-status.js'), false)
  assert.equal(isSelfReferencing(''), false)
  assert.equal(isSelfReferencing(null), false)
})

test('resolveBackupCommand prefers ~/.kss, falls back to the project, skips self-references', () => {
  const s = sandbox()
  try {
    assert.equal(resolveBackupCommand(s.cwd, s.home), null)
    backup(s.cwd, 'echo project')
    assert.equal(resolveBackupCommand(s.cwd, s.home), 'echo project')
    backup(s.home, 'echo home')
    assert.equal(resolveBackupCommand(s.cwd, s.home), 'echo home')
    backup(s.home, 'node /p/kss/0.1.0/scripts/statusline.mjs')
    assert.equal(resolveBackupCommand(s.cwd, s.home), 'echo project')
    backup(s.cwd, 'node .kss/scripts/statusline.mjs')
    assert.equal(resolveBackupCommand(s.cwd, s.home), null)
  } finally {
    s.done()
  }
})

test('self-referencing project backup (the 2026-09-14 fork bomb) prints the plain line, once, fast', () => {
  const s = sandbox()
  try {
    backup(s.cwd, `node ${SCRIPT}`)
    const before = countProcs(SCRIPT)
    const r = run(s.cwd, s.home)
    assert.equal(r.out, 'Fable · 42%')
    assert.ok(r.ms < 1500, `took ${r.ms}ms`)
    assert.equal(countProcs(SCRIPT), before, 'no statusline process left running')
  } finally {
    s.done()
  }
})

test('self-referencing user-level backup is ignored too', () => {
  const s = sandbox()
  try {
    backup(s.home, `node ${SCRIPT}`)
    const r = run(s.cwd, s.home)
    assert.equal(r.out, 'Fable · 42%')
    assert.ok(r.ms < 1500, `took ${r.ms}ms`)
  } finally {
    s.done()
  }
})

test('a genuine backup is honoured and receives the payload on stdin', () => {
  const s = sandbox()
  try {
    backup(s.home, `sh -c 'read line; echo "prev:$(echo "$line" | wc -c | tr -d " ")"'`)
    const r = run(s.cwd, s.home)
    assert.match(r.out, /^prev:\d+$/)
  } finally {
    s.done()
  }
})

test('a closed run (phase done) hands back to the previous statusline', () => {
  const s = sandbox()
  try {
    writeFileSync(join(s.cwd, '.kss', 'current'), JSON.stringify({ feature: '001-x', phase: 'done' }))
    backup(s.home, 'echo previous-statusline')
    assert.equal(run(s.cwd, s.home).out, 'previous-statusline')
    writeFileSync(join(s.cwd, '.kss', 'current'), JSON.stringify({ feature: '001-x', phase: 'plan' }))
    assert.equal(run(s.cwd, s.home).out, 'kss 001 · plan')
  } finally {
    s.done()
  }
})

test('with KSS_STATUSLINE_CHILD set the fallback is never run', () => {
  const s = sandbox()
  try {
    backup(s.home, 'echo should-not-run')
    const r = run(s.cwd, s.home, { KSS_STATUSLINE_CHILD: '1' })
    assert.equal(r.out, 'Fable · 42%')
  } finally {
    s.done()
  }
})

test('a hanging backup is killed with its whole process group within the timeout', () => {
  const s = sandbox()
  const marker = `statusline-hang-marker-${process.pid}`
  try {
    // the backup forks a grandchild; spawnSync's timeout would have left it alive
    const hang = `sh -c "sleep 30; : ${marker}"`
    backup(s.home, `${hang} & ${hang}`)
    const r = run(s.cwd, s.home)
    assert.equal(r.out, 'Fable · 42%')
    assert.ok(r.ms >= 1900, `fallback returned before the timeout (${r.ms}ms) — the backup did not hang`)
    assert.ok(r.ms < 4000, `took ${r.ms}ms`)
    assert.equal(countProcs(marker), 0, 'grandchild was killed with the group')
  } finally {
    execSync(`pkill -9 -f ${JSON.stringify(marker)} || true`)
    s.done()
  }
})
