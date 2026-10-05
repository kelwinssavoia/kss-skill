import { expect, mock, test } from 'claude-code/testing'

import {
  buildBoard, commandOf, describeTool, events, guard, invocation, parseConfig, parseGraph, parseLog, parseReadme, phases,
  quotaLine, since, ticketOf, trackQuota, usedBy, withPending,
} from '../hooks/kss'

const CWD = '/repo'
const CONFIG = 'features_root: docs/features\ndocs_root: docs/product\ndomain_docs: [CONTEXT.md, docs/adr]\n'
const README = '# 012-batch-cutoff\n\n**State:** grill · **Size:** L · **Track:** clarify → …\n**Next:** `/kss-grill 012-batch-cutoff`\n'
const CURRENT = {
  feature: '012-batch-cutoff',
  phase: 'grill',
  grill: { asked: 4, total: 11, deferred: 1, business: { done: 3, total: 3 }, layout: { done: 1, total: 2 }, technical: { done: 0, total: 6 }, current: 'Q4 · layout · Where does the cutoff show?' },
}

const files: Record<string, string> = {
  '/repo/.kss/config.md': CONFIG,
  '/repo/.kss/current': JSON.stringify(CURRENT),
  '/repo/docs/features/012-batch-cutoff/README.md': README,
}

test('the board reads the track, the phase and the grill queue', () => {
  const b = buildBoard(CURRENT, parseReadme(README), null)!
  expect(b.size).toBe('L')
  expect(b.phases.map(p => p.mark).slice(0, 4)).toEqual(['done', 'done', 'current', 'todo'])
  expect(b.grill?.asked).toBe(4)
  expect(b.isPhaseFinished).toBe(false)
})

test('a Next line naming another phase means the running one finished', () => {
  const b = buildBoard(CURRENT, parseReadme(README.replace('/kss-grill', '/kss-spec')), null)!
  expect(b.isPhaseFinished).toBe(true)
  expect(b.nextPhase).toBe('spec')
})

test('an off-track phase is shown in its place', () => {
  expect(phases('M', 'grill', false).map(p => p.name).slice(0, 3)).toEqual(['clarify', 'investigate', 'grill'])
})

test('a ticket integrating and a phase ending raise toasts', () => {
  const t = (state: string) => ({ ...CURRENT, phase: 'execute', tickets: { '04': { state } } })
  const a = buildBoard(t('running'), parseReadme(README.replace('/kss-grill', '/kss-execute')), null)
  const b = buildBoard(t('integrated'), parseReadme(README.replace('/kss-grill', '/kss-review')), null)
  expect(events(a, b)).toEqual(['kss 012 · ticket 04 integrated', 'kss 012 · execute done → /kss-review 012-batch-cutoff'])
})

test('the guard refuses the phase files a phase must not read', () => {
  const cfg = parseConfig(CONFIG)
  const f = (p: string) => `${CWD}/docs/features/012-batch-cutoff/${p}`
  expect(guard('phase-files', 'grill', f('03-spec.md'), CWD, cfg, '012-batch-cutoff')).toContain('03-spec.md')
  expect(guard('phase-files', 'grill', f('05-tickets/01-x.md'), CWD, cfg, '012-batch-cutoff')).toContain('05-tickets/')
  expect(guard('phase-files', 'grill', f('01-investigation.md'), CWD, cfg, '012-batch-cutoff')).toBeNull()
  expect(guard('phase-files', 'execute', f('05-tickets/01-x.md'), CWD, cfg, '012-batch-cutoff')).toBeNull()
  expect(guard('phase-files', 'grill', `${CWD}/src/app.ts`, CWD, cfg, '012-batch-cutoff')).toBeNull()
})

test('strict mode also refuses application source, never the KSS or docs folders', () => {
  const cfg = parseConfig(CONFIG)
  expect(guard('strict', 'spec', `${CWD}/src/app.ts`, CWD, cfg, '012-batch-cutoff')).toContain('src/app.ts')
  expect(guard('strict', 'spec', `${CWD}/CONTEXT.md`, CWD, cfg, '012-batch-cutoff')).toBeNull()
  expect(guard('strict', 'spec', `${CWD}/docs/adr/0001.md`, CWD, cfg, '012-batch-cutoff')).toBeNull()
  expect(guard('strict', 'spec', `${CWD}/.kss/config.md`, CWD, cfg, '012-batch-cutoff')).toBeNull()
  expect(guard('strict', 'spec', '/Users/me/.kss/preferences.md', CWD, cfg, '012-batch-cutoff')).toBeNull()
  expect(guard('off', 'grill', `${CWD}/docs/features/012-batch-cutoff/03-spec.md`, CWD, cfg, '012-batch-cutoff')).toBeNull()
})

