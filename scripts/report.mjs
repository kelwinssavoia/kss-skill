#!/usr/bin/env node
// report.mjs <feature-dir> [--check <phase>]
//
// The feature's explained report (DESIGN.md §25). Every phase ends by writing
// <feature-dir>/report/<phase>.json — what it did and each decision, in the conversation
// language (.kss/references/report.md) — and running this script, which validates every phase
// file and rebuilds <feature-dir>/report/index.html: one self-contained, interactive page with
// the track, each phase, every decision, and the cost of each phase from metrics.jsonl.
// When report/feature.json exists (the living feature, written only by feature.mjs — §25.1) the
// page opens on it, with each requirement's progress derived here from the tickets and the run;
// execute rebuilds after every integration so that progress stays live.
//
//   node .kss/scripts/report.mjs specs/012-x               validate all, write index.html
//   node .kss/scripts/report.mjs specs/012-x --check spec  validate report/spec.json only
//
// The model writes only content; the page, the ordering, the cost and the Next line are
// computed here, so every report looks the same and costs a few hundred tokens to produce.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ORDER, TRACKS, readHeader } from './next.mjs'
import { aggregate } from './render-cost.mjs'
import { client } from './report-client.mjs'
import { FUNCTIONS, check, compile, exprLib } from './expr.mjs'

export const DIR = 'report'

export const KINDS = ['business', 'layout', 'technical', 'scope', 'design', 'auto', 'review', 'execution', 'quality']
export const STATUSES =['decided', 'auto', 'accepted', 'overridden', 'reopened', 'deferred', 'open', 'rejected']

// Short by construction: a report illustrates, it does not narrate. Past these the script refuses
// the file, so the phase cuts words or turns them into a diagram, an example or a table.
export const CAP = { summary: 600, line: 200, did: 7, text: 700, decision: 400, explain: 320, note: 240, sections: 24, codeLines: 60, label: 80 }

/** The limits reports written before the succinct rule were held to: still accepted for them. */
export const LOOSE = { ...CAP, summary: 1500, line: 600, did: 50, decision: 1500 }

export const SECTION_TYPES = ['text', 'callout', 'code', 'diff', 'flow', 'sequence', 'example', 'table', 'files', 'states', 'simulator']

export const INPUT_TYPES = ['number', 'text', 'boolean', 'enum', 'date', 'time']
export const OUTPUT_FORMATS = ['money', 'percent', 'text', 'number', 'boolean']
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
// Words an input or derived id cannot take: the expression language reads them as something else.
const RESERVED = ['true', 'false', 'null', ...FUNCTIONS, 'constructor', '__proto__', 'prototype', 'toString', 'valueOf', 'hasOwnProperty']

const isStr = (v) => typeof v === 'string' && v.trim().length > 0

/** Problems with one phase file, as lines; empty when it is valid. */
export function validate(r, phase, caps = CAP) {
  const errs = []
  const where = (k) => `${phase}.json: ${k}`
  if (!r || typeof r !== 'object' || Array.isArray(r)) return [`${phase}.json: not a JSON object`]
  if (r.phase !== phase) errs.push(where(`"phase" must be "${phase}" (the file name)`))
  if (!ORDER.includes(phase)) errs.push(where(`unknown phase — one of ${ORDER.join(', ')}`))
  if (!isStr(r.lang)) errs.push(where('"lang" is required — the conversation_language, e.g. "pt-BR"'))
  if (!isStr(r.summary)) errs.push(where('"summary" is required'))
  else if (r.summary.length > caps.summary) errs.push(where(`"summary" is over ${caps.summary} characters — cut it; show the rest with a section`))
  const strings = (k, required = false) => {
    const v = r[k]
    if (v === undefined && !required) return
    if (!Array.isArray(v) || (required && !v.length) || !v.every(isStr)) errs.push(where(`"${k}" must be a${required ? ' non-empty' : 'n'} array of strings`))
    else if (v.some((s) => s.length > caps.line)) errs.push(where(`an entry of "${k}" is over ${caps.line} characters`))
  }
  strings('did', true)
  if (Array.isArray(r.did) && r.did.length > caps.did) errs.push(where(`"did" has ${r.did.length} lines — at most ${caps.did}`))
  strings('open')
  strings('risks')
  if (r.decisions !== undefined) {
    if (!Array.isArray(r.decisions)) errs.push(where('"decisions" must be an array'))
    else
      r.decisions.forEach((d, i) => {
        const at = `decisions[${i}]`
        if (!d || typeof d !== 'object') return errs.push(where(`${at} must be an object`))
        if (!isStr(d.title)) errs.push(where(`${at}.title is required`))
        if (!isStr(d.decision)) errs.push(where(`${at}.decision is required`))
        if (d.kind !== undefined && !KINDS.includes(d.kind)) errs.push(where(`${at}.kind — one of ${KINDS.join(', ')}`))
        if (d.status !== undefined && !STATUSES.includes(d.status)) errs.push(where(`${at}.status — one of ${STATUSES.join(', ')}`))
        if (d.rejected !== undefined && (!Array.isArray(d.rejected) || !d.rejected.every(isStr))) errs.push(where(`${at}.rejected must be an array of strings`))
        for (const k of ['id', 'why', 'source']) if (d[k] !== undefined && typeof d[k] !== 'string') errs.push(where(`${at}.${k} must be a string`))
        for (const k of ['decision', 'why']) if (typeof d[k] === 'string' && d[k].length > caps.decision) errs.push(where(`${at}.${k} is over ${caps.decision} characters`))
      })
  }
  if (r.highlights !== undefined) {
    if (!Array.isArray(r.highlights)) errs.push(where('"highlights" must be an array'))
    else
      r.highlights.forEach((g, i) => {
        if (!g || !isStr(g.group) || !Array.isArray(g.items)) return errs.push(where(`highlights[${i}] needs "group" and "items"`))
        g.items.forEach((it, j) => {
          if (!it || !isStr(it.text)) errs.push(where(`highlights[${i}].items[${j}].text is required`))
        })
      })
  }
  if (r.sections !== undefined) {
    if (!Array.isArray(r.sections)) errs.push(where('"sections" must be an array'))
    else {
      if (r.sections.length > CAP.sections) errs.push(where(`"sections" has ${r.sections.length} — at most ${CAP.sections}`))
      r.sections.forEach((sec, i) => errs.push(...validateSection(sec, i).map(where)))
    }
  }
  if (r.artifacts !== undefined) {
    if (!Array.isArray(r.artifacts) || !r.artifacts.every((a) => a && isStr(a.path))) errs.push(where('"artifacts" must be [{ "path", "what" }]'))
  }
  return errs
}

const longer = (v, n) => typeof v === 'string' && v.length > n

