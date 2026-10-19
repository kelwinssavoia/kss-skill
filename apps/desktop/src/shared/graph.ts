// The Execute view's ticket graph (DESIGN.md §24.8): a layered layout of the `Blocked by` DAG.
// Columns are the dependency waves execute already reports, the order inside a column is chosen
// so edges cross as little as possible, and an edge spanning several columns is routed through
// them as a smooth curve. Pure, so the renderer only draws and the layout is tested here.

export type GraphTicket = { id: string; blockedBy: string[]; est?: number | null; state?: string; fr?: string[] }

export type GraphNode = { id: string; kind: 'ticket' | 'fr'; column: number; x: number; y: number; w: number; h: number; critical: boolean }

/** `back` is an edge that does not go rightwards: only a cycle in a hand-edited graph makes one. */
export type GraphEdge = { from: string; to: string; kind: 'dep' | 'fr'; critical: boolean; back: boolean; d: string }

export type GraphColumn = { x: number; w: number; label: string; ids: string[] }

export type GraphLayout = { nodes: GraphNode[]; edges: GraphEdge[]; columns: GraphColumn[]; critical: string[]; width: number; height: number }

export type GraphOptions = {
  /** Add the FRs the tickets cover as a last column. */
  requirements?: boolean
  /** The run's own critical path (`execution.critical_path`); computed from the estimates when empty. */
  critical?: string[]
  nodeW?: number
  nodeH?: number
  frW?: number
  frH?: number
  gapX?: number
  gapY?: number
}

const SWEEPS = 8
const HEAD = 30 // room above the columns for their labels
const PAD = 16

/**
 * Dependency depth of each ticket — the same as execute's `waves()`: depth 0 has no blocker, a
 * cycle is cut where it is found instead of looping.
 */
export function depths(tickets: GraphTicket[]): Map<string, number> {
  const by = new Map(tickets.map(t => [t.id, t.blockedBy.filter(b => b !== t.id)]))
  const depth = new Map<string, number>()
  const visit = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!
    if (seen.has(id)) return 0
    seen.add(id)
    const d = Math.max(0, ...(by.get(id) ?? []).filter(b => by.has(b)).map(b => visit(b, seen) + 1))
    depth.set(id, d)
    return d
  }
  for (const t of tickets) visit(t.id, new Set())
  return depth
}

/** The heaviest chain of blockers, weighted by estimated turns (1 when unknown); none below two tickets. */
export function longestPath(tickets: GraphTicket[], depth = depths(tickets)): string[] {
  const ids = new Set(tickets.map(t => t.id))
  const order = [...tickets].sort((a, b) => depth.get(a.id)! - depth.get(b.id)! || a.id.localeCompare(b.id))
  const dist = new Map<string, number>()
  const prev = new Map<string, string>()
  for (const t of order) {
    let best = 0
    for (const b of [...t.blockedBy].sort()) {
      if (!ids.has(b) || depth.get(b)! >= depth.get(t.id)!) continue
      if (dist.get(b)! > best) {
        best = dist.get(b)!
        prev.set(t.id, b)
      }
    }
    dist.set(t.id, best + Math.max(1, t.est ?? 1))
  }
  let end: string | null = null
  for (const t of order) if (end === null || dist.get(t.id)! > dist.get(end)!) end = t.id
  const path: string[] = []
  for (let cur = end; cur; cur = prev.get(cur) ?? null) path.unshift(cur)
  return path.length >= 2 ? path : []
}

/** Pairs of links between adjacent layers that cross, given each item's index in its layer. */
export function crossings(layers: string[][], links: [string, string][]): number {
  const pos = new Map<string, number>()
  const layerOf = new Map<string, number>()
  layers.forEach((l, li) => l.forEach((k, i) => (pos.set(k, i), layerOf.set(k, li))))
  const byLayer = new Map<number, [number, number][]>()
  for (const [u, v] of links) {
    const li = layerOf.get(u)!
    if (layerOf.get(v) !== li + 1) continue
    let list = byLayer.get(li)
    if (!list) byLayer.set(li, (list = []))
    list.push([pos.get(u)!, pos.get(v)!])
  }
  let n = 0
  for (const list of byLayer.values())
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if ((list[i]![0] - list[j]![0]) * (list[i]![1] - list[j]![1]) < 0) n++
  return n
}

