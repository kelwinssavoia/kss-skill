---
name: kss-plan
description: Write the implementation plan for a KSS feature — shape rather than code, covering models, contracts, flows, UI, reuse, the file map and the test plan, with file-level facts gathered by read-only explorers. Use after /kss-spec, before /kss-tickets.
argument-hint: NNN-<slug>
disable-model-invocation: true
---

# kss-plan

Write `04-plan.md` for feature `NNN-<slug>`: how the system will be **shaped** to satisfy the
spec. Signatures, message shapes, entity fields, component names and props, the file map and the
test plan — never implementation code. You gather the file-level facts through read-only
explorers and synthesise; you do not read the codebase yourself. Every item in the plan traces
back to an FR or a decision, and the plan ends with one approval turn.

## Inputs

Read `.kss/config.md` (`features_root`, `standards`, `layout_references`, `explorer_model`), then
in `<features_root>/NNN-slug/`:

- `README.md` — whole file.
- `03-spec.md` — whole file.
- `02-decisions.md` and `auto-decisions.md`.
- `01-investigation.md` — the sections *Existing patterns to reuse*, *Data and contracts touched*
  and *Test coverage today*.
- The layout views named by the spec's Layout section.

**Do not read:** application source files (explorers do that), `05-tickets/`, `06-execution.md`,
`node_modules`, or `CLAUDE.md`-style standards beyond the NFR rules the spec already cites.

## Preconditions

1. `.kss/config.md` missing → stop: `No .kss/config.md. Run /kss-init first.`
2. `03-spec.md` missing → stop: `No 03-spec.md for NNN-slug. Run /kss-spec NNN-slug first.`
3. The spec lists a story with no FR (an error) → stop:
   `03-spec.md has unresolved errors: <list>. Fix the spec before planning.`
4. A product or architecture decision the plan needs is absent — how an entity is keyed, who owns
   a flow, which service holds the data, what the money or tenancy rule is — → **stop**:
   `Undecided: <question>. Run /kss-grill NNN-slug; the plan cannot choose this.`
   Never resolve such a question by picking the likely option.

## Procedure

1. **List the facts you are missing** before spawning anything: signatures, model and message
   shapes, component props, fixture and helper paths, existing spec files. Group them into at most
   five explorer briefs — one area each.

2. **Spawn read-only explorers in parallel**, agent type `kss-explorer`, model `explorer_model`
   (default sonnet). For a question touching **contract, tenant/authorization or money**, escalate
   that explorer to opus and print, before the spawn:

   > This question touches `<area>`; spawning an Opus explorer for it.

   Each brief states the question, the return format and the read discipline: grep first, read
   ranges, never a whole file over 300 lines, never `node_modules`, never write. Return format,
   ≤2k chars: **Answer / Evidence (file:line, max 8) / Reuse / Unknown**.

3. **Synthesise only.** The main session does not open source files. An explorer's `Unknown`
   becomes either a follow-up explorer or a Risk — never a guess written as fact.

4. **Design the shape**, section by section, into the draft:
   - **Approach** — the strategy in a paragraph, naming the seam the change enters through.
   - **Models and data** — per entity `new | changed | read`, every field with type and
     nullability, migration yes/no.
   - **Contracts** — per message or endpoint the exact shape **on both sides**, sender and
     receiver, the file it lives in, and the audit spec that proves it round-trips. A field that
     exists on one side only is a bug you are writing down; reconcile it here.
   - **Services and flows** — signatures; for every cross-service path a numbered sequence naming
     the transport (HTTP / gRPC / Kafka) at each hop.
   - **UI** — per surface: design-system components **by name with props**, where state lives, the
     data source, empty and error copy, and the layout view. A component the design system lacks
     is a question for the user, not an invention.
   - **Reuse** — existing helpers, components and fixtures with paths. This is the
     "reuse before create" checklist and every `create` row is measured against it.
   - **Test plan** — per seam: the spec files, the case names, and the empty and forbidden cases
     the rules demand.
   - **Risks and rollout**.

