// Every conversation this feature used (DESIGN.md §24.9), as a timeline: each phase run, each
// round the review loop cleared, each chat — read from the harnesses' transcripts, so it lists
// what ran outside the app too. Any of them reopens in its conversation.

import { useEffect, useRef, useState } from 'react'

import type { ConversationRow, Harness, Session, TerminalInfo } from '../../../shared/types.ts'
import { api } from '../api.ts'
import { label } from '../../../shared/commands.ts'

const POLL_MS = 5000

const END_LABEL: Record<string, string> = {
  finished: 'phase finished',
  idle: 'closed idle',
  cleared: 'cleared for the next run',
  restarted: 'restarted',
  closed: 'closed by you',
  exited: 'ended',
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const day = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })

function duration(from: string, to: string): string {
  const m = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60_000))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

type Open = (c: { id: string; kind: 'phase' | 'chat'; harness: Harness; phase: string | null; args: string | null; title: string | null }) => void

export function SessionsPanel({ session, terms, visible, onOpen }: { session: Session; terms: TerminalInfo[]; visible: boolean; onOpen: Open }) {
  const [rows, setRows] = useState<ConversationRow[] | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const scrolled = useRef(false)

  useEffect(() => {
    if (!visible) return
    let alive = true
    const load = () => void api.history(session.path).then(r => alive && setRows(r), () => alive && setRows([]))
    load()
    const t = setInterval(load, POLL_MS)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [visible, session.path, terms.length])

  useEffect(() => {
    scrolled.current = false
  }, [session.path])
  useEffect(() => {
    if (!rows?.length || scrolled.current) return
    scrolled.current = true
    end.current?.scrollIntoView({ block: 'end' })
  }, [rows])

  if (!visible) return null
  if (!rows) return <div className="empty"><p>Reading the transcripts…</p></div>
  if (!rows.length) return <div className="empty"><h2>No conversations yet</h2><p>Every Claude and Codex conversation run in this worktree shows here, as a timeline.</p></div>

  let lastDay = ''
  return (
    <div className="sessions-view">
      <div className="sv-head">
        <b>{rows.length} conversations</b>
        <span className="dim"> in {session.path.split('/').pop()} · oldest first · a cleared round, a finished phase or an idle chat reopens in its own conversation</span>
      </div>
      <ol className="timeline">
        {rows.map(r => {
          const d = day(r.startedAt)
          const header = d !== lastDay ? ((lastDay = d), <li key={`d-${d}`} className="tl-day">{d}</li>) : null
          const live = !!r.liveTerminal
          return [
            header,
            <li key={r.id} className={`tl-row ${live ? 'live' : ''}`}>
              <span className="tl-dot" />
              <div className="tl-when">
                <span>{time(r.startedAt)}–{time(r.lastAt)}</span>
                <span className="dim">{duration(r.startedAt, r.lastAt)}</span>
              </div>
              <div className="tl-what">
                <div className="tl-title">
                  <span className={`phase ${r.kind}`}>{r.kind === 'phase' ? r.phase ?? 'phase' : 'chat'}</span>
                  <span className="dim">{label(r.harness)}</span>
                  <span className={`tl-end ${live ? 'live' : r.end ?? ''}`}>{live ? '● running' : END_LABEL[r.end ?? 'exited']}</span>
                </div>
                <code className="tl-prompt" title={r.prompt ?? ''}>{r.title && r.kind === 'chat' ? r.title : r.prompt ?? '—'}</code>
                <span className="tl-id dim" title="conversation id">{r.id}</span>
              </div>
              <button className={live ? '' : 'primary'} onClick={() => onOpen({ id: r.id, kind: r.kind, harness: r.harness, phase: r.phase, args: r.args, title: r.title })}>
                {live ? 'Show' : '↺ Open'}
              </button>
            </li>,
          ]
        })}
      </ol>
      <div ref={end} />
    </div>
  )
}
