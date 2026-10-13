import { useState } from 'react'

import type { Harness, ProjectInfo } from '../../../shared/types.ts'

export function NewSession({ project, onCancel, onCreate }: { project: ProjectInfo; onCancel: () => void; onCreate: (request: string, h: Harness) => void }) {
  const [text, setText] = useState('')
  const [harness, setHarness] = useState<Harness>(project.harnesses.claude ? 'claude-code' : 'codex')
  const [busy, setBusy] = useState(false)
  const submit = () => {
    if (!text.trim() || busy) return
    setBusy(true)
    onCreate(text.trim(), harness)
  }
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>New session</h2>
        <p className="dim">
          A worktree in <code>{project.sessionsDir}</code>, detached at <code>{project.baseBranch}</code>, that starts with{' '}
          <code>kss-clarify</code>. Clarify then creates the feature branch.
        </p>
        <textarea autoFocus value={text} onChange={e => setText(e.target.value)} placeholder="What should be built or fixed? Free text, a path or a URL."
          onKeyDown={e => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && submit()} />
        <div className="row">
          <div className="seg">
            <button className={harness === 'claude-code' ? 'on' : ''} disabled={!project.harnesses.claude} onClick={() => setHarness('claude-code')}>Claude</button>
            <button className={harness === 'codex' ? 'on' : ''} disabled={!project.harnesses.codex} onClick={() => setHarness('codex')}>Codex</button>
          </div>
          <span className="spacer" />
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" disabled={!text.trim() || busy} onClick={submit}>{busy ? 'Creating…' : 'Create & clarify ⌘↵'}</button>
        </div>
      </div>
    </div>
  )
}
