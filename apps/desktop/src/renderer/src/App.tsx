import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { parseNext } from '../../shared/commands.ts'
import type { Harness, Prefs, ProjectInfo, Session, TerminalInfo, TerminalSpec } from '../../shared/types.ts'
import { api } from './api.ts'
import { Board } from './components/Board.tsx'
import { GrillPanel } from './components/GrillPanel.tsx'
import { Inspector } from './components/Inspector.tsx'
import { NewSession } from './components/NewSession.tsx'
import { QaPanel } from './components/QaPanel.tsx'
import { SessionHeader } from './components/SessionHeader.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { TerminalTabs } from './components/TerminalTabs.tsx'
import { Welcome } from './components/Welcome.tsx'
import { dispose } from './terminals.ts'

export type View = 'terminals' | 'grill' | 'qa'

/** `focus: false` opens the terminal without making it the session's active tab. */
export type Run = (spec: Omit<TerminalSpec, 'cwd'>, cwd?: string, opts?: { focus?: boolean }) => Promise<void>

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

  const session = sessions.find(s => s.path === selected) ?? null
  const sessionTerms = useMemo(() => terms.filter(t => t.cwd === selected), [terms, selected])

  const fail = (e: unknown) => setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))

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
      try {
        const info = await api.createTerminal({ ...spec, cwd: where })
        setTerms(t => [...t, info])
        if (opts?.focus !== false) setActive(a => ({ ...a, [where]: info.id }))
        // The grill is answered in its panel.
        if (spec.kind === 'phase' && spec.phase === 'grill') setViews(v => ({ ...v, [where]: 'grill' }))
        if (spec.kind === 'phase' && spec.phase && spec.harness) {
          await api.setHarness(spec.phase, spec.harness)
          setPrefs(await api.prefs())
        }
      } catch (e) {
        fail(e)
      }
    },
    [selected],
  )

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

  const harnessFor = (phase: string): Harness =>
    prefs?.harnessByPhase[project.root]?.[phase] ?? (project.harnesses.claude ? 'claude-code' : 'codex')

  const next = parseNext(session?.board?.next ?? null)
  const view: View = (selected && views[selected]) || 'terminals'
  const setView = (v: View) => selected && setViews(x => ({ ...x, [selected]: v }))

  return (
    <div className="shell">
      <Sidebar
        project={project}
        sessions={sessions}
        selected={selected}
        onSelect={setSelected}
        onNew={() => setCreating(true)}
        onRemove={remove}
        onSwitch={() => open(api.pickProject())}
        terminals={terms}
        bypass={prefs?.bypass ?? true}
        onBypass={async on => (await api.setBypass(on), setPrefs(await api.prefs()))}
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
          />
        )}
        <TerminalTabs
          terms={sessionTerms}
          active={selected ? active[selected] ?? null : null}
          onActivate={id => selected && setActive(a => ({ ...a, [selected]: id }))}
          onClose={close}
          empty={session ? <EmptyTerminals session={session} project={project} onRun={run} harnessFor={harnessFor} /> : null}
          shown={view === 'terminals'}
        />
        {session && <GrillPanel project={project} session={session} board={session.board} terms={sessionTerms} onRun={run} harness={harnessFor('grill')} visible={view === 'grill'} />}
        {session && <QaPanel session={session} terms={sessionTerms} onRun={run} visible={view === 'qa'} />}
      </main>
      {session?.board && view !== 'qa' && <Board board={session.board} onInspect={setInspecting} />}
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
      <p>{session.board?.next ? <>Next: <code>{session.board.next}</code></> : session.isProject ? 'Start a feature in its own session with “New session”, or open a chat or a terminal here.' : 'No terminal open in this session.'}</p>
    </div>
  )
}
