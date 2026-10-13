import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { TerminalInfo } from '../../../shared/types.ts'
import { attach, exitCode, fit, onAnyExit } from '../terminals.ts'

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

type Props = { terms: TerminalInfo[]; active: string | null; onActivate: (id: string) => void; onClose: (id: string) => void; empty: ReactNode; shown: boolean }

export function TerminalTabs({ terms, active, onActivate, onClose, empty, shown }: Props) {
  const [, tick] = useState(0)
  useEffect(() => onAnyExit(() => tick(n => n + 1)), [])
  const current = terms.find(t => t.id === active) ?? terms[terms.length - 1] ?? null
  return (
    <section className="terminals" style={{ display: shown ? 'flex' : 'none' }}>
      {terms.length > 0 && (
        <nav className="tabs">
          {terms.map(t => {
            const code = exitCode(t.id)
            return (
              <div key={t.id} className={t.id === current?.id ? 'tab on' : 'tab'} onClick={() => onActivate(t.id)}>
                <span className={`dot ${code === null ? 'live' : 'dead'}`} />
                <span className="tab-title">{t.title}</span>
                <button className="icon" onClick={e => (e.stopPropagation(), onClose(t.id))}>×</button>
              </div>
            )
          })}
        </nav>
      )}
      <div className="panes">
        {terms.map(t => <Pane key={t.id} id={t.id} visible={shown && t.id === current?.id} />)}
        {terms.length === 0 && empty}
      </div>
    </section>
  )
}
