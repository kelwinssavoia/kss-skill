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

import type { KssBoard, KssGrill } from '../types'
import {
  bar, buildBoard, commandOf, events, guard, human, invocation, parseConfig, parseJson, parseReadme,
  short, sumTokens, withPending,
} from './kss'
import type { GuardMode, KssConfig } from './kss'

const PANE = 'kss-board'
const POLL_MS = 3000

const board = atom({ plugin: 'kss-ui', key: 'board' } as const, null)
const isBandHidden = atom({ plugin: 'kss-ui', key: 'isBandHidden' } as const, false)
const pending = atom({ plugin: 'kss-ui', key: 'pending' } as const, null)

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
  return buildBoard(current, parseReadme(await readText($, `${dir}/README.md`)), tokens)
}

async function refresh($: EngineInterface, withCost: boolean) {
  const next = await load($, withCost)
  const prev = await read($, board)
  if (JSON.stringify(prev) === JSON.stringify(next)) return
  await update($, board, () => next)
  for (const text of events(prev, next)) $.ui.toast(text)
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
    if (e.agentId === undefined) {
      // By the end of the turn the phase has written `.kss/current` itself (or failed to start).
      await update($, pending, () => null)
      if (/Safe to \/clear\./.test(e.answer)) await checkCommitted($)
    }
    return done
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
        {room > 2 && detail(b, Text)}
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

        {b.tickets.length > 0 && (
          <Box flexDirection="column">
            <Text bold>
              Tickets {b.total ? `${bar(b.integrated ?? 0, b.total)} ${b.integrated ?? 0}/${b.total} integrated` : ''}
            </Text>
            {b.tickets.map(t => (
              <Text key={t.id} color={stateColor(t.state)}>
                {t.id.padEnd(4)}{t.state.padEnd(11)}{(t.tier ?? '').padEnd(4)}
                <Text dimColor>{t.turns !== null ? ` ${t.turns}/${t.est ?? '?'}t` : ''}</Text>
              </Text>
            ))}
            {b.last && <Text dimColor>last: {b.last}</Text>}
          </Box>
        )}

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
function detail(b: KssBoard, Text: El) {
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
  if (b.total) {
    const running = b.tickets.filter(t => t.state === 'running').map(t => t.id)
    return (
      <Text wrap="truncate-end">
        <Text color="yellow">{bar(b.integrated ?? 0, b.total, 8)} {b.integrated ?? 0}/{b.total} integrated</Text>
        <Text dimColor>{running.length ? ` · running ${running.join(', ')}` : ''}{b.last ? ` · ${b.last}` : ''}</Text>
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
