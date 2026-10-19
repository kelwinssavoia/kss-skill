// Answering a phase from the app (DESIGN.md §26): the answer goes to `.kss/inbox/<id>.answer.json`
// (and `<id>.answer.md` for an edited draft), then one line into the phase's terminal tells it where
// to read. The inbox is the only place in a session the app writes, and only answers.

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import type { AskAnswer, KssAsk } from '../shared/types.ts'
import { loginEnv } from './env.ts'

export const INBOX = '.kss/inbox'

const oneLine = (t: string, n: number) => {
  const s = t.replace(/\s+/g, ' ').trim()
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** What the person did, in a few words: the line the phase sees before it reads the file. */
export function summaryOf(ask: Pick<KssAsk, 'kind'>, a: AskAnswer): string {
  const parts: string[] = []
  if (a.choice) parts.push(`${a.choice.key}) ${a.choice.label}`)
  if (a.text?.trim()) parts.push(oneLine(a.text, 120))
  if (a.draft !== null) parts.push('draft edited')
  if (!parts.length) parts.push(ask.kind === 'approve' ? 'approved' : 'answered')
  return parts.join(' — ')
}

/** The line typed into the phase's terminal. A grill from before the ask reads a bare answer. */
export function answerLine(ask: Pick<KssAsk, 'id' | 'kind' | 'legacy'>, a: AskAnswer): string {
  if (ask.legacy) return a.choice ? `${a.choice.key}) ${a.choice.label}${a.text?.trim() ? ` — ${oneLine(a.text, 400)}` : ''}` : oneLine(a.text ?? '', 600)
  return `[kss-app] answer ${ask.id}: ${summaryOf(ask, a)}`
}

/** An ask id becomes a file name: nothing but the shape ask.mjs gives it. */
export const safeId = (id: string) => /^[a-z][a-z0-9-]*-\d+$/.test(id)

export function writeAnswer(session: string, ask: Pick<KssAsk, 'id'>, a: AskAnswer, now = new Date().toISOString()) {
  if (!safeId(ask.id)) throw new Error(`not an ask id: ${ask.id}`)
  const dir = join(session, INBOX)
  mkdirSync(dir, { recursive: true })
  if (a.draft !== null) writeFileSync(join(dir, `${ask.id}.answer.md`), a.draft)
  writeFileSync(join(dir, `${ask.id}.answer.json`), JSON.stringify({ id: ask.id, choice: a.choice, text: a.text?.trim() || null, draftEdited: a.draft !== null, at: now }, null, 2))
}

/** A draft snapshot, read only from the session's own inbox. */
export function readDraft(session: string, path: string): string | null {
  const abs = resolve(session, path)
  const rel = relative(join(session, INBOX), abs)
  if (!rel || rel.startsWith('..') || rel.startsWith('/')) return null
  try {
    return readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}

/** Drops a handled ask through the project's own script, so `.kss/current` keeps one writer. */
export function clearAsk(session: string): Promise<void> {
  const script = join(session, '.kss/scripts/ask.mjs')
  if (!existsSync(script)) return Promise.resolve()
  return new Promise(res => execFile('node', [script, 'clear', '--cwd', session], { env: loginEnv() as NodeJS.ProcessEnv, timeout: 10_000 }, () => res()))
}
