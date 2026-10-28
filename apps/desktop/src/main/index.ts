// kss-desktop main process: windows, IPC, and the poll that keeps every session's board fresh.
// Each window holds one project, as a VS Code window holds one folder (DESIGN.md §24.10); the
// terminals are the app's, shared by every window, and each window shows its project's.

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, protocol, shell, type IpcMainInvokeEvent } from 'electron'

import type { AskAnswer, EndReason, Harness, KssAsk, ProjectInfo, SavedTab, Session, TerminalInfo, TerminalSpec } from '../shared/types.ts'
import { answerLine, clearAsk, readDraft, writeAnswer } from './ask.ts'
import { closeReason, lastWriteOf } from './closer.ts'
import { conversationsOf, loadEndings, saveEndings, withEnded, withOpened } from './history.ts'
import { phaseOverview } from './phase.ts'
import { LiveView } from './live.ts'
import { reportOf, reportUrl, SCHEME, servable } from './report.ts'
import { holder, imageData, qaInfo } from './qa.ts'
import { sessionBoard } from './board.ts'
import { loginEnv, which } from './env.ts'
import { executeOverview } from './execute.ts'
import { inspectTicket } from './inspector.ts'
import { loadPrefs, savePrefs, withBypass, withHarness, withRecent, withWindows } from './prefs.ts'
import { createSession, detectProject, featureOfBranch, projectWorktrees, removeSession } from './project.ts'
import { appArgs, phasePrompt } from '../shared/commands.ts'
import { activityOf, createTerminal, killAll, killTerminal, liveTerminals, patchInfo, resizeTerminal, setConversation, submitTerminal, terminalsIn, writeTerminal } from './pty.ts'
import { claudeConversationExists, findClaudeConversation, findCodexConversation, loadTabs, saveTabs, withConversation, withoutSession, withoutTab, withTab } from './tabs.ts'

const POLL_MS = 1500

// A second copy (development, a test) keeps its prefs and saved tabs apart from the installed
// app's: sharing tabs.json would resume the other copy's conversations a second time.
if (process.env.KSS_USER_DATA) app.setPath('userData', process.env.KSS_USER_DATA)

/** One window: the project it shows, the session paths it last listed, and what it was last sent. */
type Window = { win: BrowserWindow; project: ProjectInfo | null; paths: string[]; lastSessions: string }
const windows = new Map<number, Window>()
let timer: NodeJS.Timeout | null = null
/** Quitting closes every window: they stay listed to reopen on the next launch. */
let quitting = false

const windowOf = (e: IpcMainInvokeEvent): Window => {
  const w = windows.get(e.sender.id)
  if (!w) throw new Error('no window for this request')
  return w
}
const projectOf = (e: IpcMainInvokeEvent) => windowOf(e).project
const alive = (w: Window) => !w.win.isDestroyed()
// build/ holds the icon in dev and preview; a packaged app gets it from its bundle (build/icon.icns).
const ICON = join(import.meta.dirname, '../../build/icon.png')
const prefsFile = () => join(app.getPath('userData'), 'prefs.json')
const tabsFile = () => join(app.getPath('userData'), 'tabs.json')
const endingsFile = () => join(app.getPath('userData'), 'conversations.json')
const CODEX_WATCH_MS = 15 * 60_000
/** How long a CLI gets to process `/clear` before the phase command is typed. */
const CLEAR_MS = 1500
/** How long a resumed CLI gets to come up before an answer is typed into it. */
const RESUME_MS = 5000

const recordOpened = (t: TerminalInfo, args: string | null) =>
  t.conversation && saveEndings(endingsFile(), withOpened(loadEndings(endingsFile()), { ...t, conversation: t.conversation, args }, new Date().toISOString()))
const recordEnded = (conversation: string | null, end: EndReason) => saveEndings(endingsFile(), withEnded(loadEndings(endingsFile()), conversation, end, new Date().toISOString()))

/**
 * Closes a terminal the app decided to close, saying why: its conversation is recorded as ended,
 * dropped from the tabs a reopened session resumes (the Sessions view reopens it), and the tab
 * learns why before the exit arrives.
 */
