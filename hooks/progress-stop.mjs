#!/usr/bin/env node
// Stop → keep `.kss/current.session` fresh so the board and the statusline can show the main
// session's turn count and context size, and mark it waiting: the main agent ended its turn, so the
// phase now waits on the person — kss-desktop shows that, with the agent's last words, even when the
// phase published no ask (DESIGN.md §26) — unless background work is still out, which wakes it
// again by itself. progress-prompt.mjs clears the mark. Writes no metrics line.
//
// Cheap by construction: the turn count is a counter bumped once per Stop, and the context size is
// read from the tail of the transcript — the file is never parsed whole. `tailContext` understands
// both transcript formats, so this hook is the same on either harness (DESIGN.md §19).

import { readStdin, parseJson, readCurrent, currentPath, writeJsonFile, isActive, tailContext, tailLastText, pendingBackgroundOf } from './kss-lib.mjs'

async function main() {
  const payload = parseJson(await readStdin(), null)
  if (!payload) return
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd()

  const current = readCurrent(cwd)
  if (!isActive(current)) return

  const prev = current.session && typeof current.session === 'object' ? current.session : {}
  const ctx = tailContext(payload.transcript_path)
  // A turn that ended with a subagent or a command still out in the background is not waiting on
  // the person: Claude Code wakes the agent when that work comes back.
  const background = pendingBackgroundOf(payload.transcript_path)
  const { waiting: _w, background: _b, ...rest } = prev

  current.session = {
    ...rest,
    turns: (Number.isFinite(prev.turns) ? prev.turns : 0) + 1,
    ctx: ctx === null ? prev.ctx || 0 : ctx,
    updated_at: new Date().toISOString(),
    ...(background
      ? { background: { count: background, since: new Date().toISOString(), last: tailLastText(payload.transcript_path) } }
      : { waiting: { since: new Date().toISOString(), last: tailLastText(payload.transcript_path) } }),
  }

  writeJsonFile(currentPath(cwd), current)
}

main()
  .catch(() => {})
  .finally(() => process.exit(0))
