// The app's own preferences — the only thing it writes besides session worktrees (DESIGN.md §24.1).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { Harness, Prefs } from '../shared/types.ts'

const EMPTY: Prefs = { recent: [], harnessByPhase: {}, bypass: true }

export function loadPrefs(file: string): Prefs {
  try {
    const p = JSON.parse(readFileSync(file, 'utf8'))
    return { recent: Array.isArray(p.recent) ? p.recent.filter((x: unknown) => typeof x === 'string') : [], harnessByPhase: p.harnessByPhase && typeof p.harnessByPhase === 'object' ? p.harnessByPhase : {}, bypass: typeof p.bypass === 'boolean' ? p.bypass : EMPTY.bypass }
  } catch {
    return structuredClone(EMPTY)
  }
}

export function savePrefs(file: string, prefs: Prefs) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(prefs, null, 2))
}

export const withRecent = (p: Prefs, root: string): Prefs => ({ ...p, recent: [root, ...p.recent.filter(r => r !== root)].slice(0, 12) })

export const withHarness = (p: Prefs, root: string, phase: string, h: Harness): Prefs => ({
  ...p,
  harnessByPhase: { ...p.harnessByPhase, [root]: { ...p.harnessByPhase[root], [phase]: h } },
})

export const withBypass = (p: Prefs, bypass: boolean): Prefs => ({ ...p, bypass })
