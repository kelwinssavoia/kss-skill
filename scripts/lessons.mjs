#!/usr/bin/env node
// lessons.mjs — the project's catalogue of bug classes (DESIGN.md §27).
//
// Every finding a PR reviewer raised and kss-review confirmed as a bug (`fix`) is filed under a
// class: what the bug looks like, the one question that would have caught it, and the words and
// paths that say a change is exposed to it. The plan answers the questions of the classes its
// feature touches, every ticket carries them as Failure checks, the reviewer checks them against
// the diff, and execute sweeps the whole feature for them before the PR. A class that keeps coming
// back is escalated to an automatic check.
//
//   node .kss/scripts/lessons.mjs list [--md]
//   node .kss/scripts/lessons.mjs match [--text <s>] [--text-file <f>] [--paths a,b] [--diff <range>] [--max 8] [--md]
//       the classes a plan, a ticket or a diff is exposed to, most-confirmed first
//   node .kss/scripts/lessons.mjs add '<json>'
//       {"class":"BC-03","case":{…}} files a case under a class ("check" automates it); without "class", a new class:
//       {"title","signature","question","triggers":[…],"paths"?:[…],"gate"?,"check"?,"case"?}
//   node .kss/scripts/lessons.mjs check --diff <range>
//       run every class's automatic check (`check.pattern`) on the lines the diff adds
//   node .kss/scripts/lessons.mjs escalate [--min 3]
//       classes confirmed at least --min times that still have no automatic check
//
// The catalogue is `.kss/lessons.json`, committed: it is the project's memory, shared by every
// worktree and teammate. Until the first case is filed it reads `.kss/templates/lessons.json`, the
// starter classes KSS ships. `--cwd <dir>` runs against another checkout. Exit 0 carries JSON (or
// markdown with --md), exit 1 is a usage error.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const GATES = ['plan', 'tickets', 'review', 'test']
const ID = /^BC-(\d+)$/

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x)
const strs = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()) : [])

/** `**` any depth, `*` within one segment — enough for `apps/**\/payouts/**` style paths. */
export function globRe(glob) {
  const body = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '(?:.*/)?')
    .replace(/\u0001/g, '.*')
  return new RegExp(`^${body}$`)
}

/** A trigger is a plain phrase (case-insensitive) or `/regex/flags`. */
export function triggerRe(t) {
  const m = /^\/(.+)\/([a-z]*)$/.exec(t)
  if (m) return new RegExp(m[1], m[2].includes('i') ? m[2] : `${m[2]}i`)
  return new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
}

// ---------------------------------------------------------------- the file

export function catalogPath(cwd) {
  return join(cwd, '.kss', 'lessons.json')
}

export function load(cwd) {
  for (const p of [catalogPath(cwd), join(cwd, '.kss', 'templates', 'lessons.json')]) {
    if (!existsSync(p)) continue
    const j = JSON.parse(readFileSync(p, 'utf8'))
    return { version: 1, classes: Array.isArray(j.classes) ? j.classes : [] }
  }
  return { version: 1, classes: [] }
}

function save(cwd, cat) {
  const p = catalogPath(cwd)
  writeFileSync(`${p}.tmp`, JSON.stringify(cat, null, 2) + '\n')
  renameSync(`${p}.tmp`, p)
}

// ---------------------------------------------------------------- pure

const nextId = (classes) => `BC-${String(classes.reduce((n, c) => Math.max(n, Number(ID.exec(c.id)?.[1] ?? 0)), 0) + 1).padStart(2, '0')}`

function normCase(c) {
  if (!isObj(c)) return null
  const out = {}
  for (const k of ['feature', 'pr', 'rv', 'file', 'summary', 'at', 'phase']) if (typeof c[k] === 'string' && c[k].trim()) out[k] = c[k].trim()
  return out.summary || out.rv ? out : null
}

