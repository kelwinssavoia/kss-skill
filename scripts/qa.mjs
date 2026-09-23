#!/usr/bin/env node
// qa.mjs — kss-qa: a blind, browser-driven acceptance test of one feature (DESIGN.md §22).
//
//   node .kss/scripts/qa.mjs plan   [--feature <NNN-slug>] [--force]   blind planner → <feature>/qa/ plan + seed
//   node .kss/scripts/qa.mjs up     [--feature …]                      infra, migrations, Keycloak users, seed, services
//   node .kss/scripts/qa.mjs run    [--feature …] [--only S-01,S-02]   blind browser driver, one scenario at a time
//   node .kss/scripts/qa.mjs judge  [--feature …] [--run <id>]         Jev verdict per scenario (jev.mjs judge)
//   node .kss/scripts/qa.mjs report [--feature …] [--run <id>]         report.md + result.json, verdict
//   node .kss/scripts/qa.mjs down                                      stop services and browsers, compose down
//   node .kss/scripts/qa.mjs all    [--feature …] [--replan] [--keep-up] [--only …]
//   node .kss/scripts/qa.mjs status                                    what is up, and whether it answers
//
// "Blind" is the point. Neither model sees the code, the diff, the plan or the tickets: the planner
// gets the request, the functional sections of the spec, the database schemas and the environment
// catalog; the driver gets one scenario and a browser. Both run as `claude -p` in an empty temp
// directory with no setting sources, so no CLAUDE.md, memory, hook or plugin reaches them.
//
// Project specifics — compose files, databases (engine-agnostic: readiness, migrate and seed are
// commands, psql is only the default), the auth provider (built-in Keycloak, or a command that
// receives the personas), env, service catalog, apps — live in `.kss/qa.config.json` (committed).
// Runtime state lives in `.kss/qa/.runtime/` (gitignored).
// Exit codes: 0 ok / approved, 1 usage or setup error, 4 rejected, 5 inconclusive.

import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, copyFileSync,
  openSync, appendFileSync, rmSync, statSync,
} from 'node:fs'
import { join, dirname, resolve, relative, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer, connect } from 'node:net'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const lib = await (async () => {
  try {
    return await import('./kss-lib.mjs')
  } catch {
    return await import('../hooks/kss-lib.mjs')
  }
})()
const { readJsonFile, writeJsonFile, readCurrent, readConfig } = lib
const jev = await import('./jev.mjs')

export const QA_CONFIG = '.kss/qa.config.json'
export const RUNTIME = '.kss/qa/.runtime'

export const DEFAULTS = {
  version: 1,
  spec: {
    request: ['00-brief.md'],
    spec: '03-spec.md',
    request_fallback_sections: ['Problem'],
    sections: ['Problem', 'Solution', 'User stories', 'Decisions', 'Functional requirements', 'Layout', 'Out of scope'],
  },
  models: { planner: 'sonnet', driver: 'haiku' },
  limits: { planner_turns: 80, planner_timeout_s: 1500, driver_turns: 60, driver_timeout_s: 900, seed_repairs: 2, max_budget_usd: null },
  ready_timeout_s: 600,
  compose: { files: ['docker-compose.yaml'], project: 'kss-qa', services: [], down_volumes: true },
  databases: {},
  auth: null,
  env: { files: ['.env'], overrides: {} },
  prepare: [],
  services: {},
  apps: {},
  environment_notes: '',
  browser: { chrome: '', headless: true, width: 1440, height: 900 },
}

// ---------------------------------------------------------------- pure helpers

function isObj(x) {
  return x && typeof x === 'object' && !Array.isArray(x)
}

export function loadQaConfig(cwd) {
  const path = resolve(cwd, QA_CONFIG)
  const raw = readJsonFile(path, null)
  return { path, present: isObj(raw), cfg: jev.deepMerge(DEFAULTS, isObj(raw) ? raw : {}) }
}

