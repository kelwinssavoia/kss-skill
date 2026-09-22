#!/usr/bin/env node
// jev.mjs — the one place KSS talks to Jev (TypeSafe's System One classifier).
//
//   node .kss/scripts/jev.mjs config                    print the effective local config, key redacted
//   node .kss/scripts/jev.mjs check                     one tiny request; prints ok / the error
//   node .kss/scripts/jev.mjs decide  '<json>'          auto-assumption gate for one investigation decision
//   node .kss/scripts/jev.mjs tier    '<json>'          pick T1–T5 from execution uncertainty
//   node .kss/scripts/jev.mjs split   '<json>'          keep or split one drafted ticket
//   node .kss/scripts/jev.mjs classify '<json>'         a coordinator judgement (escalation class, report gate, size, review depth)
//   node .kss/scripts/jev.mjs ask     '<json>'          raw { state, questions } passthrough
//
// Every command reads `.kss/config.json` (committed: the policy) and then `.kss/config.local.json`
// (gitignored: the API key, when it is not in the environment). Both are looked up in the current
// directory first and in the main worktree second, because an ignored file does not exist in a
// worktree and a silent rubric fallback is worse than a missing answer.
// When Jev is off, or the feature the command belongs to is off, the command prints
// `{"enabled":false,...}` and exits 3, and the skill falls back to its own rubric. A network or
// API failure prints `{"error":...}` and exits 2 — also a fallback, never a stop. Exit 1 is a
// usage error. Exit 0 carries a JSON answer on stdout.
//
// Design (DESIGN.md §20): Jev answers *choice*, *score* and *noul* questions over a compact JSON
// state; it does not generate text. So KSS only hands it the forks that are already enumerated —
// which option, which tier, which class — and keeps the threshold per use, because "a confidence
// threshold is not one number" (docs.typesafe.ai/confidence). Nothing Jev says is written into a
// feature artifact as fact: the answer, its confidence and the gate result go to the artifact the
// phase already writes, and to `<feature>/jev-trace.jsonl` when tracing is on.

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const lib = await (async () => {
  try {
    return await import('./kss-lib.mjs')
  } catch {
    return await import('../hooks/kss-lib.mjs')
  }
})()
const { readJsonFile, readCurrent, featureDir, mainWorktreeRoot } = lib

export const REPO_CONFIG = '.kss/config.json'
export const LOCAL_CONFIG = '.kss/config.local.json'
export const DEFAULT_BASE_URL = 'https://api.typesafe.ai'
export const DEFAULT_MODEL = 'jev-latest'

/** Baseline both config files are merged over. Mirrors templates/config.local.json. */
export const DEFAULTS = {
  version: 1,
  models: {
    efforts: ['low', 'medium', 'high'],
    allowed: {},
    tiers: {},
    // Which reviewer a finished ticket gets, per review depth and harness (review.mjs).
    // Claude Code: `{model, effort}` or a `kss-reviewer*` agent name. Codex: `{model, reasoning_effort}`.
    review: {
      full: {
        'claude-code': { model: 'opus', effort: 'high' },
        codex: { model: 'gpt-6-astra', reasoning_effort: 'high' },
      },
      light: {
        'claude-code': { model: 'sonnet', effort: 'medium' },
        codex: { model: 'gpt-5.6-terra', reasoning_effort: 'medium' },
      },
    },
  },
  jev: {
    enabled: false,
    api_key: '',
    api_key_env: 'TYPESAFE_API_KEY',
    model: DEFAULT_MODEL,
    base_url: DEFAULT_BASE_URL,
    timeout_ms: 10000,
    trace: true,
    auto_assumptions: {
      enabled: true,
      confidence: 0.85,
      by_category: { technical: 0.85, layout: 0.9, business: 1.01 },
      max_options: 12,
    },
    tier_selection: {
      enabled: true,
      confidence: 0.7,
      on_low_confidence: 'rubric',
    },
    ticket_split: {
      enabled: true,
      confidence: 0.7,
      on_low_confidence: 'rubric',
    },
    reasoning: {
      enabled: false,
      confidence: 0.8,
      decisions: ['escalation_class', 'report_gate'],
      effort_when_delegated: {},
    },
  },
}

// ---------------------------------------------------------------- config

function isObj(x) {
  return x && typeof x === 'object' && !Array.isArray(x)
}

export function deepMerge(base, patch) {
  if (!isObj(patch)) return patch === undefined ? base : patch
  const out = isObj(base) ? { ...base } : {}
  for (const [k, v] of Object.entries(patch)) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v
  return out
}

