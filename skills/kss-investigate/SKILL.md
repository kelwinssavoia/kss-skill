---
name: kss-investigate
description: Second KSS phase — read-only explorers map where the feature lives and what to reuse, and every decision is classified auto or open. Run it after kss-clarify on an M or L track.
argument-hint: NNN-<slug> [--model opus]
disable-model-invocation: true
---

# kss-investigate

Answer, with evidence, every question the brief left open: where the feature lives, what already
exists to reuse, which data and contracts it touches, and what the tests cover today. You do this
through **read-only explorers running in parallel** — the main session spawns them, reads their
returns, and synthesizes. The main session never reads code itself. The phase ends by splitting
every decision the feature needs into business, layout and technical, and marking each one
`settled`, `default` or `open`; the auto ones are recorded so they can be reviewed, the open ones
go to the grill.

## Inputs

- `<features_root>/NNN-slug/README.md`
- `<features_root>/NNN-slug/00-brief.md`
- `.kss/config.md`
- `~/.kss/preferences.md` — `conversation_language` for everything printed in this session.
- The files listed in `domain_docs` (glossary, ADR index)

**Do not read:** any source file, test, migration, proto or component — explorers read those and
report back. Do not read `03-spec.md`, `04-plan.md` or any later phase file. Never tell an
explorer to read the files in `standards` (`CLAUDE.md` and friends): they are already in its
system prompt.

## Preconditions

0. **Sweep** (DESIGN.md §3.8). Run
   `git status --porcelain -- <features_root> <every path in domain_docs> <docs_root> .kss/config.md`.
   If it lists anything, the previous phase's `SessionEnd` metrics line (written by the hook
   *after* that phase committed) or a forgotten artifact is sitting in the tree: commit it now,
   `git add <those paths> && git commit -m "docs(NNN): <previous phase> artifacts"`, and say so
   in one line. Never stash or discard it, never mix it into this phase's commit.

1. `.kss/config.md` must exist, else stop with: `No .kss/config.md found. Run /kss-init first.`
2. The feature folder must exist with a `00-brief.md`, else stop with:
   `No brief for NNN-slug. Run /kss-clarify first.`
3. `README.md` must show the Brief block filled and State `clarify` (or a later phase, when
   re-running). If the Brief block is empty, stop with:
   `NNN-slug has no brief block. Run /kss-clarify first.`
4. Run `node .kss/scripts/next.mjs <features_root>/NNN-slug --check investigate`. On `off-track`
   (an S feature) stop with:
   `NNN-slug is size S — investigation is not part of its track.` followed by the line from
   `node .kss/scripts/next.mjs <features_root>/NNN-slug --after clarify`.

## Procedure

1. Read the inputs and derive the questions from the brief:

   | Source in the brief | Question to ask |
   | --- | --- |
   | each surface | where does it live, and its call chain down to the layers in scope |
   | each layer touched | existing patterns that do something similar, and the tests covering them |
   | each open fact | the fact, verbatim |
   | `domain_docs` present | the glossary terms and the ADRs in force for this area |

2. Group the questions into **1–5 explorers** — never more than 5; group the questions when there
   are more. Each explorer is spawned with the agent type **`kss-explorer`**, model
   `explorer_model` from the config. **Spawn them all in parallel, in one message.**
3. **Escalate to opus** any question touching a contract, tenant/authorization, or money. Before
   spawning, print verbatim:

   > This question touches `<area>`; spawning an Opus explorer for it.

   `--model opus` in the argument forces opus for every explorer, with no per-question warning.
4. Every explorer brief states the question, the layers in scope, and this return format, ≤2k chars:

   ```
   Answer:
   Evidence: <file:line>   (max 8)
   Reuse:
   Unknown:
   ```

   It also states: read-only; grep first, then read ranges; never read a whole file over 300
   lines; never touch `node_modules`.
