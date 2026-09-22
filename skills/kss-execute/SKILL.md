---
name: kss-execute
description: Run a feature's tickets to done — continuous-frontier scheduling in worktrees, report gates, per-ticket review, escalation, integration and the PR. Run it after kss-tickets, or to resume an interrupted run.
argument-hint: NNN-<slug> [--ticket NN]
disable-model-invocation: true
---

# kss-execute

Drive the ticket graph from `ready` to `integrated` and open the pull request. You are the
**coordinator**: you schedule, you spawn, you read reports and verdicts, you integrate, you log.
You never write the feature's code yourself and you never read a diff — a `reviewer` does
that and hands you a verdict. Everything you need is on disk, so this session stays small enough
to survive the whole run; when it does not, you say so and let the user `/clear`.

## Inputs

Read, in this order:

- `.kss/config.md` — `execution`, `base_branch`, `branch_prefix`, `features_root`.
- `~/.kss/preferences.md` — `conversation_language` for everything printed in this session.
- `<features_root>/NNN-slug/README.md` — the index.
- `<features_root>/NNN-slug/05-tickets/graph.md` — the graph, the tiers, the estimates.
- `<features_root>/NNN-slug/06-execution.md` — the log, to recompute the frontier on resume.
- A ticket file `05-tickets/NN-<slug>.md` **only** at the moment you spawn it, to paste it into
  the brief.

**Do not read:** `03-spec.md`, `04-plan.md`, `01-investigation.md`, `02-decisions.md`, any source
file, any test file, or any diff. If something is missing from the ticket, the ticket is wrong —
send it back to `kss-tickets`; do not fill the gap from the spec or the plan.

## Harness

`node .kss/scripts/harness.mjs` prints the harness this phase is running in and the adapter to read:
`.kss/references/harness-<name>.md`. That file holds how a phase is invoked, how a subagent is
spawned and what each tier maps to (`.kss/references/tiers.md`) — **read it before spawning anything
or printing a command**. If it prints `unknown`, ask which harness this is — one question — then
record it with `node .kss/scripts/harness.mjs --set <name>`.

Nothing this phase writes into the repository may name a harness, a model or an agent type: the next
phase may well run in the other one (DESIGN.md §19).

## Preconditions

0. **Sweep** (DESIGN.md §3.8). Run
   `git status --porcelain -- <features_root> <every path in domain_docs> <docs_root> .kss/config.md`.
   If it lists anything, the previous phase's `SessionEnd` metrics line (written by the hook
   *after* that phase committed) or a forgotten artifact is sitting in the tree: commit it now,
   `git add <those paths> && git commit -m "docs(NNN): <previous phase> artifacts"`, and say so
   in one line. Never stash or discard it, never mix it into this phase's commit.

1. `.kss/config.md` must exist. If it does not, stop with exactly:
   `No .kss/config.md found. Run kss-init first.`
2. The feature folder and `05-tickets/graph.md` must exist. If not, stop with exactly:
   `No ticket graph for NNN-slug. Run kss-tickets NNN-slug first.`
3. The feature branch must be checked out and the worktree clean — after the sweep in step 0 has
   committed the phase artifacts, anything still dirty is the user's own work. If so, stop with
   exactly: `Worktree is dirty. Commit or stash before executing.` Never stash or discard it
   yourself.
4. The README must show the Tickets block as approved. If it does not, stop with exactly:
   `Ticket graph for NNN-slug is not approved. Run kss-tickets NNN-slug and approve it.`
5. Pick the sub-procedure from `execution` in `.kss/config.md`: `multi-agent` → §A,
   `single-session` → §B. Never mix them.
6. `--ticket NN` runs that one ticket only (a re-run or a fix ticket); its blockers must already
   be `integrated`, otherwise stop with `Ticket NN is blocked by <ids>. Run them first.`

## Procedure

### A · Multi-agent

1. **Build the frontier.** Replay `06-execution.md` to get each ticket's state. A ticket marked
   `running` whose worktree no longer exists is reset to `ready`. A ticket is `ready` when every
   blocker is `integrated`, otherwise `blocked`.
2. **Spawn every ready ticket at once, and spawn each one the moment it becomes ready.** This is
   a continuous frontier: never group tickets into waves, never wait for a batch to finish before
   starting what is already unblocked. The instant an integration unblocks a dependant, that
   dependant is spawned in the same turn.
3. **Worktree per ticket**, always at `<repo root>/.kss/worktrees/NNN-slug/NN` — that path is
   fixed, and `kss-init` gitignores `.kss/worktrees/`. Before spawning:

   ```bash
   git worktree add "$(git rev-parse --show-toplevel)/.kss/worktrees/NNN-slug/NN" \
     -b <branch_prefix>NNN-slug/NN-ticket <feature-branch>
   ```

   The branch is exactly `NNN-slug/NN-ticket` (prefixed by `branch_prefix` when set). Record the
   absolute worktree path in `.kss/current` as `tickets.<NN>.worktree`; that is what tells a
   resumed run whether a `running` ticket is still alive.
