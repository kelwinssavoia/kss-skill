import type { ProjectInfo, Session, TerminalInfo } from '../../../shared/types.ts'
import { Phases } from './Phases.tsx'

type Props = {
  project: ProjectInfo
  sessions: Session[]
  selected: string | null
  terminals: TerminalInfo[]
  onSelect: (path: string) => void
  onNew: () => void
  onRemove: (s: Session) => void
  onSwitch: () => void
  bypass: boolean
  onBypass: (on: boolean) => void
}

const Chip = ({ ok, children }: { ok: boolean; children: string }) => <span className={ok ? 'chip ok' : 'chip off'}>{children}</span>

export function Sidebar({ project, sessions, selected, terminals, onSelect, onNew, onRemove, onSwitch, bypass, onBypass }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button className="project-name" onClick={onSwitch} title={`${project.root}\nClick to open another project`}>
          {project.name}
        </button>
        <div className="chips">
          <Chip ok={project.hasKss}>kss</Chip>
          <Chip ok={!!project.harnesses.claude}>claude</Chip>
          <Chip ok={!!project.harnesses.codex}>codex</Chip>
          <Chip ok={project.hasQaConfig}>qa</Chip>
        </div>
        <label className="switch" title={bypass ? 'Chats and phases start with --dangerously-skip-permissions (Claude) / --dangerously-bypass-approvals-and-sandbox (Codex). Applies to new terminals.' : 'Chats and phases ask for permissions as usual. Applies to new terminals.'}>
          <input type="checkbox" checked={bypass} onChange={e => onBypass(e.target.checked)} />
          <span className="track"><i /></span>
          <span>Bypass permissions</span>
        </label>
      </div>
      <button className="new-session" onClick={onNew} disabled={!project.hasKss} title={project.hasKss ? 'A new worktree that starts with kss-clarify' : 'Run kss-init first'}>
        + New session
      </button>
      <div className="sessions">
        {sessions.map(s => {
          const b = s.board
          const running = terminals.filter(t => t.cwd === s.path).length
          return (
            <div key={s.path} className={s.path === selected ? 'session selected' : 'session'} onClick={() => onSelect(s.path)}>
              <div className="session-row">
                <span className="session-name">{s.isProject ? '◆ ' : ''}{s.feature ?? s.name}</span>
                {running > 0 && <span className="badge" title={`${running} terminal(s) open`}>{running}</span>}
                {!s.isProject && (
                  <button className="icon" title="Remove session (git worktree remove)" onClick={e => (e.stopPropagation(), onRemove(s))}>×</button>
                )}
              </div>
              <div className="session-meta">{s.branch ?? 'detached'}{b ? ` · ${b.phase}${b.isPhaseFinished && !b.isClosed ? ' ✓' : ''}` : ''}</div>
              {b && <Phases board={b} compact />}
              {b && b.phase === 'execute' && b.total ? (
                <div className="mini-bar"><i style={{ width: `${Math.round(((b.integrated ?? 0) / b.total) * 100)}%` }} /></div>
              ) : null}
            </div>
          )
        })}
      </div>
      {project.features.length > 0 && (
        <div className="features">
          <h4>Features on {project.baseBranch}</h4>
          {project.features.slice(-12).reverse().map(f => <div key={f} className="feature">{f}</div>)}
        </div>
      )}
    </aside>
  )
}
