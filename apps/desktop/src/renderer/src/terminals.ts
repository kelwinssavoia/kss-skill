// One xterm per pty, kept alive while its tab is hidden so switching sessions never loses output.

import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'

import { api } from './api.ts'

type Entry = { term: Terminal; fit: FitAddon; el: HTMLDivElement; exited: number | null }

const entries = new Map<string, Entry>()
const exitListeners = new Set<() => void>()

const THEME = {
  background: '#121315',
  foreground: '#e4e5e8',
  cursor: '#f58a2e',
  cursorAccent: '#121315',
  selectionBackground: '#4a3523',
  black: '#27292d', red: '#ef6461', green: '#8fcf6f', yellow: '#e8c547', blue: '#6fa8dc', magenta: '#c792ea', cyan: '#6cc4c4', white: '#d6d7da',
  brightBlack: '#6b6e75', brightRed: '#ff817e', brightGreen: '#a9e08a', brightYellow: '#f5d76e', brightBlue: '#8cbcf0', brightMagenta: '#d7a8f5', brightCyan: '#8ad8d8', brightWhite: '#f4f4f6',
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
  // A host shows one terminal: the one attached last.
  if (e.el.parentElement !== host || host.childElementCount !== 1) host.replaceChildren(e.el)
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
