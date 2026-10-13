// One xterm per pty, kept alive while its tab is hidden so switching sessions never loses output.

import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'

import { api } from './api.ts'

type Entry = { term: Terminal; fit: FitAddon; el: HTMLDivElement; exited: number | null }

const entries = new Map<string, Entry>()
const exitListeners = new Set<() => void>()

const THEME = {
  background: '#0b0d11',
  foreground: '#d7dae0',
  cursor: '#7aa2f7',
  selectionBackground: '#2b3445',
  black: '#1b1e25', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#c0caf5',
  brightBlack: '#565f89', brightRed: '#ff899d', brightGreen: '#b3e07f', brightYellow: '#f0c27b', brightBlue: '#8db0ff', brightMagenta: '#c9aaff', brightCyan: '#97dcff', brightWhite: '#e3e8ff',
}

api.onData((id, data) => entries.get(id)?.term.write(data))
api.onExit((id, code) => {
  const e = entries.get(id)
  if (!e) return
  e.exited = code
  e.term.write(`\r\n\x1b[2m[process exited with code ${code}]\x1b[0m\r\n`)
  exitListeners.forEach(f => f())
})

export const onAnyExit = (f: () => void) => {
  exitListeners.add(f)
  return () => void exitListeners.delete(f)
}

export const exitCode = (id: string) => entries.get(id)?.exited ?? null

export function attach(id: string, host: HTMLElement) {
  let e = entries.get(id)
  if (!e) {
    const el = document.createElement('div')
    el.className = 'xterm-host'
    const term = new Terminal({ fontFamily: 'JetBrains Mono, SF Mono, Menlo, monospace', fontSize: 12.5, lineHeight: 1.2, theme: THEME, cursorBlink: true, allowProposedApi: true, scrollback: 20000 })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    term.onData(d => api.write(id, d))
    term.onResize(({ cols, rows }) => api.resize(id, cols, rows))
    e = { term, fit, el, exited: null }
    entries.set(id, e)
  }
  host.appendChild(e.el)
  requestAnimationFrame(() => {
    try {
      e!.fit.fit()
      e!.term.focus()
    } catch {
      /* not laid out yet */
    }
  })
  return e
}

export function fit(id: string) {
  try {
    entries.get(id)?.fit.fit()
  } catch {
    /* hidden */
  }
}

export function dispose(id: string) {
  entries.get(id)?.term.dispose()
  entries.delete(id)
}