/**
 * Orders each layer by the barycenter of its neighbours, sweeping down then up a few times and
 * keeping the ordering with the fewest crossings. An item with no neighbour on the swept side
 * keeps its place, so independent tickets stay in id order.
 */
export function orderLayers(layers: string[][], links: [string, string][]): string[][] {
  const out = layers.map(l => [...l])
  const preds = new Map<string, string[]>()
  const succs = new Map<string, string[]>()
  for (const [u, v] of links) {
    ;(preds.get(v) ?? preds.set(v, []).get(v)!).push(u)
    ;(succs.get(u) ?? succs.set(u, []).get(u)!).push(v)
  }
  const pos = new Map<string, number>()
  out.forEach(l => l.forEach((k, i) => pos.set(k, i)))
  let best = out.map(l => [...l])
  let fewest = crossings(out, links)
  for (let s = 0; s < SWEEPS && fewest > 0; s++) {
    const down = s % 2 === 0
    const range = down ? out.map((_, i) => i).slice(1) : out.map((_, i) => i).reverse().slice(1)
    for (const li of range) {
      const layer = out[li]!
      const bary = new Map(
        layer.map(k => {
          const ns = (down ? preds : succs).get(k) ?? []
          return [k, ns.length ? ns.reduce((a, n) => a + pos.get(n)!, 0) / ns.length : pos.get(k)!] as const
        }),
      )
      layer.sort((a, b) => bary.get(a)! - bary.get(b)! || pos.get(a)! - pos.get(b)!)
      layer.forEach((k, i) => pos.set(k, i))
    }
    const c = crossings(out, links)
    if (c < fewest) {
      fewest = c
      best = out.map(l => [...l])
    }
  }
  return best
}

/**
 * Places items of heights `h` in their order, each as near its wanted top as the gaps allow: a
 * pass pushing down and a pass pushing up, averaged — both keep the gaps, so their mean does too.
 */
function place(want: number[], h: number[], gap: (i: number) => number): number[] {
  const n = want.length
  const down: number[] = []
  for (let i = 0; i < n; i++) down[i] = i === 0 ? want[0]! : Math.max(want[i]!, down[i - 1]! + h[i - 1]! + gap(i))
  const up: number[] = []
  for (let i = n - 1; i >= 0; i--) up[i] = i === n - 1 ? want[i]! : Math.min(want[i]!, up[i + 1]! - h[i]! - gap(i + 1))
  return down.map((d, i) => (d + up[i]!) / 2)
}

const r = (n: number) => Math.round(n * 10) / 10

/** A horizontal S-curve from a to b. */
const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = Math.max(24, (b.x - a.x) / 2)
  return `C ${r(a.x + dx)} ${r(a.y)}, ${r(b.x - dx)} ${r(b.y)}, ${r(b.x)} ${r(b.y)}`
}

const frNumber = (id: string) => Number(/\d+/.exec(id)?.[0] ?? 0)

