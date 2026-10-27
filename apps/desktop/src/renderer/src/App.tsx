import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { parseNext } from '../../shared/commands.ts'
import { loopStep, type ReviewLoop } from '../../shared/loop.ts'
import { phaseStatus } from '../../shared/status.ts'
import type { Harness, Prefs, ProjectInfo, Session, TerminalInfo, TerminalSpec } from '../../shared/types.ts'
import { api } from './api.ts'
import { answeredSince, phaseTerm } from './components/Attention.tsx'
import { Board } from './components/Board.tsx'
import { ExecutePanel } from './components/ExecutePanel.tsx'
import { Handoff, type Flow } from './components/Handoff.tsx'
import { Inspector } from './components/Inspector.tsx'
import { NewSession } from './components/NewSession.tsx'
import { PhasePanel } from './components/PhasePanel.tsx'
import { QaPanel } from './components/QaPanel.tsx'
import { ReportPanel, scenarioPrompt, type Scenario } from './components/ReportPanel.tsx'
import { SessionHeader } from './components/SessionHeader.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { TerminalTabs } from './components/TerminalTabs.tsx'
import { Welcome } from './components/Welcome.tsx'
import { load, save } from './store.ts'
import { dispose, exitCode, onAnyExit } from './terminals.ts'

export type View = 'terminals' | 'phase' | 'execute' | 'feature' | 'report' | 'qa'

export const VIEWS: View[] = ['terminals', 'phase', 'execute', 'feature', 'report', 'qa']

/** `focus: false` opens the terminal without making it the session's active tab. */
export type Run = (spec: Omit<TerminalSpec, 'cwd'>, cwd?: string, opts?: { focus?: boolean }) => Promise<void>

/** A phase the app just started, until it writes `.kss/current` itself. */
type Launch = { phase: string; at: number }
const LAUNCH_MAX_MS = 90_000

/** Where a phase is followed: execute in its own view, the rest in the phase view. */
const viewOf = (phase: string): View => (phase === 'execute' ? 'execute' : phase === 'qa' ? 'qa' : phase === 'status' || phase === 'init' ? 'terminals' : 'phase')