/** `## Heading` sections of a markdown document whose heading starts with one of `names`. */
export function extractSections(md, names) {
  const want = names.map((n) => n.toLowerCase())
  const out = []
  let keep = false
  for (const line of String(md).split('\n')) {
    const h = /^##\s+(.*)$/.exec(line)
    if (h) keep = want.some((w) => h[1].trim().toLowerCase().startsWith(w))
    else if (/^#\s/.test(line)) {
      out.push(line, '')
      keep = false
      continue
    }
    if (keep) out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/** `{ 'FR-01': 'Given …' }` from the bullets of a spec (`- **FR-01** text` continued on indented lines). */
export function requirementMap(md) {
  const map = {}
  let cur = null
  for (const line of String(md).split('\n')) {
    const m = /^\s*[-*]\s+\*\*((?:FR|NFR|US)-\d+[a-z]?)\*\*\s*(.*)$/.exec(line)
    if (m) {
      cur = m[1]
      map[cur] = m[2].trim()
    } else if (cur && /^\s{2,}\S/.test(line)) map[cur] += ' ' + line.trim()
    else cur = null
  }
  return map
}

export function parseDotenv(text) {
  const out = {}
  for (const raw of String(text).split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    else v = v.replace(/\s+#.*$/, '')
    out[m[1]] = v
  }
  return out
}

/** process env ← env files ← overrides. Process env wins over Nx's own dotenv loading downstream. */
export function buildServiceEnv(cwd, cfg, base = process.env) {
  const env = { ...base }
  for (const f of cfg.env.files || []) {
    const p = resolve(cwd, f)
    if (existsSync(p)) Object.assign(env, parseDotenv(readFileSync(p, 'utf8')))
  }
  for (const [k, v] of Object.entries(cfg.env.overrides || {})) env[k] = String(v)
  return env
}

/** Dependency closure of `names` in the catalog, as start levels (deps first). Throws on unknown or cycle. */
export function serviceLevels(catalog, names) {
  const depth = {}
  const visiting = new Set()
  const visit = (n) => {
    if (!catalog[n]) throw new Error(`unknown service "${n}" (not in ${QA_CONFIG} services)`)
    if (depth[n] !== undefined) return depth[n]
    if (visiting.has(n)) throw new Error(`service dependency cycle at "${n}"`)
    visiting.add(n)
    const req = catalog[n].requires || []
    depth[n] = req.length ? 1 + Math.max(...req.map(visit)) : 0
    visiting.delete(n)
    return depth[n]
  }
  names.forEach(visit)
  const levels = []
  for (const [n, d] of Object.entries(depth)) (levels[d] ||= []).push(n)
  return levels.map((l) => l.sort())
}

/**
 * The auth block, normalised. `{provider: 'keycloak', url, admin, adminPassword, realm, …}` or
 * `{provider: 'command', command, roles?, description?}`. A legacy top-level `keycloak` block is
 * read as the keycloak provider. Null when the project creates no users.
 */
export function authConfig(cfg) {
  const a = isObj(cfg.auth) ? cfg.auth : isObj(cfg.keycloak) ? { provider: 'keycloak', ...cfg.keycloak } : null
  if (!a) return null
  if (!['keycloak', 'command'].includes(a.provider)) throw new Error(`auth.provider must be keycloak or command, got ${a.provider}`)
  if (a.provider === 'command' && !a.command) throw new Error('auth.provider command needs auth.command')
  return a
}

/** A persona's roles: `roles`, or the older `realmRoles`. */
export const personaRoles = (p) => (Array.isArray(p.roles) ? p.roles : Array.isArray(p.realmRoles) ? p.realmRoles : [])

/** Default database commands. Each runs through `sh -c` with KSS_QA_DB_URL / KSS_QA_SEED_FILE set. */
export const DB_DEFAULTS = {
  ready: 'psql "$KSS_QA_DB_URL" -tAc "select 1"',
  seed: 'psql "$KSS_QA_DB_URL" -v ON_ERROR_STOP=1 -1 -q -f "$KSS_QA_SEED_FILE"',
  seed_format: 'PostgreSQL SQL, one transaction',
  seed_ext: '.sql',
}

export function dbCommand(db, kind) {
  return db[kind] || DB_DEFAULTS[kind]
}

/** Name the planner sees a database schema under: `schema/<db><original extension>`. */
export function schemaName(db, name) {
  const m = /(\.[A-Za-z0-9]+)$/.exec(basename(db.schema || ''))
  return `schema/${name}${m ? m[1] : ''}`
}

/** Problems with a planner's plan.json, as strings. Empty = valid. */
export function validatePlan(plan, cfg, frIds = []) {
  const errs = []
  if (!isObj(plan)) return ['plan.json is not an object']
  const personas = Array.isArray(plan.personas) ? plan.personas : []
  const scenarios = Array.isArray(plan.scenarios) ? plan.scenarios : []
  if (!scenarios.length) errs.push('no scenarios')
  for (const s of plan.services || []) if (!cfg.services[s]) errs.push(`service "${s}" is not in the catalog`)
  const keys = new Set()
  for (const p of personas) {
    if (!p.key || !p.username || !p.password) errs.push(`persona ${p.key || '?'} needs key, username and password`)
    keys.add(p.key)
  }
  const ids = new Set()
  for (const s of scenarios) {
    if (!/^S-\d+$/.test(s.id || '')) errs.push(`scenario id "${s.id}" must look like S-01`)
    if (ids.has(s.id)) errs.push(`duplicate scenario ${s.id}`)
    ids.add(s.id)
    if (!keys.has(s.persona)) errs.push(`${s.id}: persona "${s.persona}" is not defined`)
    if (!cfg.apps[s.app]) errs.push(`${s.id}: app "${s.app}" is not in the catalog`)
    if (!Array.isArray(s.expected) || !s.expected.length) errs.push(`${s.id}: no expected outcomes`)
    if (!Array.isArray(s.steps) || !s.steps.length) errs.push(`${s.id}: no steps`)
  }
  for (const [db, file] of Object.entries(plan.seed || {})) {
    if (!cfg.databases[db]) errs.push(`seed for unknown database "${db}"`)
    if (typeof file !== 'string' || !file.startsWith('seed/')) errs.push(`seed path for ${db} must be under seed/`)
  }
  const covered = new Set([
    ...scenarios.flatMap((s) => s.covers || []),
    ...(plan.not_covered || []).map((n) => n.fr),
  ])
  for (const fr of frIds) if (fr.startsWith('FR-') && !covered.has(fr)) errs.push(`${fr} is neither covered nor listed in not_covered`)
  return errs
}

export function fill(template, vars) {
  return String(template).replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => (vars[k] ?? ''))
}

const bullets = (xs) => (xs || []).map((x) => `- ${x}`).join('\n')
const numbered = (xs) => (xs || []).map((x, i) => `${i + 1}. ${x}`).join('\n')

export function buildDriverPrompt(template, { scenario, persona, app, requirements }) {
  const start = new URL(scenario.path || '/', app.url).toString()
  return fill(template, {
    SCENARIO_ID: scenario.id,
    SCENARIO_TITLE: scenario.title,
    REQUIREMENTS: (scenario.covers || []).map((fr) => `- **${fr}** ${requirements[fr] || ''}`.trim()).join('\n') || '- (none named)',
    APP_URL: app.url,
    START_URL: start,
    USERNAME: persona.username,
    PASSWORD: persona.password,
    PERSONA_NOTES: persona.notes || persona.key,
    STEPS: numbered(scenario.steps),
    EXPECTED: (scenario.expected || []).map((x, i) => `- **E${i + 1}** ${x}`).join('\n'),
  })
}

/** Final status of one scenario from the driver's own verdict and Jev's gated answer (or null). */
export function combine(driverStatus, judged) {
  const driver = ['pass', 'fail', 'blocked'].includes(driverStatus) ? driverStatus : 'blocked'
  if (!judged) return { final: driver, note: 'not judged by Jev — driver verdict stands' }
  if (judged.verdict !== 'auto') return { final: 'inconclusive', note: `Jev below threshold (${judged.confidence} < ${judged.threshold}), leaning ${judged.choice}` }
  if (judged.choice !== driver) return { final: 'inconclusive', note: `driver says ${driver}, Jev says ${judged.choice} (${judged.confidence})` }
  return { final: driver, note: `driver and Jev agree (${judged.confidence})` }
}

export function overallVerdict(finals) {
  if (!finals.length) return 'INCONCLUSIVE'
  if (finals.some((f) => f === 'fail')) return 'REJECTED'
  if (finals.every((f) => f === 'pass')) return 'APPROVED'
  return 'INCONCLUSIVE'
}

const ICON = { pass: '✅ pass', fail: '❌ fail', blocked: '⛔ blocked', inconclusive: '❔ inconclusive', info: 'ℹ️ info' }
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ')

export function renderReport(d) {
  const L = []
  const verdictIcon = { APPROVED: '✅', REJECTED: '❌', INCONCLUSIVE: '❔' }[d.verdict]
  L.push(`# QA report · ${d.feature}`, '')
  L.push(`**Verdict:** ${verdictIcon} **${d.verdict}** · **Run:** \`${d.runId}\` · **Commit:** \`${d.head}\`${d.dirty ? ' (dirty tree)' : ''} · **Branch:** \`${d.branch}\``)
  L.push(`**Driver:** ${d.models.driver} · **Planner:** ${d.models.planner} · **Judge:** ${d.judge} · **Cost:** $${d.cost.toFixed(2)} · **Date:** ${d.date}`, '')
  L.push('Blind acceptance test: the planner and the browser driver saw only the request, the functional spec, the database schemas and the environment catalog — never the code or the diff.', '')

  L.push('## Scenarios', '', '| Scenario | Covers | Driver | Jev | Final |', '| --- | --- | --- | --- | --- |')
  for (const s of d.scenarios) {
    const j = s.jev ? `${s.jev.choice} (${s.jev.confidence})` : '—'
    L.push(`| [${s.id}](#${s.id.toLowerCase()}) ${cell(s.title)} | ${(s.covers || []).join(', ')} | ${s.driver} | ${j} | ${ICON[s.final]} |`)
  }
  L.push('')

  L.push('## Requirement coverage', '', '| Requirement | Scenarios | Result |', '| --- | --- | --- |')
  for (const r of d.coverage) L.push(`| ${r.fr} | ${r.scenarios.join(', ') || '—'} | ${r.result} |`)
  L.push('')

  const confirmed = d.scenarios.filter((s) => s.final === 'pass')
  L.push('## Confirmed flows', '')
  L.push(confirmed.length ? confirmed.map((s) => `- **${s.id}** ${s.title} — ${s.summary || ''}`).join('\n') : '_None._', '')

  const problems = d.scenarios.filter((s) => s.final !== 'pass')
  L.push('## Problems', '')
  if (!problems.length) L.push('_None._', '')
  for (const s of problems) {
    L.push(`### ${s.id} · ${s.title} — ${ICON[s.final]}`, '', `${s.note}.`, '')
    if (s.summary) L.push(`> ${s.summary}`, '')
    for (const st of s.steps.filter((x) => x.status === 'fail' || x.status === 'blocked')) {
      L.push(`- **Step ${st.i} · ${st.title}** (${st.status}) — expected: ${st.expected}; observed: ${st.observed}${st.screenshot ? ` · [screenshot](runs/${d.runId}/${s.id}/${st.screenshot})` : ''}`)
    }
    for (const iss of s.issues.filter((i) => i.kind !== 'adjustment')) L.push(`- **${iss.kind}:** ${iss.title} — ${iss.detail || ''}`)
    L.push('')
  }

  const adjustments = d.scenarios.flatMap((s) => s.issues.filter((i) => i.kind === 'adjustment').map((i) => ({ ...i, id: s.id })))
  L.push('## Adjustments', '')
  L.push(adjustments.length ? adjustments.map((a) => `- **${a.id}** ${a.title} — ${a.detail || ''}`).join('\n') : '_None._', '')

  L.push('## Not covered by the UI test', '')
  L.push(d.notCovered.length ? d.notCovered.map((n) => `- **${n.fr}** — ${n.reason}`).join('\n') : '_Every requirement has a scenario._', '')

  if (d.assumptions.length) L.push('## Planner assumptions to confirm', '', bullets(d.assumptions), '')

  L.push('## Evidence', '')
  for (const s of d.scenarios) {
    L.push(`### ${s.id}`, '', `**${s.title}** · persona \`${s.persona}\` · start \`${s.path || '/'}\` · ${s.turns ?? '?'} turns · $${(s.cost || 0).toFixed(2)}`, '')
    L.push('| # | Step | Expected | Observed | Status | Screenshot |', '| --- | --- | --- | --- | --- | --- |')
    for (const st of s.steps) {
      L.push(`| ${st.i} | ${cell(st.title)} | ${cell(st.expected)} | ${cell(st.observed)} | ${ICON[st.status] || st.status} | ${st.screenshot ? `[img](runs/${d.runId}/${s.id}/${st.screenshot})` : '—'} |`)
    }
    if (!s.steps.length) L.push('| — | no step was recorded | | | | |')
    L.push('')
  }

  L.push('## Environment', '')
  L.push(`- Services: ${d.services.join(', ') || '—'}`)
  L.push(`- Seed: ${d.seed.join(', ') || '—'}`)
  L.push(`- Personas: ${d.personas.map((p) => `\`${p.username}\` (${p.key})`).join(', ') || '—'}`)
  L.push(`- Service logs (tails): \`runs/${d.runId}/logs/\``)
  L.push('')
  return L.join('\n')
}

