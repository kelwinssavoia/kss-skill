#!/usr/bin/env node
// KSS statusline. Reads the statusline payload on stdin plus `<cwd>/.kss/current`
// and prints one line (DESIGN.md §18). With no active KSS run it delegates to the
// statusline that was configured before kss-init, if one was backed up.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
// `kss-lib.mjs` sits next to this file when `kss-init` has copied the scripts into the project's
// `.kss/scripts/`, and one directory up in `hooks/` when this file runs from the installed plugin.
// Resolve whichever exists — `${CLAUDE_PLUGIN_ROOT}` is only set for hooks, so it cannot help here.
const lib = await (async () => {
  try {
    return await import('./kss-lib.mjs')
  } catch {
    return await import('../hooks/kss-lib.mjs')
  }
})()
const { readStdin, parseJson, readCurrent, featureDir } = lib

const BAR = 10

function bar(done, total) {
  if (!total) return ''
  const filled = Math.max(0, Math.min(BAR, Math.round((done / total) * BAR)))
  return '█'.repeat(filled) + '░'.repeat(BAR - filled)
}

function human(n) {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k'
  return String(n)
}

function ago(iso) {
  const t = Date.parse(iso || '')
  if (!Number.isFinite(t)) return null
  return mins(Date.now() - t)
}

function mins(ms) {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  return h + 'h' + String(m % 60).padStart(2, '0')
}

function totalTokens(dir) {
  try {
    if (!dir) return 0
    const p = join(dir, 'metrics.jsonl')
    if (!existsSync(p)) return 0
    if (statSync(p).size > 4 * 1024 * 1024) return 0
    let sum = 0
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line) continue
      try {
        const o = JSON.parse(line)
        if (o && o.tokens && Number.isFinite(o.tokens.cumulative)) sum += o.tokens.cumulative
      } catch {
        /* skip malformed */
      }
    }
    return sum
  } catch {
    return 0
  }
}

function shortId(feature) {
  const m = /^(\d+)/.exec(String(feature || ''))
  return m ? m[1] : String(feature || '')
}

// Recursion guard (see DESIGN.md §18 "Fallback safety"). The child spawned by `fallback()` runs
// with this variable set; when it is present we are the child and must never spawn again.
const CHILD_ENV = 'KSS_STATUSLINE_CHILD'
const FALLBACK_TIMEOUT_MS = 2000

/** True when `cmd` would run this statusline (any version, any copy) — running it would recurse. */
export function isSelfReferencing(cmd) {
  const c = String(cmd || '')
  return /statusline\.mjs/.test(c) || /\bkss\b/i.test(c)
}

function readBackupCommand(path) {
  try {
    if (!existsSync(path)) return null
    const j = JSON.parse(readFileSync(path, 'utf8'))
    const cmd = j && (j.command || (j.statusLine && j.statusLine.command))
    return typeof cmd === 'string' && cmd.trim() ? cmd : null
  } catch {
    return null
  }
}

/**
 * The statusline that was configured before kss-init. It is user-level state, so it lives in
 * `~/.kss/statusline.backup.json`; `<cwd>/.kss/statusline.backup.json` is the legacy location
 * (kss ≤ 0.1.3 wrote it per project). A backup that points back at the KSS statusline is the
 * artefact of running kss-init twice and is ignored — it is exactly what fork-bombed a machine.
 */
export function resolveBackupCommand(cwd, home = homedir()) {
  const candidates = [join(home, '.kss', 'statusline.backup.json'), join(cwd, '.kss', 'statusline.backup.json')]
  for (const p of candidates) {
    const cmd = readBackupCommand(p)
    if (cmd && !isSelfReferencing(cmd)) return cmd
  }
  return null
}

function plainLine(payload) {
  const name = (payload && payload.model && payload.model.display_name) || 'Claude'
  const pct = payload && payload.context_window && payload.context_window.used_percentage
  return Number.isFinite(pct) ? `${name} · ${Math.round(pct)}%` : name
}

/**
 * Run the previous statusline in its own process group and kill the whole group on timeout, so a
 * child that itself spawned something never leaves orphans behind (spawnSync's timeout only
 * signals the direct child).
 */
