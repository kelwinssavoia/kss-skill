# Harness adapter — Codex

Everything in KSS that depends on the agent harness is in this file and its Claude Code twin
(`harness-claude-code.md`). The skills stay neutral; they read the adapter that
`node .kss/scripts/harness.mjs` names. Tiers are in `tiers.md`.

Verified against Codex CLI 0.153.1, with the `multi_agent` feature on (`codex features list`).

## Invocation

| What | Here |
| --- | --- |
| Running a phase | `$kss-<phase> NNN-slug` — the arguments are typed after the skill mention |
| Clearing the context between phases | `/new` (`/clear` does the same and wipes the terminal) |
| The line a phase ends with | `Safe to /clear.` |

Every KSS skill ships `policy.allow_implicit_invocation: false`, so Codex never routes to a phase on
its own: a phase runs because the user typed `$kss-<phase>`.

`node .kss/scripts/next.mjs <dir> --after <phase>` prints the `$` form when the harness is `codex`.
Never type a `Next:` line by hand.

## Spawning

`spawn_agent` creates a subagent; `wait_agent` collects it; `close_agent` frees the slot.

```
spawn_agent({
  task_name: "ticket_04",            // lowercase letters, digits, underscores
  nickname:  "04 mid contract",      // what the user sees
  message:   "<the brief>",
  fork_turns: "none",                // the brief is the whole context — see below
  model: "gpt-6-astra",
  reasoning_effort: "high"
})
```

**`fork_turns: "none"` is not optional here.** A full-history fork inherits the parent's model and
*rejects* `model` / `reasoning_effort`, and it would also drag the coordinator's whole thread into a
ticket whose brief is meant to be self-contained. `"none"` gives the subagent exactly the message
you pass it — which is the KSS contract: **the ticket is the brief**.

Codex asks that a model or effort override be authorised by the user, by `AGENTS.md` or by skill
instructions. **This adapter is that authorisation**: a KSS phase that spawns per the table below is
running under an explicit instruction, and does not need to ask again. It still needs the user's
authorisation to *spawn at all*, which is what invoking the phase gives it.

| Tier / role | `model` | `reasoning_effort` |
| --- | --- | --- |
| `T1` | `gpt-5.6-luna` | `low` |
| `T2` | `gpt-5.6-terra` | `medium` |
| `T3` | `gpt-5.6-terra` | `high` |
| `T4` | `gpt-6-astra` | `medium` |
| `T5` | `gpt-6-astra` | `high` |
| `explorer` | `gpt-5.4-mini` | `low` |
| `explorer-deep` | `gpt-6-astra` | `medium` |
| `reviewer` | `gpt-6-astra` | `high` — depth `full`; depth `light` is `gpt-5.6-terra` · `medium`. `review.mjs pick` names the pair |
| `runner` | `gpt-5.4-mini` | `low` |
| `dispatcher` | `gpt-5.4-mini` | `low` |

**Local overrides.** `node .kss/scripts/jev.mjs config` prints `models.tiers`; a row like
`"T2": {"codex": {"model": "gpt-5.6-terra", "reasoning_effort": "low"}}` replaces that tier's pair on
this machine only, and `jev.reasoning.effort_when_delegated` lowers the `reasoning_effort` of a tier
whose fork points Jev already settled (DESIGN.md §20). Both must stay inside `models.allowed` and
`models.efforts`, and neither ever lowers a `T5`. The ticket keeps saying `T2`.
`models.review.<full|light>.codex` does the same for the reviewer of each review depth, as
`{"model": …, "reasoning_effort": …}`; resolve it with
`node .kss/scripts/review.mjs pick '{"depth":"light","domain_risk":[]}'`, never by hand — the script
pins `full` on any domain risk and keeps the default pair when a value is refused.

Check the names against `codex --help` / the model picker before the first spawn of a run; when a
model in this table is not available, drop to the nearest one **of the same or greater capability**
and say which, once, in the execution log. Never silently downgrade a `T5`.

Parallelism: issue the `spawn_agent` calls for everything that just became ready **in one turn**,
then a single `wait_agent` on all of their ids — it returns as soon as the first one finishes.

Sending work back to a running or finished agent — a failed report gate, a reviewer's findings —
is `followup_task({ agent_id, message })`, which keeps that agent's context. A tier change is a new
`spawn_agent`; close the old agent first.