// ---------------------------------------------------------------- process helpers

function log(msg) {
  process.stderr.write(`[kss-qa] ${msg}\n`)
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
  return { code: r.status ?? 1, out: r.stdout || '', err: r.stderr || (r.error ? String(r.error) : '') }
}

function must(r, what) {
  if (r.code !== 0) throw new Error(`${what} failed (${r.code}): ${(r.err || r.out).trim().slice(-2000)}`)
  return r
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function tcpOpen(port, host = '127.0.0.1') {
  return new Promise((res) => {
    const s = connect({ port, host })
    s.setTimeout(1000)
    s.once('connect', () => (s.destroy(), res(true)))
    s.once('error', () => res(false))
    s.once('timeout', () => (s.destroy(), res(false)))
  })
}

function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer()
    srv.once('error', rej)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => res(port))
    })
  })
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function killTree(pid) {
  if (!pid || !alive(pid)) return
  for (const sig of ['SIGTERM', 'SIGKILL']) {
    try {
      process.kill(-pid, sig)
    } catch {
      try {
        process.kill(pid, sig)
      } catch {
        /* gone */
      }
    }
    for (let i = 0; i < 20 && alive(pid); i++) await sleep(250)
    if (!alive(pid)) return
  }
}

function tail(path, lines = 200) {
  try {
    const t = readFileSync(path, 'utf8').split('\n')
    return t.slice(-lines).join('\n')
  } catch {
    return ''
  }
}

async function ready(check, { logPath, pid } = {}) {
  if (check.tcp) return tcpOpen(Number(check.tcp))
  if (check.http) {
    try {
      const r = await fetch(check.http, { signal: AbortSignal.timeout(5000), redirect: 'manual' })
      return r.status < 500
    } catch {
      return false
    }
  }
  if (check.log) return new RegExp(check.log).test(tail(logPath, 2000))
  return pid ? alive(pid) : true
}

async function waitFor(label, fn, timeoutS, { pid, logPath, fail } = {}) {
  const until = Date.now() + timeoutS * 1000
  while (Date.now() < until) {
    if (await fn()) return
    if (pid && !alive(pid)) throw new Error(`${label} exited before it was ready:\n${tail(logPath, 40)}`)
    if (fail && logPath && new RegExp(fail).test(tail(logPath, 400))) throw new Error(`${label} failed to start (log matched "${fail}"):\n${tail(logPath, 40)}`)
    await sleep(2000)
  }
  throw new Error(`${label} not ready after ${timeoutS}s${logPath ? `:\n${tail(logPath, 40)}` : ''}`)
}

/** One headless `claude -p` run in an isolated cwd. Returns the parsed JSON result. */
function runClaude({ cwd, model, prompt, system, allowed, disallowed, maxTurns, timeoutS, budget, env }) {
  const args = [
    '-p', '--model', model, '--output-format', 'json', '--setting-sources', '', '--strict-mcp-config',
    '--no-session-persistence', '--max-turns', String(maxTurns), '--allowedTools', allowed.join(','),
    '--disallowedTools', disallowed.join(','),
  ]
  if (system) args.push('--append-system-prompt', system)
  if (budget) args.push('--max-budget-usd', String(budget))
  return new Promise((res) => {
    const child = spawn('claude', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutS * 1000)
    child.stdout.on('data', (b) => (out += b))
    child.stderr.on('data', (b) => (err += b))
    child.on('close', (code) => {
      clearTimeout(timer)
      let json = null
      try {
        json = JSON.parse(out)
      } catch {
        /* keep raw */
      }
      res({ code, json, raw: out.slice(-4000), err: err.slice(-4000) })
    })
    child.stdin.end(prompt)
  })
}

function templatePath(cwd, name) {
  for (const p of [resolve(cwd, '.kss/templates/qa', name), resolve(HERE, '../templates/qa', name)]) if (existsSync(p)) return p
  throw new Error(`template qa/${name} not found in .kss/templates/qa or the plugin`)
}

function chromePath(cfg) {
  if (cfg.browser.chrome) return cfg.browser.chrome
  for (const p of [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ]) if (existsSync(p)) return p
  for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const r = sh('sh', ['-c', `command -v ${bin}`])
    if (r.code === 0 && r.out.trim()) return r.out.trim()
  }
  throw new Error('Chrome/Chromium not found: set browser.chrome in ' + QA_CONFIG)
}

// ---------------------------------------------------------------- feature and paths

