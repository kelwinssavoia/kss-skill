// Shared helpers for the KSS hooks and scripts.
// No dependencies. Nothing here may throw: every entry point is wrapped by the
// caller, but these helpers already return safe defaults on any failure.

import { readFileSync, existsSync, appendFileSync, mkdirSync, writeFileSync, openSync, readSync, closeSync, fstatSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

export function readStdin() {
  return new Promise((res) => {
    let s = ''
    let done = false
    const finish = () => {
      if (done) return
      done = true
      res(s)
    }
    try {
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', (d) => (s += d))
      process.stdin.on('end', finish)
      process.stdin.on('error', finish)
      setTimeout(finish, 2000).unref?.()
    } catch {
      finish()
    }
  })
}

export function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

export function readJsonFile(path, fallback = null) {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJsonFile(path, value) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
    return true
  } catch {
    return false
  }
}

/** `.kss/current` — the live state file. Returns null when there is no active run. */
export function readCurrent(cwd) {
  const cur = readJsonFile(join(cwd, '.kss', 'current'), null)
  if (!cur || typeof cur !== 'object') return null
  return cur
}

/**
 * True while a run is live. `phase: "done"` is what `current.mjs end` writes when the last skill of
 * a feature finishes: the feature stays named (kss-status still reads it) but every hook is a no-op,
 * so nothing lands in metrics.jsonl after the closing commit (DESIGN.md §3.8).
 */
export function isActive(current) {
  return !!(current && typeof current === 'object' && current.feature && current.phase !== 'done')
}

export function currentPath(cwd) {
  return join(cwd, '.kss', 'current')
}

/**
 * The main worktree's root, from what `git rev-parse --git-common-dir` answered.
 *
 * Pure on purpose, so the lookup is testable without a repository. A plain
 * checkout answers `.git`; every linked worktree answers the absolute path of
 * that SAME `.git`, which is the one directory all of them agree on.
 */
export function rootFromCommonDir(cwd, commonDir) {
  if (typeof commonDir !== 'string' || !commonDir.trim()) return null
  return dirname(resolve(cwd, commonDir.trim()))
}

/**
 * The main worktree's root for `cwd`, or null when git cannot say.
 *
 * Why KSS needs it: `.kss/config.local.json` is gitignored, and an ignored file
 * does not exist in a worktree created after it. Without this, every command
 * run from a worktree reads the defaults, decides Jev is off, and falls back to
 * the rubric without telling anyone.
 */
export function mainWorktreeRoot(cwd) {
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return rootFromCommonDir(cwd, common)
  } catch {
    return null
  }
}

/** Parse the `key: value` lines of `.kss/config.md` (inside or outside the fence). */
export function readConfig(cwd) {
  const out = {}
  try {
    const p = join(cwd, '.kss', 'config.md')
    if (!existsSync(p)) return out
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = /^\s*([a-z_]+)\s*:\s*(.*?)\s*$/.exec(line)
      if (!m) continue
      let v = m[2].replace(/\s+#.*$/, '').trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      if (v.startsWith('[') && v.endsWith(']')) {
        v = v
          .slice(1, -1)
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      }
      out[m[1]] = v
    }
  } catch {
    /* ignore */
  }
  return out
}

/** Absolute path of the feature folder for the active run, or null. */
export function featureDir(cwd, current) {
  if (!current || !current.feature) return null
  const cfg = readConfig(cwd)
  const root = typeof cfg.features_root === 'string' && cfg.features_root ? cfg.features_root : 'docs/features'
  return resolve(cwd, root, String(current.feature))
}

export function appendMetric(dir, line) {
  try {
    if (!dir) return false
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'metrics.jsonl'), JSON.stringify(line) + '\n')
    return true
  } catch {
    return false
  }
}

/**
 * Summarise a Claude Code transcript JSONL.
 *
 * The format is internal and undocumented, so every access is defensive:
 * malformed lines are skipped, missing fields default to 0.
 *
 * Counted turn = a line whose `message.role === 'assistant'` carrying `message.usage`.
 * Duplicate API responses (same `requestId` + same usage id) are counted once.
 */
