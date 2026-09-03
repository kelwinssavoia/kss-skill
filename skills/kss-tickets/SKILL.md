---
name: kss-tickets
description: Slice a KSS plan into self-contained tickets plus a dependency graph — layer-sliced parallel tickets in multi-agent mode, vertical tracer-bullet slices in single-session mode. Use after /kss-plan, before /kss-execute.
argument-hint: NNN-<slug>
disable-model-invocation: true
---

# kss-tickets

Cut `04-plan.md` into tickets under `05-tickets/` plus `graph.md`, for feature `NNN-<slug>`. A
ticket **is the brief**: its executor reads the ticket and the files it names, and nothing else —
never the spec, never the plan. The whole procedure branches on `execution` in `.kss/config.md`:
`multi-agent` slices by layer for parallel subagents; `single-session` slices vertically for one
session with `/clear` points. You end with one approval turn and, if a tracker is configured, a
mirrored card per ticket.

## Inputs

Read `~/.kss/preferences.md` for `conversation_language` (everything printed in this session).

Read `.kss/config.md` — `execution` (decides everything below), `features_root`, `standards`,
`tracker`, `explorer_model`. Then in `<features_root>/NNN-slug/`:

- `README.md` — whole file.
- `04-plan.md` — **File map, Test plan, Contracts, Reuse** (and Approach for context).
- `03-spec.md` — the **Functional requirements** section only, with their citations and any
  `blocked by DF-` markers.

**Do not read:** application source code, `01-investigation.md`, `06-execution.md`, `notes/`
beyond a note a File map row links, or `node_modules`. You may spawn a `kss-explorer` only to
resolve a line range a ticket must cite.

## Preconditions

1. `.kss/config.md` missing → stop: `No .kss/config.md. Run /kss-init first.`
2. `04-plan.md` missing → it depends on the track in the README header:
   - **S track** (`clarify → tickets → execute`): there is no plan and no spec by design. Slice
     from `00-brief.md` alone — see *S track* below. If `00-brief.md` is also missing, stop:
     `No brief for NNN-slug. Run /kss-clarify first.`
   - **M or L track** → stop: `No 04-plan.md for NNN-slug. Run /kss-plan NNN-slug first.`
3. `04-plan.md` has an unconfirmed new dependency (`Confirmed: pending`) → stop:
   `04-plan.md has unconfirmed dependencies: <names>. Re-run /kss-plan NNN-slug.`
4. `05-tickets/` already populated → say so and ask whether to re-slice (replacing) or stop.
   Never silently overwrite tickets that `06-execution.md` shows as started.
5. `execution` is neither `multi-agent` nor `single-session` → stop:
   `execution: <value> in .kss/config.md is not multi-agent or single-session.`

## Procedure

1. **Collect the schedulable FRs.** Every FR marked `blocked by DF-NN` is **excluded** — it is
   never scheduled. List the excluded FRs and their `DF-` owners; they go in the graph's footer
   and the summary, not into a ticket.

2. Branch on `execution`.

### S track — no spec, no plan

An S feature reaches this skill straight from `/kss-clarify`, so there is nothing to read but
`00-brief.md` and `README.md`. It is **one ticket**, always: one layer, one surface, no new data
and no contract — that is what made it an S. Fill the ticket from the brief (the expected outcome
becomes the Goal; the brief's own sentences stand in for the *Requirements covered* section, cited
as `brief`), leave *Plan excerpt* out, and spawn a `kss-explorer` for the file paths, line ranges
and existing spec file the ticket must name — the executor gets no other source. Mode fields still
apply: multi-agent gets a header, a model and an effort; single-session gets an order. `graph.md`
holds that single entry, with no critical path. If the work does not fit one ticket, it was not an
S: say so and stop with
`NNN-slug is larger than one ticket. Re-run /kss-clarify NNN-slug and raise the size to M.`

Everything below applies to M and L.

### 2a. Multi-agent mode

1. **Slice by File map rows grouped by layer — one layer per ticket.** Contract, data/model,
   service, gateway, UI, tests-only work are separate tickets even when small.
