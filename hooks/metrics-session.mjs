#!/usr/bin/env node
// SessionEnd → append one `kind: "session"` line, attributing the main session's
// cost to the phase named in `.kss/current`. Every `reason` is recorded.

import { readStdin, parseJson, readCurrent, featureDir, appendMetric, summariseTranscript, activeTicket } from './kss-lib.mjs'

async function main() {
  const payload = parseJson(await readStdin(), null)
  if (!payload) return
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd()

  const current = readCurrent(cwd)
  if (!current || !current.feature) return
  const dir = featureDir(cwd, current)
  if (!dir) return

  const s = summariseTranscript(payload.transcript_path)
  if (!s.turns) return

  appendMetric(dir, {
    ts: new Date().toISOString(),
    phase: current.phase || null,
    ticket: current.ticket || activeTicket(current),
    kind: 'session',
    agent_type: 'main-session',
    agent_id: payload.session_id || null,
    model: s.model,
    effort: s.effort,
    parent: null,
    depth: 0,
    reason: typeof payload.reason === 'string' ? payload.reason : null,
    turns: s.turns,
    duration_ms: s.duration_ms,
    tool_uses: s.tool_uses,
    tokens: s.tokens,
    git: { files: 0, added: 0, deleted: 0, commits: 0 },
  })
}

main()
  .catch(() => {})
  .finally(() => process.exit(0))
