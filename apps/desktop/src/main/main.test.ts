import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { launchOf, optionalOf, parseNext, phasePrompt } from '../shared/commands.ts'
import { sessionBoard } from './board.ts'
import { parseEnv0, withoutSessionMarkers } from './env.ts'
import { parseWorktrees } from './git.ts'
import { inspectTicket, parseTicket, section } from './inspector.ts'
import { configField, createSession, detectProject, featureOfBranch, isTicketWorktree, projectWorktrees, removeSession, sessionSlug } from './project.ts'
import { claudeSlug, locateTranscripts, parseClaude, parseCodex, readActivity } from './transcripts.ts'

const sh = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })

test('phase prompts use each harness prefix', () => {
  assert.equal(phasePrompt('claude-code', 'spec', '012-x'), '/kss-spec 012-x')
  assert.equal(phasePrompt('codex', 'spec', '012-x'), '$kss-spec 012-x')
  assert.equal(phasePrompt('claude-code', 'init', ''), '/kss-init')
})

test('launches: shell, chat and phase', () => {
  assert.deepEqual(launchOf({ cwd: '/r', kind: 'shell' }, '/bin/zsh'), { file: '/bin/zsh', args: ['-l'], title: 'Terminal' })
  assert.deepEqual(launchOf({ cwd: '/r', kind: 'chat', harness: 'codex' }, '/bin/zsh'), { file: 'codex', args: [], title: 'Codex chat' })
  assert.deepEqual(launchOf({ cwd: '/r', kind: 'phase', harness: 'claude-code', phase: 'clarify', args: 'add csv export' }, '/bin/zsh').args, ['/kss-clarify add csv export --app'])
  assert.throws(() => launchOf({ cwd: '/r', kind: 'phase' }, '/bin/zsh'))
})

test('bypass: each CLI gets its own flag before the prompt; shells and qa never do', () => {
  assert.deepEqual(launchOf({ cwd: '/r', kind: 'chat', harness: 'claude-code', bypass: true }, '/bin/zsh').args, ['--dangerously-skip-permissions'])
  assert.deepEqual(launchOf({ cwd: '/r', kind: 'phase', harness: 'codex', phase: 'spec', args: '012-x', bypass: true }, '/bin/zsh').args, ['--dangerously-bypass-approvals-and-sandbox', '$kss-spec 012-x --app'])
  assert.deepEqual(launchOf({ cwd: '/r', kind: 'phase', harness: 'claude-code', phase: 'spec', args: '012-x', bypass: false }, '/bin/zsh').args, ['/kss-spec 012-x --app'])
  assert.deepEqual(launchOf({ cwd: '/r', kind: 'shell', bypass: true }, '/bin/zsh').args, ['-l'])
  assert.ok(!launchOf({ cwd: '/r', kind: 'qa', qa: { step: 'up', feature: '012-x' }, bypass: true }, '/bin/zsh').args.some(a => a.startsWith('--dangerously')))
})

test('Next lines: either prefix, the optional-first advice split off', () => {
  assert.deepEqual(parseNext('/kss-tickets 048-x'), { phase: 'tickets', args: '048-x' })
  assert.deepEqual(parseNext('$kss-plan 048-x'), { phase: 'plan', args: '048-x' })
  assert.deepEqual(parseNext('/kss:kss-plan 048-x'), { phase: 'plan', args: '048-x' })
  assert.deepEqual(parseNext('/kss-review 048-x (optional first: /kss-qa 048-x)'), { phase: 'review', args: '048-x' })
  assert.deepEqual(optionalOf('/kss-review 048-x (optional first: /kss-qa 048-x)'), { phase: 'qa', args: '048-x' })
  assert.equal(parseNext('nothing on track S — docs are optional.'), null)
  assert.equal(parseNext(null), null)
})

test('worktree porcelain', () => {
  const w = parseWorktrees('worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /r.kss-sessions/x\nHEAD def\ndetached\n')
  assert.deepEqual(w.map(x => [x.path, x.branch, x.isDetached]), [['/r', 'main', false], ['/r.kss-sessions/x', null, true]])
})