/** Problems with one rich section (DESIGN.md §25), as `sections[i]…` lines. */
export function validateSection(s, i) {
  const at = `sections[${i}]`
  const errs = []
  if (!s || typeof s !== 'object') return [`${at} must be an object`]
  if (!SECTION_TYPES.includes(s.type)) return [`${at}.type — one of ${SECTION_TYPES.join(', ')}`]
  if (s.title !== undefined && !isStr(s.title)) errs.push(`${at}.title must be a string`)
  if (longer(s.title, CAP.label)) errs.push(`${at}.title is over ${CAP.label} characters`)
  if (longer(s.intro, CAP.note)) errs.push(`${at}.intro is over ${CAP.note} characters`)
  const need = (k, test, what) => {
    if (!test(s[k])) errs.push(`${at} (${s.type}).${k} ${what}`)
  }
  const arr = (v) => Array.isArray(v) && v.length > 0
  switch (s.type) {
    case 'text':
    case 'callout':
      need('body', isStr, 'is required')
      if (longer(s.body, CAP.text)) errs.push(`${at}.body is over ${CAP.text} characters — show it instead (flow, example, table, code)`)
      if (s.tone !== undefined && !['info', 'warn', 'ok', 'bad'].includes(s.tone)) errs.push(`${at}.tone — info, warn, ok or bad`)
      break
    case 'code':
      need('code', isStr, 'is required — copied verbatim from the file')
      need('file', isStr, 'is required — the path, relative to the repository root')
      if (isStr(s.code) && s.code.split('\n').length > CAP.codeLines) errs.push(`${at}.code has more than ${CAP.codeLines} lines — show the part that matters`)
      if (s.line !== undefined && !(Number.isInteger(s.line) && s.line > 0)) errs.push(`${at}.line must be the 1-based line the snippet starts at`)
      if (s.highlight !== undefined && !(Array.isArray(s.highlight) && s.highlight.every(Number.isInteger))) errs.push(`${at}.highlight must be line numbers`)
      if (s.lines !== undefined && !(Array.isArray(s.lines) && s.lines.every((x) => x === null || Number.isInteger(x)))) errs.push(`${at}.lines is written by report.mjs — leave it out`)
      if (longer(s.explain, CAP.explain)) errs.push(`${at}.explain is over ${CAP.explain} characters`)
      break
    case 'diff':
      if (!isStr(s.diff) && !isStr(s.before) && !isStr(s.after)) errs.push(`${at} (diff) needs "diff" or "before"/"after"`)
      for (const k of ['diff', 'before', 'after']) if (isStr(s[k]) && s[k].split('\n').length > CAP.codeLines) errs.push(`${at}.${k} has more than ${CAP.codeLines} lines`)
      if (longer(s.explain, CAP.explain)) errs.push(`${at}.explain is over ${CAP.explain} characters`)
      break
    case 'flow': {
      need('nodes', arr, 'must list the boxes: [{ "id", "label", "group"?, "detail"?, "changed"? }]')
      const ids = new Set((Array.isArray(s.nodes) ? s.nodes : []).map((n) => n && n.id))
      ;(Array.isArray(s.nodes) ? s.nodes : []).forEach((n, j) => {
        if (!n || !isStr(n.id) || !isStr(n.label)) errs.push(`${at}.nodes[${j}] needs "id" and "label"`)
        else if (longer(n.label, 44)) errs.push(`${at}.nodes[${j}].label is over 44 characters`)
        if (n && longer(n.detail, CAP.note)) errs.push(`${at}.nodes[${j}].detail is over ${CAP.note} characters`)
      })
      if (ids.size > 16) errs.push(`${at} has more than 16 boxes — split it`)
      ;(Array.isArray(s.edges) ? s.edges : []).forEach((e, j) => {
        if (!e || !ids.has(e.from) || !ids.has(e.to)) errs.push(`${at}.edges[${j}] must join two node ids`)
        if (e && longer(e.label, 40)) errs.push(`${at}.edges[${j}].label is over 40 characters`)
      })
      break
    }
    case 'sequence': {
      need('participants', arr, 'must list the lifelines, in order')
      const ps = new Set(Array.isArray(s.participants) ? s.participants : [])
      if (ps.size > 6) errs.push(`${at} has more than 6 participants`)
      need('messages', arr, 'must list [{ "from", "to", "text", "kind"?: "reply"|"error", "detail"? }]')
      ;(Array.isArray(s.messages) ? s.messages : []).forEach((m, j) => {
        if (!m || !ps.has(m.from) || !ps.has(m.to) || !isStr(m.text)) errs.push(`${at}.messages[${j}] needs "from" and "to" among the participants, and "text"`)
        else if (longer(m.text, 60)) errs.push(`${at}.messages[${j}].text is over 60 characters — put the rest in "detail"`)
        if (m && longer(m.detail, CAP.note)) errs.push(`${at}.messages[${j}].detail is over ${CAP.note} characters`)
      })
      if (Array.isArray(s.messages) && s.messages.length > 14) errs.push(`${at} has more than 14 messages`)
      break
    }
    case 'example': {
      const cases = Array.isArray(s.cases) ? s.cases : [{ name: s.title, steps: s.steps }]
      if (!cases.length) errs.push(`${at} (example) needs "steps" or "cases"`)
      cases.forEach((c, j) => {
        if (!c || !arr(c.steps)) return errs.push(`${at} case ${j + 1} needs "steps": [{ "label", "input"?, "output"?, "note"? }]`)
        if (Array.isArray(s.cases) && !isStr(c.name)) errs.push(`${at}.cases[${j}].name is required`)
        c.steps.forEach((st, k) => {
          if (!st || !isStr(st.label)) errs.push(`${at} case ${j + 1} step ${k + 1} needs "label"`)
          else if (longer(st.label, 120)) errs.push(`${at} case ${j + 1} step ${k + 1} label is over 120 characters`)
          if (st && longer(st.note, CAP.note)) errs.push(`${at} case ${j + 1} step ${k + 1} note is over ${CAP.note} characters`)
          for (const key of ['input', 'output']) if (st && isStr(st[key]) && st[key].split('\n').length > 30) errs.push(`${at} case ${j + 1} step ${k + 1} ${key} is over 30 lines`)
        })
      })
      break
    }
    case 'table':
      need('columns', (v) => arr(v) && v.every(isStr), 'must be an array of strings')
      need('rows', (v) => Array.isArray(v) && v.every((r) => Array.isArray(r)), 'must be an array of rows (arrays)')
      if (Array.isArray(s.rows) && s.rows.length > 30) errs.push(`${at} has more than 30 rows`)
      break
    case 'files':
      need('items', (v) => arr(v) && v.every((f) => f && isStr(f.path)), 'must be [{ "path", "change"?, "added"?, "deleted"?, "what"? }]')
      ;(Array.isArray(s.items) ? s.items : []).forEach((f, j) => {
        if (f && f.change !== undefined && !['added', 'modified', 'deleted', 'renamed'].includes(f.change)) errs.push(`${at}.items[${j}].change — added, modified, deleted or renamed`)
        if (f && longer(f.what, 100)) errs.push(`${at}.items[${j}].what is over 100 characters`)
      })
      break
    case 'states':
      errs.push(...validateStates(s, at))
      break
    case 'simulator':
      errs.push(...validateSimulator(s, at))
      break
  }
  return errs
}

const list = (v) => (Array.isArray(v) ? v : [])
const strList = (v) => v === undefined || (Array.isArray(v) && v.every(isStr))

/** A state machine: states, the events that move between them, the guards on those events. */
function validateStates(s, at) {
  const errs = []
  if (!isStr(s.id)) errs.push(`${at} (states).id is required`)
  if (!Array.isArray(s.states) || !s.states.length) return [...errs, `${at} (states).states must list [{ "id", "label", "detail"? }]`]
  const ids = new Set()
  s.states.forEach((st, j) => {
    if (!st || !isStr(st.id) || !isStr(st.label)) return errs.push(`${at}.states[${j}] needs "id" and "label"`)
    if (ids.has(st.id)) errs.push(`${at}.states[${j}].id "${st.id}" is repeated`)
    ids.add(st.id)
    if (longer(st.label, 44)) errs.push(`${at}.states[${j}].label is over 44 characters`)
    if (longer(st.detail, CAP.note)) errs.push(`${at}.states[${j}].detail is over ${CAP.note} characters`)
  })
  if (ids.size > 12) errs.push(`${at} has more than 12 states — split the machine`)
  if (!ids.has(s.initial)) errs.push(`${at} (states).initial must be one of the state ids`)
  if (!Array.isArray(s.transitions) || !s.transitions.length) errs.push(`${at} (states).transitions must list [{ "from", "to", "event", "guard"?, "fr"? }]`)
  list(s.transitions).forEach((t, j) => {
    if (!t || !ids.has(t.from) || !ids.has(t.to)) return errs.push(`${at}.transitions[${j}] must join two state ids`)
    if (!isStr(t.event)) errs.push(`${at}.transitions[${j}].event is required`)
    else if (longer(t.event, 40)) errs.push(`${at}.transitions[${j}].event is over 40 characters`)
    if (t.guard !== undefined && !isStr(t.guard)) errs.push(`${at}.transitions[${j}].guard must be a string`)
    if (longer(t.guard, 120)) errs.push(`${at}.transitions[${j}].guard is over 120 characters`)
    if (!strList(t.fr)) errs.push(`${at}.transitions[${j}].fr must be FR ids`)
  })
  return errs
}

const fmt = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v))

/**
 * A simulator: inputs, derived values, rules (`when` → outputs) and scenarios. Every expression
 * must compile against the names it may see, and every scenario with an `expect` must produce it
 * — a mismatch is refused with the rule that fired, so the model fixes its rules (or the spec).
 */
