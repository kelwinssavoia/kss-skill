#!/usr/bin/env node
// UserPromptSubmit → the person answered: the main session is no longer waiting on them
// (DESIGN.md §26). Drops `.kss/current.session.waiting`, which progress-stop.mjs sets.

import { readStdin, parseJson, readCurrent, currentPath, writeJsonFile, isActive } from './kss-lib.mjs'

async function main() {
  const payload = parseJson(await readStdin(), null)
  if (!payload) return
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd()
  const current = readCurrent(cwd)
  if (!isActive(current) || !current.session || !current.session.waiting) return
  const { waiting, ...session } = current.session
  current.session = session
  writeJsonFile(currentPath(cwd), current)
}

main()
  .catch(() => {})
  .finally(() => process.exit(0))
