#!/usr/bin/env node
// harness.mjs — which agent harness is running this phase (DESIGN.md §19).
//
//   node .kss/scripts/harness.mjs              print `<name>` then the adapter path, record the name
//   node .kss/scripts/harness.mjs --name       print the name only
//   node .kss/scripts/harness.mjs --adapter    print the adapter path only
//   node .kss/scripts/harness.mjs --set <name> record <name> without detecting
//   node .kss/scripts/harness.mjs --no-write   detect and print, touch nothing
//
// KSS runs the same feature folder from more than one harness — the spec phases in one, the
// execution in another — so no artifact may carry harness vocabulary. What differs (how a subagent
// is spawned, what a tier maps to, how the context is cleared) lives in one adapter file per
// harness, and this script is what names it.
//
// Detection order: KSS_HARNESS → environment markers → process ancestry → the name recorded in
// `.kss/current` → `unknown`. `unknown` is not an error: the skill asks the user once and calls
// `--set`. Nothing here throws.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const lib = await (async () => {
  try {
    return await import('./kss-lib.mjs')
  } catch {
    return await import('../hooks/kss-lib.mjs')
  }
})()
const { readCurrent, currentPath, writeJsonFile } = lib

export const HARNESSES = ['claude-code', 'codex']

/** Adapter file a skill reads for everything harness-specific. Empty when the harness is unknown. */
export function adapterPath(name) {
  return HARNESSES.includes(name) ? join('.kss', 'references', `harness-${name}.md`) : ''
}

/** Environment variables each harness sets in the shell it gives a skill. */
const ENV_MARKERS = {
  'claude-code': ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_EXECPATH'],
  codex: ['CODEX_HOME', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED', 'CODEX_CLI_PATH', 'CODEX_THREAD_ID'],
}

/** Process names in the ancestry chain, longest match first so `claude-code` beats `code`. */
const PROC_MARKERS = [
  [/(^|[^a-z])codex([^a-z]|$)|chatgpt/i, 'codex'],
  [/claude/i, 'claude-code'],
]

export function fromEnv(env) {
  for (const [name, keys] of Object.entries(ENV_MARKERS)) {
    if (keys.some((k) => env[k] !== undefined && env[k] !== '')) return name
  }
  return null
}

/**
 * Walk up the parent-process chain looking for a harness binary. macOS and Linux only; every
 * failure (no `ps`, a pid that vanished, a cycle) returns null rather than throwing.
 */
export function fromAncestry(startPid = process.ppid, depth = 8, exec = defaultPs) {
  let pid = startPid
  const seen = new Set()
  for (let i = 0; i < depth; i++) {
    if (!pid || pid <= 1 || seen.has(pid)) return null
    seen.add(pid)
    const row = exec(pid)
    if (!row) return null
    for (const [re, name] of PROC_MARKERS) if (re.test(row.comm)) return name
    pid = row.ppid
  }
  return null
}

function defaultPs(pid) {
  try {
    const out = execFileSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
    })
    const m = /^\s*(\d+)\s+(.*)$/.exec(out.trim())
    if (!m) return null
    return { ppid: Number(m[1]), comm: m[2] }
  } catch {
    return null
  }
}

/** `{ name, source }` — `source` says which rule decided, which is what the skill reports. */
export function detect(opts = {}) {
  const env = opts.env || process.env
  const cwd = opts.cwd || process.cwd()

  const forced = env.KSS_HARNESS && env.KSS_HARNESS.trim()
  if (forced && HARNESSES.includes(forced)) return { name: forced, source: 'KSS_HARNESS' }

  const byEnv = fromEnv(env)
  if (byEnv) return { name: byEnv, source: 'environment' }

  const byProc = opts.ancestry === false ? null : fromAncestry(process.ppid, 8, opts.exec)
  if (byProc) return { name: byProc, source: 'process ancestry' }

  const recorded = (readCurrent(cwd) || {}).harness
  if (HARNESSES.includes(recorded)) return { name: recorded, source: '.kss/current' }

  return { name: 'unknown', source: 'undetermined' }
}

/** Record the harness in `.kss/current` so `kss-status`, the board and the hooks can read it. */
export function record(name, cwd = process.cwd()) {
  if (!HARNESSES.includes(name)) return false
  const cur = readCurrent(cwd)
  if (!cur) return false // no active run: nothing to annotate, and we never create the file here
  if (cur.harness === name) return true
  return writeJsonFile(currentPath(cwd), { ...cur, harness: name })
}

function main() {
  const argv = process.argv.slice(2)
  const has = (f) => argv.includes(f)
  const set = argv.indexOf('--set') !== -1 ? argv[argv.indexOf('--set') + 1] : null

  if (set !== null) {
    if (!HARNESSES.includes(set)) {
      console.error(`harness.mjs: --set must be one of ${HARNESSES.join(', ')}`)
      process.exit(1)
    }
    record(set)
    process.stdout.write(`${set}\n${adapterPath(set)}\n`)
    return
  }

  const { name, source } = detect()
  if (name !== 'unknown' && !has('--no-write')) record(name)

  if (has('--name')) return void process.stdout.write(name + '\n')
  if (has('--adapter')) return void process.stdout.write(adapterPath(name) + '\n')

  const path = adapterPath(name)
  const note = path && !existsSync(path) ? ' (missing — re-run kss-init)' : ''
  process.stdout.write(`${name}\n${path}${note}\n`)
  if (has('--verbose')) process.stderr.write(`detected from ${source}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