4. **Spawn.** The tier comes from the graph (`T1`–`T5`); the **harness adapter** says what to spawn
   for it and how — read it before the first spawn of the run, and follow it exactly. A ticket
   written before tiers carries `Model` + `Effort` instead: translate it with the compat table in
   `.kss/references/tiers.md`, and do not rewrite the ticket.
   **Cross-harness (optional, DESIGN.md §21).** Before choosing the local spawn, ask once per
   ticket:

   ```bash
   node .kss/scripts/dispatch.mjs pick '{"feature":"NNN-slug","ticket":"NN","tier":"T2","local":"<harness from harness.mjs>"}'
   ```

   Exit 3: the ticket stays local (cross-harness off, tier excluded, tie, or the foreign CLI is
   missing — the JSON says which); spawn as usual. Exit 0 with `foreign: true`: write the brief —
   the executor preamble from `.kss/references/harness-<harness>.md`, then the ticket file
   verbatim, then `Worktree: <abs path>` — to `<worktree>/../NN.brief.md` (inside
   `.kss/worktrees/NNN-slug/`, which is gitignored), and spawn the **`dispatcher`** role with
   exactly one command:

   ```
   node .kss/scripts/dispatch.mjs run '{"feature":"NNN-slug","ticket":"NN","tier":"T2","harness":"<picked>","worktree":"<abs>","brief_file":"<abs>"}'
   ```

   The dispatcher returns the report block plus one `Dispatch:` line; gate the report exactly as a
   local one (step 5). A failed dispatch (`blocked` with a `Dispatch: … failed` line) is re-spawned
   **locally** at the same tier, once, and logged as `escalate · cross-harness fallback`. Record
   `harness` in the ticket's `.kss/current` entry and in the `spawn` log line
   (`spawn · T2 · codex via dispatcher`). The metrics line for a foreign run is written by the
   script, not by a hook.

   **The brief is the ticket file pasted in verbatim, plus the worktree path, plus whatever
   preamble the adapter says the role needs — nothing else.** No summary of the spec, no extra
   context, no links to the plan. The ticket already forbids running any test, lint, build or tsc
   command; add nothing on the subject.
5. **Gate the report.** A report is accepted only when all three hold:
   1. it follows the ticket's Report-back shape and is ≤1.5k chars;
   2. the commit order is test-before-implementation — two commits, the test one first;
   3. every deviation is justified.
   A failing gate goes **back to the same agent** (same worktree, same agent type) with the list
   of exactly what is missing. Never accept a report by filling the gap yourself.
6. **Review.** Spawn a `reviewer` on every finished ticket. It reads the diff and the report and
   returns either `approve`, or `reject` with numbered findings, each naming file, line, and the
   rule or FR broken. **You read verdicts only, never diffs.**
7. **Escalate on reject.** Decide the class yourself from the findings — or, when the local
   config delegates it (`jev.reasoning.enabled`, decision `escalation_class`, DESIGN.md §20), run
   `node .kss/scripts/jev.mjs classify '{"kind":"escalation_class","state":{"goal":"…","report":"…","findings":[…]}}'`
   and take `choice` when `verdict` is `auto`; on `open`, exit 2 or exit 3, decide yourself. The
   same applies to the report gate in step 5 (`kind: report_gate`, `choice: pass|fail`): a Jev
   `fail` still needs *your* list of what is missing, so a delegated gate saves the judgement, not
   the message. Log `jev: <kind> <choice> <confidence>` in the execution event either way.
   - *Cosmetic* (every finding is formatting or style, none changes behaviour): back to the
     **same agent**, same worktree, context kept, **no tier step**. A model change buys nothing
     for three lines of line width, and spending a tier on it is how a reviewer pass gets burned
     on whitespace.
   - *Execution error* (the design was right, the code is not): re-run the **same ticket, one
     effort level up, in the same worktree**, with the findings pasted in.
   - *Reasoning error* (the approach itself is wrong): **model and effort both go up**.
   - **Never skip two levels.** `T1 → T2 → T3 → T4 → T5`, one step at a time, and never past `T5`.
   - A ticket still unfinished past **80 turns**: stop it, **keep the worktree**, and send it back
     to `kss-tickets` to be re-sliced. The executor never splits a ticket on its own.
