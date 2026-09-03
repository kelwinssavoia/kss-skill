---
name: kss-spec
description: Write the functional specification for a KSS feature from its brief and decisions — audits the inputs, agrees the test seams in one turn, then writes 03-spec.md with cited FRs and traceability. Use after the grill (or after investigation on an M track with no open items).
argument-hint: NNN-<slug>
disable-model-invocation: true
---

# kss-spec

Write `03-spec.md` for feature `NNN-<slug>`: the functional specification. You audit the inputs
first, take exactly one confirmation turn on the test seams, then write the file. The spec says
**what the system must do and how it is proven**, never how it is coded — shape and design belong
to `/kss-plan`. Every requirement is traceable to a recorded decision; an uncited requirement is a
requirement someone invented, and this skill refuses it.

## Inputs

Read `~/.kss/preferences.md` for `conversation_language` (everything printed in this session).

Read `.kss/config.md` for `features_root`, `standards` and `layout_references`, then, in
`<features_root>/NNN-slug/`:

- `README.md` — whole file.
- `00-brief.md` — whole file.
- `02-decisions.md` — all `D-` and `DF-` entries.
- `auto-decisions.md` — all `AD-` entries with their status.
- `01-investigation.md` — **only** the sections *Where it lives*, *Data and contracts touched*
  and *Test coverage today*.
- The layout view the brief points at, in `layout_references` — only the view named.
- The `standards` files, only to source NFRs.

**Do not read:** application source code, `04-plan.md`, tickets, `06-execution.md`, the rest of
`01-investigation.md`, `node_modules`, or any layout file the brief does not name. You do not
explore the repository in this phase; if a fact is missing it is an Open item, not a search.

## Preconditions

1. `.kss/config.md` must exist. If not, stop with:
   `No .kss/config.md. Run /kss-init first.`
2. The feature folder must exist and `README.md` must show the Decisions block filled (grill done),
   or — M track, no open decisions — the Investigation block with `open: 0`. Otherwise stop with:
   `NNN-slug is at phase <phase>. Run /kss-<expected> NNN-slug first.`
3. `03-spec.md` already present → this is a **revision**; follow Procedure step 8.

## Procedure

1. **Input audit.** Print this table before anything else:

   | Check | Result |
   | --- | --- |
   | Every open decision is a `D-`, `AD-` or `DF-` | ok / missing: … |
   | Every `DF-` has an owner and a date | ok / missing: … |
   | Every actor and surface in the brief is covered | ok / uncovered: … |
   | The layout view exists | ok / missing: … |

   - An undecided question that is not a `D-`, `AD-` or `DF-` → **stop**:
     `Undecided: <list>. Run /kss-grill NNN-slug — the spec cannot cite what was never decided.`
   - A `DF-` without an owner or a date → **stop** with the same instruction, naming the entries.
   - An actor or surface with no coverage → do not stop; record it under **Open items**.
   - The layout view is missing → do not stop; record it under **Open items** and leave the Layout
     row as `missing — <path> not found`. **Never invent a layout**: no invented views, columns,
     copy, component names or states.

2. **Derive the requirements** from the decisions and the brief. One FR per behaviour, each
   citing the decision(s) it comes from. An FR you cannot cite is not yours to write — it is an
   open decision; go back to step 1's stop.

3. **Propose the test seams — the one confirmation turn.** Rank existing seams above new ones,
   highest-value first. A new seam is only proposed when a rule in `standards` requires it, and
   the rule is named. Print exactly:

   ```
   Test seams proposed for NNN-slug

   1. <seam> — existing — <spec file>
   2. <seam> — existing — <spec file>
   3. <seam> — new — required by <standards file> § <rule>

   Confirm, or say which to drop, add or reorder.
   ```

   Wait for the answer. This is the only interactive turn in the phase.

