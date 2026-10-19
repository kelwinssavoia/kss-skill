import { useEffect, useState } from 'react'

import { finishOf, thenOf } from '../../../shared/board.ts'
import { optionalOf } from '../../../shared/commands.ts'
import { NEEDS_YOU, phaseStatus, STATUS_LABEL } from '../../../shared/status.ts'
import type { Harness, ProjectInfo, Session, TerminalInfo } from '../../../shared/types.ts'
import type { Run, View } from '../App.tsx'
import { exitCode } from '../terminals.ts'
import { answeredSince, phaseTerm } from './Attention.tsx'

type Props = {
  project: ProjectInfo
  session: Session
  next: { phase: string; args: string } | null
  harnessFor: (phase: string) => Harness
  onRun: Run
  view: View
  onView: (v: View) => void
  terms: TerminalInfo[]
  launching: { phase: string; at: number } | null
  boardShown: boolean
  onToggleBoard: (() => void) | null
  sidebarShown: boolean
  onToggleSidebar: () => void
}

function HarnessToggle({ value, onChange, project }: { value: Harness; onChange: (h: Harness) => void; project: ProjectInfo }) {
  return (
    <div className="seg small-seg">
      <button className={value === 'claude-code' ? 'on' : ''} disabled={!project.harnesses.claude} onClick={() => onChange('claude-code')}>Claude</button>
      <button className={value === 'codex' ? 'on' : ''} disabled={!project.harnesses.codex} onClick={() => onChange('codex')}>Codex</button>
    </div>
  )
}