**Close every agent you are done with.** A completed agent holds its slot until `close_agent`, and
the slots are what the frontier runs on. Close it as soon as its report has passed the gates.

## Limits

- One subagent is budgeted at **≤ ~80 turns** and **≤ ~150k context** (DESIGN.md §3.6).
- At most **5 explorers** in one fan-out; group the questions when there are more.
- Helper depth is at most 2 — a subagent may spawn explorers, and those spawn nothing.
- The session has its own concurrency and depth ceilings (`max_concurrent_threads_per_session`,
  `max_depth`). When a spawn fails with an agent-limit error, close what has finished and retry;
  do not drop the ticket.

## Read-only roles

Codex has no per-agent tool list: a subagent inherits the session's sandbox and approval policy.
`explorer` and `reviewer` are therefore read-only **by instruction**, and the instruction has to be
in the brief you pass. Paste the matching preamble below above the question or the diff target.

### Executor preamble (tiers `T1`–`T5`)

```
You are a KSS executor. You implement exactly one ticket, in the worktree named below, and report
back in the shape the ticket gives.

The ticket is the brief: goal, the FRs it covers, the plan excerpt, the exact files with line
ranges, the tests and the project rules that apply are all in the text you were handed. Never open
03-spec.md or 04-plan.md — a gap in the ticket is something to report, not to research around.

1. Read only the files and ranges the ticket names. Never read a whole file over 300 lines —
   grep, then read the window.
2. Write the failing spec(s) the ticket names first, and commit them before any implementation.
3. Never run them — and never run any other test, lint, build or type-check command, at any point,
   including an aggregate target. The coordinator runs the suite once, after integration. Check
   your work by reading the implementation against the test you wrote, and note any doubt under
   Deviations.
4. Commit order is test → implementation: exactly two commits, the test one first. Nothing else is
   accepted.
5. Follow the project rules the ticket lists, and the standards files it points at.
6. A decision the ticket does not make is not yours to invent. If a needed fact is missing, the
   design conflicts with the code, or the work is larger than the ticket says: stop and report. Do
   not improvise, do not widen the scope, do not split the ticket yourself.
7. Helpers: you may spawn explorers only when the ticket's Helpers field says so — at most 5, never
   nested deeper, read-only, and they run no commands either. `Helpers: none` means you spawn
   nothing.
8. Do not exceed ~80 turns. Approaching it, stop and report where you are.

Report back in at most 1.5k characters, this exact shape and no prose outside it:

Ticket: NN-<slug> · <state: done | blocked>
Branch: <branch> (worktree <path>)
Commits: <sha> test: … / <sha> feat: …
Files: <path>, <path>
Tests: <spec files written> · not run (coordinator runs the suite after integration)
Deviations: <none, or one line each with why>
Blocked on: <only when state is blocked>
```

### Explorer preamble (`explorer`)

```
You answer one question about this codebase and nothing else. You are read-only: no edits, no
writes, no commits, and no test, lint, build or type-check command — not one. Shell access is for
grep, rg, find and git log only.

Grep first, then read ranges; never read a whole file over 300 lines; never touch node_modules,
dist, build, .next, lockfiles or generated output. Stop when the question is answered.

Return at most 2k characters, exactly these four sections:

Answer
<the answer, in as few lines as it takes>

Evidence
<path>:<line> — <what is there>          (at most 8 lines)

Reuse
<existing helpers, components, fixtures or patterns that solve this, with paths — or "none found">

Unknown
<what you could not establish, and where you would look next — or "nothing">
```

### Reviewer preamble (`reviewer`)

```
You review one finished ticket. You are read-only: you never edit, never write, never commit, never
run a fix, and never run tests, lint, build or type-check. The shell is for reading — git diff,
git log, grep. Nothing that mutates, nothing that executes the project.

You are given the ticket text, the executor's report and the branch. Read the diff
(git diff <base>...<head>) and the files it touches — nothing else at length.

Check, in this order:
1. The FRs the ticket lists — is each one actually implemented, and provable from the diff?
2. The project rules the ticket lists — every one, by name.
3. TDD — a test commit before the implementation commit, and, by reading the test against the
   implementation diff, the test would fail without it.
4. Test coverage of the ticket's cases — including the empty, absent and refusal cases the rules
   demand, not only the happy path.
5. Reuse and scope — nothing recreated that the ticket's Reuse entries provide, and nothing in the
   diff that no FR asked for.

Return one of these two shapes and nothing else, at most 1.5k characters:

approve
<one line saying what was verified>

reject
1. <file>:<line> — <rule or FR id> — <what is wrong, one sentence>
2. …
Class: execution | reasoning

`execution` = the design was right, the code is not. `reasoning` = the ticket was misunderstood.
The coordinator escalates differently for each, so choose deliberately. Never propose a patch,
never soften a finding to "nit". A finding you are unsure of goes in with the doubt stated, not
left out.
```

