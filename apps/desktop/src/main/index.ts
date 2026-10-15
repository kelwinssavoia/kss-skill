// kss-desktop main process: windows, IPC, and the poll that keeps every session's board fresh.

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'

import type { Harness, ProjectInfo, SavedTab, Session, TerminalInfo, TerminalSpec } from '../shared/types.ts'
import { LiveView } from './live.ts'
import { reportOf, reportUrl, SCHEME, servable } from './report.ts'
import { holder, imageData, qaInfo } from './qa.ts'
import { sessionBoard } from './board.ts'
import { loginEnv, which } from './env.ts'
import { inspectTicket } from './inspector.ts'
import { loadPrefs, savePrefs, withBypass, withHarness, withRecent } from './prefs.ts'
import { createSession, detectProject, featureOfBranch, projectWorktrees, removeSession } from './project.ts'
import { createTerminal, killAll, killTerminal, liveTerminals, resizeTerminal, setConversation, submitTerminal, terminalsIn, writeTerminal } from './pty.ts'
import { claudeConversationExists, findCodexConversation, loadTabs, saveTabs, withConversation, withoutSession, withoutTab, withTab } from './tabs.ts'

const POLL_MS = 1500

let win: BrowserWindow | null = null
let project: ProjectInfo | null = null
let lastSessions = ''
let timer: NodeJS.Timeout | null = null
// build/ holds the icon in dev and preview; a packaged app gets it from its bundle (build/icon.icns).
const ICON = join(import.meta.dirname, '../../build/icon.png')
const prefsFile = () => join(app.getPath('userData'), 'prefs.json')
const tabsFile = () => join(app.getPath('userData'), 'tabs.json')
const CODEX_WATCH_MS = 15 * 60_000

const isCli = (spec: TerminalSpec) => spec.kind === 'chat' || spec.kind === 'phase'

/** Opens a terminal; a chat or a phase is also remembered as a tab of its session, with its conversation. */
function openTerminal(spec: TerminalSpec): TerminalInfo {
  // The bypass flag comes from the prefs here, so every chat and phase follows the switch.
  spec = { ...spec, bypass: loadPrefs(prefsFile()).bypass }
  const harness = spec.harness ?? 'claude-code'
  if (isCli(spec)) {
    spec.tab ??= randomUUID()
    // Claude Code takes the id we give it; Codex picks its own and is found once it writes it.
    if (harness === 'claude-code' && !spec.resume) spec.sessionId = randomUUID()
  }
  const started = Date.now()
  const info = createTerminal(spec, { data: (id, d) => send('term:data', id, d), exit: (id, code) => send('term:exit', id, code) })
  if (!isCli(spec)) return info
  if (!spec.resume) {
    const tab: SavedTab = {
      key: spec.tab!,
      cwd: spec.cwd,
      kind: spec.kind as SavedTab['kind'],
      harness,
      phase: spec.phase ?? null,
      args: spec.args ?? null,
      title: spec.title ?? null,
      readonly: !!spec.readonly,
      conversation: info.conversation,
      createdAt: new Date(started).toISOString(),
    }
    saveTabs(tabsFile(), withTab(loadTabs(tabsFile()), tab))
  }
  if (harness === 'codex' && !info.conversation) watchCodex(info, started)
  return info
}

function watchCodex(info: TerminalInfo, since: number) {
  const timer = setInterval(() => {
    const live = liveTerminals().find(t => t.id === info.id)
    if (!live || Date.now() - since > CODEX_WATCH_MS) return clearInterval(timer)
    const store = loadTabs(tabsFile())
    const claimed = new Set([...Object.values(store).flat().map(t => t.conversation), ...liveTerminals().map(t => t.conversation)].filter((x): x is string => !!x))
    const id = findCodexConversation(info.cwd, since, claimed)
    if (!id) return
    clearInterval(timer)
    if (info.tab) saveTabs(tabsFile(), withConversation(store, info.tab, id))
    const next = setConversation(info.id, id)
    if (next) send('term:info', next)
  }, 2000)
}

/** The session's saved conversations, resumed in new terminals unless one is already open. */
function restoreTabs(session: string): TerminalInfo[] {
  let store = loadTabs(tabsFile())
  const open = new Set(liveTerminals().map(t => t.tab))
  for (const t of store[session] ?? []) {
    if (open.has(t.key)) continue
    const resumable = t.conversation && (t.harness === 'codex' || claudeConversationExists(t.cwd, t.conversation))
    if (!resumable) {
      // Never got a first message: nothing to resume.
      store = withoutTab(store, t.key)
      continue
    }
    try {
      openTerminal({ cwd: t.cwd, kind: t.kind, harness: t.harness, phase: t.phase ?? undefined, args: t.args ?? undefined, readonly: t.readonly, title: t.title ?? undefined, resume: t.conversation!, tab: t.key })
    } catch {
      /* the CLI is gone from PATH: the tab stays saved for later */
    }
  }
  saveTabs(tabsFile(), store)
  return liveTerminals().filter(t => t.cwd === session)
}
const live = new LiveView(frame => send('qa:frame', frame))

async function sessionPaths(): Promise<string[]> {
  if (!project) return []
  const { sessions: wts } = await projectWorktrees(project)
  return [project.root, ...wts.map(w => w.path)]
}

const send = (channel: string, ...args: unknown[]) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