/**
 * Effective config: DEFAULTS ← `.kss/config.json` ← `.kss/config.local.json`,
 * read from the current directory or, failing that, from the main worktree.
 *
 * `present` still reports only the local file, so an existing caller keeps its
 * meaning; `sources` is what actually got merged and `root` is where from.
 */
export function loadLocalConfig(cwd = process.cwd(), opts = {}) {
  const here = resolve(cwd)
  const roots = [here]
  // `opts.mainRoot` is the test seam: undefined means ask git, anything else is
  // taken as given (null included, for "there is no main worktree").
  const main = opts.mainRoot === undefined ? mainWorktreeRoot(here) : opts.mainRoot
  if (main && resolve(main) !== here) roots.push(resolve(main))

  // One root owns BOTH files. Layering a worktree's half-written policy over
  // the main checkout's key would be worse than either file alone.
  let root = here
  for (const r of roots) {
    if (existsSync(join(r, REPO_CONFIG)) || existsSync(join(r, LOCAL_CONFIG))) {
      root = r
      break
    }
  }

  // DEFAULTS ← the committed policy ← the machine's own file. The policy is
  // versioned so it reaches every worktree and every teammate; only the key
  // stays out of git, which is why losing the local file no longer loses the
  // configuration with it.
  let cfg = DEFAULTS
  const sources = []
  for (const name of [REPO_CONFIG, LOCAL_CONFIG]) {
    const p = join(root, name)
    const raw = readJsonFile(p, null)
    if (isObj(raw)) {
      cfg = deepMerge(cfg, raw)
      sources.push(p)
    }
  }

  const path = join(root, LOCAL_CONFIG)
  return { path, present: existsSync(path), cfg, sources, root }
}

/** The key, from the file or from the environment variable it names. Empty string when absent. */
export function resolveApiKey(cfg, env = process.env) {
  const direct = typeof cfg.jev.api_key === 'string' ? cfg.jev.api_key.trim() : ''
  if (direct) return direct
  const name = typeof cfg.jev.api_key_env === 'string' ? cfg.jev.api_key_env.trim() : ''
  const fromEnv = name && typeof env[name] === 'string' ? env[name].trim() : ''
  return fromEnv
}

export function redact(cfg) {
  const out = JSON.parse(JSON.stringify(cfg))
  if (out.jev && typeof out.jev.api_key === 'string' && out.jev.api_key) {
    const k = out.jev.api_key
    out.jev.api_key = k.length > 8 ? `${k.slice(0, 4)}…${k.slice(-4)}` : '…'
  }
  return out
}

// ---------------------------------------------------------------- gating

/**
 * Gate one choice answer against a threshold. Pure.
 * `verdict` is `auto` when the leading option clears the threshold, `open` otherwise.
 */
export function gate(answer, threshold) {
  const conf = typeof answer.confidence === 'number' ? answer.confidence : 0
  const probs = isObj(answer.probabilities) ? answer.probabilities : {}
  const ranked = Object.entries(probs)
    .sort((a, b) => b[1] - a[1])
    .map(([id, p]) => ({ id, p: Math.round(p * 1000) / 1000 }))
  const t = typeof threshold === 'number' && Number.isFinite(threshold) ? threshold : 1.01
  return {
    verdict: conf >= t ? 'auto' : 'open',
    choice: answer.choice,
    confidence: Math.round(conf * 1000) / 1000,
    threshold: t,
    ranked,
  }
}

/** Threshold for one auto-assumption question: per-category override, else the default. */
export function assumptionThreshold(cfg, category) {
  const aa = cfg.jev.auto_assumptions
  const byCat = isObj(aa.by_category) ? aa.by_category : {}
  const c = typeof category === 'string' ? category.toLowerCase() : ''
  if (typeof byCat[c] === 'number') return byCat[c]
  return typeof aa.confidence === 'number' ? aa.confidence : 1.01
}

// ---------------------------------------------------------------- request building

const TIER_CRITERIA = {
  T1: 'light — mechanical, local work with a known pattern; also pure integration such as rebase, merge, or cleanup',
  T2: 'standard — bounded multi-file implementation following explicit patterns; this is the normal default',
  T3: 'demanding — same-area reconciliation that is demanding but whose decisions are already made',
  T4: 'design — real technical judgement, unresolved design or data semantics, or meaningful cross-layer reconciliation',
  T5: 'critical — long-horizon end-to-end integration, difficult diagnosis, genuinely unresolved cross-service state or failure semantics, or escalation after a failed ticket',
}

