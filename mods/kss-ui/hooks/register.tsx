// kss-ui — KSS drawn inside Claude Code. It reads what the skills already write (`.kss/current`,
// `.kss/config.md`, the feature README, `metrics.jsonl`) and owns no state of its own, so a session
// without it, or a Codex one, loses nothing but the drawing (DESIGN.md §19).
//
//   band   above the prompt: the track, the phase-specific progress line, the Next command
//   pane   /kss: the whole board — phases, grill queue, tickets, cost
//   toasts a ticket integrated or rejected, a phase finished, artifacts left uncommitted
//   guard  a Read the running phase's "Do not read" list forbids is denied (main loop only)

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { KssBoard, KssGrill, KssLive, KssQuota, KssTicket } from '../types'
import type { KssRateReading } from './kss'
import {
  bar, buildBoard, commandOf, describeTool, events, guard, human, invocation, parseConfig, parseJson,
  parseReadme, quotaLine, short, since, sumTokens, ticketOf, trackQuota, usedBy, withPending,
} from './kss'
import type { GuardMode, KssConfig } from './kss'

const PANE = 'kss-board'

/** Told to the execute coordinator while the board is drawn here, so the transcript stays short. */
const QUIET_EXECUTE = [
  'kss-ui is drawing the KSS execute board live in this session: every ticket with its progress,',
  'elapsed time and current action, the recent log and the quota used. If you are the kss-execute',
  'coordinator, do not print the progress board (DESIGN.md §14.4) on each event: print one line per',
  'event instead, `NN · <event> · <detail>`, and the full board only when the run ends or the user',
  'asks. Nothing else changes: keep writing .kss/current and 06-execution.md on every event, since',
  'the board is drawn from them.',
].join(' ')
const POLL_MS = 3000

const board = atom({ plugin: 'kss-ui', key: 'board' } as const, null)
const isBandHidden = atom({ plugin: 'kss-ui', key: 'isBandHidden' } as const, false)
const pending = atom({ plugin: 'kss-ui', key: 'pending' } as const, null)
const live = atom({ plugin: 'kss-ui', key: 'live' } as const, {})
const now = atom({ plugin: 'kss-ui', key: 'now' } as const, 0)
const quota = atom({ plugin: 'kss-ui', key: 'quota' } as const, null)

async function readText($: EngineInterface, path: string): Promise<string | null> {
  try {
    const text = await $.fs.read(path)
    return typeof text === 'string' ? text : null
  } catch {
    return null
  }
}

// Module-level: a reload starts them over, and session.start refills them.
let mode: GuardMode = 'phase-files'
let cwd = ''
let config: KssConfig | null = null
let tokens: number | null = null

async function load($: EngineInterface, withCost: boolean): Promise<KssBoard | null> {
  config = parseConfig(await readText($, `${cwd}/.kss/config.md`))
  const current = parseJson(await readText($, `${cwd}/.kss/current`))
  const feature = current && typeof current.feature === 'string' ? current.feature : null
  if (!config || !feature) return null
  const dir = `${cwd}/${config.featuresRoot}/${feature}`
  if (withCost) tokens = sumTokens(await readText($, `${dir}/metrics.jsonl`))
  return buildBoard(current, parseReadme(await readText($, `${dir}/README.md`)), tokens, {
    graph: await readText($, `${dir}/05-tickets/graph.md`),
    log: await readText($, `${dir}/06-execution.md`),
  })
}

async function refresh($: EngineInterface, withCost: boolean) {
  const next = await load($, withCost)
  const prev = await read($, board)
  if (JSON.stringify(prev) !== JSON.stringify(next)) {
    if (prev?.feature !== next?.feature) await update($, live, () => ({}))
    await update($, board, () => next)
    for (const text of events(prev, next)) $.ui.toast(text)
  }
  // Elapsed times are drawn against `now`: tick it while something runs, and only then.
  const b = await shown($)
  if (b?.phase === 'execute' && b.tickets.some(t => t.state === 'running' || t.state === 'reviewing')) {
    const t = await $.clock.now()
    await update($, now, () => t)
    if ((await read($, quota))?.feature !== b.feature) {
      // No reading off a subscription, or none yet: the board draws without the quota line.
      await $.session.usage().then(u => noteQuota($, u.rateLimits), () => undefined)
    }
  }
}

/** The board to draw: what the files say, with a phase the person just started laid over it. */
async function shown($: EngineInterface): Promise<KssBoard | null> {
  return withPending(await read($, board), await read($, pending))
}

