#!/usr/bin/env node
// qa-stub.mjs — a fixture-driven HTTP stand-in for an external provider during kss-qa (DESIGN.md §22.5).
//
//   node .kss/scripts/qa-stub.mjs --name moov --port 18190 --fixtures a.json,b.json --log stub-moov.log
//
// Each fixture file is `{ "routes": [ { method, path, query?, status?, headers?, body? } ] }`.
// Files are searched in the order given and routes in file order: the first match answers, so the
// feature's fixture goes before the project's base. `path` matches segment by segment — `:name`
// captures one segment, `*` the rest. String values in `body` may be one placeholder:
// `{{now}}` / `{{now+3600}}` (Unix seconds, a number), `{{param.name}}`, `{{query.name}}`,
// `{{body.field}}` (the request's JSON body). An unmatched request answers 404 and is logged with
// `"matched": false` — qa.mjs reads that to tell an environment gap from a product defect.

import { createServer } from 'node:http'
import { readFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

/** `{ params }` when `pattern` matches `path`, else null. */
export function matchPath(pattern, path) {
  const want = String(pattern).split('?')[0].split('/').filter(Boolean)
  const got = String(path).split('?')[0].split('/').filter(Boolean)
  const params = {}
  for (let i = 0; i < want.length; i++) {
    if (want[i] === '*') return { params }
    if (i >= got.length) return null
    if (want[i].startsWith(':')) params[want[i].slice(1)] = decodeURIComponent(got[i])
    else if (want[i] !== got[i]) return null
  }
  return want.length === got.length ? { params } : null
}

/** The first route of `routes` answering `req` ({method, path, query}), with its params; null when none. */
export function findRoute(routes, req) {
  for (const route of routes) {
    if (route.method && route.method.toUpperCase() !== req.method.toUpperCase()) continue
    const m = matchPath(route.path, req.path)
    if (!m) continue
    if (route.query && Object.entries(route.query).some(([k, v]) => String(req.query[k] ?? '') !== String(v))) continue
    return { route, params: m.params }
  }
  return null
}

/** `body` with every placeholder string resolved against the request. */
export function renderBody(body, ctx, nowS = Math.floor(Date.now() / 1000)) {
  if (typeof body === 'string') {
    const m = /^\{\{\s*(now(?:\s*[+-]\s*\d+)?|param\.[\w-]+|query\.[\w-]+|body\.[\w.-]+)\s*\}\}$/.exec(body)
    if (!m) return body
    const expr = m[1].replace(/\s+/g, '')
    if (expr.startsWith('now')) return nowS + Number(expr.slice(3) || 0)
    const [scope, ...rest] = expr.split('.')
    let v = scope === 'param' ? ctx.params : scope === 'query' ? ctx.query : ctx.body
    for (const k of rest) v = v == null ? undefined : v[k]
    return v ?? null
  }
  if (Array.isArray(body)) return body.map((x) => renderBody(x, ctx, nowS))
  if (body && typeof body === 'object') return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, renderBody(v, ctx, nowS)]))
  return body
}

export function loadRoutes(files) {
  return files.flatMap((f) => {
    const json = JSON.parse(readFileSync(f, 'utf8'))
    return Array.isArray(json.routes) ? json.routes : []
  })
}

function parseArgs(argv) {
  const o = {}
  for (let i = 0; i < argv.length; i += 2) o[argv[i].replace(/^--/, '')] = argv[i + 1]
  return o
}

function main() {
  const o = parseArgs(process.argv.slice(2))
  const files = String(o.fixtures || '').split(',').filter(Boolean).map((f) => resolve(f))
  const routes = loadRoutes(files)
  const record = (entry) => o.log && appendFileSync(o.log, JSON.stringify({ at: new Date().toISOString(), stub: o.name, ...entry }) + '\n')
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const url = new URL(req.url, 'http://stub')
      const query = Object.fromEntries(url.searchParams)
      let body = null
      try {
        body = raw ? JSON.parse(raw) : null
      } catch {
        body = Object.fromEntries(new URLSearchParams(raw))
      }
      const hit = findRoute(routes, { method: req.method, path: url.pathname, query })
      if (!hit) {
        record({ method: req.method, path: url.pathname, query, matched: false, status: 404 })
        res.writeHead(404, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ error: `kss-qa stub ${o.name}: no fixture for ${req.method} ${url.pathname}` }))
      }
      const status = hit.route.status || 200
      record({ method: req.method, path: url.pathname, query, matched: true, status })
      const out = hit.route.body === undefined ? '' : JSON.stringify(renderBody(hit.route.body, { params: hit.params, query, body }))
      res.writeHead(status, { 'content-type': 'application/json', ...(hit.route.headers || {}) })
      res.end(out)
    })
  })
  server.listen(Number(o.port), '127.0.0.1', () => process.stderr.write(`[kss-qa stub ${o.name}] ${routes.length} routes on ${o.port}\n`))
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
