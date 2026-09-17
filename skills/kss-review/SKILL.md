---
name: kss-review
description: Work a feature's PR review round — collect comments and CI findings, triage them, fix, dispute, answer or defer, reply on the threads; optionally watch the PR and run rounds automatically. Run it after kss-execute has opened the PR.
argument-hint: NNN-<slug> [--watch]
disable-model-invocation: true
---

# kss-review

Turn a pull-request review into resolved threads. You collect every finding since the cursor,
give each one an ID, triage it in one table, and then act: a fix becomes a real ticket executed
through `kss-execute` with all its gates, a dispute becomes an approved reply, a question is
answered from the decisions, a deferral becomes a `DF-`. You reply on the threads and resolve
only what you actually fixed or answered. You never merge — that is the human's call.

## Inputs

Read, in this order:

- `.kss/config.md` — `review_autopilot`, `base_branch`, `features_root`, `execution`.
- `~/.kss/preferences.md` — `conversation_language` for everything printed in this session.
- `<features_root>/NNN-slug/README.md` — the index and the PR url.
- `<features_root>/NNN-slug/06-execution.md` and `05-tickets/graph.md` — which ticket owns which
  file, and the last ticket number.
- `<features_root>/NNN-slug/07-review.md` — previous rounds, if any.
- The PR threads and CI via `gh` (`gh pr view --json`, `gh api` for review comments,
  `gh pr checks`).
- `.kss/current` — the cursor: the last comment timestamp and the last CI conclusion handled.

**Do not read:** source files or diffs yourself — an `explorer` maps findings to tickets and
FRs. Read `03-spec.md`/`04-plan.md` only to quote a decision in a dispute, never to plan a fix.

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
2. The feature must have an open PR. If it does not, stop with exactly:
   `No PR for NNN-slug. Run kss-execute NNN-slug to open one.`
3. `gh` must be authenticated. If it is not, stop with exactly:
   `gh is not authenticated. Run gh auth login, then retry.`
4. If the PR is already merged or closed, stop with exactly:
   `PR <url> is <merged|closed>. Nothing to review.`

## Procedure

1. **Collect.** From the cursor in `.kss/current`, gather every new review comment, review body,
   and CI conclusion — **CI failures are findings too**. Number them `RV-NN`, continuing from the
   last round, each with file, line, author and text. Nothing new → print
   `No new findings since <cursor>.` and go to the summary (or re-arm the watcher).
2. **Map.** Spawn one `explorer` (read-only) to map each finding back to the ticket and the
   FRs it came from. Return ≤1.5k chars.
3. **Triage.** Print the table and take **one turn** to confirm it:

   ```
   | ID | Where | From | Class | Proposal |
   ```

   | Class | Handling |
   | --- | --- |
   | `fix` | becomes a fix ticket, numbered after the last one, grouped by file, executed via `kss-execute` with all the gates |
   | `dispute` | a reply citing the decision or rule; the text is approved by the user; no code |
   | `question` | answered from the decisions — or, when it is not decided, opened for a mini grill |
   | `defer` | a `DF-`, replied to as out of scope, thread left open |

4. **A finding that contradicts a decision is never a silent fix.** Either dispute it citing the
   `D-`/`AD-`, or have the user override it via `kss-review-decisions` and *then* fix it, with
   the spec marked for revision in the README.
5. **Fix.** Write the fix tickets into `05-tickets/`, numbered after the last existing ticket,
   grouped by file, and run them through `kss-execute NNN-slug --ticket NN`. Every gate applies
   — report shape, commit order (test committed first), reviewer verdict, integration; the tests
   themselves run only in the coordinator's single run after integration.
6. **Reply and resolve.** After integrating, reply on each thread with the resolving commit or
   the approved text. **Resolve only the threads that were fixed or answered**; dispute threads
   stay open until the reviewer agrees, and `defer` threads are left open by design.
7. **Push** only to the **PR branch**, never to `base_branch`.
8. **Record the round** in `07-review.md` and go to the summary.

### `--watch`

1. Watch the PR **the way the harness adapter says** — a background monitor where there is one,
   never a polling subagent — on a `gh` command that reports new comment count, CI conclusions and
   the PR state, every **5 minutes** by default (configurable). Say once, in one line, what that
   costs the session here: a harness with a real monitor frees it, a harness without one holds it.
2. On a change: wake, run one round (steps 1–8), push to the PR branch, reply, and **re-arm**.
3. **Autopilot per `review_autopilot`** (DESIGN.md §15.1). It governs what a round may do
   *without asking*; it never changes the triage itself:
   - `fixes` (the default) — **executed and pushed without asking:** every `fix` that touches no
     contested decision, and every CI failure. **Drafted and held:** the `dispute` and `question`
     replies. **Automatic:** `defer` replies.
   - `all` — everything `fixes` does, **plus** the drafted `dispute` and `question` replies are
     posted to their threads without asking.
   - `none` — the round **stops at the triage table** every time and waits for the user. Nothing
     is executed, pushed or posted.

   **In every mode, a fix that contradicts a `D-` or an `AD-` is held** — `all` does not relax it.
   Such a finding goes back through step 4: dispute it, or have the user override the decision via
   `kss-review-decisions` first. Held items are listed by ID on every wake and wait for the user.
4. It stops when the PR is **merged or closed**, when the user stops it, or after **10 rounds** —
   then it stops and reports. The watcher **dies with the session**; re-running `kss-review
   NNN-slug --watch` resumes from the cursor.
