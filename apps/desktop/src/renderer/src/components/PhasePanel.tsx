// A running phase, followed without its terminal (DESIGN.md §26): where it stands, what it needs
// from the person (answered right here), what the main agent says and does, the subagents it sent
// out, the decisions already answered, and the file it is writing — live. Execute has its own
// view (§24.8); every other phase, the grill included, uses this one.

import { useEffect, useRef, useState } from 'react'

import { phaseStatus, STATUS_LABEL } from '../../../shared/status.ts'
import type { Harness, PhaseOverview, ProjectInfo, Session, TerminalInfo } from '../../../shared/types.ts'
import type { Run } from '../App.tsx'
import { api } from '../api.ts'
import { exitCode, onAnyExit } from '../terminals.ts'
import { ago } from './ExecutePanel.tsx'
import { answeredSince, Attention, phaseTerm } from './Attention.tsx'
import { Markdown } from './Markdown.tsx'
import { Pane } from './TerminalTabs.tsx'

const POLL_MS = 2000
export const SIDE_TITLE = 'Ask about this'

const CATEGORY: Record<string, string> = { business: 'biz', layout: 'layout', technical: 'tech' }

/** The side chat's briefing: where the question lives, what to read, and that it never answers it. */
export function sidePrompt(feature: string, featuresRoot: string | null): string {
  const dir = `${featuresRoot ?? 'specs'}/${feature}`
  return [
    `I am answering a KSS phase for feature ${feature} in this repository, in another window. Help me decide.`,
    'What the phase asks me is `ask` in `.kss/current` (JSON; an approve draft is the file its `draft` names) — read it again before every answer, it changes as the phase moves on.',
    `Context: ${dir}/README.md, 00-brief.md, 01-investigation.md, 02-decisions.md, auto-decisions.md, 03-spec.md and 04-plan.md when they exist, CONTEXT.md and the code itself.`,
    'Explain options and their consequences, look things up in the code when it helps. Do not edit any file and do not answer the phase for me.',
    'Reply in the language I write in. Start by reading the current question and summarising, in a few lines, what each option implies.',
  ].join(' ')
}

const human = (n: number | null | undefined) => (!n ? '0' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))

type Props = {
  project: ProjectInfo
  session: Session
  terms: TerminalInfo[]
  onRun: Run
  harnessFor: (phase: string) => Harness
  launching: boolean
  visible: boolean
  onError: (e: unknown) => void
}

