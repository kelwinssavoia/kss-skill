---
name: kss-docs-tech
description: Write the as-built technical documentation for a finished feature and link it from the docs index. Run it after /kss-review, when the code that shipped is the code being described.
argument-hint: NNN-<slug>
disable-model-invocation: true
---

# kss-docs-tech

Document the feature **as it was built**, not as it was planned. The plan is your outline; the
repository is the truth, so one read-only explorer confirms every path before you write it. The
document is short, links back to the feature folder instead of repeating it, and adds exactly one
line to the docs index.

## Inputs

Read, in this order:

- `.kss/config.md` — `docs_root`, `docs_index`, `features_root`.
- `<features_root>/NNN-slug/README.md` — the index.
- `<features_root>/NNN-slug/04-plan.md` — the File map, Contracts, Test plan.
- `<features_root>/NNN-slug/06-execution.md` — what actually shipped, and the deviations.
- `<features_root>/NNN-slug/02-decisions.md` and the ADRs it links to.
- `<docs_index>` — to add the line, or to learn it does not exist.

**Do not read:** source files yourself, `03-spec.md`, `01-investigation.md`, or the diffs. The
explorer confirms the code; you write from what it returns.

## Preconditions

1. `.kss/config.md` must exist. If it does not, stop with exactly:
   `No .kss/config.md found. Run /kss-init first.`
2. The feature folder must exist. If it does not, stop with exactly:
   `No feature NNN-slug under <features_root>.`
3. `04-plan.md` and `06-execution.md` must exist. If either is missing, stop with exactly:
   `NNN-slug has no plan or no execution log. Technical docs describe built code — run /kss-execute first.`

## Procedure

1. Read the inputs and build the outline from the plan's File map, Contracts and Test plan, plus
   the deviations recorded in `06-execution.md`.
2. **Spawn one `kss-explorer`** (read-only, ≤1.5k return) to **confirm the as-built paths against
   the File map**: which files exist, where each contract, entity and spec actually lives, and
   what the plan named that the code does not have. A path the explorer does not confirm is not
   written into the document — it goes under **Deviations from plan**.
3. Write `<docs_root>/tech/NNN-slug.md` from `.kss/templates/docs-tech.md`, with **exactly these
   sections, in this order**:
   - `## What it does`
   - `## How it works (as built)`
   - `## Contracts and data`
   - `## Where the code lives`
   - `## Decisions` — links to the `D-` entries and the ADRs
   - `## Testing`
   - `## Operations`
   - `## Deviations from plan`
   Cap **12k chars**; overflow goes to the feature's `notes/` and is linked.
4. **Update `docs_index`** — one line under `## Technical`, a link plus a one-sentence summary:
   `- [NNN-slug](tech/NNN-slug.md) — <one sentence>`
   Keep the list ordered by `NNN`. If the line already exists, rewrite that line only.
5. **If `docs_index` does not exist**, create it from `.kss/templates/docs-index.md`: a **2–3 paragraph
   project summary** proposed from `CONTEXT.md` and the repository `README.md`, **confirmed in one
   turn**, plus the `## Technical` and `## Product` sections.
6. **Re-run:** rewrite the whole document, keep the existing index line, and append a
   `## Changelog` entry `- <date> — <what changed>`.

## Outputs

- `<docs_root>/tech/NNN-slug.md`, ≤12k chars, sections exactly as listed above.
- `<docs_index>` with one line under `## Technical` — created with the confirmed project summary
  if it was missing.
- The README **Docs** block, ≤10 lines: the tech doc path, the date, and the index line added.
  Refresh the Cost table with
  `node .kss/scripts/render-cost.mjs <features_root>/NNN-slug`.
- `.kss/current`, on every event (explorer spawned, explorer returned, doc written), via
  `node .kss/scripts/current.mjs set '<json>'`:

  ```json
  {"feature":"NNN-slug","phase":"docs-tech","phase_started_at":"ISO-8601",
   "explorers":{"running":1,"returned":0},
   "ticket":null,"tickets":null,"execution":null,"review":null}
  ```

  `explorers` is the object `{running, returned}` — bump `returned` to 1 when the explorer is
  back, and clear the key with `null` afterwards. `tickets`, `execution` and `review` belong to
  the execute and review phases, so they are cleared here (`null` deletes a key). `session` is the
  `Stop` hook's; never write it.

## Summary

Print exactly:

```
Docs-tech done · NNN-slug
Doc: <docs_root>/tech/NNN-slug.md (<n> chars)
As-built: <n> paths confirmed · <n> deviations from plan
Index: <docs_index> — line added under ## Technical
Cost: <line rendered from metrics.jsonl>
Safe to /clear.
Next: /kss-docs-product NNN-slug
```

Print `Cost: n/a` when `metrics.jsonl` does not exist.

## Rules

- One `kss-explorer` confirms the as-built paths; you never read the source yourself.
- Sections are exactly the eight listed, in that order — none added, none dropped.
- **Never duplicate the feature folder** — link to it.
- Cap 12k chars; overflow goes to `notes/` and is linked.
- A re-run rewrites the whole doc, keeps the index line and appends `## Changelog`.
- The index gets one line per feature under `## Technical`; create the index with a 2–3 paragraph
  summary confirmed in one turn only when it is missing.
- File names, headings and field names are English; the prose inside the document follows the
  language of the conversation.