5. The board shows `watching`, and so does the status line where the harness has one.

## Outputs

- `<features_root>/NNN-slug/07-review.md`, from `.kss/templates/07-review.md` — one `## Round N` per round:

  ```
  | ID | Where | From | Class | Resolution | Ticket / Reply |
  ```

  plus the **Finding text** list (`RV-NN — text → ticket NN / FR-NN`), the line
  `**Open after round N:** <ids>`, and the `## Deferred` entries `DF-NN` with owner and date.
- Fix tickets in `<features_root>/NNN-slug/05-tickets/`, numbered after the last one.
- The README **Review** block, ≤10 lines: round number, findings by class, fix tickets, threads
  open, CI state, and `Ready for merge decision`. Refresh the Cost table with
  `node .kss/scripts/render-cost.mjs <features_root>/NNN-slug`.
- `.kss/current`, **on every event** (collect, triage, fix spawned, reply, re-arm), via
  `node .kss/scripts/current.mjs set '<json>'`, in the DESIGN.md §3.3 schema:

  ```json
  {"feature":"NNN-slug","phase":"review",
   "review":{"pr":"<url>","round":2,"state":"watching","watching":"PR #61",
             "open":["RV-04"],"held":["RV-07"],
             "cursor":{"last_comment_at":"ISO-8601","last_ci_at":"ISO-8601"},
             "last_check":"ISO-8601"},
   "tickets":{"NN":{"state":"integrated","tier":"T2","turns":12,
                    "est_turns":15,"started_at":"ISO-8601"}},
   "execution":{"integrated":6,"total":6,"last":"<event>"}}
  ```

  - `cursor` field names are exactly `last_comment_at` and `last_ci_at` — that is what the next
    round reads from.
  - `watching` is the human-readable watch target the board prints (`PR #61`); set it only
    while `--watch` is armed and clear it (`null`) when it stops. `state` is `idle`, `running` or
    `watching`.
  - `tickets` is a **map keyed by the ticket number** (fix tickets included), with the fields
    `state`, `agent_type`, `started_at`, `turns`, `est_turns`, `worktree` — never an array.
  - The run roll-up stays in the top-level **`execution`** key, never in `session` (the `Stop`
    hook owns `session`).

## Summary

**Commit before printing** (DESIGN.md §3.8): every artifact this phase wrote goes on the feature
branch now — `git add <features_root>/NNN-slug <domain_docs paths touched> <docs_root paths touched>
.kss/config.md && git commit -m "docs(NNN): review"`. Then
`git status --porcelain -- <those paths>` must be empty; if it is not, stop with
`Uncommitted feature artifacts: <paths>` instead of printing the summary. `.kss/current` is
gitignored and never part of this.

**Close the run** when nothing is left to do for this feature (Ready for merge decision, or the watch stopped because the PR was merged or closed):
`node .kss/scripts/current.mjs end`. It sets `phase: "done"` so the hooks stop appending to
`metrics.jsonl`, and a harness with a status line hands it back to the previous one. Running any later `kss-` skill on
this feature re-opens it automatically. The main session's own cost for this last phase is not
recorded — that is the price of a clean tree (DESIGN.md §6).

Print exactly:

```
Review done · NNN-slug · round <N>
Findings: <n> — fix <n> · dispute <n> · question <n> · defer <n>
Fix tickets: <ids | none>
Threads: <n> resolved · <n> open
CI: <conclusion>
Cost: <line rendered from metrics.jsonl>
Ready for merge decision. This skill never merges.
Safe to /clear.
Next: <output of node .kss/scripts/next.mjs <features_root>/NNN-slug --after review>
```

The `Next:` line is **never written by hand**: it is the output of
`node .kss/scripts/next.mjs <features_root>/NNN-slug --after review`, which knows the track of the
feature's size (DESIGN.md §3.9). Copy it verbatim into the summary and into the README header. On L it is `kss-docs-tech`; on S and M the track ends here and docs are listed as optional.

Print `Cost: n/a` when `metrics.jsonl` does not exist. While watching, replace the last two lines
with `Watching PR <url> — next check in <n>m.`

## Rules

- The cursor lives in `.kss/current.review.cursor` as `{last_comment_at, last_ci_at}`; a round only
  collects what is newer than it.
- Every finding, CI failures included, becomes an `RV-NN`.
- An explorer maps findings to tickets and FRs — you do not read diffs.
- The triage table is printed and confirmed in exactly one turn.
- A finding contradicting a decision is disputed or overridden, never silently fixed.
- Fix tickets are numbered after the last ticket, grouped by file, executed via `kss-execute`
  with all the gates.
- Resolve only the threads that were fixed or answered; disputes and deferrals stay open.
- Push only to the PR branch, never to `base_branch`.
- `--watch` uses whatever the adapter names, never a polling subagent; it dies with the session and
  resumes from the cursor.
- Autopilot: `fixes` executes uncontested fixes and CI failures and holds the drafted replies;
  `all` also posts those replies; `none` stops at the triage table. **No mode ever ships a fix that
  contradicts a `D-` or an `AD-`**; held items are reported by ID.
- Hard cap of 10 rounds, then stop and report.
- **Never merge.**
- Terminal output follows `conversation_language` from `~/.kss/preferences.md` (absent: the user's
  language). Document content follows `docs_language` from `.kss/config.md` (absent: the
  conversation's language). File names, headings, field names and identifiers stay English.