function endTerminal(t: TerminalInfo, end: EndReason) {
  recordEnded(t.conversation, end)
  if (t.tab) saveTabs(tabsFile(), withoutTab(loadTabs(tabsFile()), t.tab))
  const info = patchInfo(t.id, { closed: end })
  if (info) send('term:info', info)
  killTerminal(t.id)
}

const isCli = (spec: TerminalSpec) => spec.kind === 'chat' || spec.kind === 'phase'

/** The newest live terminal running `phase` in `cwd`: the one an answer goes to. */
const phaseTerminal = (cwd: string, phase: string | null) => [...terminalsIn(cwd)].reverse().find(t => t.kind === 'phase' && (!phase || t.phase === phase)) ?? null

/** Opens a terminal; a chat or a phase is also remembered as a tab of its session, with its conversation. */
function openTerminal(spec: TerminalSpec): TerminalInfo {
  // One process per phase and session: a second click while the first starts, or a Run pressed
  // from another view, would otherwise run the phase twice over the same files (DESIGN.md §26).
  if (spec.kind === 'phase' && spec.phase && !spec.resume) {
    const running = terminalsIn(spec.cwd).filter(t => t.kind === 'phase' && t.phase === spec.phase)
    if (running.length && !spec.replace) throw new Error(`${spec.phase} is already running in this session — open its view, or restart it`)
    // Run again: the phase's own terminal takes it, after a /clear — unless it is a restart, or the
    // person switched harness.
    const reuse = spec.restart ? undefined : [...running].reverse().find(t => t.harness === (spec.harness ?? 'claude-code'))
    // A replaced process's conversation is superseded: it is not resumed with the session.
    for (const t of running) if (t !== reuse) endTerminal(t, 'restarted')
    if (reuse) return rerun(reuse, spec)
  }
  // The bypass flag comes from the prefs here, so every chat and phase follows the switch.
  spec = { ...spec, bypass: loadPrefs(prefsFile()).bypass }
  const harness = spec.harness ?? 'claude-code'
  if (isCli(spec)) {
    spec.tab ??= randomUUID()
    // Claude Code takes the id we give it; Codex picks its own and is found once it writes it.
    if (harness === 'claude-code' && !spec.resume) spec.sessionId = randomUUID()
  }
  const started = Date.now()
  const info = createTerminal(spec, {
    data: (id, d) => send('term:data', id, d),
    exit: (id, code, last) => {
      recordEnded(last.conversation, 'exited')
      send('term:exit', id, code)
    },
  })
  if (!isCli(spec)) return info
  recordOpened(info, spec.args ?? null)
  // A new conversation, or one reopened from the Sessions view, is a tab the session resumes.
  if (!spec.resume || !Object.values(loadTabs(tabsFile())).flat().some(t => t.key === spec.tab)) {
    const tab: SavedTab = {
      key: spec.tab!,
      cwd: spec.cwd,
      kind: spec.kind as SavedTab['kind'],
      harness,
      phase: spec.phase ?? null,
      args: spec.args ?? null,
      title: spec.title ?? null,
      readonly: !!spec.readonly,
      conversation: info.conversation ?? spec.resume ?? null,
      createdAt: new Date(started).toISOString(),
    }
    saveTabs(tabsFile(), withTab(loadTabs(tabsFile()), tab))
  }
  if (harness === 'codex' && !info.conversation) watchConversation(info, started)
  return info
}

/**
 * A phase run again in its own terminal: `/clear` (`/new` in Codex) for a fresh context, then the
 * phase command. The conversation the clear opens is found as Codex's always are.
 */
function rerun(t: TerminalInfo, spec: TerminalSpec): TerminalInfo {
  const h = t.harness ?? 'claude-code'
  const started = Date.now()
  // The conversation before the clear stays listed in the Sessions view, ended by the clear.
  recordEnded(t.conversation, 'cleared')
  submitTerminal(t.id, h === 'codex' ? '/new' : '/clear')
  const prompt = phasePrompt(h, spec.phase!, appArgs(spec.phase!, spec.args ?? ''))
  setTimeout(() => {
    try {
      submitTerminal(t.id, prompt)
    } catch {
      /* exited meanwhile: its exit shows in the tab */
    }
  }, CLEAR_MS)
  const info = setConversation(t.id, null) ?? t
  if (t.tab) {
    const store = loadTabs(tabsFile())
    const saved = Object.values(store).flat().find(x => x.key === t.tab)
    if (saved) saveTabs(tabsFile(), withTab(store, { ...saved, args: spec.args ?? null, conversation: null }))
  }
  watchConversation(info, started)
  return info
}