/** Pure: the catalogue with one case filed (or one class created). Throws on an invalid entry. */
export function addEntry(cat, entry) {
  if (!isObj(entry)) throw new Error('the entry must be a JSON object')
  const classes = cat.classes.map((c) => ({ ...c, cases: [...(c.cases ?? [])] }))
  const kase = entry.case === undefined ? null : normCase(entry.case)
  if (entry.case !== undefined && !kase) throw new Error('a case needs at least "summary" or "rv"')

  if (entry.class !== undefined) {
    const c = classes.find((x) => x.id === entry.class)
    if (!c) throw new Error(`no class ${entry.class} — list shows the ids`)
    const check = checkOf(entry.check)
    if (!kase && !check) throw new Error('filing under an existing class needs a "case" (or a "check" to automate it)')
    // Escalation: the class gets its automatic check, replacing an older one.
    if (check) c.check = check
    const dup = !kase || c.cases.some((x) => x.rv && x.rv === kase.rv && x.feature === kase.feature && x.pr === kase.pr)
    if (!dup) c.cases.push(kase)
    // A new trigger or path learnt from this case widens the class.
    for (const k of ['triggers', 'paths']) for (const t of strs(entry[k])) if (!(c[k] ?? []).includes(t)) c[k] = [...(c[k] ?? []), t]
    return { cat: { ...cat, classes }, id: c.id, added: !dup }
  }

  for (const k of ['title', 'signature', 'question']) if (typeof entry[k] !== 'string' || !entry[k].trim()) throw new Error(`a new class needs "${k}"`)
  const triggers = strs(entry.triggers)
  if (!triggers.length) throw new Error('a new class needs at least one trigger')
  for (const t of triggers) triggerRe(t)
  if (entry.gate !== undefined && !GATES.includes(entry.gate)) throw new Error(`gate must be one of ${GATES.join(', ')}`)
  const check = checkOf(entry.check)
  const c = {
    id: nextId(classes),
    title: entry.title.trim(),
    signature: entry.signature.trim(),
    question: entry.question.trim(),
    triggers,
    paths: strs(entry.paths),
    gate: entry.gate ?? 'review',
    check,
    origin: typeof entry.origin === 'string' ? entry.origin : 'project',
    cases: kase ? [kase] : [],
  }
  classes.push(c)
  return { cat: { ...cat, classes }, id: c.id, added: true }
}

function checkOf(v) {
  if (v === undefined || v === null) return null
  if (!isObj(v) || typeof v.pattern !== 'string') throw new Error('a check is {"pattern": "<regex>", "paths"?: [globs], "message"?: "…"}')
  new RegExp(v.pattern)
  return { pattern: v.pattern, paths: strs(v.paths), message: typeof v.message === 'string' ? v.message : null }
}

/**
 * Pure: the classes `text` and `paths` are exposed to — a trigger found in the text, or a changed
 * path under one of the class's paths — scored by the evidence and by how often the class was
 * confirmed, highest first.
 */
export function matchClasses(cat, { text = '', paths = [] }, max = 8) {
  const scored = []
  for (const c of cat.classes) {
    const hits = (c.triggers ?? []).filter((t) => triggerRe(t).test(text))
    const onPath = (c.paths ?? []).some((g) => paths.some((p) => globRe(g).test(p)))
    if (!hits.length && !onPath) continue
    const cases = (c.cases ?? []).length
    scored.push({ id: c.id, title: c.title, question: c.question, cases, hits, onPath, score: hits.length + (onPath ? 3 : 0) + 2 * cases })
  }
  return scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, max)
}

/** Pure: unified diff → the files it touches and the lines it adds, `{file, line, text}`. */
export function parseDiff(diff) {
  const files = []
  const added = []
  let file = null
  let line = 0
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) {
      file = l.slice(4).replace(/^b\//, '')
      if (file !== '/dev/null') files.push(file)
    } else if (l.startsWith('@@')) {
      line = Number(/\+(\d+)/.exec(l)?.[1] ?? 0)
    } else if (l.startsWith('+') && file) {
      added.push({ file, line, text: l.slice(1) })
      line++
    } else if (!l.startsWith('-')) {
      line++
    }
  }
  return { files, added }
}

