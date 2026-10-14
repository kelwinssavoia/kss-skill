// What process each terminal runs (DESIGN.md §24.3). Pure, so the tests pin it.

import type { Harness, TerminalSpec } from './types.ts'

export type Launch = { file: string; args: string[]; title: string }

/** `/kss-spec 012-x` in Claude Code, `$kss-spec 012-x` in Codex. */
export function phasePrompt(harness: Harness, phase: string, args: string): string {
  return `${harness === 'codex' ? '$' : '/'}kss-${phase}${args.trim() ? ` ${args.trim()}` : ''}`
}

export const binOf = (h: Harness) => (h === 'codex' ? 'codex' : 'claude')

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
  if (spec.kind === 'chat') return { file: binOf(h), args: [], title: `${label(h)} chat` }
  if (!spec.phase) throw new Error('a phase terminal needs a phase')
  return { file: binOf(h), args: [phasePrompt(h, spec.phase, spec.args ?? '')], title: `${spec.phase} · ${label(h)}` }
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