function watchConversation(info: TerminalInfo, since: number) {
  const find = info.harness === 'codex' ? findCodexConversation : findClaudeConversation
  const timer = setInterval(() => {
    const live = liveTerminals().find(t => t.id === info.id)
    if (!live || Date.now() - since > CODEX_WATCH_MS) return clearInterval(timer)
    const store = loadTabs(tabsFile())
    const claimed = new Set([...Object.values(store).flat().map(t => t.conversation), ...liveTerminals().map(t => t.conversation)].filter((x): x is string => !!x))
    const id = find(info.cwd, since, claimed)
    if (!id) return
    clearInterval(timer)
    if (info.tab) saveTabs(tabsFile(), withConversation(store, info.tab, id))
    const next = setConversation(info.id, id)
    if (next) {
      recordOpened(next, null)
      send('term:info', next)
    }
  }, 2000)
}

/**
 * A phase the app closed while it waited on the person: its newest conversation is reopened, so an
 * answer reaches the conversation that asked. Resolves once the CLI had time to come up.
 */
async function reopenPhase(session: string, phase: string | null): Promise<TerminalInfo | null> {
  const last = [...conversationsOf(session, loadEndings(endingsFile()), liveTerminals())].reverse().find(c => c.kind === 'phase' && (!phase || c.phase === phase))
  if (!last) return null
  const info = openTerminal({ cwd: session, kind: 'phase', harness: last.harness, phase: last.phase ?? undefined, args: last.args ?? undefined, resume: last.id })
  sendTo(session, 'term:opened', info)
  await new Promise(r => setTimeout(r, RESUME_MS))
  return info
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

async function sessionPaths(project: ProjectInfo | null): Promise<string[]> {
  if (!project) return []
  const { sessions: wts } = await projectWorktrees(project)
  return [project.root, ...wts.map(w => w.path)]
}

/** Every window's session paths: what the report scheme may serve. */
const allPaths = async () => (await Promise.all([...windows.values()].map(w => sessionPaths(w.project)))).flat()

/** Terminal output goes to every window: each one writes only the terminals it shows. */
const send = (channel: string, ...args: unknown[]) => {
  for (const w of windows.values()) if (alive(w)) w.win.webContents.send(channel, ...args)
}

/** To the windows whose project holds this session (all of them when none claims it). */
const sendTo = (cwd: string, channel: string, ...args: unknown[]) => {
  const owners = [...windows.values()].filter(w => alive(w) && w.paths.includes(cwd))
  for (const w of owners.length ? owners : [...windows.values()].filter(alive)) w.win.webContents.send(channel, ...args)
}

async function sessions(project: ProjectInfo | null): Promise<Session[]> {
  if (!project) return []
  const { main, sessions: wts } = await projectWorktrees(project)
  const rows = [
    { path: project.root, branch: main?.branch ?? null, isProject: true },
    ...wts.map(w => ({ path: w.path, branch: w.branch, isProject: false })),
  ]
  return rows.map(r => {
    const s = sessionBoard(r.path, featureOfBranch(r.branch, project.branchPrefix))
    return { ...r, name: r.isProject ? project.name : r.path.split('/').pop()!, feature: s.feature, board: s.board, report: reportOf(s.featureDir) }
  })
}

/** What each session waits on, last poll: a new key is a new question for the person. */
const waitingSeen = new Map<string, string>()

/** A session that starts waiting on the person says so, even when the app is in the background. */
function notifyWaiting(list: Session[]) {
  let count = 0
  for (const s of list) {
    const b = s.board
    const key = b?.ask ? `ask:${b.ask.id}` : b?.waiting && !b.isPhaseFinished ? `wait:${b.waiting.since}` : ''
    if (key) count++
    const before = waitingSeen.get(s.path)
    waitingSeen.set(s.path, key)
    if (!key || before === undefined || before === key || BrowserWindow.getFocusedWindow()) continue
    if (b?.ask?.kind === 'handoff') continue
    const body = b?.ask ? b.ask.title : (b?.waiting?.last ?? 'The phase is waiting for you').slice(-160)
    if (Notification.isSupported()) new Notification({ title: `${s.feature ?? s.name} · ${b?.phase ?? ''} is waiting`, body, silent: false }).show()
  }
  if (process.platform === 'darwin') app.dock?.setBadge(count ? String(count) : '')
}

/** Closes what finished or sat idle (closer.ts); the person reopens it from its tab or the Sessions view. */
function closeIdle(list: Session[]) {
  const now = Date.now()
  for (const t of liveTerminals()) {
    const a = activityOf(t.id)
    if (!a || t.closed) continue
    const board = list.find(s => s.path === t.cwd)?.board ?? null
    const why = closeReason(t, a, lastWriteOf(t), board, now)
    if (why) endTerminal(t, why)
  }
}

/** One window's sessions, sent to it when they changed. */
async function pollWindow(w: Window): Promise<Session[]> {
  const list = await sessions(w.project)
  w.paths = list.map(s => s.path)
  const json = JSON.stringify(list)
  if (json !== w.lastSessions && alive(w)) {
    w.lastSessions = json
    w.win.webContents.send('sessions', list)
  }
  return list
}

async function poll() {
  try {
    // Two windows never hold the same project, so the sessions do not repeat.
    const list = (await Promise.all([...windows.values()].filter(w => w.project && alive(w)).map(pollWindow))).flat()
    notifyWaiting(list)
    closeIdle(list)
  } catch (e) {
    console.error('poll', e)
  }
}

/** The projects open now, in window order: reopened on the next launch. */
function rememberWindows() {
  if (quitting) return
  const roots = [...windows.values()].map(w => w.project?.root).filter((r): r is string => !!r)
  savePrefs(prefsFile(), withWindows(loadPrefs(prefsFile()), roots))
}

/**
 * Opens a project in a window. A project already open in another window is focused there instead,
 * as VS Code does — two windows on one project would run its phases twice — and an empty window
 * that asked for it closes. Resolves null then.
 */
async function openProject(w: Window, root: string): Promise<ProjectInfo | null> {
  const env = loginEnv()
  const info = await detectProject(root, { claude: which('claude', env), codex: which('codex', env) })
  const other = [...windows.values()].find(x => x !== w && alive(x) && x.project?.root === info.root)
  if (other) {
    if (other.win.isMinimized()) other.win.restore()
    other.win.focus()
    if (!w.project && alive(w)) w.win.close()
    return null
  }
  w.project = info
  w.paths = [info.root]
  w.lastSessions = ''
  savePrefs(prefsFile(), withRecent(loadPrefs(prefsFile()), info.root))
  rememberWindows()
  menu()
  if (alive(w)) w.win.setTitle(`${info.name} — KSS`)
  void pollWindow(w)
  return info
}

function featureDirOf(session: string, feature: string) {
  const { featureDir } = sessionBoard(session, feature)
  if (!featureDir) throw new Error('this session has no KSS feature')
  return featureDir
}

function handlers() {
  ipcMain.handle('prefs:get', () => loadPrefs(prefsFile()))
  ipcMain.handle('prefs:harness', (e, phase: string, h: Harness) => {
    const project = projectOf(e)
    if (!project) return
    savePrefs(prefsFile(), withHarness(loadPrefs(prefsFile()), project.root, phase, h))
  })
  ipcMain.handle('prefs:bypass', (_e, on: boolean) => savePrefs(prefsFile(), withBypass(loadPrefs(prefsFile()), on)))
  ipcMain.handle('project:pick', async e => {
    const w = windowOf(e)
    const r = await dialog.showOpenDialog(w.win, { properties: ['openDirectory'] })
    return r.canceled || !r.filePaths[0] ? null : openProject(w, r.filePaths[0])
  })
  ipcMain.handle('project:open', (e, root: string) => openProject(windowOf(e), root))
  ipcMain.handle('project:get', e => projectOf(e))
  ipcMain.handle('window:new', () => void createWindow(null))
  ipcMain.handle('window:open-project', () => openInNewWindow())
  ipcMain.handle('sessions:list', e => sessions(projectOf(e)))
  ipcMain.handle('sessions:create', async (e, request: string) => {
    const project = projectOf(e)
    if (!project) throw new Error('no project open')
    const path = await createSession(project, request)
    void poll()
    return path
  })
  ipcMain.handle('sessions:remove', async (e, path: string, force: boolean) => {
    const project = projectOf(e)
    if (!project) throw new Error('no project open')
    for (const t of terminalsIn(path)) killTerminal(t.id)
    await removeSession(project, path, force)
    saveTabs(tabsFile(), withoutSession(loadTabs(tabsFile()), path))
    void poll()
  })
  ipcMain.handle('execute:overview', async (_e, session: string) => {
    const s = sessionBoard(session, null)
    const feature = s.feature
    if (!feature || !s.board || !s.featureDir) return null
    return executeOverview(session, s.featureDir, s.board)
  })
  ipcMain.handle('phase:overview', (_e, session: string, phase: string) => {
    const s = sessionBoard(session, null)
    const term = [...liveTerminals()].reverse().find(t => t.cwd === session && t.kind === 'phase' && t.phase === phase) ?? null
    return phaseOverview(phase, s.featureDir, term, s.board?.phaseStartedAt ?? null)
  })
  ipcMain.handle('ask:answer', async (_e, session: string, ask: KssAsk, answer: AskAnswer) => {
    const term = phaseTerminal(session, ask.phase) ?? (await reopenPhase(session, ask.phase))
    if (!term) throw new Error(`${ask.phase ?? 'the phase'} is not running in this session — resume it, then answer`)
    if (!ask.legacy) writeAnswer(session, ask, answer)
    submitTerminal(term.id, answerLine(ask, answer))
  })
  ipcMain.handle('phase:reply', async (_e, session: string, phase: string, text: string) => {
    const term = phaseTerminal(session, phase) ?? (await reopenPhase(session, phase))
    if (!term) throw new Error(`${phase} has no conversation to reopen in this session`)
    submitTerminal(term.id, text)
  })
  ipcMain.handle('history:list', (_e, session: string) => conversationsOf(session, loadEndings(endingsFile()), liveTerminals()))
  ipcMain.handle('ask:draft', (_e, session: string, path: string) => readDraft(session, path))
  ipcMain.handle('ask:clear', (_e, session: string) => clearAsk(session))
  ipcMain.handle('ticket:inspect', (_e, session: string, feature: string, id: string) => inspectTicket(session, featureDirOf(session, feature), feature, id))
  ipcMain.handle('term:create', async (e, spec: TerminalSpec) => {
    if (spec.kind === 'qa' && spec.qa?.step === 'up') {
      const other = holder(spec.cwd, await sessionPaths(projectOf(e)))
      if (other) throw new Error(`the QA environment is up in ${other} — run qa down there first`)
    }
    return openTerminal(spec)
  })
  ipcMain.handle('qa:info', async (e, session: string, feature: string | null) => {
    const dir = feature ? sessionBoard(session, feature).featureDir : null
    return qaInfo(session, dir, feature, await sessionPaths(projectOf(e)))
  })
  ipcMain.handle('qa:image', async (e, path: string) => imageData(path, await sessionPaths(projectOf(e))))
  ipcMain.handle('qa:watch', (_e, session: string | null) => live.watch(session))
  ipcMain.on('term:write', (_e, id: string, data: string) => writeTerminal(id, data))
  ipcMain.on('term:resize', (_e, id: string, cols: number, rows: number) => resizeTerminal(id, cols, rows))
  // Closing a tab is the user's choice to drop its conversation from the session; quitting the app is not.
  ipcMain.handle('term:close', (_e, id: string, tab: string | null) => {
    const t = liveTerminals().find(x => x.id === id)
    if (t) recordEnded(t.conversation, 'closed')
    killTerminal(id)
    if (tab) saveTabs(tabsFile(), withoutTab(loadTabs(tabsFile()), tab))
  })
  ipcMain.handle('term:submit', (_e, id: string, text: string) => submitTerminal(id, text))
  ipcMain.handle('tabs:restore', (_e, session: string) => restoreTabs(session))
  ipcMain.handle('shell:reveal', (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle('report:url', async (e, file: string, version: number, phase: string | null) => (servable(file, await sessionPaths(projectOf(e))) ? reportUrl(file, version, phase) : null))
  ipcMain.handle('report:open', async (e, file: string) => {
    if (servable(file, await sessionPaths(projectOf(e)))) await shell.openPath(file)
  })
}

/**
 * A window, empty (the welcome screen) or opening `root`. Windows share macOS's tab group, so
 * Window ▸ Merge All Windows turns them into tabs. Closing one stops the terminals of its project
 * that no other window shows; their conversations stay saved and come back with the project.
 */
async function createWindow(root: string | null): Promise<void> {
  const focused = BrowserWindow.getFocusedWindow()
  const [x, y] = focused ? focused.getPosition() : []
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    ...(x !== undefined && y !== undefined ? { x: x + 28, y: y + 28 } : {}),
    title: 'KSS',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#17181b',
    icon: ICON,
    tabbingIdentifier: 'kss',
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), sandbox: false, contextIsolation: true },
  })
  const w: Window = { win, project: null, paths: [], lastSessions: '' }
  const id = win.webContents.id
  windows.set(id, w)
  win.on('closed', () => {
    const paths = w.paths
    windows.delete(id)
    rememberWindows()
    if (quitting) return
    const shown = new Set([...windows.values()].flatMap(o => o.paths))
    for (const t of liveTerminals()) if (paths.includes(t.cwd) && !shown.has(t.cwd)) killTerminal(t.id)
  })
  // The project is set before the page loads, so its first `project:get` already finds it.
  if (root) await openProject(w, root).catch(() => null)
  if (win.isDestroyed()) return
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

