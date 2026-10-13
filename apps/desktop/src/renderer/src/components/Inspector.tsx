import { useEffect, useState } from 'react'

import type { KssBoard, TicketActivity, TicketInspection } from '../../../shared/types.ts'
import { api } from '../api.ts'

type Tab = 'objective' | 'changes' | 'activity'

function Diff({ text }: { text: string }) {
  if (!text.trim()) return <p className="dim">Nothing.</p>
  return (
    <pre className="diff">
      {text.split('\n').map((l, i) => {
        const cls = l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') ? 'file' : l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''
        return <div key={i} className={cls}>{l || ' '}</div>
      })}
    </pre>
  )
}

function Md({ text }: { text: string | null }) {
  return text ? <pre className="md">{text}</pre> : <p className="dim">—</p>
}

function Activity({ a, index }: { a: TicketActivity; index: number }) {
  const prompt = a.entries.find(e => e.kind === 'prompt')
  const rest = a.entries.filter(e => e !== prompt)
  const lastText = [...rest].reverse().find(e => e.kind === 'text')
  return (
    <div className="activity">
      <div className="activity-head">
        <b>{index === 0 ? 'Latest subagent' : 'Earlier subagent'}</b>
        <span className="dim">{a.format ?? '?'} · {a.model ?? '—'} · {a.turns} turns · {Math.round(a.tokens / 1000)}k tokens · {a.updatedAt ? new Date(a.updatedAt).toLocaleTimeString() : '—'}</span>
      </div>
      {lastText && (
        <div className="summary">
          <h5>What it says it is doing</h5>
          <p>{lastText.text}</p>
        </div>
      )}
      {prompt && (
        <details>
          <summary>Brief</summary>
          <pre className="md">{prompt.text}</pre>
        </details>
      )}
      <div className="feed">
        {rest.slice(-200).map((e, i) => (
          <div key={i} className={`feed-row ${e.kind}`}>
            <span className="dim">{e.at ? new Date(e.at).toLocaleTimeString() : ''}</span>
            <span>{e.text}</span>
          </div>
        ))}
      </div>
      <div className="dim small">{a.transcript}</div>
    </div>
  )
}

export function Inspector({ session, feature, ticket, board, onClose }: { session: string; feature: string; ticket: string; board: KssBoard | null; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('objective')
  const [data, setData] = useState<TicketInspection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const row = board?.tickets.find(t => t.id === ticket)

  useEffect(() => {
    let alive = true
    const load = () =>
      api.inspect(session, feature, ticket).then(d => alive && (setData(d), setError(null)), e => alive && setError(String(e)))
    void load()
    // Refresh while the ticket's subagent may still be working.
    const t = setInterval(load, 3000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [session, feature, ticket])

  const o = data?.objective
  const c = data?.changes
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="inspector" onClick={e => e.stopPropagation()}>
        <header>
          <div>
            <h2>{ticket} · {o?.title?.replace(/^\d{2}\s*·\s*/, '') ?? row?.title ?? 'ticket'}</h2>
            <div className="dim">{row ? `${row.state} · ${row.tier ?? '—'} · ${row.turns ?? '—'}/${row.est ?? '—'} turns` : ''}</div>
          </div>
          <nav className="seg">
            {(['objective', 'changes', 'activity'] as Tab[]).map(t => (
              <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t}{t === 'changes' && c?.commits.length ? ` (${c.commits.length})` : ''}{t === 'activity' && data?.activity.length ? ` (${data.activity.length})` : ''}
              </button>
            ))}
          </nav>
          <button className="icon big" onClick={onClose}>×</button>
        </header>
        <div className="inspector-body">
          {error && <p className="error">{error}</p>}
          {!data && !error && <p className="dim">Loading…</p>}
          {data && tab === 'objective' && (
            <>
              {o?.header && <pre className="md header">{o.header}</pre>}
              <h4>Goal</h4><Md text={o?.goal ?? null} />
              <h4>Requirements covered</h4><Md text={o?.requirements ?? null} />
              <h4>Files</h4><Md text={o?.files ?? null} />
              <h4>Tests</h4><Md text={o?.tests ?? null} />
              <h4>Execution log</h4>
              {o?.log.length ? o.log.map((l, i) => <div key={i} className="log-row"><span className="dim">{l.at}</span> {l.event} {l.detail && <span className="dim">· {l.detail}</span>}</div>) : <p className="dim">No events yet.</p>}
              <div className="dim small">{o?.file ?? 'ticket file not found'}</div>
            </>
          )}
          {data && tab === 'changes' && c && (
            <>
              {!c.exists ? (
                <p className="dim">The worktree <code>{c.worktree}</code> is gone — the ticket was integrated (or not started); its commits are on the feature branch.</p>
              ) : (
                <>
                  <div className="dim small">{c.worktree} · against {c.base ?? '—'}</div>
                  <h4>Commits</h4>
                  {c.commits.length ? c.commits.map(k => <div key={k.sha} className="commit"><code>{k.sha}</code> {k.subject}</div>) : <p className="dim">None yet.</p>}
                  {c.stat && <pre className="md">{c.stat}</pre>}
                  <h4>Uncommitted</h4><Diff text={c.uncommitted} />
                  <h4>Committed diff</h4><Diff text={c.diff} />
                </>
              )}
            </>
          )}
          {data && tab === 'activity' && (data.activity.length ? data.activity.map((a, i) => <Activity key={a.transcript ?? i} a={a} index={i} />) : <p className="dim">No transcript found for this ticket's worktree yet.</p>)}
        </div>
      </div>
    </div>
  )
}