export function summariseTranscript(path) {
  const empty = {
    turns: 0,
    tool_uses: 0,
    duration_ms: 0,
    model: null,
    effort: null,
    tokens: { fresh_in: 0, cache_write: 0, cache_read: 0, out: 0, cumulative: 0, ctx_end: 0 },
    first_ts: null,
    last_ts: null,
  }
  let text
  try {
    if (!path || !existsSync(path)) return empty
    text = readFileSync(path, 'utf8')
  } catch {
    return empty
  }

  const seen = new Set()
  let turns = 0
  let toolUses = 0
  let fresh = 0
  let cw = 0
  let cr = 0
  let out = 0
  let ctxEnd = 0
  let model = null
  let effort = null
  let firstTs = null
  let lastTs = null

  for (const raw of text.split('\n')) {
    if (!raw) continue
    let o
    try {
      o = JSON.parse(raw)
    } catch {
      continue
    }
    if (!o || typeof o !== 'object') continue

    const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN
    if (Number.isFinite(ts)) {
      if (firstTs === null || ts < firstTs) firstTs = ts
      if (lastTs === null || ts > lastTs) lastTs = ts
    }

    const m = o.message
    if (!m || typeof m !== 'object' || m.role !== 'assistant') continue

    if (Array.isArray(m.content)) {
      for (const b of m.content) if (b && b.type === 'tool_use') toolUses++
    }

    const u = m.usage
    if (!u || typeof u !== 'object') continue

    const key = m.id || o.requestId || o.uuid
    if (key) {
      if (seen.has(key)) continue
      seen.add(key)
    }

    const n = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
    const inTok = n(u.input_tokens)
    const cwTok = n(u.cache_creation_input_tokens)
    const crTok = n(u.cache_read_input_tokens)
    const outTok = n(u.output_tokens)

    turns++
    fresh += inTok
    cw += cwTok
    cr += crTok
    out += outTok
    ctxEnd = inTok + cwTok + crTok
    if (typeof m.model === 'string') model = m.model
    if (typeof o.effort === 'string') effort = o.effort
  }

  return {
    turns,
    tool_uses: toolUses,
    duration_ms: firstTs !== null && lastTs !== null ? Math.max(0, lastTs - firstTs) : 0,
    model,
    effort,
    tokens: {
      fresh_in: fresh,
      cache_write: cw,
      cache_read: cr,
      out,
      cumulative: fresh + cw + cr + out,
      ctx_end: ctxEnd,
    },
    first_ts: firstTs,
    last_ts: lastTs,
  }
}

/**
 * Which harness wrote a transcript. Claude Code writes one assistant message per line with a
 * `usage` object; Codex writes a rollout whose lines are `{timestamp, type, payload}` and whose
 * first line is a `session_meta`. Sniffing the head is enough and costs nothing.
 */
