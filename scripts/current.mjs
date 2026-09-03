#!/usr/bin/env node
// current.mjs — tiny CLI over `.kss/current`, used by the skills.
//
//   node .kss/scripts/current.mjs get [dot.path]     print the file, or one value
//   node .kss/scripts/current.mjs set '<json>'       deep-merge the patch into the file
//
// Merge semantics: objects merge recursively, everything else is replaced.
// `null` as a value deletes the key. Runs against $PWD unless --cwd is given.

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
const { readCurrent, currentPath, writeJsonFile } = lib

function argCwd(argv) {
  const i = argv.indexOf('--cwd')
  return i !== -1 && argv[i + 1] ? argv[i + 1] : process.cwd()
}

function merge(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch
  const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k]
    else out[k] = merge(out[k], v)
  }
  return out
}

function pick(obj, path) {
  return path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj)
}

const argv = process.argv.slice(2)
const cmd = argv[0]
const cwd = argCwd(argv)
const current = readCurrent(cwd) || {}

if (cmd === 'get') {
  const path = argv[1] && !argv[1].startsWith('--') ? argv[1] : null
  const value = path ? pick(current, path) : current
  process.stdout.write((typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)) + '\n')
  process.exit(0)
}

if (cmd === 'set') {
  const raw = argv[1]
  let patch
  try {
    patch = JSON.parse(raw)
  } catch {
    console.error('current.mjs set: argument must be a JSON object')
    process.exit(1)
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    console.error('current.mjs set: argument must be a JSON object')
    process.exit(1)
  }
  const next = merge(current, patch)
  if (!writeJsonFile(currentPath(cwd), next)) {
    console.error('current.mjs set: could not write .kss/current')
    process.exit(1)
  }
  process.stdout.write(JSON.stringify(next, null, 2) + '\n')
  process.exit(0)
}

console.error('usage: node .kss/scripts/current.mjs get [dot.path] | set <json-patch> [--cwd <dir>]')
process.exit(1)
