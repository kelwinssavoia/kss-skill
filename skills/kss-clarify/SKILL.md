---
name: kss-clarify
description: First KSS phase — turn a vague request into a brief, pick size and track, then create the feature folder and branch. Run it at the start of every feature, before any code is read.
argument-hint: <free text | path | url>
disable-model-invocation: true
---

# kss-clarify

Turn the user's request — free text, a file path, or a URL — into a short, verifiable brief, and
decide how much process the work deserves. This phase is a conversation, not an investigation:
you ask at most five questions, one per turn, propose a size and a track, ask for the feature
name, and only then, after an explicit confirmation, create the feature folder and the branch.
You never read code here; guessing at the implementation is the investigation's job, not yours.

## Inputs

Read, in this order:

- `.kss/config.md` — the project's KSS configuration.
- `CONTEXT.md` at the repository root, if it exists (domain glossary).
- The argument: free text as given; a path → read that file; a URL → fetch it.

**Do not read:** any source file, `README.md` of the repository, `docs/adr/`, tests, `package.json`,
the existing feature folders' phase files, or anything under `node_modules`. No `grep` over the
codebase, no `Explore`/`kss-explorer` agents. If a fact about the code is needed, it becomes an
**Open fact** in the brief — the investigation answers it.

## Preconditions

1. `.kss/config.md` must exist. If it does not, stop with exactly:
   `No .kss/config.md found. Run /kss-init first.`
2. The argument must be non-empty. If it is, stop with exactly:
   `kss-clarify needs a request. Usage: /kss-clarify <free text | path | url>`
3. The worktree must be clean (`git status --porcelain` is empty). If it is not, stop with exactly:
   `Worktree is dirty. Commit or stash before starting a feature.`
   Check this before the interview, and again before creating anything.

## Procedure

1. Read the inputs. Restate the request in one sentence so the user can correct it.
2. Interview the user **one question per turn**, **at most 5 questions total**. Ask only what is
   still missing; a brief that is already complete needs zero questions. Keep asking until the
   brief holds all of:
   - **Symptom** — what is wrong or absent today.
   - **Expected outcome** — one verifiable sentence.
   - **Actors and surfaces** — who does it, and where.
   - **Out of scope** — what this feature explicitly does not do.
   - **Layers touched** — one of `ui` · `ui+api` · `ui+api+data` · `api+data` · `data` ·
     `contract`. When unsure, write `confirm in investigation`.
   - **Open facts** — everything that needs the code to answer.
3. Propose a **Size** and a **Track**, printing this table verbatim and marking the row you propose:

   | Size | Criteria | Track |
   | --- | --- | --- |
   | S | one layer, one surface, no new data or contract | clarify → ticket → execute |
   | M | two layers, or one new endpoint, no new entity | clarify → investigate → spec → plan → tickets → execute → review |
   | L | new entity, contract change, cross-service flow, or any "confirm" on data | all phases, grill included |

   The user confirms or changes the size. This turn does not count against the 5 questions.
4. **The final question asks for the feature name.** Nothing else follows it.
5. Derive the identifier. `NNN` is the highest existing number under `features_root` **+ 1**, or
   `next_number` from the config when that is greater. Zero-padded to three digits. The slug is
   the feature name in kebab-case.
6. Print exactly:
   `Creating <features_root>/NNN-slug and branch <branch_prefix>NNN-slug from <base_branch>. Confirm?`
   **Create nothing before the user confirms** — no folder, no file, no branch, no `.kss/current`
   write. If the branch `<branch_prefix>NNN-slug` already exists, stop with
   `Branch <branch_prefix>NNN-slug already exists. Pick another name or delete it.`
7. On confirmation: create the folder, create and check out the branch from `base_branch`, write
   the outputs, then print the summary.

## Outputs

- `<features_root>/NNN-slug/00-brief.md` from `.kss/templates/00-brief.md`, every placeholder
  filled; `## Source` holds the original request verbatim.
- `<features_root>/NNN-slug/README.md` from `.kss/templates/feature/README.md`, with the header
  (State, Size, Track, Branch, Next) and the **Brief** block filled. Leave every other block as
  `—`. Cap 4k chars.
- Brief block text, ≤10 lines:

  ```
  Symptom: <one line>
  Outcome: <the verifiable sentence>
  Actors/surfaces: <list>
  Layers: <value>
  Out of scope: <list>
  Open facts: <n> — see 00-brief.md
  ```
- `.kss/current` — the schema is DESIGN.md §3.3; a new feature clears whatever the last run left:

  ```bash
  node .kss/scripts/current.mjs set '{"feature":"NNN-slug","phase":"clarify",
    "phase_started_at":"<ISO-8601>","ticket":null,"tickets":null,"execution":null,
    "review":null,"explorers":null}'
  ```

  (`null` deletes a key; the command deep-merges everything else.) If the script is unavailable —
  `kss-init` has not run — write the same JSON to `.kss/current` directly, keeping at least
  `feature` and `phase`. This phase spawns no explorers, so `explorers` is absent, never `0`.

## Summary

Print exactly:

```
Clarify done · NNN-slug
Size: <S|M|L> · Track: <the track line>
Brief: <the expected-outcome sentence>
Open facts: <n>
Branch: <branch> → <base_branch>
Cost: <line rendered from metrics.jsonl>
Safe to /clear.
Next: /kss-<next> NNN-slug
```

`<next>` is `tickets` on S, and `investigate` on M and L. The `Cost:` line is rendered from
`<features_root>/NNN-slug/metrics.jsonl`; when the file does not exist yet, print `Cost: n/a`.

## Rules

- No code is read in this phase. Config and `CONTEXT.md` only.
- At most 5 questions, strictly one per turn.
- The last question is always the feature name.
- Nothing is created before the user confirms the "Creating … Confirm?" line.
- Stop if the branch already exists or the worktree is dirty.
- The expected outcome is one sentence and must be verifiable.
- A fact that needs the code is an Open fact, never a guess.
- `NNN` = highest existing under `features_root` + 1, or `next_number` when greater.
- Write only `00-brief.md` and the Brief block of `README.md`; never another phase's file or block.
- `README.md` stays under 4k chars; overflow goes to `notes/` and is linked.
- File names, headings and field names are English; the prose inside the documents follows the
  language of the conversation.