8. **Integrate** with a `T1` agent: rebase the ticket branch on the feature branch,
   merge it into the feature branch, remove the worktree (`git worktree remove --force
   .kss/worktrees/NNN-slug/NN`, then `rm -rf` the directory if it is still there, then delete the
   ticket branch), set the state to `integrated`, and
   unblock the dependants — then immediately spawn whatever that unblocked (step 2). A rebase
   conflict goes to `T2` with both tickets' context, and then to the reviewer again.
9. **Record git stats** for each integrated ticket: append a `kind: "git"` line to
   `<features_root>/NNN-slug/metrics.jsonl` with `git: { files, added, deleted, commits }` from
   `git diff --shortstat` and `git rev-list --count` on the merged range.
10. **Finish.** When every ticket is `integrated`, **you run the whole suite yourself, exactly
    once** — no agent runs tests at any other moment (60 subagents once ran 250 test rounds in a
    single feature and saturated the machine). The run is **the project's own full-suite
    command** — the one `standards` or the package manifest names — plus its lint, build and
    type-check targets, each once. (In an Nx/npm monorepo that is `npm run affected:test` with
    `--base=origin/<base_branch>` when that ref is available, else `npm test`, plus
    `npx nx affected -t lint build`.) On failures: map each failing spec to the ticket that
    owns the file (its Files section) and send the failure list back to that ticket's executor —
    same worktree if it was kept, otherwise a fresh worktree off the feature branch — with the
    failing output pasted in. The executor fixes it **without running anything**; re-integrate,
    then run the suite **once more**. **Cap: two full runs per feature**; a third failure stops
    the run with a message to the user. Then commit
    `06-execution.md`, `metrics.jsonl`, the updated README and any other phase artifact on the
    feature branch (`docs(NNN): execute`), run `git worktree prune` and remove anything left under
    `.kss/worktrees/NNN-slug/`, and verify `git status --porcelain` is empty except `.kss/current`;
    if it is not, stop with `Uncommitted feature artifacts: <paths>. Commit them before opening the
    PR.` The PR must carry every artifact of the feature. Then open a PR
    against `base_branch` with the feature `README.md` as the body
    (`gh pr create --base <base_branch> --body-file <features_root>/NNN-slug/README.md`).
    **Never merge — that is a human decision.**

### B · Single-session

1. Execute the tickets **in the order** given by the Single-session section of `graph.md`. No
   worktrees, no graph frontier, no per-ticket model; commits land on the feature branch.
2. Before a ticket whose header says `/clear before: yes`, **stop** and print exactly:
   `Next ticket NN needs a fresh context. Safe to /clear, then run kss-execute NNN-slug --ticket NN.`
   Do not start that ticket in the current session.
3. The **same three gates apply, self-applied**, to your own work: report shape, commit order
   (test first), justified deviations. You write the specs and do not run them; the suite runs
   once at the end, as in §A.10. Write the report into `06-execution.md` exactly as an agent
   would.
4. Run a `reviewer` subagent per ticket where the harness can spawn one; where it cannot, write
   the reviewer's checklist and your answers into the log instead.
5. Finish as in §A.10.

### Coordinator context

When your own context passes ~150k, print exactly:

> Coordinator context at Xk. State is on disk. Safe to /clear and run
> `kss-execute NNN-slug` to resume.

Resuming recomputes the frontier from the log; a ticket marked `running` with no live worktree is
reset to `ready`.

## Outputs

- **The progress board, printed on every event** — spawn, report, verdict, integrate, escalate:

  ```
  kss · NNN-slug · execute · <harness>
  ███████░░░  n/N integrated · x% of estimated turns
  # | Ticket | State | Tier | Turns used/est | Since
  Critical path: …
  Elapsed: …    Tokens: …
  Last: <event>
  ```

  The states are exactly: `blocked`, `ready`, `running`, `reviewing`, `rejected`, `integrated`.

- `<features_root>/NNN-slug/06-execution.md` — append-only, from `.kss/templates/06-execution.md`. The board's last
  render, then one timestamped log entry per event, in this exact shape:

  ```
  - `{{ts}}` · **{{NN}}** · {{spawn|report|verdict|integrate|escalate}} · {{detail}}
  ```

  plus the **Git per integrated ticket** table (`# | Commits | Files | + | −`) and the **Finish**
  block (the coordinator's full-suite result and which run it was, and the PR url marked
  **not merged**).

- The README **Execution** block, ≤10 lines: tickets integrated `n/N`, the critical path, the
  escalations, the full-suite result, the PR url, and `not merged`. Update the Cost table with
  `node .kss/scripts/render-cost.mjs <features_root>/NNN-slug`.