test('features from branches; ticket branches are not features', () => {
  assert.equal(featureOfBranch('012-batch-cutoff', ''), '012-batch-cutoff')
  assert.equal(featureOfBranch('feat/012-batch-cutoff', 'feat/'), '012-batch-cutoff')
  assert.equal(featureOfBranch('012-batch-cutoff.03-ticket', ''), null)
  assert.equal(featureOfBranch('main', ''), null)
  assert.equal(featureOfBranch(null, ''), null)
  assert.ok(isTicketWorktree('/r.kss-sessions/x/.kss/worktrees/012-x/03'))
})

test('session slugs: short, ascii, unique', () => {
  assert.equal(sessionSlug('Exportar relatório em CSV para o financeiro', new Set()), 'exportar-relatorio-em-csv-para')
  assert.equal(sessionSlug('fix login', new Set(['fix-login'])), 'fix-login-2')
  assert.equal(sessionSlug('!!!', new Set()), 'session')
})

test('config fields', () => {
  const t = 'features_root: docs/features\nbase_branch: develop   # the trunk\nbranch_prefix: ""\n'
  assert.equal(configField(t, 'base_branch'), 'develop')
  assert.equal(configField(t, 'branch_prefix'), '')
  assert.equal(configField(t, 'missing'), null)
})

test('login env is NUL-separated', () => {
  assert.deepEqual(parseEnv0('PATH=/a:/b\0X=1=2\0'), { PATH: '/a:/b', X: '1=2' })
})

const TICKET = `# 03 · CSV writer

**Layer:** api · **Blocked by:** 01 · **Tier:** T2 · **Est.:** 30 turns

## Goal
Write the CSV.
<!-- comment -->

## Requirements covered
- **FR-02** · export

## Files
- **Write:** api/csv.ts

## Tests
- **Spec file:** api/csv.test.ts
`

test('ticket sections', () => {
  assert.equal(section(TICKET, 'Goal'), 'Write the CSV.')
  const t = parseTicket(TICKET, '/f')
  assert.equal(t.title, '03 · CSV writer')
  assert.match(t.header!, /Tier:\*\* T2/)
  assert.equal(t.files, '- **Write:** api/csv.ts')
  assert.equal(parseTicket(null, null).goal, null)
})

const claudeLines = [
  { type: 'user', timestamp: '2026-10-13T10:00:00Z', message: { role: 'user', content: 'Ticket 03 · worktree /s/.kss/worktrees/012-x/03' } },
  { type: 'assistant', timestamp: '2026-10-13T10:00:05Z', message: { id: 'm1', role: 'assistant', model: 'claude-sonnet-5-5', usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 }, content: [{ type: 'text', text: 'Writing the test first.' }, { type: 'tool_use', name: 'Edit', input: { file_path: '/s/api/csv.test.ts' } }] } },
  { type: 'assistant', timestamp: '2026-10-13T10:00:06Z', message: { id: 'm1', role: 'assistant', usage: { input_tokens: 10, output_tokens: 5 }, content: [] } },
  { type: 'user', timestamp: '2026-10-13T10:00:07Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
].map(o => JSON.stringify(o)).join('\n')

test('claude transcript → activity, duplicate responses counted once', () => {
  const a = parseClaude(claudeLines + '\nnot json\n')
  assert.equal(a.turns, 1)
  assert.equal(a.tokens, 105)
  assert.equal(a.model, 'claude-sonnet-5-5')
  assert.deepEqual(a.entries.map(e => [e.kind, e.text]), [
    ['prompt', 'Ticket 03 · worktree /s/.kss/worktrees/012-x/03'],
    ['text', 'Writing the test first.'],
    ['tool', 'Edit api/csv.test.ts'],
  ])
})

test('codex rollout → activity', () => {
  const text = [
    { timestamp: 't0', type: 'session_meta', payload: { cwd: '/s/.kss/worktrees/012-x/04' } },
    { timestamp: 't1', type: 'turn_context', payload: { model: 'gpt-5.5' } },
    { timestamp: 't1', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>…' }] } },
    { timestamp: 't2', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Ticket 04 brief' }] } },
    { timestamp: 't3', type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['git', 'status'] }) } },
    { timestamp: 't4', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] } },
  ].map(o => JSON.stringify(o)).join('\n')
  const a = parseCodex(text)
  assert.equal(a.model, 'gpt-5.5')
  assert.deepEqual(a.entries.map(e => [e.kind, e.text]), [['prompt', 'Ticket 04 brief'], ['tool', '$ git status'], ['text', 'Done.']])
})

