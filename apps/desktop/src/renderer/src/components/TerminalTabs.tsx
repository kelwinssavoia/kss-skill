import { useEffect, useRef, useState, type ReactNode } from 'react'

import { NEEDS_YOU, phaseStatus } from '../../../shared/status.ts'
import type { KssBoard, TerminalInfo } from '../../../shared/types.ts'
import { load, save } from '../store.ts'
import { attach, exitCode, fit, onAnyExit } from '../terminals.ts'
import { answeredSince } from './Attention.tsx'

// One xterm can be shown in two places (its tab and the QA panel): whichever pane becomes visible
// takes the element back.
export function Pane({ id, visible, className = 'pane' }: { id: string; visible: boolean; className?: string }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!visible || !host.current) return
    attach(id, host.current)
    requestAnimationFrame(() => fit(id))
    const ro = new ResizeObserver(() => fit(id))
    ro.observe(host.current)
    return () => ro.disconnect()
  }, [id, visible])
  return <div ref={host} className={className} style={{ display: visible ? 'block' : 'none' }} />
}

/** A tab's identity across restarts: its saved conversation's key, else the live terminal's id. */
const keyOf = (t: TerminalInfo) => t.tab ?? t.id

/** Tabs in the order the person dragged them into; new ones go last. Pure, so it is easy to trust. */
export function ordered(terms: TerminalInfo[], order: string[]): TerminalInfo[] {
  const at = new Map(order.map((k, i) => [k, i]))
  return terms.map((t, i) => ({ t, i, o: at.get(keyOf(t)) })).sort((a, b) => (a.o ?? 1e6 + a.i) - (b.o ?? 1e6 + b.i)).map(x => x.t)
}

type Props = {
  session: string | null
  terms: TerminalInfo[]
  board: KssBoard | null
  active: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onNewShell: () => void
  /** Reopens a closed chat or phase in its conversation (`--resume`). */
  onReactivate: (t: TerminalInfo) => void
  empty: ReactNode
  shown: boolean
}

const CLOSED_WHY: Record<string, string> = {
  finished: 'Its phase finished — closed to free memory.',
  idle: 'Idle for 5 minutes — closed to free memory.',
}

export function TerminalTabs({ session, terms, board, active, onActivate, onClose, onNewShell, onReactivate, empty, shown }: Props) {
  const [, tick] = useState(0)
  useEffect(() => onAnyExit(() => tick(n => n + 1)), [])
  const [orders, setOrders] = useState<Record<string, string[]>>(() => load('tabOrder', {}))
  const [names, setNames] = useState<Record<string, string>>(() => load('tabNames', {}))
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  useEffect(() => save('tabOrder', orders), [orders])
  useEffect(() => save('tabNames', names), [names])

  const list = ordered(terms, (session && orders[session]) || [])
  const current = list.find(t => t.id === active) ?? list[list.length - 1] ?? null

  // ⌘T a new shell; ⌃Tab / ⌃⇧Tab cycle the tabs — only while the terminals are on screen.
  useEffect(() => {
    if (!shown) return
    const on = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 't') (e.preventDefault(), onNewShell())
      else if (e.ctrlKey && e.key === 'Tab' && list.length > 1) {
        e.preventDefault()
        const i = list.findIndex(t => t.id === current?.id)
        onActivate(list[(i + (e.shiftKey ? list.length - 1 : 1)) % list.length]!.id)
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  })

  const move = (from: string, to: string) => {
    if (!session || from === to) return
    const keys = list.map(keyOf).filter(k => k !== from)
    keys.splice(keys.indexOf(to), 0, from)
    setOrders(o => ({ ...o, [session]: keys }))
  }

  const phaseWaits = (t: TerminalInfo) => {
    if (t.kind !== 'phase' || !board || exitCode(t.id) !== null || t.phase !== (board.ask?.phase ?? board.phase)) return false
    return NEEDS_YOU.has(phaseStatus({ board, live: true, exited: false, launching: false, answered: session ? answeredSince(session) : null }))
  }

  return (
    <section className="terminals" style={{ display: shown ? 'flex' : 'none' }}>
      {terms.length > 0 && (
        <nav className="tabs">
          {list.map(t => {
            const code = exitCode(t.id)
            const k = keyOf(t)
            const title = names[k] ?? t.title
            const waits = phaseWaits(t)
            return (
              <div
                key={t.id}
                className={`tab ${t.id === current?.id ? 'on' : ''} ${dragging === k ? 'dragging' : ''}`}
                draggable={renaming !== k}
                onDragStart={e => (setDragging(k), e.dataTransfer.setData('text/kss-tab', k), (e.dataTransfer.effectAllowed = 'move'))}
                onDragEnd={() => setDragging(null)}
                onDragOver={e => e.dataTransfer.types.includes('text/kss-tab') && (e.preventDefault(), (e.dataTransfer.dropEffect = 'move'))}
                onDrop={e => (e.preventDefault(), move(e.dataTransfer.getData('text/kss-tab'), k))}
                onClick={() => onActivate(t.id)}
                onAuxClick={e => e.button === 1 && onClose(t.id)}
                onDoubleClick={() => setRenaming(k)}
                title={`${t.conversation ? `conversation ${t.conversation}\n` : ''}Double-click to rename · drag to reorder · middle-click to close`}
              >
                <span className={`dot ${waits ? 'waiting' : code === null ? 'live' : 'dead'}`} title={t.closed ? `closed: ${t.closed}` : undefined} />
                {renaming === k ? (
                  <input
                    className="tab-rename"
                    autoFocus
                    defaultValue={title}
                    onClick={e => e.stopPropagation()}
                    onBlur={e => (setNames(n => ({ ...n, [k]: e.target.value.trim() || t.title })), setRenaming(null))}
                    onKeyDown={e => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                  />
                ) : (
                  <span className="tab-title">{t.resumed ? '↺ ' : ''}{title}</span>
                )}
                <button className="icon" onClick={e => (e.stopPropagation(), onClose(t.id))} title="Close — its conversation is not resumed again">×</button>
              </div>
            )
          })}
          <button className="icon tab-new" onClick={onNewShell} title="New terminal — ⌘T">+</button>
        </nav>
      )}
      {current && current.conversation && current.kind !== 'shell' && current.kind !== 'qa' && exitCode(current.id) !== null && (
        <div className="closed-bar">
          <span>{(current.closed && CLOSED_WHY[current.closed]) ?? 'The process ended.'} Its conversation is kept.</span>
          <span className="spacer" />
          <button className="primary" onClick={() => onReactivate(current)} title={`Resume conversation ${current.conversation}`}>↺ Reactivate</button>
        </div>
      )}
      <div className="panes">
        {terms.map(t => <Pane key={t.id} id={t.id} visible={shown && t.id === current?.id} />)}
        {terms.length === 0 && empty}
      </div>
    </section>
  )
}
