import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { TerminalInfo } from '../../../shared/types.ts'
import { attach, exitCode, fit, onAnyExit } from '../terminals.ts'

function Pane({ id, visible }: { id: string; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (host.current) attach(id, host.current)
  }, [id])
  useEffect(() => {
    if (!visible || !host.current) return
    requestAnimationFrame(() => fit(id))
    const ro = new ResizeObserver(() => fit(id))
    ro.observe(host.current)
    return () => ro.disconnect()
  }, [id, visible])
  return <div ref={host} className="pane" style={{ display: visible ? 'block' : 'none' }} />
}

type Props = { terms: TerminalInfo[]; active: string | null; onActivate: (id: string) => void; onClose: (id: string) => void; empty: ReactNode }

export function TerminalTabs({ terms, active, onActivate, onClose, empty }: Props) {
  const [, tick] = useState(0)
  useEffect(() => onAnyExit(() => tick(n => n + 1)), [])
  const current = terms.find(t => t.id === active) ?? terms[terms.length - 1] ?? null
  return (
    <section className="terminals">
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
        {terms.map(t => <Pane key={t.id} id={t.id} visible={t.id === current?.id} />)}
        {terms.length === 0 && empty}
      </div>
    </section>
  )
}
