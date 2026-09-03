---
name: kss-execute
description: Run a feature's tickets to done — continuous-frontier scheduling in worktrees, report gates, per-ticket review, escalation, integration and the PR. Run it after /kss-tickets, or to resume an interrupted run.
argument-hint: NNN-<slug> [--ticket NN]
disable-model-invocation: true
---

# kss-execute

Drive the ticket graph from `ready` to `integrated` and open the pull request. You are the
**coordinator**: you schedule, you spawn, you read reports and verdicts, you integrate, you log.
You never write the feature's code yourself and you never read a diff — a `kss-reviewer` does
that and hands you a verdict. Everything you need is on disk, so this session stays small enough
to survive the whole run; when it does not, you say so and let the user `/clear`.

## Inputs

Read, in this order:

- `.kss/config.md` — `execution`, `base_branch`, `branch_prefix`, `features_root`, `full_suite`.
- `<features_root>/NNN-slug/README.md` — the index.
- `<features_root>/NNN-slug/05-tickets/graph.md` — the graph, the models, the estimates.
- `<features_root>/NNN-slug/06-execution.md` — the log, to recompute the frontier on resume.
- A ticket file `05-tickets/NN-<slug>.md` **only** at the moment you spawn it, to paste it into
  the brief.

**Do not read:** `03-spec.md`, `04-plan.md`, `01-investigation.md`, `02-decisions.md`, any source
file, any test file, or any diff. If something is missing from the ticket, the ticket is wrong —
send it back to `/kss-tickets`; do not fill the gap from the spec or the plan.

## Preconditions

1. `.kss/config.md` must exist. If it does not, stop with exactly:
   `No .kss/config.md found. Run /kss-init first.`
2. The feature folder and `05-tickets/graph.md` must exist. If not, stop with exactly:
   `No ticket graph for NNN-slug. Run /kss-tickets NNN-slug first.`
3. The feature branch must be checked out and the worktree clean. If it is dirty, stop with
   exactly: `Worktree is dirty. Commit or stash before executing.` The expected way to get clean
   is to commit the phase artifacts on the feature branch (`git add <features_root>/NNN-slug
   <domain_docs> .kss/config.md && git commit -m "docs(NNN): spec, plan and tickets for <slug>"`),
   never to stash or discard them.
4. The README must show the Tickets block as approved. If it does not, stop with exactly:
   `Ticket graph for NNN-slug is not approved. Run /kss-tickets NNN-slug and approve it.`
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
4. **Spawn.** The agent type is Model + Effort from the graph: `kss-sonnet-low`,
   `kss-sonnet-medium`, `kss-sonnet-high`, `kss-opus-medium`, `kss-opus-high`. There is no
   `kss-opus-low`. **The brief is the ticket file pasted in verbatim, plus the worktree path —
   nothing else.** No summary of the spec, no extra context, no links to the plan.
5. **Gate the report.** A report is accepted only when all five hold:
   1. it follows the ticket's Report-back shape and is ≤1.5k chars;
   2. red-run evidence is present;
   3. the commit order is test-before-implementation, or a single commit plus the red log;
   4. the ticket's own tests are green;
   5. every deviation is justified.
   A failing gate goes **back to the same agent** (same worktree, same agent type) with the list
   of exactly what is missing. Never accept a report by filling the gap yourself.
6. **Review.** Spawn `kss-reviewer` on every finished ticket. It reads the diff and the report and
   returns either `approve`, or `reject` with numbered findings, each naming file, line, and the
   rule or FR broken. **You read verdicts only, never diffs.**
7. **Escalate on reject.**
   - *Execution error* (the design was right, the code is not): re-run the **same ticket, one
     effort level up, in the same worktree**, with the findings pasted in.
   - *Reasoning error* (the approach itself is wrong): **model and effort both go up**.
   - **Never skip two levels.** sonnet-low → sonnet-medium → sonnet-high → opus-medium →
     opus-high, one step at a time.
   - A ticket still unfinished past **80 turns**: stop it, **keep the worktree**, and send it back
     to `/kss-tickets` to be re-sliced. The executor never splits a ticket on its own.
8. **Integrate** with a `kss-sonnet-low` agent: rebase the ticket branch on the feature branch,
   merge it into the feature branch, remove the worktree, set the state to `integrated`, and
   unblock the dependants — then immediately spawn whatever that unblocked (step 2). A rebase
   conflict goes to `kss-sonnet-medium` with both tickets' context, and then to the reviewer
   again.
9. **Record git stats** for each integrated ticket: append a `kind: "git"` line to
   `<features_root>/NNN-slug/metrics.jsonl` with `git: { files, added, deleted, commits }` from
   `git diff --shortstat` and `git rev-list --count` on the merged range.
10. **Finish.** When every ticket is `integrated`: if `full_suite: local`, run the full suite
    **once** via a `kss-sonnet-low` agent; if `full_suite: ci`, skip it and say so. Then commit
    `06-execution.md`, `metrics.jsonl`, the updated README and any other phase artifact on the
    feature branch (`docs(NNN): execution log`), and verify `git status --porcelain` is empty
    except `.kss/current`; if it is not, stop with `Uncommitted feature artifacts: <paths>. Commit
    them before opening the PR.` The PR must carry every artifact of the feature. Then open a PR
    against `base_branch` with the feature `README.md` as the body
    (`gh pr create --base <base_branch> --body-file <features_root>/NNN-slug/README.md`).
    **Never merge — that is a human decision.**

### B · Single-session