export function layoutGraph(tickets: GraphTicket[], o: GraphOptions = {}): GraphLayout {
  const W = o.nodeW ?? 196
  const H = o.nodeH ?? 74
  const FW = o.frW ?? 112
  const FH = o.frH ?? 28
  const GX = o.gapX ?? 76
  const GY = o.gapY ?? 16
  const ids = new Set(tickets.map(t => t.id))
  const depth = depths(tickets)
  const sorted = [...tickets].sort((a, b) => a.id.localeCompare(b.id))

  const deps: { from: string; to: string }[] = []
  for (const t of sorted) for (const b of new Set(t.blockedBy)) if (b !== t.id && ids.has(b)) deps.push({ from: b, to: t.id })

  // Layers, with a placeholder in every column a long edge passes through.
  const layers: string[][] = []
  for (const t of sorted) (layers[depth.get(t.id)!] ??= []).push(t.id)
  for (let i = 0; i < layers.length; i++) layers[i] ??= []
  const links: [string, string][] = []
  const via = new Map<string, string[]>()
  for (const e of deps) {
    const a = depth.get(e.from)!
    const b = depth.get(e.to)!
    if (b <= a) continue
    const chain = [e.from]
    for (let l = a + 1; l < b; l++) {
      const k = `~${e.from}>${e.to}@${l}`
      layers[l]!.push(k)
      chain.push(k)
    }
    chain.push(e.to)
    via.set(`${e.from}>${e.to}`, chain.slice(1, -1))
    for (let i = 1; i < chain.length; i++) links.push([chain[i - 1]!, chain[i]!])
  }
  const ordered = orderLayers(layers, links)

  // Vertical placement: start stacked and centred, then pull each item towards its neighbours.
  const dummy = (k: string) => k.startsWith('~')
  const height = (k: string) => (dummy(k) ? 0 : H)
  const gapIn = (layer: string[]) => (i: number) => (dummy(layer[i]!) && dummy(layer[i - 1]!) ? 6 : GY)
  const stack = (layer: string[]) => layer.reduce((y, k, i) => y + height(k) + (i ? gapIn(layer)(i) : 0), 0)
  const tallest = Math.max(0, ...ordered.map(stack))
  const top = new Map<string, number>()
  for (const layer of ordered) {
    const gap = gapIn(layer)
    let y = (tallest - stack(layer)) / 2
    layer.forEach((k, i) => {
      if (i) y += gap(i)
      top.set(k, y)
      y += height(k)
    })
  }
  const preds = new Map<string, string[]>()
  const succs = new Map<string, string[]>()
  for (const [u, v] of links) {
    ;(preds.get(v) ?? preds.set(v, []).get(v)!).push(u)
    ;(succs.get(u) ?? succs.set(u, []).get(u)!).push(v)
  }
  const mid = (k: string) => top.get(k)! + height(k) / 2
  for (let round = 0; round < 6; round++) {
    const forward = round % 2 === 0
    const order = forward ? ordered.map((_, i) => i) : ordered.map((_, i) => i).reverse()
    for (const li of order) {
      const layer = ordered[li]!
      const want = layer.map(k => {
        const ns = [...((forward ? preds : succs).get(k) ?? [])]
        return ns.length ? ns.reduce((a, n) => a + mid(n), 0) / ns.length - height(k) / 2 : top.get(k)!
      })
      place(want, layer.map(height), gapIn(layer)).forEach((y, i) => top.set(layer[i]!, y))
    }
  }

  const colX = (c: number) => PAD + c * (W + GX)
  const nodes: GraphNode[] = []
  ordered.forEach((layer, c) => layer.forEach(k => !dummy(k) && nodes.push({ id: k, kind: 'ticket', column: c, x: colX(c), y: top.get(k)!, w: W, h: H, critical: false })))

  // Requirements: one column after the last wave, each FR beside the tickets that cover it.
  const frEdges: { from: string; to: string }[] = []
  if (o.requirements) {
    const cover = new Map<string, string[]>()
    for (const t of sorted) for (const f of new Set(t.fr ?? [])) (cover.get(f) ?? cover.set(f, []).get(f)!).push(t.id)
    const frs = [...cover.keys()].sort((a, b) => frNumber(a) - frNumber(b) || a.localeCompare(b))
    const want = frs.map(f => {
      const ts = cover.get(f)!
      return ts.reduce((a, t) => a + mid(t), 0) / ts.length - FH / 2
    })
    // Kept in FR order where it costs little, by their tickets otherwise.
    const order = frs.map((f, i) => ({ f, w: want[i]! })).sort((a, b) => a.w - b.w || frNumber(a.f) - frNumber(b.f))
    const ys = place(order.map(x => x.w), order.map(() => FH), () => 8)
    const c = ordered.length
    order.forEach(({ f }, i) => {
      nodes.push({ id: f, kind: 'fr', column: c, x: colX(c) + (W - FW) / 2 + GX / 2, y: ys[i]!, w: FW, h: FH, critical: false })
      for (const t of cover.get(f)!) frEdges.push({ from: t, to: f })
    })
  }

  // Everything moved by the pulls is shifted back to start just under the column labels.
  const minY = nodes.length ? Math.min(...nodes.map(n => n.y), ...top.values()) : 0
  for (const n of nodes) n.y = r(n.y - minY + HEAD)
  for (const [k, v] of top) top.set(k, v - minY + HEAD)

  const given = (o.critical ?? []).filter(id => ids.has(id))
  const critical = given.length ? given : longestPath(tickets, depth)
  const onPath = new Set(critical.slice(1).map((id, i) => `${critical[i]}>${id}`))
  for (const n of nodes) n.critical = n.kind === 'ticket' && critical.includes(n.id)

  const at = new Map(nodes.map(n => [n.id, n]))
  const edges: GraphEdge[] = []
  for (const e of deps) {
    const a = at.get(e.from)!
    const b = at.get(e.to)!
    const start = { x: a.x + a.w, y: a.y + a.h / 2 }
    const end = { x: b.x, y: b.y + b.h / 2 }
    const back = b.column <= a.column
    let d = `M ${r(start.x)} ${r(start.y)} `
    if (back) {
      d += `C ${r(start.x + 90)} ${r(start.y)}, ${r(end.x - 90)} ${r(end.y)}, ${r(end.x)} ${r(end.y)}`
    } else {
      let p = start
      ;(via.get(`${e.from}>${e.to}`) ?? []).forEach((k, i) => {
        const c = a.column + 1 + i
        const y = top.get(k)!
        d += `${curve(p, { x: colX(c), y })} L ${r(colX(c) + W)} ${r(y)} `
        p = { x: colX(c) + W, y }
      })
      d += curve(p, end)
    }
    edges.push({ from: e.from, to: e.to, kind: 'dep', critical: onPath.has(`${e.from}>${e.to}`), back, d: d.trim() })
  }
  for (const e of frEdges) {
    const a = at.get(e.from)!
    const b = at.get(e.to)!
    const start = { x: a.x + a.w, y: a.y + a.h / 2 }
    edges.push({ from: e.from, to: e.to, kind: 'fr', critical: false, back: false, d: `M ${r(start.x)} ${r(start.y)} ${curve(start, { x: b.x, y: b.y + b.h / 2 })}` })
  }

  const columns: GraphColumn[] = ordered.map((layer, c) => ({ x: colX(c), w: W, label: `wave ${c + 1}`, ids: layer.filter(k => !dummy(k)) }))
  const frNodes = nodes.filter(n => n.kind === 'fr')
  if (frNodes.length) columns.push({ x: frNodes[0]!.x, w: FW, label: 'requirements', ids: frNodes.map(n => n.id) })
  const width = Math.max(0, ...nodes.map(n => n.x + n.w)) + PAD
  const heightAll = Math.max(HEAD, ...nodes.map(n => n.y + n.h), ...[...top.values()]) + PAD
  return { nodes, edges, columns, critical, width: r(width), height: r(heightAll) }
}

