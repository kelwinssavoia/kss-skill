// The renderer's only door to the main process.

import { contextBridge, ipcRenderer } from 'electron'

import type { Harness, Prefs, ProjectInfo, Session, TerminalInfo, TerminalSpec, TicketInspection } from '../shared/types.ts'

const on = <A extends unknown[]>(channel: string, fn: (...args: A) => void) => {
  const h = (_e: unknown, ...args: unknown[]) => fn(...(args as A))
  ipcRenderer.on(channel, h)
  return () => void ipcRenderer.removeListener(channel, h)
}

const api = {
  prefs: (): Promise<Prefs> => ipcRenderer.invoke('prefs:get'),
  setHarness: (phase: string, h: Harness): Promise<void> => ipcRenderer.invoke('prefs:harness', phase, h),
  pickProject: (): Promise<ProjectInfo | null> => ipcRenderer.invoke('project:pick'),
  openProject: (root: string): Promise<ProjectInfo> => ipcRenderer.invoke('project:open', root),
  project: (): Promise<ProjectInfo | null> => ipcRenderer.invoke('project:get'),
  sessions: (): Promise<Session[]> => ipcRenderer.invoke('sessions:list'),
  createSession: (request: string): Promise<string> => ipcRenderer.invoke('sessions:create', request),
  removeSession: (path: string, force: boolean): Promise<void> => ipcRenderer.invoke('sessions:remove', path, force),
  inspect: (session: string, feature: string, id: string): Promise<TicketInspection> => ipcRenderer.invoke('ticket:inspect', session, feature, id),
  createTerminal: (spec: TerminalSpec): Promise<TerminalInfo> => ipcRenderer.invoke('term:create', spec),
  write: (id: string, data: string) => ipcRenderer.send('term:write', id, data),
  resize: (id: string, cols: number, rows: number) => ipcRenderer.send('term:resize', id, cols, rows),
  kill: (id: string): Promise<void> => ipcRenderer.invoke('term:kill', id),
  reveal: (path: string): Promise<void> => ipcRenderer.invoke('shell:reveal', path),
  onSessions: (fn: (s: Session[]) => void) => on('sessions', fn),
  onData: (fn: (id: string, data: string) => void) => on('term:data', fn),
  onExit: (fn: (id: string, code: number) => void) => on('term:exit', fn),
}

export type Api = typeof api

contextBridge.exposeInMainWorld('kss', api)
