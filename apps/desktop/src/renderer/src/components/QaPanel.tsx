// The QA panel (DESIGN.md §24.5): one button per qa.mjs step, ▶ per scenario, the driver's browser live,
// and each scenario's recorded steps with their screenshots.

import { useEffect, useState } from 'react'

import type { QaInfo, QaScenario, QaScenarioRun, QaStep, QaStepRecord, Session, TerminalInfo } from '../../../shared/types.ts'
import type { Run } from '../App.tsx'
import { api } from '../api.ts'
import { exitCode } from '../terminals.ts'
import { Pane } from './TerminalTabs.tsx'

const ICON: Record<string, string> = { pass: '✓', fail: '✗', blocked: '⛔', environment: '🧰', inconclusive: '?', info: 'i' }

function Badge({ value }: { value: string | null }) {
  return value ? <span className={`qa-badge ${value}`}>{ICON[value] ?? ''} {value}</span> : <span className="qa-badge none">not run</span>
}

type Zoom = { src: string; path: string | null; caption: string } | null

/**
 * A picture at full size, inside the app. `window.open` of a data: URL gives a blank window —
 * Chromium refuses to navigate a top-level window to one — so screenshots open here instead.
 */
function Lightbox({ zoom, onClose }: { zoom: Zoom; onClose: () => void }) {
  useEffect(() => {
    if (!zoom) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [zoom])
  if (!zoom) return null
  return (
    <div className="lightbox" onClick={onClose}>
      <img src={zoom.src} onClick={e => e.stopPropagation()} />
      <div className="lightbox-bar" onClick={e => e.stopPropagation()}>
        <span>{zoom.caption}</span>
        <span className="spacer" />
        {zoom.path && <button onClick={() => api.reveal(zoom.path!)}>Show in Finder</button>}
        <button onClick={onClose}>Close · Esc</button>
      </div>
    </div>
  )
}

function Shot({ path, caption, onZoom }: { path: string | null; caption: string; onZoom: (z: Zoom) => void }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setSrc(null)
    if (path) void api.qaImage(path).then(d => alive && setSrc(d))
    return () => void (alive = false)
  }, [path])
  if (!path) return <div className="shot empty">no screenshot</div>
  return src ? <img className="shot" src={src} title="Open at full size" onClick={() => onZoom({ src, path, caption })} /> : <div className="shot empty">…</div>
}

function StepCard({ s, onZoom }: { s: QaStepRecord; onZoom: (z: Zoom) => void }) {
  return (
    <div className={`step-card ${s.status}`}>
      <Shot path={s.screenshot} caption={`${String(s.i).padStart(2, '0')} · ${s.title}`} onZoom={onZoom} />
      <div className="step-text">
        <div className="step-title"><b>{String(s.i).padStart(2, '0')}</b> {s.title} <Badge value={s.status} /></div>
        <div><span className="dim">expected</span> {s.expected}</div>
        <div><span className="dim">observed</span> {s.observed}</div>
        {s.url && <div className="dim small">{s.url}</div>}
      </div>
    </div>
  )
}