1. Execute the tickets **in the order** given by the Single-session section of `graph.md`. No
   worktrees, no graph frontier, no per-ticket model; commits land on the feature branch.
2. Before a ticket whose header says `/clear before: yes`, **stop** and print exactly:
   `Next ticket NN needs a fresh context. Safe to /clear, then run /kss-execute NNN-slug --ticket NN.`
   Do not start that ticket in the current session.
3. The **same five gates apply, self-applied**, to your own work: report shape, red-run evidence,
   commit order, green tests, justified deviations. Write the report into `06-execution.md`
   exactly as an agent would.
4. Run a `kss-reviewer` subagent per ticket where the Agent tool exists; where it does not, write
   the reviewer's checklist and your answers into the log instead.
5. Finish as in §A.10.

### Coordinator context

When your own context passes ~150k, print exactly:

> Coordinator context at Xk. State is on disk. Safe to /clear and run
> `/kss-execute NNN-slug` to resume.

Resuming recomputes the frontier from the log; a ticket marked `running` with no live worktree is
reset to `ready`.

## Outputs

- **The progress board, printed on every event** — spawn, report, verdict, integrate, escalate:

  ```
  kss · NNN-slug · execute
  ███████░░░  n/N integrated · x% of estimated turns
  # | Ticket | State | Agent | Turns used/est | Since
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
  block (full suite result or `skipped to CI`, and the PR url marked **not merged**).

- The README **Execution** block, ≤10 lines: tickets integrated `n/N`, the critical path, the
  escalations, the full-suite result, the PR url, and `not merged`. Update the Cost table with
  `node .kss/scripts/render-cost.mjs <features_root>/NNN-slug`.

- `.kss/current`, **on every event**, via `node .kss/scripts/current.mjs set '<json>'` (it deep-
  merges), in the DESIGN.md §3.3 schema:

  ```json
  {"feature":"NNN-slug","phase":"execute","ticket":"04",
   "tickets":{"04":{"state":"running","agent_type":"kss-opus-high","started_at":"ISO-8601",
                    "turns":31,"est_turns":45,
                    "worktree":"/abs/path/.kss/worktrees/NNN-slug/04"}},
   "execution":{"integrated":3,"total":5,"critical_path":"01→03→05","last":"<event>"}}
  ```

  - `tickets` is a **map keyed by the ticket number**, never an array — that is what lets one
    ticket be updated on its own, e.g.
    `node .kss/scripts/current.mjs set '{"tickets":{"04":{"state":"integrated"}}}'`.
  - The per-ticket fields are exactly `state`, `agent_type`, `started_at`, `turns`, `est_turns`,
    `worktree`. `state` is one of `blocked`, `ready`, `running`, `reviewing`, `rejected`,
    `integrated`.
  - The run's roll-up — `integrated`, `total`, `critical_path`, `last` — lives in the top-level
    **`execution`** key. It is not part of `session`: the `Stop` hook owns `session`, and a writer
    that puts run state there loses it.
  - `ticket` is the ticket the metrics hooks attribute a subagent's cost to; set it when you spawn
    and clear it (`"ticket":null`) when nothing is running.
  - Add `"review":null` while executing; `kss-review` owns that field later.

## Summary

Print exactly:

```
Execute done · NNN-slug
Tickets: <n>/<N> integrated · escalations: <n> · rejects: <n>
Full suite: <command — result | skipped to CI>
PR: <url> → <base_branch> — not merged
Cost: <line rendered from metrics.jsonl>
Safe to /clear.
Next: /kss-review NNN-slug
```

The `Cost:` line is rendered from `<features_root>/NNN-slug/metrics.jsonl`; print `Cost: n/a`
when the file does not exist.

`Next` is `/kss-review NNN-slug` on the **M and L** tracks. An **S** track ends at execute
(`clarify → tickets → execute`), so print
`Next: /kss-review NNN-slug (optional on an S track) — or /kss-docs-product NNN-slug`.

## Rules

- Continuous frontier, never waves: a ticket is spawned the moment its blockers are `integrated`.
- One worktree per ticket at `.kss/worktrees/NNN-slug/NN`, branch `NNN-slug/NN-ticket` off the
  feature branch.
- `.kss/current` follows DESIGN.md §3.3: `tickets` is a map keyed by `NN`, and the run roll-up is
  the top-level `execution` key — never `session`, and never an array of tickets.
- The brief is the ticket file pasted in plus the worktree path — nothing else.
- The agent type is Model + Effort from the graph; there is no `kss-opus-low`.
- All five report gates hold, or the report goes back to the same agent with the missing list.
- Every finished ticket is reviewed by `kss-reviewer`; the coordinator reads verdicts, never diffs.
- Escalation: execution error → effort +1 in the same worktree with the findings; reasoning error
  → model and effort up; never skip two levels.
- Past 80 turns a ticket stops, keeps its worktree, and goes back to `/kss-tickets`.
- Integration is a `kss-sonnet-low` job; conflicts go to `kss-sonnet-medium` and then the reviewer.
- Never read `03-spec.md` or `04-plan.md`, and never write the feature's code yourself.
- Never merge the PR.
- The board is printed on every event; `06-execution.md` is append-only — never rewrite an entry.
- Every phase artifact (`<features_root>/NNN-slug/`, ADRs, glossary edits, `.kss/config.md`) is
  committed on the feature branch before the PR is opened; nothing is left behind in the worktree.
- File names, headings and field names are English; the prose inside the documents follows the
  language of the conversation.