export const CLASSIFY = {
  escalation_class: {
    instructions:
      'A reviewer rejected a finished ticket. Given the ticket goal, the executor report and the numbered findings, what kind of failure was it? ' +
      'Answer cosmetic when every finding is formatting or style and none of them changes behaviour, because that costs a tier step for nothing.',
    criteria: {
      cosmetic:
        'Formatting or style only: line width, blank lines, import order, quoting. No finding changes behaviour. Goes back to the same agent with its context kept, and the tier does not change.',
      execution: 'The design and the ticket were right; the code is wrong, incomplete or breaks a listed rule. Fixable in the same worktree one tier up with the findings pasted in.',
      reasoning: 'The ticket or the plan was misunderstood or is itself wrong: the approach, not the code, has to change.',
    },
  },
  report_gate: {
    instructions:
      'An executor returned its report. Does the report meet the gate: state is done, exactly two commits (test first, then implementation), files listed, tests written but not run, deviations either none or explained?',
    criteria: {
      pass: 'Every gate field is present and consistent with the ticket. Nothing is missing or contradictory.',
      fail: 'A field is missing, the commit order is wrong, tests were run, scope was widened, or a deviation is unexplained.',
    },
  },
  size: {
    instructions: 'Given a clarified brief, which KSS size does the feature deserve?',
    criteria: {
      S: 'one layer, one surface, no new data or contract',
      M: 'two layers, or one new endpoint, no new entity',
      L: 'a new entity, a contract change, a cross-service flow, or any data question that needs confirmation',
    },
  },
  review_depth: {
    instructions:
      'A ticket is finished and about to be reviewed. Does its diff need the strongest adversarial reviewer, or is a cheaper one enough? ' +
      'Answer full whenever the ticket touches a contract, a wire or proto message, authorization, tenant isolation, or money, however mechanical the change looks: ' +
      'those categories carry their safeguards independently of how carefully the code was written, and under-reviewing one of them is how a silent field drop or a cross-tenant read ships. ' +
      'Answer light only when the ticket stays inside one surface, follows an explicit existing pattern, and touches none of them.',
    criteria: {
      full: 'The default. Mandatory whenever the diff touches a contract, a wire or proto message, authorization, tenant isolation, or money.',
      light: 'One surface, an explicit existing pattern, and none of the domain-risk categories above. A cheaper reviewer reads it.',
    },
  },
}

/**
 * Ticket sizing, asked once per ticket at `/kss-tickets`.
 *
 * The rubric behind `split` is the fixed rule the phase falls back to when the
 * answer lands below the threshold, so both paths cut at the same place.
 */
export const SPLIT_CRITERIA = {
  keep: 'One unit of work. The write targets sit in one area, serve one concern, and an executor can hold the whole change at once.',
  split:
    'More than one unit of work: more than six write targets, more than one service concern, both a read path and a write path in the same ticket, or an estimate that leaves no room under the 80-turn budget after one rejection.',
}

function choice(instructions, criteria) {
  return { type: 'choice', instructions, criteria }
}

/** `decide` input → systemOne body + the threshold the answer will be gated with. */
export function buildDecide(input, cfg) {
  if (!isObj(input) || typeof input.question !== 'string' || !Array.isArray(input.options) || input.options.length < 2) {
    throw new Error('decide needs {question, options:[{id,label,description?}...] (>=2), category?, context?}')
  }
  const max = cfg.jev.auto_assumptions.max_options
  if (typeof max === 'number' && input.options.length > max) {
    throw new Error(`decide: ${input.options.length} options exceed max_options ${max}; cluster them first`)
  }
  const criteria = {}
  for (const o of input.options) {
    if (!isObj(o) || typeof o.id !== 'string' || !o.id) throw new Error('decide: every option needs a string id')
    criteria[o.id] = [o.label, o.description].filter((s) => typeof s === 'string' && s).join(' — ') || null
  }
  const state = {
    question: input.question,
    category: input.category ?? null,
    context: input.context ?? null,
    evidence: input.evidence ?? null,
  }
  const instructions =
    'You are settling one decision for a software change, from the evidence the codebase offers. ' +
    'Pick the option the repository already favours: an ADR, a glossary term, a single existing pattern, or one alternative that dominates comparable places. ' +
    'If the evidence is thin or the options are genuinely a matter of intent, spread the probability rather than committing.'
  return {
    body: { state, questions: { decision: choice(instructions, criteria) } },
    threshold: assumptionThreshold(cfg, input.category),
  }
}