test('transcripts are found by worktree: local subagent, foreign claude -p, codex rollout', () => {
  const home = mkdtempSync(join(tmpdir(), 'kss-home-'))
  const session = '/s'
  const wt = '/s/.kss/worktrees/012-x/03'
  const sub = join(home, '.claude/projects', claudeSlug(session), 'sid/subagents')
  mkdirSync(sub, { recursive: true })
  writeFileSync(join(sub, 'agent-a.jsonl'), claudeLines)
  writeFileSync(join(sub, 'agent-other.jsonl'), claudeLines.replace('/03', '/05'))
  const foreign = join(home, '.claude/projects', claudeSlug(wt))
  mkdirSync(foreign, { recursive: true })
  writeFileSync(join(foreign, 'x.jsonl'), claudeLines)
  const d = new Date()
  const day = join(home, '.codex/sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
  mkdirSync(day, { recursive: true })
  writeFileSync(join(day, 'rollout-1.jsonl'), JSON.stringify({ type: 'session_meta', payload: { cwd: wt } }) + '\n')
  writeFileSync(join(day, 'rollout-2.jsonl'), JSON.stringify({ type: 'session_meta', payload: { cwd: '/elsewhere' } }) + '\n')
  const old = join(sub, 'agent-old.jsonl')
  writeFileSync(old, claudeLines)
  utimesSync(old, new Date(2020, 0, 1), new Date(2020, 0, 1))

  const found = locateTranscripts({ session, worktree: wt, since: Date.now() - 3600_000, home, codexHome: join(home, '.codex') }).map(p => p.slice(home.length))
  assert.deepEqual(found.sort(), [
    `/.claude/projects/${claudeSlug(session)}/sid/subagents/agent-a.jsonl`,
    `/.claude/projects/${claudeSlug(wt)}/x.jsonl`,
    `/.codex/sessions/${day.slice(home.length + '/.codex/sessions/'.length)}/rollout-1.jsonl`,
  ].sort())
  assert.equal(readActivity(null).entries.length, 0)
})

test('a session is a worktree with its own board; tickets are inspected in their worktree', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'kss-proj-')))
  const root = join(base, 'app')
  mkdirSync(join(root, '.kss'), { recursive: true })
  sh(base, 'init', '-q', '-b', 'main', root)
  sh(root, 'config', 'user.email', 't@t')
  sh(root, 'config', 'user.name', 't')
  writeFileSync(join(root, '.kss/config.md'), 'features_root: docs/features\nbase_branch: main\nbranch_prefix: ""\n')
  writeFileSync(join(root, '.gitignore'), '.kss/current\n.kss/worktrees/\n.kss/config.local.json\n.env\n')
  sh(root, 'add', '.')
  sh(root, 'commit', '-qm', 'init')
  writeFileSync(join(root, '.kss/config.local.json'), '{}')
  writeFileSync(join(root, '.env'), 'A=1')

  const project = await detectProject(root, { claude: null, codex: null })
  assert.equal(project.hasKss, true)
  assert.equal(project.sessionsDir, join(base, 'app.kss-sessions'))

  const path = await createSession(project, 'CSV export')
  assert.equal(path, join(base, 'app.kss-sessions/csv-export'))
  assert.ok(existsSync(join(path, '.kss/config.local.json')) && existsSync(join(path, '.env')))
  assert.equal(sessionBoard(path, null).board, null)

  // What kss-clarify and kss-execute would have written in the session.
  sh(path, 'checkout', '-qb', '012-csv-export')
  const fdir = join(path, 'docs/features/012-csv-export')
  mkdirSync(join(fdir, '05-tickets'), { recursive: true })
  writeFileSync(join(fdir, 'README.md'), '**State:** execute · **Size:** M · **Track:** clarify → …\n**Next:** `/kss-execute 012-csv-export`\n')
  writeFileSync(join(fdir, '05-tickets/03-csv-writer.md'), TICKET)
  writeFileSync(join(fdir, '05-tickets/graph.md'), '| # | Ticket | Layer | Blocked by | Tier | Est. turns | Worktree |\n|---|---|---|---|---|---|---|\n| 03 | CSV writer | api | — | T2 | 30 | yes |\n')
  writeFileSync(join(fdir, '06-execution.md'), '## Log\n- `2026-10-13T10:00Z` · **03** · spawn · T2\n')
  sh(path, 'add', '.')
  sh(path, 'commit', '-qm', 'docs')
  const wt = join(path, '.kss/worktrees/012-csv-export/03')
  sh(path, 'worktree', 'add', '-q', '-b', '012-csv-export.03-ticket', wt)
  writeFileSync(join(wt, 'csv.ts'), 'export {}\n')
  sh(wt, 'add', '.')
  sh(wt, 'commit', '-qm', 'feat: csv')
  writeFileSync(join(wt, 'wip.ts'), 'x\n')
  writeFileSync(join(path, '.kss/current'), JSON.stringify({ feature: '012-csv-export', phase: 'execute', tickets: { '03': { state: 'running', worktree: wt, turns: 4 } } }))

  const { sessions } = await projectWorktrees(project)
  assert.deepEqual(sessions.map(s => [s.path, s.branch]), [[path, '012-csv-export']])

  const s = sessionBoard(path, featureOfBranch('012-csv-export', ''))
  assert.equal(s.board?.phase, 'execute')
  assert.deepEqual(s.board?.tickets.map(t => [t.id, t.title, t.state, t.est]), [['03', 'CSV writer', 'running', 30]])

  const i = await inspectTicket(path, s.featureDir!, '012-csv-export', '03')
  assert.equal(i.objective.goal, 'Write the CSV.')
  assert.deepEqual(i.objective.log.map(l => l.event), ['spawn'])
  assert.equal(i.changes.base, '012-csv-export')
  assert.deepEqual(i.changes.commits.map(c => c.subject), ['feat: csv'])
  assert.match(i.changes.diff, /\+\+\+ b\/csv\.ts/)
  assert.match(i.changes.uncommitted, /\+\+\+ b\/wip\.ts\n@@ -0,0 \+1 @@\n\+x/)

  await assert.rejects(removeSession(project, root, false))
  sh(path, 'worktree', 'remove', '--force', wt)
  await removeSession(project, path, false)
  assert.equal(existsSync(path), false)
})