- `.kss/current`, **on every event**, via `node .kss/scripts/current.mjs set '<json>'` (it deep-
  merges), in the DESIGN.md §3.3 schema:

  ```json
  {"feature":"NNN-slug","phase":"execute","ticket":"04",
   "harness":"<from harness.mjs>",
   "tickets":{"04":{"state":"running","tier":"T5","started_at":"ISO-8601",
                    "turns":31,"est_turns":45,
                    "worktree":"/abs/path/.kss/worktrees/NNN-slug/04"}},
   "execution":{"integrated":3,"total":5,"critical_path":"01→03→05","last":"<event>"}}
  ```

  - `tickets` is a **map keyed by the ticket number**, never an array — that is what lets one
    ticket be updated on its own, e.g.
    `node .kss/scripts/current.mjs set '{"tickets":{"04":{"state":"integrated"}}}'`.
  - The per-ticket fields are exactly `state`, `tier`, `started_at`, `turns`, `est_turns`,
    `worktree`, and `harness` when the ticket was dispatched cross-harness. `state` is one of `blocked`, `ready`, `running`, `reviewing`, `rejected`,
    `integrated`.
  - The run's roll-up — `integrated`, `total`, `critical_path`, `last` — lives in the top-level
    **`execution`** key. It is not part of `session`: the `Stop` hook owns `session`, and a writer
    that puts run state there loses it.
  - `ticket` is the ticket the metrics hooks attribute a subagent's cost to; set it when you spawn
    and clear it (`"ticket":null`) when nothing is running.
  - Add `"review":null` while executing; `kss-review` owns that field later.

## Summary

**Commit before printing** (DESIGN.md §3.8): every artifact this phase wrote goes on the feature
branch now — `git add <features_root>/NNN-slug <domain_docs paths touched> <docs_root paths touched>
.kss/config.md && git commit -m "docs(NNN): execute"`. Then
`git status --porcelain -- <those paths>` must be empty; if it is not, stop with
`Uncommitted feature artifacts: <paths>` instead of printing the summary. `.kss/current` is
gitignored and never part of this.

Print exactly:

```
Execute done · NNN-slug
Tickets: <n>/<N> integrated · escalations: <n> · rejects: <n>
Full suite: <command — result> (coordinator, run N of ≤2)
PR: <url> → <base_branch> — not merged
Cost: <line rendered from metrics.jsonl>
Safe to /clear.
Next: <output of node .kss/scripts/next.mjs <features_root>/NNN-slug --after execute>
```

The `Cost:` line is rendered from `<features_root>/NNN-slug/metrics.jsonl`; print `Cost: n/a`
when the file does not exist.

The `Next:` line is **never written by hand**: it is the output of
`node .kss/scripts/next.mjs <features_root>/NNN-slug --after execute`, which knows the track of the
feature's size (DESIGN.md §3.9). Copy it verbatim into the summary and into the README header. On M and L it is `kss-review`; an S track ends here and the line lists
review and docs as optional.

## Rules

- Continuous frontier, never waves: a ticket is spawned the moment its blockers are `integrated`.
- One worktree per ticket at `.kss/worktrees/NNN-slug/NN`, branch `NNN-slug/NN-ticket` off the
  feature branch.
- `.kss/current` follows DESIGN.md §3.3: `tickets` is a map keyed by `NN`, and the run roll-up is
  the top-level `execution` key — never `session`, and never an array of tickets.
- The brief is the ticket file pasted in plus the worktree path — nothing else.
- The tier comes from the graph and the adapter turns it into a spawn; the coordinator never
  writes a model name into an artifact.
- A cross-harness ticket goes through `dispatch.mjs pick` then the `dispatcher` role; it is gated
  and reviewed like any other, and a failed dispatch falls back to a local spawn once.
- All three report gates hold, or the report goes back to the same agent with the missing list.
- Every finished ticket is reviewed by a `reviewer`; the coordinator reads verdicts, never diffs.
- Escalation: execution error → one tier up in the same worktree with the findings; reasoning
  error → up to two; never more, never past `T5`.
- Past 80 turns a ticket stops, keeps its worktree, and goes back to `kss-tickets`.
- Integration is a `T1` job; conflicts go to `T2` and then the reviewer.
- **No agent runs tests, lint, build or tsc — ever.** Executors write the specs and commit them
  first; the coordinator runs the suite itself, once, after every ticket is `integrated`, and at
  most once more after the fixes. A third failing run stops and goes to the user.
- Never read `03-spec.md` or `04-plan.md`, and never write the feature's code yourself.
- Never merge the PR.
- The board is printed on every event; `06-execution.md` is append-only — never rewrite an entry.
- Every phase artifact (`<features_root>/NNN-slug/`, ADRs, glossary edits, `.kss/config.md`) is
  committed on the feature branch before the PR is opened; nothing is left behind in the worktree.
- Terminal output follows `conversation_language` from `~/.kss/preferences.md` (absent: the user's
  language). Document content follows `docs_language` from `.kss/config.md` (absent: the
  conversation's language). File names, headings, field names and identifiers stay English.
