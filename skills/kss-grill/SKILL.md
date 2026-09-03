---
name: kss-grill
description: KSS interview phase — ask the user every open decision from the investigation, one per turn, business then layout then technical, and record the answers as D- entries. Run it after kss-investigate on an L track, or on M when open items remain.
argument-hint: NNN-<slug>
disable-model-invocation: true
---

# kss-grill

Settle, with the user, every decision the investigation could not settle from the code. You ask
the open items **one per turn**, in the order business → layout → technical, each with the options
the repository actually offers. There is no cap on the number of questions — the phase ends when
nothing is open. You never ask the user for a fact the repository can answer; you fetch it. Terms
and architectural decisions that come out of the interview are written down as they are decided,
into `CONTEXT.md` and `docs/adr/`, so the next phase inherits them.

## Inputs

- `<features_root>/NNN-slug/README.md`
- The `## Decisions` section of `01-investigation.md` — **open items only**
- The auto-decision **IDs** from `auto-decisions.md` (so you can spot a contradiction)
- `CONTEXT.md` and the ADR index named in `domain_docs`
- `.kss/config.md`
- `~/.kss/preferences.md` — `conversation_language` for everything printed in this session.

**Do not read:** the rest of `01-investigation.md`, `00-brief.md`, `03-spec.md`, `04-plan.md`, any
ticket, any source file or test. The full body of an auto decision is not read — only its ID.

## Preconditions

1. `.kss/config.md` must exist, else stop with: `No .kss/config.md found. Run /kss-init first.`
2. `01-investigation.md` must exist with a `## Decisions` section, else stop with:
   `No investigation for NNN-slug. Run /kss-investigate first.`
3. Count the open items — items marked `open`, plus every `AD-` with `status: reopened`.
   - On an **M** track with zero open items, stop with exactly:
     `No open decisions for NNN-slug on track M — the grill is not needed. Next: /kss-spec NNN-slug.`
   - On an **L** track the grill always runs; with zero open items, say so and go straight to the
     closing turn.

## Procedure

1. Read the inputs and build the queue of open items, ordered **business → layout → technical**,
   keeping the investigation's order inside each category.
2. Ask **one question per turn**, in this exact format:

   ```
   Qn · <category> · from <source>
   <the question>
   Options found in the repo:
     a) …
     b) …
     …) something else
   Lean: <only when there is one>
   ```

   `something else` is always the last option. **A `Lean:` is never offered for a business
   question** — business options are consequences, not recommendations; state the consequence of
   each option instead. Omit the `Lean:` line entirely when there is no lean.
3. **Never ask about a `settled` or `default` item.** Those were decided by the investigation and
   are reviewed with `/kss-review-decisions`, not here.
4. If an answer needs a repository fact that was not fetched, spawn **one** `kss-explorer`
   (sonnet, read-only) for it and continue. **Never ask the user for a repo fact.** The grill
   spawns nothing else.
5. If an answer contradicts an auto decision, mark that `AD-NN` `status: overridden` in
   `auto-decisions.md`, link it forward to the new `D-NN`, and record the `D-NN` normally.
6. **At most one derived question per answer.** A second branch becomes a `## Deferred` entry, or
   goes back to `/kss-investigate` — say which, and move on.
7. "Don't know", "later", "we'll see" → a `## Deferred` entry `DF-NN` with an **owner** and a
   **date**, both asked for in the same turn. A `DF-` without both is not recorded.
8. Domain modeling is part of the interview, not a separate pass:
   - a new or conflicting **term** is fixed in one turn and written to `CONTEXT.md`;
   - an **architectural, data or contract** decision becomes an ADR under `docs/adr/`, which the
     `D-NN`'s `Links:` field points at.
9. Write each `D-NN` as it is decided, so an interrupted grill loses nothing.
10. **Closing turn**, verbatim shape:
    `Decided <n>, deferred <n>, overrode <ids or none>. Anything to revisit?`
    A revisit re-asks that item and rewrites its `D-`; otherwise finish.

## Outputs

- `<features_root>/NNN-slug/02-decisions.md` from `.kss/templates/02-decisions.md`:

  ```
  ## D-NN · <category>
  Question:
  Decision:
  Why:
  Rejected:
  Links:
  Terms:
  ```

  plus a `## Deferred` section with `DF-NN — <question> · owner: … · date: …`.
- `<features_root>/NNN-slug/auto-decisions.md` — `status: overridden` and a forward link on every
  contradicted `AD-`. Nothing is deleted.
- `CONTEXT.md` — new or clarified terms. `docs/adr/` — one ADR per architectural, data or contract
  decision, per `domain_docs`.
- The **Decisions** block of `README.md` only, ≤10 lines:

  ```
  Decided: D-01…D-NN (business <n> · layout <n> · technical <n>)
  Overrode: <AD-id → D-id, …>
  Deferred: <DF-ids with owners>
  Terms added: <list> · ADRs: <paths>
  ```
- `.kss/current` (DESIGN.md §3.3):
  `node .kss/scripts/current.mjs set '{"feature":"NNN-slug","phase":"grill","phase_started_at":"<ISO-8601>","explorers":null}'`
  — and, only while the one fact-finding explorer is out,
  `node .kss/scripts/current.mjs set '{"explorers":{"running":1,"returned":0}}'`, cleared with
  `'{"explorers":null}'` when it returns. `explorers` is always that object or absent, never a
  bare number.

## Summary

Print exactly:

```
Grill done · NNN-slug
Decided: <n> — business <n> · layout <n> · technical <n>
Overrode: <AD-id → D-id, …, or none>
Deferred: <DF-id — question · owner · date, one per line, or none>
Terms: <terms written to CONTEXT.md, or none>
ADRs: <paths, or none>
Cost: <line rendered from metrics.jsonl>
Safe to /clear.
Next: /kss-spec NNN-slug
```

The `Cost:` line is rendered from `<features_root>/NNN-slug/metrics.jsonl`.

## Rules

- Open items only. Never ask about a `settled` or `default` item.
- Order is business → layout → technical, one question per turn, no cap on the count.
- The question format is fixed, `something else` is always an option, and `Lean:` is never offered
  for a business question.
- Never ask the user for a repository fact — spawn one sonnet `kss-explorer` for it. The grill
  spawns nothing else.
- At most one derived question per answer; further branches go to Deferred or back to
  investigation.
- An answer contradicting an auto decision marks it `overridden` and creates a new `D-`; nothing
  is deleted.
- "Don't know" / "later" → a `DF-NN` with an owner and a date, both captured in the turn.
- Terms go to `CONTEXT.md` in the turn they are fixed; architectural, data and contract decisions
  become ADRs in `docs/adr/`, linked from the `D-`.
- Closing turn: "Decided N, deferred N, overrode …. Anything to revisit?"
- On M the grill runs only when there are open items; on L it always runs.
- Write only `02-decisions.md`, `auto-decisions.md` statuses, `CONTEXT.md`, `docs/adr/` and the
  Decisions block of `README.md`.
- Terminal output follows `conversation_language` from `~/.kss/preferences.md` (absent: the user's
  language). Document content follows `docs_language` from `.kss/config.md` (absent: the
  conversation's language). File names, headings, field names and identifiers stay English.
