// Tests for the transcript readers in kss-lib.mjs — one per harness (DESIGN.md §19).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectTranscriptFormat, summariseRollout, summariseTranscript, summarise, tailContext, rootFromCommonDir, mainWorktreeRoot } from './kss-lib.mjs'

const jsonl = (lines) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n'

/** Codex rollout: `{timestamp, type, payload}` per line, usage on `token_usage_record`. */
const ROLLOUT = jsonl([
  { timestamp: '2026-09-04T22:41:20.000Z', type: 'session_meta', payload: { session_id: 'abc', cwd: '/x' } },
  { timestamp: '2026-09-04T22:41:30.000Z', type: 'turn_context', payload: { turn_id: 't1', model: 'gpt-6-astra', effort: 'high' } },
  {
    timestamp: '2026-09-04T22:41:35.000Z',
    ordinal: 12,
    type: 'token_usage_record',
    payload: {
      response_id: 'resp_1',
      turn_id: 't1',
      usage: { input_tokens: 20449, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 10, total_tokens: 20459 },
    },
  },
  { timestamp: '2026-09-04T22:41:36.000Z', type: 'response_item', payload: { type: 'function_call', name: 'shell' } },
  { timestamp: '2026-09-04T22:41:37.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch' } },
  { timestamp: '2026-09-04T22:41:38.000Z', type: 'response_item', payload: { type: 'reasoning' } },
  {
    timestamp: '2026-09-04T22:43:20.000Z',
    ordinal: 23,
    type: 'token_usage_record',
    payload: {
      response_id: 'resp_2',
      turn_id: 't2',
      usage: { input_tokens: 20802, cached_input_tokens: 20224, cache_write_input_tokens: 100, output_tokens: 183, total_tokens: 20985 },
    },
  },
  // the same response replayed — must not be counted twice
  {
    timestamp: '2026-09-04T22:43:21.000Z',
    ordinal: 24,
    type: 'token_usage_record',
    payload: {
      response_id: 'resp_2',
      turn_id: 't2',
      usage: { input_tokens: 20802, cached_input_tokens: 20224, cache_write_input_tokens: 100, output_tokens: 183 },
    },
  },
  'not json at all',
])

/** Claude Code transcript: one assistant message per line, usage on `message.usage`. */
const TRANSCRIPT = jsonl([
  { timestamp: '2026-09-04T22:41:20.000Z', type: 'user', message: { role: 'user', content: 'hi' } },
  {
    timestamp: '2026-09-04T22:41:30.000Z',
    message: {
      id: 'msg_1',
      role: 'assistant',
      model: 'claude-opus-5',
      content: [{ type: 'tool_use' }, { type: 'text' }],
      usage: { input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 4000, output_tokens: 50 },
    },
  },
  {
    timestamp: '2026-09-04T22:41:40.000Z',
    message: {
      id: 'msg_1',
      role: 'assistant',
      model: 'claude-opus-5',
      usage: { input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 4000, output_tokens: 50 },
    },
  },
])

function withFiles(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'kss-lib-'))
  try {
    const rollout = join(dir, 'rollout.jsonl')
    const transcript = join(dir, 'transcript.jsonl')
    writeFileSync(rollout, ROLLOUT)
    writeFileSync(transcript, TRANSCRIPT)
    fn({ dir, rollout, transcript })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the format is sniffed from the head of the file', () => {
  withFiles(({ dir, rollout, transcript }) => {
    assert.equal(detectTranscriptFormat(rollout), 'codex')
    assert.equal(detectTranscriptFormat(transcript), 'claude-code')
    assert.equal(detectTranscriptFormat(join(dir, 'nope.jsonl')), null)
    assert.equal(detectTranscriptFormat(undefined), null)
  })
})

test('a rollout is summarised into the metrics schema, deduplicated by response_id', () => {
  withFiles(({ rollout }) => {
    const s = summariseRollout(rollout)
    assert.equal(s.turns, 2, 'the replayed response is counted once')
    assert.equal(s.tool_uses, 2, 'function_call and custom_tool_call, not reasoning')
    assert.equal(s.model, 'gpt-6-astra')
    assert.equal(s.effort, 'high')
    assert.equal(s.duration_ms, 121000)
    // Codex input_tokens includes what came from the cache, so fresh subtracts it
    assert.equal(s.tokens.fresh_in, 20449 + (20802 - 20224 - 100))
    assert.equal(s.tokens.cache_read, 20224)
    assert.equal(s.tokens.cache_write, 100)
    assert.equal(s.tokens.out, 193)
    assert.equal(s.tokens.ctx_end, 20802, 'the last request carries the context size')
    assert.equal(
      s.tokens.cumulative,
      s.tokens.fresh_in + s.tokens.cache_write + s.tokens.cache_read + s.tokens.out,
    )
  })
})

test('a Claude Code transcript still reads the way it always did', () => {
  withFiles(({ transcript }) => {
    const s = summariseTranscript(transcript)
    assert.equal(s.turns, 1, 'the same message.id is counted once')
    assert.equal(s.tool_uses, 1)
    assert.equal(s.model, 'claude-opus-5')
    assert.equal(s.tokens.fresh_in, 100)
    assert.equal(s.tokens.cache_read, 4000)
    assert.equal(s.tokens.ctx_end, 4120)
  })
})

test('summarise dispatches on the format, and an absent file is zeroes, not a throw', () => {
  withFiles(({ dir, rollout, transcript }) => {
    assert.equal(summarise(rollout).model, 'gpt-6-astra')
    assert.equal(summarise(transcript).model, 'claude-opus-5')
    const none = summarise(join(dir, 'nope.jsonl'))
    assert.equal(none.turns, 0)
    assert.equal(none.tokens.cumulative, 0)
    assert.equal(summarise(undefined).turns, 0)
  })
})

test('tailContext reads the last request size in either format', () => {
  withFiles(({ dir, rollout, transcript }) => {
    assert.equal(tailContext(rollout), 20802)
    assert.equal(tailContext(transcript), 4120)
    assert.equal(tailContext(join(dir, 'nope.jsonl')), null)
    const empty = join(dir, 'empty.jsonl')
    writeFileSync(empty, '')
    assert.equal(tailContext(empty), null)
  })
})

// ---------------------------------------------------------------- worktree lookup

test('rootFromCommonDir turns what git answers into the main worktree root', () => {
  // A linked worktree answers the absolute path of the shared .git …
  assert.equal(rootFromCommonDir('/repo/wt', '/repo/.git'), '/repo')
  // … and a plain checkout answers a relative `.git`.
  assert.equal(rootFromCommonDir('/repo', '.git'), '/repo')
  assert.equal(rootFromCommonDir('/repo', ' /repo/.git \n'), '/repo', 'git output is trimmed')
})

test('rootFromCommonDir answers null rather than guessing when git said nothing', () => {
  assert.equal(rootFromCommonDir('/repo', ''), null)
  assert.equal(rootFromCommonDir('/repo', null), null)
  assert.equal(rootFromCommonDir('/repo', undefined), null)
})

test('mainWorktreeRoot never throws, even outside a repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kss-nogit-'))
  try {
    const r = mainWorktreeRoot(dir)
    assert.ok(r === null || typeof r === 'string')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
