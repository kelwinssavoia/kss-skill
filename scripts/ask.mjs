#!/usr/bin/env node
// ask.mjs — the door between a phase and kss-desktop (DESIGN.md §26, references/app-mode.md).
//
//   node .kss/scripts/ask.mjs post  < ask.json      publish what the phase waits on; prints its id
//   node .kss/scripts/ask.mjs answer <id>          print the app's answer to <id>, clear the ask
//   node .kss/scripts/ask.mjs clear                 drop the ask (answered in the terminal)
//
// The ask lives in `.kss/current` → `ask`; an `approve` draft is copied to `.kss/inbox/<id>.draft.md`
// so the app edits a snapshot, never the phase's own file. The app writes the answer to
// `.kss/inbox/<id>.answer.json` (and `<id>.answer.md` for an edited draft) and types one line into
// the phase's terminal; this script turns that file back into text the phase reads.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const lib = await (async () => {
  try {
    return await import('./kss-lib.mjs')
  } catch {
    return await import('../hooks/kss-lib.mjs')
  }
})()
const { readCurrent, currentPath, writeJsonFile, featureDir, readStdin } = lib

export const KINDS = ['question', 'confirm', 'approve', 'blocked', 'handoff']
export const CATEGORIES = ['business', 'layout', 'technical']
export const INBOX = '.kss/inbox'
const LOG_MAX = 30
const CAP = { title: 80, text: 1500, label: 120, description: 300 }

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

function phaseRef(v, name, errs) {
  const phase = v && typeof v === 'object' ? str(v.phase) : null
  if (!phase) return errs.push(`${name} must be { "phase": "…", "args": "…" }`), null
  return { phase: phase.replace(/^kss-/, ''), args: str(v.args) ?? '' }
}

/** The ask as published, or the list of what is wrong with it. Pure, so the tests pin it. */
export function normalize(input, id, now) {
  const errs = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { errs: ['the ask must be a JSON object'] }
  const phase = str(input.phase)
  const kind = str(input.kind)
  const title = str(input.title)
  if (!phase) errs.push('phase is required')
  if (!kind || !KINDS.includes(kind)) errs.push(`kind must be one of ${KINDS.join(', ')}`)
  if (!title) errs.push('title is required')
  else if (title.length > CAP.title) errs.push(`title is over ${CAP.title} characters`)
  const text = str(input.text)
  if (text && text.length > CAP.text) errs.push(`text is over ${CAP.text} characters — put the detail in the draft`)
  const category = str(input.category)
  if (category && !CATEGORIES.includes(category)) errs.push(`category must be one of ${CATEGORIES.join(', ')}`)
  const options = []
  for (const [i, o] of (Array.isArray(input.options) ? input.options : []).entries()) {
    const label = o && typeof o === 'object' ? str(o.label) : null
    if (!label) {
      errs.push(`options[${i}].label is required`)
      continue
    }
    if (label.length > CAP.label) errs.push(`options[${i}].label is over ${CAP.label} characters`)
    const description = str(o.description)
    if (description && description.length > CAP.description) errs.push(`options[${i}].description is over ${CAP.description} characters`)
    options.push({ key: str(o.key) ?? String.fromCharCode(97 + i), label, description, lean: o.lean === true })
  }
  if (category === 'business' && options.some((o) => o.lean)) errs.push('a business question has no lean')
  if (kind === 'approve' && !str(input.draft)) errs.push('an approve ask needs a draft file')
  const ask = { id, phase: phase?.replace(/^kss-/, '') ?? null, kind, title, text, options, category, source: str(input.source), at: now }
  if (kind === 'handoff') {
    ask.run = phaseRef(input.run, 'run', errs)
    ask.then = phaseRef(input.then, 'then', errs)
  }
  return errs.length ? { errs } : { ask }
}