function validateSimulator(s, at) {
  const errs = []
  if (!isStr(s.id)) errs.push(`${at} (simulator).id is required`)
  if (!isStr(s.title)) errs.push(`${at} (simulator).title is required`)
  if (s.hit !== undefined && !['first', 'all'].includes(s.hit)) errs.push(`${at}.hit — "first" (the first rule that holds) or "all"`)
  if (!Array.isArray(s.inputs) || !s.inputs.length) errs.push(`${at} (simulator).inputs must list [{ "id", "label", "type", "default" }]`)
  if (!Array.isArray(s.outputs) || !s.outputs.length) errs.push(`${at} (simulator).outputs must list [{ "id", "label", "format"? }]`)
  if (!Array.isArray(s.rules) || !s.rules.length) errs.push(`${at} (simulator).rules must list [{ "id", "when", "then" }]`)
  if (errs.length) return errs
  const seen = new Set()
  const name = (id, where) => {
    if (!isStr(id) || !IDENT.test(id)) return errs.push(`${where}.id must be a plain name (letters, digits, _)`), false
    if (RESERVED.includes(id)) return errs.push(`${where}.id "${id}" is a reserved word of the expressions`), false
    if (seen.has(id)) return errs.push(`${where}.id "${id}" is repeated`), false
    seen.add(id)
    return true
  }
  if (s.inputs.length > 12) errs.push(`${at} has more than 12 inputs`)
  s.inputs.forEach((i, j) => {
    const w = `${at}.inputs[${j}]`
    if (!i || typeof i !== 'object') return errs.push(`${w} must be an object`)
    name(i.id, w)
    if (!isStr(i.label)) errs.push(`${w}.label is required`)
    else if (longer(i.label, CAP.label)) errs.push(`${w}.label is over ${CAP.label} characters`)
    if (!INPUT_TYPES.includes(i.type)) return errs.push(`${w}.type — one of ${INPUT_TYPES.join(', ')}`)
    if (i.type === 'enum' && !(Array.isArray(i.options) && i.options.length && i.options.every((o) => isStr(o) || typeof o === 'number'))) errs.push(`${w}.options must list the choices`)
    const d = i.default
    const okDefault =
      i.type === 'number' ? d === null || typeof d === 'number'
      : i.type === 'boolean' ? typeof d === 'boolean'
      : i.type === 'enum' ? Array.isArray(i.options) && i.options.includes(d)
      : i.type === 'date' ? typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
      : i.type === 'time' ? typeof d === 'string' && /^\d{1,2}:\d{2}$/.test(d)
      : typeof d === 'string'
    if (!okDefault) errs.push(`${w}.default must be a ${i.type === 'enum' ? 'one of its options' : i.type === 'date' ? "date 'YYYY-MM-DD'" : i.type === 'time' ? "time 'HH:MM'" : i.type} value`)
    for (const k of ['min', 'max']) if (i[k] !== undefined && typeof i[k] !== 'number') errs.push(`${w}.${k} must be a number`)
    if (longer(i.unit, 12)) errs.push(`${w}.unit is over 12 characters`)
  })
  const inputIds = s.inputs.map((i) => i && i.id)
  const known = [...inputIds]
  if (list(s.derive).length > 12) errs.push(`${at} has more than 12 derived values`)
  list(s.derive).forEach((d, j) => {
    const w = `${at}.derive[${j}]`
    if (!d || typeof d !== 'object') return errs.push(`${w} must be an object`)
    if (!name(d.id, w)) return
    const c = compile(d.expr, known)
    if (!c.ok) errs.push(`${w} (${d.id}).expr: ${c.error}`)
    known.push(d.id)
  })
  const outIds = []
  s.outputs.forEach((o, j) => {
    const w = `${at}.outputs[${j}]`
    if (!o || !isStr(o.id) || !IDENT.test(o.id)) return errs.push(`${w}.id must be a plain name (letters, digits, _)`)
    if (outIds.includes(o.id)) errs.push(`${w}.id "${o.id}" is repeated`)
    outIds.push(o.id)
    if (!isStr(o.label)) errs.push(`${w}.label is required`)
    if (o.format !== undefined && !OUTPUT_FORMATS.includes(o.format)) errs.push(`${w}.format — one of ${OUTPUT_FORMATS.join(', ')}`)
    if (longer(o.unit, 12)) errs.push(`${w}.unit is over 12 characters`)
  })
  if (s.rules.length > 24) errs.push(`${at} has more than 24 rules`)
  const ruleIds = new Set()
  s.rules.forEach((r, j) => {
    const w = `${at}.rules[${j}]`
    if (!r || typeof r !== 'object') return errs.push(`${w} must be an object`)
    if (!isStr(r.id)) errs.push(`${w}.id is required`)
    else if (ruleIds.has(r.id)) errs.push(`${w}.id "${r.id}" is repeated`)
    ruleIds.add(r.id)
    if (longer(r.label, 120)) errs.push(`${w}.label is over 120 characters`)
    const c = compile(r.when, known)
    if (!c.ok) errs.push(`${w} (${r.id}).when: ${c.error}`)
    if (!r.then || typeof r.then !== 'object' || Array.isArray(r.then)) return errs.push(`${w}.then must map output ids to expressions`)
    for (const [k, v] of Object.entries(r.then)) {
      if (!outIds.includes(k)) errs.push(`${w}.then.${k} is not an output — outputs: ${outIds.join(', ')}`)
      const t = compile(typeof v === 'string' ? v : JSON.stringify(v), known)
      if (!t.ok) errs.push(`${w} (${r.id}).then.${k}: ${t.error}`)
    }
    if (!strList(r.fr)) errs.push(`${w}.fr must be FR ids`)
    if (r.rule !== undefined && !isStr(r.rule)) errs.push(`${w}.rule must be a rule id such as "R-01"`)
  })
  if (list(s.scenarios).length > 20) errs.push(`${at} has more than 20 scenarios`)
  list(s.scenarios).forEach((sc, j) => {
    const w = `${at}.scenarios[${j}]`
    if (!sc || !isStr(sc.name)) return errs.push(`${w}.name is required`)
    if (longer(sc.name, CAP.label)) errs.push(`${w}.name is over ${CAP.label} characters`)
    if (longer(sc.note, CAP.note)) errs.push(`${w}.note is over ${CAP.note} characters`)
    if (!sc.inputs || typeof sc.inputs !== 'object') return errs.push(`${w}.inputs must map input ids to values`)
    for (const k of Object.keys(sc.inputs)) if (!inputIds.includes(k)) errs.push(`${w}.inputs.${k} is not an input`)
    if (sc.expect !== undefined && (!sc.expect || typeof sc.expect !== 'object')) errs.push(`${w}.expect must map output ids to values`)
    for (const k of Object.keys(sc.expect ?? {})) if (!outIds.includes(k)) errs.push(`${w}.expect.${k} is not an output`)
  })
  if (errs.length) return errs
  // Everything compiles: run each scenario and hold it to what it says it expects.
  const ruleRef = (id) => {
    const r = s.rules.find((x) => x.id === id)
    return r && r.rule ? `${id} (${r.rule})` : id
  }
  list(s.scenarios).forEach((sc, j) => {
    const r = check(s, sc)
    const fired = r.result.fired.length ? `rule ${r.result.fired.map(ruleRef).join(', ')} fired` : 'no rule fired'
    r.result.errors.forEach((e) => errs.push(`${at}.scenarios[${j}] "${sc.name}": ${e}`))
    r.mismatches.forEach((m) => errs.push(`${at}.scenarios[${j}] "${sc.name}": expected ${m.output} = ${fmt(m.expected)}, the rules give ${fmt(m.got)} (${fired}) — fix the rule to match the behaviour, or the expectation`))
  })
  return errs
}

/** The repository the feature folder lives in: the nearest parent with a `.git`. */
export function repoRoot(dir) {
  let d = resolve(dir)
  for (;;) {
    if (existsSync(join(d, '.git'))) return d
    const up = dirname(d)
    if (up === d) return null
    d = up
  }
}

const isElision = (l) => /^(\.\.\.|…|⋮|\/\/\s*(\.\.\.|…)|#\s*(\.\.\.|…)|\/\*\s*(\.\.\.|…)\s*\*\/|\{\/\*\s*(\.\.\.|…)\s*\*\/\})$/.test(l)

/**
 * A code section must quote the repository: every non-blank line of the snippet (elisions such
 * as `…` or `// ...` aside) is found, in order, in the file it names. Checked for the phase just
 * written only — files move on after a phase, and an old report stays what it was.
 */
export function checkSnippets(report, root) {
  const errs = []
  ;(report.sections ?? []).forEach((s, i) => {
    if (!s || s.type !== 'code' || !isStr(s.code) || !isStr(s.file)) return
    const path = join(root, s.file)
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      errs.push(`${report.phase}.json: sections[${i}].file ${s.file} does not exist in the repository`)
      return
    }
    const lines = text.split('\n').map((l) => l.trim())
    let at = 0
    const numbers = []
    for (const raw of s.code.split('\n')) {
      const l = raw.trim()
      if (isElision(l)) {
        numbers.push(null)
        continue
      }
      if (!l) {
        // A blank line sits where the file has one, right after the previous match.
        numbers.push(at < lines.length && lines[at] === '' ? ++at : null)
        continue
      }
      const found = lines.indexOf(l, at)
      if (found < 0) {
        errs.push(`${report.phase}.json: sections[${i}] — "${l.slice(0, 60)}" is not in ${s.file} (after the previous line); copy the code verbatim`)
        return
      }
      numbers.push(found + 1)
      at = found + 1
    }
    // The real line number of every snippet line (null for an elision), so the page numbers it
    // right across a `// …`; report.mjs writes it into the phase file.
    s.lines = numbers
    if (Number.isInteger(s.line)) {
      const first = s.code.split('\n').map((l) => l.trim()).find(Boolean)
      if (first && lines[s.line - 1] !== first) errs.push(`${report.phase}.json: sections[${i}].line ${s.line} — the snippet starts at line ${lines.indexOf(first) + 1} of ${s.file}`)
    }
  })
  return errs
}

// ── The living feature (DESIGN.md §25.1) ────────────────────────────────────────────────────────
// report/feature.json is the feature as it is now — product and technical — that every phase
// updates through feature.mjs. Its shape is checked here so a plain rebuild and the writer agree.

export const FEATURE_FILE = 'feature.json'
export const REQ_STATUSES = ['planned', 'building', 'done', 'dropped']
export const FCAP = { title: 120, problem: 600, item: 200, actors: 12, scope: 20, text: 400, items: 60, sims: 8, machines: 8, code: 12, changes: 300 }

