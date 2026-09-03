---
name: kss-review
description: Work a feature's PR review round — collect comments and CI findings, triage them, fix, dispute, answer or defer, reply on the threads; optionally watch the PR and run rounds automatically. Run it after /kss-execute has opened the PR.
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
- `<features_root>/NNN-slug/README.md` — the index and the PR url.
- `<features_root>/NNN-slug/06-execution.md` and `05-tickets/graph.md` — which ticket owns which
  file, and the last ticket number.
- `<features_root>/NNN-slug/07-review.md` — previous rounds, if any.
- The PR threads and CI via `gh` (`gh pr view --json`, `gh api` for review comments,
  `gh pr checks`).
- `.kss/current` — the cursor: the last comment timestamp and the last CI conclusion handled.

**Do not read:** source files or diffs yourself — a `kss-explorer` maps findings to tickets and
FRs. Read `03-spec.md`/`04-plan.md` only to quote a decision in a dispute, never to plan a fix.

## Preconditions

1. `.kss/config.md` must exist. If it does not, stop with exactly:
   `No .kss/config.md found. Run /kss-init first.`
2. The feature must have an open PR. If it does not, stop with exactly:
   `No PR for NNN-slug. Run /kss-execute NNN-slug to open one.`
3. `gh` must be authenticated. If it is not, stop with exactly:
   `gh is not authenticated. Run gh auth login, then retry.`
4. If the PR is already merged or closed, stop with exactly:
   `PR <url> is <merged|closed>. Nothing to review.`

## Procedure

1. **Collect.** From the cursor in `.kss/current`, gather every new review comment, review body,
   and CI conclusion — **CI failures are findings too**. Number them `RV-NN`, continuing from the
   last round, each with file, line, author and text. Nothing new → print
   `No new findings since <cursor>.` and go to the summary (or re-arm the watcher).
2. **Map.** Spawn one `kss-explorer` (read-only) to map each finding back to the ticket and the
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
   `D-`/`AD-`, or have the user override it via `/kss-review-decisions` and *then* fix it, with
   the spec marked for revision in the README.
5. **Fix.** Write the fix tickets into `05-tickets/`, numbered after the last existing ticket,
   grouped by file, and run them through `/kss-execute NNN-slug --ticket NN`. Every gate applies
   — red run, commit order, reviewer verdict, integration.
6. **Reply and resolve.** After integrating, reply on each thread with the resolving commit or
   the approved text. **Resolve only the threads that were fixed or answered**; dispute threads
   stay open until the reviewer agrees, and `defer` threads are left open by design.
7. **Push** only to the **PR branch**, never to `base_branch`.
8. **Record the round** in `07-review.md` and go to the summary.

### `--watch`

1. Arm the **`Monitor` tool** — never a polling subagent — on a `gh` command that reports new
   comment count, CI conclusions and the PR state, polling every **5 minutes** by default
   (configurable). The session sleeps until that output changes.
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
   `/kss-review-decisions` first. Held items are listed by ID on every wake and wait for the user.
4. It stops when the PR is **merged or closed**, when the user stops it, or after **10 rounds** —
   then it stops and reports. The watcher **dies with the session**; re-running `/kss-review
   NNN-slug --watch` resumes from the cursor.
5. The board and the statusline show `watching`.

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
   "tickets":{"NN":{"state":"integrated","agent_type":"kss-sonnet-medium","turns":12,
                    "est_turns":15,"started_at":"ISO-8601"}},
   "execution":{"integrated":6,"total":6,"last":"<event>"}}
  ```

  - `cursor` field names are exactly `last_comment_at` and `last_ci_at` — that is what the next
    round reads from.
  - `watching` is the human-readable watch target the statusline prints (`PR #61`); set it only
    while `--watch` is armed and clear it (`null`) when it stops. `state` is `idle`, `running` or
    `watching`.
  - `tickets` is a **map keyed by the ticket number** (fix tickets included), with the fields
    `state`, `agent_type`, `started_at`, `turns`, `est_turns`, `worktree` — never an array.
  - The run roll-up stays in the top-level **`execution`** key, never in `session` (the `Stop`
    hook owns `session`).

## Summary

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
Next: /kss-docs-tech NNN-slug
```

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
- `--watch` uses the `Monitor` tool, never a polling subagent; it dies with the session and
  resumes from the cursor.
- Autopilot: `fixes` executes uncontested fixes and CI failures and holds the drafted replies;
  `all` also posts those replies; `none` stops at the triage table. **No mode ever ships a fix that
  contradicts a `D-` or an `AD-`**; held items are reported by ID.
- Hard cap of 10 rounds, then stop and report.
- **Never merge.**
- File names, headings and field names are English; the prose inside the documents follows the
  language of the conversation.