function ScenarioDetail({ s, run, liveFrame, isLive, onZoom }: { s: QaScenario; run: QaScenarioRun | undefined; liveFrame: string | null; isLive: boolean; onZoom: (z: Zoom) => void }) {
  return (
    <div className="qa-detail">
      <h3>{s.id} · {s.title}</h3>
      <div className="dim">persona {s.persona ?? '—'} · app {s.app ?? '—'} · covers {s.covers.join(', ') || '—'}</div>
      {isLive && (
        <div className="live">
          <div className="live-label"><span className="dot live" /> LIVE · {s.id}</div>
          {liveFrame ? <img src={liveFrame} title="Open at full size" onClick={() => onZoom({ src: liveFrame, path: null, caption: `LIVE · ${s.id}` })} /> : <div className="shot empty">waiting for the driver's browser…</div>}
        </div>
      )}
      <div className="qa-cols">
        <div>
          <h4>Steps</h4>
          <ol>{s.steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
        </div>
        <div>
          <h4>Expected</h4>
          <ul>{s.expected.map((x, i) => <li key={i}><b>E{i + 1}</b> {x}</li>)}</ul>
        </div>
      </div>
      {run && (
        <>
          <h4>Run {run.runId} · driver <Badge value={run.status} /> · final <Badge value={run.final} />{run.turns ? ` · ${run.turns} turns` : ''}{run.cost ? ` · $${run.cost.toFixed(2)}` : ''}</h4>
          {run.summary && <p className="summary-p">{run.summary}</p>}
          {run.note && <p className="dim">{run.note}</p>}
          {run.issues.map((x, i) => <div key={i} className="issue"><b>{x.kind}</b> {x.title}{x.detail && <span className="dim"> · {x.detail}</span>}</div>)}
          {run.steps.length === 0 && <p className="dim">No step recorded yet.</p>}
          {[...run.steps].reverse().map(st => <StepCard key={st.i} s={st} onZoom={onZoom} />)}
        </>
      )}
    </div>
  )
}

type Props = { session: Session; terms: TerminalInfo[]; onRun: Run; visible: boolean }

export function QaPanel({ session, terms, onRun, visible }: Props) {
  const [info, setInfo] = useState<QaInfo | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [frame, setFrame] = useState<{ scenario: string; data: string } | null>(null)
  const [zoom, setZoom] = useState<Zoom>(null)
  const feature = session.feature

  useEffect(() => {
    if (!visible) return
    let alive = true
    const load = () => api.qaInfo(session.path, feature).then(i => alive && setInfo(i))
    void load()
    const t = setInterval(load, 1500)
    void api.qaWatch(session.path)
    const off = api.onQaFrame(f => f.session === session.path && setFrame({ scenario: f.scenario, data: f.data }))
    return () => {
      alive = false
      clearInterval(t)
      off()
      void api.qaWatch(null)
    }
  }, [visible, session.path, feature])

  useEffect(() => {
    if (info?.live) setSelected(info.live.scenario)
    else setFrame(null)
  }, [info?.live?.scenario])

  if (!visible) return null
  if (!feature) return <div className="empty"><h2>QA</h2><p>This session has no feature yet.</p></div>
  if (!info) return <div className="empty dim">Loading…</div>

  const qaTerms = terms.filter(t => t.kind === 'qa')
  const running = qaTerms.filter(t => exitCode(t.id) === null)
  const busy = running.length > 0
  const run = (step: QaStep, extra: { only?: string; force?: boolean } = {}) => onRun({ kind: 'qa', qa: { step, feature, ...extra } })
  const env = info.env
  const isMine = env.state !== 'down' && env.feature === feature
  const scenarios = info.plan?.scenarios ?? []
  const current = scenarios.find(s => s.id === selected) ?? scenarios[0] ?? null
  const lastTerm = qaTerms[qaTerms.length - 1] ?? null

  return (
    <div className="qa">
      <div className="qa-bar">
        <div className="qa-env">
          <span className={`dot ${env.state === 'up' ? 'live' : env.state === 'starting' ? 'warn' : 'dead'}`} />
          {info.heldBy ? <>environment held by <code>{info.heldBy.split('/').pop()}</code></> : env.state === 'down' ? 'environment down' : `environment ${env.state}${env.feature ? ` for ${env.feature}` : ''}`}
          {env.services.length > 0 && <span className="dim"> · {env.services.filter(s => s.alive).length}/{env.services.length} services</span>}
        </div>
        <div className="qa-actions">
          <button disabled={busy || !info.hasConfig} onClick={() => run('plan', { force: !!info.plan })} title="Blind planner: scenarios, personas and seed from the spec">{info.plan ? 'Replan' : '1 · Plan'}</button>
          <button disabled={busy || !info.plan || !!info.heldBy || env.state !== 'down'} onClick={() => run('up')}>2 · Up</button>
          <button disabled={busy || !info.runs.length} onClick={() => run('judge')}>Judge</button>
          <button disabled={busy || !info.runs.length} onClick={() => run('report')}>Report</button>
          <button disabled={busy || env.state === 'down' || !!info.heldBy} onClick={() => run('down')}>Down</button>
          {info.verdict && <span className={`verdict ${info.verdict}`}>{info.verdict}</span>}
        </div>
      </div>
      {!info.hasConfig && <p className="warn-line">No <code>.kss/qa.config.json</code> in this session — <code>kss-qa</code> needs the project adapter (DESIGN.md §22.3).</p>}
      {info.hasConfig && !info.hasLive && <p className="warn-line">This project's <code>.kss/scripts/qa.mjs</code> predates the live view — run <code>kss-init</code> again to update the scripts. Steps and screenshots still work.</p>}
      <div className="qa-main">
        <div className="qa-list">
          <h4>Scenarios{info.plan ? ` · ${scenarios.length}` : ''}</h4>
          {!info.plan && <p className="dim">No plan yet. Plan writes <code>qa/plan.json</code> from the request and the spec only.</p>}
          {scenarios.map(s => {
            const last = info.latest[s.id]
            const isLive = info.live?.scenario === s.id
            return (
              <div key={s.id} className={`qa-scn ${current?.id === s.id ? 'on' : ''}`} onClick={() => setSelected(s.id)}>
                <div className="qa-scn-row">
                  <b>{s.id}</b>
                  <span className="ticket-title">{s.title}</span>
                  <button className="play" disabled={busy || !isMine} title={isMine ? `qa.mjs run --only ${s.id}` : 'Bring the environment up first'} onClick={e => (e.stopPropagation(), setSelected(s.id), run('run', { only: s.id }))}>▶</button>
                </div>
                <div className="qa-scn-row dim">
                  {isLive ? <span className="live-pill">● live</span> : <Badge value={last?.final ?? last?.status ?? null} />}
                  <span>{s.covers.join(' ')}</span>
                </div>
              </div>
            )
          })}
          {info.plan && info.plan.notCovered.length > 0 && (
            <>
              <h4>Not UI-testable</h4>
              {info.plan.notCovered.map(n => <div key={n.fr} className="dim small">{n.fr} · {n.reason ?? ''}</div>)}
            </>
          )}
          {lastTerm && (
            <div className="qa-term">
              <h4>{lastTerm.title}{exitCode(lastTerm.id) !== null ? ` · exit ${exitCode(lastTerm.id)}` : ' · running'}</h4>
              <Pane key={lastTerm.id} id={lastTerm.id} visible className="qa-pane" />
            </div>
          )}
        </div>
        <div className="qa-right">
          {current ? (
            <ScenarioDetail s={current} run={info.latest[current.id]} isLive={info.live?.scenario === current.id} liveFrame={frame?.scenario === current.id ? frame.data : null} onZoom={setZoom} />
          ) : (
            <div className="empty dim">Plan the QA to see its scenarios.</div>
          )}
        </div>
      </div>
      <Lightbox zoom={zoom} onClose={() => setZoom(null)} />
    </div>
  )
}
