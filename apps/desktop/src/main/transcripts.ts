// Where a ticket's subagent writes its transcript, and what it says (DESIGN.md §24.4).
// Both formats are internal and undocumented: every access is defensive, a bad line is skipped.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { describeTool } from '../../../../mods/kss-ui/hooks/kss.ts'
import type { ActivityEntry, TicketActivity } from '../shared/types.ts'

export type Format = 'claude' | 'codex'

/** Claude Code's project directory name for a cwd: every `/` and `.` becomes `-`. */
export const claudeSlug = (cwd: string) => cwd.replace(/[/.]/g, '-')

const cut = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t)

const lines = (text: string) =>
  text.split('\n').flatMap(l => {
    if (!l) return []
    try {
      const o = JSON.parse(l)
      return o && typeof o === 'object' ? [o as Record<string, any>] : []
    } catch {
      return []
    }
  })

export function detectFormat(head: string): Format | null {
  if (/"type"\s*:\s*"(session_meta|turn_context|response_item)"/.test(head)) return 'codex'
  if (/"message"\s*:/.test(head)) return 'claude'
  return null
}

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map(b => (b && typeof b === 'object' && typeof b.text === 'string' ? b.text : '')).filter(Boolean).join('\n')
      : ''

/** Claude Code subagent / `claude -p` transcript → turns, tokens and the activity feed. */
export function parseClaude(text: string): Omit<TicketActivity, 'transcript' | 'format'> {
  const entries: ActivityEntry[] = []
  const seen = new Set<string>()
  let turns = 0
  let tokens = 0
  let model: string | null = null
  let updatedAt: string | null = null
  for (const o of lines(text)) {
    const at = typeof o.timestamp === 'string' ? o.timestamp : null
    if (at) updatedAt = at
    const m = o.message
    if (!m || typeof m !== 'object') continue
    if (m.role === 'user') {
      if (typeof m.content === 'string' || (Array.isArray(m.content) && m.content.some((b: any) => b?.type === 'text'))) {
        const t = textOf(m.content).trim()
        if (t) entries.push({ at, kind: entries.length ? 'text' : 'prompt', text: entries.length ? cut(t, 400) : t })
      }
      continue
    }
    if (m.role !== 'assistant') continue
    const key = m.id || o.requestId || o.uuid
    const u = m.usage
    if (u && typeof u === 'object' && !(key && seen.has(key))) {
      if (key) seen.add(key)
      turns++
      const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
      tokens += n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens) + n(u.output_tokens)
    }
    if (typeof m.model === 'string') model = m.model
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) entries.push({ at, kind: 'text', text: cut(b.text.trim(), 1200) })
      else if (b?.type === 'tool_use') entries.push({ at, kind: 'tool', text: describeTool(String(b.name), b.input && typeof b.input === 'object' ? b.input : {}) })
    }
  }
  return { turns, tokens, model, updatedAt, entries }
}

/** Codex rollout → the same. Shell calls carry their command in the JSON `arguments`. */
export function parseCodex(text: string): Omit<TicketActivity, 'transcript' | 'format'> {
  const entries: ActivityEntry[] = []
  let turns = 0
  let tokens = 0
  let model: string | null = null
  let updatedAt: string | null = null
  for (const o of lines(text)) {
    const at = typeof o.timestamp === 'string' ? o.timestamp : null
    if (at) updatedAt = at
    const p = o.payload
    if (!p || typeof p !== 'object') continue
    if (o.type === 'turn_context' && typeof p.model === 'string') model = p.model
    if (o.type === 'token_usage_record' || (o.type === 'event_msg' && p.type === 'token_count')) {
      const u = p.last_token_usage ?? p.info?.last_token_usage ?? p.usage
      if (u && typeof u.total_tokens === 'number') {
        turns++
        tokens += u.total_tokens
      }
    }
    if (o.type !== 'response_item') continue
    if (p.type === 'message') {
      const t = textOf(p.content).trim()
      if (!t || (p.role !== 'user' && p.role !== 'assistant')) continue
      if (p.role === 'user' && /^<(environment_context|user_instructions|permissions)/.test(t)) continue
      const isPrompt = p.role === 'user' && !entries.some(e => e.kind === 'prompt')
      entries.push({ at, kind: isPrompt ? 'prompt' : 'text', text: isPrompt ? t : cut(t, 1200) })
    } else if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') {
      let args: Record<string, unknown> = {}
      try {
        args = typeof p.arguments === 'string' ? JSON.parse(p.arguments) : p.arguments ?? p.action ?? {}
      } catch {
        /* free-form input: show the name only */
      }
      const cmd = Array.isArray(args.command) ? args.command.join(' ') : typeof args.cmd === 'string' ? args.cmd : typeof args.command === 'string' ? args.command : null
      entries.push({ at, kind: 'tool', text: cmd ? cut(`$ ${cmd.split('\n')[0]}`, 80) : String(p.name ?? p.type) })
    }
  }
  return { turns, tokens, model, updatedAt, entries }
}

