#!/usr/bin/env node
// feature.mjs <feature-dir> --phase <phase> [--patch <file>]   (the patch on stdin otherwise)
//
// The living feature (DESIGN.md §25.1). report/<phase>.json is a snapshot of one phase;
// report/feature.json is the feature as it is now — product and technical — and every phase
// updates it with a patch through this script, the only writer. The phase sends what it changed
// (requirements, rules, decisions, state machines, simulators, the code that implements a rule)
// and one line saying so; the merge, the history of a changed decision, the change log, the
// checks and the page are computed here, so the model never rewrites what earlier phases wrote.
//
//   echo '{"change":"…","requirements":[…]}' | node .kss/scripts/feature.mjs specs/012-x --phase spec
//
// Patch semantics (references/feature.md):
//   - objects merge key by key; `null` deletes a key
//   - arrays whose items all carry an `id` are upserted by id (fields merge); `{ "id", "removed":
//     true }` drops a requirement (status "dropped") and removes anything else; a removal and a
//     re-add of the same id in one patch replaces the item whole
//   - any other array (actors, inScope, transitions…) is replaced
//   - a decision whose text changes keeps its previous text, phase and reason in `history`
//   - `change` (one line, required) is appended to `changes` with the time and the phase
// Then everything is validated — shapes, links between ids, expressions, every scenario against
// its `expect`, and each code block the patch touched against the repository — and the page is
// rebuilt. On any problem it prints `feature: <problem>`, exits 1, and leaves both files as they were.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ORDER, readHeader } from './next.mjs'
import { DIR, FEATURE_FILE, FCAP, build, checkSnippets, repoRoot, validateFeature } from './report.mjs'

const KEYS = ['lang', 'product', 'stories', 'requirements', 'rules', 'decisions', 'architecture', 'states', 'simulators', 'code']
// Written here, never by the model: accepted in a patch only to be ignored.
const COMPUTED = ['feature', 'updatedAt', 'updatedBy', 'changes', 'progress', 'tickets', 'ticketFlow']
// Items replaced whole when re-sent, never field-merged: a quoted snippet is one piece, and a
// stale `highlight` or `lines` from the previous quote would point at the wrong lines.
const WHOLE = new Set(['code', 'rules.code'])

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isStr = (v) => typeof v === 'string' && v.trim().length > 0
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)))
const keyed = (a) => a.length > 0 && a.every((x) => isObj(x) && isStr(x.id))

/**
 * The patch merged into the current model, pure. Returns `{ feature, removed, changed }` —
 * the ids removed or dropped and the decisions whose text changed — or `{ errors }`.
 */
export function mergeFeature(current, patch, phase, now = new Date().toISOString()) {
  const errors = []
  if (!isObj(patch)) return { errors: ['the patch must be a JSON object'] }
  if (!isStr(patch.change)) errors.push('"change" is required — one line: what this phase changed in the feature')
  else if (patch.change.length > 200) errors.push('"change" is over 200 characters — one line')
  for (const k of Object.keys(patch)) if (k !== 'change' && !KEYS.includes(k) && !COMPUTED.includes(k)) errors.push(`unknown key "${k}" — one of ${KEYS.join(', ')}`)
  if (!ORDER.includes(phase)) errors.push(`unknown phase "${phase}" — one of ${ORDER.join(', ')}`)
  if (errors.length) return { errors }

  const removed = []
  const changed = []
  const f = clone(current) ?? {}

  function upsert(cur, items, path) {
    const out = Array.isArray(cur) ? cur.slice() : []
    for (const raw of items) {
      const p = clone(raw)
      const i = out.findIndex((x) => x && x.id === p.id)
      if (p.removed === true) {
        if (path === 'requirements') {
          if (i >= 0) out[i] = { ...out[i], status: 'dropped' }
          else out.push({ ...p, removed: undefined, status: 'dropped' })
          removed.push(p.id)
        } else if (i >= 0) {
          out.splice(i, 1)
          if (!path.includes('.')) removed.push(p.id)
        }
        continue
      }
      delete p.removed
      if (path === 'decisions') {
        delete p.history
        const was = i >= 0 ? out[i] : null
        if (!was) {
          p.phase ??= phase
          p.at = now
        } else if (p.decision !== undefined && p.decision !== was.decision) {
          // The previous text, its phase and its reason go to history; the model never writes it.
          const h = { at: was.at ?? null, phase: was.phase, decision: was.decision }
          if (was.why) h.why = was.why
          p.history = [...(was.history ?? []), h]
          p.phase = phase
          p.at = now
          if (p.why === undefined) p.why = null
          changed.push(p.id)
        }
      }
      if (i < 0) out.push(strip(p))
      else out[i] = WHOLE.has(path) ? strip(p) : merge(out[i], p, path)
    }
    return out
  }
  function strip(v) {
    if (Array.isArray(v)) return v.map(strip)
    if (!isObj(v)) return v
    const o = {}
    for (const [k, x] of Object.entries(v)) if (x !== null && x !== undefined && k !== 'removed') o[k] = strip(x)
    return o
  }
  function merge(cur, p, path) {
    if (Array.isArray(p)) return keyed(p) && (cur === undefined || Array.isArray(cur)) ? upsert(cur, p, path) : strip(p)
    if (!isObj(p)) return p
    if (WHOLE.has(path)) return strip(p)
    const out = isObj(cur) ? { ...cur } : {}
    for (const [k, v] of Object.entries(p)) {
      if (v === null || v === undefined) delete out[k]
      else out[k] = merge(out[k], v, path ? `${path}.${k}` : k)
    }
    return out
  }

  for (const k of KEYS) if (patch[k] !== undefined) {
    if (patch[k] === null) delete f[k]
    else f[k] = merge(f[k], patch[k], k)
  }
  const entry = { at: now, phase, text: patch.change.trim() }
  if (removed.length) entry.removed = removed
  if (changed.length) entry.changed = changed
  f.changes = [...(f.changes ?? []), entry].slice(-FCAP.changes)
  f.updatedAt = now
  f.updatedBy = phase
  return { feature: f, removed, changed }
}

