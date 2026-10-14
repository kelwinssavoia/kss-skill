// The ticket worktree command kss-execute documents must work next to the feature branch.
// Measured 2026-10-13: `-b NNN-slug/NN-ticket` fails with "cannot lock ref" whenever the branch
// `NNN-slug` exists — which it always does, since kss-clarify creates it (DESIGN.md §14.1).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The `git worktree add … -b <branch> <feature-branch>` block of kss-execute, as written. */
function documentedCommand() {
  const skill = readFileSync(join(ROOT, 'skills/kss-execute/SKILL.md'), 'utf8')
  const m = /git worktree add "\$\(git rev-parse --show-toplevel\)\/([^"]+)" \\\s*\n\s*-b (\S+) (\S+)/.exec(skill)
  assert.ok(m, 'kss-execute documents the ticket worktree command')
  return { path: m[1], branch: m[2], base: m[3] }
}

const fill = (s, prefix) =>
  s.replace('<branch_prefix>', prefix).replaceAll('NNN-slug', '012-batch-cutoff').replaceAll('NN', '03').replace('<feature-branch>', `${prefix}012-batch-cutoff`)

for (const prefix of ['', 'feat/']) {
  test(`the documented ticket branch coexists with the feature branch (prefix "${prefix}")`, () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'kss-tb-')))
    const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    git('init', '-q', '-b', 'main')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
    git('checkout', '-qb', `${prefix}012-batch-cutoff`)

    const { path, branch, base } = documentedCommand()
    git('worktree', 'add', '-q', join(repo, fill(path, prefix)), '-b', fill(branch, prefix), fill(base, prefix))

    const branches = git('branch', '--format=%(refname:short)').split('\n').filter(Boolean).sort()
    assert.deepEqual(branches, [`${prefix}012-batch-cutoff`, `${prefix}012-batch-cutoff.03-ticket`, 'main'].sort())
  })
}
