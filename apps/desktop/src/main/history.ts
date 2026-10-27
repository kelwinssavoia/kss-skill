// Every conversation a session used (DESIGN.md §24.9), as a timeline: read from the harnesses' own
// transcripts — Claude Code writes one file per conversation under the worktree's project folder,
// and a `/clear` opens a new one, so the loop's earlier rounds stay listed — plus what the app saw
// end each one (its phase finished, it sat idle, a clear, a restart). Kept beside prefs.json.

import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { ConversationRow, EndReason, Harness, TerminalInfo } from '../shared/types.ts'
import { sessionMeta } from './tabs.ts'
import { claudeSlug } from './transcripts.ts'

/** What the app knows of a conversation the transcript does not say: how it was opened, how it ended. */
export type Ending = { cwd: string; kind: 'phase' | 'chat'; phase: string | null; args: string | null; title: string | null; end: EndReason | null; at: string }
export type EndingStore = Record<string, Ending>

export function loadEndings(file: string): EndingStore {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'))
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {}
  } catch {
    return {}
  }
}

export const saveEndings = (file: string, s: EndingStore) => writeFileSync(file, JSON.stringify(s, null, 2))

/** A conversation opened (or reopened) in a terminal: it is live again, whatever ended it before. */
export const withOpened = (s: EndingStore, t: Pick<TerminalInfo, 'cwd' | 'kind' | 'phase' | 'title'> & { conversation: string; args?: string | null }, at: string): EndingStore =>
  t.kind === 'phase' || t.kind === 'chat'
    ? { ...s, [t.conversation]: { cwd: t.cwd, kind: t.kind, phase: t.phase, args: t.args ?? s[t.conversation]?.args ?? null, title: t.title, end: null, at } }
    : s

/** The first reason recorded wins: a kill the app made says why, the exit that follows does not overwrite it. */
export function withEnded(s: EndingStore, conversation: string | null, end: EndReason, at: string): EndingStore {
  const e = conversation ? s[conversation] : undefined
  if (!e || e.end) return s
  return { ...s, [conversation!]: { ...e, end, at } }
}

// ---------------------------------------------------------------- the first prompt

const HEAD_BYTES = 256 * 1024
const cut = (t: string, n = 200) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)

function head(path: string): string {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(HEAD_BYTES)
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0)
    return buf.subarray(0, n).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/** `/kss:kss-review 073-x --loop --app` (or `$kss-review …`) → the phase and its arguments, `--app` left out. */
export function phaseOfPrompt(prompt: string): { phase: string; args: string } | null {
  const m = /^[/$](?:kss:)?kss-([a-z-]+)\s*(.*)$/s.exec(prompt.trim())
  return m ? { phase: m[1]!, args: m[2]!.replace(/(^|\s)--app\b/g, '').trim() } : null
}

/** A Claude Code transcript's first user message, with a slash command written back as typed. */
export function claudeFirstPrompt(text: string): { prompt: string; at: string | null } | null {
  for (const line of text.split('\n')) {
    if (!line.includes('"type":"user"')) continue
    let o: { type?: string; isMeta?: boolean; timestamp?: string; message?: { content?: unknown } }
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    if (o.type !== 'user' || o.isMeta) continue
    const c = o.message?.content
    const raw = typeof c === 'string' ? c : Array.isArray(c) ? (c.find((x: { type?: string }) => x?.type === 'text') as { text?: string } | undefined)?.text ?? '' : ''
    if (!raw.trim() || raw.startsWith('<local-command') || raw.startsWith('Caveat:')) continue
    const name = /<command-name>([^<]*)<\/command-name>/.exec(raw)?.[1]
    if (name === '/clear') continue
    const args = /<command-args>([^<]*)<\/command-args>/.exec(raw)?.[1] ?? ''
    return { prompt: cut(name ? `${name} ${args}`.trim() : raw.trim()), at: o.timestamp ?? null }
  }
  return null
}

