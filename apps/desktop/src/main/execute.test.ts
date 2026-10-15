import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { agentOf, pickTranscript, roleOf, shortstat, waves } from './execute.ts'
import { tidyCommand } from './transcripts.ts'

test('waves: dependency depth, ranges and missing blockers tolerated', () => {
  const t = (id: string, ...blockedBy: string[]) => ({ id, blockedBy })
  assert.deepEqual(waves([t('01'), t('03'), t('02', '01'), t('05', '01', '03'), t('07', '02', '05'), t('14', '01', '02', '03', '05', '07', '99')]), [['01', '03'], ['02', '05'], ['07'], ['14']])
  assert.deepEqual(waves([t('01', '02'), t('02', '01')]).flat().sort(), ['01', '02'], 'a cycle does not loop')
})

test('shortstat → numbers', () => {
  assert.deepEqual(shortstat(' 5 files changed, 440 insertions(+), 13 deletions(-)\n'), { files: 5, added: 440, deleted: 13 })
  assert.deepEqual(shortstat(' 1 file changed, 1 insertion(+)\n'), { files: 1, added: 1, deleted: 0 })
  assert.deepEqual(shortstat(''), { files: 0, added: 0, deleted: 0 })
})

test("roles come from Claude Code's meta file; without one, from the ticket state", () => {
  const dir = mkdtempSync(join(tmpdir(), 'exec-'))
  mkdirSync(dir, { recursive: true })
  const meta = (n: string, o: object) => (writeFileSync(join(dir, `${n}.meta.json`), JSON.stringify(o)), join(dir, `${n}.jsonl`))
  assert.equal(roleOf(meta('a', { agentType: 'kss:kss-reviewer-sonnet-medium', description: 'Review ticket 05' }), 'running'), 'reviewer')
  assert.equal(roleOf(meta('b', { agentType: 'kss:kss-haiku-high', description: 'Integrate ticket 12' }), 'reviewing'), 'integrator')
  assert.equal(roleOf(meta('c', { agentType: 'kss:kss-sonnet-medium', description: 'Ticket 05' }), 'reviewing'), 'executor')
  assert.equal(roleOf(join(dir, 'codex-rollout.jsonl'), 'reviewing'), 'reviewer')
  assert.equal(roleOf(join(dir, 'codex-rollout.jsonl'), 'running'), 'executor')
})

test('an implementing ticket shows its executor even when the reviewer that sent it back is newer', () => {
  const roles: Record<string, 'executor' | 'reviewer'> = { rev: 'reviewer', exe: 'executor' }
  const role = (p: string) => roles[p]!
  assert.deepEqual(pickTranscript(['rev', 'exe'], 'running', role), { path: 'exe', role: 'executor' })
  assert.deepEqual(pickTranscript(['exe', 'rev'], 'reviewing', role), { path: 'rev', role: 'reviewer' })
  assert.deepEqual(pickTranscript(['rev', 'exe'], 'integrated', role), { path: 'rev', role: 'reviewer' })
  assert.equal(pickTranscript([], 'running', role), null)
})

test("the agent's own last words and action; messages to it are not its words", () => {
  const a = agentOf(
    {
      transcript: null, format: 'claude', turns: 4, tokens: 1000, model: 'm', updatedAt: null,
      entries: [
        { at: null, kind: 'prompt', text: 'brief' },
        { at: null, kind: 'text', text: '## Fixing the guard\nmore' },
        { at: null, kind: 'tool', text: '$ npm test' },
        { at: null, kind: 'message', text: 'The coordinator sent a message' },
      ],
    },
    'executor',
  )
  assert.equal(a.saying, 'Fixing the guard')
  assert.equal(a.doing, '$ npm test')
  assert.deepEqual(a.recent.map(e => e.kind), ['text', 'tool', 'message'])
  const fenced = agentOf({ transcript: null, format: 'claude', turns: 1, tokens: 1, model: null, updatedAt: null, entries: [{ at: null, kind: 'text', text: 'Running the suite.' }, { at: null, kind: 'text', text: '```\n|---|' }] }, 'executor')
  assert.equal(fenced.saying, 'Running the suite.')
})

test('commands lose the cd/variable preamble and the worktree path', () => {
  assert.equal(tidyCommand('cd /w/repo.kss-sessions/s/.kss/worktrees/061-x/05 && W=/w/x && npx jest src/a.spec.ts\nsecond line'), '$ npx jest src/a.spec.ts')
  assert.equal(tidyCommand('cat "/w/r/.kss/worktrees/061-x/05/src/a.ts"'), '$ cat ./src/a.ts')
})

test('the graph is read from its own table only; a projection table with ticket rows does not overwrite it', async () => {
  const { parseGraph } = await import('../../../../mods/kss-ui/hooks/kss.ts')
  const g = parseGraph('| # | Ticket | Layer | Blocked by | Tier | Est. turns | Worktree |\n| --- | --- | --- | --- | --- | --- | --- |\n| 05 | Write path | service | 01, 03 | T3 | 45 | yes |\n| 14 | Integration | integration | 01–03 | T4 | 30 | yes |\n\n## Projection\n\n| # | Turns | Model |\n| 05 | 6 | — | x | y | z |\n')
  assert.deepEqual(g['05'], { title: 'Write path', blockedBy: ['01', '03'], tier: 'T3', est: 45 })
  assert.deepEqual(g['14']!.blockedBy, ['01', '02', '03'])
})
