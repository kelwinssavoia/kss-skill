#!/usr/bin/env node
// Stop → keep `.kss/current.session` fresh so the statusline can show the main
// session's turn count and context size. Writes no metrics line.
//
// Cheap by construction: the turn count is a counter bumped once per Stop, and
// the context size is read from the last assistant `usage` found in the tail of
// the transcript — the file is never parsed whole.

import { openSync, fstatSync, readSync, closeSync, existsSync } from 'node:fs'
import { readStdin, parseJson, readCurrent, currentPath, writeJsonFile } from './kss-lib.mjs'

const TAIL_BYTES = 256 * 1024

function tailCtx(path) {
  let fd
  try {
    if (!path || !existsSync(path)) return null
    fd = openSync(path, 'r')
    const size = fstatSync(fd).size
    const len = Math.min(size, TAIL_BYTES)
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    const lines = buf.toString('utf8').split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = lines[i]
      if (!raw || raw.indexOf('"usage"') === -1) continue
      let o
      try {
        o = JSON.parse(raw)
      } catch {
        continue
      }
      const u = o && o.message && o.message.role === 'assistant' ? o.message.usage : null
      if (!u) continue
      const n = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
      return n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens)
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

async function main() {
  const payload = parseJson(await readStdin(), null)
  if (!payload) return
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd()

  const current = readCurrent(cwd)
  if (!current || !current.feature) return

  const prev = current.session && typeof current.session === 'object' ? current.session : {}
  const ctx = tailCtx(payload.transcript_path)

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