/** Every node upstream and downstream of `id` along the edges, `id` included. */
export function chain(id: string, edges: { from: string; to: string }[]): Set<string> {
  const out = new Set([id])
  // Upstream and downstream are walked apart: a sibling sharing a blocker is not in the chain.
  const walk = (near: 'from' | 'to', far: 'from' | 'to') => {
    const seen = new Set([id])
    const queue = [id]
    while (queue.length) {
      const cur = queue.shift()!
      for (const e of edges) if (e[near] === cur && !seen.has(e[far])) (seen.add(e[far]), out.add(e[far]), queue.push(e[far]))
    }
  }
  walk('to', 'from')
  walk('from', 'to')
  return out
}

export type FrProgress = { id: string; tickets: string[]; done: number; state: 'done' | 'active' | 'todo' }

/** Each FR with the tickets covering it: done once all of them are integrated, active once any has started. */
export function requirementProgress(tickets: GraphTicket[]): FrProgress[] {
  const cover = new Map<string, GraphTicket[]>()
  for (const t of tickets) for (const f of new Set(t.fr ?? [])) (cover.get(f) ?? cover.set(f, []).get(f)!).push(t)
  return [...cover.entries()]
    .sort(([a], [b]) => frNumber(a) - frNumber(b) || a.localeCompare(b))
    .map(([id, ts]) => {
      const done = ts.filter(t => t.state === 'integrated').length
      const started = ts.some(t => t.state && t.state !== 'ready' && t.state !== 'blocked')
      return { id, tickets: ts.map(t => t.id), done, state: done === ts.length ? 'done' : started ? 'active' : 'todo' }
    })
}