/** The code blocks this patch named — rules' `code` and `code` sections — as sections to check. */
function touchedCode(f, patch) {
  const out = []
  const sentRules = new Set((Array.isArray(patch.rules) ? patch.rules : []).filter((r) => isObj(r) && r.code).map((r) => r.id))
  for (const r of f.rules ?? []) if (sentRules.has(r.id) && isObj(r.code)) out.push({ label: `rules[${r.id}].code`, s: r.code })
  if (Array.isArray(patch.code)) {
    // Upserted by id: only the blocks sent now. Sent without ids, the list was replaced: all of it.
    const sent = keyed(patch.code) ? new Set(patch.code.map((c) => c.id)) : null
    ;(f.code ?? []).forEach((c, i) => {
      if (!sent || sent.has(c.id)) out.push({ label: `code[${c.id ?? i}]`, s: c })
    })
  }
  return out
}

/** Merge, validate, check the quoted code, rebuild the page, write the model. `{ ok, … }`. */
export function apply(dir, patch, phase, now = new Date().toISOString()) {
  phase = String(phase ?? '').replace(/^kss-/, '')
  const p = join(dir, DIR, FEATURE_FILE)
  let current = null
  if (existsSync(p)) {
    try {
      current = JSON.parse(readFileSync(p, 'utf8'))
    } catch (e) {
      return { ok: false, errors: [`${FEATURE_FILE} is not valid JSON — ${e.message}`] }
    }
  }
  current ??= { feature: readHeader(dir).feature ?? basename(resolve(dir)) }
  const m = mergeFeature(current, patch, phase, now)
  if (m.errors) return { ok: false, errors: m.errors }
  const f = m.feature
  const errs = validateFeature(f).map((e) => e.replace(/^feature\.json: /, ''))
  if (errs.length) return { ok: false, errors: errs }
  const root = repoRoot(dir)
  if (root) {
    for (const { label, s } of touchedCode(f, patch)) {
      s.type = 'code'
      errs.push(...checkSnippets({ phase: 'feature', sections: [s] }, root).map((e) => e.replace(/^feature\.json: sections\[0\]/, label)))
      delete s.type
    }
  }
  if (errs.length) return { ok: false, errors: errs }
  const b = build(dir, { feature: f, now })
  if (!b.ok) return { ok: false, errors: b.errors.map((e) => `report: ${e}`) }
  writeFileSync(p, JSON.stringify(f, null, 1) + '\n')
  return { ok: true, path: p, feature: f, removed: m.removed, changed: m.changed }
}

function main() {
  const args = process.argv.slice(2)
  const flag = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null)
  const dir = args.find((a, i) => !a.startsWith('--') && !['--phase', '--patch'].includes(args[i - 1]))
  const phase = flag('--phase')
  if (!dir || !phase) {
    console.error('usage: feature.mjs <feature-dir> --phase <phase> [--patch <file>]  (patch on stdin otherwise)')
    process.exit(2)
  }
  let patch
  try {
    const file = flag('--patch')
    patch = JSON.parse(readFileSync(file ?? 0, 'utf8'))
  } catch (e) {
    console.error(`feature: the patch is not valid JSON — ${e.message}`)
    process.exit(1)
  }
  const r = apply(dir, patch, phase)
  if (!r.ok) {
    console.error(r.errors.map((e) => `feature: ${e}`).join('\n'))
    process.exit(1)
  }
  const n = (k) => (r.feature[k] ?? []).length
  console.log(`feature: ${r.path} (${n('requirements')} requirements, ${n('rules')} rules, ${n('decisions')} decisions)`)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
