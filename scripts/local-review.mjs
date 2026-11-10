#!/usr/bin/env node
// local-review.mjs — kss-review's local saturation (DESIGN.md §15.2).
//
//   node .kss/scripts/local-review.mjs start --feature <dir> --round <n> [--base <branch>]
//        [--exclude <file>] [--pending <ticket path>,<ticket path>…]
//       Start pass 1 of the round on HEAD — `parallel` read-only reviewer runs at once — and return.
//       A round already started on the same HEAD is not restarted: its state is answered instead.
//   node .kss/scripts/local-review.mjs wait --feature <dir> --round <n> [--slice 540] [--every 15]
//       Poll the running pass. When it ends, merge its findings into the round's list and decide:
//       `saturated` (the pass added nothing new — the list is complete), `cap` (`max_passes` reached
//       and the last pass still found something), `error` (every run of the pass failed), or start
//       the next pass — whose prompt names everything found so far as do-not-re-raise — and keep
//       polling. Answers `pending` after `--slice` seconds so it fits one foreground command; call
//       it again.
//   node .kss/scripts/local-review.mjs findings --feature <dir> --round <n>
//       The round's state and findings, as stored.
//
// Why: a PR reviewer that re-reviews on every push (Codex) posts a handful of findings per pass, a
// different handful each time. On a 20k-line feature that is a fix-and-push cycle per handful —
// PR #418/#421 (Upcharge) took six rounds and 32 findings that way. Run locally, the same reviewer
// is asked again and again on the same HEAD, told what it already said, until a pass adds nothing;
// only then does the round write fix tickets. PR #421: 12 findings in five passes, the sixth and
// seventh clean.
//
// Config: `review_local` in the layered config (DEFAULTS ← `.kss/config.json` ←
// `.kss/config.local.json`). `cli: 'auto'` takes the NEWEST `codex` among PATH and the desktop
// app's bundled CLI: a stale one on PATH rejects current models with `model_not_found`.
// `KSS_CODEX_CLI` overrides it. Files land in `<feature>/notes/review-<round>-local/`.
// Exit 0 carries the JSON answer, exit 1 is a usage error.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalConfig } from './jev.mjs'

export const PRIORITIES = ['P0', 'P1', 'P2']

/** Strict structured output: every property required, nothing else allowed. */
export const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['priority', 'file', 'line', 'title', 'scenario', 'mechanism'],
        properties: {
          priority: { type: 'string', enum: PRIORITIES },
          file: { type: 'string' },
          line: { type: 'integer' },
          title: { type: 'string' },
          scenario: { type: 'string' },
          mechanism: { type: 'string' },
        },
      },
    },
  },
}

/** The desktop apps' bundled CLIs — usually newer than a `codex` installed on PATH long ago. */
const APP_CLIS = [
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
  '/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex',
]

// ---------------------------------------------------------------- pure

/** The reviewer's prompt for one pass. `exclude` is everything found so far this round. */
export function buildPrompt({ base, featureDir, exclude = [], pending = [], excludeText = '' }) {
  const lines = [
    'You are reviewing a pull request. The change under review is',
    `\`git diff origin/${base}...HEAD\` in this repository: run \`git diff --stat origin/${base}...HEAD\` first, then read the diff and the code around it.`,
    '',
    "Follow the project's review guidelines (AGENTS.md, CLAUDE.md) where it has them.",
    '',
    'Goal: an EXHAUSTIVE list. Report every P0, P1 and P2 finding you can establish on the current head, grouped by mechanism (the persisted state or flow it breaks). There is no cap on the number of findings — do not stop at the first few. Weight first: tenant isolation, authorization, money, the wire contract, side effects and their lifecycle, deploy order.',
    '',
    'Already settled — read these first and do NOT re-raise what they decide or answer:',
    `- ${featureDir}/02-decisions.md (D-), ${featureDir}/auto-decisions.md (AD-), ${featureDir}/07-review.md (earlier RV- findings and their resolutions).`,
  ]
  if (pending.length) {
    lines.push(
      '- Fix tickets written but not executed yet — the code does not have them. Raise something they cover only if the ticket as written would NOT fix it:',
      ...pending.map((p) => `  - ${p}`),
    )
  }
  if (excludeText.trim()) lines.push('', 'Reported on the PR this round — do NOT re-raise:', excludeText.trim())
  if (exclude.length) {
    lines.push('', 'Already found in this round — do NOT re-raise these; raise only something different:')
    exclude.forEach((x, i) => lines.push(`${i + 1}. ${x.file}:${x.line} — ${x.title}`))
  }
  lines.push(
    '',
    'Do not run tests, jest, nx, lint, tsc or builds. Read code only.',
    '',
    'For each finding give: priority (P0/P1/P2), file (repository-relative path), line, a one-line title, the concrete failure scenario (inputs/state -> wrong result) and the mechanism. Nothing new beyond the lists above → an empty findings array.',
  )
  return lines.join('\n') + '\n'
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'its', 'are', 'not', 'when', 'that', 'this', 'than', 'then', 'before', 'after'])