test('a session starts from the fetched base branch, not a stale local one', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'kss-base-')))
  const origin = join(base, 'origin')
  mkdirSync(join(origin, '.kss'), { recursive: true })
  sh(base, 'init', '-q', '-b', 'dev', origin)
  sh(origin, 'config', 'user.email', 't@t')
  sh(origin, 'config', 'user.name', 't')
  writeFileSync(join(origin, '.kss/config.md'), 'features_root: docs/features\nbase_branch: dev\n')
  sh(origin, 'add', '.')
  sh(origin, 'commit', '-qm', 'init')
  const root = join(base, 'app')
  sh(base, 'clone', '-q', origin, root)

  // The kss sync lands on the remote after the clone.
  mkdirSync(join(origin, '.kss/references'))
  writeFileSync(join(origin, '.kss/references/app-mode.md'), '# app mode\n')
  sh(origin, 'add', '.')
  sh(origin, 'commit', '-qm', 'chore(kss): sync')

  const project = await detectProject(root, { claude: null, codex: null })
  const path = await createSession(project, 'CSV export')
  assert.ok(existsSync(join(path, '.kss/references/app-mode.md')))
})

test("a parent harness session's markers never reach the CLIs; the user's own settings do", () => {
  const env = withoutSessionMarkers({ PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_MESSAGING_TOKEN: 't', CLAUDE_CODE_USE_BEDROCK: '1', CODEX_SANDBOX: 'seatbelt', CODEX_HOME: '/c' })
  assert.deepEqual(Object.keys(env).sort(), ['CLAUDE_CODE_USE_BEDROCK', 'CODEX_HOME', 'PATH'])
})