/** Problems with feature.json, as `feature.json: …` lines; empty when it is valid. */
export function validateFeature(f) {
  const errs = []
  const where = (k) => `feature.json: ${k}`
  if (!f || typeof f !== 'object' || Array.isArray(f)) return [where('not a JSON object')]
  if (!isStr(f.feature)) errs.push(where('"feature" is required'))
  if (f.lang !== undefined && !isStr(f.lang)) errs.push(where('"lang" must be a string such as "pt-BR"'))
  const p = f.product
  if (p !== undefined) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) errs.push(where('"product" must be an object'))
    else {
      for (const [k, n] of [['title', FCAP.title], ['problem', FCAP.problem], ['outcome', FCAP.problem]]) {
        if (p[k] !== undefined && typeof p[k] !== 'string') errs.push(where(`product.${k} must be a string`))
        else if (longer(p[k], n)) errs.push(where(`product.${k} is over ${n} characters`))
      }
      for (const [k, n] of [['actors', FCAP.actors], ['inScope', FCAP.scope], ['outOfScope', FCAP.scope]]) {
        if (p[k] === undefined) continue
        if (!Array.isArray(p[k]) || !p[k].every(isStr)) errs.push(where(`product.${k} must be an array of strings`))
        else if (p[k].length > n) errs.push(where(`product.${k} has ${p[k].length} entries — at most ${n}`))
        else if (p[k].some((x) => x.length > FCAP.item)) errs.push(where(`an entry of product.${k} is over ${FCAP.item} characters`))
      }
    }
  }
  const items = (k, check) => {
    if (f[k] === undefined) return []
    if (!Array.isArray(f[k])) return errs.push(where(`"${k}" must be an array`)), []
    if (f[k].length > FCAP.items) errs.push(where(`"${k}" has ${f[k].length} entries — at most ${FCAP.items}`))
    const ids = new Set()
    f[k].forEach((x, i) => {
      const at = `${k}[${i}]`
      if (!x || typeof x !== 'object') return errs.push(where(`${at} must be an object`))
      if (!isStr(x.id)) return errs.push(where(`${at}.id is required`))
      if (ids.has(x.id)) errs.push(where(`${at}.id "${x.id}" is repeated`))
      ids.add(x.id)
      check(x, `${k}[${x.id}]`)
    })
    return [...ids]
  }
  const text = (x, at, k, n = FCAP.text, required = true) => {
    if (x[k] === undefined && !required) return
    if (!isStr(x[k])) errs.push(where(`${at}.${k} is required`))
    else if (x[k].length > n) errs.push(where(`${at}.${k} is over ${n} characters`))
  }
  const refs = (x, at, k) => {
    if (x[k] !== undefined && !(Array.isArray(x[k]) && x[k].every(isStr))) errs.push(where(`${at}.${k} must be an array of ids`))
  }
  const stories = items('stories', (x, at) => text(x, at, 'text'))
  const decisions = items('decisions', (x, at) => {
    text(x, at, 'title', CAP.label)
    text(x, at, 'decision', CAP.decision)
    text(x, at, 'why', CAP.decision, false)
    if (x.kind !== undefined && !KINDS.includes(x.kind)) errs.push(where(`${at}.kind — one of ${KINDS.join(', ')}`))
    if (x.status !== undefined && !STATUSES.includes(x.status)) errs.push(where(`${at}.status — one of ${STATUSES.join(', ')}`))
    if (!ORDER.includes(x.phase)) errs.push(where(`${at}.phase — the phase that recorded it, one of ${ORDER.join(', ')}`))
    if (x.history !== undefined && !(Array.isArray(x.history) && x.history.every((h) => h && isStr(h.decision) && isStr(h.phase)))) errs.push(where(`${at}.history is written by feature.mjs — leave it out`))
  })
  const requirements = items('requirements', (x, at) => {
    text(x, at, 'text')
    refs(x, at, 'stories')
    refs(x, at, 'decisions')
    if (x.status !== undefined && !REQ_STATUSES.includes(x.status)) errs.push(where(`${at}.status — one of ${REQ_STATUSES.join(', ')}`))
  })
  const rules = items('rules', (x, at) => {
    text(x, at, 'title', CAP.label)
    text(x, at, 'text')
    refs(x, at, 'fr')
    refs(x, at, 'decisions')
    if (x.code !== undefined) {
      if (!x.code || typeof x.code !== 'object') errs.push(where(`${at}.code must be { "file", "line", "code" }`))
      else errs.push(...validateSection({ ...x.code, type: 'code' }, 0).map((e) => where(e.replace('sections[0]', `${at}.code`))))
    }
  })
  // Sections kept in the model: each validated as the section type it is.
  const sections = (k, type, max) => {
    if (f[k] === undefined) return
    if (!Array.isArray(f[k])) return errs.push(where(`"${k}" must be an array`))
    if (f[k].length > max) errs.push(where(`"${k}" has ${f[k].length} — at most ${max}`))
    f[k].forEach((s, i) => errs.push(...validateSection({ ...s, type }, i).map((e) => where(e.replace(`sections[${i}]`, `${k}[${i}]`)))))
  }
  sections('states', 'states', FCAP.machines)
  sections('simulators', 'simulator', FCAP.sims)
  sections('code', 'code', FCAP.code)
  const a = f.architecture
  if (a !== undefined) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) errs.push(where('"architecture" must be { "flow"?, "sequence"? }'))
    else
      for (const k of ['flow', 'sequence']) if (a[k] !== undefined) errs.push(...validateSection({ ...a[k], type: k }, 0).map((e) => where(e.replace('sections[0]', `architecture.${k}`))))
  }
  if (f.changes !== undefined && !(Array.isArray(f.changes) && f.changes.every((c) => c && isStr(c.text) && isStr(c.phase)))) errs.push(where('"changes" is written by feature.mjs — [{ "at", "phase", "text" }]'))
  // Links must land: an FR, story, decision or rule named somewhere exists in the model.
  const dangling = (ids, known, what) => ids.filter((x) => !known.includes(x)).forEach((x) => errs.push(where(`${what} names ${x}, which is not in the model`)))
  list(f.requirements).forEach((r) => {
    if (!r || !isStr(r.id)) return
    dangling(list(r.stories), stories, `requirements[${r.id}].stories`)
    dangling(list(r.decisions), decisions, `requirements[${r.id}].decisions`)
  })
  list(f.rules).forEach((r) => {
    if (!r || !isStr(r.id)) return
    dangling(list(r.fr), requirements, `rules[${r.id}].fr`)
    dangling(list(r.decisions), decisions, `rules[${r.id}].decisions`)
  })
  list(f.simulators).forEach((s, i) => {
    list(s && s.rules).forEach((r) => {
      if (!r) return
      if (isStr(r.rule)) dangling([r.rule], rules, `simulators[${i}] rule ${r.id}`)
      dangling(list(r.fr), requirements, `simulators[${i}] rule ${r.id} fr`)
    })
  })
  list(f.states).forEach((s, i) => list(s && s.transitions).forEach((t, j) => dangling(list(t && t.fr), requirements, `states[${i}].transitions[${j}].fr`)))
  return errs
}

const frKey = (id) => {
  const m = /^FR-0*(\d+)/i.exec(String(id))
  return m ? `FR-${m[1]}` : String(id)
}
const ticketKey = (id) => (/^\d+$/.test(String(id)) ? String(Number(id)).padStart(2, '0') : String(id))
const RUNNING = ['running', 'reviewing', 'rejected']

/**
 * The tickets of the feature and where each stands: the ticket files (`05-tickets/NN-*.md` — title,
 * layer, blockers, the FRs under "Requirements covered"), the graph table as a fallback, the
 * execution log's events, and `.kss/current` at the repository root, the live truth while execute
 * runs. Returns [] before kss-tickets has run.
 */