/**
 * Runs the Next line — `/clear` first when asked, as each phase's summary says is safe. The command
 * is resolved against the session's list, so a plugin-namespaced `kss:kss-tickets` is found too;
 * one that cannot be resolved is put in the prompt instead.
 */
async function runNext($: EngineInterface, line: string, clearFirst: boolean) {
  const cmd = commandOf(line)
  const names = (await $.command.list()).map(c => c.name)
  const name = cmd && names.find(n => n === cmd.command || n.endsWith(`:${cmd.command}`))
  if (!cmd || !name) {
    await $.prompt.fill({ text: line })
    return
  }
  // A command a plugin runs skips that plugin's own command.run hook, so mark the phase here.
  const started = invocation(name, cmd.args)
  if (started) await update($, pending, () => started)
  if (clearFirst) {
    try {
      await $.command.run({ command: 'clear' })
    } catch {
      $.ui.toast('kss · could not /clear from here — run /clear, then Run here')
      await update($, pending, () => null)
      return
    }
  }
  await $.command.run({ command: name, args: cmd.args })
}

/**
 * Folds a rate-limit reading into the running execute's quota use. Kept in `$.store` per feature
 * too, so a resumed execute (a new session, after /clear) keeps its baseline.
 */
async function noteQuota($: EngineInterface, readings: readonly KssRateReading[]) {
  const b = await shown($)
  if (!b || b.phase !== 'execute' || b.isPhaseFinished || readings.length === 0) return
  const key = `quota:${b.feature}`
  const held = await read($, quota)
  const prev = held?.feature === b.feature ? held : ((await $.store.get(key)) as KssQuota | undefined) ?? null
  const next = trackQuota(prev, b.feature, readings)
  await update($, quota, () => next)
  await $.store.set(key, next)
}

/** The ticket whose live subagent is `agentId`. */
function ticketOfAgent(map: Record<string, KssLive>, agentId: string): string | null {
  return Object.entries(map).find(([, l]) => l.agentId === agentId)?.[0] ?? null
}

/** Records one step of a ticket's subagent: its turn count, or what it just did. */
async function noteAgent($: EngineInterface, agentId: string, patch: Partial<KssLive>) {
  const map = await read($, live)
  const id = ticketOfAgent(map, agentId)
  if (!id) return
  const t = await $.clock.now()
  await update($, live, m => {
    const cur = m[id]
    return cur && cur.agentId === agentId ? { ...m, [id]: { ...cur, ...patch, ...(patch.action ? { actionAt: t } : {}) } } : m
  })
}

/** A phase that printed `Safe to /clear.` must have committed its artifacts (DESIGN.md §3.8). */
async function checkCommitted($: EngineInterface) {
  if (!config) return
  const paths = [config.featuresRoot, '.kss/config.md', ...config.domainDocs, config.docsRoot].filter((p): p is string => !!p)
  try {
    const ran = await $.process.run(['git', 'status', '--porcelain', '--', ...paths], { cwd, timeoutMs: 5000 })
    const dirty = ran.stdout.split('\n').filter(Boolean)
    if (ran.exitCode === 0 && dirty.length) {
      $.ui.toast(`kss · ${dirty.length} artifact(s) left uncommitted after "Safe to /clear": ${dirty.slice(0, 3).map(l => l.slice(3)).join(', ')}`)
    }
  } catch {
    /* no git: nothing to say */
  }
}