async function sessions(): Promise<Session[]> {
  if (!project) return []
  const { main, sessions: wts } = await projectWorktrees(project)
  const rows = [
    { path: project.root, branch: main?.branch ?? null, isProject: true },
    ...wts.map(w => ({ path: w.path, branch: w.branch, isProject: false })),
  ]
  return rows.map(r => {
    const s = sessionBoard(r.path, featureOfBranch(r.branch, project!.branchPrefix))
    return { ...r, name: r.isProject ? project!.name : r.path.split('/').pop()!, feature: s.feature, board: s.board, report: reportOf(s.featureDir) }
  })
}

async function poll() {
  try {
    const list = await sessions()
    const json = JSON.stringify(list)
    if (json !== lastSessions) {
      lastSessions = json
      send('sessions', list)
    }
  } catch (e) {
    console.error('poll', e)
  }
}

async function openProject(root: string): Promise<ProjectInfo> {
  const env = loginEnv()
  project = await detectProject(root, { claude: which('claude', env), codex: which('codex', env) })
  savePrefs(prefsFile(), withRecent(loadPrefs(prefsFile()), project.root))
  lastSessions = ''
  if (timer) clearInterval(timer)
  timer = setInterval(poll, POLL_MS)
  void poll()
  win?.setTitle(`${project.name} — KSS`)
  return project
}

function featureDirOf(session: string, feature: string) {
  const { featureDir } = sessionBoard(session, feature)
  if (!featureDir) throw new Error('this session has no KSS feature')
  return featureDir
}

function handlers() {
  ipcMain.handle('prefs:get', () => loadPrefs(prefsFile()))
  ipcMain.handle('prefs:harness', (_e, phase: string, h: Harness) => {
    if (!project) return
    savePrefs(prefsFile(), withHarness(loadPrefs(prefsFile()), project.root, phase, h))
  })
  ipcMain.handle('prefs:bypass', (_e, on: boolean) => savePrefs(prefsFile(), withBypass(loadPrefs(prefsFile()), on)))
  ipcMain.handle('project:pick', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    return r.canceled || !r.filePaths[0] ? null : openProject(r.filePaths[0])
  })
  ipcMain.handle('project:open', (_e, root: string) => openProject(root))
  ipcMain.handle('project:get', () => project)
  ipcMain.handle('sessions:list', () => sessions())
  ipcMain.handle('sessions:create', async (_e, request: string) => {
    if (!project) throw new Error('no project open')
    const path = await createSession(project, request)
    void poll()
    return path
  })
  ipcMain.handle('sessions:remove', async (_e, path: string, force: boolean) => {
    if (!project) throw new Error('no project open')
    for (const t of terminalsIn(path)) killTerminal(t.id)
    await removeSession(project, path, force)
    saveTabs(tabsFile(), withoutSession(loadTabs(tabsFile()), path))
    void poll()
  })
  ipcMain.handle('ticket:inspect', (_e, session: string, feature: string, id: string) => inspectTicket(session, featureDirOf(session, feature), feature, id))
  ipcMain.handle('term:create', async (_e, spec: TerminalSpec) => {
    if (spec.kind === 'qa' && spec.qa?.step === 'up') {
      const other = holder(spec.cwd, await sessionPaths())
      if (other) throw new Error(`the QA environment is up in ${other} — run qa down there first`)
    }
    return openTerminal(spec)
  })
  ipcMain.handle('qa:info', async (_e, session: string, feature: string | null) => {
    const dir = feature ? sessionBoard(session, feature).featureDir : null
    return qaInfo(session, dir, feature, await sessionPaths())
  })
  ipcMain.handle('qa:image', async (_e, path: string) => imageData(path, await sessionPaths()))
  ipcMain.handle('qa:watch', (_e, session: string | null) => live.watch(session))
  ipcMain.on('term:write', (_e, id: string, data: string) => writeTerminal(id, data))
  ipcMain.on('term:resize', (_e, id: string, cols: number, rows: number) => resizeTerminal(id, cols, rows))
  // Closing a tab is the user's choice to drop its conversation from the session; quitting the app is not.
  ipcMain.handle('term:close', (_e, id: string, tab: string | null) => {
    killTerminal(id)
    if (tab) saveTabs(tabsFile(), withoutTab(loadTabs(tabsFile()), tab))
  })
  ipcMain.handle('term:submit', (_e, id: string, text: string) => submitTerminal(id, text))
  ipcMain.handle('tabs:restore', (_e, session: string) => restoreTabs(session))
  ipcMain.handle('shell:reveal', (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle('report:url', async (_e, file: string, version: number, phase: string | null) => (servable(file, await sessionPaths()) ? reportUrl(file, version, phase) : null))
  ipcMain.handle('report:open', async (_e, file: string) => {
    if (servable(file, await sessionPaths())) await shell.openPath(file)
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    title: 'KSS',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#17181b',
    icon: ICON,
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), sandbox: false, contextIsolation: true },
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

// The report page runs its own script, so it is framed from its own origin, never the app's.
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }])

app.whenReady().then(() => {
  protocol.handle(SCHEME, async req => {
    const file = new URL(req.url).searchParams.get('f') ?? ''
    if (!servable(file, await sessionPaths())) return new Response('not a session report', { status: 404 })
    try {
      return new Response(readFileSync(file), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
    } catch {
      return new Response('report not found', { status: 404 })
    }
  })
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(ICON)
  handlers()
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('before-quit', () => (live.stop(), killAll()))
app.on('window-all-closed', () => {
  killAll()
  if (process.platform !== 'darwin') app.quit()
})
