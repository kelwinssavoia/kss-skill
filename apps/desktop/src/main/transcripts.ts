// Where a ticket's subagent writes its transcript, and what it says (DESIGN.md §24.4).
// Both formats are internal and undocumented: every access is defensive, a bad line is skipped.

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { describeTool } from '../../../../mods/kss-ui/hooks/kss.ts'
import type { ActivityEntry, TicketActivity } from '../shared/types.ts'

export type Format = 'claude' | 'codex'

/** Claude Code's project directory name for a cwd: every `/` and `.` becomes `-`. */
export const claudeSlug = (cwd: string) => cwd.replace(/[/.]/g, '-')

const cut = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t)

/** Harness-injected text in a user turn (reminders, hook output): never the agent's or the coordinator's words. */
const isInjected = (t: string) => /^<(system-reminder|environment_context|user_instructions|permissions|command-|local-command)/.test(t)

/**
 * A shell command as a person would say it: the first line, without the `cd <worktree> &&` and
 * `VAR=… &&` preamble every agent repeats, worktree paths made relative.
 */
export function tidyCommand(command: string): string {
  let c = command.split('\n').find(l => l.trim()) ?? ''
  const preamble = /^\s*(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)|[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*))\s*(?:&&|;)\s*/
  for (let i = 0; i < 6 && preamble.test(c); i++) c = c.replace(preamble, '')
  const wt = String.raw`/[^\s"']*/\.kss/worktrees/[^/\s"']+/\d{2}`
  c = c
    .replace(new RegExp(String.raw`(["'])${wt}/?([^"']*)\1`, 'g'), (_m, _q, rest) => `./${rest}`)
    .replace(new RegExp(String.raw`${wt}/?`, 'g'), './')
    .replace(/\$[A-Z_]+\//g, '')
  return `$ ${c.trim()}`
}

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
        if (t && !isInjected(t)) entries.push({ at, kind: entries.length ? 'message' : 'prompt', text: entries.length ? cut(t, 400) : t })
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
      else if (b?.type === 'tool_use') {
        const input = b.input && typeof b.input === 'object' ? b.input : {}
        entries.push({ at, kind: 'tool', text: b.name === 'Bash' && typeof input.command === 'string' ? cut(tidyCommand(input.command), 140) : describeTool(String(b.name), input) })
      }
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
      if (p.role === 'user' && isInjected(t)) continue
      const isPrompt = p.role === 'user' && !entries.some(e => e.kind === 'prompt')
      entries.push({ at, kind: isPrompt ? 'prompt' : p.role === 'user' ? 'message' : 'text', text: isPrompt ? t : cut(t, 1200) })
    } else if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') {
      let args: Record<string, unknown> = {}
      try {
        args = typeof p.arguments === 'string' ? JSON.parse(p.arguments) : p.arguments ?? p.action ?? {}
      } catch {
        /* free-form input: show the name only */
      }
      const cmd = Array.isArray(args.command) ? args.command.join(' ') : typeof args.cmd === 'string' ? args.cmd : typeof args.command === 'string' ? args.command : null
      entries.push({ at, kind: 'tool', text: cmd ? cut(tidyCommand(cmd), 140) : String(p.name ?? p.type) })
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

/**
 * One listing serves every ticket of a poll: the Execute view asks for each of its tickets in turn,
 * and a session's project directory holds hundreds of entries to stat.
 */
const LISTING_MS = 1000
const listings = new Map<string, { at: number; all: Candidate[] }>()

function jsonl(dir: string, depth: number, since: number, out: Candidate[]) {
  const key = `${depth}:${dir}`
  let hit = listings.get(key)
  if (!hit || Date.now() - hit.at > LISTING_MS) {
    hit = { at: Date.now(), all: [] }
    scan(dir, depth, hit.all)
    listings.set(key, hit)
  }
  for (const c of hit.all) if (c.mtime >= since) out.push(c)
}

function scan(dir: string, depth: number, out: Candidate[]) {
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
      if (depth > 0) scan(p, depth - 1, out)
    } else if (n.endsWith('.jsonl')) {
      out.push({ path: p, mtime: s.mtimeMs })
    }
  }
}

/** A full head never changes (transcripts are append-only): kept, since every ticket of every poll asks again. */
const heads = new Map<string, string>()

/** The first `n` bytes only — a session's transcripts add up to tens of megabytes, read on the main process. */
const head = (p: string, n = 64 * 1024) => {
  const hit = heads.get(p)
  if (hit !== undefined) return hit
  let fd: number | null = null
  try {
    fd = openSync(p, 'r')
    const buf = Buffer.alloc(n)
    const len = readSync(fd, buf, 0, n, 0)
    const text = buf.toString('utf8', 0, len)
    if (len === n) heads.set(p, text)
    return text
  } catch {
    return ''
  } finally {
    if (fd !== null) closeSync(fd)
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