export function tickets(dir) {
  const tdir = join(dir, '05-tickets')
  const out = new Map()
  const get = (id) => {
    const k = ticketKey(id)
    if (!out.has(k)) out.set(k, { id: k, title: null, layer: null, blockedBy: [], fr: [], state: 'pending' })
    return out.get(k)
  }
  const ids = (s) => (String(s ?? '').match(/\d+/g) ?? []).map(ticketKey)
  let names = []
  try {
    names = readdirSync(tdir)
  } catch {
    return []
  }
  for (const n of names.filter((x) => /^\d+[-_.].*\.md$/.test(x))) {
    let t
    try {
      t = readFileSync(join(tdir, n), 'utf8')
    } catch {
      continue
    }
    const tk = get(/^\d+/.exec(n)[0])
    tk.title = /^#\s+\d+\s*[·.:-]\s*(.+)$/m.exec(t)?.[1]?.trim() ?? n.replace(/^\d+[-_.]|\.md$/g, '')
    tk.layer = /\*\*Layer:\*\*\s*([^·\n*]+)/.exec(t)?.[1]?.trim() || null
    const blocked = /\*\*Blocked by:\*\*\s*([^·\n*]+)/.exec(t)?.[1]
    if (blocked) tk.blockedBy = ids(blocked)
    const covered = /^##\s+Requirements covered\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(t)?.[1] ?? ''
    tk.fr = [...new Set((covered.match(/FR-\d+/gi) ?? []).map(frKey))]
  }
  try {
    // The graph table: | # | Ticket | Layer | Blocked by | … — fills what a ticket file left out.
    for (const line of readFileSync(join(tdir, 'graph.md'), 'utf8').split('\n')) {
      const c = line.split('|').map((x) => x.trim())
      if (c.length < 6 || !/^\d+$/.test(c[1])) continue
      const tk = get(c[1])
      tk.title ??= c[2]
      tk.layer ??= c[3] || null
      if (!tk.blockedBy.length) tk.blockedBy = ids(c[4])
    }
  } catch {
    /* no graph yet */
  }
  try {
    // The execution log, in order: the last event of a ticket says where it stands.
    const EVENT = { spawn: 'running', escalate: 'running', report: 'reviewing', integrate: 'integrated' }
    for (const line of readFileSync(join(dir, '06-execution.md'), 'utf8').split('\n')) {
      const m = /\*\*(\d+)\*\*\s*·\s*(spawn|report|verdict|integrate|escalate)\b\s*·?\s*(.*)$/.exec(line)
      if (!m || !out.has(ticketKey(m[1]))) continue
      const tk = get(m[1])
      tk.state = m[2] === 'verdict' ? (/reject/i.test(m[3]) ? 'rejected' : 'reviewing') : EVENT[m[2]]
    }
  } catch {
    /* not executing yet */
  }
  const root = repoRoot(dir)
  if (root) {
    try {
      const cur = JSON.parse(readFileSync(join(root, '.kss', 'current'), 'utf8'))
      const name = basename(resolve(dir))
      if (cur && cur.tickets && typeof cur.tickets === 'object' && (!cur.feature || cur.feature === name || String(cur.feature).endsWith('/' + name))) {
        for (const [id, t] of Object.entries(cur.tickets)) {
          if (!t || !isStr(t.state) || !out.has(ticketKey(id))) continue
          get(id).state = ['blocked', 'ready'].includes(t.state) ? 'pending' : t.state
        }
      }
    } catch {
      /* no run in progress */
    }
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
}

/**
 * Where each requirement stands, from the tickets that cover it: done when all are integrated,
 * building when any has started, planned otherwise. A dropped requirement stays dropped, and
 * one no ticket covers keeps the status the model gave it.
 */
export function progress(f, ts) {
  const byFr = {}
  for (const t of ts) for (const fr of t.fr) (byFr[fr] ??= []).push(t)
  const reqs = {}
  let done = 0
  let total = 0
  for (const r of f.requirements ?? []) {
    const ts = byFr[frKey(r.id)] ?? []
    const integrated = ts.filter((t) => t.state === 'integrated').length
    let status = r.status ?? 'planned'
    if (status !== 'dropped' && ts.length) status = integrated === ts.length ? 'done' : integrated || ts.some((t) => RUNNING.includes(t.state)) ? 'building' : 'planned'
    reqs[r.id] = { status, tickets: ts.map((t) => t.id), integrated, total: ts.length }
    if (status === 'dropped') continue
    total++
    if (status === 'done') done++
  }
  const integrated = ts.filter((t) => t.state === 'integrated').length
  return { requirements: reqs, done, total, tickets: { integrated, total: ts.length } }
}

const TICKET_TONE = { integrated: 'ok', running: 'accent', reviewing: 'warn', rejected: 'bad', pending: 'dim' }

/** The ticket graph as a flow: columns by dependency wave, each box colored by its state. */
export function ticketFlow(ts) {
  if (!ts.length) return null
  const ids = new Set(ts.map((t) => t.id))
  return {
    type: 'flow',
    nodes: ts.slice(0, 40).map((t) => ({
      id: t.id,
      label: `${t.id} · ${t.title ?? ''}`.slice(0, 44),
      group: t.state,
      tone: TICKET_TONE[t.state] ?? 'dim',
      detail: [t.layer, t.fr.join(', ')].filter(Boolean).join(' · ') || undefined,
    })),
    edges: ts.flatMap((t) => t.blockedBy.filter((b) => ids.has(b) && b !== t.id).map((b) => ({ from: b, to: t.id }))),
  }
}

/** report/feature.json, validated, with live progress from the tickets; null when absent. */
export function readFeature(dir, errors = []) {
  const p = join(dir, DIR, FEATURE_FILE)
  if (!existsSync(p)) return null
  let f
  try {
    f = JSON.parse(readFileSync(p, 'utf8'))
  } catch (e) {
    errors.push(`${FEATURE_FILE}: invalid JSON — ${e.message}`)
    return null
  }
  return living(dir, f, errors)
}

/** The feature model as the page shows it: validated, plus progress and the ticket graph. */
export function living(dir, f, errors = []) {
  const errs = validateFeature(f)
  if (errs.length) {
    errors.push(...errs)
    return null
  }
  const ts = tickets(dir)
  return { ...f, progress: progress(f, ts), tickets: ts, ticketFlow: ticketFlow(ts) }
}

/** Every `report/<phase>.json` of the feature: parsed, validated, in track order. */
export function readReports(dir, strict = null) {
  const rdir = join(dir, DIR)
  const out = []
  const errors = []
  let names = []
  try {
    names = readdirSync(rdir).filter((n) => n.endsWith('.json') && n !== FEATURE_FILE)
  } catch {
    return { reports: out, errors }
  }
  for (const n of names) {
    const phase = n.slice(0, -5)
    let r
    try {
      r = JSON.parse(readFileSync(join(rdir, n), 'utf8'))
    } catch (e) {
      errors.push(`${n}: invalid JSON — ${e.message}`)
      continue
    }
    const errs = validate(r, phase, phase === strict ? CAP : LOOSE)
    if (phase === strict && !errs.length) {
      const root = repoRoot(dir)
      if (root) {
        errs.push(...checkSnippets(r, root))
        if (!errs.length && (r.sections ?? []).some((x) => x && x.lines)) writeFileSync(join(rdir, n), JSON.stringify(r, null, 1) + '\n')
      }
    }
    if (errs.length) errors.push(...errs)
    else out.push(r)
  }
  out.sort((a, b) => ORDER.indexOf(a.phase) - ORDER.indexOf(b.phase))
  return { reports: out, errors }
}

/** metrics.jsonl → per phase `{ agents, turns, tokens, minutes }`. */
export function costs(dir) {
  const p = join(dir, 'metrics.jsonl')
  if (!existsSync(p)) return {}
  const { phases } = aggregate(readFileSync(p, 'utf8'))
  const out = {}
  for (const [name, a] of phases) {
    out[name] = {
      agents: a.agents,
      turns: a.turns,
      tokens: a.cumulative,
      minutes: a.first !== null && a.last !== null ? Math.max(0, Math.round((a.last - a.first) / 60000)) : null,
      harnesses: [...a.harnesses].sort(),
    }
  }
  return out
}

function readmeExtras(dir) {
  try {
    const t = readFileSync(join(dir, 'README.md'), 'utf8')
    const line = /^\*\*Next:\*\*[ \t]*(.*)$/m.exec(t)?.[1] ?? ''
    const next = (/^`([^`]+)`/.exec(line.trim())?.[1] ?? line.replace(/<!--.*$/, '')).trim().replace(/^Next:\s*/, '') || null
    const branch = /^\*\*Branch:\*\*\s*(.+)$/m.exec(t)?.[1]?.trim() ?? null
    return { next, branch }
  } catch {
    return { next: null, branch: null }
  }
}

/**
 * Everything the page shows, as one object. `feature` is the living model to show instead of
 * the one on disk — feature.mjs passes the merged model before it writes it.
 */
export function model(dir, now = new Date().toISOString(), strict = null, feature = undefined) {
  const header = readHeader(dir)
  const { reports, errors } = readReports(dir, strict)
  const live = feature === undefined ? readFeature(dir, errors) : feature && living(dir, feature, errors)
  const size = header.size
  const track = size && TRACKS[size] ? TRACKS[size] : ORDER
  const ran = new Set(reports.map((r) => r.phase))
  // The track, plus any optional phase that actually ran, in canonical order.
  const phases = ORDER.filter((p) => track.includes(p) || ran.has(p))
  const lang = [...reports].reverse().find((r) => isStr(r.lang))?.lang ?? (live && isStr(live.lang) ? live.lang : 'en')
  return {
    living: live,
    feature: header.feature ?? dir.split('/').filter(Boolean).pop(),
    size,
    state: header.state,
    ...readmeExtras(dir),
    lang,
    phases,
    reports,
    cost: costs(dir),
    generatedAt: now,
    errors,
  }
}

// ── The page ────────────────────────────────────────────────────────────────────────────────────

/** JSON safe inside a <script> element. */
const embed = (o) => JSON.stringify(o).replace(/[<\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))

export function html(m) {
  const title = `${m.feature} · KSS`
  return `<!doctype html>
<html lang="${String(m.lang).replace(/[^A-Za-z-]/g, '')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>${title.replace(/[<>&"]/g, '')}</title>
<style>${CSS}</style>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="kss-data">${embed(m)}</script>
<script>var kssExpr = (${exprLib.toString()})();
(${client.toString()})()</script>
</body>
</html>
`
}

const CSS = `
:root{--bg:#f6f6f7;--bg2:#ffffff;--bg3:#eeeff1;--line:#dcdde1;--text:#1d1f23;--dim:#6b6f78;--accent:#e2700f;--accent-soft:rgba(226,112,15,.12);--ok:#3f8f2f;--warn:#b58600;--bad:#c8433f;--mono:'JetBrains Mono','SF Mono',Menlo,monospace;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#17181b;--bg2:#1d1f22;--bg3:#27292d;--line:#34363b;--text:#e4e5e8;--dim:#8d9098;--accent:#f58a2e;--accent-soft:rgba(245,138,46,.14);--ok:#8fcf6f;--warn:#e8c547;--bad:#ef6461;color-scheme:dark}}
:root[data-theme=dark]{--bg:#17181b;--bg2:#1d1f22;--bg3:#27292d;--line:#34363b;--text:#e4e5e8;--dim:#8d9098;--accent:#f58a2e;--accent-soft:rgba(245,138,46,.14);--ok:#8fcf6f;--warn:#e8c547;--bad:#ef6461;color-scheme:dark}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 -apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif}
a{color:var(--accent)}code{font-family:var(--mono);font-size:12px;background:var(--bg3);padding:1px 5px;border-radius:4px}
.wrap{max-width:1080px;margin:0 auto;padding:24px 16px 64px}
header.top{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;margin-bottom:18px}
header.top h1{font:700 22px/1.2 var(--mono);margin:0;letter-spacing:-.02em}
.pill{font:600 11px var(--mono);padding:2px 8px;border-radius:10px;background:var(--bg3);color:var(--dim);border:1px solid var(--line)}
.pill.acc{background:var(--accent);color:#1c1206;border-color:var(--accent)}
.spacer{flex:1}
.theme{background:none;border:1px solid var(--line);color:var(--dim);border-radius:6px;padding:3px 8px;cursor:pointer;font:inherit;font-size:12px}
.track{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 18px}
.step{display:flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--bg2);color:var(--dim);border-radius:8px;padding:6px 10px;cursor:pointer;font:600 12px var(--mono)}
.step .n{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;background:var(--bg3);font-size:10px}
.step.done{color:var(--text)}.step.done .n{background:var(--ok);color:#fff}
.step.todo{opacity:.55;cursor:default}
.step.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset;background:var(--accent-soft)}
nav.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:18px}
nav.tabs button{background:none;border:none;border-bottom:2px solid transparent;color:var(--dim);padding:8px 12px;cursor:pointer;font:600 13px inherit;font-family:inherit}
nav.tabs button.on{color:var(--text);border-bottom-color:var(--accent)}
.card{background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin-bottom:14px}
.card h2{font-size:17px;margin:0 0 6px}.card h3{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--dim);margin:18px 0 8px}
.summary{font-size:15px;margin:6px 0 4px;white-space:pre-wrap}
.meta{display:flex;flex-wrap:wrap;gap:6px 14px;color:var(--dim);font-size:12px;margin-top:8px}
.meta b{color:var(--text);font-family:var(--mono);font-weight:600}
ul.did{margin:0;padding-left:20px}ul.did li{margin:3px 0}
.dec{border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;margin:8px 0;background:var(--bg)}
.dec>button{all:unset;display:flex;gap:10px;align-items:flex-start;width:100%;box-sizing:border-box;padding:10px 12px;cursor:pointer}
.dec .id{font:700 11px var(--mono);color:var(--accent);white-space:nowrap;padding-top:2px}
.dec .t{flex:1}.dec .t b{display:block}.dec .t span{color:var(--dim)}
.dec .chev{color:var(--dim);transition:transform .15s}.dec.open .chev{transform:rotate(90deg)}
.dec .body{display:none;padding:0 12px 12px 12px;border-top:1px dashed var(--line)}.dec.open .body{display:block}
.dec .body p{margin:10px 0 0}.dec .body .lbl{color:var(--dim);font-size:12px;display:block}
.tag{font:600 10px var(--mono);padding:1px 6px;border-radius:8px;border:1px solid var(--line);color:var(--dim);margin-left:6px;white-space:nowrap}
.tag.overridden,.tag.reopened,.tag.rejected{color:var(--bad);border-color:var(--bad)}.tag.deferred,.tag.open{color:var(--warn);border-color:var(--warn)}.tag.decided,.tag.accepted{color:var(--ok);border-color:var(--ok)}
details.hl{border:1px solid var(--line);border-radius:8px;margin:8px 0;background:var(--bg)}
details.hl summary{cursor:pointer;padding:8px 12px;font-weight:600}
details.hl ul{margin:0;padding:0 12px 10px 30px}details.hl li{margin:3px 0}
.lab{font:600 11px var(--mono);color:var(--accent);margin-right:6px}
.warnbox{border-left:3px solid var(--warn);padding:6px 10px;background:var(--bg);border-radius:6px;margin:6px 0}
.risk{border-left-color:var(--bad)}
.filters{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px}
.filters input{flex:1;min-width:200px;background:var(--bg2);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:7px 10px;font:inherit}
.chip{border:1px solid var(--line);background:var(--bg2);color:var(--dim);border-radius:14px;padding:3px 10px;cursor:pointer;font:600 12px inherit;font-family:inherit}
.chip.on{background:var(--accent-soft);border-color:var(--accent);color:var(--text)}
.timeline{position:relative;margin-left:8px;padding-left:18px;border-left:2px solid var(--line)}
.tl{position:relative;margin-bottom:14px;cursor:pointer}
.tl:before{content:'';position:absolute;left:-25px;top:6px;width:10px;height:10px;border-radius:50%;background:var(--accent);border:2px solid var(--bg)}
.tl .h{font:700 13px var(--mono)}.tl p{margin:2px 0 0;color:var(--dim)}
.empty{color:var(--dim);font-style:italic}
.errors{border:1px solid var(--bad);color:var(--bad);border-radius:8px;padding:8px 12px;margin-bottom:14px;font-size:12px;white-space:pre-wrap}
footer{color:var(--dim);font-size:12px;margin-top:30px}
@media (max-width:640px){header.top h1{font-size:18px}.card{padding:14px}}
.chead{display:flex;align-items:center;gap:10px;justify-content:space-between}
.mini{background:var(--bg3);border:1px solid var(--line);color:var(--dim);border-radius:6px;padding:2px 9px;font:600 11px inherit;font-family:inherit;cursor:pointer}
.mini:hover:not(:disabled){color:var(--text);border-color:var(--accent)}.mini:disabled{opacity:.4;cursor:default}
.block{margin:22px 0 6px}.btitle{font-size:15px;text-transform:none;letter-spacing:0;color:var(--text);margin:0 0 8px}
.prose p{margin:6px 0}.prose ul,.prose ol{margin:6px 0;padding-left:22px}.prose h4{margin:10px 0 4px;font-size:14px}
.callout{border-left:3px solid var(--accent);background:var(--accent-soft);border-radius:6px;padding:4px 12px}
.callout.warn{border-left-color:var(--warn);background:transparent}.callout.bad{border-left-color:var(--bad);background:transparent}.callout.ok{border-left-color:var(--ok);background:transparent}
figure{margin:0}
.code{border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--bg)}
.code figcaption{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--line);background:var(--bg2);font-size:12px}
.code .file{background:none;padding:0;color:var(--text)}.code .lang{color:var(--dim);font:11px var(--mono)}.grow{flex:1}
.code pre{margin:0;padding:8px 0;overflow:auto;font:12.5px/1.55 var(--mono)}
.code pre.folded{max-height:420px;overflow:hidden;-webkit-mask-image:linear-gradient(#000 80%,transparent)}
.code .more{margin:6px 10px}
.ln{display:flex;white-space:pre;padding:0 12px 0 0}.ln .no{width:48px;flex:none;text-align:right;padding-right:12px;color:var(--dim);opacity:.6;user-select:none}
.ln .tx{flex:1;padding-left:4px}.ln.gap{background:var(--bg2);opacity:.7}.ln.hl{background:var(--accent-soft);box-shadow:inset 3px 0 0 var(--accent)}
.diff .ln{padding-left:12px}.diff .ln.add{background:rgba(143,207,111,.12);color:var(--ok)}.diff .ln.del{background:rgba(239,100,97,.12);color:var(--bad)}.diff .ln.hunk{color:var(--dim)}
.tk-c{color:var(--dim);font-style:italic}.tk-s{color:#8fcf6f}.tk-n{color:#e8c547}.tk-k{color:var(--accent);font-weight:600}.tk-t{color:#6fa8dc}.tk-f{color:#c792ea}.tk-d{color:#6cc4c4}
:root:not([data-theme=dark]) .tk-s{color:#3f8f2f}:root:not([data-theme=dark]) .tk-n{color:#9a6b00}:root:not([data-theme=dark]) .tk-t{color:#2f6db0}:root:not([data-theme=dark]) .tk-f{color:#8a3fc0}:root:not([data-theme=dark]) .tk-d{color:#1f8a8a}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .tk-s{color:#8fcf6f}:root:not([data-theme=light]) .tk-n{color:#e8c547}:root:not([data-theme=light]) .tk-t{color:#6fa8dc}:root:not([data-theme=light]) .tk-f{color:#c792ea}:root:not([data-theme=light]) .tk-d{color:#6cc4c4}}
.explain{border-top:1px dashed var(--line);padding:6px 12px;font-size:13px;background:var(--bg2)}
.diagram{border:1px solid var(--line);border-radius:8px;background:var(--bg);overflow:hidden}
.dscroll{overflow:auto;padding:4px}.dscroll svg{display:block;margin:0 auto;max-width:none}
.dinfo{border-top:1px solid var(--line);padding:8px 12px;font-size:13px;color:var(--dim);min-height:38px}.dinfo b{color:var(--text);margin-right:6px}.dinfo .links{margin:6px 0 0;padding-left:18px}
.dbar{display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid var(--line)}
svg .node{cursor:pointer;outline:none}svg .node rect{fill:var(--bg2);stroke-width:1.5}svg .node .band{stroke:none}
svg .node:hover rect:first-child,svg .node.on rect:first-child,svg .node:focus rect:first-child{fill:var(--accent-soft);stroke-width:2.5}
svg .nlabel{fill:var(--text);font:600 12px -apple-system,BlinkMacSystemFont,sans-serif}svg .nlabel.sub{font-weight:400;fill:var(--dim)}
svg .node .dot{fill:var(--accent)}
svg .edge path{fill:none;stroke:var(--line);stroke-width:1.6}svg .edge.on path{stroke:var(--accent);stroke-width:2.4}
svg .edgelabel{fill:var(--dim);font:11px -apple-system,BlinkMacSystemFont,sans-serif;paint-order:stroke;stroke:var(--bg);stroke-width:4px}
svg .arrowhead{fill:var(--dim)}
svg .life{stroke:var(--line);stroke-dasharray:4 4}svg .part rect{fill:var(--bg2);stroke:var(--accent)}svg .part text{fill:var(--text);font:600 12px -apple-system,BlinkMacSystemFont,sans-serif}
svg .msg{cursor:pointer;outline:none}svg .msg line,svg .msg path{stroke:var(--dim);stroke-width:1.6;fill:none}svg .msg .hit{fill:transparent}
svg .msg.reply line{stroke-dasharray:5 4}svg .msg.error line,svg .msg.error path{stroke:var(--bad)}
svg .mlabel{fill:var(--text);font:12px -apple-system,BlinkMacSystemFont,sans-serif;paint-order:stroke;stroke:var(--bg);stroke-width:4px}
svg .msg.on line,svg .msg.on path{stroke:var(--accent);stroke-width:2.6}svg .msg.on .mlabel{fill:var(--accent);font-weight:600}svg .msg.past .mlabel{fill:var(--dim)}
.legend{display:flex;flex-wrap:wrap;gap:12px;padding:6px 12px;border-top:1px solid var(--line);font-size:12px;color:var(--dim)}.lg{display:flex;align-items:center;gap:5px}.lg i{width:10px;height:10px;border-radius:3px;display:inline-block}
.example{border:1px solid var(--line);border-radius:8px;background:var(--bg);padding:10px 12px}
.etabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}.etabs:empty{display:none}
.edots{display:flex;gap:6px;margin-bottom:8px}.edot{width:24px;height:24px;border-radius:50%;border:1px solid var(--line);background:var(--bg2);color:var(--dim);font:600 11px var(--mono);cursor:pointer}
.edot.past{background:var(--accent-soft);color:var(--text)}.edot.on{background:var(--accent);color:#1c1206;border-color:var(--accent)}
.estep .elabel{font:600 11px var(--mono);color:var(--dim)}.estep .etitle{font-size:15px;font-weight:600;margin:2px 0 8px}
.ehead{font:600 11px var(--mono);color:var(--dim);margin:8px 0 4px;text-transform:uppercase}
pre.io{margin:0;background:var(--bg2);border:1px solid var(--line);border-radius:6px;padding:8px 10px;font:12.5px/1.5 var(--mono);overflow:auto;white-space:pre}
.enav{display:flex;gap:6px;margin-top:10px}
.tscroll{overflow:auto;border:1px solid var(--line);border-radius:8px}table{border-collapse:collapse;width:100%;font-size:13px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{background:var(--bg2);font-size:12px;color:var(--dim)}tr:last-child td{border-bottom:none}
.files{border:1px solid var(--line);border-radius:8px;background:var(--bg);padding:6px 10px}
.ftotal{font:600 12px var(--mono);color:var(--dim);margin:4px 0 6px}
.fdir summary{cursor:pointer;font:600 12px var(--mono);padding:4px 0}
.frow{display:flex;gap:8px;align-items:baseline;padding:3px 0 3px 14px;font-size:12.5px;flex-wrap:wrap}
.fch{font:700 10px var(--mono);width:16px;height:16px;display:inline-grid;place-items:center;border-radius:4px;background:var(--bg3)}
.fch.added{background:rgba(143,207,111,.2);color:var(--ok)}.fch.deleted{background:rgba(239,100,97,.2);color:var(--bad)}.fch.modified{background:var(--accent-soft);color:var(--accent)}
.fnum{font:11px var(--mono);color:var(--dim)}.fwhat{color:var(--dim)}
.hero .lbl,.fsec .lbl,.machine .lbl,.sim .lbl{color:var(--dim);font:600 11px var(--mono);text-transform:uppercase;letter-spacing:.04em}
@keyframes kss-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes kss-ping{0%{box-shadow:0 0 0 0 var(--accent)}100%{box-shadow:0 0 0 10px transparent}}
@keyframes kss-flash{0%{background:var(--accent-soft)}100%{background:var(--bg2)}}
.ping{animation:kss-ping .9s ease-out}
.hero{padding:22px 22px 18px;background:linear-gradient(135deg,var(--accent-soft),transparent 55%),var(--bg2)}
.eyebrow{font:600 11px var(--mono);color:var(--accent);text-transform:uppercase;letter-spacing:.06em}
.htitle{font-size:24px;margin:4px 0 14px;letter-spacing:-.01em}
.po{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:stretch;margin-bottom:14px}
.pobox{border:1px solid var(--line);border-radius:10px;padding:10px 14px;background:var(--bg)}.pobox p{margin:4px 0 0}
.pobox.prob{border-left:3px solid var(--bad)}.pobox.out{border-left:3px solid var(--ok)}
.poarrow{display:grid;place-items:center;color:var(--accent);font-size:22px}
@media (max-width:640px){.po{grid-template-columns:1fr}.poarrow{transform:rotate(90deg)}}
.scope{display:grid;gap:8px;margin-bottom:12px}.srow{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.srow>.lbl{min-width:96px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.fchip{border:1px solid var(--line);background:var(--bg);border-radius:14px;padding:2px 10px;font-size:12.5px}
.fchip.actor{border-color:var(--accent);color:var(--text)}.fchip.in{border-color:var(--ok)}.fchip.out{color:var(--dim);text-decoration:line-through;text-decoration-color:var(--bad)}
.fchip.chg{border-color:var(--warn);color:var(--warn)}.fchip.rm{border-color:var(--bad);color:var(--bad)}
.mtrack{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0 10px}
.mstep{font:600 11px var(--mono);padding:3px 9px;border-radius:12px;background:var(--bg3);color:var(--dim);opacity:.65}
.mstep.done{opacity:1;color:var(--text)}.mstep.done:before{content:'✓ ';color:var(--ok)}
.mstep.cur{opacity:1;background:var(--accent);color:#1c1206}.mstep.cur:before{content:'● ';color:#1c1206}
.updated{font-size:12.5px;color:var(--dim);display:flex;align-items:center;gap:4px;flex-wrap:wrap}.updated b{color:var(--text);font-family:var(--mono)}
.updated .dot{width:8px;height:8px;border-radius:50%;background:var(--ok);display:inline-block;margin-right:4px;box-shadow:0 0 0 3px rgba(143,207,111,.25)}
.ulast{color:var(--text)}
details.fsec{background:var(--bg2);border:1px solid var(--line);border-radius:12px;margin-bottom:14px;animation:kss-in .25s ease-out}
details.fsec>summary{list-style:none;display:flex;align-items:center;gap:10px;padding:13px 18px;cursor:pointer;user-select:none}
details.fsec>summary::-webkit-details-marker{display:none}
.ficon{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--accent-soft);color:var(--accent);font-weight:700}
.ftitle{font-size:16px;font-weight:700;flex:1}.fmeta{font:600 12px var(--mono);color:var(--dim);background:var(--bg3);border-radius:10px;padding:2px 9px}
details.fsec>summary .chev{color:var(--dim);transition:transform .15s}details.fsec[open]>summary .chev{transform:rotate(90deg)}
.fbody{padding:0 18px 16px}
.ptop{display:flex;gap:28px;flex-wrap:wrap;margin-bottom:8px}.pbig b{font:700 26px var(--mono);display:block;line-height:1.1}.pbig span{color:var(--dim);font-size:12px}
.pbar{height:6px;border-radius:4px;background:var(--bg3);overflow:hidden;flex:1;min-width:60px}.pbar i{display:block;height:100%;background:var(--ok);border-radius:4px;transition:width .5s ease}
.pbar.big{height:10px;margin:4px 0 14px}
.reqs{display:grid;gap:6px}
.req{display:flex;gap:12px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--bg);transition:border-color .2s}
.req.done{border-left:3px solid var(--ok)}.req.building{border-left:3px solid var(--accent)}.req.planned{border-left:3px solid var(--line)}.req.dropped{opacity:.55}.req.dropped .rtext{text-decoration:line-through}
.rmark{font-size:16px;width:20px;text-align:center;color:var(--dim)}.req.done .rmark{color:var(--ok)}.req.building .rmark{color:var(--accent)}
.rmid{flex:1;min-width:0}.rhead{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.rid{font:700 12px var(--mono);color:var(--accent)}
.rstat{font:600 10px var(--mono);padding:1px 7px;border-radius:8px;background:var(--bg3);color:var(--dim)}
.rstat.done{background:rgba(143,207,111,.18);color:var(--ok)}.rstat.building{background:var(--accent-soft);color:var(--accent)}.rstat.dropped{color:var(--bad)}
.rtext{margin-top:3px}.rbar{display:flex;align-items:center;gap:8px;margin-top:6px}.rnum{font:11px var(--mono);color:var(--dim)}
.tag.frchip.done{color:var(--ok);border-color:var(--ok)}.tag.frchip.building{color:var(--accent);border-color:var(--accent)}
button.tag{background:none;cursor:pointer;font-family:var(--mono)}button.tag:hover{color:var(--accent);border-color:var(--accent)}
.tag.sim{border-style:dashed}.tag.changed{color:var(--warn);border-color:var(--warn)}
.rules{display:grid;gap:12px}
.rule{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--bg);animation:kss-in .25s ease-out}
.rulehead{display:flex;gap:10px;align-items:baseline}.rulehead .id{font:700 12px var(--mono);color:var(--accent)}.rulehead b{font-size:15px}
.rlinks{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0 10px}.rlinks .tag{margin-left:0}
.codelbl{display:block;margin:4px 0 6px}.empty.small{font-size:12.5px;margin:6px 0 0}
.dec.haschange{border-left-color:var(--warn)}
.hist{margin:10px 0 4px}.hitem{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--bg2);opacity:.75}
.hitem.now{opacity:1;border-color:var(--ok);box-shadow:inset 3px 0 0 var(--ok)}.hitem:not(.now) .htext{text-decoration:line-through;text-decoration-color:var(--dim)}
.hmeta{display:flex;gap:6px;align-items:center;margin-bottom:3px}.hmeta .tag{margin-left:0}.when{font:11px var(--mono);color:var(--dim)}
.hwhy{color:var(--dim);font-size:12.5px;margin-top:2px}.harrow{text-align:center;color:var(--dim);line-height:1.4}
.timeline.changes .tl{cursor:default}.timeline .h .tag{margin-left:0;margin-right:8px}.ctext{color:var(--text)!important}
.machine .fsm-events{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;border-top:1px solid var(--line)}
.evt{display:flex;flex-direction:column;align-items:flex-start;gap:1px;border:1px solid var(--accent);background:var(--accent-soft);color:var(--text);border-radius:10px;padding:6px 12px;cursor:pointer;font:inherit;font-size:12.5px;transition:transform .12s}
.evt:hover{transform:translateY(-1px)}.evt b{font-family:var(--mono)}.evt .to{color:var(--dim)}.evt .guard{color:var(--warn);font-size:11.5px}.evt .fr{font:10px var(--mono);color:var(--dim)}
.fsm-path{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 12px;border-top:1px dashed var(--line);font-size:12.5px}
.fsm-path .crumb{padding:2px 8px;border-radius:10px;background:var(--bg3)}.fsm-path .crumb.on{background:var(--accent);color:#1c1206;font-weight:600}
.fsm-path .ev{font:11px var(--mono);color:var(--dim)}.fsm-path .ev:before{content:'—';margin-right:4px}.fsm-path .ev:after{content:'→';margin-left:4px}
svg .st rect{stroke:var(--line);stroke-width:1.5;transition:fill .25s,stroke .25s}
svg .st.seen rect{stroke:var(--ok);fill:var(--bg2)}svg .st.on rect{stroke:var(--accent);stroke-width:3;fill:var(--accent-soft)}
svg .st.on{animation:kss-in .3s ease-out}
svg .init{fill:var(--text)}svg .initline{stroke:var(--text);stroke-width:1.6;fill:none}
svg .tr path{transition:stroke .25s}
.sim{border:1px solid var(--line);border-radius:12px;background:var(--bg);padding:14px}
.sim-h{font:600 11px var(--mono);color:var(--dim);text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px}
.sim-grid{display:grid;grid-template-columns:minmax(220px,1fr) 1.3fr;gap:16px}
@media (max-width:720px){.sim-grid{grid-template-columns:1fr}}
.sim-in{display:flex;flex-direction:column;gap:3px;margin-bottom:10px}.sim-lbl{font-size:12.5px;font-weight:600}
.sim-ctl{display:flex;align-items:center;gap:8px}.sim-ctl .unit,.sim-ctl .range{font:11px var(--mono);color:var(--dim)}
.sim input,.sim select{background:var(--bg2);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:6px 9px;font:inherit;min-width:0}
.sim-ctl input:not([type=checkbox]),.sim-ctl select{flex:1}
.sim input:focus,.sim select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.sim input[type=checkbox]{width:18px;height:18px;accent-color:var(--accent)}
.sim-result{border:1px solid var(--line);border-radius:10px;padding:12px;background:var(--bg2)}
.sim-fired{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px;font-size:12.5px}
.sim-fired.no{color:var(--warn)}.firedchip{background:var(--accent);color:#1c1206;border-radius:12px;padding:2px 10px;font-weight:600}
.sim-outs{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px}
.sim-out{border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:var(--bg2)}.sim-out.flash{animation:kss-flash .6s ease-out}
.sim-out .k{font-size:11.5px;color:var(--dim)}.sim-out .v{font:700 18px var(--mono);margin-top:2px;word-break:break-word}
.sim-derived{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.dv{font-size:12px;border:1px dashed var(--line);border-radius:8px;padding:2px 8px}.dv .k{color:var(--dim);margin-right:6px}
.sim-errors{color:var(--bad);font-size:12px;margin-top:6px}.sim-errors:empty{display:none}
.sim-rules{margin-top:16px}
.sim-rule{display:flex;gap:10px;border:1px solid var(--line);border-radius:9px;padding:7px 10px;margin-bottom:6px;transition:background .2s,border-color .2s,opacity .2s}
.sim-rule .mark{font-weight:700;width:18px;text-align:center}.sim-rule.false{opacity:.6}.sim-rule.false .mark{color:var(--dim)}
.sim-rule.true .mark{color:var(--ok)}.sim-rule.err .mark{color:var(--bad)}
.sim-rule.fired{border-color:var(--accent);background:var(--accent-soft);opacity:1}.sim-rule.fired .mark{color:var(--accent)}
.sim-rule .rb{flex:1;min-width:0}.sim-rule .rh{font-size:12.5px}.sim-rule .rh .tag{margin-left:6px}
.sim-rule .when{display:inline-block;margin:4px 0}.then{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:var(--dim)}.then .k{color:var(--text)}
.sim-scen,.sim-custom{margin-top:16px}
.scn{display:flex;gap:10px;align-items:center;border:1px solid var(--line);border-radius:9px;padding:7px 10px;margin-bottom:6px;background:var(--bg2)}
.verdict{width:22px;height:22px;flex:none;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:12px;background:var(--bg3);color:var(--dim)}
.verdict.ok{background:rgba(143,207,111,.2);color:var(--ok)}.verdict.bad{background:rgba(239,100,97,.2);color:var(--bad)}
.scn-main{flex:1;min-width:0}.scn-name{all:unset;cursor:pointer;font-weight:600}.scn-name:hover{color:var(--accent)}
.scn-meta{font:11.5px var(--mono);color:var(--dim);overflow-wrap:anywhere}.scn-meta .got{color:var(--bad)}.scn-note{font-size:12px;color:var(--dim)}
.scn-acts{display:flex;gap:4px;flex-wrap:wrap}.mini.acc{border-color:var(--accent);color:var(--accent)}
.sim-save{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}.sim-save input{flex:1;min-width:160px}
.sim-exp{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px}.sim-exp input{flex:1;min-width:140px}
`

function main() {
  const args = process.argv.slice(2)
  const dir = args.find((a, i) => !a.startsWith('--') && !['--check', '--phase'].includes(args[i - 1]))
  if (!dir) {
    console.error('usage: report.mjs <feature-dir> [--phase <phase>] [--check <phase>]')
    process.exit(2)
  }
  const flag = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null)
  const check = flag('--check')
  // --phase names the phase that just wrote its file: it is held to the succinct limits and its
  // code snippets are checked against the repository.
  const phase = flag('--phase') ?? check
  if (check) {
    const p = join(dir, DIR, `${check}.json`)
    let r
    try {
      r = JSON.parse(readFileSync(p, 'utf8'))
    } catch (e) {
      console.error(`report: ${p}: ${e.message}`)
      process.exit(1)
    }
    const root = repoRoot(dir)
    const errs = validate(r, check)
    if (!errs.length && root) errs.push(...checkSnippets(r, root))
    if (errs.length) {
      console.error(errs.map((e) => `report: ${e}`).join('\n'))
      process.exit(1)
    }
    console.log(`report: ${check}.json ok`)
    return
  }
  const b = build(dir, { phase })
  if (!b.ok) {
    console.error(b.errors.map((e) => `report: ${e}`).join('\n'))
    process.exit(1)
  }
  console.log(`report: ${b.out} (${b.phases} phase${b.phases === 1 ? '' : 's'}${b.feature ? ', feature' : ''})`)
}

/**
 * Validates everything and writes report/index.html. `phase` holds that phase's file to the
 * succinct limits and checks its code; `feature` is a living model not yet on disk (feature.mjs).
 * Nothing is written when anything is invalid.
 */
export function build(dir, { phase = null, feature = undefined, now } = {}) {
  const m = model(dir, now, phase, feature)
  if (m.errors.length) return { ok: false, errors: m.errors }
  mkdirSync(join(dir, DIR), { recursive: true })
  const out = join(dir, DIR, 'index.html')
  writeFileSync(out, html(m))
  return { ok: true, out, phases: m.reports.length, feature: !!m.living, model: m }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