export const register: Register = (on, options) => {
  mode = (options.guard as GuardMode | undefined) ?? 'phase-files'

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    await $.command.register({
      name: 'kss',
      description: 'KSS board. `/kss` opens it, `/kss next` puts the Next command in the prompt, `/kss band` shows or hides the band',
    })
    await refresh($, true)
    $.clock.every(POLL_MS, () => void refresh($, false))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refresh($, true)
    if (e.agentId !== undefined) await noteAgent($, e.agentId, { isDone: true })
    if (e.agentId === undefined) {
      // By the end of the turn the phase has written `.kss/current` itself (or failed to start).
      await update($, pending, () => null)
      if (/Safe to \/clear\./.test(e.answer)) await checkCommitted($)
    }
    return done
  })

  // ── Live execution: which subagent works on which ticket, its turns and its last action ──
  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    const b = await shown($)
    const ticket = ticketOf(e.prompt, e.description)
    if (b?.phase === 'execute' && ticket && 'agentId' in spawned && spawned.agentId) {
      const entry: KssLive = {
        agentId: spawned.agentId,
        role: /review/i.test(e.subagentType) ? 'reviewer' : 'executor',
        turns: 0,
        startedAt: await $.clock.now(),
        action: null,
        actionAt: null,
        isDone: false,
      }
      await update($, live, m => ({ ...m, [ticket]: entry }))
    }
    return spawned
  })

  // While the board shows the execute, the coordinator need not reprint it on every event.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const b = await shown($)
    if (b?.phase !== 'execute' || b.isPhaseFinished) return composed
    return { sections: [...composed.sections, { id: 'kss-ui-execute', text: QUIET_EXECUTE, scope: 'session' as const }] }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await noteQuota($, e.rateLimits)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) await noteAgent($, e.agentId, { turns: e.index + 1 })
    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) {
      await noteAgent($, e.agentId, { action: describeTool(String(e.tool), e as unknown as Record<string, unknown>) })
    }
    return next(e)
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    if (e.agentId !== undefined || mode === 'off') return next(e)
    const b = await shown($)
    if (!b || b.isClosed) return next(e)
    const reason = guard(mode, b.phase, e.file_path, cwd, config, b.feature)
    return reason ? { deny: reason } : next(e)
  })

  // `/kss-tickets 048-x` typed or run from a button: show the phase at once, before the skill
  // gets to write it.
  on('command.run', async ($, e, next) => {
    const started = invocation(e.command, e.args)
    if (started) await update($, pending, () => started)
    return next(e)
  })

  on('command.run', { command: 'kss' }, async ($, e) => {
    const arg = e.args.trim()
    const b = await shown($)
    if (arg === 'next') {
      if (!b?.next) return { text: 'No KSS Next line to run.' }
      await $.prompt.fill({ text: b.next })
      return { text: `Next: ${b.next}` }
    }
    if (arg === 'band') {
      await update($, isBandHidden, h => !h)
      return { text: 'KSS band toggled.' }
    }
    await $.ui.open({ id: PANE, title: 'KSS' })
    return { text: b ? `KSS board · ${b.feature}` : 'No active KSS run here.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const b = await shown($)
    if (!b || e.props.hasSurvey || (await read($, isBandHidden))) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const room = e.props.maxRows

    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        {pipeline(b, Box, Text)}
        {room > 2 && detail(b, await read($, live), await read($, now), await read($, quota), Text)}
        <Box gap={1}>
          <Text dimColor>Next</Text>
          <Text wrap="truncate-end">{b.next ?? '—'}</Text>
          {b.isPhaseFinished && b.next && (
            <Button key="clear-run" label="Clear & run" hotkey="c" variant="primary" onPress={() => runNext($, b.next!, true)} />
          )}
          {b.isPhaseFinished && b.next && (
            <Button key="run" label="Run here" hotkey="r" onPress={() => runNext($, b.next!, false)} />
          )}
          <Button key="board" label="Board" hotkey="b" onPress={() => $.ui.open({ id: PANE, title: 'KSS' })} />
          <Button key="hide" label="Hide" hotkey="h" onPress={() => update($, isBandHidden, () => true)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const b = await shown($)
    const { Box, Text, Button } = $.ui.resolve(e)
    if (!b) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No active KSS run in this folder.</Text>
          <Text dimColor>Start one with /kss-clarify &lt;request&gt;.</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1} width={e.props.bodyColumns}>
        <Box flexDirection="column">
          <Text bold>
            kss · {b.feature}
            <Text dimColor>
              {' '}· {b.size ?? '?'}{b.harness ? ` · ${b.harness}` : ''}
            </Text>
          </Text>
          {b.phases.map(p => (
            <Text key={p.name} color={p.mark === 'done' ? 'green' : p.mark === 'current' ? 'yellow' : undefined} dimColor={p.mark === 'todo'} bold={p.mark === 'current'}>
              {p.mark === 'done' ? '✓' : p.mark === 'current' ? '▸' : '·'} {p.name}
            </Text>
          ))}
        </Box>

        {b.grill && grillQueue(b.grill, Box, Text)}

        {b.tickets.length > 0 && executeBoard(b, await read($, live), await read($, now), await read($, quota), e.props.bodyColumns, Box, Text)}

        <Text dimColor>
          {b.tokens !== null ? `${human(b.tokens)} tok` : ''}
          {b.turns !== null ? ` · ${b.turns} turns` : ''}
          {b.ctx !== null ? ` · ctx ${human(b.ctx)}` : ''}
        </Text>

        <Box gap={1}>
          <Text dimColor>Next</Text>
          <Text>{b.next ?? '—'}</Text>
          {b.isPhaseFinished && b.next && (
            <Button key="clear-run" label="Clear & run" hotkey="c" variant="primary" onPress={() => runNext($, b.next!, true)} />
          )}
          {b.isPhaseFinished && b.next && (
            <Button key="run" label="Run here" hotkey="r" onPress={() => runNext($, b.next!, false)} />
          )}
        </Box>
      </Box>
    )
  })
}

