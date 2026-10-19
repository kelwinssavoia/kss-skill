// A phase that needed an earlier one first (DESIGN.md §26): the app runs that one, then comes back.
// The banner says so while it happens, and counts down before returning — the person can go now
// or stay where they are.

import { useEffect, useState } from 'react'

export type Flow = {
  askId: string
  run: { phase: string; args: string }
  then: { phase: string; args: string }
  reason: string
  stage: 'running' | 'returning'
  returnAt: number | null
}

export function Handoff({ flow, onNow, onCancel }: { flow: Flow; onNow: () => void; onCancel: () => void }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (flow.stage !== 'returning') return
    const t = setInterval(() => tick(n => n + 1), 250)
    return () => clearInterval(t)
  }, [flow.stage])
  const left = flow.returnAt ? Math.max(0, Math.ceil((flow.returnAt - Date.now()) / 1000)) : 0
  return (
    <div className={`handoff ${flow.stage}`}>
      <span className="handoff-icon">⤴</span>
      {flow.stage === 'running' ? (
        <span>
          <b>{flow.then.phase}</b> needs <b>{flow.run.phase}</b> first — {flow.reason}. Running {flow.run.phase}; when it finishes, the app returns to {flow.then.phase}.
        </span>
      ) : (
        <span>
          <b>{flow.run.phase}</b> finished — returning to <b>{flow.then.phase}</b> in {left}s.
        </span>
      )}
      <span className="spacer" />
      {flow.stage === 'returning' && <button className="primary" onClick={onNow}>Return now</button>}
      <button className="ghost" onClick={onCancel} title="Stay here; run the phase yourself later">{flow.stage === 'running' ? 'Don’t return' : 'Cancel'}</button>
    </div>
  )
}
