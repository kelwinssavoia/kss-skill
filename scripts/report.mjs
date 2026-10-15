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
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ORDER, TRACKS, readHeader } from './next.mjs'
import { aggregate } from './render-cost.mjs'

export const DIR = 'report'

const KINDS = ['business', 'layout', 'technical', 'scope', 'design', 'auto', 'review', 'execution', 'quality']
const STATUSES = ['decided', 'auto', 'accepted', 'overridden', 'reopened', 'deferred', 'open', 'rejected']

const CAP = { summary: 1500, line: 600, text: 1500 }

const isStr = (v) => typeof v === 'string' && v.trim().length > 0

/** Problems with one phase file, as lines; empty when it is valid. */
export function validate(r, phase) {
  const errs = []
  const where = (k) => `${phase}.json: ${k}`
  if (!r || typeof r !== 'object' || Array.isArray(r)) return [`${phase}.json: not a JSON object`]
  if (r.phase !== phase) errs.push(where(`"phase" must be "${phase}" (the file name)`))
  if (!ORDER.includes(phase)) errs.push(where(`unknown phase — one of ${ORDER.join(', ')}`))
  if (!isStr(r.lang)) errs.push(where('"lang" is required — the conversation_language, e.g. "pt-BR"'))
  if (!isStr(r.summary)) errs.push(where('"summary" is required'))
  else if (r.summary.length > CAP.summary) errs.push(where(`"summary" is over ${CAP.summary} characters — it is a summary`))
  const strings = (k, required = false) => {
    const v = r[k]
    if (v === undefined && !required) return
    if (!Array.isArray(v) || (required && !v.length) || !v.every(isStr)) errs.push(where(`"${k}" must be a${required ? ' non-empty' : 'n'} array of strings`))
    else if (v.some((s) => s.length > CAP.line)) errs.push(where(`an entry of "${k}" is over ${CAP.line} characters`))
  }
  strings('did', true)
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
        for (const k of ['decision', 'why']) if (typeof d[k] === 'string' && d[k].length > CAP.text) errs.push(where(`${at}.${k} is over ${CAP.text} characters`))
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
  if (r.artifacts !== undefined) {
    if (!Array.isArray(r.artifacts) || !r.artifacts.every((a) => a && isStr(a.path))) errs.push(where('"artifacts" must be [{ "path", "what" }]'))
  }
  return errs
}

