import { NEEDS_YOU, phaseStatus, STATUS_LABEL, type PhaseStatus } from '../../../shared/status.ts'
import type { ProjectInfo, Session, TerminalInfo } from '../../../shared/types.ts'
import { api } from '../api.ts'
import { exitCode } from '../terminals.ts'
import { answeredSince } from './Attention.tsx'
import { Phases } from './Phases.tsx'

type Props = {
  project: ProjectInfo
  sessions: Session[]
  selected: string | null
  terminals: TerminalInfo[]
  launching: Record<string, { phase: string; at: number }>
  onSelect: (path: string) => void
  onNew: () => void
  onRemove: (s: Session) => void
  onSwitch: () => void
  bypass: boolean
  onBypass: (on: boolean) => void
  collapsed: boolean
  onToggle: () => void
}

const Chip = ({ ok, children }: { ok: boolean; children: string }) => <span className={ok ? 'chip ok' : 'chip off'}>{children}</span>

/** Where each session stands, from its board and the terminals running in it. */
export function statusOf(s: Session, terminals: TerminalInfo[], launching: Props['launching']): PhaseStatus | null {
  const b = s.board
  if (!b && !launching[s.path]) return null
  const of = terminals.filter(t => t.cwd === s.path && t.kind === 'phase' && t.phase === (b?.ask?.phase ?? b?.phase))
  const live = of.some(t => exitCode(t.id) === null)
  return phaseStatus({ board: b, live, exited: of.length > 0 && !live, launching: !!launching[s.path], answered: answeredSince(s.path) })
}

/** `012-batch-cutoff` → `012` over `bc`: what fits on the collapsed rail. */
const short = (s: Session) => {
  const name = s.feature ?? s.name
  const m = /^(\d{3})-(.*)$/.exec(name)
  return m ? { top: m[1]!, bottom: m[2]!.split('-').map(w => w[0]).join('').slice(0, 3) } : { top: name.slice(0, 3), bottom: '' }
}

export function Sidebar({ project, sessions, selected, terminals, launching, onSelect, onNew, onRemove, onSwitch, bypass, onBypass, collapsed, onToggle }: Props) {
  if (collapsed)
    return (
      <aside className="sidebar rail">
        <button className="icon rail-toggle" onClick={onToggle} title="Show the sidebar — ⌘B">☰</button>
        <button className="rail-new" onClick={onNew} disabled={!project.hasKss} title="New session">+</button>
        <div className="rail-sessions">
          {sessions.map(s => {
            const st = statusOf(s, terminals, launching)
            const n = short(s)
            return (
              <button key={s.path} className={`rail-item ${s.path === selected ? 'on' : ''}`} onClick={() => onSelect(s.path)} title={`${s.feature ?? s.name}${st ? ` — ${s.board?.phase ?? ''} · ${STATUS_LABEL[st]}` : ''}`}>
                <span className="rail-top">{s.isProject ? '◆' : n.top}</span>
                {!s.isProject && <span className="rail-bottom">{n.bottom}</span>}
                {st && <i className={`sdot ${st}`} />}
              </button>
            )
          })}
        </div>
      </aside>
    )

  const waiting = sessions.filter(s => NEEDS_YOU.has(statusOf(s, terminals, launching) ?? 'idle')).length
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="sidebar-title">
          <button className="project-name" onClick={onSwitch} title={`${project.root}\nClick to open another project in a new window — ⌘⇧O`}>
            {project.name}
          </button>
          <span className="spacer" />
          <button className="icon" onClick={() => void api.newWindow()} title="New window, for another project in parallel — ⌘⇧N">⧉</button>
          <button className="icon" onClick={onToggle} title="Hide the sidebar — ⌘B">⟨</button>
        </div>
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
      {waiting > 0 && <div className="sidebar-alert"><i className="sdot waiting" /> {waiting} session{waiting === 1 ? '' : 's'} waiting for you</div>}
      <div className="sessions">
        {sessions.map(s => {
          const b = s.board
          const running = terminals.filter(t => t.cwd === s.path && exitCode(t.id) === null).length
          const st = statusOf(s, terminals, launching)
          return (
            <div key={s.path} className={`session ${s.path === selected ? 'selected' : ''} ${st && NEEDS_YOU.has(st) ? 'needs-you' : ''}`} onClick={() => onSelect(s.path)}>
              <div className="session-row">
                {st && <i className={`sdot ${st}`} title={STATUS_LABEL[st]} />}
                <span className="session-name">{s.isProject ? '◆ ' : ''}{s.feature ?? s.name}</span>
                {running > 0 && <span className="badge dim-badge" title={`${running} terminal(s) running`}>{running}</span>}
                {!s.isProject && (
                  <button className="icon remove" title="Remove session (git worktree remove)" onClick={e => (e.stopPropagation(), onRemove(s))}>×</button>
                )}
              </div>
              <div className="session-meta">
                {b ? (
                  <>
                    <span className={`smeta-phase ${st ?? ''}`}>{b.ask?.phase ?? b.phase}</span>
                    {st && st !== 'idle' && <span> · {STATUS_LABEL[st]}</span>}
                    {b.progress && st === 'working' && <span className="dim"> · {b.progress.label}</span>}
                  </>
                ) : (
                  s.branch ?? 'detached'
                )}
              </div>
              {b && <Phases board={b} compact />}
              {b && b.phase === 'execute' && b.total ? (
                <div className="mini-bar"><i style={{ width: `${Math.round(((b.integrated ?? 0) / b.total) * 100)}%` }} /></div>
              ) : null}
            </div>
          )
        })}
      </div>
      {project.features.length > 0 && (
        <details className="features">
          <summary>Features on {project.baseBranch} · {project.features.length}</summary>
          {project.features.slice(-12).reverse().map(f => <div key={f} className="feature">{f}</div>)}
        </details>
      )}
    </aside>
  )
}
