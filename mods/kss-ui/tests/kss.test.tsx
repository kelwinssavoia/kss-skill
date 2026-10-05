import { expect, mock, test } from 'claude-code/testing'

import { buildBoard, commandOf, events, guard, invocation, parseConfig, parseReadme, phases, withPending } from '../hooks/kss'

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
