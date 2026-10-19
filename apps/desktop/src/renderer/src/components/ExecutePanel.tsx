// The Execute view (DESIGN.md §24.8): a run followed without its terminal — progress, what each
// ticket is for, what its subagent says and does right now, how much it changed, and the
// coordinator's log in plain words. The terminal stays one click away.

import { useEffect, useMemo, useState } from 'react'

import type { ExecOverview, ExecTicket, Harness, Session, TerminalInfo } from '../../../shared/types.ts'
import type { Run } from '../App.tsx'
import { api } from '../api.ts'
import '../graph.css'
import { exitCode, onAnyExit } from '../terminals.ts'
import { Attention } from './Attention.tsx'
import { Pane } from './TerminalTabs.tsx'
import { TicketGraph } from './TicketGraph.tsx'

const POLL_MS = 2500

const STATE_LABEL: Record<string, string> = {
  blocked: 'blocked',
  ready: 'ready',
  running: 'implementing',
  reviewing: 'in review',
  rejected: 'rejected',
  integrated: 'integrated',
}

const ROLE_LABEL: Record<string, string> = { executor: 'executor', reviewer: 'reviewer', integrator: 'integrator' }

export function ago(iso: string | null, now = Date.now()): string {
  const t = Date.parse(iso ?? '')
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, '0')} ago`
}

function elapsed(iso: string | null): string {
  const t = Date.parse(iso ?? '')
  if (!Number.isFinite(t)) return '—'
  const m = Math.max(0, Math.round((Date.now() - t) / 60000))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

const human = (n: number | null) => (!n ? '0' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))

/** An execution log line, as a sentence and a tone: what happened to the ticket. */
export function eventOf(e: { event: string; detail: string }): { text: string; tone: 'ok' | 'bad' | 'run' | 'dim' } {
  const all = `${e.event} ${e.detail}`
  const tone = /fail|reject|error|abort|blocked/i.test(all) ? 'bad' : /integrat|approve|pass|merged/i.test(all) ? 'ok' : /spawn|start|resume|retry|back to/i.test(all) ? 'run' : 'dim'
  const verb: Record<string, string> = { spawn: 'started', report: 'reported', verdict: 'review verdict', integrate: 'integrated', reject: 'rejected', escalate: 'escalated', dispatch: 'dispatched' }
  return { text: `${verb[e.event] ?? e.event}${e.detail ? ` — ${e.detail}` : ''}`, tone }
}

function Bar({ value, max }: { value: number; max: number | null }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0
  return <span className={`xbar ${max && value > max ? 'over' : ''}`}><i style={{ width: `${pct}%` }} /></span>
}

/** `compact`: above the graph, only who is on it and what it says, so the active work stays in view. */
function TicketCard({ t, selected, onSelect, compact = false }: { t: ExecTicket; selected: boolean; onSelect: () => void; compact?: boolean }) {
  const a = t.agent
  const last = t.events[t.events.length - 1]
  const ev = last ? eventOf(last) : null
  if (compact)
    return (
      <div className={`xcard compact ${t.state} ${selected ? 'on' : ''}`} onClick={onSelect}>
        <div className="xcard-head">
          <span className="xid">{t.id}</span>
          <span className="xtitle">{t.title ?? '—'}</span>
          <span className={`xstate ${t.state}`}>{STATE_LABEL[t.state] ?? t.state}</span>
        </div>
        {a && (
          <div className="xmeta">
            <span>{ROLE_LABEL[a.role]}</span>
            <span>{a.turns}{t.est ? `/${t.est}` : ''} turns</span>
            <Bar value={a.turns} max={t.est} />
            {a.updatedAt && <span className="dim">{ago(a.updatedAt)}</span>}
          </div>
        )}
        {(a?.saying || a?.doing) && <div className="xsay">{a.saying ? `“${a.saying}”` : <span className="xdo">{a.doing}</span>}</div>}
      </div>
    )
  return (
    <div className={`xcard ${t.state} ${selected ? 'on' : ''}`} onClick={onSelect}>
      <div className="xcard-head">
        <span className="xid">{t.id}</span>
        <span className="xtitle">{t.title ?? '—'}</span>
        <span className={`xstate ${t.state}`}>{STATE_LABEL[t.state] ?? t.state}</span>
      </div>
      {t.goal && <div className="xgoal">{t.goal}</div>}
      {a && (
        <>
          <div className="xmeta">
            <span>{ROLE_LABEL[a.role]}</span>
            {t.tier && <span>{t.tier}</span>}
            <span>{a.turns}{t.est ? `/${t.est}` : ''} turns</span>
            <Bar value={a.turns} max={t.est} />
            <span>{human(a.tokens)} tokens</span>
            {a.updatedAt && <span className="dim">{ago(a.updatedAt)}</span>}
          </div>
          {a.saying && <div className="xsay">“{a.saying}”</div>}
          {a.doing && <div className="xdo">{a.doing}</div>}
        </>
      )}
      <div className="xfoot">
        {t.diff && (t.diff.files > 0 || t.diff.uncommitted > 0) ? (
          <span className="xdiff">
            <b className="add">+{t.diff.added}</b> <b className="del">−{t.diff.deleted}</b> · {t.diff.files} file{t.diff.files === 1 ? '' : 's'}
            {t.diff.uncommitted ? ` · ${t.diff.uncommitted} uncommitted` : ''}
          </span>
        ) : (
          <span className="dim">no changes yet</span>
        )}
        {ev && <span className={`xev ${ev.tone}`}>{ev.text}</span>}
      </div>
    </div>
  )
}

function Detail({ t, onInspect }: { t: ExecTicket; onInspect: () => void }) {
  return (
    <div className="xdetail">
      <div className="xdetail-head">
        <span className="xid">{t.id}</span>
        <b>{t.title}</b>
        <span className={`xstate ${t.state}`}>{STATE_LABEL[t.state] ?? t.state}</span>
      </div>
      <div className="dim small-line">
        {t.tier ?? '—'} · est. {t.est ?? '—'} turns{t.blockedBy.length ? ` · after ${t.blockedBy.join(', ')}` : ''}{t.startedAt ? ` · started ${ago(t.startedAt)}` : ''}
      </div>
      <h4>What it implements</h4>
      <p className="xgoal-full">{t.goal ?? '—'}</p>
      <h4>Timeline</h4>
      {t.events.length === 0 && <p className="dim">Nothing yet.</p>}
      <ol className="xtimeline">
        {t.events.map((e, i) => {
          const ev = eventOf(e)
          return (
            <li key={i} className={ev.tone}>
              <span className="dim">{new Date(e.at).toLocaleTimeString()}</span> {ev.text}
            </li>
          )
        })}
      </ol>
      {t.agent && (
        <>
          <h4>{ROLE_LABEL[t.agent.role]} · last steps</h4>
          <div className="xfeed">
            {t.agent.recent.map((e, i) => (
              <div key={i} className={`xfeed-row ${e.kind}`}>
                <span className="dim">{e.at ? new Date(e.at).toLocaleTimeString() : ''}</span>
                <span>{e.kind === 'message' ? `→ ${e.text}` : e.text}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="row">
        <button onClick={onInspect} title="Objective, full diff and the whole transcript">Inspect ticket</button>
      </div>
    </div>
  )
}

type Props = { session: Session; terms: TerminalInfo[]; visible: boolean; onInspect: (id: string) => void; onRun: Run; harnessFor: (phase: string) => Harness; onError: (e: unknown) => void }

export function ExecutePanel({ session, terms, visible, onInspect, onRun, harnessFor, onError }: Props) {
  const [data, setData] = useState<ExecOverview | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [showTerm, setShowTerm] = useState(false)
  const [mode, setMode] = useState<'graph' | 'cards' | null>(null)
  const [, tick] = useState(0)
  useEffect(() => onAnyExit(() => tick(n => n + 1)), [])

  useEffect(() => {
    if (!visible) return
    let alive = true
    let busy = false
    const load = async () => {
      if (busy) return
      busy = true
      try {
        const d = await api.executeOverview(session.path)
        if (alive) setData(d)
      } finally {
        busy = false
      }
    }
    void load()
    const t = setInterval(load, POLL_MS)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [visible, session.path])

  const byId = useMemo(() => new Map((data?.tickets ?? []).map(t => [t.id, t])), [data])
  if (!visible) return null
  if (!data) return <div className="empty dim">Reading the run…</div>

  const active = data.tickets.filter(t => t.state === 'running' || t.state === 'reviewing' || t.state === 'rejected')
  const count = (s: string) => data.tickets.filter(t => t.state === s).length
  const current = byId.get(selected ?? '') ?? active[0] ?? data.tickets.find(t => t.state !== 'integrated') ?? data.tickets[0] ?? null
  const execTerms = terms.filter(t => t.kind === 'phase' && t.phase === 'execute')
  const term = [...execTerms].reverse().find(t => exitCode(t.id) === null) ?? execTerms[execTerms.length - 1] ?? null
  const pct = data.total ? Math.round((data.integrated / data.total) * 100) : 0
  // A single ticket is no graph: cards until the user picks otherwise.
  const graph = (mode ?? (data.tickets.length >= 2 ? 'graph' : 'cards')) === 'graph'

  return (
    <div className="execute">
      <div className="xbar-top">
        <div className="xprogress">
          <b>{data.integrated}/{data.total}</b> integrated
          <span className="xbig"><i style={{ width: `${pct}%` }} /></span>
          <span>{pct}%</span>
        </div>
        <div className="xcounts">
          {(['running', 'reviewing', 'rejected', 'ready', 'blocked'] as const).map(s => count(s) > 0 && <span key={s} className={`xstate ${s}`}>{count(s)} {STATE_LABEL[s]}</span>)}
          <span className="dim">· {elapsed(data.phaseStartedAt)} elapsed · {human(data.tokens)} tokens</span>
        </div>
        <span className="spacer" />
        {term && <button onClick={() => setShowTerm(s => !s)}>{showTerm ? 'Hide' : 'Show'} execute terminal</button>}
      </div>
      {/* A stopped run says why and waits for the person — never just silent (DESIGN.md §26). */}
      {session.board?.phase === 'execute' && (
        <div className="xattention">
          <Attention session={session.path} board={session.board} terms={terms} onError={onError} onShowTerminal={() => setShowTerm(true)}
            onResume={() => onRun({ kind: 'phase', harness: harnessFor('execute'), phase: 'execute', args: session.feature ?? '', replace: true })} />
        </div>
      )}
      {data.last && <div className="xlast"><span className="dim">Latest:</span> {data.last}</div>}
      {data.criticalPath.length > 0 && (
        <div className="xpath">
          <span className="dim">Critical path</span>
          {data.criticalPath.map((id, i) => (
            <span key={id} className="xpath-step">
              {i > 0 && <span className="dim">→</span>}
              <button className={`xchip ${byId.get(id)?.state ?? ''}`} onClick={() => setSelected(id)}>{id}</button>
            </span>
          ))}
        </div>
      )}
      {term && <div className="xterm" style={{ display: showTerm ? 'block' : 'none' }}><Pane key={term.id} id={term.id} visible={visible && showTerm} className="xterm-pane" /></div>}

      <div className="xmain">
        <div className="xleft">
          <div className="xmode">
            <div className="seg">
              <button className={graph ? 'on' : ''} onClick={() => setMode('graph')} title="Tickets as a dependency graph">Graph</button>
              <button className={graph ? '' : 'on'} onClick={() => setMode('cards')} title="Tickets as cards and waves">Cards</button>
            </div>
          </div>
          <h4>Now{active.length ? ` · ${active.length}` : ''}</h4>
          {active.length === 0 && <p className="dim">No ticket is being implemented or reviewed right now.</p>}
          <div className={`xcards ${graph ? 'compact' : ''}`}>
            {active.map(t => <TicketCard key={t.id} t={t} compact={graph} selected={current?.id === t.id} onSelect={() => setSelected(t.id)} />)}
          </div>

          {graph && <TicketGraph tickets={data.tickets} criticalPath={data.criticalPath} selected={current?.id ?? null} onSelect={setSelected} />}

          {!graph && <h4>Plan · by dependency wave</h4>}
          {!graph && <div className="xwaves">
            {data.waves.map((w, i) => (
              <div key={i} className="xwave">
                <span className="dim">wave {i + 1}</span>
                {w.map(id => {
                  const t = byId.get(id)
                  return (
                    <button key={id} className={`xchip ${t?.state ?? ''} ${current?.id === id ? 'on' : ''}`} title={`${t?.title ?? ''} — ${STATE_LABEL[t?.state ?? ''] ?? t?.state}`} onClick={() => setSelected(id)}>
                      {id}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>}

          <h4>Coordinator log</h4>
          <div className="xlog">
            {[...data.log].reverse().slice(0, 40).map((e, i) => {
              const ev = eventOf(e)
              return (
                <div key={i} className={`xlog-row ${ev.tone}`} onClick={() => e.ticket && setSelected(e.ticket)}>
                  <span className="dim">{new Date(e.at).toLocaleTimeString()}</span>
                  <span className="xid">{e.ticket ?? '··'}</span>
                  <span>{ev.text}</span>
                </div>
              )
            })}
          </div>
        </div>
        <div className="xright">{current ? <Detail t={current} onInspect={() => onInspect(current.id)} /> : <p className="dim">No tickets.</p>}</div>
      </div>
    </div>
  )
}