const words = (t) => new Set(String(t ?? '').toLowerCase().split(/[^a-z0-9_]+/).filter((w) => w.length >= 3 && !STOP.has(w)))

/** A repository-relative path, whatever the reviewer wrote (absolute, `./`, a `path:line` tail). */
export function normFile(file, root) {
  let p = String(file ?? '').trim().replace(/:\d+(-\d+)?$/, '')
  if (root && isAbsolute(p)) p = relative(root, p)
  return p.replace(/^\.\//, '')
}

/**
 * Two findings are one when they sit in the same file and are named alike — closely (≥ 0.5 of
 * their title words), or loosely (≥ 0.2) when also within 15 lines. Nearness alone is not enough:
 * two different bugs often share a line, and a lost finding costs a review round, a duplicate only
 * a line in the triage table.
 */
export function sameFinding(a, b, root) {
  if (normFile(a.file, root) !== normFile(b.file, root)) return false
  const x = words(a.title)
  const y = words(b.title)
  if (!x.size || !y.size) return false
  let inter = 0
  for (const w of x) if (y.has(w)) inter++
  const sim = inter / (x.size + y.size - inter)
  const near = Math.abs((a.line ?? 0) - (b.line ?? 0)) <= 15
  return sim >= 0.5 || (near && sim >= 0.2)
}

const idNum = (id) => Number(String(id).replace(/^L-/, '')) || 0
const pad = (n) => `L-${String(n).padStart(2, '0')}`

/** Pure: add what is unlike every known finding (and unlike each other), ids continuing. */
export function mergeFindings(known, incoming, pass, root) {
  const all = [...known]
  const added = []
  let next = known.reduce((m, x) => Math.max(m, idNum(x.id)), 0)
  for (const raw of incoming) {
    const item = { ...raw, file: normFile(raw.file, root) }
    if (all.some((k) => sameFinding(k, item, root))) continue
    const row = { id: pad(++next), ...item, pass }
    all.push(row)
    added.push(row)
  }
  return { all, added }
}

/** Pure: what the round does after a pass. */
export function decide({ pass, added, ok }, { max_passes }) {
  if (!ok) return 'error'
  if (!added) return 'saturated'
  if (pass >= max_passes) return 'cap'
  return 'continue'
}

export function parseVersion(text) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? ''))
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** Pure: the newest candidate; one whose version cannot be read never wins. */
export function pickCli(candidates) {
  const ok = candidates.map((c) => ({ ...c, v: parseVersion(c.version) })).filter((c) => c.v)
  ok.sort((a, b) => b.v[0] - a.v[0] || b.v[1] - a.v[1] || b.v[2] - a.v[2])
  return ok.length ? ok[0].path : null
}

// ---------------------------------------------------------------- effects

function resolveCli(rc) {
  if (process.env.KSS_CODEX_CLI) return process.env.KSS_CODEX_CLI
  if (rc.cli && rc.cli !== 'auto') return rc.cli
  const which = spawnSync('which', ['-a', 'codex'], { encoding: 'utf8' })
  const paths = [...new Set([...(which.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean), ...APP_CLIS])].filter((p) => existsSync(p))
  return pickCli(
    paths.map((path) => {
      const r = spawnSync(path, ['--version'], { encoding: 'utf8' })
      return { path, version: r.status === 0 ? r.stdout : null }
    }),
  )
}

function head(cwd) {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}

