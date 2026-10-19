// What a phase waits on, answered in the app (DESIGN.md §26): a decision's options, a confirmation,
// a draft to approve or edit before it is written, a stop that needs a way out. The answer goes to
// the inbox and one line into the phase's terminal — the phase reads it as a typed answer.

import { useEffect, useMemo, useState } from 'react'

import type { AskAnswer, KssAsk } from '../../../shared/types.ts'
import { api } from '../api.ts'
import { Markdown } from './Markdown.tsx'

const KIND_LABEL: Record<KssAsk['kind'], string> = { question: 'Decision', confirm: 'Confirm', approve: 'Review the draft', blocked: 'Blocked', handoff: 'Handoff' }
const CATEGORY: Record<string, string> = { business: 'business', layout: 'layout', technical: 'technical' }

type Props = {
  session: string
  ask: KssAsk
  /** The phase's process is running: an answer can reach it. */
  live: boolean
  onResume: () => void
  onAskAbout?: () => void
  onError: (e: unknown) => void
}

export function AskCard({ session, ask, live, onResume, onAskAbout, onError }: Props) {
  const [sent, setSent] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [draft, setDraft] = useState<string | null>(null)
  const [edited, setEdited] = useState<string | null>(null)
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [showText, setShowText] = useState(false)

  useEffect(() => {
    setText('')
    setEdited(null)
    setMode('preview')
    setShowText(false)
    setDraft(null)
    if (ask.draft) void api.draft(session, ask.draft).then(setDraft)
  }, [ask.id, session])

  const waiting = sent === ask.id
  const isEdited = edited !== null && edited !== draft

  const send = async (a: Partial<AskAnswer>) => {
    if (waiting || !live) return
    setSent(ask.id)
    try {
      await api.answer(session, ask, { choice: a.choice ?? null, text: a.text ?? (text.trim() || null), draft: a.draft !== undefined ? a.draft : isEdited ? edited : null })
    } catch (e) {
      setSent(null)
      onError(e)
    }
  }

  // A letter answers a question when nothing is being typed: the grill's rhythm, without the mouse.
  const keys = useMemo(() => new Map(ask.options.map(o => [o.key.toLowerCase(), o])), [ask.options])
  useEffect(() => {
    if (ask.kind !== 'question' && ask.kind !== 'blocked') return
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey || el?.closest('textarea, input, .xterm')) return
      const o = keys.get(e.key.toLowerCase())
      if (o) (e.preventDefault(), void send({ choice: { key: o.key, label: o.label } }))
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  })

  const options = ask.options
  const confirmOptions = options.length ? options : null

  return (
    <div className={`ask-card ${ask.kind} ${waiting ? 'sent' : ''}`}>
      <div className="ask-head">
        <span className={`ask-kind ${ask.kind}`}>{KIND_LABEL[ask.kind]}</span>
        {ask.category && <span className="pill dim">{CATEGORY[ask.category] ?? ask.category}</span>}
        {ask.source && <span className="dim small-inline">from {ask.source}</span>}
        <span className="spacer" />
        {onAskAbout && ask.kind !== 'handoff' && <button className="ghost" onClick={onAskAbout} title="A read-only chat that sees this question and the code — it never answers for you">Ask about this</button>}
      </div>
      <div className="ask-title">{ask.title}</div>
      {ask.text && <Markdown text={ask.text} className="ask-text" />}

      {ask.kind === 'handoff' && ask.run && ask.then && (
        <div className="handoff-line">
          <span className="xchip running">{ask.run.phase}</span>
          <span className="dim">runs first, then the app returns to</span>
          <span className="xchip">{ask.then.phase}</span>
        </div>
      )}

      {ask.kind === 'approve' && (
        <div className="draft">
          <div className="draft-bar">
            <div className="seg">
              <button className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')}>Preview</button>
              <button className={mode === 'edit' ? 'on' : ''} onClick={() => (setMode('edit'), setEdited(e => e ?? draft ?? ''))}>Edit</button>
            </div>
            {isEdited && <span className="pill">edited</span>}
            {isEdited && <button className="ghost" onClick={() => setEdited(null)}>Discard edits</button>}
            <span className="spacer" />
            {ask.draftSource && <span className="dim small-inline">{ask.draftSource}</span>}
          </div>
          {draft === null ? (
            <div className="dim draft-empty">Reading the draft…</div>
          ) : mode === 'edit' ? (
            <textarea className="draft-edit" spellCheck={false} value={edited ?? draft} onChange={e => setEdited(e.target.value)} />
          ) : (
            <div className="draft-view"><Markdown text={edited ?? draft} /></div>
          )}
        </div>
      )}

      {(ask.kind === 'question' || ask.kind === 'blocked' || (ask.kind === 'confirm' && confirmOptions)) && options.length > 0 && (
        <div className="ask-options">
          {options.map(o => (
            <button key={o.key} className={`ask-opt ${o.lean ? 'lean' : ''}`} disabled={waiting || !live} onClick={() => send({ choice: { key: o.key, label: o.label } })}>
              <span className="ask-key">{o.key}</span>
              <span className="ask-opt-text">
                <span className="ask-label">{o.label}{o.lean && <span className="lean-tag">recommended</span>}</span>
                {o.description && <span className="ask-desc">{o.description}</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      {ask.kind !== 'handoff' && (
        <div className="ask-actions">
          {ask.kind === 'approve' && (
            <>
              <button className="primary" disabled={waiting || !live || draft === null} onClick={() => send({ choice: { key: 'approve', label: isEdited ? 'Approve with my edits' : 'Approve' } })}>
                ✓ {isEdited ? 'Approve with my edits' : 'Approve'}
              </button>
              <button disabled={waiting || !live} onClick={() => setShowText(s => !s)}>Ask for changes…</button>
            </>
          )}
          {ask.kind === 'confirm' && !confirmOptions && (
            <>
              <button className="primary" disabled={waiting || !live} onClick={() => send({ choice: { key: 'yes', label: 'Confirm' } })}>✓ Confirm</button>
              <button disabled={waiting || !live} onClick={() => setShowText(s => !s)}>Change…</button>
            </>
          )}
        </div>
      )}

      {ask.kind !== 'handoff' && (ask.kind === 'question' || ask.kind === 'blocked' || (ask.kind === 'confirm' && confirmOptions) || showText) && (
        <div className="ask-free">
          <textarea
            value={text}
            disabled={waiting || !live}
            placeholder={ask.kind === 'approve' ? 'What should change? (Enter sends)' : ask.kind === 'confirm' ? 'What to change (Enter sends)' : options.length ? 'Something else — your own answer (Enter sends)' : 'Your answer (Enter sends)'}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && text.trim()) (e.preventDefault(), void send({ choice: ask.kind === 'approve' ? { key: 'changes', label: 'Ask for changes' } : null, text: text.trim() }))
            }}
          />
          <button className="primary" disabled={waiting || !live || !text.trim()} onClick={() => send({ choice: ask.kind === 'approve' ? { key: 'changes', label: 'Ask for changes' } : null, text: text.trim() })}>Send</button>
        </div>
      )}

      {!live && ask.kind !== 'handoff' && (
        <div className="ask-dead">
          The {ask.phase ?? 'phase'} process is not running, so the answer cannot reach it. <button className="primary" onClick={onResume}>▶ Resume {ask.phase}</button>
        </div>
      )}
      {waiting && <div className="ask-sent"><span className="spinner" /> Sent — the phase is reading your answer…</div>}
      {(ask.kind === 'question' || ask.kind === 'blocked') && options.length > 0 && !waiting && live && <div className="dim small-inline">Tip: press the option's letter.</div>}
    </div>
  )
}
