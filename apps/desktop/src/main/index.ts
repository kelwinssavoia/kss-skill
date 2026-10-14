// kss-desktop main process: windows, IPC, and the poll that keeps every session's board fresh.

import { join } from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'

import type { Harness, ProjectInfo, Session, TerminalSpec } from '../shared/types.ts'
import { LiveView } from './live.ts'
import { holder, imageData, qaInfo } from './qa.ts'
import { sessionBoard } from './board.ts'
import { loginEnv, which } from './env.ts'
import { inspectTicket } from './inspector.ts'
import { loadPrefs, savePrefs, withBypass, withHarness, withRecent } from './prefs.ts'
import { createSession, detectProject, featureOfBranch, projectWorktrees, removeSession } from './project.ts'
import { createTerminal, killAll, killTerminal, resizeTerminal, terminalsIn, writeTerminal } from './pty.ts'

const POLL_MS = 1500

let win: BrowserWindow | null = null
let project: ProjectInfo | null = null
let lastSessions = ''
let timer: NodeJS.Timeout | null = null
// build/ holds the icon in dev and preview; a packaged app gets it from its bundle (build/icon.icns).
const ICON = join(import.meta.dirname, '../../build/icon.png')
const prefsFile = () => join(app.getPath('userData'), 'prefs.json')
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
    return { ...r, name: r.isProject ? project!.name : r.path.split('/').pop()!, feature: s.feature, board: s.board }
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
    void poll()
  })
  ipcMain.handle('ticket:inspect', (_e, session: string, feature: string, id: string) => inspectTicket(session, featureDirOf(session, feature), feature, id))
  ipcMain.handle('term:create', async (_e, spec: TerminalSpec) => {
    if (spec.kind === 'qa' && spec.qa?.step === 'up') {
      const other = holder(spec.cwd, await sessionPaths())
      if (other) throw new Error(`the QA environment is up in ${other} — run qa down there first`)
    }
    // The bypass flag comes from the prefs here, so every chat and phase follows the switch.
    spec = { ...spec, bypass: loadPrefs(prefsFile()).bypass }
    return createTerminal(spec, { data: (id, d) => send('term:data', id, d), exit: (id, code) => send('term:exit', id, code) })
  })
  ipcMain.handle('qa:info', async (_e, session: string, feature: string | null) => {
    const dir = feature ? sessionBoard(session, feature).featureDir : null
    return qaInfo(session, dir, feature, await sessionPaths())
  })
  ipcMain.handle('qa:image', async (_e, path: string) => imageData(path, await sessionPaths()))
  ipcMain.handle('qa:watch', (_e, session: string | null) => live.watch(session))
  ipcMain.on('term:write', (_e, id: string, data: string) => writeTerminal(id, data))
  ipcMain.on('term:resize', (_e, id: string, cols: number, rows: number) => resizeTerminal(id, cols, rows))
  ipcMain.handle('term:kill', (_e, id: string) => killTerminal(id))
  ipcMain.handle('shell:reveal', (_e, path: string) => shell.showItemInFolder(path))
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

app.whenReady().then(() => {
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