5. Update `.kss/current` when the explorers are spawned and again as they return, so the
   statusline can show `N explorers running · x/N returned`. `explorers` is always the object
   `{"running": <fan-out size>, "returned": <how many are back>}` — never a bare number.
6. **Synthesize only.** Write `01-investigation.md` from the returns. If a return is thin, spawn
   one more explorer for the gap — still within the cap of 5 at a time. Do not open the files
   yourself to "check".
7. Classify every decision the feature needs into `### Business`, `### Layout`, `### Technical`,
   and give each a verdict:

   | Verdict | Meaning | Handling |
   | --- | --- | --- |
   | `settled` | an ADR, a glossary term or a single existing pattern answers it | auto |
   | `default` | one alternative dominates — ≥3/4 of comparable places, or an exact design-system component | auto |
   | `open` | a real fork, or a question of intent | goes to the grill |

   **Business decisions are never auto** — they are always `open`. **Layout is auto only on an
   exact match** in a `layout_references` entry. If `auto_decide: false` in the config, every
   decision is `open`.
8. Revise the size if the evidence demands it, recording in `01-investigation.md`:
   `Size revised: S → L, reason: …`, and updating the README header.

9. **Decision check — M track only** (DESIGN.md §8.4). Run
   `node .kss/scripts/next.mjs <features_root>/NNN-slug --check grill`: when it prints `optional`
   this feature has no grill, and this is the last time a human sees the decisions before the spec
   is written from them. On L (`on-track`) skip this step — the grill is the interview.

   a. Print **one table** with every decision, auto and open, business → layout → technical and,
      inside a category, open first then confidence ascending:

      ```
      ID | Type | Verdict | Question | Decision / proposed | Confidence + evidence
      ```

      Open items get a provisional id `O-N` and a **proposed** answer — the lean the explorers
      found, or `no lean — needs you`.
   b. Ask for **one answer** and wait, stating the accepted forms verbatim:

      ```
      ok                                   accept every auto decision and every proposal
      O-2: <decision>, AD-04: <override>   decide or override by id; anything not named is accepted
      defer O-3: <owner>, <date>           park an open item as a DF-
      grill                                stop here and run /kss-grill instead
      ```
   c. Apply it as `kss-review-decisions` and `kss-grill` would: accepted `AD-` → `reviewed: yes`;
      an override → `status: overridden` plus a `D-` in `02-decisions.md` (create it from
      `.kss/templates/02-decisions.md`) linking back; every `O-` decided — by proposal or by the
      user — → a `D-` whose Decision is the chosen text and whose Why cites the investigation
      evidence; `defer` → a `DF-` with owner and date. Number `D-`/`DF-` after the highest
      existing one. **No open item may be left without a `D-` or a `DF-`**: if the answer leaves
      one, ask again for those ids only — one turn, one table. Business decisions are proposed
      but never accepted silently; `ok` accepts them because the user typed it.
   d. Fill the **Decisions** block of `README.md` in the grill's shape, ≤10 lines:

      ```
      Decided inline: yes
      Decided: D-01…D-NN (business <n> · layout <n> · technical <n>)
      Overrode: <AD-id → D-id, …, or none>
      Deferred: <DF-ids with owners, or none>
      ```
   e. `grill` skips c–d, leaves everything as classified, and the summary's Next comes from
      `next.mjs --after investigate --escalate grill`.


## Outputs

- `<features_root>/NNN-slug/01-investigation.md` from `.kss/templates/01-investigation.md`, ≤12k
  chars: Where it lives · Existing patterns to reuse · Domain terms and decisions in force · Data
  and contracts touched · Test coverage today · Facts still missing · `## Decisions` split into
  Business / Layout / Technical. Overflow goes to `notes/` and is linked, never inlined.
- `<features_root>/NNN-slug/auto-decisions.md` from `.kss/templates/auto-decisions.md`, one entry
  per auto decision:

  ```
  ## AD-NN · <type> · <verdict>
  Decision:
  Alternatives:
  Evidence:
  Confidence:
  Status: auto · reviewed: no
  ```