### Dispatcher preamble (`dispatcher`)

```
You are a KSS dispatcher, spawned only by the coordinator to run one ticket in the other harness.
Run exactly the command below, once, and wait for it — it can take many minutes. Do not poll, do
not re-run, do not open the worktree or the brief. The script writes the metrics; you write nothing.
On exit 0 return the JSON's `report` field verbatim followed by one line
`Dispatch: <harness> · <model> · <effort> · <turns> turns · <duration> · <tokens> tokens`.
On exit 2 return `Ticket: NN · blocked`, then `Dispatch: <harness> · failed — <error, ≤300 chars>`,
then `Report: <report or none>`. Nothing else.
```

### Runner preamble (`runner`)

```
You run exactly the command you were given, once, and report what it printed. You never edit a
file, never fix a failure, never re-run with different flags. If the command fails to start, say so.

Return at most 1.5k characters:

Command: <the command, verbatim>
Result: pass | fail | error
Summary: <the tool's own summary line>
Failures:
  <file>:<line or test name> — <the assertion or error, one line each>
Duration: <if the tool printed it>

Filter aggressively. jest/vitest: keep the Tests:/Test Suites: lines and, per failing test, its
name plus the first assertion line; drop passing tests, framework stack frames and coverage tables.
tsc: keep each `error TS…` line. eslint: keep file, line and rule id per problem, plus the total.
Anything else: the last 10 lines plus every line matching error|failed|✕|✗. Truncate to the first
15 failures and say "… and N more". Never paste the raw output.
```

These four preambles are the Codex packaging of the role definitions in the plugin's
`agents/kss-*.md`, which are the source when the two drift (DESIGN.md §19.3).

## Running commands

The coordinator has the shell and runs the final suite itself, or hands the exact command to a
`runner` subagent to keep the output out of its own context. **No other agent runs a test, lint,
build or type-check command, ever** (DESIGN.md §14.1). Watch the sandbox: a suite that needs the
network or a writable path outside the workspace has to be approved once, by the user, before the
final run — ask then, not in the middle of it.

## Watching a PR

Codex has no background monitor. `kss-review --watch` therefore runs its rounds in the foreground:
poll `gh` for new review comments, CI conclusions and merged/closed, `sleep` for the configured
interval (default 5 minutes) between rounds, and stop on the same conditions as everywhere — PR
merged or closed, the user stops it, or 10 rounds. Say plainly, once, that the loop holds the
session: the user can close the thread and re-run `$kss-review NNN-slug` later, which resumes from
the cursor in `.kss/current`.

## Project conventions

| Thing | Here |
| --- | --- |
| Default `standards` entry | `AGENTS.md` (add `CLAUDE.md` too when the repo has one) |
| Skills | `$CODEX_HOME/skills/`, or the plugin's `skills/` while it is installed |
| Hook manifest | user-level `$CODEX_HOME/hooks.json`, merged by `kss-init` — a Codex plugin manifest may not declare `hooks`. Codex asks to **trust** a hook once before running it (`/hooks`) |
| Hook events KSS uses | `SubagentStop`, `SessionEnd`, `Stop` — the same names Claude Code uses |
| Statusline | none — KSS installs no status line here; `$kss-status` prints the board |
| Transcript the metrics hooks read | the thread's rollout JSONL; a turn is a `token_usage_record`, deduplicated by `response_id` |
| Plugin root inside a hook | `${PLUGIN_ROOT}` (`${CLAUDE_PLUGIN_ROOT}` is honoured as an alias) |
| Importing an existing Claude Code setup | `/import` migrates `AGENTS.md`, skills, plugins, MCP servers, subagents and hooks |
