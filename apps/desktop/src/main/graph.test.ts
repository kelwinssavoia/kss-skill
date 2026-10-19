import assert from 'node:assert/strict'
import { test } from 'node:test'

import { chain, crossings, depths, layoutGraph, longestPath, orderLayers, requirementProgress } from '../shared/graph.ts'
import { coverage, layerOf, waves } from './execute.ts'

const t = (id: string, blockedBy: string[] = [], extra: { est?: number; state?: string; fr?: string[] } = {}) => ({ id, blockedBy, ...extra })

test('columns are the waves execute reports', () => {
  const ts = [t('01'), t('03'), t('02', ['01']), t('05', ['01', '03']), t('07', ['02', '05']), t('14', ['01', '02', '03', '05', '07', '99'])]
  const g = layoutGraph(ts)
  assert.deepEqual(g.columns.map(c => [...c.ids].sort()), waves(ts))
  assert.equal(depths(ts).get('14'), 3)
})

test('barycenter ordering removes a crossing id order would draw', () => {
  const layers = [['01', '02'], ['03', '04']]
  const links: [string, string][] = [['02', '03'], ['01', '04']]
  assert.equal(crossings(layers, links), 1)
  const ordered = orderLayers(layers, links)
  assert.equal(crossings(ordered, links), 0)
  // In the layout: the ticket blocked by 01 sits level with 01's side of the column.
  const g = layoutGraph([t('01'), t('02'), t('03', ['02']), t('04', ['01'])])
  const y = (id: string) => g.nodes.find(n => n.id === id)!.y
  assert.equal(y('01') < y('02'), y('04') < y('03'))
})

test('a long edge is routed through the columns it spans, rightwards', () => {
  const g = layoutGraph([t('01'), t('02', ['01']), t('03', ['02']), t('04', ['01', '03'])])
  const long = g.edges.find(e => e.from === '01' && e.to === '04')!
  assert.equal(long.back, false)
  assert.equal((long.d.match(/ L /g) ?? []).length, 2, 'one straight run per crossed column')
  const xs = [...long.d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(m => Number(m[1]))
  assert.ok(xs[0]! < xs[xs.length - 1]!)
  for (const n of g.nodes) assert.ok(n.y >= 30 && n.y + n.h <= g.height, 'nodes inside the canvas, under the labels')
})

test('nodes in a column never overlap', () => {
  const many = Array.from({ length: 60 }, (_, i) => t(String(i + 1).padStart(2, '0'), i < 8 ? [] : [String((i % 8) + 1).padStart(2, '0'), String(i - 3).padStart(2, '0')]))
  const g = layoutGraph(many, { requirements: true })
  for (const c of g.columns) {
    const col = g.nodes.filter(n => c.ids.includes(n.id)).sort((a, b) => a.y - b.y)
    for (let i = 1; i < col.length; i++) assert.ok(col[i]!.y >= col[i - 1]!.y + col[i - 1]!.h - 0.2, `${col[i - 1]!.id} / ${col[i]!.id}`)
  }
})

test('a cycle in a hand-edited graph does not loop and its closing edge is marked back', () => {
  const g = layoutGraph([t('01', ['02']), t('02', ['01']), t('03', ['01'])])
  assert.equal(g.nodes.length, 3)
  assert.equal(g.edges.filter(e => e.back).length, 1)
})

test('critical path: the run’s own when given, else the heaviest chain by estimate', () => {
  const ts = [t('01', [], { est: 2 }), t('02', [], { est: 9 }), t('03', ['01', '02'], { est: 3 }), t('04', ['01'], { est: 1 })]
  assert.deepEqual(longestPath(ts), ['02', '03'])
  const g = layoutGraph(ts)
  assert.deepEqual(g.edges.filter(e => e.critical).map(e => `${e.from}>${e.to}`), ['02>03'])
  const given = layoutGraph(ts, { critical: ['01', '04'] })
  assert.deepEqual(given.edges.filter(e => e.critical).map(e => `${e.from}>${e.to}`), ['01>04'])
  assert.deepEqual(given.nodes.filter(n => n.critical).map(n => n.id), ['01', '04'])
  assert.deepEqual(longestPath([t('01'), t('02')]), [], 'no chain, no path')
})

test('requirements: a last column linked to the tickets that cover each FR', () => {
  const ts = [t('01', [], { fr: ['FR-02', 'FR-10'], state: 'integrated' }), t('02', ['01'], { fr: ['FR-02'], state: 'running' }), t('03', [], { fr: ['FR-01'], state: 'ready' })]
  const g = layoutGraph(ts, { requirements: true })
  assert.deepEqual(g.columns.at(-1)!.label, 'requirements')
  assert.deepEqual(g.edges.filter(e => e.kind === 'fr').map(e => `${e.from}>${e.to}`).sort(), ['01>FR-02', '01>FR-10', '02>FR-02', '03>FR-01'])
  assert.equal(layoutGraph(ts).nodes.some(n => n.kind === 'fr'), false)
  assert.deepEqual(
    requirementProgress(ts).map(f => [f.id, f.done, f.state]),
    [['FR-01', 0, 'todo'], ['FR-02', 1, 'active'], ['FR-10', 1, 'done']],
  )
})

test('chain: upstream and downstream, not siblings', () => {
  const edges = [{ from: '01', to: '02' }, { from: '01', to: '03' }, { from: '02', to: '04' }, { from: '04', to: 'FR-01' }]
  assert.deepEqual([...chain('02', edges)].sort(), ['01', '02', '04', 'FR-01'])
  assert.deepEqual([...chain('01', [{ from: '01', to: '02' }, { from: '02', to: '01' }])].sort(), ['01', '02'])
})

test('a ticket’s FRs and layer, from its file', () => {
  assert.deepEqual(coverage('- **FR-03** · the thing [a]\n- **FR-01** · see FR-03\n- FR-12'), ['FR-03', 'FR-01', 'FR-12'])
  assert.deepEqual(coverage(null), [])
  assert.equal(layerOf('**Layer:** api · **Blocked by:** 01 · **Blocks:** —'), 'api')
  assert.equal(layerOf('**Layer:** {{layer}} · **Blocked by:**'), null)
  assert.equal(layerOf(null), null)
})
