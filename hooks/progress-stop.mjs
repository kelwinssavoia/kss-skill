#!/usr/bin/env node
// Stop → keep `.kss/current.session` fresh so the board and the statusline can show the main
// session's turn count and context size. Writes no metrics line.
//
// Cheap by construction: the turn count is a counter bumped once per Stop, and the context size is
// read from the tail of the transcript — the file is never parsed whole. `tailContext` understands
// both transcript formats, so this hook is the same on either harness (DESIGN.md §19).

import { readStdin, parseJson, readCurrent, currentPath, writeJsonFile, isActive, tailContext } from './kss-lib.mjs'

async function main() {
  const payload = parseJson(await readStdin(), null)
  if (!payload) return
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd()

  const current = readCurrent(cwd)
  if (!isActive(current)) return

  const prev = current.session && typeof current.session === 'object' ? current.session : {}
  const ctx = tailContext(payload.transcript_path)

  current.session = {
    ...prev,
    turns: (Number.isFinite(prev.turns) ? prev.turns : 0) + 1,
    ctx: ctx === null ? prev.ctx || 0 : ctx,
    updated_at: new Date().toISOString(),
  }

  writeJsonFile(currentPath(cwd), current)
}

main()
  .catch(() => {})
  .finally(() => process.exit(0))
