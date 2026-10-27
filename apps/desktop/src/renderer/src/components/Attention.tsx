// Whatever a phase needs from the person right now, in one place (DESIGN.md §26): the ask it
// published, or — when it stopped without one — its own last words and a reply box. Shown on top
// of the phase view and of the Execute view, so a stopped run is never just silent.

import { useEffect, useState } from 'react'

import { phaseStatus } from '../../../shared/status.ts'
import type { KssBoard, TerminalInfo } from '../../../shared/types.ts'
import { api } from '../api.ts'
import { exitCode } from '../terminals.ts'
import { AskCard } from './AskCard.tsx'
import { Markdown } from './Markdown.tsx'

const QUICK = ['Continue', 'Yes', 'No']

/** The newest terminal running `phase` here, live first. */
export function phaseTerm(terms: TerminalInfo[], phase: string | null): TerminalInfo | null {
  const of = terms.filter(t => t.kind === 'phase' && (!phase || t.phase === phase))
  return [...of].reverse().find(t => exitCode(t.id) === null) ?? of[of.length - 1] ?? null
}

/** The `since` of a waiting mark the person answered, per session: the hook clears it a moment later. */
const answered = new Map<string, string>()
export const answeredSince = (session: string) => answered.get(session) ?? null

type Props = {
  session: string
  board: KssBoard
  terms: TerminalInfo[]
  onResume: () => void
  onAskAbout?: () => void
  onError: (e: unknown) => void
  onShowTerminal?: () => void
}

export function Attention({ session, board, terms, onResume, onAskAbout, onError, onShowTerminal }: Props) {
  // A precondition's ask belongs to a phase that has not entered `.kss/current` yet.
  const term = phaseTerm(terms, board.ask?.phase ?? board.phase)
  const live = !!term && exitCode(term.id) === null
  const [text, setText] = useState('')
  const [, tick] = useState(0)
  useEffect(() => setText(''), [board.waiting?.since])

  // A phase the app closed while it waited (idle) still has its conversation: answering reopens it.
  const reachable = live || !!term?.conversation
  if (board.ask && board.ask.kind !== 'handoff') return <AskCard session={session} ask={board.ask} live={reachable} onResume={onResume} onAskAbout={onAskAbout} onError={onError} />

  const status = phaseStatus({ board, live, exited: !!term && !live, launching: false, answered: answeredSince(session) })
  if (status !== 'waiting' || !board.waiting) return null

  const reply = async (t: string) => {
    if (!term || !t.trim()) return
    try {
      await api.submit(term.id, t.trim())
      answered.set(session, board.waiting!.since)
      tick(n => n + 1)
    } catch (e) {
      onError(e)
    }
  }

  return (
    <div className="ask-card waiting-card">
      <div className="ask-head">
        <span className="ask-kind waiting">Waiting for you</span>
        <span className="dim small-inline">{board.phase} stopped and is waiting for an answer</span>
        <span className="spacer" />
        {onShowTerminal && <button className="ghost" onClick={onShowTerminal}>Show terminal</button>}
      </div>
      {board.waiting.last ? <Markdown text={board.waiting.last} className="ask-text last-words" /> : <p className="dim">The phase ended its turn. Its last message is in the terminal.</p>}
      <div className="ask-quick">
        {QUICK.map(q => <button key={q} onClick={() => reply(q)}>{q}</button>)}
      </div>
      <div className="ask-free">
        <textarea value={text} placeholder="Reply to the phase (Enter sends)" onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), void reply(text))} />
        <button className="primary" disabled={!text.trim()} onClick={() => reply(text)}>Send</button>
      </div>
    </div>
  )
}
