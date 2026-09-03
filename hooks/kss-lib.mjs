// Shared helpers for the KSS hooks and scripts.
// No dependencies. Nothing here may throw: every entry point is wrapped by the
// caller, but these helpers already return safe defaults on any failure.

import { readFileSync, existsSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

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

export function currentPath(cwd) {
  return join(cwd, '.kss', 'current')
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