const dirOf = (cwd, featureDir, round) => join(cwd, featureDir, 'notes', `review-${round}-local`)
const readJson = (p, fallback) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return fallback
  }
}
const save = (dir, state) => writeFileSync(join(dir, 'state.json'), JSON.stringify(state, null, 2) + '\n')

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Start every run of the next pass, detached; each writes `<run>.done` with its exit code. */
function launchPass(state, dir, cwd) {
  const pass = state.history.length + 1
  const promptPath = join(dir, `prompt-${pass}.md`)
  writeFileSync(
    promptPath,
    buildPrompt({ base: state.base, featureDir: state.feature, exclude: state.findings, pending: state.pending, excludeText: state.exclude_text }),
  )
  const schemaPath = join(dir, 'schema.json')
  if (!existsSync(schemaPath)) writeFileSync(schemaPath, JSON.stringify(FINDING_SCHEMA, null, 2) + '\n')
  const runs = []
  for (let k = 1; k <= state.config.parallel; k++) {
    const base = join(dir, `pass-${pass}-${k}`)
    const args = [
      'exec',
      '-s',
      'read-only',
      '--ephemeral',
      '-m',
      state.config.model,
      '-c',
      `model_reasoning_effort=${state.config.reasoning_effort}`,
      '-C',
      cwd,
      '--output-schema',
      schemaPath,
      '-o',
      `${base}.json`,
      '-',
    ]
    const child = spawn('/bin/sh', ['-c', '"$0" "$@" < "$KSS_PROMPT" > "$KSS_LOG" 2>&1; echo $? > "$KSS_DONE"', state.cli, ...args], {
      cwd,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, KSS_PROMPT: promptPath, KSS_LOG: `${base}.log`, KSS_DONE: `${base}.done` },
    })
    child.unref()
    runs.push({ k, pid: child.pid, out: `${base}.json`, done: `${base}.done`, log: `${base}.log`, started_at: new Date().toISOString() })
  }
  state.current = { pass, runs }
  state.status = 'running'
}

function writeFindingsMd(dir, state) {
  const lines = [
    `# Local review · round ${state.round}`,
    '',
    `HEAD \`${state.head}\` · ${state.history.length} passes · outcome **${state.outcome}** · ${state.config.model} ${state.config.reasoning_effort}`,
    '',
    ...state.history.map((h) => `- pass ${h.pass}: +${h.added} new (${h.ok} ok, ${h.failed} failed)`),
    '',
  ]
  for (const x of state.findings) {
    lines.push(`- **${x.id} · ${x.priority} · ${x.file}:${x.line} — ${x.title}**`, `  ${x.scenario}`, `  Mechanism: ${x.mechanism} · pass ${x.pass}`)
  }
  writeFileSync(join(dir, 'findings.md'), lines.join('\n') + '\n')
}

const answer = (state, dir) => ({
  outcome: state.outcome ?? state.status,
  round: state.round,
  head: state.head,
  passes: state.history.length,
  pass: state.current?.pass ?? null,
  findings: state.findings,
  dir,
})

