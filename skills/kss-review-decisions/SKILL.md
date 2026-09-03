---
name: kss-review-decisions
description: Optional KSS phase — show every decision kss-investigate took without asking, sorted by confidence, and accept, reopen or override them in a single turn. Run it after kss-investigate, or later to revisit an auto decision.
argument-hint: NNN-<slug>
disable-model-invocation: true
---

# kss-review-decisions

Give the user one look at everything the investigation decided on its own. You print a single
table of the auto decisions, weakest confidence first, and take **one answer**: accept them all,
or a list of reopens and overrides. This is one turn — there is no interview here, and no
follow-up question. Nothing is ever deleted: an accepted decision is marked reviewed, a reopened
one becomes an open item for the grill, an overridden one keeps its entry and gains a `D-` that
supersedes it.

## Inputs

- `<features_root>/NNN-slug/auto-decisions.md` — **only this file.**
- `.kss/config.md`, to resolve `features_root`.
- `~/.kss/preferences.md` — `conversation_language` for everything printed in this session.

**Do not read:** `01-investigation.md`, `00-brief.md`, `03-spec.md`, `04-plan.md`, any ticket, any
source file, any test. Do not spawn explorers or any other agent. Everything you need — decision,
alternatives, evidence, confidence — is already in `auto-decisions.md`.

## Preconditions

1. `.kss/config.md` must exist, else stop with: `No .kss/config.md found. Run /kss-init first.`
2. The feature folder must exist, else stop with: `No feature NNN-slug under <features_root>.`
3. `auto-decisions.md` must exist and hold at least one `AD-` entry. If it is missing or empty,
   stop with exactly:
   `No auto decisions for NNN-slug — nothing to review. Next: /kss-grill NNN-slug.`
4. `README.md` must show the Investigation block filled. If it does not, stop with:
   `NNN-slug has not been investigated yet. Run /kss-investigate first.`

## Procedure

1. Read `auto-decisions.md` and parse every `AD-NN` entry.
2. Print **one table**, sorted by **confidence ascending** (low → medium → high; ties keep their
   ID order), with these columns exactly:

   ```
   ID | Type | Verdict | Decision | Confidence + evidence
   ```

   Include entries already marked `reviewed: yes`, `reopened` or `overridden`, showing their
   current status in the ID cell — the user is looking at the whole picture, not a queue.
3. Ask for **one answer** and wait. State the accepted forms:

   ```
   accept all
   reopen AD-04, override AD-03: cursor pagination
   ```

   Reopen and override may be mixed in one line; anything not named is accepted.
4. Apply the answer:

   | Answer | Effect |
   | --- | --- |
   | accept | `reviewed: yes` |
   | reopen | `status: reopened`; the item becomes open for the grill |
   | override | `status: overridden`, plus a `D-` entry in `02-decisions.md` carrying the user's text and a link back |

   An override's `D-NN` is numbered after the highest existing `D-` in `02-decisions.md`; create
   the file from `.kss/templates/02-decisions.md` if it does not exist. Its `Links:` field points
   at the `AD-NN` it replaces, and the `AD-NN` entry gains a link forward to the `D-NN`.
5. **Never delete an entry, a field or a line.** Status changes are edits in place; the original
   decision, alternatives and evidence stay readable.
6. If this run happens **after the grill or the spec**, record in `README.md`
   `decisions changed after spec: AD-03 → D-06` for each override or reopen, and say in the
   summary that re-running `/kss-spec NNN-slug` rewrites only the affected FRs.
7. Do not ask anything else. One turn, then the summary.

## Outputs

- `<features_root>/NNN-slug/auto-decisions.md` — statuses updated in place, template
  `.kss/templates/auto-decisions.md`.
- `<features_root>/NNN-slug/02-decisions.md` — a `D-NN` appended per override, from
  `.kss/templates/02-decisions.md`.
- The **Decisions** block of `README.md` only, ≤10 lines:

  ```
  Reviewed: <n> auto decisions · accepted <n> · reopened <ids> · overridden <ids → D-ids>
  Open for the grill: <n>
  <decisions changed after spec: AD-03 → D-06>   (only when run after spec)
  ```
- `.kss/current` (DESIGN.md §3.3):
  `node .kss/scripts/current.mjs set '{"feature":"NNN-slug","phase":"review-decisions","phase_started_at":"<ISO-8601>","explorers":null}'`
  or the same JSON written directly, fields `feature` and `phase`. This phase spawns nothing, so
  `explorers` is cleared (`null` deletes the key) rather than set to `0`.

## Summary

Print exactly:

```
Review-decisions done · NNN-slug
Accepted: <ids or none>
Reopened: <ids or none>
Overridden: <AD-id → D-id, …, or none>
Open for the grill: <n>
Cost: <line rendered from metrics.jsonl>
Safe to /clear.
Next: /kss-<next> NNN-slug
```

`Next` is `/kss-grill` when there is at least one open item, `/kss-spec` otherwise. When the run
happened after the spec, `Next: /kss-spec NNN-slug` — it rewrites only the affected FRs.

## Rules

- Reads `auto-decisions.md` only. No other file, no code, no explorers.
- One table, sorted by confidence ascending, in the ID / Type / Verdict / Decision / Confidence +
  evidence format.
- Exactly one answer, one turn. No interview, no follow-up question, no derived question.
- Anything not named in the answer is accepted.
- accept → `reviewed: yes`; reopen → `status: reopened` and open for the grill; override →
  `status: overridden` plus a `D-` in `02-decisions.md` linking back.
- Nothing is ever deleted — statuses change in place.
- The skill is optional and may run after the grill or the spec; then the README records
  `decisions changed after spec: AD-xx → D-yy` and only the affected FRs are rewritten later.
- Write only `auto-decisions.md`, `02-decisions.md` and the Decisions block of `README.md`.
- Terminal output follows `conversation_language` from `~/.kss/preferences.md` (absent: the user's
  language). Document content follows `docs_language` from `.kss/config.md` (absent: the
  conversation's language). File names, headings, field names and identifiers stay English.