5. **New dependencies — one turn each, never skipped.** For every proposed dependency print:

   ```
   New dependency: <name>
   Why the current stack cannot do this: <reason>
   Size: <size>   Licence: <licence>
   Approve this dependency? (yes / no / alternative)
   ```

   Wait for the answer before the next one. A dependency added without its own confirmed turn is
   not permitted, however small.

6. **File map.** A table `File | Action (create / modify / —) | Layer | Why (FR)`. Every `create`
   row carries a justification against **Reuse** — which existing thing was considered and why it
   does not fit. A `create` with no such justification is deleted and replaced by a `modify`.

7. **Approval turn.** Print, in this order: the **Approach**, the **models/contracts table**, and
   the **File map** — then:

   ```
   Approve this plan, or say what to adjust.
   ```

   Wait. On adjust, revise and reprint the same three blocks. Only after approval do you write
   the file.

8. **Write** `<features_root>/NNN-slug/04-plan.md` from `.kss/templates/04-plan.md`, with every section above present.

9. **Cap.** `wc -c`. Over 20k → move the overflow (long shape dumps, flow transcripts, risk detail)
   into `<features_root>/NNN-slug/notes/<topic>.md` and link it from the section. Never inline
   past the cap, never drop a required section to fit.

## Outputs

- `<features_root>/NNN-slug/04-plan.md`.
- `notes/<topic>.md` for any overflow, linked from the plan.
- `README.md` **Plan block only** (≤10 lines):

  ```
  ## Plan
  Approach: <one line>
  Entities: <n> (<n> new) · Contracts: <n> · Surfaces: <n>
  Files: <n> create / <n> modify
  New dependencies: <names, or none>
  Seams: <n> · specs planned: <n>
  File: 04-plan.md (<n>k / 20k)<notes links>
  ```

  Update the header `**State:**` to `plan` and `**Next:**` to `/kss-tickets NNN-slug`.
- State (DESIGN.md §3.3), on spawn and again as each explorer returns:

  ```bash
  node .kss/scripts/current.mjs set '{"feature":"NNN-slug","phase":"plan",
    "phase_started_at":"<ISO-8601>","explorers":{"running":<n>,"returned":<k>}}'
  ```

  — or edit `.kss/current` directly so it holds `feature`, `phase` and `explorers`. `explorers` is
  that object, never a bare number; clear it with `null` when the fan-out is done.

## Summary

End by printing exactly:

```
Plan done · NNN-slug
Approach: <one line>
Files: <n> create / <n> modify · entities: <n> · contracts: <n>
New dependencies: <names, or none>
Explorers: <n> (<n> opus)
Cost: <line rendered from metrics.jsonl>
Safe to /clear.
Next: /kss-tickets NNN-slug
```

`Cost:` is rendered from `<features_root>/NNN-slug/metrics.jsonl` — agents, turns and cumulative
tokens for this phase. Never use the number the Agent tool displays.

## Rules

- **Shape, not code.** Signatures, field lists, message shapes, component names and props. No
  implementation bodies, no diffs, no pseudo-code longer than a signature.
- **A missing product or architecture decision stops the plan** and returns it to `/kss-grill`.
  Choosing on the user's behalf is the failure mode this rule exists to prevent.
- **The main session never reads source code.** Facts come from `kss-explorer` returns; explorers
  are read-only and never write.
- **Escalate to opus, with the printed warning, for contract, tenant/authorization and money
  questions.** Maximum five explorers in parallel; group the questions when there are more.
- **Every `create` in the File map is justified against Reuse**, naming what was considered.
- **Every new dependency gets its own confirmation turn.** Never batched, never assumed.
- Every section of the plan traces to an FR or a decision; an item citing neither is removed.
- Contracts are specified on **both** sides plus the audit spec — one-sided shapes are how fields
  vanish silently on the wire.
- Write **only** `04-plan.md`, its `notes/` files and the Plan block of `README.md`.
- The document's language follows the conversation; headings and identifiers stay English.
