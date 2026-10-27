// The renderer's only door to the main process.

import { contextBridge, ipcRenderer } from 'electron'

import type { AskAnswer, ConversationRow, ExecOverview, Harness, KssAsk, PhaseOverview, Prefs, ProjectInfo, QaFrame, QaInfo, Session, TerminalInfo, TerminalSpec, TicketInspection } from '../shared/types.ts'

const on = <A extends unknown[]>(channel: string, fn: (...args: A) => void) => {
  const h = (_e: unknown, ...args: unknown[]) => fn(...(args as A))
  ipcRenderer.on(channel, h)
  return () => void ipcRenderer.removeListener(channel, h)
}

const api = {
  prefs: (): Promise<Prefs> => ipcRenderer.invoke('prefs:get'),
  setBypass: (on: boolean): Promise<void> => ipcRenderer.invoke('prefs:bypass', on),
  setHarness: (phase: string, h: Harness): Promise<void> => ipcRenderer.invoke('prefs:harness', phase, h),
  pickProject: (): Promise<ProjectInfo | null> => ipcRenderer.invoke('project:pick'),
  openProject: (root: string): Promise<ProjectInfo> => ipcRenderer.invoke('project:open', root),
  project: (): Promise<ProjectInfo | null> => ipcRenderer.invoke('project:get'),
  sessions: (): Promise<Session[]> => ipcRenderer.invoke('sessions:list'),
  createSession: (request: string): Promise<string> => ipcRenderer.invoke('sessions:create', request),
  removeSession: (path: string, force: boolean): Promise<void> => ipcRenderer.invoke('sessions:remove', path, force),
  inspect: (session: string, feature: string, id: string): Promise<TicketInspection> => ipcRenderer.invoke('ticket:inspect', session, feature, id),
  executeOverview: (session: string): Promise<ExecOverview | null> => ipcRenderer.invoke('execute:overview', session),
  phaseOverview: (session: string, phase: string): Promise<PhaseOverview> => ipcRenderer.invoke('phase:overview', session, phase),
  answer: (session: string, ask: KssAsk, answer: AskAnswer): Promise<void> => ipcRenderer.invoke('ask:answer', session, ask, answer),
  draft: (session: string, path: string): Promise<string | null> => ipcRenderer.invoke('ask:draft', session, path),
  clearAsk: (session: string): Promise<void> => ipcRenderer.invoke('ask:clear', session),
  createTerminal: (spec: TerminalSpec): Promise<TerminalInfo> => ipcRenderer.invoke('term:create', spec),
  write: (id: string, data: string) => ipcRenderer.send('term:write', id, data),
  resize: (id: string, cols: number, rows: number) => ipcRenderer.send('term:resize', id, cols, rows),
  close: (id: string, tab: string | null): Promise<void> => ipcRenderer.invoke('term:close', id, tab),
  submit: (id: string, text: string): Promise<void> => ipcRenderer.invoke('term:submit', id, text),
  restoreTabs: (session: string): Promise<TerminalInfo[]> => ipcRenderer.invoke('tabs:restore', session),
  history: (session: string): Promise<ConversationRow[]> => ipcRenderer.invoke('history:list', session),
  replyToPhase: (session: string, phase: string, text: string): Promise<void> => ipcRenderer.invoke('phase:reply', session, phase, text),
  onTermOpened: (fn: (t: TerminalInfo) => void) => on('term:opened', fn),
  onTermInfo: (fn: (t: TerminalInfo) => void) => on('term:info', fn),
  reveal: (path: string): Promise<void> => ipcRenderer.invoke('shell:reveal', path),
  reportUrl: (file: string, version: number, phase: string | null): Promise<string | null> => ipcRenderer.invoke('report:url', file, version, phase),
  openReport: (file: string): Promise<void> => ipcRenderer.invoke('report:open', file),
  qaInfo: (session: string, feature: string | null): Promise<QaInfo> => ipcRenderer.invoke('qa:info', session, feature),
  qaImage: (path: string): Promise<string | null> => ipcRenderer.invoke('qa:image', path),
  qaWatch: (session: string | null): Promise<void> => ipcRenderer.invoke('qa:watch', session),
  onQaFrame: (fn: (f: QaFrame) => void) => on('qa:frame', fn),
  onSessions: (fn: (s: Session[]) => void) => on('sessions', fn),
  onData: (fn: (id: string, data: string) => void) => on('term:data', fn),
  onExit: (fn: (id: string, code: number) => void) => on('term:exit', fn),
}

export type Api = typeof api

contextBridge.exposeInMainWorld('kss', api)
