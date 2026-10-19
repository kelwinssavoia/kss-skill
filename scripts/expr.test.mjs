// Tests for expr.mjs — the simulators' safe expression language (DESIGN.md §25.1).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check, compile, evaluate, exprLib, simulate } from './expr.mjs'

const err = (src, known) => compile(src, known).error ?? ''

test('precedence and associativity follow the usual rules', () => {
  assert.equal(evaluate('1 + 2 * 3', {}), 7)
  assert.equal(evaluate('(1 + 2) * 3', {}), 9)
  assert.equal(evaluate('10 - 4 - 3', {}), 3)
  assert.equal(evaluate('2 * 3 % 4', {}), 2)
  assert.equal(evaluate('-2 * -3', {}), 6)
  assert.equal(evaluate('!false && 1 < 2', {}), true)
  assert.equal(evaluate('1 < 2 == true', {}), true)
  assert.equal(evaluate('false || true && false', {}), false)
  assert.equal(evaluate('a > 5 ? "big" : a > 2 ? "mid" : "small"', { a: 3 }), 'mid')
})

test('&& and || short-circuit: the side not taken is never evaluated', () => {
  assert.equal(evaluate('false && x / 0 > 1', { x: 1 }), false)
  assert.equal(evaluate('true || missing', {}), true)
  assert.equal(evaluate('if(n > 0, 10 / n, 0)', { n: 0 }), 0)
  assert.throws(() => evaluate('true && x / 0 > 1', { x: 1 }), /division by zero/)
})

test('equality is strict; + joins texts; order compares like with like', () => {
  assert.equal(evaluate('1 == "1"', {}), false)
  assert.equal(evaluate('null == null', {}), true)
  assert.equal(evaluate('1 === 1', {}), true)
  assert.equal(evaluate('"a" + 1', {}), 'a1')
  assert.equal(evaluate("'it\\'s' + \" ok\"", {}), "it's ok")
  assert.equal(evaluate('"10:30" < "15:00"', {}), true)
  assert.throws(() => evaluate('1 < "2"', {}), /compares two numbers or two texts/)
  assert.throws(() => evaluate('"a" * 2', {}), /needs a number/)
})

test('the whitelisted functions', () => {
  assert.equal(evaluate('min(3, 1, 2) + max(4, 9)', {}), 10)
  assert.equal(evaluate('round(1.005, 2)', {}), 1.01)
  assert.equal(evaluate('round(-2.5)', {}), -3)
  assert.equal(evaluate('floor(2.7) + ceil(2.1) + abs(-1)', {}), 6)
  assert.equal(evaluate('len("abc")', {}), 3)
  assert.equal(evaluate('upper(lower("AbC"))', {}), 'ABC')
  assert.equal(evaluate('contains("batch-01", "01") && startsWith("batch", "ba")', {}), true)
  assert.equal(evaluate('in(c, "BR", "AR")', { c: 'AR' }), true)
  assert.equal(evaluate('in(c, "BR", "AR")', { c: 'US' }), false)
  assert.equal(evaluate('contains(l, 2)', { l: [1, 2] }), true)
})

test('time and date helpers', () => {
  assert.equal(evaluate("hour('15:30')", {}), 15)
  assert.equal(evaluate("minutes('01:30')", {}), 90)
  assert.equal(evaluate("day('2026-10-19')", {}), 1) // a Monday
  assert.equal(evaluate("daysBetween('2026-10-01', '2026-10-19')", {}), 18)
  assert.throws(() => evaluate("hour('25:00')", {}), /HH:MM/)
  assert.throws(() => evaluate("day('tomorrow')", {}), /YYYY-MM-DD/)
})

test('compile checks names against the known ids and lists the ones used', () => {
  const c = compile('amount > limit && tier == "gold"', ['amount', 'limit', 'tier'])
  assert.ok(c.ok)
  assert.deepEqual(c.refs, ['amount', 'limit', 'tier'])
  assert.equal(c.fn({ amount: 5, limit: 1, tier: 'gold' }), true)
  assert.match(err('amount > limt', ['amount', 'limit']), /unknown name 'limt' .*known: amount, limit \(at 10\)/)
  assert.match(err('foo(1)'), /unknown function 'foo'/)
  assert.match(err('round()'), /round\(\) takes 1–2 arguments, got 0/)
})

test('anything that could reach the JavaScript underneath is refused', () => {
  assert.match(err('constructor'), /not allowed/)
  assert.match(err('__proto__'), /not allowed/)
  assert.match(err('a.constructor'), /property access is not allowed/)
  assert.match(err('a["x"]'), /indexing is not allowed/)
  assert.match(err('a = 1'), /assignment is not allowed/)
  assert.match(err('(a)(1)'), /a call needs a function name/)
  assert.match(err('toString()'), /not allowed/)
  assert.match(err('1 +'), /unexpected the end/)
  assert.match(err('(1 + 2'), /expected '\)'/)
  assert.match(err('"open'), /unterminated string/)
  assert.match(err('x'.repeat(700)), /over 600/)
  assert.match(err('('.repeat(60) + '1' + ')'.repeat(60)), /nested too deeply/)
  // A scope with a prototype never leaks it: only own keys resolve.
  assert.throws(() => evaluate('hasOwn', Object.create({ hasOwn: 1 })), /unknown name/)
})

test('the module body is self-contained: it rebuilds from its own source text', () => {
  // The page embeds `(${exprLib})()`; rebuilding it from its text proves it needs nothing outside.
  const again = new Function('return (' + exprLib.toString() + ')()')()
  assert.equal(again.evaluate('round(10 / 3, 2)', {}), 3.33)
})

const FEE = {
  id: 'fee',
  inputs: [{ id: 'amount', type: 'number', default: 100 }, { id: 'at', type: 'time', default: '10:00' }, { id: 'vip', type: 'boolean', default: false }],
  derive: [{ id: 'late', expr: 'hour(at) >= 15' }],
  rules: [
    { id: 'vip', when: 'vip', then: { fee: '0', cutoff: '"same day"' } },
    { id: 'late', when: 'late', then: { fee: 'round(amount * 0.02, 2)', cutoff: '"next day"' } },
    { id: 'base', when: 'true', then: { fee: 'round(amount * 0.01, 2)', cutoff: '"same day"' } },
  ],
  hit: 'first',
  outputs: [{ id: 'fee' }, { id: 'cutoff' }],
}

test('simulate: inputs coerced, derived values, every condition, the first rule that holds', () => {
  const r = simulate(FEE, { amount: '250', at: '16:10' })
  assert.equal(r.inputs.amount, 250)
  assert.equal(r.derived.late, true)
  assert.deepEqual(r.conditions.map((c) => c.value), [false, true, true])
  assert.deepEqual(r.fired, ['late'])
  assert.deepEqual(r.outputs, { fee: 5, cutoff: 'next day' })
  assert.deepEqual(simulate({ ...FEE, hit: 'all' }, { at: '16:00' }).fired, ['late', 'base'])
})

test('check: a scenario against its expectation names every output that differs', () => {
  assert.ok(check(FEE, { inputs: { amount: 100, vip: true }, expect: { fee: 0 } }).ok)
  const bad = check(FEE, { inputs: { amount: 100, at: '15:00' }, expect: { fee: 1, cutoff: 'next day' } })
  assert.equal(bad.ok, false)
  assert.deepEqual(bad.mismatches, [{ output: 'fee', got: 2, expected: 1 }])
})