export function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [terms, setTerms] = useState<TerminalInfo[]>([])
  const [active, setActive] = useState<Record<string, string>>({})
  const [isCreating, setCreating] = useState(false)
  const [inspecting, setInspecting] = useState<string | null>(null)
  const [views, setViews] = useState<Record<string, View>>({})
  const [error, setError] = useState<string | null>(null)
  const [reportPhase, setReportPhase] = useState<Record<string, string | null>>({})
  const [launching, setLaunching] = useState<Record<string, Launch>>({})
  const [flows, setFlows] = useState<Record<string, Flow[]>>(() => load('flows', {}))
  // Review loops are not remembered across runs of the app: one left on must not start phases by itself.
  const [loops, setLoops] = useState<Record<string, ReviewLoop>>({})
  const [layout, setLayout] = useState<{ sidebar: boolean; board: boolean }>(() => load('layout', { sidebar: true, board: true }))
  // The report each session had when first seen; a newer one means a phase just finished.
  const seenReports = useRef(new Map<string, number>())
  const [, tick] = useState(0)
  useEffect(() => onAnyExit(() => tick(n => n + 1)), [])

  useEffect(() => save('flows', flows), [flows])
  useEffect(() => save('layout', layout), [layout])

  useEffect(() => {
    void api.prefs().then(setPrefs)
    // The poll only pushes changes, so a reloaded renderer asks for the current list itself.
    void api.project().then(async p => p && (setProject(p), setSessions(await api.sessions())))
    const offInfo = api.onTermInfo(info => setTerms(t => t.map(x => (x.id === info.id ? info : x))))
    const offSessions = api.onSessions(setSessions)
    return () => (offInfo(), offSessions())
  }, [])

  // A session's saved conversations come back the first time it is shown in this run of the app.
  const restored = useRef(new Set<string>())
  useEffect(() => {
    if (!selected || restored.current.has(selected)) return
    restored.current.add(selected)
    void api.restoreTabs(selected).then(list => setTerms(t => [...t, ...list.filter(n => !t.some(x => x.id === n.id))]))
  }, [selected])

  useEffect(() => {
    if (project && !selected) setSelected(project.root)
  }, [project, selected])

  // A phase that finishes writes its report: show the living feature, unless the person is
  // following another view on purpose (a phase view stays — it says the phase finished).
  useEffect(() => {
    for (const s of sessions) {
      const at = s.report?.updatedAt ?? 0
      const seen = seenReports.current.get(s.path)
      seenReports.current.set(s.path, at)
      if (seen === undefined || at <= seen || !s.report) continue
      setReportPhase(p => ({ ...p, [s.path]: s.report!.latest }))
      setViews(v => (v[s.path] === 'phase' || v[s.path] === 'execute' || v[s.path] === 'qa' ? v : { ...v, [s.path]: 'feature' }))
    }
  }, [sessions])

  // A launch is over once the phase wrote itself into `.kss/current`, its process died, or it took too long.
  useEffect(() => {
    const now = Date.now()
    const done = Object.entries(launching).filter(([path, l]) => {
      const b = sessions.find(s => s.path === path)?.board
      const started = Date.parse(b?.phaseStartedAt ?? '')
      const dead = terms.some(t => t.cwd === path && t.kind === 'phase' && t.phase === l.phase && exitCode(t.id) !== null)
      return now - l.at > LAUNCH_MAX_MS || dead || (b?.phase === l.phase && Number.isFinite(started) && started >= l.at - 5000)
    })
    if (done.length) setLaunching(x => Object.fromEntries(Object.entries(x).filter(([p]) => !done.some(([d]) => d === p))))
  }, [sessions, terms, launching])

  const session = sessions.find(s => s.path === selected) ?? null
  const sessionTerms = useMemo(() => terms.filter(t => t.cwd === selected), [terms, selected])

  const fail = useCallback((e: unknown) => setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)), [])

  const open = async (p: Promise<ProjectInfo | null>) => {
    try {
      const info = await p
      if (!info) return
      setProject(info)
      setSelected(info.root)
      setSessions(await api.sessions())
      setPrefs(await api.prefs())
    } catch (e) {
      fail(e)
    }
  }

  const run: Run = useCallback(
    async (spec, cwd, opts) => {
      const where = cwd ?? selected
      if (!where) return
      const isPhase = spec.kind === 'phase' && !!spec.phase
      // The view follows the phase at once, so the click visibly did something.
      if (isPhase) {
        setLaunching(l => ({ ...l, [where]: { phase: spec.phase!, at: Date.now() } }))
        setViews(v => ({ ...v, [where]: viewOf(spec.phase!) }))
      }
      try {
        const info = await api.createTerminal({ ...spec, cwd: where })
        // A phase run again comes back in its own terminal (after a /clear); one it replaced is gone.
        const gone = (x: TerminalInfo) => x.id !== info.id && isPhase && !!spec.replace && x.cwd === where && x.kind === 'phase' && x.phase === spec.phase
        setTerms(t => {
          t.filter(gone).forEach(x => dispose(x.id))
          return [...t.filter(x => x.id !== info.id && !gone(x)), info]
        })
        if (opts?.focus !== false) setActive(a => ({ ...a, [where]: info.id }))
        if (isPhase && spec.harness) {
          await api.setHarness(spec.phase!, spec.harness)
          setPrefs(await api.prefs())
        }
      } catch (e) {
        if (isPhase) setLaunching(l => Object.fromEntries(Object.entries(l).filter(([p]) => p !== where)))
        fail(e)
      }
    },
    [selected, fail],
  )

  const harnessFor = useCallback(
    (phase: string): Harness => prefs?.harnessByPhase[project?.root ?? '']?.[phase] ?? (project?.harnesses.claude ? 'claude-code' : 'codex'),
    [prefs, project],
  )

  // Handoffs (DESIGN.md §26): a phase that needs an earlier one first publishes it; the app runs
  // that one, and when it finishes, starts the waiting phase again. Nested handoffs stack.
  const handled = useRef(new Set<string>())
  useEffect(() => {
    for (const s of sessions) {
      const ask = s.board?.ask
      if (ask?.kind !== 'handoff' || !ask.run || !ask.then || handled.current.has(`${s.path}|${ask.id}`)) continue
      handled.current.add(`${s.path}|${ask.id}`)
      const flow: Flow = { askId: ask.id, run: ask.run, then: ask.then, reason: ask.title, stage: 'running', returnAt: null }
      setFlows(f => ({ ...f, [s.path]: [...(f[s.path] ?? []).filter(x => x.askId !== ask.id), flow] }))
      void api.clearAsk(s.path).then(() => run({ kind: 'phase', harness: harnessFor(ask.run!.phase), phase: ask.run!.phase, args: ask.run!.args, replace: true }, s.path))
    }
    // The phase run first has finished: count down, then return.
    setFlows(f => {
      let changed = false
      const next = { ...f }
      for (const [path, stack] of Object.entries(f)) {
        const top = stack[stack.length - 1]
        const b = sessions.find(s => s.path === path)?.board
        if (top?.stage === 'running' && b?.phase === top.run.phase && b.isPhaseFinished && !b.ask) {
          next[path] = [...stack.slice(0, -1), { ...top, stage: 'returning', returnAt: Date.now() + 5000 }]
          changed = true
        }
      }
      return changed ? next : f
    })
  }, [sessions])

  const returnNow = useCallback(
    (path: string) => {
      const stack = flows[path] ?? []
      const top = stack[stack.length - 1]
      if (!top) return
      setFlows(f => ({ ...f, [path]: (f[path] ?? []).slice(0, -1) }))
      void run({ kind: 'phase', harness: harnessFor(top.then.phase), phase: top.then.phase, args: top.then.args, replace: true }, path)
    },
    [flows, run, harnessFor],
  )
  const cancelFlow = (path: string) => setFlows(f => ({ ...f, [path]: (f[path] ?? []).slice(0, -1) }))

  useEffect(() => {
    const due = Object.entries(flows).flatMap(([path, s]) => (s[s.length - 1]?.stage === 'returning' ? [{ path, at: s[s.length - 1]!.returnAt ?? 0 }] : []))
    if (!due.length) return
    const t = setTimeout(() => due.filter(d => d.at <= Date.now()).forEach(d => returnNow(d.path)), Math.max(0, Math.min(...due.map(d => d.at)) - Date.now()) + 50)
    return () => clearTimeout(t)
  }, [flows, returnNow])

  // The review loop (DESIGN.md §26): each time the board moves, carry its Next line on — execute after
  // a round that opened fix tickets, the next round after an execute — without asking, until the
  // review itself says the reviewer is done, or the person switches it off.
  const looped = useRef(new Map<string, string>())
  useEffect(() => {
    for (const [path, loop] of Object.entries(loops)) {
      if (loop.stopped || launching[path]) continue
      const b = sessions.find(s => s.path === path)?.board ?? null
      const term = b ? phaseTerm(terms.filter(t => t.cwd === path), b.phase) : null
      const live = !!term && exitCode(term.id) === null
      const status = b ? phaseStatus({ board: b, live, exited: !!term && !live, launching: false, answered: answeredSince(path) }) : null
      const step = loopStep(b, loop, { live, working: status === 'working' || status === 'starting' })
      if (!step) continue
      if ('stop' in step) {
        setLoops(l => ({ ...l, [path]: { ...loop, stopped: step.stop } }))
        continue
      }
      // One launch per board state: the same Next is not run twice while the first one starts.
      const key = [step.run.phase, b!.phase, b!.phaseStartedAt, b!.next].join('|')
      if (looped.current.get(path) === key) continue
      looped.current.set(path, key)
      setLoops(l => ({ ...l, [path]: { ...loop, launches: loop.launches + 1 } }))
      void run({ kind: 'phase', harness: harnessFor(step.run.phase), phase: step.run.phase, args: step.run.args, replace: true }, path, { focus: false })
    }
  }, [sessions, terms, loops, launching, run, harnessFor])

  const setLoop = useCallback((path: string, on: boolean) => {
    looped.current.delete(path)
    setLoops(l => {
      const { [path]: _, ...rest } = l
      return on ? { ...rest, [path]: { startedAt: Date.now(), launches: 0, stopped: null } } : rest
    })
  }, [])

  // An edge case tried in the feature's simulator, sent to an agent that checks it against the code.
  const onScenario = useCallback(
    (sc: Scenario) => {
      if (!session) return
      void run({ kind: 'chat', harness: harnessFor('chat'), readonly: true, title: `Scenario · ${sc.title ?? sc.simulator}`, prompt: scenarioPrompt(session.feature ?? session.name, sc) })
      setViews(v => ({ ...v, [session.path]: 'terminals' }))
    },
    [session, run, harnessFor],
  )

  const view: View = (selected && views[selected]) || 'terminals'
  const setView = useCallback((v: View) => selected && setViews(x => ({ ...x, [selected]: v })), [selected])

  // ⌘B the sidebar, ⌥⌘B the board, ⌘1…⌘6 the views.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return
      if (e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setLayout(l => (e.altKey ? { ...l, board: !l.board } : { ...l, sidebar: !l.sidebar }))
      } else if (/^[1-6]$/.test(e.key) && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        setView(VIEWS[Number(e.key) - 1]!)
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [setView])

  const close = async (id: string) => {
    await api.close(id, terms.find(t => t.id === id)?.tab ?? null)
    dispose(id)
    setTerms(t => t.filter(x => x.id !== id))
  }

  const create = async (request: string, harness: Harness) => {
    try {
      const path = await api.createSession(request)
      setSessions(await api.sessions())
      setSelected(path)
      setCreating(false)
      await run({ kind: 'phase', harness, phase: 'clarify', args: request }, path)
    } catch (e) {
      fail(e)
    }
  }

  const remove = async (s: Session) => {
    if (!confirm(`Remove session ${s.name}?\n\nThis runs git worktree remove on\n${s.path}`)) return
    try {
      await api.removeSession(s.path, false)
    } catch (e) {
      if (confirm(`${e instanceof Error ? e.message : e}\n\nForce removal? Uncommitted changes in it are lost.`)) await api.removeSession(s.path, true).catch(fail)
      else return
    }
    terms.filter(t => t.cwd === s.path).forEach(t => dispose(t.id))
    setTerms(t => t.filter(x => x.cwd !== s.path))
    setSelected(project?.root ?? null)
  }

  if (!project) return <Welcome recent={prefs?.recent ?? []} onPick={() => open(api.pickProject())} onOpen={root => open(api.openProject(root))} error={error} />

  const next = parseNext(session?.board?.next ?? null)
  const isLaunching = (phase: string | null) => !!(selected && phase && launching[selected]?.phase === phase)
  const showBoard = !!session?.board && layout.board && view === 'terminals'
  const stack = selected ? flows[selected] ?? [] : []

  return (
    <div className={`shell ${layout.sidebar ? '' : 'no-sidebar'} ${showBoard ? 'with-board' : ''}`}>
      <Sidebar
        project={project}
        sessions={sessions}
        selected={selected}
        onSelect={setSelected}
        onNew={() => setCreating(true)}
        onRemove={remove}
        onSwitch={() => open(api.pickProject())}
        terminals={terms}
        launching={launching}
        bypass={prefs?.bypass ?? true}
        onBypass={async on => (await api.setBypass(on), setPrefs(await api.prefs()))}
        collapsed={!layout.sidebar}
        onToggle={() => setLayout(l => ({ ...l, sidebar: !l.sidebar }))}
      />
      <main className="center">
        {session && (
          <SessionHeader
            project={project}
            session={session}
            harnessFor={harnessFor}
            onRun={run}
            next={next}
            view={view}
            onView={setView}
            terms={sessionTerms}
            launching={selected ? launching[selected] ?? null : null}
            boardShown={layout.board}
            onToggleBoard={session.board ? () => setLayout(l => ({ ...l, board: !l.board })) : null}
            sidebarShown={layout.sidebar}
            onToggleSidebar={() => setLayout(l => ({ ...l, sidebar: !l.sidebar }))}
            loop={loops[session.path] ?? null}
            onLoop={on => setLoop(session.path, on)}
          />
        )}
        {session && stack.length > 0 && <Handoff flow={stack[stack.length - 1]!} onNow={() => returnNow(session.path)} onCancel={() => cancelFlow(session.path)} />}
        <TerminalTabs
          session={selected}
          terms={sessionTerms}
          board={session?.board ?? null}
          active={selected ? active[selected] ?? null : null}
          onActivate={id => selected && setActive(a => ({ ...a, [selected]: id }))}
          onClose={close}
          onNewShell={() => run({ kind: 'shell' })}
          empty={session ? <EmptyTerminals session={session} project={project} onRun={run} harnessFor={harnessFor} /> : null}
          shown={view === 'terminals'}
        />
        {session && <PhasePanel project={project} session={session} terms={sessionTerms} onRun={run} harnessFor={harnessFor} launching={isLaunching(session.board?.phase ?? launching[session.path]?.phase ?? null)} starting={launching[session.path]?.phase ?? null} visible={view === 'phase'} onError={fail} />}
        {session && <ExecutePanel session={session} terms={sessionTerms} visible={view === 'execute'} onInspect={setInspecting} onRun={run} harnessFor={harnessFor} onError={fail} />}
        {session && <QaPanel session={session} terms={sessionTerms} onRun={run} harnessFor={harnessFor} visible={view === 'qa'} />}
        {session && <ReportPanel session={session} phase={view === 'feature' ? 'feature' : reportPhase[session.path] ?? null} visible={view === 'feature' || view === 'report'} mode={view === 'feature' ? 'feature' : 'report'} onScenario={onScenario} />}
      </main>
      {showBoard && session?.board && <Board board={session.board} onInspect={setInspecting} onClose={() => setLayout(l => ({ ...l, board: false }))} />}
      {isCreating && <NewSession project={project} onCancel={() => setCreating(false)} onCreate={create} />}
      {inspecting && session?.feature && (
        <Inspector session={session.path} feature={session.feature} ticket={inspecting} board={session.board} onClose={() => setInspecting(null)} />
      )}
      {error && (
        <div className="toast" onClick={() => setError(null)}>
          {error}
          <span className="toast-close">×</span>
        </div>
      )}
    </div>
  )
}

function EmptyTerminals({ session, project, onRun, harnessFor }: { session: Session; project: ProjectInfo; onRun: Run; harnessFor: (p: string) => Harness }) {
  if (!project.hasKss)
    return (
      <div className="empty">
        <h2>KSS is not set up in this project</h2>
        <p>Run <code>kss-init</code> once: it writes <code>.kss/config.md</code>, the scripts and both harness adapters.</p>
        <div className="row">
          <button className="primary" onClick={() => onRun({ kind: 'phase', phase: 'init', harness: harnessFor('init') })}>Run kss-init</button>
        </div>
      </div>
    )
  return (
    <div className="empty">
      <h2>{session.feature ?? session.name}</h2>
      <p>{session.board?.next ? <>Next: <code>{session.board.next}</code> — run it from the header; its progress and questions show in the phase view.</> : session.isProject ? 'Start a feature in its own session with “New session”, or open a chat or a terminal here.' : 'No terminal open in this session.'}</p>
      <div className="row">
        <button onClick={() => onRun({ kind: 'shell' })}>Open a terminal <kbd>⌘T</kbd></button>
      </div>
    </div>
  )
}