export function SessionHeader({ project, session, next, harnessFor, onRun, view, onView, terms, launching, boardShown, onToggleBoard, sidebarShown, onToggleSidebar }: Props) {
  const b = session.board
  const [harness, setHarness] = useState<Harness>(next ? harnessFor(next.phase) : 'claude-code')
  useEffect(() => setHarness(next ? harnessFor(next.phase) : project.harnesses.claude ? 'claude-code' : 'codex'), [next?.phase, session.path])
  const optional = optionalOf(b?.next ?? null)
  // A loop back (DESIGN.md §3.9): the earlier phase runs, then the one that asked for it.
  const then = thenOf(b?.next ?? null)
  // Review is finished by the user, never by a round (DESIGN.md §3.9).
  const finish = finishOf(b?.next ?? null)
  // A phase whose Next still names it has not finished: running it again resumes it (every
  // skill resumes from the feature folder), it does not start over.
  // Review's Next names review after every round: that is a new round, not a resume.
  const isResume = !!next && !!b && !b.isPhaseFinished && !finishOf(b.next)

  const current = b ? phaseTerm(terms, b.phase) : null
  const currentLive = !!current && exitCode(current.id) === null
  const status = b ? phaseStatus({ board: b, live: currentLive, exited: !!current && !currentLive, launching: launching?.phase === b.phase, answered: answeredSince(session.path) }) : null
  const nextTerm = next ? phaseTerm(terms, next.phase) : null
  const nextLive = !!nextTerm && exitCode(nextTerm.id) === null
  const nextStarting = !!next && launching?.phase === next.phase
  const followView: View = next?.phase === 'execute' ? 'execute' : next?.phase === 'qa' ? 'qa' : 'phase'
  const runNext = (replace = false) => next && onRun({ kind: 'phase', harness, phase: next.phase, args: next.args, replace })

  const tab = (v: View, label: string, title: string, key: number, extra?: React.ReactNode) => (
    <button className={view === v ? 'on' : ''} onClick={() => onView(v)} title={`${title} — ⌘${key}`}>
      {label}
      {extra}
    </button>
  )

  return (
    <header className="session-header">
      <div className="sh-row">
        {!sidebarShown && <button className="icon rail-toggle" onClick={onToggleSidebar} title="Show the sidebar — ⌘B">☰</button>}
        <div className="sh-left">
          <div className="sh-title">
            <span>{session.feature ?? session.name}</span>
            {b?.size && <span className="pill">{b.size}</span>}
            {b && status && (
              <span className={`status-pill ${status}`} title={b.harness ? `${b.phase} · ${b.harness}` : b.phase}>
                <i />
                {b.phase} · {STATUS_LABEL[status]}
              </span>
            )}
          </div>
          <div className="sh-path" title={session.path}>{session.branch ?? 'detached'} · {session.path}</div>
        </div>
        <div className="sh-actions">
          {next && (
            <div className="next">
              <code title={b?.next ?? ''}>{next.phase} {next.args}</code>
              <HarnessToggle value={harness} onChange={setHarness} project={project} />
              {nextStarting ? (
                <button className="primary" disabled><span className="spinner dark" /> Starting {next.phase}…</button>
              ) : nextLive ? (
                <>
                  <button className="primary running" onClick={() => onView(followView)} title="It is running — follow it">● {next.phase} running · open</button>
                  <button className="icon" title={`Restart ${next.phase}: close the running process and start a fresh one`} onClick={() => confirm(`Restart ${next.phase}? The running process is closed; a fresh one resumes from the feature folder.`) && runNext(true)}>⟲</button>
                </>
              ) : (
                <button className="primary" title={isResume ? 'The phase has not finished: a fresh process resumes it from the feature folder' : 'A fresh process with the Next command — the same as /clear + the command'} onClick={() => runNext()}>
                  ▶ {isResume ? 'Resume' : 'Run'} {next.phase}
                </button>
              )}
              {then && <span className="dim" title={`When ${next.phase} ends, the Next line returns to ${then}`}>then {then}</span>}
              {finish && (
                <button
                  title="The reviewers are done: record the end of the review and move the track on"
                  onClick={() => confirm(`Finish the ${finish.phase}? Its Next line moves on along the track; open items are listed first.`) && onRun({ kind: 'phase', harness, phase: finish.phase, args: finish.args })}
                >
                  ✓ Finish {finish.phase}
                </button>
              )}
              {optional && (
                <button onClick={() => onRun({ kind: 'phase', harness, phase: optional.phase, args: optional.args })} title="Optional phase the track offers first">
                  {optional.phase}
                </button>
              )}
            </div>
          )}
          <div className="tools">
            <button className="ghost" disabled={!project.harnesses.claude} onClick={() => onRun({ kind: 'chat', harness: 'claude-code' })} title="A plain Claude Code chat in this worktree">+ Claude</button>
            <button className="ghost" disabled={!project.harnesses.codex} onClick={() => onRun({ kind: 'chat', harness: 'codex' })} title="A plain Codex chat in this worktree">+ Codex</button>
            <button className="ghost" onClick={() => onRun({ kind: 'shell' })} title="A shell in this worktree — ⌘T">+ Terminal</button>
            {b && <button className="ghost" onClick={() => onRun({ kind: 'phase', harness, phase: 'status', args: session.feature ?? '' })}>status</button>}
            {onToggleBoard && <button className={`icon ${boardShown ? 'on' : ''}`} onClick={onToggleBoard} title={`${boardShown ? 'Hide' : 'Show'} the board — ⌥⌘B`}>▥</button>}
          </div>
        </div>
      </div>
      {session.feature && (
        <nav className="view-tabs">
          {tab('terminals', 'Terminals', 'Every terminal and chat of this session', 1)}
          {tab('phase', 'Phase', 'Follow the running phase and answer what it asks', 2, status && NEEDS_YOU.has(status) && b?.phase !== 'execute' ? <span className="tab-alert" /> : null)}
          {(b?.phase === 'execute' || b?.nextPhase === 'execute' || (b?.tickets.length ?? 0) > 0 || view === 'execute') &&
            tab('execute', 'Execute', 'Follow the run: the ticket graph, what each agent is doing', 3, status && NEEDS_YOU.has(status) && b?.phase === 'execute' ? <span className="tab-alert" /> : null)}
          {tab('feature', 'Feature', 'The feature as it stands: product, rules, code, decisions, simulators', 4)}
          {session.report && tab('report', 'Reports', 'What each phase did and every decision, explained', 5)}
          {tab('qa', 'QA', 'Blind acceptance test: plan, environment, scenarios, live browser', 6)}
        </nav>
      )}
    </header>
  )
}
