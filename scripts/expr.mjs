// expr.mjs — the small, safe expression language of the feature's simulators (DESIGN.md §25.1).
//
// A simulator states a business rule as data — `when: "amount > 1000 && hour(at) >= 15"`,
// `then: { fee: "round(amount * 0.02, 2)" }` — and both the script that validates it and the page
// that runs it as the user types must agree on what it means. So the language is parsed and
// interpreted here, never handed to eval or Function (the page's CSP forbids both anyway): no
// property access, no assignment, no globals — identifiers resolve only against the simulator's
// own inputs and derived values, and calls only against the whitelist below.
//
// Everything lives inside `exprLib`, a self-contained function with no outer references, so
// report.mjs embeds `(${exprLib})()` into the page exactly as it embeds the client.
//
//   compile(src, known?)  → { ok, fn?(scope), error?, refs }   known: the ids an identifier may name
//   evaluate(src, scope)  → the value, or throws with the reason
//   simulate(sim, values) → inputs coerced, derived values, every rule's condition, fired, outputs
//   check(sim, scenario)  → { ok, result, mismatches: [{ output, got, expected }] }

export function exprLib() {
  var MAX_LEN = 600
  var MAX_DEPTH = 40
  // name → [min args, max args]; `if` is lazy and handled by the interpreter.
  var ARITY = {
    min: [1, 20], max: [1, 20], abs: [1, 1], round: [1, 2], floor: [1, 1], ceil: [1, 1],
    len: [1, 1], lower: [1, 1], upper: [1, 1], contains: [2, 2], startsWith: [2, 2], in: [2, 30],
    hour: [1, 1], minutes: [1, 1], day: [1, 1], daysBetween: [2, 2], if: [3, 3],
  }
  // Names that would reach JavaScript's object machinery if anything ever looked them up loosely.
  // A list, not an object: `{ __proto__: 1 }` would set a prototype instead of naming a key.
  var FORBIDDEN = ['constructor', '__proto__', 'prototype', '__defineGetter__', '__defineSetter__', '__lookupGetter__', 'hasOwnProperty', 'toString', 'valueOf']
  var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k) }

  function fail(msg, pos) {
    var e = new Error(pos == null ? msg : msg + ' (at ' + (pos + 1) + ')')
    e.kssExpr = true
    throw e
  }

  // ── Tokens ────────────────────────────────────────────────────────────────────────────────
  function tokenize(src) {
    var out = []
    var i = 0
    var OPS = ['===', '!==', '<=', '>=', '==', '!=', '&&', '||', '<', '>', '+', '-', '*', '/', '%', '!', '?', ':', '(', ')', ',']
    while (i < src.length) {
      var c = src[i]
      if (/\s/.test(c)) { i++; continue }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        var m = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))
        out.push({ t: 'num', v: Number(m[0]), pos: i })
        i += m[0].length
        if (/[A-Za-z_]/.test(src[i] || '')) fail('a number cannot run into a name', i)
        continue
      }
      if (c === '"' || c === "'") {
        var j = i + 1
        var s = ''
        while (j < src.length && src[j] !== c) {
          if (src[j] === '\\') {
            var n = src[j + 1]
            s += n === 'n' ? '\n' : n === 't' ? '\t' : n == null ? '' : n
            j += 2
          } else s += src[j++]
        }
        if (j >= src.length) fail('unterminated string', i)
        out.push({ t: 'str', v: s, pos: i })
        i = j + 1
        continue
      }
      if (/[A-Za-z_]/.test(c)) {
        var w = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))[0]
        out.push({ t: 'id', v: w, pos: i })
        i += w.length
        continue
      }
      if (c === '.') fail('property access is not allowed', i)
      if (c === '[' || c === ']') fail('indexing is not allowed', i)
      if (c === '=' && src[i + 1] !== '=') fail('assignment is not allowed — compare with ==', i)
      var op = null
      for (var k = 0; k < OPS.length; k++) if (src.slice(i, i + OPS[k].length) === OPS[k]) { op = OPS[k]; break }
      if (!op) fail("unexpected '" + c + "'", i)
      out.push({ t: 'op', v: op === '===' ? '==' : op === '!==' ? '!=' : op, pos: i })
      i += op.length
    }
    out.push({ t: 'end', v: '', pos: src.length })
    return out
  }

  // ── Parser: precedence climbing into a small tree ────────────────────────────────────────
  function parse(src, known) {
    var toks = tokenize(src)
    var p = 0
    var depth = 0
    var refs = []
    var peek = function () { return toks[p] }
    var isOp = function (v) { return toks[p].t === 'op' && toks[p].v === v }
    function expect(v) {
      if (!isOp(v)) fail("expected '" + v + "' but found " + show(toks[p]), toks[p].pos)
      p++
    }
    function show(t) { return t.t === 'end' ? 'the end' : "'" + (t.t === 'str' ? JSON.stringify(t.v) : t.v) + "'" }
    function deeper() { if (++depth > MAX_DEPTH) fail('expression nested too deeply', toks[p].pos) }
    function ternary() {
      deeper()
      var c = binary(0)
      if (isOp('?')) {
        p++
        var a = ternary()
        expect(':')
        var b = ternary()
        c = { k: 'cond', c: c, a: a, b: b }
      }
      depth--
      return c
    }
    var LEVELS = [['||'], ['&&'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']]
    function binary(level) {
      if (level >= LEVELS.length) return unary()
      var left = binary(level + 1)
      while (toks[p].t === 'op' && LEVELS[level].indexOf(toks[p].v) >= 0) {
        var op = toks[p++]
        var right = binary(level + 1)
        left = { k: op.v === '&&' ? 'and' : op.v === '||' ? 'or' : 'bin', op: op.v, a: left, b: right, pos: op.pos }
      }
      return left
    }
    function unary() {
      if (isOp('!') || isOp('-')) {
        var op = toks[p++]
        deeper()
        var a = unary()
        depth--
        return { k: 'un', op: op.v, a: a, pos: op.pos }
      }
      return primary()
    }
    function primary() {
      var t = peek()
      if (t.t === 'num' || t.t === 'str') { p++; return { k: 'lit', v: t.v } }
      if (t.t === 'op' && t.v === '(') {
        p++
        var e = ternary()
        expect(')')
        return e
      }
      if (t.t === 'id') {
        p++
        if (t.v === 'true' || t.v === 'false') return { k: 'lit', v: t.v === 'true' }
        if (t.v === 'null') return { k: 'lit', v: null }
        if (FORBIDDEN.indexOf(t.v) >= 0) fail("'" + t.v + "' is not allowed", t.pos)
        if (isOp('(')) {
          if (!own(ARITY, t.v)) fail("unknown function '" + t.v + "' — use one of " + Object.keys(ARITY).join(', '), t.pos)
          p++
          var args = []
          deeper()
          if (!isOp(')')) {
            args.push(ternary())
            while (isOp(',')) { p++; args.push(ternary()) }
          }
          expect(')')
          depth--
          var ar = ARITY[t.v]
          if (args.length < ar[0] || args.length > ar[1]) fail(t.v + '() takes ' + (ar[0] === ar[1] ? ar[0] : ar[0] + '–' + ar[1]) + ' argument' + (ar[1] === 1 ? '' : 's') + ', got ' + args.length, t.pos)
          return { k: 'call', name: t.v, args: args, pos: t.pos }
        }
        if (known && known.indexOf(t.v) < 0) fail("unknown name '" + t.v + "'" + (known.length ? ' — known: ' + known.join(', ') : ''), t.pos)
        if (refs.indexOf(t.v) < 0) refs.push(t.v)
        return { k: 'id', name: t.v, pos: t.pos }
      }
      if (t.t === 'op' && t.v === '.') fail('property access is not allowed', t.pos)
      fail('unexpected ' + show(t), t.pos)
    }
    var tree = ternary()
    if (peek().t !== 'end') {
      var extra = peek()
      fail(extra.t === 'op' && extra.v === '(' ? 'a call needs a function name' : 'unexpected ' + show(extra), extra.pos)
    }
    return { tree: tree, refs: refs }
  }

  // ── Interpreter ──────────────────────────────────────────────────────────────────────────
  function kind(v) { return v === null ? 'null' : Array.isArray(v) ? 'list' : typeof v }
  function num(v, what) {
    if (typeof v !== 'number' || v !== v) fail(what + ' needs a number, got ' + kind(v))
    return v
  }
  function str(v, what) {
    if (typeof v !== 'string') fail(what + ' needs text, got ' + kind(v))
    return v
  }
  function clock(v, what) {
    var m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(str(v, what))
    if (!m || +m[1] > 23 || +m[2] > 59) fail(what + " needs a time 'HH:MM', got '" + v + "'")
    return [+m[1], +m[2]]
  }
  function date(v, what) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(v, what))
    var t = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN
    if (t !== t) fail(what + " needs a date 'YYYY-MM-DD', got '" + v + "'")
    return t
  }
  function truthy(v) { return !!v }
  function run(n, scope) {
    switch (n.k) {
      case 'lit': return n.v
      case 'id':
        if (!scope || !own(scope, n.name)) fail("unknown name '" + n.name + "'", n.pos)
        return scope[n.name]
      case 'un': {
        var a = run(n.a, scope)
        return n.op === '!' ? !truthy(a) : -num(a, "'-'")
      }
      case 'and': { var l = run(n.a, scope); return truthy(l) ? run(n.b, scope) : l }
      case 'or': { var o = run(n.a, scope); return truthy(o) ? o : run(n.b, scope) }
      case 'cond': return truthy(run(n.c, scope)) ? run(n.a, scope) : run(n.b, scope)
      case 'bin': {
        var x = run(n.a, scope)
        var y = run(n.b, scope)
        switch (n.op) {
          case '==': return x === y
          case '!=': return x !== y
          case '+':
            if (typeof x === 'string' || typeof y === 'string') return String(x) + String(y)
            return num(x, "'+'") + num(y, "'+'")
          case '-': return num(x, "'-'") - num(y, "'-'")
          case '*': return num(x, "'*'") * num(y, "'*'")
          case '/': if (num(y, "'/'") === 0) fail('division by zero', n.pos); return num(x, "'/'") / y
          case '%': if (num(y, "'%'") === 0) fail('division by zero', n.pos); return num(x, "'%'") % y
          default: {
            // Order compares two numbers or two texts ('HH:MM' and 'YYYY-MM-DD' sort as text).
            if (!((typeof x === 'number' && typeof y === 'number') || (typeof x === 'string' && typeof y === 'string'))) fail("'" + n.op + "' compares two numbers or two texts, got " + kind(x) + ' and ' + kind(y), n.pos)
            return n.op === '<' ? x < y : n.op === '<=' ? x <= y : n.op === '>' ? x > y : x >= y
          }
        }
      }
      case 'call': return call(n, scope)
    }
    fail('bad expression')
  }
  function call(n, scope) {
    if (n.name === 'if') return truthy(run(n.args[0], scope)) ? run(n.args[1], scope) : run(n.args[2], scope)
    var a = n.args.map(function (x) { return run(x, scope) })
    var f = n.name + '()'
    switch (n.name) {
      case 'min': return Math.min.apply(null, a.map(function (v) { return num(v, f) }))
      case 'max': return Math.max.apply(null, a.map(function (v) { return num(v, f) }))
      case 'abs': return Math.abs(num(a[0], f))
      case 'floor': return Math.floor(num(a[0], f))
      case 'ceil': return Math.ceil(num(a[0], f))
      case 'round': {
        var d = a.length > 1 ? num(a[1], f) : 0
        var k = Math.pow(10, d)
        var v = num(a[0], f) * k
        // Half away from zero, and nudged so 1.005 rounds the way a person expects.
        return (Math.sign(v) * Math.round(Math.abs(v) + 1e-9)) / k
      }
      case 'len':
        if (typeof a[0] === 'string' || Array.isArray(a[0])) return a[0].length
        return fail(f + ' needs text or a list, got ' + kind(a[0]))
      case 'lower': return str(a[0], f).toLowerCase()
      case 'upper': return str(a[0], f).toUpperCase()
      case 'contains':
        if (Array.isArray(a[0])) return a[0].indexOf(a[1]) >= 0
        return str(a[0], f).indexOf(String(a[1])) >= 0
      case 'startsWith': return str(a[0], f).indexOf(str(a[1], f)) === 0
      case 'in': return a.slice(1).indexOf(a[0]) >= 0
      case 'hour': return clock(a[0], f)[0]
      case 'minutes': { var c = clock(a[0], f); return c[0] * 60 + c[1] }
      case 'day': return new Date(date(a[0], f)).getUTCDay()
      case 'daysBetween': return Math.round((date(a[1], f) - date(a[0], f)) / 86400000)
    }
    fail("unknown function '" + n.name + "'")
  }

  function compile(src, known) {
    if (typeof src !== 'string' || !src.trim()) return { ok: false, error: 'empty expression', refs: [] }
    if (src.length > MAX_LEN) return { ok: false, error: 'expression over ' + MAX_LEN + ' characters', refs: [] }
    try {
      var parsed = parse(src, known || null)
      return { ok: true, refs: parsed.refs, fn: function (scope) { return run(parsed.tree, scope) } }
    } catch (e) {
      if (!e.kssExpr) throw e
      return { ok: false, error: e.message, refs: [] }
    }
  }

  function evaluate(src, scope) {
    var c = compile(src)
    if (!c.ok) throw new Error(c.error)
    var s = Object.create(null)
    for (var k in scope) if (own(scope, k)) s[k] = scope[k]
    return c.fn(s)
  }

  // ── Simulators ───────────────────────────────────────────────────────────────────────────
  /** A raw form or scenario value as the input's type: what every rule then sees. */
  function coerce(input, raw) {
    var t = input.type
    if (raw === undefined) raw = input.default
    if (t === 'number') {
      if (raw === null || raw === '' || raw === undefined) return null
      var n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'))
      return n === n ? n : null
    }
    if (t === 'boolean') return raw === true || raw === 'true' || raw === 1 || raw === 'on'
    return raw == null ? '' : String(raw)
  }

  /** The ids an expression of a simulator may name, at each stage. */
  function names(sim) {
    var ins = (sim.inputs || []).map(function (i) { return i.id })
    var der = (sim.derive || []).map(function (d) { return d.id })
    return { inputs: ins, derive: der, all: ins.concat(der) }
  }

  /**
   * Runs a simulator on the given inputs: derived values in order, every rule's condition (so the
   * page can show why each did or did not fire), then the outputs of the rule(s) that fired —
   * the first true one, or every true one in order when `hit` is "all".
   */
  function simulate(sim, values) {
    values = values || {}
    var scope = Object.create(null)
    var res = { inputs: {}, derived: {}, conditions: [], fired: [], outputs: {}, errors: [] }
    ;(sim.inputs || []).forEach(function (i) {
      var v = coerce(i, own(values, i.id) ? values[i.id] : undefined)
      scope[i.id] = v
      res.inputs[i.id] = v
    })
    ;(sim.derive || []).forEach(function (d) {
      try {
        scope[d.id] = evaluate(d.expr, scope)
      } catch (e) {
        scope[d.id] = null
        res.errors.push(d.id + ': ' + e.message)
      }
      res.derived[d.id] = scope[d.id]
    })
    ;(sim.outputs || []).forEach(function (o) { res.outputs[o.id] = null })
    var done = false
    ;(sim.rules || []).forEach(function (r) {
      var c = { id: r.id, value: false, error: null }
      try {
        c.value = !!evaluate(r.when, scope)
      } catch (e) {
        c.error = e.message
        res.errors.push(r.id + ': ' + e.message)
      }
      res.conditions.push(c)
      if (!c.value || done) return
      res.fired.push(r.id)
      for (var k in r.then || {}) {
        if (!own(r.then, k)) continue
        try {
          // A literal (0, true) is accepted where an expression is expected: it means itself.
          var src = typeof r.then[k] === 'string' ? r.then[k] : JSON.stringify(r.then[k])
          res.outputs[k] = evaluate(src, scope)
        } catch (e) {
          res.errors.push(r.id + ' → ' + k + ': ' + e.message)
        }
      }
      if (sim.hit !== 'all') done = true
    })
    return res
  }

  /** Two outputs agree: numbers to a cent's sliver, everything else exactly. */
  function same(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6
    return a === b
  }

  /** A scenario against its `expect`: the run, and every output that came out different. */
  function check(sim, scenario) {
    var result = simulate(sim, scenario.inputs || {})
    var mismatches = []
    var exp = scenario.expect || {}
    for (var k in exp) {
      if (!own(exp, k)) continue
      if (!same(result.outputs[k], exp[k])) mismatches.push({ output: k, got: result.outputs[k], expected: exp[k] })
    }
    return { ok: !mismatches.length && !result.errors.length, result: result, mismatches: mismatches }
  }

  return { compile: compile, evaluate: evaluate, simulate: simulate, check: check, coerce: coerce, names: names, same: same, FUNCTIONS: Object.keys(ARITY) }
}

const lib = exprLib()
export const { compile, evaluate, simulate, check, coerce, names, same, FUNCTIONS } = lib