export function readActivity(path: string | null): TicketActivity {
  const empty: TicketActivity = { transcript: path, format: null, turns: 0, tokens: 0, model: null, updatedAt: null, entries: [] }
  if (!path) return empty
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return empty
  }
  const format = detectFormat(text.slice(0, 4000))
  if (!format) return empty
  return { transcript: path, format, ...(format === 'codex' ? parseCodex(text) : parseClaude(text)) }
}

type Candidate = { path: string; mtime: number }

function jsonl(dir: string, depth: number, since: number, out: Candidate[]) {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const n of names) {
    const p = join(dir, n)
    let s
    try {
      s = statSync(p)
    } catch {
      continue
    }
    if (s.isDirectory()) {
      if (depth > 0) jsonl(p, depth - 1, since, out)
    } else if (n.endsWith('.jsonl') && s.mtimeMs >= since) {
      out.push({ path: p, mtime: s.mtimeMs })
    }
  }
}

const head = (p: string, n = 64 * 1024) => {
  try {
    return readFileSync(p, 'utf8').slice(0, n)
  } catch {
    return ''
  }
}

/** Codex rollout directories for the days a run may span: `~/.codex/sessions/YYYY/MM/DD`. */
function codexDays(root: string, since: number): string[] {
  const out: string[] = []
  for (let t = since - 86_400_000; t <= Date.now() + 86_400_000; t += 86_400_000) {
    const d = new Date(t)
    const p = join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
    if (existsSync(p) && !out.includes(p)) out.push(p)
  }
  return out
}

/**
 * Every transcript of a subagent working in `worktree` written after `since`, newest first — the
 * executor's, and the reviewer's once it runs (both briefs name the worktree).
 * A local Claude Code subagent lives under the session's project directory and names the worktree
 * in its brief; a cross-harness ticket (§21) is a CLI whose cwd is the worktree itself.
 */
export function locateTranscripts(opts: { session: string; worktree: string; since: number; home?: string; codexHome?: string }): string[] {
  const home = opts.home ?? homedir()
  const found: Candidate[] = []
  const claude = join(home, '.claude/projects')
  jsonl(join(claude, claudeSlug(opts.session)), 2, opts.since, found)
  jsonl(join(claude, claudeSlug(opts.worktree)), 0, opts.since, found)
  const codex = join(opts.codexHome ?? process.env.CODEX_HOME ?? join(home, '.codex'), 'sessions')
  for (const d of codexDays(codex, opts.since)) jsonl(d, 0, opts.since, found)

  const wt = opts.worktree.replace(/\/+$/, '')
  const matches = found.filter(c => {
    const h = head(c.path)
    if (c.path.includes(`/${claudeSlug(opts.worktree)}/`)) return true
    if (c.path.includes('/subagents/')) return h.includes(wt)
    if (c.path.startsWith(codex)) return h.includes(`"cwd":"${wt}"`)
    return false
  })
  matches.sort((a, b) => b.mtime - a.mtime)
  return matches.map(c => c.path)
}