- The **Investigation** block of `README.md`, ≤10 lines: the layers confirmed, and the count of
  auto and open decisions per category.
- **M only**, from the decision check: `02-decisions.md` (`D-`/`DF-` entries), the `reviewed` /
  `overridden` statuses in `auto-decisions.md`, and the **Decisions** block of `README.md`.
- The README header `**Next:**` — the output of `node .kss/scripts/next.mjs … --after investigate`
  (with `--escalate grill` when the user chose the grill).
- `.kss/current` (DESIGN.md §3.3) — on spawn:

  ```bash
  node .kss/scripts/current.mjs set '{"feature":"NNN-slug","phase":"investigate",
    "phase_started_at":"<ISO-8601>","explorers":{"running":<n>,"returned":0}}'
  ```

  and after each return `node .kss/scripts/current.mjs set '{"explorers":{"returned":<k>}}'`.
  Or the same JSON written directly, fields `feature`, `phase`, `explorers`.

## Summary

**Commit before printing** (DESIGN.md §3.8): every artifact this phase wrote goes on the feature
branch now — `git add <features_root>/NNN-slug <domain_docs paths touched> <docs_root paths touched>
.kss/config.md && git commit -m "docs(NNN): investigate"`. Then
`git status --porcelain -- <those paths>` must be empty; if it is not, stop with
`Uncommitted feature artifacts: <paths>` instead of printing the summary. `.kss/current` is
gitignored and never part of this.

Print exactly:

```
Investigate done · NNN-slug
Found:
  <line 1>
  <line 2>
  <line 3>
Size: <S|M|L><, revised from X> · Track: <track>
Decisions:
  Auto: AD-01, AD-02, …
  Open · business: <one line each>          (L — these go to the grill)
  Open · layout: <one line each>
  Open · technical: <one line each>
  Decided inline: D-01…D-NN · deferred: <DF-ids or none>   (M — from the decision check)
Cost: <line rendered from metrics.jsonl>
Safe to /clear.
Next: <output of node .kss/scripts/next.mjs <features_root>/NNN-slug --after investigate [--auto <n>] [--escalate grill]>
```

The `Next:` line is **never written by hand**: it is the output of
`node .kss/scripts/next.mjs <features_root>/NNN-slug --after investigate`, which knows the track of the
feature's size (DESIGN.md §3.9). Copy it verbatim into the summary and into the README header. Pass `--auto <n>`
(the number of `AD-` entries) so L gets the `/kss-review-decisions` offer, and `--escalate grill`
when the user answered `grill` in the decision check. On L the result is `/kss-grill`; on M it is
`/kss-spec` — never `/kss-grill` unless escalated, never `/kss-review-decisions`.

## Rules

- The main session synthesizes; it never reads code. Explorers read.
- 1–5 explorers, in parallel, agent type `kss-explorer`, cap 5 — group questions beyond that.
- Opus is auto-escalated for contract, tenant/authorization and money questions, with the warning
  printed before the spawn. `--model opus` forces opus for all.
- Explorers are read-only: grep first, read ranges, never a whole file over 300 lines, never
  `node_modules`, never told to read the `standards` files.
- Explorer returns are ≤2k chars in the Answer / Evidence / Reuse / Unknown format, max 8 evidence
  lines.
- Business decisions are never auto. Layout is auto only on an exact `layout_references` match.
  `default` requires ≥3/4 of comparable places.
- Every auto decision is written to `auto-decisions.md`; nothing there is ever deleted.
- `01-investigation.md` is ≤12k chars; overflow goes to `notes/` and is linked.
- Write only `01-investigation.md`, `auto-decisions.md` and the Investigation block of `README.md`.
- A size revision is recorded with its reason.
- Terminal output follows `conversation_language` from `~/.kss/preferences.md` (absent: the user's
  language). Document content follows `docs_language` from `.kss/config.md` (absent: the
  conversation's language). File names, headings, field names and identifiers stay English.