function featureOf(cwd, arg) {
  const name = arg || (readCurrent(cwd) || {}).feature
  if (!name) throw new Error('no feature: pass --feature <NNN-slug> or start one with kss')
  const root = readConfig(cwd).features_root || 'docs/features'
  const dir = resolve(cwd, root, name)
  if (!existsSync(dir)) throw new Error(`feature folder ${relative(cwd, dir)} does not exist`)
  return { name, dir, qa: join(dir, 'qa') }
}

function git(cwd, ...args) {
  return sh('git', args, { cwd }).out.trim()
}

function latestRun(qaDir) {
  const d = join(qaDir, 'runs')
  if (!existsSync(d)) return null
  const runs = readdirSync(d).filter((x) => existsSync(join(d, x, 'run.json'))).sort()
  return runs.at(-1) || null
}

function statePath(cwd) {
  return resolve(cwd, RUNTIME, 'state.json')
}

function compose(cwd, cfg, ...args) {
  const files = cfg.compose.files.flatMap((f) => ['-f', resolve(cwd, f)])
  return sh('docker', ['compose', '-p', cfg.compose.project, ...files, ...args], { cwd })
}

// ---------------------------------------------------------------- plan

function environmentDoc(cfg) {
  const L = ['# Test environment', '']
  L.push('## Web apps', '')
  for (const [n, a] of Object.entries(cfg.apps)) L.push(`- **${n}** — ${a.url} — ${a.description || ''} (served by service \`${a.service}\`)`)
  L.push('', '## Services you may start', '', 'Dependencies are started automatically.', '')
  for (const [n, s] of Object.entries(cfg.services)) L.push(`- **${n}** — ${s.description || ''}${(s.requires || []).length ? ` · requires: ${s.requires.join(', ')}` : ''}`)
  L.push('', '## Databases', '', 'Each starts empty with every migration applied.', '')
  for (const [n, d] of Object.entries(cfg.databases)) {
    const fmt = d.seed_format || DB_DEFAULTS.seed_format
    const ext = d.seed_ext || DB_DEFAULTS.seed_ext
    L.push(`- **${n}** — ${d.description || ''}${d.schema ? ` · schema: \`${schemaName(d, n)}\`` : ''} · seed: \`seed/${n}${ext}\` (${fmt})`)
  }
  const auth = authConfig(cfg)
  if (auth) {
    const how = auth.provider === 'keycloak'
      ? `Users are created in the identity provider (Keycloak realm \`${auth.realm}\`) from your personas: username, password, roles, attributes.`
      : auth.description || 'Users are created from your personas (username, password, roles, attributes) by the project\'s own setup command.'
    L.push('', '## Login', '', how)
    if ((auth.roles || []).length) L.push(`Roles available: ${auth.roles.map((r) => `\`${r}\``).join(', ')}.`)
  } else L.push('', '## Login', '', 'The project creates no users for you: personas must already work with what the seed inserts.')
  if (cfg.environment_notes) L.push('', '## Project rules: how users, data and access connect', '', cfg.environment_notes)
  return L.join('\n') + '\n'
}

async function cmdPlan(cwd, opts) {
  const { cfg, present } = loadQaConfig(cwd)
  if (!present) throw new Error(`${QA_CONFIG} not found — the project adapter is required`)
  const f = featureOf(cwd, opts.feature)
  if (existsSync(join(f.qa, 'plan.json')) && !opts.force) {
    log(`plan exists: ${relative(cwd, join(f.qa, 'plan.json'))} (use --force to re-plan)`)
    return
  }
  const specPath = join(f.dir, cfg.spec.spec)
  if (!existsSync(specPath)) throw new Error(`${relative(cwd, specPath)} not found — kss-qa runs after kss-spec`)
  const spec = readFileSync(specPath, 'utf8')
  const reqFile = cfg.spec.request.map((r) => join(f.dir, r)).find((p) => existsSync(p))
  const request = reqFile ? readFileSync(reqFile, 'utf8') : extractSections(spec, cfg.spec.request_fallback_sections)

  const ws = mkdtempSync(join(tmpdir(), 'kss-qa-plan-'))
  mkdirSync(join(ws, 'input/schema'), { recursive: true })
  mkdirSync(join(ws, 'out/seed'), { recursive: true })
  writeFileSync(join(ws, 'input/request.md'), request)
  writeFileSync(join(ws, 'input/functional-spec.md'), extractSections(spec, cfg.spec.sections))
  writeFileSync(join(ws, 'input/environment.md'), environmentDoc(cfg))
  for (const [n, d] of Object.entries(cfg.databases)) if (d.schema) copyFileSync(resolve(cwd, d.schema), join(ws, 'input', schemaName(d, n)))

  log(`planning ${f.name} with ${cfg.models.planner} in ${ws}`)
  const r = await runClaude({
    cwd: ws,
    model: cfg.models.planner,
    prompt: readFileSync(templatePath(cwd, 'planner.md'), 'utf8'),
    allowed: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
    disallowed: ['Bash', 'WebFetch', 'WebSearch', 'Agent', 'Task', 'NotebookEdit'],
    maxTurns: cfg.limits.planner_turns,
    timeoutS: cfg.limits.planner_timeout_s,
    budget: cfg.limits.max_budget_usd,
    env: process.env,
  })
  const planFile = join(ws, 'out/plan.json')
  if (!existsSync(planFile)) throw new Error(`planner wrote no out/plan.json (${r.code}): ${r.json?.result || r.raw || r.err}`)
  const plan = JSON.parse(readFileSync(planFile, 'utf8'))
  const errs = validatePlan(plan, cfg, Object.keys(requirementMap(spec)))
  if (errs.length) throw new Error(`planner produced an invalid plan (kept in ${ws}):\n- ${errs.join('\n- ')}`)

  mkdirSync(join(f.qa, 'seed'), { recursive: true })
  writeJsonFile(join(f.qa, 'plan.json'), plan)
  for (const file of Object.values(plan.seed || {})) copyFileSync(join(ws, 'out', file), join(f.qa, file))
  writeFileSync(join(f.qa, 'plan.md'), renderPlanMd(f.name, plan, requirementMap(spec)))
  writeFileSync(join(f.qa, '.gitignore'), 'runs/*/logs/\n')
  writeJsonFile(join(f.qa, 'plan.meta.json'), {
    at: new Date().toISOString(), model: cfg.models.planner, cost_usd: r.json?.total_cost_usd ?? null,
    turns: r.json?.num_turns ?? null, inputs: { request: reqFile ? basename(reqFile) : `${cfg.spec.spec} §${cfg.spec.request_fallback_sections.join(', ')}`, spec_sections: cfg.spec.sections },
  })
  rmSync(ws, { recursive: true, force: true })
  log(`plan ready: ${plan.scenarios.length} scenarios → ${relative(cwd, join(f.qa, 'plan.md'))}`)
}

/**
 * A seed that the database refused goes back to a blind repair agent: the schemas, the plan and
 * the error, nothing else. It may change the seed and, only to keep them true, the expected values.
 * Seeds are applied in one transaction, so a failed attempt leaves nothing behind to clean up.
 */
async function repairSeed(cwd, cfg, f, db, file, error) {
  const ws = mkdtempSync(join(tmpdir(), 'kss-qa-repair-'))
  mkdirSync(join(ws, 'input/schema'), { recursive: true })
  mkdirSync(join(ws, 'work/seed'), { recursive: true })
  writeFileSync(join(ws, 'input/environment.md'), environmentDoc(cfg))
  for (const [n, d] of Object.entries(cfg.databases)) if (d.schema) copyFileSync(resolve(cwd, d.schema), join(ws, 'input', schemaName(d, n)))
  copyFileSync(join(f.qa, 'plan.json'), join(ws, 'work/plan.json'))
  for (const x of readdirSync(join(f.qa, 'seed'))) copyFileSync(join(f.qa, 'seed', x), join(ws, 'work/seed', x))
  log(`seed ${db} refused — repairing with ${cfg.models.planner}`)
  const r = await runClaude({
    cwd: ws,
    model: cfg.models.planner,
    prompt: fill(readFileSync(templatePath(cwd, 'seed-repair.md'), 'utf8'), { SEED_FILE: `work/${file}`, DATABASE: db, ERROR: error }),
    allowed: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
    disallowed: ['Bash', 'WebFetch', 'WebSearch', 'Agent', 'Task', 'NotebookEdit'],
    maxTurns: cfg.limits.planner_turns,
    timeoutS: cfg.limits.planner_timeout_s,
    budget: cfg.limits.max_budget_usd,
    env: process.env,
  })
  const plan = JSON.parse(readFileSync(join(ws, 'work/plan.json'), 'utf8'))
  const errs = validatePlan(plan, cfg, Object.keys(requirementMap(readFileSync(join(f.dir, cfg.spec.spec), 'utf8'))))
  if (errs.length) throw new Error(`seed repair broke the plan (kept in ${ws}):\n- ${errs.join('\n- ')}`)
  writeJsonFile(join(f.qa, 'plan.json'), plan)
  for (const x of readdirSync(join(ws, 'work/seed'))) copyFileSync(join(ws, 'work/seed', x), join(f.qa, 'seed', x))
  writeFileSync(join(f.qa, 'plan.md'), renderPlanMd(f.name, plan, requirementMap(readFileSync(join(f.dir, cfg.spec.spec), 'utf8'))))
  const metaPath = join(f.qa, 'plan.meta.json')
  const meta = readJsonFile(metaPath, {})
  meta.repairs = [...(meta.repairs || []), { at: new Date().toISOString(), database: db, error: error.split('\n').find((l) => /ERROR/.test(l)) || error.slice(0, 300), result: r.json?.result ?? null, cost_usd: r.json?.total_cost_usd ?? null }]
  meta.cost_usd = (meta.cost_usd || 0) + (r.json?.total_cost_usd || 0)
  writeJsonFile(metaPath, meta)
  rmSync(ws, { recursive: true, force: true })
  log(`seed ${db}: ${r.json?.result || 'repair finished'}`)
}

export function renderPlanMd(feature, plan, reqs) {
  const L = [`# QA plan · ${feature}`, '', 'Written by the blind planner from the request and the functional spec only. Review it before the run; edit `plan.json` and `seed/` freely.', '']
  L.push(`**Services:** ${(plan.services || []).join(', ')}`, '')
  L.push('## Personas', '', '| Key | App | Username | Roles | Notes |', '| --- | --- | --- | --- | --- |')
  for (const p of plan.personas || []) L.push(`| ${p.key} | ${p.app || ''} | \`${p.username}\` | ${personaRoles(p).join(', ')} | ${cell(p.notes)} |`)
  L.push('', '## Scenarios', '')
  for (const s of plan.scenarios || []) {
    L.push(`### ${s.id} · ${s.title}`, '', `**Covers:** ${(s.covers || []).map((c) => `${c}${reqs[c] ? '' : ' (?)'}`).join(', ')} · **Persona:** ${s.persona} · **Start:** \`${s.app}${s.path || '/'}\``, '')
    L.push('**Steps**', '', numbered(s.steps), '', '**Expected**', '', (s.expected || []).map((x, i) => `- **E${i + 1}** ${x}`).join('\n'), '')
    if ((s.derivation || []).length) L.push('**Derivation**', '', bullets(s.derivation), '')
  }
  if ((plan.not_covered || []).length) L.push('## Not covered by the UI', '', (plan.not_covered || []).map((n) => `- **${n.fr}** — ${n.reason}`).join('\n'), '')
  if ((plan.assumptions || []).length) L.push('## Assumptions to confirm', '', bullets(plan.assumptions), '')
  L.push('## Seed', '', Object.entries(plan.seed || {}).map(([db, file]) => `- ${db}: [\`${file}\`](${file})`).join('\n'), '')
  return L.join('\n')
}