2. **Estimate each ticket**: `files to modify + specs to create`, converted to turns against the
   **80-turn cap**. A ticket estimated above 80 turns is **re-sliced** — split it and re-estimate.
   Never write an oversized ticket with a warning attached.
3. **The contract ticket comes first and is the smallest** it can be: the message/DTO/proto shape
   and its audit spec, nothing else. Everything else is blocked by it.
4. **After the contract, service / gateway / UI run in parallel.** The UI ticket codes against the
   contract type and a **mocked client**, and the ticket says so in its Goal and its Do-not list.
5. **Minimise chain depth** — a ticket blocked only for convenience is a ticket that should run in
   parallel. Compute the **critical path** (longest blocking chain by estimated turns).
6. **A final `integration` ticket is mandatory whenever more than one ticket follows the
   contract**: wire the parts together, replace the UI's mocked client with the real one, and run
   the seams end to end. It is blocked by all of them and is small.
7. **Assign Model and Effort from this rubric**, per ticket:

   | Field | Rule |
   | --- | --- |
   | Model | `opus` for contract, tenant/authorization, money, wire specs and design-deciding work; `sonnet` otherwise |
   | Effort | `low` = one layer, 1–2 files, copying an existing pattern · `medium` = one layer, several files, fitting the plan to the code · `high` = contract / wire / tenant / money / cross-service / debugging |
   | Helpers | `explorer`, `runner`, or `none`. Depth max 2; helpers never write code; ≤5 per ticket; helper return ≤1.5k |
   | Worktree | yes |

8. Write one file per ticket, `05-tickets/NN-<slug>.md`, from `.kss/templates/ticket.md`, using the **multi-agent header** and deleting
   the single-session header comment.

### 2b. Single-session mode

1. **Vertical tracer-bullet slices**: each slice goes end to end through the layers it touches and
   leaves the system working — not a layer, a thin whole.
2. **Size by context, not turns**: estimate the context a fresh session needs (files to read plus
   files to write) and keep each slice inside one comfortable context.
3. **Prefactor first.** Any refactor a later slice depends on is its own earlier slice; a wide
   refactor is always isolated into a slice of its own, never mixed into feature work.
4. Each slice declares **`/clear before: yes|no`** — `yes` whenever the previous slice left the
   session heavy or the next slice reads a different area.
5. **No worktree, no dependency graph, no per-ticket model or effort** — the order is the plan.
6. Write `05-tickets/NN-<slug>.md` from the same template, using the **single-session header**
   (`Order · Est. context · /clear before`) and deleting the multi-agent header.

### 3. Fill every ticket completely

Every ticket carries all of these, self-contained:

- **Title**
- **Header** — the mode's header, as above
- **Goal** — one paragraph
- **Requirements covered** — the FR text **pasted in**, with its `[D-…]` citations
- **Plan excerpt** — the ticket's File map rows, the contract shapes and the Reuse entries, pasted
  in from `04-plan.md`
- **Files** — exact paths with line ranges to write, and the files to read for patterns, with
  ranges
- **Tests** — spec files and case names, including the empty and forbidden cases; **a red run is
  required before implementation**
- **Project rules that apply** — one line each, only the rules this ticket actually triggers,
  quoted from `standards`
- **Do not** — open `03-spec.md` or `04-plan.md`; read whole files over 300 lines; run the full
  suite mid-ticket
- **Report back** — the fixed shape, **≤1.5k chars**. It is exactly the shape the executor agents
  (`agents/kss-*.md`) are told to return, and exactly what `kss-execute`'s gates check; copy it
  verbatim from `.kss/templates/ticket.md` rather than paraphrasing it:

  ```
  Ticket: NN-<slug> · <state: done | blocked>
  Branch: <branch> (worktree <path>)
  Commits: <sha> test: … / <sha> feat: …
  Files: <path>, <path>
  Tests: <command> → <result>
  Red run: <the failing assertion / first failure line>
  Deviations: <none, or one line each with why>
  Blocked on: <only when state is blocked>
  ```

### 4. Write `graph.md`

From `.kss/templates/graph.md`, keeping **only the section for the configured mode**.

- **Multi-agent** — the table `# | Ticket | Layer | Blocked by | Model | Effort | Est. turns |
  Worktree`, then `Critical path`, `Parallel after contract`, `Total estimate`.