/** Every `report/<phase>.json` of the feature: parsed, validated, in track order. */
export function readReports(dir) {
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
    const errs = validate(r, phase)
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
export function model(dir, now = new Date().toISOString()) {
  const header = readHeader(dir)
  const { reports, errors } = readReports(dir)
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
<script>${CLIENT}</script>
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
`

// The page script: builds everything with textContent from the embedded data — never innerHTML,
// since the data is model-written text about the repository.
const CLIENT = `
(function(){
var M=JSON.parse(document.getElementById('kss-data').textContent);
var T={
 en:{overview:'Overview',decisions:'All decisions',phase:'Phase',did:'What was done',dec:'Decisions',why:'Why',rejected:'Rejected',source:'Source',open:'Open items',risks:'Risks',artifacts:'Artifacts',highlights:'Highlights',next:'Next',state:'State',size:'Size',cost:'Cost',agents:'agents',turns:'turns',tokens:'tokens',min:'min',search:'Search decisions…',all:'All',none:'No decisions recorded in this phase.',notyet:'Not run yet.',gen:'Generated',phases:'phases',theme:'Theme',noreport:'No report yet — phases add theirs as they finish.',decision:'Decision'},
 pt:{overview:'Visão geral',decisions:'Todas as decisões',phase:'Fase',did:'O que foi feito',dec:'Decisões',why:'Por quê',rejected:'Descartado',source:'Fonte',open:'Pendências',risks:'Riscos',artifacts:'Artefatos',highlights:'Destaques',next:'Próximo',state:'Estado',size:'Tamanho',cost:'Custo',agents:'agentes',turns:'turnos',tokens:'tokens',min:'min',search:'Buscar decisões…',all:'Todas',none:'Nenhuma decisão registrada nesta fase.',notyet:'Ainda não executada.',gen:'Gerado em',phases:'fases',theme:'Tema',noreport:'Sem relatório ainda — cada fase adiciona o seu ao terminar.',decision:'Decisão'},
 es:{overview:'Resumen',decisions:'Todas las decisiones',phase:'Fase',did:'Qué se hizo',dec:'Decisiones',why:'Por qué',rejected:'Descartado',source:'Fuente',open:'Pendientes',risks:'Riesgos',artifacts:'Artefactos',highlights:'Destacados',next:'Siguiente',state:'Estado',size:'Tamaño',cost:'Costo',agents:'agentes',turns:'turnos',tokens:'tokens',min:'min',search:'Buscar decisiones…',all:'Todas',none:'No hay decisiones registradas en esta fase.',notyet:'Aún no ejecutada.',gen:'Generado',phases:'fases',theme:'Tema',noreport:'Aún no hay informe — cada fase añade el suyo al terminar.',decision:'Decisión'}
};
var L=T[String(M.lang||'en').slice(0,2).toLowerCase()]||T.en;
var byPhase={};M.reports.forEach(function(r){byPhase[r.phase]=r});
var app=document.getElementById('app');
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=String(text);return e}
function add(p){for(var i=1;i<arguments.length;i++){var c=arguments[i];if(c)p.appendChild(c)}return p}
function human(n){if(!n)return '0';if(n>=1e9)return (n/1e9).toFixed(2)+'B';if(n>=1e6)return (n/1e6).toFixed(2)+'M';if(n>=1e3)return (n/1e3).toFixed(1)+'k';return String(n)}
function costLine(c){if(!c)return null;var s=[c.agents+' '+L.agents,c.turns+' '+L.turns,human(c.tokens)+' '+L.tokens];if(c.minutes!=null)s.push(c.minutes+' '+L.min);if(c.harnesses&&c.harnesses.length)s.push(c.harnesses.join(' + '));return s.join(' · ')}
var state={view:'overview',phase:null,q:'',kind:null};
function readHash(){var h=decodeURIComponent(location.hash.slice(1));if(h.indexOf('phase-')===0&&byPhase[h.slice(6)]){state.view='phase';state.phase=h.slice(6)}else if(h==='decisions'){state.view='decisions'}else{state.view='overview'}}
function go(view,phase){var h=view==='phase'?'phase-'+phase:view;if(location.hash.slice(1)!==h)location.hash=h;else{readHash();render()}}
window.addEventListener('hashchange',function(){readHash();render()});
document.addEventListener('keydown',function(e){if(state.view!=='phase'||e.target.tagName==='INPUT')return;var done=M.phases.filter(function(p){return byPhase[p]});var i=done.indexOf(state.phase);if(e.key==='ArrowRight'&&i<done.length-1)go('phase',done[i+1]);if(e.key==='ArrowLeft'&&i>0)go('phase',done[i-1])});
function decision(d,phase){
 var box=el('div','dec');var b=el('button');b.type='button';
 add(b,el('span','id',d.id||'•'));
 var t=el('span','t');var head=el('b',null,d.title);if(d.status)head.appendChild(el('span','tag '+d.status,d.status));if(d.kind&&d.kind!==d.status)head.appendChild(el('span','tag',d.kind));if(phase)head.appendChild(el('span','tag',phase));
 add(t,head,el('span',null,d.decision));add(b,t,el('span','chev','›'));
 var body=el('div','body');
 if(d.why)add(body,add(el('p'),el('span','lbl',L.why),document.createTextNode(d.why)));
 if(d.rejected&&d.rejected.length){var p=add(el('p'),el('span','lbl',L.rejected));var ul=el('ul','did');d.rejected.forEach(function(x){ul.appendChild(el('li',null,x))});add(body,p,ul)}
 if(d.source)add(body,add(el('p'),el('span','lbl',L.source),el('code',null,d.source)));
 if(!body.childNodes.length)body.appendChild(el('p','empty','—'));
 b.addEventListener('click',function(){box.classList.toggle('open')});
 return add(box,b,body);
}
function header(){
 var h=el('header','top');add(h,el('h1',null,M.feature));
 if(M.size)h.appendChild(el('span','pill acc',L.size+' '+M.size));
 if(M.state)h.appendChild(el('span','pill',L.state+': '+M.state));
 h.appendChild(el('span','spacer'));
 if(M.next)add(h,el('span','pill',L.next+':'),el('code',null,M.next));
 var tb=el('button','theme',L.theme);tb.addEventListener('click',function(){var r=document.documentElement;var dark=r.dataset.theme?r.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;r.dataset.theme=dark?'light':'dark'});h.appendChild(tb);
 return h;
}
function track(){
 var t=el('div','track');
 M.phases.forEach(function(p,i){var has=!!byPhase[p];var s=el('button','step '+(has?'done':'todo')+(state.view==='phase'&&state.phase===p?' on':''));s.type='button';add(s,el('span','n',has?'✓':String(i+1)),document.createTextNode(p));if(has)s.addEventListener('click',function(){go('phase',p)});else s.title=L.notyet;t.appendChild(s)});
 return t;
}
function tabs(){
 var n=el('nav','tabs');
 [['overview',L.overview],['decisions',L.decisions]].forEach(function(x){var b=el('button',state.view===x[0]?'on':'',x[1]);b.addEventListener('click',function(){go(x[0])});n.appendChild(b)});
 if(state.view==='phase'){var b=el('button','on',L.phase+': '+state.phase);n.appendChild(b)}
 return n;
}
function overview(){
 var f=document.createDocumentFragment();
 if(!M.reports.length){f.appendChild(el('p','empty',L.noreport));return f}
 var tl=el('div','timeline');
 M.reports.forEach(function(r){var it=el('div','tl');var nd=(r.decisions||[]).length;add(it,el('div','h',r.phase+(nd?' · '+nd+' '+L.dec.toLowerCase():'')),el('p',null,r.summary));var c=costLine(M.cost[r.phase]);if(c)it.appendChild(el('p',null,L.cost+': '+c));it.addEventListener('click',function(){go('phase',r.phase)});tl.appendChild(it)});
 f.appendChild(tl);return f;
}
function phaseView(r){
 var c=el('div','card');add(c,el('h2',null,r.title||r.phase),el('p','summary',r.summary));
 var meta=el('div','meta');var cl=costLine(M.cost[r.phase]);if(cl)add(meta,add(el('span'),el('b',null,L.cost+' '),document.createTextNode(cl)));if(r.at)add(meta,el('span',null,new Date(r.at).toLocaleString(M.lang)));if(meta.childNodes.length)c.appendChild(meta);
 c.appendChild(el('h3',null,L.did));var ul=el('ul','did');r.did.forEach(function(x){ul.appendChild(el('li',null,x))});c.appendChild(ul);
 c.appendChild(el('h3',null,L.dec+' ('+(r.decisions||[]).length+')'));
 if(r.decisions&&r.decisions.length)r.decisions.forEach(function(d){c.appendChild(decision(d))});else c.appendChild(el('p','empty',L.none));
 if(r.highlights&&r.highlights.length){c.appendChild(el('h3',null,L.highlights));r.highlights.forEach(function(g,i){var d=el('details','hl');if(i===0)d.open=true;d.appendChild(el('summary',null,g.group+' ('+g.items.length+')'));var u=el('ul');g.items.forEach(function(it){var li=el('li');if(it.label)li.appendChild(el('span','lab',it.label));li.appendChild(document.createTextNode(it.text));u.appendChild(li)});d.appendChild(u);c.appendChild(d)})}
 if(r.open&&r.open.length){c.appendChild(el('h3',null,L.open));r.open.forEach(function(x){c.appendChild(el('div','warnbox',x))})}
 if(r.risks&&r.risks.length){c.appendChild(el('h3',null,L.risks));r.risks.forEach(function(x){c.appendChild(el('div','warnbox risk',x))})}
 if(r.artifacts&&r.artifacts.length){c.appendChild(el('h3',null,L.artifacts));var au=el('ul','did');r.artifacts.forEach(function(a){var li=el('li');li.appendChild(el('code',null,a.path));if(a.what)li.appendChild(document.createTextNode(' — '+a.what));au.appendChild(li)});c.appendChild(au)}
 return c;
}
function decisionsView(){
 var f=document.createDocumentFragment();var all=[];M.reports.forEach(function(r){(r.decisions||[]).forEach(function(d){all.push({d:d,p:r.phase})})});
 var bar=el('div','filters');var inp=el('input');inp.placeholder=L.search;inp.value=state.q;bar.appendChild(inp);
 var kinds=[];all.forEach(function(x){if(x.d.kind&&kinds.indexOf(x.d.kind)<0)kinds.push(x.d.kind)});
 var list=el('div');
 function chip(k,label){var b=el('button','chip'+(state.kind===k?' on':''),label);b.addEventListener('click',function(){state.kind=k;render()});return b}
 bar.appendChild(chip(null,L.all+' ('+all.length+')'));kinds.forEach(function(k){bar.appendChild(chip(k,k))});
 function fill(){list.textContent='';var q=state.q.toLowerCase();var shown=all.filter(function(x){if(state.kind&&x.d.kind!==state.kind)return false;if(!q)return true;return [x.d.id,x.d.title,x.d.decision,x.d.why,(x.d.rejected||[]).join(' ')].join(' ').toLowerCase().indexOf(q)>=0});if(!shown.length)list.appendChild(el('p','empty','—'));shown.forEach(function(x){list.appendChild(decision(x.d,x.p))})}
 inp.addEventListener('input',function(){state.q=inp.value;fill()});
 fill();add(f,bar,list);return f;
}
function render(){
 app.textContent='';var w=el('div','wrap');add(w,header(),track(),tabs());
 if(M.errors&&M.errors.length)w.appendChild(el('div','errors',M.errors.join('\\n')));
 if(state.view==='phase'&&byPhase[state.phase])w.appendChild(phaseView(byPhase[state.phase]));
 else if(state.view==='decisions')w.appendChild(decisionsView());
 else w.appendChild(overview());
 add(w,el('footer',null,'KSS · '+M.reports.length+'/'+M.phases.length+' '+L.phases+' · '+L.gen+' '+new Date(M.generatedAt).toLocaleString(M.lang)));
 app.appendChild(w);
}
readHash();render();
})();
`

function main() {
  const args = process.argv.slice(2)
  const dir = args.find((a) => !a.startsWith('--'))
  if (!dir) {
    console.error('usage: report.mjs <feature-dir> [--check <phase>]')
    process.exit(2)
  }
  const check = args.includes('--check') ? args[args.indexOf('--check') + 1] : null
  if (check) {
    const p = join(dir, DIR, `${check}.json`)
    let r
    try {
      r = JSON.parse(readFileSync(p, 'utf8'))
    } catch (e) {
      console.error(`report: ${p}: ${e.message}`)
      process.exit(1)
    }
    const errs = validate(r, check)
    if (errs.length) {
      console.error(errs.map((e) => `report: ${e}`).join('\n'))
      process.exit(1)
    }
    console.log(`report: ${check}.json ok`)
    return
  }
  const m = model(dir)
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