// ---------------------------------------------------------------- up / down

function kcClient(kc) {
  const base = kc.url.replace(/\/+$/, '')
  const token = async () => {
    const r = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: kc.admin, password: kc.adminPassword }),
    })
    if (!r.ok) throw new Error(`Keycloak admin login failed: HTTP ${r.status}`)
    return (await r.json()).access_token
  }
  const call = async (method, path, body) => {
    const r = await fetch(`${base}/admin/realms${path}`, {
      method,
      headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await r.text()
    return { status: r.status, ok: r.ok, json: text ? (() => { try { return JSON.parse(text) } catch { return text } })() : null, location: r.headers.get('location') }
  }
  return { base, call }
}

export async function setupKeycloak(cwd, kc, personas, timeoutS) {
  const c = kcClient(kc)
  await waitFor('keycloak', () => ready({ http: `${c.base}/realms/master` }), timeoutS)
  const realm = kc.realm
  if ((await c.call('GET', `/${realm}`)).status === 404) {
    if (!kc.realmImport) throw new Error(`realm ${realm} missing and keycloak.realmImport not set`)
    const rep = JSON.parse(readFileSync(resolve(cwd, kc.realmImport), 'utf8'))
    rep.realm = realm
    delete rep.users
    const r = await c.call('POST', '', rep)
    if (!r.ok) throw new Error(`realm import failed: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 500)}`)
    log(`keycloak: realm ${realm} imported`)
  }
  for (const cl of kc.clients || []) {
    const found = await c.call('GET', `/${realm}/clients?clientId=${encodeURIComponent(cl.clientId)}`)
    const client = Array.isArray(found.json) && found.json[0]
    if (!client) throw new Error(`keycloak client ${cl.clientId} not found`)
    const r = await c.call('PUT', `/${realm}/clients/${client.id}`, { ...client, ...(cl.set || {}), ...(cl.secret ? { secret: cl.secret } : {}) })
    if (!r.ok) throw new Error(`keycloak client ${cl.clientId} update failed: HTTP ${r.status}`)
  }
  if (personas.some((p) => p.attributes && Object.keys(p.attributes).length)) {
    const prof = await c.call('GET', `/${realm}/users/profile`)
    if (prof.ok && prof.json && prof.json.unmanagedAttributePolicy !== 'ENABLED') {
      await c.call('PUT', `/${realm}/users/profile`, { ...prof.json, unmanagedAttributePolicy: 'ENABLED' })
    }
  }
  for (const p of personas) {
    const existing = await c.call('GET', `/${realm}/users?exact=true&username=${encodeURIComponent(p.username)}`)
    for (const u of Array.isArray(existing.json) ? existing.json : []) await c.call('DELETE', `/${realm}/users/${u.id}`)
    const attributes = Object.fromEntries(Object.entries(p.attributes || {}).map(([k, v]) => [k, Array.isArray(v) ? v : [String(v)]]))
    const r = await c.call('POST', `/${realm}/users`, {
      username: p.username, email: p.email || p.username, firstName: p.firstName || 'Qa', lastName: p.lastName || p.key,
      enabled: true, emailVerified: true, attributes, requiredActions: [],
      credentials: [{ type: 'password', value: p.password, temporary: false }],
    })
    if (!r.ok) throw new Error(`keycloak user ${p.username}: HTTP ${r.status} ${JSON.stringify(r.json)}`)
    const id = r.location.split('/').pop()
    const roles = []
    for (const name of personaRoles(p)) {
      const role = await c.call('GET', `/${realm}/roles/${encodeURIComponent(name)}`)
      if (!role.ok) throw new Error(`keycloak realm role ${name} not found`)
      roles.push(role.json)
    }
    if (roles.length) await c.call('POST', `/${realm}/users/${id}/role-mappings/realm`, roles)
    log(`keycloak: user ${p.username} (${personaRoles(p).join(', ') || 'no roles'})`)
  }
}

async function cmdUp(cwd, opts) {
  const { cfg, present } = loadQaConfig(cwd)
  if (!present) throw new Error(`${QA_CONFIG} not found`)
  const f = featureOf(cwd, opts.feature)
  const plan = readJsonFile(join(f.qa, 'plan.json'), null)
  if (!plan) throw new Error(`no QA plan for ${f.name}: run qa.mjs plan first`)
  const sp = statePath(cwd)
  const prev = readJsonFile(sp, null)
  if (prev && Object.values(prev.pids || {}).some(alive)) throw new Error('a QA environment is already up — run qa.mjs down first')

  const levels = serviceLevels(cfg.services, plan.services || [])
  const all = levels.flat()
  const busy = []
  for (const n of all) if (cfg.services[n].ready?.tcp && (await tcpOpen(Number(cfg.services[n].ready.tcp)))) busy.push(`${n}:${cfg.services[n].ready.tcp}`)
  if (busy.length) throw new Error(`ports already in use (stop your dev stack first): ${busy.join(', ')}`)

  const rt = resolve(cwd, RUNTIME)
  const logs = join(rt, 'logs')
  rmSync(logs, { recursive: true, force: true })
  mkdirSync(logs, { recursive: true })
  const state = { feature: f.name, startedAt: new Date().toISOString(), project: cfg.compose.project, pids: {}, logs }
  writeJsonFile(sp, state)

  log(`docker compose up (${cfg.compose.project}): ${cfg.compose.services.join(', ')}`)
  must(compose(cwd, cfg, 'up', '-d', '--wait', ...cfg.compose.services), 'docker compose up')

  const env = buildServiceEnv(cwd, cfg)
  // The QA layer (env files + overrides) is re-applied inside every final Node process: Nx's own
  // dotenv handling can otherwise swap an override that equals .env for a .env.local value.
  const envFile = join(rt, 'env.json')
  writeJsonFile(envFile, buildServiceEnv(cwd, cfg, {}))
  const preload = join(rt, 'env-preload.cjs')
  copyFileSync(templatePath(cwd, 'env-preload.cjs'), preload)
  env.KSS_QA_ENV_FILE = envFile
  env.NODE_OPTIONS = `--require "${preload}"${process.env.NODE_OPTIONS ? ' ' + process.env.NODE_OPTIONS : ''}`
  for (const [n, db] of Object.entries(cfg.databases)) {
    const dbEnv = { ...env, KSS_QA_DB_URL: db.url || '' }
    // Stable, not first: a fresh database container answers once during its init and then restarts.
    let streak = 0
    await waitFor(`database ${n}`, async () => {
      streak = sh('sh', ['-c', dbCommand(db, 'ready')], { cwd, env: dbEnv }).code === 0 ? streak + 1 : 0
      return streak >= 3
    }, cfg.ready_timeout_s)
    if (db.migrate) {
      log(`migrate ${n}`)
      let r
      for (let attempt = 1; attempt <= 3; attempt++) {
        r = sh('sh', ['-c', db.migrate], { cwd, env })
        if (r.code === 0) break
        log(`migrate ${n} failed (attempt ${attempt}/3), retrying`)
        await sleep(5000)
      }
      must(r, `migrate ${n}`)
    }
  }
  const auth = authConfig(cfg)
  if (auth?.provider === 'keycloak') await setupKeycloak(cwd, auth, plan.personas || [], cfg.ready_timeout_s)
  if (auth?.provider === 'command') {
    const personasFile = join(rt, 'personas.json')
    writeJsonFile(personasFile, plan.personas || [])
    log('auth: project command creates the personas')
    must(sh('sh', ['-c', auth.command], { cwd, env: { ...env, KSS_QA_PERSONAS_FILE: personasFile } }), 'auth command')
  }
  for (const [db, file] of Object.entries(plan.seed || {})) {
    const d = cfg.databases[db]
    const attempts = 1 + (cfg.limits.seed_repairs ?? 2)
    for (let attempt = 1; ; attempt++) {
      log(`seed ${db} ← ${file}${attempt > 1 ? ` (after repair ${attempt - 1})` : ''}`)
      const r = sh('sh', ['-c', dbCommand(d, 'seed')], { cwd, env: { ...env, KSS_QA_DB_URL: d.url || '', KSS_QA_SEED_FILE: join(f.qa, file) } })
      if (r.code === 0) break
      if (attempt >= attempts) must(r, `seed ${db}`)
      await repairSeed(cwd, cfg, f, db, file, (r.err || r.out).trim().slice(-3000))
    }
  }

  // Commands that make the checkout runnable before any service starts: generated clients, codegen.
  // They run on every `up`, because the checkout may have changed branch since the last one.
  for (const cmd of cfg.prepare || []) {
    log(`prepare: ${cmd}`)
    must(sh('sh', ['-c', cmd], { cwd, env }), `prepare "${cmd}"`)
  }

  for (const level of levels) {
    for (const n of level) {
      const s = cfg.services[n]
      const logPath = join(logs, `${n}.log`)
      const fd = openSync(logPath, 'a')
      const child = spawn('sh', ['-c', s.command], { cwd: resolve(cwd, s.cwd || '.'), env: { ...env, ...(s.env || {}) }, detached: true, stdio: ['ignore', fd, fd] })
      child.unref()
      state.pids[n] = child.pid
      writeJsonFile(sp, state)
      log(`start ${n} (pid ${child.pid})`)
    }
    await Promise.all(level.map((n) => waitFor(n, () => ready(cfg.services[n].ready || {}, { logPath: join(logs, `${n}.log`), pid: state.pids[n] }), cfg.services[n].ready_timeout_s || cfg.ready_timeout_s, { pid: state.pids[n], logPath: join(logs, `${n}.log`), fail: cfg.services[n].fail })))
    log(`ready: ${level.join(', ')}`)
  }
  for (const n of all) {
    for (const url of cfg.services[n].warmup || []) {
      log(`warm up ${url}`)
      try {
        await fetch(url, { signal: AbortSignal.timeout(300000), redirect: 'manual' })
      } catch {
        /* the driver waits too */
      }
    }
  }
  state.readyAt = new Date().toISOString()
  writeJsonFile(sp, state)
  log('environment up')
}

async function cmdDown(cwd) {
  const { cfg } = loadQaConfig(cwd)
  const sp = statePath(cwd)
  const state = readJsonFile(sp, null)
  for (const [n, pid] of Object.entries(state?.pids || {})) {
    await killTree(pid)
    log(`stopped ${n}`)
  }
  for (const pid of state?.chromes || []) await killTree(pid)
  const r = compose(cwd, cfg, 'down', ...(cfg.compose.down_volumes ? ['-v'] : []), '--remove-orphans')
  log(r.code === 0 ? 'docker compose down' : `docker compose down failed: ${r.err.trim().slice(-300)}`)
  rmSync(sp, { force: true })
}

async function cmdStatus(cwd) {
  const { cfg } = loadQaConfig(cwd)
  const state = readJsonFile(statePath(cwd), null)
  if (!state) return console.log('down')
  const rows = []
  for (const [n, pid] of Object.entries(state.pids || {})) rows.push({ service: n, pid, alive: alive(pid), ready: await ready(cfg.services[n]?.ready || {}, { logPath: join(state.logs, `${n}.log`), pid }) })
  console.log(JSON.stringify({ feature: state.feature, startedAt: state.startedAt, readyAt: state.readyAt || null, services: rows }, null, 2))
}

// ---------------------------------------------------------------- run

async function launchChrome(cfg, profile) {
  const port = await freePort()
  const args = [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', `--window-size=${cfg.browser.width},${cfg.browser.height}`, 'about:blank',
  ]
  if (cfg.browser.headless) args.unshift('--headless=new')
  const child = spawn(chromePath(cfg), args, { detached: true, stdio: 'ignore' })
  child.unref()
  await waitFor('chrome', () => ready({ http: `http://127.0.0.1:${port}/json/version` }), 60)
  return { pid: child.pid, url: `http://127.0.0.1:${port}` }
}

async function cmdRun(cwd, opts) {
  const { cfg } = loadQaConfig(cwd)
  const f = featureOf(cwd, opts.feature)
  const plan = readJsonFile(join(f.qa, 'plan.json'), null)
  if (!plan) throw new Error('no QA plan: run qa.mjs plan first')
  const sp = statePath(cwd)
  const state = readJsonFile(sp, null)
  if (!state?.readyAt) throw new Error('the QA environment is not up: run qa.mjs up first')
  if (state.feature !== f.name) throw new Error(`the environment is up for ${state.feature}, not ${f.name}`)

  const specText = readFileSync(join(f.dir, cfg.spec.spec), 'utf8')
  const reqs = requirementMap(specText)
  const template = readFileSync(templatePath(cwd, 'driver.md'), 'utf8')
  const only = opts.only ? new Set(opts.only.split(',')) : null
  const scenarios = plan.scenarios.filter((s) => !only || only.has(s.id))

  const runId = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  const runDir = join(f.qa, 'runs', runId)
  mkdirSync(runDir, { recursive: true })
  const bu = join(resolve(cwd, RUNTIME), 'bu-workspace')
  mkdirSync(bu, { recursive: true })
  copyFileSync(templatePath(cwd, 'agent_helpers.py'), join(bu, 'agent_helpers.py'))
  const meta = {
    runId, feature: f.name, head: git(cwd, 'rev-parse', '--short', 'HEAD'), branch: git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD'),
    dirty: !!git(cwd, 'status', '--porcelain', '--untracked-files=no'), models: cfg.models, startedAt: new Date().toISOString(),
    scenarios: scenarios.map((s) => s.id),
  }
  writeJsonFile(join(runDir, 'run.json'), meta)

  for (const s of scenarios) {
    const persona = plan.personas.find((p) => p.key === s.persona)
    const app = cfg.apps[s.app]
    const ev = join(runDir, s.id)
    mkdirSync(ev, { recursive: true })
    const profile = mkdtempSync(join(tmpdir(), 'kss-qa-chrome-'))
    const cwdDriver = mkdtempSync(join(tmpdir(), 'kss-qa-driver-'))
    const chrome = await launchChrome(cfg, profile)
    state.chromes = [...(state.chromes || []), chrome.pid]
    writeJsonFile(sp, state)
    const env = { ...process.env, BU_NAME: `kssqa-${runId.replace(/[^0-9]/g, '')}-${s.id}`, BU_CDP_URL: chrome.url, BH_AGENT_WORKSPACE: bu, KSS_QA_EVIDENCE: ev, BH_RECORD: '0' }
    log(`${s.id} ${s.title} — driving with ${cfg.models.driver}`)
    const r = await runClaude({
      cwd: cwdDriver,
      model: cfg.models.driver,
      prompt: buildDriverPrompt(template, { scenario: s, persona, app, requirements: reqs }),
      system: 'You are a black-box QA tester. Your only tool is the browser-use CLI through Bash heredocs. You never read files or source code.',
      allowed: ['Bash(browser-use:*)'],
      disallowed: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent', 'Task', 'NotebookEdit'],
      maxTurns: cfg.limits.driver_turns,
      timeoutS: cfg.limits.driver_timeout_s,
      budget: cfg.limits.max_budget_usd,
      env,
    })
    sh('browser-use', ['--reload'], { env })
    await killTree(chrome.pid)
    state.chromes = state.chromes.filter((p) => p !== chrome.pid)
    writeJsonFile(sp, state)
    rmSync(profile, { recursive: true, force: true })
    rmSync(cwdDriver, { recursive: true, force: true })
    writeJsonFile(join(ev, 'driver.json'), {
      code: r.code, subtype: r.json?.subtype ?? null, turns: r.json?.num_turns ?? null, cost_usd: r.json?.total_cost_usd ?? null,
      result: r.json?.result ?? r.raw, stderr: r.err || undefined,
    })
    if (!existsSync(join(ev, 'result.json'))) {
      writeJsonFile(join(ev, 'result.json'), { status: 'blocked', summary: `the driver ended without closing the scenario (${r.json?.subtype || `exit ${r.code}`})`, issues: [{ kind: 'blocker', title: 'driver did not finish', detail: String(r.json?.result || r.err || '').slice(0, 500) }] })
    }
    log(`${s.id} → ${readJsonFile(join(ev, 'result.json'), {}).status}`)
  }

  mkdirSync(join(runDir, 'logs'), { recursive: true })
  for (const n of Object.keys(state.pids || {})) writeFileSync(join(runDir, 'logs', `${n}.log`), tail(join(state.logs, `${n}.log`), 300))
  meta.finishedAt = new Date().toISOString()
  writeJsonFile(join(runDir, 'run.json'), meta)
  log(`run ${runId} done → ${relative(cwd, runDir)}`)
  return runId
}

// ---------------------------------------------------------------- judge / report

function readSteps(dir) {
  try {
    return readFileSync(join(dir, 'steps.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

async function cmdJudge(cwd, opts) {
  const { cfg } = loadQaConfig(cwd)
  const f = featureOf(cwd, opts.feature)
  const runId = opts.run || latestRun(f.qa)
  if (!runId) throw new Error('no run to judge')
  const runDir = join(f.qa, 'runs', runId)
  const plan = readJsonFile(join(f.qa, 'plan.json'), {})
  const reqs = requirementMap(readFileSync(join(f.dir, cfg.spec.spec), 'utf8'))
  const { cfg: jcfg } = jev.loadLocalConfig(cwd)
  const apiKey = jev.resolveApiKey(jcfg)
  const on = jcfg.jev.enabled && jcfg.jev.qa_judge.enabled && !!apiKey
  if (!on) log(`Jev judge off (${!jcfg.jev.enabled ? 'jev.enabled false' : !jcfg.jev.qa_judge.enabled ? 'jev.qa_judge.enabled false' : 'no API key'}) — driver verdicts stand`)

  for (const id of readJsonFile(join(runDir, 'run.json'), {}).scenarios || []) {
    const s = plan.scenarios.find((x) => x.id === id)
    const dir = join(runDir, id)
    const result = readJsonFile(join(dir, 'result.json'), { status: 'blocked' })
    let judged = null
    let error = null
    if (on) {
      try {
        const built = jev.buildQaJudge({
          requirements: Object.fromEntries((s.covers || []).map((fr) => [fr, reqs[fr] || null])),
          scenario: s.title, expected: (s.expected || []).map((x, i) => `E${i + 1}: ${x}`), steps: readSteps(dir), tester_summary: result.summary,
        }, jcfg)
        const res = await jev.systemOne(built.body, jcfg, { apiKey })
        const answer = res.answers?.qa_verdict
        if (!answer || answer.type !== 'choice') throw new Error('unexpected Jev answer shape')
        judged = jev.gate(answer, built.threshold)
        jev.trace(cwd, jcfg, { cmd: 'judge', feature: f.name, run: runId, scenario: id, ...judged, model: res.model, latency_ms: res.latencyMs })
      } catch (e) {
        error = e.message
        log(`${id}: Jev failed (${e.message}) — driver verdict stands`)
      }
    }
    const c = combine(result.status, judged)
    writeJsonFile(join(dir, 'judge.json'), { driver: result.status, jev: judged, jev_error: error, ...c })
    log(`${id}: driver ${result.status} · jev ${judged ? `${judged.choice} ${judged.confidence}` : '—'} → ${c.final}`)
  }
  return runId
}

async function cmdReport(cwd, opts) {
  const { cfg } = loadQaConfig(cwd)
  const f = featureOf(cwd, opts.feature)
  const runId = opts.run || latestRun(f.qa)
  if (!runId) throw new Error('no run to report')
  const runDir = join(f.qa, 'runs', runId)
  const meta = readJsonFile(join(runDir, 'run.json'), {})
  const plan = readJsonFile(join(f.qa, 'plan.json'), {})
  const spec = readFileSync(join(f.dir, cfg.spec.spec), 'utf8')
  const frIds = Object.keys(requirementMap(spec)).filter((x) => x.startsWith('FR-'))

  const scenarios = (meta.scenarios || []).map((id) => {
    const s = plan.scenarios.find((x) => x.id === id) || { id, title: id }
    const dir = join(runDir, id)
    const result = readJsonFile(join(dir, 'result.json'), { status: 'blocked', issues: [] })
    const judge = readJsonFile(join(dir, 'judge.json'), null) || { driver: result.status, jev: null, ...combine(result.status, null) }
    const driver = readJsonFile(join(dir, 'driver.json'), {})
    return {
      ...s, driver: result.status, jev: judge.jev, final: judge.final, note: judge.note, summary: result.summary,
      issues: result.issues || [], steps: readSteps(dir), cost: driver.cost_usd || 0, turns: driver.turns,
    }
  })
  const rank = { fail: 0, blocked: 1, inconclusive: 2, pass: 3 }
  const coverage = frIds.map((fr) => {
    const ss = scenarios.filter((s) => (s.covers || []).includes(fr))
    const nc = (plan.not_covered || []).find((n) => n.fr === fr)
    const worst = ss.map((s) => s.final).sort((a, b) => rank[a] - rank[b])[0]
    return { fr, scenarios: ss.map((s) => s.id), result: worst ? ICON[worst] : nc ? '➖ not UI-testable' : '⚠️ not run' }
  })
  const verdict = overallVerdict(scenarios.map((s) => s.final))
  const planCost = readJsonFile(join(f.qa, 'plan.meta.json'), {}).cost_usd || 0
  const { cfg: jcfg } = jev.loadLocalConfig(cwd)
  const data = {
    feature: f.name, runId, head: meta.head, branch: meta.branch, dirty: meta.dirty, models: meta.models || cfg.models,
    judge: scenarios.some((s) => s.jev) ? `${jcfg.jev.model} (≥ ${jcfg.jev.qa_judge.confidence})` : 'off',
    cost: planCost + scenarios.reduce((a, s) => a + (s.cost || 0), 0), date: (meta.finishedAt || meta.startedAt || '').slice(0, 16).replace('T', ' '),
    scenarios, coverage, verdict, notCovered: plan.not_covered || [], assumptions: plan.assumptions || [],
    services: plan.services || [], seed: Object.values(plan.seed || {}), personas: plan.personas || [],
  }
  const md = renderReport(data)
  writeFileSync(join(runDir, 'report.md'), md.replaceAll(`](runs/${runId}/`, ']('))
  writeFileSync(join(f.qa, 'report.md'), md)
  const summary = { verdict, runId, feature: f.name, head: meta.head, scenarios: scenarios.map((s) => ({ id: s.id, covers: s.covers, final: s.final })), coverage }
  writeJsonFile(join(runDir, 'result.json'), summary)
  writeJsonFile(join(f.qa, 'result.json'), summary)
  console.log(JSON.stringify({ verdict, report: relative(cwd, join(f.qa, 'report.md')), run: relative(cwd, runDir) }, null, 2))
  return verdict
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const opts = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2).replace(/-/g, '_')
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
      opts[k] = v
    } else opts._.push(a)
  }
  return opts
}

const EXIT = { APPROVED: 0, REJECTED: 4, INCONCLUSIVE: 5 }

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const cwd = typeof opts.cwd === 'string' ? resolve(opts.cwd) : process.cwd()
  const cmd = opts._[0]
  if (cmd === 'plan') return cmdPlan(cwd, opts)
  if (cmd === 'up') {
    try {
      return await cmdUp(cwd, opts)
    } catch (e) {
      log('up failed — `qa.mjs down` stops whatever did start')
      throw e
    }
  }
  if (cmd === 'down') return cmdDown(cwd)
  if (cmd === 'status') return cmdStatus(cwd)
  if (cmd === 'run') return void (await cmdRun(cwd, opts))
  if (cmd === 'judge') return void (await cmdJudge(cwd, opts))
  if (cmd === 'report') process.exit(EXIT[await cmdReport(cwd, opts)])
  if (cmd === 'all') {
    await cmdPlan(cwd, { ...opts, force: !!opts.replan })
    let verdict = 'INCONCLUSIVE'
    try {
      await cmdUp(cwd, opts)
      const run = await cmdRun(cwd, opts)
      await cmdJudge(cwd, { ...opts, run })
      verdict = await cmdReport(cwd, { ...opts, run })
    } finally {
      if (!opts.keep_up) await cmdDown(cwd)
    }
    process.exit(EXIT[verdict])
  }
  process.stderr.write(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 11).map((l) => l.replace(/^\/\/ ?/, '')).join('\n') + '\n')
  process.exit(1)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((e) => {
    log(`error: ${e && e.message ? e.message : String(e)}`)
    process.exit(1)
  })
}
