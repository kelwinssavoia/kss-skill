// What process each terminal runs (DESIGN.md §24.3). Pure, so the tests pin it.

import type { Harness, TerminalSpec } from './types.ts'

export type Launch = { file: string; args: string[]; title: string }

/** `/kss-spec 012-x` in Claude Code, `$kss-spec 012-x` in Codex. */
export function phasePrompt(harness: Harness, phase: string, args: string): string {
  return `${harness === 'codex' ? '$' : '/'}kss-${phase}${args.trim() ? ` ${args.trim()}` : ''}`
}

export const binOf = (h: Harness) => (h === 'codex' ? 'codex' : 'claude')

/** Each CLI's flag for running without permission prompts (Claude Code's bypassPermissions mode). */
export const BYPASS: Record<Harness, string> = {
  'claude-code': '--dangerously-skip-permissions',
  codex: '--dangerously-bypass-approvals-and-sandbox',
}

/** A chat that may read but not change anything: the grill's side chat (DESIGN.md §24.7). */
export const READONLY: Record<Harness, string[]> = {
  'claude-code': ['--permission-mode', 'plan'],
  codex: ['--sandbox', 'read-only', '--ask-for-approval', 'never'],
}

/** Every phase the app starts gets `--app`: it then publishes what it waits on for the app (DESIGN.md §26). */
const NO_APP = new Set(['status'])
export const appArgs = (phase: string, args: string) => (!NO_APP.has(phase) && !/(^|\s)--app\b/.test(args) ? `${args.trim()} --app`.trim() : args)

export const label = (h: Harness) => (h === 'codex' ? 'Codex' : 'Claude')

export function launchOf(spec: TerminalSpec, shell: string): Launch {
  if (spec.kind === 'shell') return { file: shell, args: ['-l'], title: 'Terminal' }
  if (spec.kind === 'qa') {
    if (!spec.qa) throw new Error('a qa terminal needs a step')
    const { step, feature, only, force } = spec.qa
    const args = ['.kss/scripts/qa.mjs', step]
    // down and status act on whatever environment is up; every other step names the feature.
    if (step !== 'down' && step !== 'status') args.push('--feature', feature)
    if (only) args.push('--only', only)
    if (force) args.push('--force')
    return { file: 'node', args, title: `qa ${step}${only ? ` ${only}` : ''}` }
  }
  const h = spec.harness ?? 'claude-code'
  const bypass = !!spec.bypass && !spec.readonly
  const flags = spec.readonly ? READONLY[h] : bypass ? [BYPASS[h]] : []
  const mark = bypass ? ' ⚡' : ''
  if (spec.kind === 'phase' && !spec.phase) throw new Error('a phase terminal needs a phase')
  const title = (spec.title ?? (spec.kind === 'chat' ? `${label(h)} chat` : `${spec.phase} · ${label(h)}`)) + mark
  if (spec.resume) {
    // A resumed conversation carries its own history; the phase prompt is not sent again.
    return h === 'codex'
      ? { file: 'codex', args: ['resume', ...flags, spec.resume], title }
      : { file: 'claude', args: [...flags, '--resume', spec.resume], title }
  }
  const id = h === 'claude-code' && spec.sessionId ? ['--session-id', spec.sessionId] : []
  const prompt = spec.kind === 'phase' ? phasePrompt(h, spec.phase!, appArgs(spec.phase!, spec.args ?? '')) : spec.prompt
  return { file: binOf(h), args: [...flags, ...id, ...(prompt ? [prompt] : [])], title }
}

/** A README `Next:` line → the phase and its arguments, whichever prefix it was written with. */
export function parseNext(next: string | null): { phase: string; args: string } | null {
  const m = next ? /^[/$](?:kss:)?kss-([a-z-]+)\s*(.*)$/.exec(next.trim()) : null
  if (!m) return null
  // `/kss-review 012-x (optional first: /kss-qa 012-x)` — the parenthesis is advice, not arguments.
  return { phase: m[1]!, args: m[2]!.replace(/\s*\(.*\)\s*$/, '').trim() }
}

/** The optional phase a Next line offers first, e.g. `(optional first: /kss-qa 012-x)`. */
export function optionalOf(next: string | null): { phase: string; args: string } | null {
  const m = next ? /\(optional first:\s*([^)]+)\)/.exec(next) : null
  return m ? parseNext(m[1]!) : null
}
