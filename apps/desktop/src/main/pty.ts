// Pseudo-terminals for phases, chats and shells (DESIGN.md §24.3).

import { randomUUID } from 'node:crypto'

import * as pty from 'node-pty'

import type { TerminalInfo, TerminalSpec } from '../shared/types.ts'
import { launchOf } from '../shared/commands.ts'
import { loginEnv, shellOf, which } from './env.ts'

type Sink = { data: (id: string, data: string) => void; exit: (id: string, code: number) => void }

const terms = new Map<string, { proc: pty.IPty; info: TerminalInfo }>()

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
  const info: TerminalInfo = { id, cwd: spec.cwd, title: launch.title, kind: spec.kind, harness: spec.kind === 'shell' || spec.kind === 'qa' ? null : spec.harness ?? 'claude-code' }
  terms.set(id, { proc, info })
  proc.onData(d => sink.data(id, d))
  proc.onExit(({ exitCode }) => {
    terms.delete(id)
    sink.exit(id, exitCode)
  })
  return info
}

export const writeTerminal = (id: string, data: string) => terms.get(id)?.proc.write(data)

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