/** A Codex rollout's first message from the person — not the environment and instruction blocks Codex adds. */
export function codexFirstPrompt(text: string): string | null {
  for (const line of text.split('\n')) {
    if (!line.includes('"role":"user"')) continue
    try {
      const p = JSON.parse(line)?.payload
      const t = Array.isArray(p?.content) ? p.content.map((x: { text?: string }) => x?.text ?? '').join(' ').trim() : ''
      if (t && !t.startsWith('<')) return cut(t)
    } catch {
      /* a partial line at the end of the head */
    }
  }
  return null
}

// ---------------------------------------------------------------- the timeline

const claudeHome = () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
const codexHome = () => process.env.CODEX_HOME ?? join(homedir(), '.codex')
const CODEX_DAYS = 30

/** Transcripts are re-read only when they change. */
const cache = new Map<string, { mtime: number; first: { prompt: string | null; at: string | null } }>()

function cached(path: string, mtime: number, read: () => { prompt: string | null; at: string | null }) {
  const hit = cache.get(path)
  if (hit && hit.mtime === mtime) return hit.first
  const first = read()
  cache.set(path, { mtime, first })
  return first
}

type Found = { id: string; harness: Harness; path: string; born: number; mtime: number }

function claudeTranscripts(cwd: string): Found[] {
  const dir = join(claudeHome(), 'projects', claudeSlug(cwd))
  let names: string[] = []
  try {
    names = readdirSync(dir).filter(n => n.endsWith('.jsonl'))
  } catch {
    return []
  }
  return names.flatMap(n => {
    try {
      const st = statSync(join(dir, n))
      return [{ id: n.slice(0, -6), harness: 'claude-code' as const, path: join(dir, n), born: st.birthtimeMs, mtime: st.mtimeMs }]
    } catch {
      return []
    }
  })
}

function codexTranscripts(cwd: string): Found[] {
  const out: Found[] = []
  for (let back = 0; back < CODEX_DAYS; back++) {
    const d = new Date(Date.now() - back * 86_400_000)
    const dir = join(codexHome(), 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
    let names: string[] = []
    try {
      names = readdirSync(dir).filter(n => n.startsWith('rollout-') && n.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const n of names) {
      const meta = sessionMeta(join(dir, n))
      if (!meta || meta.cwd !== cwd) continue
      try {
        const st = statSync(join(dir, n))
        out.push({ id: meta.id, harness: 'codex', path: join(dir, n), born: Date.parse(meta.timestamp ?? '') || st.birthtimeMs, mtime: st.mtimeMs })
      } catch {
        /* gone */
      }
    }
  }
  return out
}

/** Every conversation this worktree ran, oldest first, joined with what the app recorded and what runs now. */
export function conversationsOf(cwd: string, endings: EndingStore, live: TerminalInfo[]): ConversationRow[] {
  const rows: ConversationRow[] = []
  for (const f of [...claudeTranscripts(cwd), ...codexTranscripts(cwd)]) {
    const first = cached(f.path, f.mtime, () => {
      try {
        const text = head(f.path)
        return f.harness === 'codex' ? { prompt: codexFirstPrompt(text), at: null } : claudeFirstPrompt(text) ?? { prompt: null, at: null }
      } catch {
        return { prompt: null, at: null }
      }
    })
    const e = endings[f.id]
    // A transcript with no message from the person is a CLI opened and closed: not a conversation.
    if (!first.prompt && !e) continue
    const parsed = first.prompt ? phaseOfPrompt(first.prompt) : null
    const term = live.find(t => t.conversation === f.id) ?? null
    rows.push({
      id: f.id,
      harness: f.harness,
      kind: e?.kind ?? (parsed ? 'phase' : 'chat'),
      phase: e?.phase ?? parsed?.phase ?? null,
      args: e?.args ?? parsed?.args ?? null,
      prompt: first.prompt,
      title: e?.title ?? null,
      startedAt: first.at ?? new Date(f.born).toISOString(),
      lastAt: new Date(f.mtime).toISOString(),
      liveTerminal: term?.id ?? null,
      end: term ? null : e?.end ?? 'exited',
    })
  }
  return rows.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}
