// Pseudo-terminals for phases, chats and shells (DESIGN.md §24.3).

import { randomUUID } from 'node:crypto'

import * as pty from 'node-pty'

import type { TerminalInfo, TerminalSpec } from '../shared/types.ts'
import { launchOf } from '../shared/commands.ts'
import { loginEnv, shellOf, which } from './env.ts'

type Sink = { data: (id: string, data: string) => void; exit: (id: string, code: number, info: TerminalInfo) => void }

/** When a terminal started, was last typed into, and last printed anything: what idleness is read from. */
export type Activity = { startedAt: number; lastInput: number; lastOutput: number }

const terms = new Map<string, { proc: pty.IPty; info: TerminalInfo; activity: Activity }>()

export function createTerminal(spec: TerminalSpec, sink: Sink): TerminalInfo {
  const env = loginEnv()
  const launch = launchOf(spec, shellOf())
  const file = launch.file.startsWith('/') ? launch.file : which(launch.file, env)
  if (!file) throw new Error(`${launch.file} not found on PATH`)
  const proc = pty.spawn(file, launch.args, {
    name: 'xterm-256color',
    cwd: spec.cwd,
    cols: spec.cols ?? 120,
    rows: spec.rows ?? 32,
    env: env as Record<string, string>,
  })
  const id = randomUUID()
  const isCli = spec.kind === 'chat' || spec.kind === 'phase'
  const info: TerminalInfo = {
    id,
    cwd: spec.cwd,
    title: launch.title,
    kind: spec.kind,
    harness: isCli ? spec.harness ?? 'claude-code' : null,
    phase: spec.phase ?? null,
    conversation: spec.resume ?? spec.sessionId ?? null,
    tab: spec.tab ?? null,
    resumed: !!spec.resume,
  }
  const now = Date.now()
  const activity: Activity = { startedAt: now, lastInput: now, lastOutput: now }
  terms.set(id, { proc, info, activity })
  proc.onData(d => {
    activity.lastOutput = Date.now()
    sink.data(id, d)
  })
  proc.onExit(({ exitCode }) => {
    const last = terms.get(id)?.info ?? info
    terms.delete(id)
    sink.exit(id, exitCode, last)
  })
  return info
}

export function writeTerminal(id: string, data: string) {
  const t = terms.get(id)
  if (!t) return
  t.activity.lastInput = Date.now()
  t.proc.write(data)
}

export const activityOf = (id: string): Activity | null => terms.get(id)?.activity ?? null

/** Changes what the app knows about a terminal (why it is being closed, its conversation). */
export function patchInfo(id: string, patch: Partial<TerminalInfo>): TerminalInfo | null {
  const t = terms.get(id)
  if (!t) return null
  t.info = { ...t.info, ...patch }
  return t.info
}

/**
 * Types a message into a CLI and sends it. The Enter goes on its own a moment later: text and a
 * carriage return in one write read as a paste, and a pasted newline does not submit.
 */
export function submitTerminal(id: string, text: string) {
  const t = terms.get(id)
  if (!t) throw new Error('that terminal has exited')
  t.activity.lastInput = Date.now()
  t.proc.write(text.replace(/\s*\n\s*/g, ' ').trim())
  setTimeout(() => terms.get(id)?.proc.write('\r'), 150)
}

export function setConversation(id: string, conversation: string | null): TerminalInfo | null {
  const t = terms.get(id)
  if (!t) return null
  t.info = { ...t.info, conversation, resumed: false }
  return t.info
}

export const liveTerminals = () => [...terms.values()].map(t => t.info)

export function resizeTerminal(id: string, cols: number, rows: number) {
  const t = terms.get(id)
  if (t && cols > 0 && rows > 0) t.proc.resize(cols, rows)
}

export function killTerminal(id: string) {
  const t = terms.get(id)
  if (!t) return
  t.proc.kill()
  terms.delete(id)
}

export function killAll() {
  for (const id of [...terms.keys()]) killTerminal(id)
}

export const terminalsIn = (cwd: string) => [...terms.values()].map(t => t.info).filter(i => i.cwd === cwd)