/** The answer file the app wrote, as the lines the phase reads. */
export function render(answer, editedPath) {
  const lines = []
  const c = answer && typeof answer.choice === 'object' && answer.choice ? answer.choice : null
  if (c && str(c.label)) lines.push(`choice: ${str(c.key) ? `${c.key}) ` : ''}${c.label}`)
  const text = answer ? str(answer.text) : null
  if (text) lines.push(`text: ${text}`)
  if (answer?.draftEdited) lines.push(editedPath ? `draft: edited — ${editedPath}` : 'draft: edited, but the edited file is missing — ask again')
  else if (answer && 'draftEdited' in answer) lines.push('draft: unchanged')
  return lines.length ? lines.join('\n') : 'no answer recorded — ask again'
}

function fail(message) {
  console.error(`ask.mjs: ${message}`)
  process.exit(1)
}

function argCwd(argv) {
  const i = argv.indexOf('--cwd')
  return i !== -1 && argv[i + 1] ? argv[i + 1] : process.cwd()
}

async function main() {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  const cwd = argCwd(argv)
  const current = readCurrent(cwd) || {}
  const inbox = join(cwd, INBOX)
  const save = (patch) => {
    const next = { ...current, ...patch }
    for (const [k, v] of Object.entries(patch)) if (v === null) delete next[k]
    if (!writeJsonFile(currentPath(cwd), next)) fail('could not write .kss/current')
  }

  if (cmd === 'post') {
    const raw = argv[1] && !argv[1].startsWith('--') ? argv[1] : await readStdin()
    let input
    try {
      input = JSON.parse(raw)
    } catch {
      fail('post reads one JSON object, from stdin or as the argument')
    }
    const seq = (Number.isFinite(current.ask_seq) ? current.ask_seq : 0) + 1
    const id = `${str(input?.phase)?.replace(/^kss-/, '') ?? 'ask'}-${seq}`
    const { ask, errs } = normalize(input, id, new Date().toISOString())
    if (errs) fail(errs.join('; '))
    if (str(input.draft)) {
      const base = featureDir(cwd, current) ?? cwd
      const src = isAbsolute(input.draft) ? input.draft : existsSync(resolve(base, input.draft)) ? resolve(base, input.draft) : resolve(cwd, input.draft)
      if (!existsSync(src)) fail(`draft not found: ${input.draft}`)
      mkdirSync(inbox, { recursive: true })
      copyFileSync(src, join(inbox, `${id}.draft.md`))
      ask.draft = `${INBOX}/${id}.draft.md`
      ask.draftSource = relative(cwd, src)
    }
    save({ ask, ask_seq: seq })
    process.stdout.write(`${id}\n`)
    return
  }

  if (cmd === 'answer') {
    const id = str(argv[1])
    if (!id || id.startsWith('--')) fail('usage: ask.mjs answer <id>')
    let answer = null
    try {
      answer = JSON.parse(readFileSync(join(inbox, `${id}.answer.json`), 'utf8'))
    } catch {
      /* not written: render says so */
    }
    const edited = join(inbox, `${id}.answer.md`)
    process.stdout.write(render(answer, existsSync(edited) ? `${INBOX}/${id}.answer.md` : null) + '\n')
    const asked = current.ask?.id === id ? current.ask : null
    const log = Array.isArray(current.ask_log) ? current.ask_log : []
    const entry = { id, phase: asked?.phase ?? id.replace(/-\d+$/, ''), title: asked?.title ?? null, answer: render(answer, null).split('\n')[0], at: new Date().toISOString() }
    save({ ...(asked ? { ask: null } : {}), ask_log: [...log.filter((e) => e?.id !== id), entry].slice(-LOG_MAX) })
    return
  }

  if (cmd === 'clear') {
    const id = current.ask?.id
    if (id) for (const f of [`${id}.draft.md`]) rmSync(join(inbox, f), { force: true })
    save({ ask: null })
    process.stdout.write('cleared\n')
    return
  }

  fail('usage: ask.mjs post < ask.json | answer <id> | clear [--cwd <dir>]')
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) await main()
