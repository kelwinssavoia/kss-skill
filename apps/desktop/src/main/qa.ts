// The QA panel's reader: plan, environment, runs and the live scenario of scripts/qa.mjs (DESIGN.md §22, §24.5).
// It reads what qa.mjs writes and never writes any of it; every step runs as qa.mjs itself, in a terminal.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import type { QaEnv, QaInfo, QaLive, QaScenario, QaScenarioRun, QaStepRecord } from '../shared/types.ts'
import { read } from './project.ts'

export const RUNTIME = '.kss/qa/.runtime'

const json = (p: string): any => {
  const t = read(p)
  if (t === null) return null
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function alive(pid: unknown): boolean {
  if (typeof pid !== 'number' || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function parseScenarios(plan: any): QaScenario[] {
  return (Array.isArray(plan?.scenarios) ? plan.scenarios : [])
    .filter((s: any) => s && typeof s.id === 'string')
    .map((s: any) => ({
      id: s.id,
      title: str(s.title) ?? s.id,
      persona: str(s.persona),
      app: str(s.app),
      covers: strs(s.covers),
      steps: strs(s.steps),
      expected: strs(s.expected),
    }))
}

export function parseSteps(text: string | null, dir: string): QaStepRecord[] {
  return (text ?? '').split('\n').flatMap(l => {
    if (!l.trim()) return []
    try {
      const o = JSON.parse(l)
      return [{
        i: num(o.i) ?? 0,
        at: str(o.at),
        title: String(o.title ?? ''),
        expected: String(o.expected ?? ''),
        observed: String(o.observed ?? ''),
        status: String(o.status ?? 'info'),
        url: str(o.url),
        screenshot: str(o.screenshot) ? join(dir, o.screenshot) : null,
      }]
    } catch {
      return []
    }
  })
}

export function scenarioRun(qaDir: string, runId: string, id: string): QaScenarioRun {
  const dir = join(qaDir, 'runs', runId, id)
  const result = json(join(dir, 'result.json'))
  const judge = json(join(dir, 'judge.json'))
  const driver = json(join(dir, 'driver.json'))
  return {
    runId,
    status: str(result?.status),
    final: str(judge?.final),
    note: str(judge?.note),
    summary: str(result?.summary),
    issues: Array.isArray(result?.issues) ? result.issues.filter((x: any) => x && typeof x.title === 'string') : [],
    turns: num(driver?.turns),
    cost: num(driver?.cost_usd),
    steps: parseSteps(read(join(dir, 'steps.jsonl')), dir),
  }
}

export function runIds(qaDir: string): string[] {
  try {
    return readdirSync(join(qaDir, 'runs')).filter(r => existsSync(join(qaDir, 'runs', r, 'run.json'))).sort()
  } catch {
    return []
  }
}

/** Per scenario, its most recent run that has evidence for it. */
export function latestRuns(qaDir: string, runs: string[]): Record<string, QaScenarioRun> {
  const out: Record<string, QaScenarioRun> = {}
  for (const r of [...runs].reverse()) {
    for (const id of strs(json(join(qaDir, 'runs', r, 'run.json'))?.scenarios)) {
      if (!out[id]) out[id] = scenarioRun(qaDir, r, id)
    }
  }
  return out
}

export function envOf(session: string): QaEnv {
  const state = json(join(session, RUNTIME, 'state.json'))
  if (!state) return { state: 'down', feature: null, startedAt: null, readyAt: null, services: [] }
  const services = Object.entries(state.pids && typeof state.pids === 'object' ? state.pids : {}).map(([name, pid]) => ({ name, alive: alive(pid) }))
  const isUp = services.some(s => s.alive) || (!!state.readyAt && !services.length)
  return {
    state: isUp ? (state.readyAt ? 'up' : 'starting') : 'down',
    feature: str(state.feature),
    startedAt: str(state.startedAt),
    readyAt: str(state.readyAt),
    services,
  }
}

export function liveOf(session: string): QaLive | null {
  const l = json(join(session, RUNTIME, 'live.json'))
  return l && typeof l.cdp === 'string' && typeof l.scenario === 'string'
    ? { runId: String(l.runId ?? ''), scenario: l.scenario, title: String(l.title ?? l.scenario), cdp: l.cdp, startedAt: String(l.startedAt ?? '') }
    : null
}

/** The other session holding the one QA environment, if any — compose project and ports are fixed. */
export function holder(session: string, sessions: string[]): string | null {
  return sessions.find(s => s !== session && envOf(s).state !== 'down') ?? null
}

export function qaInfo(session: string, featureDir: string | null, feature: string | null, sessions: string[]): QaInfo {
  const hasConfig = existsSync(join(session, '.kss/qa.config.json'))
  const script = read(join(session, '.kss/scripts/qa.mjs'))
  const qaDir = featureDir ? join(featureDir, 'qa') : null
  const plan = qaDir ? json(join(qaDir, 'plan.json')) : null
  const runs = qaDir ? runIds(qaDir) : []
  return {
    hasConfig,
    hasLive: !!script && script.includes('live.json'),
    feature,
    plan: plan
      ? {
          scenarios: parseScenarios(plan),
          notCovered: Array.isArray(plan.not_covered) ? plan.not_covered.filter((n: any) => typeof n?.fr === 'string') : [],
          assumptions: strs(plan.assumptions),
        }
      : null,
    env: envOf(session),
    heldBy: holder(session, sessions),
    live: liveOf(session),
    runs,
    latest: qaDir ? latestRuns(qaDir, runs) : {},
    verdict: qaDir ? str(json(join(qaDir, 'result.json'))?.verdict) : null,
  }
}

/** A screenshot as a data URL — only from inside a session's feature folders. */
export function imageData(path: string, sessions: string[]): string | null {
  if (!path.endsWith('.jpg') && !path.endsWith('.png')) return null
  if (!sessions.some(s => !relative(s, path).startsWith('..'))) return null
  try {
    return `data:image/${path.endsWith('.png') ? 'png' : 'jpeg'};base64,${readFileSync(path).toString('base64')}`
  } catch {
    return null
  }
}
