// The Execute view's ticket graph (DESIGN.md §24.8): the run drawn as what it is — tickets
// blocked by tickets, wave after wave — so what depends on what, where the work is now and what
// the critical path still waits on read at a glance. Layout in shared/graph.ts; this only draws,
// pans and zooms.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react'

import { chain, layoutGraph, requirementProgress, type GraphColumn } from '../../../shared/graph.ts'
import type { ExecTicket } from '../../../shared/types.ts'

const LABEL: Record<string, string> = { blocked: 'blocked', ready: 'ready', running: 'implementing', reviewing: 'in review', rejected: 'rejected', integrated: 'integrated' }
const MIN_K = 0.2
const MAX_K = 2.5
const FIT_TOP = 30
const FIT_BOTTOM = 40

type View = { x: number; y: number; k: number }
type Props = { tickets: ExecTicket[]; criticalPath: string[]; selected: string | null; onSelect: (id: string) => void }

const clamp = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k))
const short = (t: string | null, n: number) => (!t ? '—' : t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t)

/** The turns bar: progress against the estimate while worked on, full once integrated. */
function turnsOf(t: ExecTicket): { pct: number; text: string; over: boolean } {
  if (t.state === 'integrated') return { pct: 100, text: t.agent ? `${t.agent.turns}${t.est ? `/${t.est}` : ''}` : 'done', over: false }
  if (!t.agent) return { pct: 0, text: t.est ? `est ${t.est}` : '—', over: false }
  const over = !!t.est && t.agent.turns > t.est
  return { pct: t.est ? Math.min(100, (t.agent.turns / t.est) * 100) : 0, text: `${t.agent.turns}${t.est ? `/${t.est}` : ''}`, over }
}