/** Pure: every class's automatic check against the added lines. */
export function runChecks(cat, added) {
  const out = []
  for (const c of cat.classes) {
    if (!c.check) continue
    const re = new RegExp(c.check.pattern)
    const globs = (c.check.paths ?? []).map(globRe)
    for (const a of added) {
      if (globs.length && !globs.some((g) => g.test(a.file))) continue
      if (re.test(a.text)) out.push({ id: c.id, title: c.title, file: a.file, line: a.line, text: a.text.trim().slice(0, 160), message: c.check.message ?? c.question })
    }
  }
  return out
}

export function escalations(cat, min = 3) {
  return cat.classes.filter((c) => !c.check && (c.cases ?? []).length >= min).map((c) => ({ id: c.id, title: c.title, cases: c.cases.length }))
}

// ---------------------------------------------------------------- markdown

export function listMd(cat) {
  if (!cat.classes.length) return 'No bug classes yet.\n'
  const rows = cat.classes.map((c) => `| ${c.id} | ${c.title} | ${(c.cases ?? []).length} | ${c.gate ?? '—'} | ${c.check ? 'yes' : '—'} |`)
  return ['| ID | Class | Confirmed | Should be caught at | Auto check |', '| --- | --- | --- | --- | --- |', ...rows].join('\n') + '\n'
}

export function matchMd(found) {
  if (!found.length) return 'No bug class of this project applies.\n'
  return found.map((f) => `- **${f.id} · ${f.title}**${f.cases ? ` (confirmed ${f.cases}×)` : ''} — ${f.question}`).join('\n') + '\n'
}

// ---------------------------------------------------------------- CLI

function out(v, code = 0) {
  process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v, null, 2) + '\n')
  process.exit(code)
}

function usage() {
  process.stderr.write(
    'usage: lessons.mjs list [--md] | match [--text s] [--text-file f] [--paths a,b] [--diff range] [--max n] [--md]\n' +
      "       | add '<json>' | check --diff <range> | escalate [--min n]   [--cwd <dir>]\n",
  )
  process.exit(1)
}

function diffOf(range, cwd) {
  const r = spawnSync('git', ['diff', '--unified=0', range], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (r.status !== 0) out({ error: (r.stderr || 'git diff failed').trim() }, 1)
  return parseDiff(r.stdout)
}

function main() {
  const argv = process.argv.slice(2)
  const flags = {}
  const pos = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--md') flags.md = true
    else if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i]
    else pos.push(argv[i])
  }
  const cwd = flags.cwd ?? process.cwd()
  const [cmd, json] = pos
  let cat
  try {
    cat = load(cwd)
  } catch (e) {
    out({ error: `.kss/lessons.json is not valid JSON: ${e.message}` }, 1)
  }

  if (cmd === 'list') return out(flags.md ? listMd(cat) : cat)
  if (cmd === 'match') {
    let text = flags.text ?? ''
    let paths = flags.paths ? flags.paths.split(',').map((s) => s.trim()).filter(Boolean) : []
    if (flags['text-file']) text += '\n' + readFileSync(flags['text-file'], 'utf8')
    if (flags.diff) {
      const d = diffOf(flags.diff, cwd)
      paths = [...paths, ...d.files]
      text += '\n' + d.added.map((a) => a.text).join('\n')
    }
    const found = matchClasses(cat, { text, paths }, Number(flags.max ?? 8))
    return out(flags.md ? matchMd(found) : found)
  }
  if (cmd === 'add') {
    if (json === undefined) usage()
    let entry
    try {
      entry = JSON.parse(json)
    } catch {
      out({ error: 'argument is not valid JSON' }, 1)
    }
    try {
      const r = addEntry(cat, entry)
      save(cwd, r.cat)
      const c = r.cat.classes.find((x) => x.id === r.id)
      return out({ id: r.id, added: r.added, cases: c.cases.length, escalate: !c.check && c.cases.length >= 3 })
    } catch (e) {
      out({ error: e.message }, 1)
    }
  }
  if (cmd === 'check') {
    if (!flags.diff) usage()
    return out(runChecks(cat, diffOf(flags.diff, cwd).added))
  }
  if (cmd === 'escalate') return out(escalations(cat, Number(flags.min ?? 3)))
  usage()
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
