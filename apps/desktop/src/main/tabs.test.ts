import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { appArgs, launchOf } from '../shared/commands.ts'
import { marks } from '../shared/board.ts'
import type { SavedTab } from '../shared/types.ts'
import { claudeConversationExists, findCodexConversation, loadTabs, saveTabs, withConversation, withoutSession, withoutTab, withTab } from './tabs.ts'

const tab = (key: string, cwd = '/s/a'): SavedTab => ({ key, cwd, kind: 'chat', harness: 'claude-code', phase: null, args: null, title: null, readonly: false, conversation: null, createdAt: '2026-10-14T00:00:00Z' })

test('resume: each CLI resumes its own way, without the phase prompt', () => {
  assert.deepEqual(launchOf({ cwd: '/r', kind: 'phase', harness: 'claude-code', phase: 'spec', args: '012-x', resume: 'abc', bypass: true }, '/bin/zsh').args, ['--dangerously-skip-permissions', '--resume', 'abc'])
  const c = launchOf({ cwd: '/r', kind: 'chat', harness: 'codex', resume: 'r-1' }, '/bin/zsh')
  assert.deepEqual([c.file, ...c.args], ['codex', 'resume', 'r-1'])
})

test('a new Claude conversation gets the id the app chose; Codex picks its own', () => {
  assert.deepEqual(launchOf({ cwd: '/r', kind: 'phase', harness: 'claude-code', phase: 'spec', args: '012-x', sessionId: 'u-1' }, '/bin/zsh').args, ['--session-id', 'u-1', '/kss-spec 012-x'])
  assert.deepEqual(launchOf({ cwd: '/r', kind: 'chat', harness: 'codex', sessionId: 'u-1' }, '/bin/zsh').args, [])
})

test('the grill side chat: read-only in both CLIs, never bypass, with its briefing', () => {
  assert.deepEqual(launchOf({ cwd: '/r', kind: 'chat', harness: 'claude-code', readonly: true, bypass: true, prompt: 'hi', title: 'Grill · ask' }, '/bin/zsh'), { file: 'claude', args: ['--permission-mode', 'plan', 'hi'], title: 'Grill · ask' })
  assert.deepEqual(launchOf({ cwd: '/r', kind: 'chat', harness: 'codex', readonly: true, prompt: 'hi' }, '/bin/zsh').args, ['--sandbox', 'read-only', '--ask-for-approval', 'never', 'hi'])
})

test('the app starts the grill in app mode, once', () => {
  assert.equal(appArgs('grill', '061-x'), '061-x --app')
  assert.equal(appArgs('grill', '061-x --app'), '061-x --app')
  assert.equal(appArgs('spec', '061-x'), '061-x')
  assert.deepEqual(launchOf({ cwd: '/r', kind: 'phase', harness: 'codex', phase: 'grill', args: '061-x' }, '/bin/zsh').args, ['$kss-grill 061-x --app'])
})

test('saved tabs: add, name the conversation, forget one, forget a session', () => {
  let s = withTab(withTab({}, tab('k1')), tab('k2', '/s/b'))
  s = withConversation(s, 'k1', 'c-1')
  assert.equal(s['/s/a']![0]!.conversation, 'c-1')
  assert.deepEqual(Object.keys(withoutTab(s, 'k2')), ['/s/a'])
  assert.deepEqual(Object.keys(withoutSession(s, '/s/a')), ['/s/b'])
  const dir = mkdtempSync(join(tmpdir(), 'tabs-'))
  saveTabs(join(dir, 'x/tabs.json'), s)
  assert.deepEqual(loadTabs(join(dir, 'x/tabs.json')), s)
  assert.deepEqual(loadTabs(join(dir, 'missing.json')), {})
})

test('a Claude conversation is resumable once its transcript exists', () => {
  const home = mkdtempSync(join(tmpdir(), 'home-'))
  assert.equal(claudeConversationExists('/s/a.b', 'u-1', home), false)
  mkdirSync(join(home, '.claude/projects/-s-a-b'), { recursive: true })
  writeFileSync(join(home, '.claude/projects/-s-a-b/u-1.jsonl'), '{}\n')
  const prev = process.env.CLAUDE_CONFIG_DIR
  delete process.env.CLAUDE_CONFIG_DIR
  assert.equal(claudeConversationExists('/s/a.b', 'u-1', home), true)
  if (prev !== undefined) process.env.CLAUDE_CONFIG_DIR = prev
})

test('the Codex conversation a terminal started: same cwd, after it, not claimed', () => {
  const codex = mkdtempSync(join(tmpdir(), 'codex-'))
  const now = new Date()
  const day = join(codex, 'sessions', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'))
  mkdirSync(day, { recursive: true })
  const meta = (id: string, cwd: string, at: Date) => JSON.stringify({ type: 'session_meta', payload: { id, cwd, timestamp: at.toISOString() } }) + '\n'
  const since = now.getTime()
  writeFileSync(join(day, 'rollout-a.jsonl'), meta('old', '/s/a', new Date(since - 60_000)))
  writeFileSync(join(day, 'rollout-b.jsonl'), meta('other-cwd', '/s/b', new Date(since + 1000)))
  writeFileSync(join(day, 'rollout-c.jsonl'), meta('mine', '/s/a', new Date(since + 2000)))
  writeFileSync(join(day, 'rollout-d.jsonl'), meta('taken', '/s/a', new Date(since + 3000)))
  assert.equal(findCodexConversation('/s/a', since, new Set(['taken']), codex), 'mine')
  assert.equal(findCodexConversation('/s/c', since, new Set(), codex), null)
})

test('a finished phase reads as done, and the phase Next names as waiting', () => {
  const phases = [{ name: 'clarify', mark: 'done' }, { name: 'investigate', mark: 'current' }, { name: 'grill', mark: 'todo' }] as const
  const b = { phases: [...phases], isClosed: false, isPhaseFinished: true, nextPhase: 'grill' }
  assert.deepEqual(marks(b).map(p => p.mark), ['done', 'done', 'next'])
  assert.deepEqual(marks({ ...b, isPhaseFinished: false }).map(p => p.mark), ['done', 'current', 'todo'])
})
