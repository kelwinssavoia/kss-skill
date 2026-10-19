// The feature's page (DESIGN.md §25), framed from its own origin: report.mjs's page, opened on the
// living feature (§25.1) or on the phase that just finished. The page may send back a scenario the
// person tried in a simulator; the app opens a read-only chat to check it against the code.

import { useEffect, useRef, useState } from 'react'

import type { Session } from '../../../shared/types.ts'
import { api } from '../api.ts'

export type Scenario = {
  feature?: string
  simulator: string
  title?: string
  inputs: Record<string, unknown>
  outputs?: Record<string, unknown>
  fired?: string[]
  expected?: Record<string, unknown> | null
  note?: string | null
}

/** A message from the page, checked for shape: it is model-written content, never trusted. */
export function scenarioOf(data: unknown): Scenario | null {
  const d = data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  if (!d || d.type !== 'kss:scenario' || typeof d.simulator !== 'string' || !d.inputs || typeof d.inputs !== 'object') return null
  const rec = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined)
  return {
    simulator: d.simulator.slice(0, 80),
    title: typeof d.title === 'string' ? d.title.slice(0, 120) : undefined,
    inputs: rec(d.inputs)!,
    outputs: rec(d.outputs),
    fired: Array.isArray(d.fired) ? d.fired.filter((x): x is string => typeof x === 'string').slice(0, 20) : undefined,
    expected: rec(d.expected) ?? null,
    note: typeof d.note === 'string' ? d.note.slice(0, 600) : null,
  }
}

export function scenarioPrompt(feature: string, s: Scenario): string {
  const j = (o: unknown) => JSON.stringify(o ?? {}).slice(0, 1200)
  return [
    `Feature ${feature}: I tried a scenario in the "${s.title ?? s.simulator}" simulator of its living feature page (report/feature.json, simulator id ${s.simulator}).`,
    `Inputs: ${j(s.inputs)}. The simulator's rules gave: ${j(s.outputs)}${s.fired?.length ? `, by rule(s) ${s.fired.join(', ')}` : ''}.`,
    s.expected && Object.keys(s.expected).length ? `I expected: ${j(s.expected)}.` : '',
    s.note ? `My note: ${s.note}` : '',
    'Check this case against the code that implements these rules (each rule in feature.json names its file and line) and against 03-spec.md: does the real code do what the simulator says? Is this an edge case the spec or the implementation missed?',
    'Answer with what the code actually does for these inputs, quoting the lines. Do not edit any file. If it is a real gap, say which phase should handle it (a review finding, a fix ticket, or a spec change). Reply in the language I write in — Portuguese if unsure.',
  ].filter(Boolean).join(' ')
}

type Props = { session: Session; phase: string | null; visible: boolean; mode: 'feature' | 'report'; onScenario: (s: Scenario) => void }

export function ReportPanel({ session, phase, visible, mode, onScenario }: Props) {
  const r = session.report
  const [url, setUrl] = useState<string | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    if (!visible || !r) return setUrl(null)
    let alive = true
    void api.reportUrl(r.file, r.updatedAt, phase ?? r.latest).then(u => alive && setUrl(u))
    return () => void (alive = false)
  }, [visible, r?.file, r?.updatedAt, phase])

  useEffect(() => {
    if (!visible) return
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      const s = scenarioOf(e.data)
      if (s) onScenario(s)
    }
    window.addEventListener('message', on)
    return () => window.removeEventListener('message', on)
  }, [visible, onScenario])

  if (!visible) return null
  if (!r)
    return (
      <div className="empty">
        <h2>{mode === 'feature' ? 'The feature takes shape here' : 'No report yet'}</h2>
        <p>
          Each phase updates <code>report/feature.json</code> — product, rules, decisions, the code that implements them, simulators — and explains itself in{' '}
          <code>report/&lt;phase&gt;.json</code>. <code>report.mjs</code> turns them into this page once the first phase ends.
        </p>
      </div>
    )
  return (
    <div className="report">
      <div className="report-bar">
        <b>{mode === 'feature' ? 'Feature' : 'Reports'}</b>
        <span className="dim">{r.phases.length} phase{r.phases.length === 1 ? '' : 's'} explained{r.latest ? ` · latest ${r.latest}` : ''} · updated {new Date(r.updatedAt).toLocaleTimeString()}</span>
        <span className="spacer" />
        <button onClick={() => api.openReport(r.file)} title={r.file}>Open in browser</button>
      </div>
      {/* Its own origin (kss-report://), so same-origin only lets the page keep its saved scenarios. */}
      {url && <iframe ref={frame} key={url} className="report-frame" src={url} sandbox="allow-scripts allow-same-origin" title="Report" />}
    </div>
  )
}
