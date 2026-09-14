---
name: kss-docs-product
description: Write the product-facing documentation for a finished feature and link it from the docs index. Run it after /kss-review, for the people who use the feature rather than build it.
argument-hint: NNN-<slug>
disable-model-invocation: true
---

# kss-docs-product

Describe the feature to the people who will use it: who it is for, what changed for them, how to
use it, and what it deliberately does not do. No file paths, no message shapes, no ticket
numbers. You write from the brief, the spec and the business decisions, and you add exactly one
line to the docs index.

## Inputs

Read, in this order:

- `.kss/config.md` — `docs_root`, `docs_index`, `features_root`, `layout_references`.
- `~/.kss/preferences.md` — `conversation_language` for everything printed in this session.
- `<features_root>/NNN-slug/README.md` — the index.
- `<features_root>/NNN-slug/00-brief.md` — symptom, outcome, actors and surfaces, out of scope.
- `<features_root>/NNN-slug/03-spec.md` — user stories, functional requirements, out of scope.
- `<features_root>/NNN-slug/02-decisions.md` — the **business** decisions only.
- The `layout_references` views the spec points to, for the surface names and the wording on
  screen.
- `<docs_index>` — to add the line, or to learn it does not exist.

**Do not read:** source files, `04-plan.md`, `06-execution.md`, `01-investigation.md`, or the
technical decisions. This skill spawns no explorer.

## Preconditions

0. **Sweep** (DESIGN.md §3.8). Run
   `git status --porcelain -- <features_root> <every path in domain_docs> <docs_root> .kss/config.md`.
   If it lists anything, the previous phase's `SessionEnd` metrics line (written by the hook
   *after* that phase committed) or a forgotten artifact is sitting in the tree: commit it now,
   `git add <those paths> && git commit -m "docs(NNN): <previous phase> artifacts"`, and say so
   in one line. Never stash or discard it, never mix it into this phase's commit.

1. `.kss/config.md` must exist. If it does not, stop with exactly:
   `No .kss/config.md found. Run /kss-init first.`
2. The feature folder must exist. If it does not, stop with exactly:
   `No feature NNN-slug under <features_root>.`
3. `00-brief.md` must exist. If it does not, stop with exactly:
   `NNN-slug has no brief. Run /kss-clarify first.`
   When `03-spec.md` is absent (an S track), write from the brief alone and say so under
   `## What changed`.

## Procedure

1. Read the inputs. Take the user stories and the FR outcomes as the source of "what changed" —
   never invent a capability the spec does not grant.
2. Write `<docs_root>/product/NNN-slug.md` from `.kss/templates/docs-product.md`, with **exactly
   these sections, in this order**:
   - `## Who it is for`
   - `## What changed`
   - `## How to use it` — numbered steps, using the surface and control names from the layout
     references
   - `## Rules and limits` — from the FRs and the business decisions
   - `## Not included` — the spec's Out of scope, plus the open `DF-` items
   - `## Glossary` — the terms fixed in `CONTEXT.md` that this feature uses
   Cap **12k chars**; overflow goes to the feature's `notes/` and is linked.
3. **Update `docs_index`** — one line under `## Product`, a link plus a one-sentence summary:
   `- [NNN-slug](product/NNN-slug.md) — <one sentence>`
   Keep the list ordered by `NNN`. If the line already exists, rewrite that line only.
4. **If `docs_index` does not exist**, create it from `.kss/templates/docs-index.md`: a **2–3 paragraph
   project summary** proposed from `CONTEXT.md` and the repository `README.md`, **confirmed in one
   turn**, plus the `## Technical` and `## Product` sections.
5. **Re-run:** rewrite the whole document, keep the existing index line, and append a
   `## Changelog` entry `- <date> — <what changed>`.

## Outputs

- `<docs_root>/product/NNN-slug.md`, ≤12k chars, sections exactly as listed above.
- `<docs_index>` with one line under `## Product` — created with the confirmed project summary if
  it was missing.
- The README **Docs** block, ≤10 lines: the product doc path, the date, and the index line added.
  Keep the tech doc's line if it is already there. Refresh the Cost table with
  `node .kss/scripts/render-cost.mjs <features_root>/NNN-slug`.
- `.kss/current`, on every event (doc written, index updated), via
  `node .kss/scripts/current.mjs set '<json>'`:

  ```json
  {"feature":"NNN-slug","phase":"docs-product","phase_started_at":"ISO-8601",
   "explorers":null,"ticket":null,"tickets":null,"execution":null,"review":null}
  ```

  This skill spawns no explorer, so `explorers` is cleared rather than set to `0` (`null` deletes
  a key). `tickets`, `execution` and `review` belong to the execute and review phases and are
  cleared here too. `session` is the `Stop` hook's; never write it.

## Summary

**Commit before printing** (DESIGN.md §3.8): every artifact this phase wrote goes on the feature
branch now — `git add <features_root>/NNN-slug <domain_docs paths touched> <docs_root paths touched>
.kss/config.md && git commit -m "docs(NNN): docs-product"`. Then
`git status --porcelain -- <those paths>` must be empty; if it is not, stop with
`Uncommitted feature artifacts: <paths>` instead of printing the summary. `.kss/current` is
gitignored and never part of this.

**Close the run** when nothing is left to do for this feature:
`node .kss/scripts/current.mjs end`. It sets `phase: "done"` so the hooks stop appending to
`metrics.jsonl` and the statusline hands back to the previous one. Running any later `kss-` skill on
this feature re-opens it automatically. The main session's own cost for this last phase is not
recorded — that is the price of a clean tree (DESIGN.md §6).

Print exactly:

```
Docs-product done · NNN-slug
Doc: <docs_root>/product/NNN-slug.md (<n> chars)
Covers: <n> user stories · <n> rules · <n> not included
Index: <docs_index> — line added under ## Product
Cost: <line rendered from metrics.jsonl>
Safe to /clear.
Next: <output of node .kss/scripts/next.mjs <features_root>/NNN-slug --after docs-product>
```

The `Next:` line is **never written by hand**: it is the output of
`node .kss/scripts/next.mjs <features_root>/NNN-slug --after docs-product`, which knows the track of the
feature's size (DESIGN.md §3.9). Copy it verbatim into the summary and into the README header.

Print `Cost: n/a` when `metrics.jsonl` does not exist.

## Rules

- Product language only: no paths, no message shapes, no ticket or FR numbers in the prose.
- Sections are exactly the six listed, in that order — none added, none dropped.
- Only the **business** decisions inform this document; technical ones belong to `kss-docs-tech`.
- Never claim a capability the spec does not grant, and never invent a screen the layout
  references do not show.
- **Never duplicate the feature folder** — link to it.
- Cap 12k chars; overflow goes to `notes/` and is linked.
- A re-run rewrites the whole doc, keeps the index line and appends `## Changelog`.
- The index gets one line per feature under `## Product`; create the index with a 2–3 paragraph
  summary confirmed in one turn only when it is missing.
- Terminal output follows `conversation_language` from `~/.kss/preferences.md` (absent: the user's
  language). Document content follows `docs_language` from `.kss/config.md` (absent: the
  conversation's language). File names, headings, field names and identifiers stay English.