4. **Source the NFRs.** Only from `standards`, and only where the feature actually triggers the
   rule. Each cites its file and rule. No NFR without a citation; no invented performance,
   security or accessibility targets.

5. **Build the traceability tables** and apply their semantics:
   - a decision with no FR → **warning**, listed under the table;
   - a story with no FR → **error**, listed and repeated in the summary;
   - an FR whose behaviour depends on a `DF-` → the FR is marked `blocked by DF-NN`.

6. **Write** `<features_root>/NNN-slug/03-spec.md` from `.kss/templates/03-spec.md`, filling every section: Problem · Solution · User
   stories · Functional requirements · Non-functional requirements · Test seams · Contracts and
   data · Layout · Out of scope · Open items · Traceability.

7. **Check the cap.** `wc -c` the file. Over 15k → do not ship it:
   `03-spec.md is <n>k, over the 15k cap. This feature is too large for one spec — split it into
   <suggested split> and re-run /kss-clarify for the second part.`
   Move genuinely secondary detail to `notes/` and link it only when that alone brings it under cap.

8. **Revision.** When `03-spec.md` exists, re-read the decisions, find the FRs citing decisions that
   changed (`overridden`, `reopened`, new `D-`), and **rewrite only those FRs**. Leave every other
   FR byte-identical. Append `## Revision N` naming what changed and which FRs were rewritten, and
   update the traceability tables.

## Outputs

- `<features_root>/NNN-slug/03-spec.md` — from the template above.
- `README.md` **Spec block only** (≤10 lines), replacing whatever is there:

  ```
  ## Spec
  FRs: <n> · NFRs: <n> · stories: <n> · seams: <n> (<n> new)
  Blocked by DF-: <ids or none>
  Warnings: <decisions with no FR, or none>
  Errors: <stories with no FR, or none>
  File: 03-spec.md (<n>k / 15k)
  ```

  Also update the header `**State:**` to `spec` and `**Next:**` to `/kss-plan NNN-slug`.
- State (DESIGN.md §3.3):
  `node .kss/scripts/current.mjs set '{"feature":"NNN-slug","phase":"spec","phase_started_at":"<ISO-8601>","explorers":null}'`
  — or edit `.kss/current` directly so it holds `feature` and `phase`. This phase spawns nothing.

## Summary

End by printing exactly:

```
Spec done · NNN-slug
FRs: <n> · NFRs: <n> · stories: <n> · seams: <n> (<n> new)
Open items: <DF- ids, or none>
Warnings: <n>   Errors: <n>
Cost: <line rendered from metrics.jsonl>
Safe to /clear.
Next: /kss-plan NNN-slug
```

The `Cost:` line is rendered from `<features_root>/NNN-slug/metrics.jsonl` — the phase's agents,
turns and cumulative tokens. Never report the number the Agent tool displays.

## Rules

- **An FR without a `[D-…]` / `[AD-…]` citation is refused.** Not softened, not marked TODO —
  refused, and the missing decision goes back to the grill.
- **Never invent a layout.** No view, column, field, copy string or component name that is not in
  the referenced layout file. A gap is an Open item and a question, never a plausible filler.
- **NFRs come only from `standards`**, and only when the feature triggers them. Each cites its rule.
- FR form is exactly one sentence: `Given <state>, when <event>, then <outcome>. [D-xx, AD-yy]`.
- Never schedule, size, or assign work here; no file paths as instructions, no code, no pseudo-code.
- Write **only** `03-spec.md` and the Spec block of `README.md`. No other file is yours.
- Do not read code, and do not spawn subagents: this phase synthesises recorded inputs only.
- Terminal output follows `conversation_language` from `~/.kss/preferences.md` (absent: the user's
  language). Document content follows `docs_language` from `.kss/config.md` (absent: the
  conversation's language). File names, headings, field names and identifiers stay English.
- Nothing is ever deleted on revision — old FRs are rewritten in place, changes recorded under
  `## Revision N`.