export function PhasePanel({ project, session, terms, onRun, harnessFor, launching, visible, onError }: Props) {
  const b = session.board
  // The phase on screen: the one a live terminal runs here, else the board's.
  const liveTerm = [...terms].reverse().find(t => t.kind === 'phase' && t.phase !== 'execute' && t.phase !== 'status' && exitCode(t.id) === null)
  const phase = liveTerm?.phase ?? b?.phase ?? null
  const term = phaseTerm(terms, phase)
  const live = !!term && exitCode(term.id) === null
  const [data, setData] = useState<PhaseOverview | null>(null)
  const [showTerm, setShowTerm] = useState(false)
  const [showSide, setShowSide] = useState(false)
  const [showFile, setShowFile] = useState(true)
  const side = [...terms].reverse().find(t => t.title.startsWith(SIDE_TITLE) || t.title.startsWith('Grill · ask')) ?? null
  const [, tick] = useState(0)
  useEffect(() => onAnyExit(() => tick(n => n + 1)), [])
  const feedEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!visible || !phase) return
    let alive = true
    let busy = false
    const load = async () => {
      if (busy) return
      busy = true
      try {
        const d = await api.phaseOverview(session.path, phase)
        if (alive) setData(d)
      } catch {
        /* the next poll tries again */
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
  }, [visible, session.path, phase])

  useEffect(() => feedEnd.current?.scrollIntoView({ block: 'nearest' }), [data?.activity?.entries.length])

  if (!visible) return null
  if (!phase || !b) return <div className="empty"><h2>No phase running</h2><p>Run the Next phase from the header — its progress, questions and drafts show here.</p></div>

  const isBoardPhase = b.phase === phase
  const status = phaseStatus({ board: isBoardPhase ? b : null, live, exited: !!term && !live, launching, answered: answeredSince(session.path) })
  const resume = () => onRun({ kind: 'phase', harness: harnessFor(phase), phase, args: session.feature ?? '', replace: true })
  const openSide = () => {
    setShowSide(true)
    if (!side && session.feature) void onRun({ kind: 'chat', harness: harnessFor(phase), readonly: true, title: SIDE_TITLE, prompt: sidePrompt(session.feature, project.featuresRoot) }, session.path, { focus: false })
  }
  const g = phase === 'grill' && isBoardPhase ? b.grill : null
  const p = isBoardPhase ? b.progress : null
  const a = data?.activity
  const saying = a ? [...a.entries].reverse().find(e => e.kind === 'text')?.text ?? null : null
  const answers = b.askLog.filter(e => e.phase === phase && (!b.phaseStartedAt || (e.at ?? '') >= b.phaseStartedAt))

  return (
    <div className="phase-view">
      <div className="pv-top">
        <div className="pv-title">
          <span className="pv-phase">{phase}</span>
          <span className={`status-pill ${status}`}><i />{STATUS_LABEL[status]}</span>
        </div>
        {p && (
          <div className="pv-progress" title={p.label}>
            {p.step && p.total ? <span className="pv-step">step {p.step}/{p.total}</span> : null}
            {p.step && p.total ? <span className="xbig small"><i style={{ width: `${Math.round((p.step / p.total) * 100)}%` }} /></span> : null}
            <span className="pv-label">{p.label}</span>
          </div>
        )}
        <div className="pv-stats dim">
          {isBoardPhase && b.phaseStartedAt && <span>started {ago(b.phaseStartedAt)}</span>}
          {a && <span>{a.turns} turns · {human(a.tokens)} tokens</span>}
          {isBoardPhase && b.ctx ? <span>ctx {human(b.ctx)}</span> : null}
          {isBoardPhase && b.explorers && <span>explorers {b.explorers.returned}/{b.explorers.running + b.explorers.returned}</span>}
        </div>
        <span className="spacer" />
        {term && <button onClick={() => setShowTerm(s => !s)}>{showTerm ? 'Hide' : 'Show'} terminal</button>}
        {!live && session.feature && status !== 'finished' && <button className="primary" onClick={resume}>▶ {term || (isBoardPhase && !b.isPhaseFinished) ? 'Resume' : 'Run'} {phase}</button>}
      </div>

      {term && <div className="pv-term" style={{ display: showTerm ? 'block' : 'none' }}><Pane key={term.id} id={term.id} visible={visible && showTerm} className="pv-term-pane" /></div>}

      <div className="pv-main">
        <div className="pv-left">
          {(isBoardPhase || b.ask?.phase === phase) && <Attention session={session.path} board={b} terms={terms} onResume={resume} onAskAbout={openSide} onError={onError} onShowTerminal={() => setShowTerm(true)} />}
          {status === 'finished' && (
            <div className="pv-done">
              <b>✓ {phase} finished.</b> {b.next ? <>Next: <code>{b.next}</code></> : null}
            </div>
          )}

          {g && (
            <div className="pv-card">
              <h4>Grill · Q{g.asked}/{g.total}{g.deferred ? ` · ${g.deferred} deferred` : ''}</h4>
              <div className="pv-cats">
                {(['business', 'layout', 'technical'] as const).map(c => g[c] && (
                  <div key={c} className="grill-row">
                    <span>{CATEGORY[c]}</span>
                    <div className="mini-bar"><i style={{ width: `${g[c]!.total ? (g[c]!.done / g[c]!.total) * 100 : 0}%` }} /></div>
                    <span>{g[c]!.done}/{g[c]!.total}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pv-card">
            <h4>The agent, now</h4>
            {saying ? <Markdown text={saying} className="pv-saying" /> : <p className="dim">{live ? 'Reading the conversation…' : 'No conversation yet.'}</p>}
            {a && a.entries.length > 0 && (
              <div className="pv-feed">
                {a.entries.slice(-18).map((e, i) => (
                  <div key={i} className={`pv-feed-row ${e.kind}`}>
                    <span className="dim">{e.at ? new Date(e.at).toLocaleTimeString() : ''}</span>
                    <span>{e.kind === 'text' ? e.text.split('\n').find(l => l.trim()) ?? '' : e.kind === 'message' ? `you → ${e.text}` : e.text}</span>
                  </div>
                ))}
                <div ref={feedEnd} />
              </div>
            )}
          </div>

          {data && data.agents.length > 0 && (
            <div className="pv-card">
              <h4>Subagents · {data.agents.length}</h4>
              <div className="pv-agents">
                {data.agents.map(x => (
                  <div key={x.id} className="pv-agent">
                    <div className="pv-agent-head">
                      <b>{x.description ?? x.type ?? x.id}</b>
                      <span className="dim">{x.turns} turns · {human(x.tokens)}</span>
                      {x.updatedAt && <span className="dim">{ago(x.updatedAt)}</span>}
                    </div>
                    {x.doing && <div className="xdo">{x.doing}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {answers.length > 0 && (
            <div className="pv-card">
              <h4>Answered in this phase</h4>
              {answers.map(e => (
                <div key={e.id} className="pv-answer">
                  <span className="dim">{e.at ? new Date(e.at).toLocaleTimeString() : ''}</span>
                  <span><b>{e.title ?? e.id}</b> — {e.answer?.replace(/^(choice|text): /, '')}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={`pv-right ${showFile ? '' : 'folded'}`}>
          <div className="pv-file-head">
            <button className="icon" onClick={() => setShowFile(s => !s)} title={showFile ? 'Fold the file' : 'Show the file being written'}>{showFile ? '›' : '‹'}</button>
            {showFile && <><b>{data?.artifact?.path ?? 'Output'}</b>{data?.artifact && <span className="dim">updated {ago(new Date(data.artifact.updatedAt).toISOString())}</span>}</>}
          </div>
          {showFile && (data?.artifact ? <div className="pv-file"><Markdown text={data.artifact.text} /></div> : <p className="dim pv-file">The phase has not written its file yet.</p>)}
        </div>
      </div>

      {showSide && (
        <div className="pv-side">
          <div className="grill-side-head">
            <b>{SIDE_TITLE}</b>
            <span className="dim small-inline">read-only chat — it sees the current question and the code, never answers for you</span>
            <span className="spacer" />
            <button className="icon" onClick={() => setShowSide(false)}>×</button>
          </div>
          {side ? <Pane key={side.id} id={side.id} visible={visible && showSide} className="grill-side-pane" /> : <div className="empty dim">Opening…</div>}
        </div>
      )}
    </div>
  )
}