function runBackup(cmd, raw, cwd) {
  return new Promise((res) => {
    let out = ''
    let settled = false
    const finish = (v) => {
      if (settled) return
      settled = true
      res(v)
    }
    let child
    try {
      child = spawn(cmd, {
        shell: true,
        cwd,
        detached: true,
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, [CHILD_ENV]: '1' },
      })
    } catch {
      return finish('')
    }
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        /* already gone */
      }
      finish('')
    }, FALLBACK_TIMEOUT_MS)
    child.stdout.on('data', (d) => (out += d))
    child.on('error', () => {
      clearTimeout(timer)
      finish('')
    })
    child.on('close', () => {
      clearTimeout(timer)
      finish(out.trim())
    })
    try {
      child.stdin.end(raw)
    } catch {
      /* child may have exited */
    }
  })
}

async function fallback(payload, raw, cwd) {
  // We are the child of another statusline: print the plain line and stop the chain here.
  if (process.env[CHILD_ENV]) return plainLine(payload)

  const backup = resolveBackupCommand(cwd)
  if (backup) {
    const out = await runBackup(backup, raw, cwd)
    if (out) return out
  }
  return plainLine(payload)
}

/**
 * Ticket rows from `.kss/current.tickets` — a map keyed by `NN` (DESIGN.md §3.3), and only a map.
 */
function tickets(current) {
  const t = current.tickets
  if (!t || typeof t !== 'object' || Array.isArray(t)) return []
  return Object.entries(t).map(([id, v]) => {
    const r = v && typeof v === 'object' ? v : {}
    return {
      id: String(id),
      state: r.state,
      agent_type: r.agent_type ?? null,
      turns: Number.isFinite(r.turns) ? r.turns : null,
      est_turns: Number.isFinite(r.est_turns) ? r.est_turns : null,
      started_at: r.started_at ?? null,
    }
  })
}

function line(current, dir) {
  const id = shortId(current.feature)
  const phase = current.phase || 'idle'
  const head = `kss ${id} · ${phase}`

  if (phase === 'execute') {
    const entries = tickets(current)
    // `execution` (DESIGN.md §3.3) is the roll-up kss-execute keeps; fall back to the rows.
    const ex = current.execution && typeof current.execution === 'object' ? current.execution : {}
    const total = Number.isFinite(ex.total) ? ex.total : entries.length
    const done = Number.isFinite(ex.integrated)
      ? ex.integrated
      : entries.filter((t) => t.state === 'integrated').length
    const running = entries
      .filter((t) => t.state === 'running' || t.state === 'reviewing')
      .map((t) => {
        const bits = []
        if (Number.isFinite(t.turns)) bits.push(`${t.turns}t`)
        const started = Date.parse(t.started_at || '')
        if (Number.isFinite(started)) bits.push(mins(Date.now() - started))
        return bits.length ? `${t.id} (${bits.join(', ')})` : t.id
      })
    const parts = [head, `${done}/${total} ${bar(done, total)}`.trim()]
    if (running.length) parts.push(`running: ${running.join(', ')}`)
    const tok = totalTokens(dir)
    if (tok) parts.push(`${human(tok)} tok`)
    return parts.join(' · ')
  }

  if (current.explorers && (phase === 'investigate' || phase === 'plan')) {
    // `explorers.running` is the size of the fan-out; `returned` is how many are back.
    const r = Number.isFinite(current.explorers.running) ? current.explorers.running : 0
    const back = Number.isFinite(current.explorers.returned) ? current.explorers.returned : 0
    const total = Math.max(r, back)
    return `${head} · ${r} explorers running · ${back}/${total} returned`
  }

  if (phase === 'review' && current.review) {
    const parts = [head]
    if (Number.isFinite(current.review.round)) parts.push(`round ${current.review.round} done`)
    if (current.review.watching) parts.push(`watching ${current.review.watching}`)
    const last = ago(current.review.last_check)
    if (last) parts.push(`last check ${last} ago`)
    return parts.join(' · ')
  }

  const state = current.state || (current.session && Number.isFinite(current.session.turns) ? `${current.session.turns}t` : null)
  return state ? `${head} · ${state}` : head
}

async function main() {
  const raw = await readStdin()
  const payload = parseJson(raw, {}) || {}
  const cwd = (payload.cwd || (payload.workspace && payload.workspace.current_dir) || process.cwd())

  const current = readCurrent(cwd)
  // `phase: "done"` (current.mjs end) is a closed run: back to the previous statusline.
  if (!current || !current.feature || current.phase === 'done') {
    process.stdout.write((await fallback(payload, raw, cwd)) + '\n')
    return
  }
  process.stdout.write(line(current, featureDir(cwd, current)) + '\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .catch(() => {})
    .finally(() => process.exit(0))
}
