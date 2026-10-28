import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { loadPrefs, savePrefs, withWindows } from './prefs.ts'

test('the projects open in windows are kept, once each, and survive a reload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kss-prefs-'))
  try {
    const file = join(dir, 'prefs.json')
    assert.deepEqual(loadPrefs(file).windows, [])
    savePrefs(file, withWindows(loadPrefs(file), ['/a', '/b', '/a']))
    assert.deepEqual(loadPrefs(file).windows, ['/a', '/b'])
    // A prefs file from before windows were remembered reads as none open.
    writeFileSync(file, JSON.stringify({ recent: ['/a'], harnessByPhase: {}, bypass: false }))
    assert.deepEqual(loadPrefs(file), { recent: ['/a'], harnessByPhase: {}, bypass: false, windows: [] })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
