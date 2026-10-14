// Thin git helpers. Every call is `git -C <cwd> …` with execFile — no shell, no quoting.

import { execFile } from 'node:child_process'

export type GitResult = { ok: boolean; stdout: string; stderr: string }

export function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<GitResult> {
  return new Promise(resolve => {
    execFile('git', ['-C', cwd, ...args], { env: env ?? process.env, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

export type Worktree = { path: string; head: string | null; branch: string | null; isBare: boolean; isDetached: boolean }

/** `git worktree list --porcelain` → one entry per worktree, the main one first. */
export function parseWorktrees(text: string): Worktree[] {
  const out: Worktree[] = []
  let cur: Worktree | null = null
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur) out.push(cur)
      cur = { path: line.slice('worktree '.length), head: null, branch: null, isBare: false, isDetached: false }
    } else if (!cur) {
      continue
    } else if (line.startsWith('HEAD ')) {
      cur.head = line.slice(5)
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice(7).replace(/^refs\/heads\//, '')
    } else if (line === 'bare') {
      cur.isBare = true
    } else if (line === 'detached') {
      cur.isDetached = true
    }
  }
  if (cur) out.push(cur)
  return out
}

export async function worktrees(cwd: string): Promise<Worktree[]> {
  const r = await git(cwd, ['worktree', 'list', '--porcelain'])
  return r.ok ? parseWorktrees(r.stdout) : []
}
