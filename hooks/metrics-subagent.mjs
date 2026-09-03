#!/usr/bin/env node
// SubagentStop → append one `kind: "subagent"` line to the feature's metrics.jsonl.
// No-op (exit 0) whenever there is no active KSS run.

import { readStdin, parseJson, readCurrent, featureDir, appendMetric, summariseTranscript, readMeta, activeTicket } from './kss-lib.mjs'

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

  const meta = readMeta(payload.transcript_path)

  appendMetric(dir, {
    ts: new Date().toISOString(),
    phase: current.phase || null,
    ticket: current.ticket || activeTicket(current),
    kind: 'subagent',
    agent_type: payload.agent_type || (meta && meta.agentType) || null,
    agent_id: payload.agent_id || null,
    model: s.model || (meta && meta.model) || null,
    effort: s.effort || null,
    parent: (meta && meta.toolUseId) || null,
    depth: (meta && Number.isFinite(meta.spawnDepth) ? meta.spawnDepth : 1),
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