function stateColor(state: string): string | undefined {
  return state === 'integrated' ? 'green' : state === 'running' || state === 'reviewing' ? 'yellow' : state === 'rejected' ? 'red' : undefined
}

// The elements come from the surface's table, so the small pieces take them as arguments.
type El = any

function pipeline(b: KssBoard, Box: El, Text: El) {
  return (
    <Box gap={1}>
      <Text bold color="cyan">kss {short(b.feature)}</Text>
      <Text wrap="truncate-end">
        {b.phases.map((p, i) => (
          <Text key={p.name} color={p.mark === 'done' ? 'green' : p.mark === 'current' ? 'yellow' : undefined} dimColor={p.mark === 'todo'} bold={p.mark === 'current'}>
            {i ? ' ' : ''}{p.mark === 'done' ? '✓' : p.mark === 'current' ? '▸' : ''}{p.name}
          </Text>
        ))}
      </Text>
    </Box>
  )
}

/** The one line that says how far the running phase is. */
function detail(b: KssBoard, liveMap: Record<string, KssLive>, nowMs: number, q: KssQuota | null, Text: El) {
  if (b.grill) {
    const g = b.grill
    const cat = (name: string, c: { done: number; total: number } | null) => (c ? ` · ${name} ${c.done}/${c.total}` : '')
    return (
      <Text wrap="truncate-end">
        <Text color="yellow">grill {bar(g.asked, g.total, 8)} Q{g.asked}/{g.total}</Text>
        <Text dimColor>
          {cat('business', g.business)}{cat('layout', g.layout)}{cat('technical', g.technical)}
          {g.deferred ? ` · deferred ${g.deferred}` : ''}
        </Text>
      </Text>
    )
  }
  if (b.total || b.tickets.length) {
    const active = b.tickets.filter(t => t.state === 'running' || t.state === 'reviewing')
    const integrated = b.integrated ?? b.tickets.filter(t => t.state === 'integrated').length
    const total = b.total ?? b.tickets.length
    const started = b.phaseStartedAt ? Date.parse(b.phaseStartedAt) : null
    return (
      <Text wrap="truncate-end">
        <Text color="yellow">{bar(integrated, total, 8)} {integrated}/{total} integrated</Text>
        <Text dimColor>
          {started && nowMs ? ` · ${since(started, nowMs)}` : ''}
          {q?.feature === b.feature ? q.windows.map(w => ` · +${usedBy(w)}% ${w.kind === 'five_hour' ? 'session' : 'week'}`).join('') : ''}
        </Text>
        {active.map(t => {
          const l = liveMap[t.id]
          const turns = l && !l.isDone ? l.turns : t.turns
          return (
            <Text key={t.id}>
              <Text dimColor> │ </Text>
              <Text color={stateColor(t.state)}>{t.id}</Text>
              <Text dimColor>
                {' '}{t.state === 'reviewing' ? 'review' : l?.action ?? 'starting'}
                {turns !== null && turns !== undefined ? ` ${turns}/${t.est ?? '?'}t` : ''}
              </Text>
            </Text>
          )
        })}
      </Text>
    )
  }
  if (b.explorers) {
    return <Text dimColor>{b.explorers.running} explorers out · {b.explorers.returned} back</Text>
  }
  if (b.review) {
    return <Text dimColor>review round {b.review.round ?? '?'}{b.review.watching ? ` · watching ${b.review.watching}` : ''}</Text>
  }
  return <Text dimColor>{b.isPhaseFinished ? `${b.phase} done` : `${b.phase} running`}{b.tokens ? ` · ${human(b.tokens)} tok` : ''}</Text>
}

