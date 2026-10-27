---
name: kss-review
description: Work a feature's PR review round — collect comments and CI findings, triage them, fix, dispute, answer or defer, reply on the threads; optionally watch the PR and run rounds automatically. Run it after kss-execute has opened the PR.
argument-hint: NNN-<slug> [--watch | --loop | --done] [--app]
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

## App mode

With `--app` in the arguments (kss-desktop runs this phase, DESIGN.md §26), strip it, read
`.kss/references/app-mode.md` once (missing: say `Run kss-init again for app mode` and go on as in
the terminal), and publish every turn that waits for the person with
`node .kss/scripts/ask.mjs post` before printing it: the triage table (step 3) is an `approve` (never under `--loop`) whose
draft is the table written to `notes/review-<round>-triage.md` — an edited table replaces yours; a
held item, a `question` finding opened for a mini grill and a dispute's reply text are a `question`
each; `--done`'s `Finish the review anyway?` is a `confirm`. Precondition 2 publishes a `handoff`
(`run`: execute, `then`: review) before its stop line. Set `progress` at each procedure step; the
Summary starts with `ask.mjs clear` and `{"progress":null}`.

## Rounds, and finishing

Review works in **rounds**, and **only the user finishes it**. A round never ends the review: its
Next line stays on `kss-review`, because the reviewers will look again after the fixes. The
review ends when the user runs `kss-review NNN-slug --done` (kss-desktop's **Finish review**) —
never on your own judgement, never because a round found nothing, never by passing `--done`
yourself.

`--done` runs no round. It:
1. Lists what is still open — `RV-` ids not resolved, open threads on the PR, CI conclusion — and
   if anything is, asks once: `Open: <ids>. Finish the review anyway?` A no ends the turn with the
   usual round Next line.
2. Appends `## Finished` to `07-review.md` (date, open items left, who decided: the user) and
   `Finished: <date>` to the README Review block; sets `.kss/current` `review.state` to `"done"`.
3. Goes to the Summary, whose Next line is
   `node .kss/scripts/next.mjs <features_root>/NNN-slug --after review --done` — the track goes on
   (docs on L, the end of the track on S and M) — and **closes the run** as described there.

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

**Enter the phase before any other work.** As soon as the preconditions pass — before reading the
inputs, spawning anything or asking anything — run
`node .kss/scripts/current.mjs set '{"feature":"NNN-slug","phase":"review","phase_started_at":"<ISO-8601 now>","explorers":null}'`.
The board, the statusline and the metrics hooks read the phase from there, so writing it at the
end shows the previous phase for the whole run. The `.kss/current` entry under Outputs is what
this phase keeps up to date afterwards.

## Procedure

1. **Collect.** From the cursor in `.kss/current`, gather every new review comment, review body,
   and CI conclusion — **CI failures are findings too**. Number them `RV-NN`, continuing from the
   last round, each with file, line, author and text. Nothing new → print
   `No new findings since <cursor>.` and go to the summary (or re-arm the watcher).
2. **Map.** Spawn one `explorer` (read-only) to map each finding back to the ticket and the
   FRs it came from, and — given `node .kss/scripts/lessons.mjs list --md` — to name its **bug
   class** (DESIGN.md §27): an existing `BC-NN`, or a new one proposed as title, signature (what
   the bug looks like, not this instance), the one question that would have caught it, and
   triggers (words or paths a change exposed to it contains). It also lists the **siblings**:
   other places in `git diff origin/<base_branch>...HEAD` with the same class, `file:line` each.
   Return ≤2k chars.
3. **Triage.** Print the table and take **one turn** to confirm it:

   ```
   | ID | Where | From | Class | Bug class | Proposal |
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
5. **Learn** (DESIGN.md §27; skip, saying so, when `.kss/scripts/lessons.mjs` is absent). Once the triage is confirmed, every `fix` finding is a confirmed bug:
   file it with `node .kss/scripts/lessons.mjs add '<json>'` — `{"class":"BC-NN","case":{…}}`
   for an existing class, or the new class's fields plus its `case`. The case is
   `{"feature":"NNN-slug","pr":"#<n>","rv":"RV-NN","file":"<path>","summary":"<one line>","phase":"<plan|tickets|review|test — the first gate that should have caught it>"}`.
   Disputes, questions, deferrals and findings the reviewer was wrong about are **not** filed —
   only bugs. When `add` answers `"escalate": true` (a class confirmed three times with no
   automatic check), write the check now if a regex on added lines can see the class —
   `{"class":"BC-NN","check":{"pattern":"…","paths":[…],"message":"…"}}` — test it with
   `lessons.mjs check --diff origin/<base_branch>...HEAD` (it must hit this feature's instances),
   and otherwise say so in the summary. `.kss/lessons.json` is committed with the round.
6. **Fix.** A fix ticket fixes the **class**, not the line: the finding **and every sibling** the
   explorer listed, and its **Failure checks** name the class. Write the fix tickets into
   `05-tickets/`, numbered after the last existing ticket, grouped by file; they run through `kss-execute NNN-slug --ticket NN …`, where every gate applies
   — report shape, commit order (test committed first), reviewer verdict, integration; the tests
   themselves run only in the coordinator's single run after integration.
   **The loop back** (DESIGN.md §3.9): `kss-execute` is started by the user only — its skill cannot
   be invoked by a model, so never try, and never reproduce its work by other means. Write the fix
   tickets, add them to `05-tickets/graph.md`, commit them (`docs(NNN): review round <n> fix tickets`), then
   set the README header's `**Next:**` to the output of
   `node .kss/scripts/next.mjs <features_root>/NNN-slug --back execute --ticket NN [--ticket NN …] --then review`
   and print that line as the last line of the turn. The board and kss-desktop show it as the next
   step; when execute ends, its Next returns to `review` by itself.
   The round ends there; steps 7–8 run in the next round, once the fix tickets are integrated.
7. **Reply and resolve.** After integrating, reply on each thread with the resolving commit or
   the approved text. **Resolve only the threads that were fixed or answered**; dispute threads
   stay open until the reviewer agrees, and `defer` threads are left open by design.
8. **Push** only to the **PR branch**, never to `base_branch`.
9. **Record the round** in `07-review.md` — its Bug class column, the siblings and the Lessons
   line — and go to the summary.

### `--watch`

1. Watch the PR **the way the harness adapter says** — a background monitor where there is one,
   never a polling subagent — on a `gh` command that reports new comment count, CI conclusions and
   the PR state, every **5 minutes** by default (configurable). Say once, in one line, what that
   costs the session here: a harness with a real monitor frees it, a harness without one holds it.
2. On a change: wake, run one round (steps 1–9), push to the PR branch, reply, and **re-arm**.
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

### `--loop`

kss-desktop's **Loop review** (DESIGN.md §26.9): the app runs review → execute → review … and you
run the rounds **without asking anything in between**, until the reviewer has nothing left to say.
A PR reviewer that re-reviews on every push (Codex) is what answers each round.

1. **No triage turn.** The table is printed and recorded but not confirmed — no `approve` ask, no
   waiting. What a round does without asking is `review_autopilot` exactly as under `--watch`
   (`none` counts as `fixes` here: the person switched the loop on). A fix contradicting a `D-` or
   an `AD-` is still **held**, never shipped.
2. **A round with fix tickets** ends as step 6 says — tickets written and committed, Next set to the
   loop back to execute — and the turn ends there: the app starts execute, and after it this phase
   again with `--loop`.
3. **A round after integrated fixes** runs steps 7–9 — reply, resolve, push — and then **waits**.
   So does a round with nothing to fix and nothing new.
4. **Wait** for the reviewer's next pass, in the **foreground** — never a background monitor or a
   background command: an ended turn reads as a stopped phase, and the app would start you again.
   Set `.kss/current` `review.loop` to `{"state":"waiting","until":"<push time + 20 min>","at":"<now>"}`,
   then run, as many times as it answers `pending`,
   `node .kss/scripts/review.mjs wait --pr <number> --since <push time ISO> --until <same until>`
   (one call polls the PR every minute for up to 9 minutes, then answers `pending`). Its answer:
   - `new` — comments, a review or a failed check came after the push: run the next round (step 1
     of the Procedure) in this same turn, with `review.loop.state` `"running"`.
   - `clean` — the reviewer said it found nothing: **stop** with reason `clean`.
   - `timeout` — 20 minutes since the push and nothing changed: **stop** with reason `timeout`.
   - `closed` — merged or closed: **stop** with reason `closed`, and close the run as the Summary says.
   - `error` — `gh` failed three times in a row: stop with reason `gh: <error>`.
5. **Stop** also when the round cap (10) is reached (reason `cap`), or when a round left only held
   items and nothing to fix (reason `held`, the ids listed). To stop: set `review.loop` to
   `{"state":"stopped","reason":"<reason>","at":"<now>"}`, then the Summary as after any round —
   Next stays on `kss-review`; only the person finishes the review.
6. A `blocked` stop (an unreadable input, `gh` not authenticated) is still an ask: the loop waits on
   it like any phase does.
7. **Never end a turn while work is out.** Spawn every subagent (the mapping explorer included) in
   the foreground and wait for it in the same turn — never in the background. A turn that ends with
   nothing out reads to the app as a stopped review, and nothing moves the round on until someone
   answers; one that ends with a background agent out is woken when it returns, but end it so only
   when the harness gives no foreground spawn.

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

**App mode:** first `node .kss/scripts/ask.mjs clear` and `current.mjs set '{"progress":null}'`.

**Living feature:** when a fix or an override changed a rule or a decision, pipe a patch to
`node .kss/scripts/feature.mjs <features_root>/NNN-slug --phase review` per
`.kss/references/feature.md` (skip when the script is absent).

**Report** (DESIGN.md §25): explain this phase to a human before committing — write
`<features_root>/NNN-slug/report/review.json` as `.kss/references/report.md` describes — short, and shown
rather than told (diagrams, examples, quoted code) — every string in `conversation_language`, then run `node .kss/scripts/report.mjs <features_root>/NNN-slug --phase review`
and fix the file until it prints `report: …/index.html`. The commit below carries `report/`.

**Commit before printing** (DESIGN.md §3.8): every artifact this phase wrote goes on the feature
branch now — `git add <features_root>/NNN-slug <domain_docs paths touched> <docs_root paths touched>
.kss/config.md && git commit -m "docs(NNN): review"`. Then
`git status --porcelain -- <those paths>` must be empty; if it is not, stop with
`Uncommitted feature artifacts: <paths>` instead of printing the summary. `.kss/current` is
gitignored and never part of this.

**Close the run** only after `--done`, or when the watch stopped because the PR was merged or closed:
`node .kss/scripts/current.mjs end`. It sets `phase: "done"` so the hooks stop appending to
`metrics.jsonl`, and a harness with a status line hands it back to the previous one. Running any later `kss-` skill on
this feature re-opens it automatically. The main session's own cost for this last phase is not
recorded — that is the price of a clean tree (DESIGN.md §6).

Print exactly:

```
Review done · NNN-slug · round <N>
Findings: <n> — fix <n> · dispute <n> · question <n> · defer <n>
Fix tickets: <ids | none>
Lessons: +<n> cases (<BC ids>) · new <BC ids | none> · automate <BC ids | none>
Threads: <n> resolved · <n> open
CI: <conclusion>
Cost: <line rendered from metrics.jsonl>
Report: <features_root>/NNN-slug/report/index.html#phase-review
<after a round:> Review stays open — run kss-review again after the next push, or finish it with --done.
<after --done:>  Review finished by the user. Ready for merge decision. This skill never merges.
Safe to /clear.
Next: <output of node .kss/scripts/next.mjs <features_root>/NNN-slug --after review [--done]>
```

The `Next:` line is **never written by hand**: it is the output of
`node .kss/scripts/next.mjs <features_root>/NNN-slug --after review`, with `--done` only in a
`--done` run (DESIGN.md §3.9). After a round it stays on `kss-review` (with the finish command in
parentheses); after `--done` it is the track's next — `kss-docs-tech` on L, the end of the track
on S and M. A round that opened fix tickets writes the loop back (step 6) instead. Copy it
verbatim into the summary and into the README header.

Print `Cost: n/a` when `metrics.jsonl` does not exist. While watching, replace the last two lines
with `Watching PR <url> — next check in <n>m.`

## Rules

- The cursor lives in `.kss/current.review.cursor` as `{last_comment_at, last_ci_at}`; a round only
  collects what is newer than it.
- Every finding, CI failures included, becomes an `RV-NN`.
- Every confirmed bug (`fix`) is filed in `.kss/lessons.json` under a bug class, and its fix ticket
  covers every sibling of that class in the feature — never only the line the reviewer pointed at.
- An explorer maps findings to tickets and FRs — you do not read diffs.
- The triage table is printed and confirmed in exactly one turn.
- A finding contradicting a decision is disputed or overridden, never silently fixed.
- Fix tickets are numbered after the last ticket, grouped by file, executed via `kss-execute`
  with all the gates — started by the user from the Next line (`--back execute … --then review`),
  never invoked by this skill.
- Resolve only the threads that were fixed or answered; disputes and deferrals stay open.
- Push only to the PR branch, never to `base_branch`.
- `--watch` uses whatever the adapter names, never a polling subagent; it dies with the session and
  resumes from the cursor.
- `--loop` never asks between rounds; it polls the PR in the foreground with `review.mjs wait`, every
  minute, and stops on a clean pass, 20 minutes without a change, a closed PR, held items only, or
  the cap — always recording why in `review.loop`.
- Autopilot: `fixes` executes uncontested fixes and CI failures and holds the drafted replies;
  `all` also posts those replies; `none` stops at the triage table. **No mode ever ships a fix that
  contradicts a `D-` or an `AD-`**; held items are reported by ID.
- Hard cap of 10 rounds, then stop and report.
- **Never merge.**
- Terminal output follows `conversation_language` from `~/.kss/preferences.md` (absent: the user's
  language). Document content follows `docs_language` from `.kss/config.md` (absent: the
  conversation's language). File names, headings, field names and identifiers stay English.
- End with the phase report: `report/review.json` per `.kss/references/report.md`, then `report.mjs`.
- Only the user finishes the review (`--done`); a round always leaves Next on `kss-review`.