/** `tier` input → systemOne body. */
export function buildTier(input, cfg) {
  if (!isObj(input) || typeof input.title !== 'string') {
    throw new Error('tier needs {title, goal?, layer?, files?, contracts?, execution_uncertainty?, domain_risk?, safeguards?}')
  }
  const state = {
    title: input.title,
    goal: input.goal ?? null,
    layer: input.layer ?? null,
    files: input.files ?? null,
    contracts_touched: input.contracts ?? null,
    execution_uncertainty: input.execution_uncertainty ?? input.design_left ?? null,
    domain_risk_categories: input.domain_risk ?? input.risk ?? null,
    safeguards: input.safeguards ?? null,
  }
  const instructions =
    'Choose a tier from execution effort and uncertainty only. The tiers are a ladder from T1 (light) to T5 (critical). ' +
    'Pick the lowest tier whose description fully covers the expected execution. Domain-risk categories such as migration, contract or wire changes, authorization, tenant isolation, and money do not raise a tier by themselves: they require safeguards, tests, review, and final gates independently. Escalate for unresolved execution state, not merely for a risk label.'
  return { body: { state, questions: { tier: choice(instructions, TIER_CRITERIA) } }, threshold: cfg.jev.tier_selection.confidence }
}

/** `split` input → systemOne body. One keep-or-split question over the ticket's shape. */
export function buildSplit(input, cfg) {
  if (!isObj(input) || typeof input.title !== 'string' || typeof input.write_targets !== 'number') {
    throw new Error(
      'split needs {title, write_targets, layer?, directories?, service_concerns?, est_turns?, crosses_read_and_write?, files?}'
    )
  }
  const state = {
    title: input.title,
    layer: input.layer ?? null,
    write_targets: input.write_targets,
    directories: input.directories ?? null,
    service_concerns: input.service_concerns ?? null,
    est_turns: input.est_turns ?? null,
    crosses_read_and_write: input.crosses_read_and_write ?? null,
    files: input.files ?? null,
  }
  const instructions =
    'A ticket has been drafted. Is it one unit of work, or should it be cut into two before anybody executes it? ' +
    'Judge the shape only: how many places it writes, how many concerns it serves, and whether one executor can hold all of it at once. ' +
    'An oversized ticket is the expensive failure here, because a subagent that outgrows its turn budget re-reads its whole context every turn and its cost grows with the square of the turns. ' +
    'Do not answer split merely because the work is risky or important: risk selects safeguards, not ticket boundaries.'
  return { body: { state, questions: { split: choice(instructions, SPLIT_CRITERIA) } }, threshold: cfg.jev.ticket_split.confidence }
}

/** `classify` input → systemOne body. */
export function buildClassify(input, cfg) {
  if (!isObj(input) || typeof input.kind !== 'string' || !CLASSIFY[input.kind]) {
    throw new Error(`classify needs {kind: ${Object.keys(CLASSIFY).join('|')}, state}`)
  }
  const allowed = Array.isArray(cfg.jev.reasoning.decisions) ? cfg.jev.reasoning.decisions : []
  if (!allowed.includes(input.kind)) {
    return { disabled: `reasoning.decisions does not include ${input.kind}` }
  }
  const q = CLASSIFY[input.kind]
  return { body: { state: input.state ?? null, questions: { [input.kind]: choice(q.instructions, q.criteria) } }, threshold: cfg.jev.reasoning.confidence }
}

// ---------------------------------------------------------------- transport