function start(flags, cwd) {
  const { feature, round } = flags
  if (!feature || !round) out({ error: 'start needs --feature <dir> and --round <n>' }, 1)
  const { cfg } = loadLocalConfig(cwd)
  const rc = cfg.review_local ?? {}
  if (rc.enabled === false) out({ outcome: 'skipped', reason: 'review_local.enabled is false' })
  const cli = resolveCli(rc)
  if (!cli) out({ outcome: 'skipped', reason: 'no codex CLI found (set review_local.cli or KSS_CODEX_CLI)' })
  const dir = dirOf(cwd, feature, round)
  mkdirSync(dir, { recursive: true })
  const at = head(cwd)
  const prev = readJson(join(dir, 'state.json'), null)
  if (prev && prev.head === at) out(answer(prev, dir))
  const excludeText = flags.exclude ? readFileSync(resolve(cwd, flags.exclude), 'utf8') : ''
  const state = {
    feature,
    round: Number(round),
    base: flags.base ?? 'main',
    head: at,
    cli,
    config: {
      model: rc.model,
      reasoning_effort: rc.reasoning_effort,
      parallel: Math.max(1, Number(rc.parallel) || 1),
      max_passes: Math.max(1, Number(rc.max_passes) || 1),
      pass_timeout_min: Math.max(1, Number(rc.pass_timeout_min) || 30),
    },
    pending: flags.pending ? flags.pending.split(',').map((s) => s.trim()).filter(Boolean) : [],
    exclude_text: excludeText,
    findings: [],
    history: [],
    started_at: new Date().toISOString(),
  }
  launchPass(state, dir, cwd)
  save(dir, state)
  out({ ...answer(state, dir), outcome: 'started' })
}

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** Close the current pass if every run is done (or timed out); true when it was closed. */
function closePass(state, cwd) {
  const limit = state.config.pass_timeout_min * 60_000
  let pending = 0
  for (const r of state.current.runs) {
    if (existsSync(r.done) || r.killed) continue
    if (Date.now() - Date.parse(r.started_at) > limit || !alive(r.pid)) {
      try {
        process.kill(-r.pid, 'SIGTERM')
      } catch {
        /* already gone */
      }
      r.killed = true
      continue
    }
    pending++
  }
  if (pending) return false
  let ok = 0
  let failed = 0
  const incoming = []
  for (const r of state.current.runs) {
    const code = existsSync(r.done) ? readFileSync(r.done, 'utf8').trim() : 'killed'
    const body = code === '0' ? readJson(r.out, null) : null
    if (body && Array.isArray(body.findings)) {
      ok++
      incoming.push(...body.findings.filter((x) => x && typeof x.file === 'string' && typeof x.title === 'string'))
    } else failed++
  }
  const pass = state.current.pass
  const { all, added } = mergeFindings(state.findings, incoming, pass, cwd)
  state.findings = all
  state.history.push({ pass, added: added.length, ok, failed, at: new Date().toISOString() })
  state.current = null
  return true
}

function wait(flags, cwd) {
  const { feature, round } = flags
  if (!feature || !round) out({ error: 'wait needs --feature <dir> and --round <n>' }, 1)
  const dir = dirOf(cwd, feature, round)
  const state = readJson(join(dir, 'state.json'), null)
  if (!state) out({ error: `no local review started for round ${round} — run start first` }, 1)
  const every = Math.max(1, Number(flags.every ?? 15)) * 1000
  const stopAt = Date.now() + Math.max(5, Number(flags.slice ?? 540)) * 1000
  for (;;) {
    if (state.outcome) out(answer(state, dir))
    if (state.current && closePass(state, cwd)) {
      const last = state.history[state.history.length - 1]
      const next = decide(last, state.config)
      if (next === 'continue') launchPass(state, dir, cwd)
      else {
        state.outcome = next
        state.status = 'done'
        state.finished_at = new Date().toISOString()
        writeFindingsMd(dir, state)
      }
      save(dir, state)
      continue
    }
    if (Date.now() + every > stopAt) out({ ...answer(state, dir), outcome: 'pending', findings: state.findings.length })
    pause(every)
  }
}

// ---------------------------------------------------------------- CLI

function out(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n')
  process.exit(code)
}

function usage() {
  process.stderr.write(
    'usage: local-review.mjs start --feature <dir> --round <n> [--base <branch>] [--exclude <file>] [--pending <a,b>] [--cwd <dir>]\n' +
      '       local-review.mjs wait --feature <dir> --round <n> [--slice 540] [--every 15] [--cwd <dir>]\n' +
      '       local-review.mjs findings --feature <dir> --round <n> [--cwd <dir>]\n',
  )
  process.exit(1)
}

function main() {
  const argv = process.argv.slice(2)
  const [cmd] = argv
  const flags = {}
  for (let k = 1; k < argv.length; k++) if (argv[k].startsWith('--')) flags[argv[k].slice(2)] = argv[++k]
  const cwd = flags.cwd ? resolve(flags.cwd) : process.cwd()
  if (cmd === 'start') return start(flags, cwd)
  if (cmd === 'wait') return wait(flags, cwd)
  if (cmd === 'findings') {
    if (!flags.feature || !flags.round) usage()
    const dir = dirOf(cwd, flags.feature, flags.round)
    const state = readJson(join(dir, 'state.json'), null)
    if (!state) out({ error: `no local review for round ${flags.round}` }, 1)
    return out(answer(state, dir))
  }
  usage()
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