/** Every string a drawn tree shows, in order, as one line. */
function flat(node: unknown): string {
  if (typeof node === 'string') return node
  const kids = (node as { children?: unknown[] })?.children ?? []
  return kids.map(flat).join('')
}

/** What the engine answers beneath the mod: a fake folder, and the calls session.start makes. */
function engine(on: any) {
  mock.clock(on)
  on('fs.read', ($: unknown, e: { path: string }) => {
    const text = files[e.path]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('session.start', ($: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the band shows the grill queue and the Next line (${surface})`, async ($, on) => {
    engine(on)
    on('process.run', () => ({ exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false }) as never)
    await $.session.start({ cwd: CWD } as never)
    const band = await $.ui.mount({
      plugin: 'kss-ui',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } as never,
    })
    const tree = flat(await band.drawn())
    expect(tree).toContain('Q4/11')
    expect(tree).toContain('/kss-grill 012-batch-cutoff')
    // The grill is still running, so there is no Run button yet.
    expect(await band.find({ key: 'run' })).toBeUndefined()
    expect(await band.find({ key: 'board' })).toBeDefined()
  })
}

test('a Read the grill must not do is denied on the main loop only', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }) as never)
  await $.session.start({ cwd: CWD } as never)
  const spec = `${CWD}/docs/features/012-batch-cutoff/03-spec.md`
  const main = await $.tool.call({ tool: 'Read', file_path: spec } as never)
  expect(JSON.stringify(main)).toContain('does not read 03-spec.md')
  const sub = await $.tool.call({ tool: 'Read', file_path: spec, agentId: 'a1' } as never)
  expect(JSON.stringify(sub)).not.toContain('does not read')
})

test('a typed /kss-<phase> shows that phase before .kss/current catches up', () => {
  const b = buildBoard({ ...CURRENT, phase: 'plan', grill: undefined }, parseReadme(README.replace('/kss-grill', '/kss-tickets')), null)
  expect(b?.isPhaseFinished).toBe(true)
  expect(invocation('kss-status', '012')).toBeNull()
  const s = invocation('kss:kss-tickets', '012-batch-cutoff')!
  const shown = withPending(b, s)!
  expect(shown.phase).toBe('tickets')
  expect(shown.isPhaseFinished).toBe(false)
  expect(shown.phases.find(p => p.name === 'plan')?.mark).toBe('done')
  expect(withPending(b, invocation('kss-tickets', '012'))?.phase).toBe('tickets')
  expect(withPending(b, invocation('kss-tickets', '013-other'))?.phase).toBe('plan')
  expect(commandOf('/kss-tickets 012-batch-cutoff')).toEqual({ command: 'kss-tickets', args: '012-batch-cutoff' })
})

test('Clear & run clears, then runs the Next command by its namespaced name', async ($, on) => {
  const readme = files['/repo/docs/features/012-batch-cutoff/README.md']!
  files['/repo/docs/features/012-batch-cutoff/README.md'] = readme.replace('/kss-grill', '/kss-spec')
  try {
    engine(on)
    const ran: string[] = []
    on('command.list', () => ({ value: [{ name: 'clear' }, { name: 'kss:kss-spec' }] }) as never)
    on('command.run', ($, e) => {
      ran.push(`${e.command} ${e.args}`.trim())
      return { text: '' }
    })
    await $.session.start({ cwd: CWD } as never)
    const band = await $.ui.mount({
      plugin: 'kss-ui',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } as never,
    })
    expect(await band.find({ key: 'run' })).toBeDefined()
    await band.press({ key: 'clear-run' })
    expect(ran).toEqual(['clear', 'kss:kss-spec 012-batch-cutoff'])
    // The run started the phase: the band shows spec before .kss/current does.
    expect(flat(await band.drawn())).toContain('▸spec')
  } finally {
    files['/repo/docs/features/012-batch-cutoff/README.md'] = readme
  }
})

const GRAPH = `| # | Ticket | Layer | Blocked by | Tier | Est. turns | Worktree |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | contract | proto | — | T4 | 25 | yes |
| 02 | csv-endpoint | api | 01 | T2 | 30 | yes |
| 03 | export-button | web | 01, 02 | T2 | 20 | yes |
`
const LOG = `## Log

- \`{{ts}}\` · **{{NN}}** · {{spawn|report}} · {{detail}}
- \`2026-10-05T14:02:11Z\` · **01** · integrate · 3 commits, 4 files
- \`2026-10-05T14:03:40Z\` · **02** · spawn · T2 in .kss/worktrees/012-batch-cutoff/02
`

test('the graph gives titles, blockers and estimates; the log its last lines', () => {
  const g = parseGraph(GRAPH)
  expect(g['03']).toEqual({ title: 'export-button', blockedBy: ['01', '02'], tier: 'T2', est: 20 })
  const log = parseLog(LOG)
  expect(log).toHaveLength(2)
  expect(log[0]).toEqual({ at: '2026-10-05T14:02:11Z', ticket: '01', event: 'integrate', detail: '3 commits, 4 files' })
})

test('a spawn is tied to its ticket by the worktree path, and a tool call reads as one short line', () => {
  expect(ticketOf('…\nWorktree: /repo/.kss/worktrees/012-batch-cutoff/02\n', 'executor')).toBe('02')
  expect(ticketOf('no path', 'Review ticket 03')).toBe('03')
  expect(describeTool('Edit', { file_path: '/repo/api/export/csv.ts' })).toBe('Edit export/csv.ts')
  expect(describeTool('Bash', { command: 'git commit -m "feat: csv"\nmore' })).toBe('$ git commit -m "feat: csv"')
  expect(since(0, 14 * 60_000)).toBe('14m')
  expect(since(0, 64 * 60_000)).toBe('1h04')
})

test('the execute board shows each ticket, what its subagent is doing, and the log', async ($, on) => {
  const dir = '/repo/docs/features/012-batch-cutoff'
  const saved = { ...files }
  files['/repo/.kss/current'] = JSON.stringify({
    feature: '012-batch-cutoff',
    phase: 'execute',
    tickets: { '01': { state: 'integrated', turns: 22 }, '02': { state: 'running', tier: 'T2', est_turns: 30 }, '03': { state: 'blocked' } },
    execution: { integrated: 1, total: 3 },
  })
  files[`${dir}/README.md`] = README.replace('/kss-grill', '/kss-execute')
  files[`${dir}/05-tickets/graph.md`] = GRAPH
  files[`${dir}/06-execution.md`] = LOG
  try {
    engine(on)
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'ag-02' }) as never)
    on('tool.call', () => ({ result: 'ok', text: 'ok' }) as never)
    on('ui.open', () => ({ value: { isOpen: true } }) as never)
    on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'five_hour', percentUsed: 40 }, { kind: 'seven_day', percentUsed: 30 }] } }) as never)
    on('session.measure', ($: unknown, e: { changed: string[] }) => ({ changed: e.changed }) as never)
    mock.store(on)
    await $.session.start({ cwd: CWD } as never)
    await $.session.measure({ context: {}, rateLimits: [{ kind: 'five_hour', percentUsed: 52 }, { kind: 'seven_day', percentUsed: 32 }], changed: ['rateLimits'] } as never)
    await $.agent.spawn({ prompt: 'ticket…\nWorktree: /repo/.kss/worktrees/012-batch-cutoff/02', description: 'Ticket 02', subagentType: 'kss:kss-sonnet-medium' } as never)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/api/export/csv.ts', old_string: 'a', new_string: 'b', agentId: 'ag-02' } as never)
    const pane = await $.ui.mount({
      plugin: 'kss-ui',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'kss-board',
      props: { title: 'KSS', isFocused: false, bodyColumns: 100, placement: 'dock' } as never,
    })
    const text = flat(await pane.drawn())
    expect(text).toContain('1/3 integrated')
    expect(text).toContain('csv-endpoint')
    expect(text).toContain('↳ Edit export/csv.ts')
    expect(text).toContain('waits on 01, 02')
    expect(text).toContain('integrate · 3 commits, 4 files')
    expect(text).toContain('session 52% (+12 this run)')
    expect(text).toContain('week 32% (+2 this run)')
  } finally {
    for (const k of Object.keys(files)) delete files[k]
    Object.assign(files, saved)
  }
})

test('quota: the first reading is the baseline, and a reset carries what was used before it', () => {
  const five = (p: number, resetsAt = '2026-10-05T19:00:00Z') => ({ kind: 'five_hour', percentUsed: p, resetsAt })
  let q = trackQuota(null, '012-x', [five(40), { kind: 'seven_day', percentUsed: 30 }])
  q = trackQuota(q, '012-x', [five(58), { kind: 'seven_day', percentUsed: 33 }])
  expect(q.windows.map(usedBy)).toEqual([18, 3])
  q = trackQuota(q, '012-x', [five(4, '2026-10-06T00:00:00Z')])
  expect(usedBy(q.windows[0]!)).toBe(22)
  expect(usedBy(q.windows[1]!)).toBe(3)
  expect(quotaLine(q, Date.parse('2026-10-05T22:00:00Z'))).toBe('session 4% (+22 this run) · resets in 2h00 │ week 33% (+3 this run)')
  // Another feature starts from its own baseline.
  expect(usedBy(trackQuota(q, '013-y', [five(10)]).windows[0]!)).toBe(0)
})