export function detectTranscriptFormat(path) {
  try {
    if (!path || !existsSync(path)) return null
    const fd = openSync(path, 'r')
    try {
      const buf = Buffer.alloc(8192)
      const n = readSync(fd, buf, 0, 8192, 0)
      const head = buf.toString('utf8', 0, n)
      if (/"type"\s*:\s*"(session_meta|token_usage_record|turn_context|response_item)"/.test(head)) return 'codex'
      return 'claude-code'
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
}

const EMPTY_SUMMARY = {
  turns: 0,
  tool_uses: 0,
  duration_ms: 0,
  model: null,
  effort: null,
  tokens: { fresh_in: 0, cache_write: 0, cache_read: 0, out: 0, cumulative: 0, ctx_end: 0 },
  first_ts: null,
  last_ts: null,
}

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)

/**
 * Summarise a Codex rollout JSONL into the same shape `summariseTranscript` returns.
 *
 * A counted turn is one `token_usage_record` — one model response — deduplicated by `response_id`,
 * which is the analogue of deduplicating Claude Code's lines by `message.id`. Codex's
 * `usage.input_tokens` *includes* the cached and cache-written tokens, unlike Claude's, so the
 * fresh count subtracts them instead of adding.
 */
export function summariseRollout(path) {
  const empty = { ...EMPTY_SUMMARY, tokens: { ...EMPTY_SUMMARY.tokens } }
  let text
  try {
    if (!path || !existsSync(path)) return empty
    text = readFileSync(path, 'utf8')
  } catch {
    return empty
  }

  const seen = new Set()
  let turns = 0
  let toolUses = 0
  let fresh = 0
  let cw = 0
  let cr = 0
  let out = 0
  let ctxEnd = 0
  let model = null
  let effort = null
  let firstTs = null
  let lastTs = null

  for (const raw of text.split('\n')) {
    if (!raw) continue
    let o
    try {
      o = JSON.parse(raw)
    } catch {
      continue
    }
    if (!o || typeof o !== 'object') continue

    const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN
    if (Number.isFinite(ts)) {
      if (firstTs === null || ts < firstTs) firstTs = ts
      if (lastTs === null || ts > lastTs) lastTs = ts
    }

    const p = o.payload
    if (!p || typeof p !== 'object') continue

    if (o.type === 'turn_context') {
      if (typeof p.model === 'string') model = p.model
      if (typeof p.effort === 'string') effort = p.effort
      continue
    }

    if (o.type === 'response_item') {
      if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') toolUses++
      continue
    }

    if (o.type !== 'token_usage_record') continue
    const u = p.usage
    if (!u || typeof u !== 'object') continue

    const key = p.response_id || (p.turn_id && o.ordinal !== undefined ? `${p.turn_id}:${o.ordinal}` : null)
    if (key) {
      if (seen.has(key)) continue
      seen.add(key)
    }

    const inTok = num(u.input_tokens)
    const crTok = num(u.cached_input_tokens)
    const cwTok = num(u.cache_write_input_tokens)

    turns++
    fresh += Math.max(0, inTok - crTok - cwTok)
    cr += crTok
    cw += cwTok
    out += num(u.output_tokens)
    ctxEnd = inTok
  }

  return {
    turns,
    tool_uses: toolUses,
    duration_ms: firstTs !== null && lastTs !== null ? Math.max(0, lastTs - firstTs) : 0,
    model,
    effort,
    tokens: { fresh_in: fresh, cache_write: cw, cache_read: cr, out, cumulative: fresh + cw + cr + out, ctx_end: ctxEnd },
    first_ts: firstTs,
    last_ts: lastTs,
  }
}

/** Summarise a transcript whichever harness wrote it (DESIGN.md §19). */
export function summarise(path) {
  return detectTranscriptFormat(path) === 'codex' ? summariseRollout(path) : summariseTranscript(path)
}

/**
 * Context size of the last model request, read from the tail of a transcript in either format —
 * the file is never parsed whole. Returns null when the tail holds no usage record.
 */
export function tailContext(path, tailBytes = 256 * 1024) {
  let fd
  try {
    if (!path || !existsSync(path)) return null
    fd = openSync(path, 'r')
    const size = fstatSync(fd).size
    const len = Math.min(size, tailBytes)
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    const lines = buf.toString('utf8').split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = lines[i]
      if (!raw || raw.indexOf('usage') === -1) continue
      let o
      try {
        o = JSON.parse(raw)
      } catch {
        continue
      }
      if (!o || typeof o !== 'object') continue

      // Codex: the request's own input count already includes what came from the cache.
      if (o.type === 'token_usage_record' && o.payload && o.payload.usage) return num(o.payload.usage.input_tokens)

      // Claude Code: the three input counters are disjoint and add up to the context.
      const u = o.message && o.message.role === 'assistant' ? o.message.usage : null
      if (u) return num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens)
    }
    return null
  } catch {
    return null
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        /* ignore */
      }
    }
  }
}

/** Sidecar `<transcript>.meta.json` written next to a subagent transcript. */
export function readMeta(transcriptPath) {
  if (typeof transcriptPath !== 'string') return null
  return readJsonFile(transcriptPath.replace(/\.jsonl$/, '.meta.json'), null)
}

export function activeTicket(current) {
  if (!current || !current.tickets || typeof current.tickets !== 'object') return null
  const running = Object.entries(current.tickets).find(([, t]) => t && (t.state === 'running' || t.state === 'reviewing'))
  return running ? running[0] : null
}
