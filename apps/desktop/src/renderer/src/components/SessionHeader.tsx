import { useEffect, useState } from 'react'

import { optionalOf } from '../../../shared/commands.ts'
import type { Harness, ProjectInfo, Session } from '../../../shared/types.ts'
import type { Run, View } from '../App.tsx'

type Props = {
  project: ProjectInfo
  session: Session
  next: { phase: string; args: string } | null
  harnessFor: (phase: string) => Harness
  onRun: Run
  view: View
  onView: (v: View) => void
}

function HarnessToggle({ value, onChange, project }: { value: Harness; onChange: (h: Harness) => void; project: ProjectInfo }) {
  return (
    <div className="seg">
      <button className={value === 'claude-code' ? 'on' : ''} disabled={!project.harnesses.claude} onClick={() => onChange('claude-code')}>Claude</button>
      <button className={value === 'codex' ? 'on' : ''} disabled={!project.harnesses.codex} onClick={() => onChange('codex')}>Codex</button>
    </div>
  )
}

export function SessionHeader({ project, session, next, harnessFor, onRun, view, onView }: Props) {
  const b = session.board
  const [harness, setHarness] = useState<Harness>(next ? harnessFor(next.phase) : 'claude-code')
  useEffect(() => setHarness(next ? harnessFor(next.phase) : project.harnesses.claude ? 'claude-code' : 'codex'), [next?.phase, session.path])
  const optional = optionalOf(b?.next ?? null)
  // A phase whose Next still names it has not finished: running it again resumes it (every
  // skill resumes from the feature folder), it does not start over.
  const isResume = !!next && !!b && !b.isPhaseFinished

  return (
    <header className="session-header">
      <div className="sh-left">
        <div className="sh-title">
          {session.feature ?? session.name}
          {b?.size && <span className="pill">{b.size}</span>}
          {b && <span className="pill dim">{b.phase}{b.harness ? ` · ${b.harness}` : ''}</span>}
        </div>
        <div className="sh-path" title={session.path}>{session.path}</div>
        {session.feature && (
          <div className="seg view-seg">
            <button className={view === 'terminals' ? 'on' : ''} onClick={() => onView('terminals')}>Terminals</button>
            {(b?.phase === 'grill' || b?.nextPhase === 'grill' || view === 'grill') && (
              <button className={view === 'grill' ? 'on' : ''} onClick={() => onView('grill')} title="Answer the grill's questions with a click, with a side chat to ask about each">Grill</button>
            )}
            <button className={view === 'qa' ? 'on' : ''} onClick={() => onView('qa')} title="Blind acceptance test: plan, environment, scenarios, live browser">QA</button>
          </div>
        )}
      </div>
      <div className="sh-actions">
        {next && (
          <div className="next">
            <code title={b?.next ?? ''}>{next.phase} {next.args}</code>
            <HarnessToggle value={harness} onChange={setHarness} project={project} />
            <button className="primary" title={isResume ? 'The phase has not finished: a fresh process resumes it from the feature folder' : 'A fresh process with the Next command — the same as /clear + the command'} onClick={() => onRun({ kind: 'phase', harness, phase: next.phase, args: next.args })}>
              ▶ {isResume ? 'Resume' : 'Run'} {next.phase}
            </button>
            {optional && (
              <button onClick={() => onRun({ kind: 'phase', harness, phase: optional.phase, args: optional.args })} title="Optional phase the track offers first">
                {optional.phase}
              </button>
            )}
          </div>
        )}
        <div className="tools">
          <button disabled={!project.harnesses.claude} onClick={() => onRun({ kind: 'chat', harness: 'claude-code' })}>Claude chat</button>
          <button disabled={!project.harnesses.codex} onClick={() => onRun({ kind: 'chat', harness: 'codex' })}>Codex chat</button>
          <button onClick={() => onRun({ kind: 'shell' })}>Terminal</button>
          {b && <button onClick={() => onRun({ kind: 'phase', harness, phase: 'status', args: session.feature ?? '' })}>status</button>}
        </div>
      </div>
    </header>
  )
}