export function TicketGraph({ tickets, criticalPath, selected, onSelect }: Props) {
  const uid = useId().replace(/:/g, '')
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  const [hover, setHover] = useState<string | null>(null)
  const [showFr, setShowFr] = useState(false)
  const drag = useRef<{ px: number; py: number; x: number; y: number; moved: boolean; id: string | null } | null>(null)
  const [dragging, setDragging] = useState(false)

  // The run is polled every few seconds; the layout changes only when the graph itself does.
  const shape = JSON.stringify([tickets.map(t => [t.id, t.blockedBy, t.est, t.fr]), criticalPath, showFr])
  const layout = useMemo(
    () => layoutGraph(tickets.map(t => ({ id: t.id, blockedBy: t.blockedBy, est: t.est, fr: t.fr })), { requirements: showFr, critical: criticalPath }),
    [shape],
  )
  const byId = useMemo(() => new Map(tickets.map(t => [t.id, t])), [tickets])
  const frs = useMemo(() => new Map(requirementProgress(tickets).map(f => [f.id, f])), [tickets])
  const lit = useMemo(() => (hover ? chain(hover, layout.edges) : null), [hover, layout])

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fitting leaves room for the zoom buttons above and the legend below.
  const fitTo = (x: number, y: number, w: number, h: number, most = 1.1) => {
    const room = { w: size.w - 24, h: size.h - FIT_TOP - FIT_BOTTOM }
    if (room.w <= 0 || room.h <= 0 || !w || !h) return
    const k = clamp(Math.min(room.w / w, room.h / h, most))
    setView({ k, x: (size.w - w * k) / 2 - x * k, y: FIT_TOP + (room.h - h * k) / 2 - y * k })
  }
  const fit = () => fitTo(0, 0, layout.width, layout.height)
  const focus = (c: GraphColumn) => fitTo(c.x - 20, 0, c.w + 40, layout.height, 1.4)

  // Fit when the graph or the room for it changes, never on a poll that changed only states.
  useEffect(fit, [shape, size.w > 0, size.h > 0])

  const zoomAt = (px: number, py: number, f: number) =>
    setView(v => {
      const k = clamp(v.k * f)
      return { k, x: px - (px - v.x) * (k / v.k), y: py - (py - v.y) * (k / v.k) }
    })

  // React's wheel listener is passive; zooming must keep the page from scrolling.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // One pointer handler for pan and select: a press that does not move is a click on its node.
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest('.tgraph-ui')) return
    const id = (e.target as Element).closest('[data-id]')?.getAttribute('data-id') ?? null
    drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y, moved: false, id }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  const move = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.px
    const dy = e.clientY - d.py
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) (d.moved = true), setDragging(true)
    if (d.moved) setView(v => ({ ...v, x: d.x + dx, y: d.y + dy }))
  }
  const up = () => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    if (d && !d.moved && d.id && byId.has(d.id)) onSelect(d.id)
  }

  const zoomBy = (f: number) => zoomAt(size.w / 2, size.h / 2, f)
  const waveDone = (c: GraphColumn) => c.ids.filter(id => byId.get(id)?.state === 'integrated').length
  const ticketCols = layout.columns.filter(c => c.label !== 'requirements')

  return (
    <div className="tgraph">
      <div className="tgraph-top">
        <div className="gwaves">
          {ticketCols.map((c, i) => {
            const done = waveDone(c)
            const live = c.ids.some(id => ['running', 'reviewing', 'rejected'].includes(byId.get(id)?.state ?? ''))
            return (
              <button key={i} className={`gwave ${done === c.ids.length ? 'done' : live ? 'live' : ''}`} onClick={() => focus(c)} title={`Wave ${i + 1}: ${c.ids.join(', ')}`}>
                <span>W{i + 1}</span>
                <span className="gwave-bar">
                  {c.ids.map(id => <i key={id} className={byId.get(id)?.state ?? ''} />)}
                </span>
                <span className="dim">{done}/{c.ids.length}</span>
              </button>
            )
          })}
        </div>
        <span className="spacer" />
        <label className="gtoggle">
          <input type="checkbox" checked={showFr} onChange={e => setShowFr(e.target.checked)} />
          <span>Show requirements</span>
        </label>
      </div>

      <div
        ref={box}
        className={`tgraph-canvas ${dragging ? 'dragging' : ''} ${hover ? 'hovering' : ''}`}
        style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${22 * view.k}px ${22 * view.k}px` }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <svg width="100%" height="100%">
          <defs>
            <marker id={`${uid}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="context-stroke" />
            </marker>
          </defs>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {layout.columns.map((c, i) => (
              <g key={i} className="gcol">
                <rect x={c.x - 10} y={4} width={c.w + 20} height={layout.height - 8} rx={10} />
                <text x={c.x + 2} y={20}>
                  {c.label.toUpperCase()}
                  {c.label !== 'requirements' && <tspan className="gcol-n"> · {waveDone(c)}/{c.ids.length}</tspan>}
                </text>
              </g>
            ))}

            {layout.edges.map(e => {
              const to = byId.get(e.to)
              const cls = [
                'gedge',
                e.kind,
                e.critical && 'crit',
                e.back && 'back',
                e.kind === 'dep' && to?.state === 'running' && 'flow',
                byId.get(e.from)?.state === 'integrated' && e.kind === 'dep' && 'met',
                lit && (lit.has(e.from) && lit.has(e.to) ? 'hl' : 'dim'),
              ]
              return <path key={`${e.from}>${e.to}`} className={cls.filter(Boolean).join(' ')} d={e.d} markerEnd={e.kind === 'dep' ? `url(#${uid}-arrow)` : undefined} />
            })}

            {layout.nodes.map(n => {
              const dim = lit && !lit.has(n.id) ? 'dim' : ''
              if (n.kind === 'fr') {
                const f = frs.get(n.id)
                return (
                  <g key={n.id} data-id={n.id} className={`gfr ${f?.state ?? ''} ${dim}`} transform={`translate(${n.x} ${n.y})`} onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(null)}>
                    <title>{`${n.id}: ${f?.done ?? 0} of ${f?.tickets.length ?? 0} tickets integrated (${f?.tickets.join(', ')})`}</title>
                    <rect width={n.w} height={n.h} rx={n.h / 2} />
                    <text x={14} y={n.h / 2 + 4} className="gfr-id">{n.id}</text>
                    <text x={n.w - 12} y={n.h / 2 + 4} textAnchor="end" className="gfr-n">{f?.done ?? 0}/{f?.tickets.length ?? 0}</text>
                  </g>
                )
              }
              const t = byId.get(n.id)
              if (!t) return null
              const label = LABEL[t.state] ?? t.state
              const chipW = label.length * 6.1 + 14
              const bar = turnsOf(t)
              const barW = n.w - 74
              const meta = [t.tier, t.layer].filter(Boolean).join(' · ')
              return (
                <g
                  key={n.id}
                  data-id={n.id}
                  className={`gnode ${t.state} ${n.critical ? 'crit' : ''} ${selected === n.id ? 'on' : ''} ${dim}`}
                  transform={`translate(${n.x} ${n.y})`}
                  onPointerEnter={() => setHover(n.id)}
                  onPointerLeave={() => setHover(null)}
                >
                  <title>{`${t.id} · ${t.title ?? ''}\n${label}${t.blockedBy.length ? ` · after ${t.blockedBy.join(', ')}` : ''}${t.fr.length ? `\n${t.fr.join(', ')}` : ''}${t.goal ? `\n\n${t.goal}` : ''}`}</title>
                  {t.state === 'running' && <rect className="gpulse" x={-4} y={-4} width={n.w + 8} height={n.h + 8} rx={11} />}
                  <rect className="gcard" width={n.w} height={n.h} rx={8} />
                  <rect className="gside" width={3} height={n.h - 12} x={0} y={6} rx={1.5} />
                  <text className="gid" x={12} y={20}>{t.id}</text>
                  <text className="gtitle" x={36} y={20}>{short(t.title, 23)}</text>
                  <g transform="translate(12 29)">
                    <rect className="gchip" width={chipW} height={16} rx={8} />
                    <text className="gchip-t" x={chipW / 2} y={11.5} textAnchor="middle">{label}</text>
                  </g>
                  {meta && <text className="gmeta" x={20 + chipW + 4} y={41}>{short(meta, Math.max(4, Math.floor((n.w - chipW - 34) / 6)))}</text>}
                  <rect className="gbar-bg" x={12} y={57} width={barW} height={5} rx={2.5} />
                  {bar.pct > 0 && <rect className={`gbar ${bar.over ? 'over' : ''}`} x={12} y={57} width={(barW * bar.pct) / 100} height={5} rx={2.5} />}
                  <text className="gturns" x={n.w - 12} y={62} textAnchor="end">{bar.text}</text>
                </g>
              )
            })}
          </g>
        </svg>

        <div className="tgraph-ui gzoom">
          <button onClick={() => zoomBy(1.25)} title="Zoom in">+</button>
          <button onClick={() => zoomBy(0.8)} title="Zoom out">−</button>
          <button onClick={fit} title="Fit the whole graph">Fit</button>
        </div>
        <div className="tgraph-ui glegend">
          {(['running', 'reviewing', 'rejected', 'integrated', 'ready', 'blocked'] as const).map(s => (
            <span key={s}><i className={`gdot ${s}`} />{LABEL[s]}</span>
          ))}
          <span><i className="gline crit" />critical path</span>
          <span><i className="gline flow" />feeding work in progress</span>
          {showFr && <span><i className="gdot fr" />requirement · done when all its tickets are</span>}
        </div>
        {tickets.length === 0 && <div className="tgraph-empty dim">No tickets in the graph.</div>}
      </div>
    </div>
  )
}