export async function systemOne(body, cfg, { apiKey, fetchImpl = fetch } = {}) {
  const url = `${String(cfg.jev.base_url || DEFAULT_BASE_URL).replace(/\/+$/, '')}/v1/systemone`
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), cfg.jev.timeout_ms || 10000)
  const started = performance.now()
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: cfg.jev.model || DEFAULT_MODEL, ...body }),
      signal: ctl.signal,
    })
    const text = await res.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      json = { raw: text }
    }
    const latencyMs = Math.round(performance.now() - started)
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`)
      err.status = res.status
      err.body = json
      err.latencyMs = latencyMs
      throw err
    }
    return { ...json, latencyMs }
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------- trace

export function tracePath(cwd) {
  const cur = readCurrent(cwd)
  const dir = featureDir(cwd, cur)
  return dir ? join(dir, 'jev-trace.jsonl') : null
}

function trace(cwd, cfg, record) {
  if (!cfg.jev.trace) return
  const path = tracePath(cwd)
  if (!path) return
  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n')
  } catch {
    /* tracing never fails a phase */
  }
}

// ---------------------------------------------------------------- CLI

function out(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n')
  process.exit(code)
}

function usage() {
  process.stderr.write(
    'usage: jev.mjs <config|check|decide|tier|split|classify|ask> [json] [--cwd <dir>]\n' +
      '  decide   {question, options:[{id,label,description?}], category?, context?, evidence?}\n' +
      '  tier     {title, goal?, layer?, files?, contracts?, execution_uncertainty?, domain_risk?, safeguards?}\n' +
      '  split    {title, write_targets, layer?, directories?, service_concerns?, est_turns?, crosses_read_and_write?}\n' +
      '  classify {kind: escalation_class|report_gate|size|review_depth, state}\n' +
      '  ask      {state, questions}\n',
  )
  process.exit(1)
}

function parseArgs(argv) {
  const i = argv.indexOf('--cwd')
  const cwd = i !== -1 && argv[i + 1] ? argv[i + 1] : process.cwd()
  const rest = i === -1 ? argv : argv.filter((a, k) => !(k === i || k === i + 1))
  return { cwd, cmd: rest[0], json: rest[1] }
}

const FEATURE_OF = { decide: 'auto_assumptions', tier: 'tier_selection', split: 'ticket_split', classify: 'reasoning' }

function featureFlag(cfg, cmd) {
  const key = FEATURE_OF[cmd]
  return key ? cfg.jev[key].enabled : true
}

async function main() {
  const { cwd, cmd, json } = parseArgs(process.argv.slice(2))
  if (!cmd) usage()

  const { path, present, cfg, sources, root } = loadLocalConfig(cwd)

  if (cmd === 'config') out({ path, present, sources, root, ...redact(cfg) })

  if (!['check', 'decide', 'tier', 'split', 'classify', 'ask'].includes(cmd)) usage()

  if (!cfg.jev.enabled) {
    out({ enabled: false, reason: sources.length ? 'jev.enabled is false' : `no ${REPO_CONFIG} or ${LOCAL_CONFIG} under ${root}` }, 3)
  }
  if (!featureFlag(cfg, cmd)) out({ enabled: false, reason: `jev.${FEATURE_OF[cmd]}.enabled is false` }, 3)

  const apiKey = resolveApiKey(cfg)
  if (!apiKey) out({ error: `no API key: set jev.api_key in ${LOCAL_CONFIG} or export ${cfg.jev.api_key_env}` }, 2)

  let input = null
  if (cmd !== 'check') {
    if (!json) usage()
    try {
      input = JSON.parse(json)
    } catch {
      out({ error: 'argument is not valid JSON' }, 1)
    }
  }

  let built
  try {
    if (cmd === 'check') built = { body: { state: 'ping', questions: { ok: { type: 'noul', instructions: 'Is the state the word ping?' } } }, threshold: 0 }
    else if (cmd === 'decide') built = buildDecide(input, cfg)
    else if (cmd === 'tier') built = buildTier(input, cfg)
    else if (cmd === 'split') built = buildSplit(input, cfg)
    else if (cmd === 'classify') built = buildClassify(input, cfg)
    else if (cmd === 'ask') {
      if (!isObj(input) || !isObj(input.questions)) throw new Error('ask needs {state, questions}')
      built = { body: { state: input.state ?? null, questions: input.questions }, threshold: null }
    }
  } catch (e) {
    out({ error: e.message }, 1)
  }
  if (built.disabled) out({ enabled: false, reason: built.disabled }, 3)

  let res
  try {
    res = await systemOne(built.body, cfg, { apiKey })
  } catch (e) {
    const rec = { cmd, error: e.message, status: e.status ?? null, body: e.body ?? null }
    trace(cwd, cfg, rec)
    out({ ...rec, fallback: 'use the phase rubric' }, 2)
  }

  if (cmd === 'check') out({ ok: true, model: res.model, latency_ms: res.latencyMs, usage: res.usage })

  if (cmd === 'ask') {
    trace(cwd, cfg, { cmd, state: built.body.state, answers: res.answers, latency_ms: res.latencyMs })
    out({ model: res.model, answers: res.answers, usage: res.usage, latency_ms: res.latencyMs })
  }

  const name = Object.keys(built.body.questions)[0]
  const answer = res.answers && res.answers[name]
  if (!answer || answer.type !== 'choice') out({ error: `unexpected answer shape for ${name}`, answers: res.answers }, 2)
  const g = gate(answer, built.threshold)
  const result = {
    cmd,
    question: name,
    ...g,
    model: res.model,
    latency_ms: res.latencyMs,
    usage: res.usage,
  }
  if (g.verdict === 'open' && FEATURE_OF[cmd] && cfg.jev[FEATURE_OF[cmd]].on_low_confidence) {
    result.fallback = cfg.jev[FEATURE_OF[cmd]].on_low_confidence
  }
  if (cmd === 'classify') result.kind = input.kind
  trace(cwd, cfg, { ...result, state: built.body.state })
  out(result)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((e) => out({ error: e && e.message ? e.message : String(e) }, 2))
}