/** Asks for a folder and opens it in a new window (or focuses the window that has it). */
async function openInNewWindow() {
  const parent = BrowserWindow.getFocusedWindow()
  const r = parent ? await dialog.showOpenDialog(parent, { properties: ['openDirectory'] }) : await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (!r.canceled && r.filePaths[0]) await createWindow(r.filePaths[0])
}

function menu() {
  const mac = process.platform === 'darwin'
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(mac ? [{ role: 'appMenu' as const }] : []),
      {
        label: 'File',
        submenu: [
          { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => void createWindow(null) },
          { label: 'Open Project in New Window…', accelerator: 'CmdOrCtrl+Shift+O', click: () => void openInNewWindow() },
          {
            label: 'Open Recent',
            submenu: loadPrefs(prefsFile()).recent.length
              ? loadPrefs(prefsFile()).recent.map(root => ({ label: root, click: () => void createWindow(root) }))
              : [{ label: 'No recent projects', enabled: false }],
          },
          { type: 'separator' as const },
          { role: 'close' as const },
        ],
      },
      { role: 'editMenu' as const },
      { role: 'viewMenu' as const },
      { role: 'windowMenu' as const },
    ]),
  )
}

// The report page runs its own script, so it is framed from its own origin, never the app's.
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }])

app.whenReady().then(() => {
  protocol.handle(SCHEME, async req => {
    const file = new URL(req.url).searchParams.get('f') ?? ''
    if (!servable(file, await allPaths())) return new Response('not a session report', { status: 404 })
    try {
      return new Response(readFileSync(file), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
    } catch {
      return new Response('report not found', { status: 404 })
    }
  })
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(ICON)
  handlers()
  menu()
  // The projects open when the app last quit come back, each in its window.
  const roots = loadPrefs(prefsFile()).windows
  if (roots.length) for (const r of roots) void createWindow(r)
  else void createWindow(null)
  timer = setInterval(poll, POLL_MS)
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && void createWindow(null))
})

app.on('before-quit', () => {
  quitting = true
  if (timer) clearInterval(timer)
  live.stop()
  killAll()
})
app.on('window-all-closed', () => {
  killAll()
  if (process.platform !== 'darwin') app.quit()
})
