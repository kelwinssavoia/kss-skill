// The feature's explained report (DESIGN.md §25), framed from its own origin: report.mjs's page,
// opened on the phase that just finished.

import { useEffect, useState } from 'react'

import type { Session } from '../../../shared/types.ts'
import { api } from '../api.ts'

type Props = { session: Session; phase: string | null; visible: boolean }

export function ReportPanel({ session, phase, visible }: Props) {
  const r = session.report
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!visible || !r) return setUrl(null)
    let alive = true
    void api.reportUrl(r.file, r.updatedAt, phase ?? r.latest).then(u => alive && setUrl(u))
    return () => void (alive = false)
  }, [visible, r?.file, r?.updatedAt, phase])

  if (!visible) return null
  if (!r)
    return (
      <div className="empty">
        <h2>No report yet</h2>
        <p>Each phase writes <code>report/&lt;phase&gt;.json</code> when it ends, and <code>report.mjs</code> turns them into this page.</p>
      </div>
    )
  return (
    <div className="report">
      <div className="report-bar">
        <b>Report</b>
        <span className="dim">{r.phases.length} phase{r.phases.length === 1 ? '' : 's'} explained{r.latest ? ` · latest ${r.latest}` : ''}</span>
        <span className="spacer" />
        <button onClick={() => api.openReport(r.file)} title={r.file}>Open in browser</button>
      </div>
      {url && <iframe key={url} className="report-frame" src={url} sandbox="allow-scripts" title="Report" />}
    </div>
  )
}
