#!/usr/bin/env node
// report.mjs <feature-dir> [--check <phase>]
//
// The feature's explained report (DESIGN.md §25). Every phase ends by writing
// <feature-dir>/report/<phase>.json — what it did and each decision, in the conversation
// language (.kss/references/report.md) — and running this script, which validates every phase
// file and rebuilds <feature-dir>/report/index.html: one self-contained, interactive page with
// the track, each phase, every decision, and the cost of each phase from metrics.jsonl.
//
//   node .kss/scripts/report.mjs specs/012-x               validate all, write index.html
//   node .kss/scripts/report.mjs specs/012-x --check spec  validate report/spec.json only
//
// The model writes only content; the page, the ordering, the cost and the Next line are
// computed here, so every report looks the same and costs a few hundred tokens to produce.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ORDER, TRACKS, readHeader } from './next.mjs'
import { aggregate } from './render-cost.mjs'
import { client } from './report-client.mjs'

export const DIR = 'report'

const KINDS = ['business', 'layout', 'technical', 'scope', 'design', 'auto', 'review', 'execution', 'quality']
const STATUSES = ['decided', 'auto', 'accepted', 'overridden', 'reopened', 'deferred', 'open', 'rejected']

// Short by construction: a report illustrates, it does not narrate. Past these the script refuses
// the file, so the phase cuts words or turns them into a diagram, an example or a table.
export const CAP = { summary: 600, line: 200, did: 7, text: 700, decision: 400, explain: 320, note: 240, sections: 24, codeLines: 60, label: 80 }

/** The limits reports written before the succinct rule were held to: still accepted for them. */
export const LOOSE = { ...CAP, summary: 1500, line: 600, did: 50, decision: 1500 }

export const SECTION_TYPES = ['text', 'callout', 'code', 'diff', 'flow', 'sequence', 'example', 'table', 'files']

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
  }
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

/** Every `report/<phase>.json` of the feature: parsed, validated, in track order. */
export function readReports(dir, strict = null) {
  const rdir = join(dir, DIR)
  const out = []
  const errors = []
  let names = []
  try {
    names = readdirSync(rdir).filter((n) => n.endsWith('.json'))
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
    const next = (/^`([^`]+)`/.exec(line.trim())?.[1] ?? line.replace(/<!--.*$/, '')).trim() || null
    const branch = /^\*\*Branch:\*\*\s*(.+)$/m.exec(t)?.[1]?.trim() ?? null
    return { next, branch }
  } catch {
    return { next: null, branch: null }
  }
}

/** Everything the page shows, as one object. */
export function model(dir, now = new Date().toISOString(), strict = null) {
  const header = readHeader(dir)
  const { reports, errors } = readReports(dir, strict)
  const size = header.size
  const track = size && TRACKS[size] ? TRACKS[size] : ORDER
  const ran = new Set(reports.map((r) => r.phase))
  // The track, plus any optional phase that actually ran, in canonical order.
  const phases = ORDER.filter((p) => track.includes(p) || ran.has(p))
  const lang = [...reports].reverse().find((r) => isStr(r.lang))?.lang ?? 'en'
  return {
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
<script>(${client.toString()})()</script>
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
  const m = model(dir, undefined, phase)
  if (m.errors.length) {
    console.error(m.errors.map((e) => `report: ${e}`).join('\n'))
    process.exit(1)
  }
  mkdirSync(join(dir, DIR), { recursive: true })
  const out = join(dir, DIR, 'index.html')
  writeFileSync(out, html(m))
  console.log(`report: ${out} (${m.reports.length} phase${m.reports.length === 1 ? '' : 's'})`)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
