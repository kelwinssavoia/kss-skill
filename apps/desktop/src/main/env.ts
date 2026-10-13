// The user's login-shell environment. An app launched from the Dock inherits launchd's minimal PATH,
// so `claude` and `codex` would not be found (DESIGN.md §24.3). Resolved once, at start-up.

import { spawnSync } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { join } from 'node:path'

let cached: NodeJS.ProcessEnv | null = null

export const shellOf = () => process.env.SHELL || '/bin/zsh'

export function parseEnv0(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of text.split('\0')) {
    const i = pair.indexOf('=')
    if (i > 0) out[pair.slice(0, i)] = pair.slice(i + 1)
  }
  return out
}

export function loginEnv(): NodeJS.ProcessEnv {
  if (cached) return cached
  const r = spawnSync(shellOf(), ['-ilc', 'env -0'], { encoding: 'utf8', timeout: 8000, env: process.env })
  const resolved = r.status === 0 && r.stdout ? parseEnv0(r.stdout) : {}
  cached = { ...process.env, ...resolved, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'kss-desktop' }
  return cached
}

export function which(bin: string, env: NodeJS.ProcessEnv): string | null {
  for (const dir of (env.PATH ?? '').split(':')) {
    if (!dir) continue
    const p = join(dir, bin)
    try {
      accessSync(p, constants.X_OK)
      return p
    } catch {
      /* not here */
    }
  }
  return null
}
