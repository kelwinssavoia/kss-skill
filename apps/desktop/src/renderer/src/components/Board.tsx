import type { KssBoard } from '../../../shared/types.ts'
import { Phases } from './Phases.tsx'

const human = (n: number | null) => (n === null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))

const since = (iso: string | null) => {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return '—'
  const m = Math.max(0, Math.round((Date.now() - t) / 60000))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

export function Board({ board: b, onInspect }: { board: KssBoard; onInspect: (ticket: string) => void }) {
  return (
    <aside className="board">
      <h3>{b.feature}</h3>
      <Phases phases={b.phases} />
      <div className="stats">
        <div><span>tokens</span>{human(b.tokens)}</div>
        <div><span>turns</span>{human(b.turns)}</div>
        <div><span>ctx</span>{human(b.ctx)}</div>
        <div><span>phase for</span>{since(b.phaseStartedAt)}</div>
      </div>
      {b.explorers && <div className="note">explorers {b.explorers.returned}/{b.explorers.running + b.explorers.returned} back</div>}
      {b.grill && (
        <div className="block">
          <h4>Grill · {b.grill.asked}/{b.grill.total}{b.grill.deferred ? ` · ${b.grill.deferred} deferred` : ''}</h4>
          {(['business', 'layout', 'technical'] as const).map(k => {
            const c = b.grill![k]
            return c ? (
              <div key={k} className="grill-row">
                <span>{k}</span>
                <div className="mini-bar"><i style={{ width: `${c.total ? (c.done / c.total) * 100 : 0}%` }} /></div>
                <span>{c.done}/{c.total}</span>
              </div>
            ) : null
          })}
          {b.grill.current && <p className="current-q">{b.grill.current}</p>}
        </div>
      )}
      {b.review && (
        <div className="note">review round {b.review.round ?? '—'}{b.review.watching ? ` · watching ${b.review.watching}` : ''}</div>
      )}
      {b.tickets.length > 0 && (
        <div className="block">
          <h4>Tickets{b.total ? ` · ${b.integrated ?? 0}/${b.total} integrated` : ''}</h4>
          {b.tickets.map(t => {
            const pct = t.est && t.turns !== null ? Math.min(100, (t.turns / t.est) * 100) : 0
            return (
              <button key={t.id} className={`ticket ${t.state}`} onClick={() => onInspect(t.id)} title="Inspect this ticket's subagent">
                <div className="ticket-row">
                  <span className="ticket-id">{t.id}</span>
                  <span className="ticket-title">{t.title ?? '—'}</span>
                  <span className={`state ${t.state}`}>{t.state}</span>
                </div>
                <div className="ticket-row dim">
                  <span>{t.tier ?? '—'}</span>
                  <div className="mini-bar"><i style={{ width: `${pct}%` }} /></div>
                  <span>{t.turns ?? '—'}/{t.est ?? '—'}</span>
                  <span>{t.state === 'running' ? since(t.startedAt) : ''}</span>
                </div>
                {t.blockedBy.length > 0 && t.state === 'blocked' && <div className="ticket-row dim">blocked by {t.blockedBy.join(', ')}</div>}
              </button>
            )
          })}
          {b.last && <p className="note">Last: {b.last}</p>}
        </div>
      )}
      {b.log.length > 0 && (
        <div className="block">
          <h4>Log</h4>
          {b.log.map((l, i) => (
            <div key={i} className="log-row">
              <span className="dim">{l.at.slice(11, 16) || l.at}</span> {l.ticket && <b>{l.ticket}</b>} {l.event}
              {l.detail && <span className="dim"> · {l.detail}</span>}
            </div>
          ))}
        </div>
      )}
      {b.next && <div className="next-line">Next: <code>{b.next}</code></div>}
    </aside>
  )
}