- **Single-session** — the ordered list, each entry with Files, Est. context and `/clear before`.

Footer either way: the FRs excluded because a `DF-` blocks them, with owner and date.

### 5. Approval turn

Print the graph — the table (multi-agent) or the ordered list (single-session) — then:

```
Approve this <graph|sequence>, or say what to re-slice.
```

Wait. On a re-slice request, redo the slicing and reprint. Only after approval do the tracker step
and the summary run.

### 6. Tracker (optional)

If `tracker` is not `none`, publish one card per ticket, titled `NNN-slug · NN <title>`, whose body
links the ticket file and carries the header line only. **The file stays the source of truth** —
never edit a ticket by editing a card, and never put content in a card that is not in the file.
Record the card ids in the Tickets block. If publishing fails, say so and continue; it is optional.

## Outputs

- `<features_root>/NNN-slug/05-tickets/NN-<slug>.md` — one per ticket, from
  `.kss/templates/ticket.md`.
- `<features_root>/NNN-slug/05-tickets/graph.md` — from `.kss/templates/graph.md`.
- `README.md` **Tickets block only** (≤10 lines):

  ```
  ## Tickets
  Mode: <multi-agent|single-session> · tickets: <n>
  Contract first: <NN> · parallel after it: <NNs>   (multi-agent)
  Critical path: <NN → NN → NN> — <n> turns          (multi-agent)
  /clear points: <NNs>                               (single-session)
  Total estimate: <n> turns | <n>k context
  Not scheduled (DF-): <FRs, or none>
  Files: 05-tickets/ · graph.md<tracker cards>
  ```

  Update the header `**State:**` to `tickets` and `**Next:**` to `/kss-execute NNN-slug`.
- State (DESIGN.md §3.3):
  `node .kss/scripts/current.mjs set '{"feature":"NNN-slug","phase":"tickets","phase_started_at":"<ISO-8601>","explorers":null}'`
  — or edit `.kss/current` directly so it holds `feature` and `phase`.

## Summary

End by printing exactly:

```
Tickets done · NNN-slug
Mode: <multi-agent|single-session> · tickets: <n>
Critical path: <NN → NN → NN> — <n> turns        (single-session: /clear points: <NNs>)
Parallel after contract: <NNs>
Not scheduled (DF-): <FRs and owners, or none>
Cost: <line rendered from metrics.jsonl>
Safe to /clear.
Next: /kss-execute NNN-slug
```

`Cost:` is rendered from `<features_root>/NNN-slug/metrics.jsonl`. Never use the number the Agent
tool displays.

## Rules

- **The ticket is the brief.** Everything the executor needs is pasted in; it never opens the spec
  or the plan. A ticket that only cites `FR-07` instead of quoting it is incomplete.
- **An S feature has no plan and no spec** — it is sliced into exactly one ticket from
  `00-brief.md`. Never send an S track back to `/kss-plan`; that is not part of its track.
- **Never schedule an FR blocked by a `DF-`.** It waits for its owner; it is listed, not sliced.
- **Above 80 estimated turns, re-slice.** Never ship an oversized ticket with a warning.
- **One layer per ticket** in multi-agent mode; **one vertical whole per slice** in single-session
  mode. Do not mix the two shapes in one feature.
- **The contract ticket is first and smallest**, and everything downstream is blocked by it; the
  UI works against a mocked client until integration.
- **An `integration` ticket is mandatory** whenever more than one ticket follows the contract.
- **Helpers**: depth max 2, ≤5 per ticket, read-only, return ≤1.5k. Helpers never write code.
- Single-session tickets carry **no model, no effort, no worktree, no graph table** — inventing
  them there is a defect.
- Every ticket's Tests section demands a **red run before implementation**, and the report-back
  shape is fixed and ≤1.5k.
- Write **only** `05-tickets/*`, `graph.md` and the Tickets block of `README.md`.
- Terminal output follows `conversation_language` from `~/.kss/preferences.md` (absent: the user's
  language). Document content follows `docs_language` from `.kss/config.md` (absent: the
  conversation's language). File names, headings, field names and identifiers stay English.
