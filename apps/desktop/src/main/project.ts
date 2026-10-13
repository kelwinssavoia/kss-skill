// A project is a repository opened in the app; a session is one git worktree of it (DESIGN.md §24.2).

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'

import { parseConfig } from '../../../../mods/kss-ui/hooks/kss.ts'
import type { HarnessInfo, ProjectInfo } from '../shared/types.ts'
import { git, worktrees, type Worktree } from './git.ts'

export const read = (p: string): string | null => {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

/** One `key: value` line of `.kss/config.md`, unquoted, comment stripped. */
export function configField(text: string | null, key: string): string | null {
  const m = text ? new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(text) : null
  if (!m) return null
  const v = m[1]!.replace(/\s+#.*$/, '').trim().replace(/^['"`]|['"`]$/g, '')
  return v
}

export const sessionsDirOf = (root: string) => join(dirname(root), `${basename(root)}.kss-sessions`)

/** `012-batch-cutoff` from a feature branch; ticket branches (`012-x.03-ticket`) and others are not features. */
export function featureOfBranch(branch: string | null, prefix: string): string | null {
  if (!branch) return null
  const b = prefix && branch.startsWith(prefix) ? branch.slice(prefix.length) : branch
  return /^\d{3}-[a-z0-9-]+$/.test(b) ? b : null
}

/** A directory name for a new session, from the request: kebab-case, short, unique in `taken`. */
export function sessionSlug(request: string, taken: Set<string>): string {
  const base = request
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 5)
    .join('-')
    .slice(0, 40)
    .replace(/-+$/, '') || 'session'
  let slug = base
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`
  return slug
}

/** Ticket worktrees live under `.kss/worktrees/` (DESIGN.md §14.1) and belong to their session, not the list. */
export const isTicketWorktree = (path: string) => path.split(sep).join('/').includes('/.kss/worktrees/')

export function sessionWorktrees(root: string, all: Worktree[]): Worktree[] {
  const dir = sessionsDirOf(root)
  return all.filter(w => !w.isBare && w.path !== root && !isTicketWorktree(w.path) && !relative(dir, w.path).startsWith('..'))
}

export function listFeatures(root: string, featuresRoot: string | null): string[] {
  if (!featuresRoot) return []
  try {
    return readdirSync(join(root, featuresRoot))
      .filter(n => /^\d{3}-/.test(n) && statSync(join(root, featuresRoot, n)).isDirectory())
      .sort()
  } catch {
    return []
  }
}

export async function detectProject(root: string, harnesses: HarnessInfo): Promise<ProjectInfo> {
  const top = await git(root, ['rev-parse', '--show-toplevel'])
  if (!top.ok) throw new Error(`${root} is not a git repository`)
  const repo = top.stdout.trim()
  const configText = read(join(repo, '.kss/config.md'))
  const config = parseConfig(configText)
  return {
    root: repo,
    name: basename(repo),
    hasKss: !!config,
    featuresRoot: config?.featuresRoot ?? null,
    baseBranch: configField(configText, 'base_branch') || 'main',
    branchPrefix: configField(configText, 'branch_prefix') ?? '',
    hasQaConfig: existsSync(join(repo, '.kss/qa.config.json')),
    harnesses,
    features: listFeatures(repo, config?.featuresRoot ?? null),
    sessionsDir: sessionsDirOf(repo),
  }
}

/** Gitignored files a phase needs that a fresh checkout lacks (DESIGN.md §24.2). */
export function localFiles(root: string): string[] {
  const out: string[] = []
  if (existsSync(join(root, '.kss/config.local.json'))) out.push('.kss/config.local.json')
  try {
    for (const n of readdirSync(root)) if (/^\.env/.test(n) && statSync(join(root, n)).isFile()) out.push(n)
  } catch {
    /* unreadable root: nothing to copy */
  }
  return out
}

export async function createSession(project: ProjectInfo, request: string): Promise<string> {
  mkdirSync(project.sessionsDir, { recursive: true })
  const taken = new Set(existsSync(project.sessionsDir) ? readdirSync(project.sessionsDir) : [])
  const path = join(project.sessionsDir, sessionSlug(request, taken))
  const base = (await git(project.root, ['rev-parse', '--verify', '--quiet', project.baseBranch])).ok ? project.baseBranch : 'HEAD'
  const r = await git(project.root, ['worktree', 'add', '--detach', path, base])
  if (!r.ok) throw new Error(r.stderr.trim() || 'git worktree add failed')
  for (const f of localFiles(project.root)) {
    mkdirSync(dirname(join(path, f)), { recursive: true })
    copyFileSync(join(project.root, f), join(path, f))
  }
  return path
}

export async function removeSession(project: ProjectInfo, path: string, force: boolean): Promise<void> {
  if (path === project.root) throw new Error('the project itself is not a session')
  const r = await git(project.root, ['worktree', 'remove', ...(force ? ['--force'] : []), path])
  if (!r.ok) throw new Error(r.stderr.trim() || 'git worktree remove failed')
}

export async function projectWorktrees(project: ProjectInfo): Promise<{ main: Worktree | null; sessions: Worktree[] }> {
  const all = await worktrees(project.root)
  return { main: all.find(w => w.path === project.root) ?? null, sessions: sessionWorktrees(project.root, all) }
}
