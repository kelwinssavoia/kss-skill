// The grill answered in the app (DESIGN.md §24.7): kss-grill, started with `--app`, publishes each
// question in `.kss/current`; a click types the chosen option into the grill's own terminal, and a
// read-only side chat below answers questions about it without touching the grill's conversation.

import { useEffect, useRef, useState } from 'react'

import type { Harness, KssBoard, ProjectInfo, Session, TerminalInfo } from '../../../shared/types.ts'
import type { Run } from '../App.tsx'
import { api } from '../api.ts'
import { exitCode, onAnyExit } from '../terminals.ts'
import { Pane } from './TerminalTabs.tsx'

export const SIDE_TITLE = 'Grill · ask'

const CATEGORY: Record<string, string> = { business: 'biz', layout: 'layout', technical: 'tech' }

/** The side chat's briefing: where the question lives, what to read, and that it never answers the grill. */
export function sidePrompt(feature: string, featuresRoot: string | null): string {
  const dir = `${featuresRoot ?? 'specs'}/${feature}`
  return [
    `I am answering the KSS grill for feature ${feature} in this repository, in another window. Help me decide.`,
    'The question I am looking at is always `grill.question` in `.kss/current` (JSON) — read that file again before every answer, it changes as the grill moves on.',
    `Context: the open items in the "## Decisions" section of ${dir}/01-investigation.md, ${dir}/auto-decisions.md, ${dir}/00-brief.md, CONTEXT.md and the code itself.`,
    'Explain options and their consequences, look things up in the code when it helps. Do not edit any file and do not answer the grill for me.',
    'Reply in the language I write in. Start by reading the current question and summarising, in a few lines, what each option implies.',
  ].join(' ')
}

type Props = { project: ProjectInfo; session: Session; board: KssBoard | null; terms: TerminalInfo[]; onRun: Run; harness: Harness; visible: boolean }

export function GrillPanel({ project, session, board, terms, onRun, harness, visible }: Props) {
  const grill = board?.phase === 'grill' ? board.grill : null
  const q = grill?.question ?? null
  const qKey = q ? `${q.n}|${q.text}` : null
  const grillTerms = terms.filter(t => t.kind === 'phase' && t.phase === 'grill')
  const term = [...grillTerms].reverse().find(t => exitCode(t.id) === null) ?? grillTerms[grillTerms.length - 1] ?? null
  const isLive = !!term && exitCode(term.id) === null
  const side = [...terms].reverse().find(t => t.title.startsWith(SIDE_TITLE)) ?? null
  const [sent, setSent] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [showTerm, setShowTerm] = useState(false)
  const opened = useRef(new Set<string>())
  const [, tick] = useState(0)
  useEffect(() => onAnyExit(() => tick(n => n + 1)), [])

  useEffect(() => setText(''), [qKey])

  // The side chat opens with the grill, once per session; closing it is the user's choice.
  useEffect(() => {
    if (!visible || !isLive || side || !session.feature || opened.current.has(session.path)) return
    opened.current.add(session.path)
    void onRun({ kind: 'chat', harness, readonly: true, title: SIDE_TITLE, prompt: sidePrompt(session.feature, project.featuresRoot) }, session.path, { focus: false })
  }, [visible, isLive, side, session.path])

  if (!visible) return null

  const answer = async (value: string) => {
    if (!term || !qKey || !value.trim()) return
    setSent(qKey)
    try {
      await api.submit(term.id, value)
    } catch {
      setSent(null)
    }
  }
  const waiting = sent !== null && sent === qKey
  // Asked past the first question with nothing published: a kss-grill from before app mode.
  const isOldSkill = isLive && !q && !!grill && grill.asked > 0
  const terminalShown = showTerm || isOldSkill || (isLive && !q)

  return (
    <div className="grill">
      <div className="grill-top">
        <div className="grill-progress">
          <b>Grill</b>
          {grill ? <span>Q{grill.asked}/{grill.total}{grill.deferred ? ` · ${grill.deferred} deferred` : ''}</span> : <span className="dim">{board?.phase === 'grill' ? 'building the queue…' : 'not running'}</span>}
          {grill && (['business', 'layout', 'technical'] as const).map(c => grill[c] && <span key={c} className="dim">{CATEGORY[c]} {grill[c]!.done}/{grill[c]!.total}</span>)}
          <span className="spacer" />
          {term && <button onClick={() => setShowTerm(s => !s)} disabled={isOldSkill}>{terminalShown ? 'Hide' : 'Show'} grill terminal</button>}
          {!isLive && session.feature && <button className="primary" onClick={() => onRun({ kind: 'phase', harness, phase: 'grill', args: session.feature! })}>▶ {term ? 'Resume' : 'Run'} grill</button>}
        </div>

        {isOldSkill && <p className="warn-line">This project's <code>kss-grill</code> predates answering in the app — answer in the terminal below, and update the KSS plugin to get the panel.</p>}

        {q && isLive && (
          <div className={`grill-card ${waiting ? 'waiting' : ''}`}>
            <div className="grill-head">
              <span className="pill">Q{q.n}{q.category ? ` · ${CATEGORY[q.category] ?? q.category}` : ''}</span>
              {q.source && <span className="dim small">from {q.source}</span>}
            </div>
            <div className="grill-q">{q.text}</div>
            {q.options.length > 0 && (
              <div className="grill-options">
                {q.options.map(o => (
                  <button key={o.key} className={`grill-opt ${o.lean ? 'lean' : ''}`} disabled={waiting} onClick={() => answer(`${o.key}) ${o.label}`)}>
                    <span className="grill-key">{o.key}</span>
                    <span className="grill-opt-text">
                      <span className="grill-label">{o.label}{o.lean && <span className="lean-tag">lean</span>}</span>
                      {o.description && <span className="grill-desc">{o.description}</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="grill-free">
              <textarea
                value={text}
                disabled={waiting}
                placeholder={q.options.length ? 'Something else — type your answer (Enter sends)' : 'Your answer (Enter sends)'}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), void answer(text))
                }}
              />
              <button className="primary" disabled={waiting || !text.trim()} onClick={() => answer(text)}>Send</button>
            </div>
            {waiting && <div className="dim small">Sent — waiting for the next question…</div>}
          </div>
        )}
        {isLive && !q && !isOldSkill && <p className="dim">Waiting for the first question…</p>}
        {!isLive && board?.phase !== 'grill' && <p className="dim">The grill asks every open decision, one at a time; answer here with a click.</p>}
      </div>

      {term && <div className="grill-term" style={{ display: terminalShown ? 'block' : 'none' }}><Pane key={term.id} id={term.id} visible={visible && terminalShown} className="grill-pane" /></div>}

      <div className="grill-side">
        <div className="grill-side-head">
          <b>Ask about this question</b>
          <span className="dim small">read-only chat — it sees the current question, never answers the grill</span>
          <span className="spacer" />
          {!side && session.feature && <button onClick={() => onRun({ kind: 'chat', harness, readonly: true, title: SIDE_TITLE, prompt: sidePrompt(session.feature!, project.featuresRoot) }, session.path, { focus: false })}>Open chat</button>}
        </div>
        {side ? <Pane key={side.id} id={side.id} visible={visible} className="grill-side-pane" /> : <div className="empty dim">Opens with the grill.</div>}
      </div>
    </div>
  )
}