function grillQueue(g: KssGrill, Box: El, Text: El) {
  const row = (name: string, c: { done: number; total: number } | null) =>
    c && (
      <Text key={name} color={c.done >= c.total ? 'green' : undefined}>
        {name.padEnd(10)} {bar(c.done, c.total, 6)} {c.done}/{c.total}
      </Text>
    )
  return (
    <Box flexDirection="column">
      <Text bold>Grill · Q{g.asked}/{g.total}{g.deferred ? ` · ${g.deferred} deferred` : ''}</Text>
      {row('business', g.business)}
      {row('layout', g.layout)}
      {row('technical', g.technical)}
      {g.current && <Text color="yellow" wrap="truncate-end">▸ {g.current}</Text>}
    </Box>
  )
}

const MARK: Record<string, string> = { integrated: '✓', running: '▸', reviewing: '◆', rejected: '✗', blocked: '·', ready: '○' }

/** One ticket's row and, while it runs, the line saying what its subagent is doing. */
function ticketRows(t: KssTicket, l: KssLive | undefined, nowMs: number, width: number, Box: El, Text: El) {
  const isActive = t.state === 'running' || t.state === 'reviewing'
  const turns = l && !l.isDone ? l.turns : t.turns
  const startedMs = l?.startedAt ?? (t.startedAt ? Date.parse(t.startedAt) : null)
  const titleWidth = Math.max(8, width - 44)
  const title = (t.title ?? '').length > titleWidth ? (t.title ?? '').slice(0, titleWidth - 1) + '…' : (t.title ?? '')
  const isOver = turns !== null && t.est !== null && turns > t.est
  return (
    <Box key={t.id} flexDirection="column">
      <Text color={stateColor(t.state)} dimColor={t.state === 'blocked'}>
        {MARK[t.state] ?? ' '} {t.id} {title.padEnd(titleWidth)} {(t.tier ?? '').padEnd(3)}
        <Text color={isOver ? 'red' : undefined} dimColor={!isActive}>
          {' '}{t.est ? bar(turns ?? 0, t.est, 10) : ''.padEnd(10)} {`${turns ?? 0}/${t.est ?? '?'}t`.padEnd(8)}
        </Text>
        <Text dimColor>{isActive && startedMs && nowMs ? since(startedMs, nowMs).padStart(6) : ''.padStart(6)} {t.state}</Text>
      </Text>
      {isActive && (
        <Text dimColor wrap="truncate-end">
          {'      ↳ '}{l?.role === 'reviewer' || t.state === 'reviewing' ? 'reviewer: ' : ''}{l?.action ?? 'starting…'}
          {l?.actionAt && nowMs ? ` · ${since(l.actionAt, nowMs)} ago` : ''}
        </Text>
      )}
      {t.state === 'blocked' && t.blockedBy.length > 0 && <Text dimColor>{`      waits on ${t.blockedBy.join(', ')}`}</Text>}
    </Box>
  )
}

/** The execute board: the run's progress, one row per ticket, and the last lines of the log. */
function executeBoard(b: KssBoard, liveMap: Record<string, KssLive>, nowMs: number, q: KssQuota | null, width: number, Box: El, Text: El) {
  const integrated = b.integrated ?? b.tickets.filter(t => t.state === 'integrated').length
  const total = b.total ?? b.tickets.length
  const used = b.tickets.reduce((n, t) => n + ((liveMap[t.id] && !liveMap[t.id]!.isDone ? liveMap[t.id]!.turns : t.turns) ?? 0), 0)
  const est = b.tickets.reduce((n, t) => n + (t.est ?? 0), 0)
  const started = b.phaseStartedAt ? Date.parse(b.phaseStartedAt) : null
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>
          Execute {bar(integrated, total)} {integrated}/{total} integrated
          <Text dimColor>
            {est ? ` · ${Math.round((used / est) * 100)}% of est. turns` : ''}
            {started && nowMs ? ` · ${since(started, nowMs)}` : ''}
          </Text>
        </Text>
        {q?.feature === b.feature && quotaLine(q, nowMs) && <Text dimColor>{`Quota  ${quotaLine(q, nowMs)}`}</Text>}
        {b.tickets.map(t => ticketRows(t, liveMap[t.id], nowMs, width, Box, Text))}
      </Box>
      {b.log.length > 0 && (
        <Box flexDirection="column">
          <Text bold>Recent</Text>
          {b.log.map((l, i) => (
            <Text key={String(i)} dimColor={i < b.log.length - 1} wrap="truncate-end">
              {(/T(\d{2}:\d{2})/.exec(l.at)?.[1] ?? l.at).padEnd(6)}{(l.ticket ?? '').padEnd(4)}{l.event}{l.detail ? ` · ${l.detail}` : ''}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}
