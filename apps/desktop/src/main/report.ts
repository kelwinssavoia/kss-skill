// A session's explained report (DESIGN.md §25): report/index.html, built by report.mjs from one
// <phase>.json per finished phase. The app only finds it and shows it; it never writes it.

import { readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import type { SessionReport } from '../shared/types.ts'

export const SCHEME = 'kss-report'

export function reportOf(featureDir: string | null): SessionReport | null {
  if (!featureDir) return null
  const dir = join(featureDir, 'report')
  let page: number
  try {
    page = statSync(join(dir, 'index.html')).mtimeMs
  } catch {
    return null
  }
  const phases: { phase: string; at: number }[] = []
  try {
    for (const n of readdirSync(dir)) {
      if (!n.endsWith('.json')) continue
      try {
        phases.push({ phase: n.slice(0, -5), at: statSync(join(dir, n)).mtimeMs })
      } catch {
        /* removed while listing */
      }
    }
  } catch {
    /* unreadable: the page alone */
  }
  phases.sort((a, b) => a.at - b.at)
  return { file: join(dir, 'index.html'), phases: phases.map(p => p.phase), latest: phases[phases.length - 1]?.phase ?? null, updatedAt: Math.round(page) }
}

/** The URL the renderer frames: the page itself decides what to run; the hash picks the phase. */
export const reportUrl = (file: string, version: number, phase: string | null) =>
  `${SCHEME}://local/?f=${encodeURIComponent(file)}&v=${version}${phase ? `#phase-${encodeURIComponent(phase)}` : ''}`

/** Only a session's own `…/report/index.html` is ever served. */
export function servable(file: string, sessions: string[]): boolean {
  const abs = resolve(file)
  if (!/[/\\]report[/\\]index\.html$/.test(abs)) return false
  return sessions.some(s => {
    const rel = relative(resolve(s), abs)
    return !!rel && !rel.startsWith('..') && !rel.startsWith('/')
  })
}
