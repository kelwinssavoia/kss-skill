// Chat and phase tabs remembered per session, with their harness conversation id, so a session
// reopened later brings its conversations back (DESIGN.md §24.3). Kept in the app's own data,
// beside prefs.json — never in the repository.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type { SavedTab } from '../shared/types.ts'
import { claudeSlug } from './transcripts.ts'

export type TabStore = Record<string, SavedTab[]>

export function loadTabs(file: string): TabStore {
  try {
    const t = JSON.parse(readFileSync(file, 'utf8'))
    return t && typeof t === 'object' && !Array.isArray(t) ? t : {}
  } catch {
    return {}
  }
}

export function saveTabs(file: string, store: TabStore) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(store, null, 2))
}

export const withTab = (s: TabStore, tab: SavedTab): TabStore => ({ ...s, [tab.cwd]: [...(s[tab.cwd] ?? []).filter(t => t.key !== tab.key), tab] })

export function withoutTab(s: TabStore, key: string): TabStore {
  const out: TabStore = {}
  for (const [cwd, tabs] of Object.entries(s)) {
    const left = tabs.filter(t => t.key !== key)
    if (left.length) out[cwd] = left
  }
  return out
}

export const withoutSession = (s: TabStore, cwd: string): TabStore => Object.fromEntries(Object.entries(s).filter(([k]) => k !== cwd))

export const withConversation = (s: TabStore, key: string, conversation: string): TabStore =>
  Object.fromEntries(Object.entries(s).map(([cwd, tabs]) => [cwd, tabs.map(t => (t.key === key ? { ...t, conversation } : t))]))

/** A conversation can be resumed only once the harness has written it: Claude Code's transcript file. */
export function claudeConversationExists(cwd: string, id: string, home = homedir()): boolean {
  return existsSync(join(process.env.CLAUDE_CONFIG_DIR ?? join(home, '.claude'), 'projects', claudeSlug(cwd), `${id}.jsonl`))
}

/**
 * The Claude Code conversation a `/clear` started in a terminal that already ran one: `/clear`
 * opens a new transcript with an id of its own, so it is found the way Codex's are — the newest
 * transcript of this cwd created after the clear and claimed by no other tab.
 */
export function findClaudeConversation(cwd: string, since: number, claimed: Set<string>, home = homedir()): string | null {
  const dir = join(process.env.CLAUDE_CONFIG_DIR ?? join(home, '.claude'), 'projects', claudeSlug(cwd))
  let names: string[] = []
  try {
    names = readdirSync(dir).filter(n => n.endsWith('.jsonl'))
  } catch {
    return null
  }
  const found: { id: string; at: number }[] = []
  for (const n of names) {
    const id = n.slice(0, -6)
    if (claimed.has(id)) continue
    try {
      const at = statSync(join(dir, n)).birthtimeMs
      if (at >= since - 2000) found.push({ id, at })
    } catch {
      /* gone */
    }
  }
  return found.sort((a, b) => b.at - a.at)[0]?.id ?? null
}

/**
 * The Codex conversation a terminal started: the newest rollout under ~/.codex/sessions whose
 * `session_meta` names this cwd, began after the terminal did, and no other tab has claimed.
 * Codex picks its own id, and writes the rollout only once the conversation starts.
 */
export function findCodexConversation(cwd: string, since: number, claimed: Set<string>, codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex')): string | null {
  const found: { id: string; at: number }[] = []
  for (let t = since - 86_400_000; t <= Date.now() + 86_400_000; t += 86_400_000) {
    const d = new Date(t)
    const dir = join(codexHome, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
    let names: string[] = []
    try {
      names = readdirSync(dir).filter(n => n.startsWith('rollout-') && n.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const n of names) {
      const meta = sessionMeta(join(dir, n))
      if (!meta || meta.cwd !== cwd || claimed.has(meta.id)) continue
      const at = Date.parse(meta.timestamp ?? '')
      if (Number.isFinite(at) && at >= since - 5000) found.push({ id: meta.id, at })
    }
  }
  return found.sort((a, b) => b.at - a.at)[0]?.id ?? null
}

export function sessionMeta(path: string): { id: string; cwd: string; timestamp: string | null } | null {
  try {
    const first = readFileSync(path, 'utf8').split('\n', 1)[0] ?? ''
    const o = JSON.parse(first)
    const p = o?.type === 'session_meta' ? o.payload : null
    return p && typeof p.id === 'string' && typeof p.cwd === 'string' ? { id: p.id, cwd: p.cwd, timestamp: typeof p.timestamp === 'string' ? p.timestamp : null } : null
  } catch {
    return null
  }
}
