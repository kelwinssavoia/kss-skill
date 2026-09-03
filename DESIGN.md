# KSS — Design (source of truth)

This document is the specification every builder of this plugin reads before writing a skill,
an agent, a hook or a script. It is normative: where an implementation disagrees with this
file, the implementation is wrong.

---

## 1. Purpose

KSS is a family of Claude Code skills, all prefixed `kss-`, that carries a software task from a
vague request all the way to merged-and-documented. One phase per skill, with a `/clear`
suggested at the end of every phase.

Context lives **on disk, never in the session**: a per-feature folder holds a short index
(`README.md`) plus detail files that are read only by whoever needs them.

KSS is project-agnostic. Everything project-specific comes from `.kss/config.md`.

**Language.** The plugin itself is written in English — file names, headings, field names,
identifiers, skill instructions. Two settings, on two levels, decide the rest.

| Level | File | Key | Governs | Absent |
| --- | --- | --- | --- | --- |
| User, never committed | `~/.kss/preferences.md` | `conversation_language` | Everything a skill prints: boards, questions, summaries, progress, explanations | Follow the language the user writes in |
| Project, committed | `.kss/config.md` | `docs_language` | The *content* of every artifact KSS writes into the repo: feature `README.md`, `00-brief.md` … `06-execution.md`, `notes/`, ADRs, glossary entries, `kss-docs-tech`/`kss-docs-product`, ticket files, PR body | Follow the conversation's language |

The fallback chain for a document is therefore `docs_language` → `conversation_language` → the
user's own language; for terminal output it is `conversation_language` → the user's own language.
The two are independent: a user talking Portuguese to a repository whose `docs_language` is `en`
gets Portuguese answers and English documents.

`~/.kss/preferences.md` is **user-local by design**: it is a personal preference, shared by every
project on the machine, and it must never be created inside a repository or committed. Only
`kss-init` writes it — the full run asks for it as its first question, and `kss-init --preferences`
updates only that file, without touching the project. An existing value is shown and rewritten
only on confirmation. Same fenced `key: value` style as `.kss/config.md`.

### 1.1 Motivation (measured 2026-09-03 on a real repository)

Every figure below is **deduplicated by `message.id`** — one assistant message is one turn, however
many content blocks it carries. Counting transcript *lines* instead double-counts multi-block
messages and inflates both turns and tokens; the metrics hooks in this plugin therefore dedupe by
`message.id` (see §6), and so did this measurement.

- Subagents carried a fixed baseline of roughly **47k tokens per turn**.
- The worst single agent reached **50M cumulative tokens over 192 turns**.
- The same feature, cut into **4 layer-sliced agents**, cost about **16M tokens** in total.
- A median agent cost about **4M tokens**.
- Executors re-read their inputs constantly: one spec was read **7 times**, one ticket **17
  times**.
- Coordinator sessions grew from **60k to 300k tokens** because investigation, interview and
  execution all shared one session.
- The number the Agent tool displays is the **final context size**, not the consumption.

Every rule below about caps, slicing, self-contained tickets and `/clear` points exists because
of one of these measurements.

---

## 2. The skills (13)

| Skill | Required? | Role |
| --- | --- | --- |
| `kss-init` | once per project | Writes `.kss/config.md`, installs hooks, statusline and the agent matrix |
| `kss-clarify` | yes | Turns a vague request into a brief; picks size and track; creates folder and branch |
| `kss-investigate` | M, L | Read-only explorers map the code; classifies decisions auto vs open |
| `kss-review-decisions` | optional | Review, accept, reopen or override the auto decisions |
| `kss-grill` | L (M if open items) | Interviews the user on every open decision |
| `kss-spec` | M, L | Writes the functional specification |
| `kss-plan` | M, L | Writes the implementation plan — shape, not code |
| `kss-tickets` | M, L | Slices the plan into self-contained tickets and a dependency graph |
| `kss-execute` | yes | Runs the tickets; frontier scheduling, gates, review, integration, PR |
| `kss-review` | M, L | Works the PR review round(s); optionally watches the PR |
| `kss-docs-tech` | optional | As-built technical documentation |
| `kss-docs-product` | optional | Product-facing documentation |
| `kss-status` | anytime | Prints the board; writes nothing |

**Order:** clarify → investigate → [review-decisions] → grill → spec → plan → tickets → execute
→ review → [docs-tech, docs-product].

Every skill can also be run on its own, given a feature id `NNN-<slug>`.

---

## 3. Shared conventions

### 3.1 The feature folder

```
<features_root>/NNN-<slug>/
  README.md              index — ≤4k chars, one block per phase (≤10 lines),
                         current state, next command
  00-brief.md
  01-investigation.md
  auto-decisions.md
  02-decisions.md
  03-spec.md
  04-plan.md
  05-tickets/
    NN-<slug>.md
    graph.md
  06-execution.md
  07-review.md
  metrics.jsonl
  notes/                 detail that exceeds a file's cap — linked, never inlined
```

Rules:

- Each skill writes **only its own file(s)** and **its own block** in `README.md`.
- `README.md` is the **only** file a fresh session reads at start.
- Detail that would push a file over its cap goes into `notes/` and is linked, never inlined.

### 3.2 End-of-phase summary

Every phase ends by printing a fixed summary:

```
<Phase> done · NNN-slug
<findings / decisions / equivalent for this phase>
Cost: <line rendered from metrics.jsonl>
Safe to /clear.
Next: /kss-<next> NNN-slug
```

### 3.3 State file

`.kss/current` at the repository root, JSON, gitignored. Holds the feature, the phase, and — during
execution — the per-ticket states. Written by the coordinator on every event, and by the `Stop`
hook for the session counters. Read by the statusline, by `kss-status` and by the metrics hooks
(which use it to attribute a subagent's cost to a phase and a ticket).

Absent, or present with no `feature`, means **no active run**: every hook is a no-op and the
statusline falls back.

```json
{
  "feature": "012-batch-cutoff",
  "phase": "execute",
  "phase_started_at": "2026-09-03T10:00:00.000Z",
  "ticket": "04",
  "session": { "turns": 31, "ctx": 148000, "updated_at": "…" },
  "tickets": {
    "04": {
      "state": "running",
      "agent_type": "kss-opus-high",
      "started_at": "…",
      "turns": 31,
      "est_turns": 45,
      "worktree": "/path/to/worktree"
    }
  },
  "execution": {
    "integrated": 3,
    "total": 5,
    "critical_path": "01→03→05",
    "last": "integrate 03"
  },
  "review": {
    "round": 2,
    "watching": "PR #61",
    "last_check": "…",
    "cursor": { "last_comment_at": "…", "last_ci_at": "…" }
  },
  "explorers": { "running": 3, "returned": 2 }
}
```

| Key | Written by | Meaning |
| --- | --- | --- |
| `feature` | every skill on entry | `NNN-slug`; its folder is `<features_root>/<feature>` |
| `phase` | every skill on entry | one of the skill names without the `kss-` prefix |
| `phase_started_at` | every skill on entry | ISO 8601 |
| `ticket` | `kss-execute` | the ticket a subagent's cost is attributed to; absent outside execute |
| `session.turns` / `session.ctx` | the `Stop` hook | running turn count and last context size of the main session |
| `tickets.<NN>` | `kss-execute` | a **map keyed by ticket id**; each value is `{state, agent_type, started_at, turns, est_turns, worktree}`, `state` exactly `blocked` \| `ready` \| `running` \| `reviewing` \| `rejected` \| `integrated` |
| `execution` | `kss-execute` | roll-up of the run: `integrated`, `total`, `critical_path`, `last` (the last event, as printed on the board) |
| `review` | `kss-review` | `round`, `watching` (the watch target the statusline prints, absent when not watching) and `cursor` `{last_comment_at, last_ci_at}`, which the next round reads from; `pr`, `state`, `open` and `held` are optional extras |
| `explorers` | `kss-investigate`, `kss-plan`, `kss-grill` | always the object `{running, returned}` — the size of the fan-out and how many are back, for the statusline. Never a bare number; absent when nothing is out |

Every key is optional; a reader treats a missing key as unknown and prints `—`. Writers merge
rather than replace — `node .kss/scripts/current.mjs set '<json-patch>'` does the deep merge, and
`node .kss/scripts/current.mjs get [dot.path]` reads. (`kss-init` copies the scripts into
`.kss/scripts/`; see §5 — `${CLAUDE_PLUGIN_ROOT}` is only guaranteed inside hooks, so no skill may
rely on it.)

`tickets` is a **map**, never an array — the map is the only accepted form. `current.mjs set` deep-
merges objects, so one ticket can be updated on its own
(`{"tickets":{"04":{"state":"integrated"}}}`), whereas an array would have to be resent complete on
every event. `null` as a value deletes a key, so a phase that owns none of these clears them with
`{"tickets":null,"execution":null,"review":null}`.

### 3.4 Identifiers

| Prefix | Meaning |
| --- | --- |
| `AD-NN` | Auto decision (taken by `kss-investigate`) |
| `D-NN` | Decision taken in the grill |
| `DF-NN` | Deferred decision |
| `FR-NN` | Functional requirement |
| `US-N` | User story |
| `RV-NN` | Review finding |

### 3.5 Caps

| Artefact | Cap |
| --- | --- |
| `README.md` | 4k chars |
| `00-brief.md` | small |
| `01-investigation.md` | 12k |
| `03-spec.md` | 15k |
| `04-plan.md` | 20k |
| Ticket report-back | 1.5k |
| Helper return | 1.5k |
| Docs (`docs-tech`, `docs-product`) | 12k each |

Over cap → move the excess into `notes/`, or the skill refuses and explains. A spec over 15k is
refused with "split the feature".

### 3.6 Subagent budget

A subagent is budgeted at **≤ ~80 turns** and **≤ ~150k context**. A ticket estimated above 80
turns is re-sliced — never written and shipped with a warning.

### 3.7 Explorers

Explorers are read-only. They grep first, read ranges, never read a whole file over 300 lines,
never touch `node_modules`, and are never told to read `CLAUDE.md` (it is already in their
system prompt).

---

## 4. `.kss/config.md`

Created by `kss-init`.

```
features_root: docs/features
next_number: 12            # used only when greater than the highest existing NNN
base_branch: main
branch_prefix: ""
domain_docs: [CONTEXT.md, docs/adr/]
layout_references: []      # e.g. design/…/, packages/design-system/README.md
standards: [CLAUDE.md]     # files whose rules bind explorers and executors
explorer_model: sonnet
auto_decide: true          # false = every decision is asked
execution: multi-agent     # or single-session
full_suite: ci             # or local
tracker: none              # or trello / github / … — optional
review_autopilot: fixes    # fixes | all | none
docs_root: docs
docs_index: docs/README.md
docs_language: ""          # empty = generated documents follow the conversation
```

The language of what the skills *print* is deliberately **not** here: it is a personal preference,
kept in the user-local `~/.kss/preferences.md` (§1) and never committed to a project.

```
conversation_language: pt-BR
```

---

## 5. `kss-init`

Interactive, **one question per turn**. Asks for the config values (offering defaults), whether
execution is multi-agent or single-session, the layout references and the standards files. Its
first question is the user-local one — "Preferred language for conversation output? (blank =
follow the user's messages)" — and its last config question is "Language of generated documents in
this project? (blank = follow the conversation)". `kss-init --preferences` asks only the first and
writes only `~/.kss/preferences.md`, touching nothing in the project.

It then:

0. Writes `~/.kss/preferences.md` when the conversation language was given or changed, creating
   `~/.kss/`. Outside the repository, always; an existing value is rewritten only on confirmation.
1. Writes `.kss/config.md`.
2. Copies `templates/` into the project's `.kss/templates/`, so the skills read templates from the
   project and a project can customise them.
3. Copies `scripts/*.mjs` — plus `hooks/kss-lib.mjs`, which they import — into the project's
   `.kss/scripts/`. **This is why every skill calls `node .kss/scripts/current.mjs …` and
   `node .kss/scripts/render-cost.mjs …` and never `${CLAUDE_PLUGIN_ROOT}`**: that variable is
   only guaranteed to be set inside hook commands, not in the shell a skill runs. Re-running
   `kss-init` refreshes the copies.
4. Adds `.kss/current` and `.kss/worktrees/` to the project's `.gitignore` — both are live state,
   not history. `.kss/config.md`, `.kss/templates/` and `.kss/scripts/` stay tracked.
5. Installs the statusline into the user-level `~/.claude/settings.json` —
   `statusLine: {type: command, command: node <plugin>/scripts/statusline.mjs}` — after asking.
   The statusline is a *user-level* setting shared by every project, so it is the one place that
   keeps an **absolute path into the installed plugin**, resolved once at init time: `kss-init`
   looks for `~/.claude/plugins/cache/*/kss/*/scripts/statusline.mjs` (falling back to
   `find ~/.claude/plugins -type f -path '*/kss/*/scripts/statusline.mjs'`) and, when that finds
   nothing or more than one, **asks the user for the path** rather than guessing. The script reads
   `<cwd>/.kss/current`, so one installed copy serves every project.
   Any existing statusline configuration is backed up to `<project>/.kss/statusline.backup.json`;
   the KSS statusline script shows the previous statusline's output whenever no KSS run is active.

   The metrics hooks (`SubagentStop`, `SessionEnd`, `Stop`) need **no installation**: they ship in
   the plugin's `hooks/hooks.json` and merge automatically while the plugin is enabled. Every hook
   script is a no-op when `.kss/current` is absent or names no feature.
6. Creates the agent matrix in the project's `.claude/agents/` (only files that are absent; it asks
   before overwriting one):

| Agent | Model | Effort | Notes |
| --- | --- | --- | --- |
| `kss-sonnet-low` | sonnet | low | executor; may spawn helpers |
| `kss-sonnet-medium` | sonnet | medium | executor; may spawn helpers |
| `kss-sonnet-high` | sonnet | high | executor; may spawn helpers |
| `kss-opus-medium` | opus | medium | executor; may spawn helpers |
| `kss-opus-high` | opus | high | executor; may spawn helpers |
| `kss-reviewer` | opus | high | read-only |
| `kss-explorer` | sonnet | low | read-only |
| `kss-runner` | sonnet | low | runs tests / lint / tsc; returns only summary lines and failures |

There is **no `kss-opus-low`** by design, and nothing above `high`.

---

## 6. Metrics

`metrics.jsonl` lives in the feature folder. Append-only, one line per event:

```json
{
  "ts": "…", "phase": "…", "ticket": "…", "kind": "subagent|session|git",
  "agent_type": "…", "model": "…", "effort": "…", "parent": "…", "depth": 1,
  "turns": 0, "duration_ms": 0, "tool_uses": 0,
  "tokens": { "fresh_in": 0, "cache_write": 0, "cache_read": 0, "out": 0,
              "cumulative": 0, "ctx_end": 0 },
  "git": { "files": 0, "added": 0, "deleted": 0, "commits": 0 }
}
```

Rules:

- Tokens are summed from the transcript JSONL `usage` field per assistant turn — **never** from
  the number the Agent tool displays.
- **The hooks deduplicate by `message.id`** (falling back to `requestId`/`uuid`): one assistant
  message is one turn and is counted once, however many content blocks or transcript lines it
  spans. Counting lines double-counts multi-block messages — that is what inflated the first
  measurement in §1.1.
- The `SubagentStop` hook records subagents, with `parent` and `depth`.
- The `SessionEnd` hook (reason `clear` or `exit`) records the main session's phase cost,
  attributed via `.kss/current`.
- `kss-execute` records git statistics per integrated ticket.
- `README.md` gets a rendered `## Cost` table, one row per phase: agents, turns, cumulative
  tokens split by type, wall time, files, +/−.

---

## 7. `kss-clarify <free text | path | url>`

Reads `.kss/config.md` and `CONTEXT.md` if present. **Nothing else — no code.**

One question per turn, at most 5, until the brief contains:

- **Symptom**
- **Expected outcome** — one verifiable sentence
- **Actors and surfaces**
- **Out of scope**
- **Layers touched** — `ui` | `ui+api` | `ui+api+data` | `api+data` | `data` | `contract`;
  write "confirm in investigation" when unsure
- **Open facts**

It then proposes a **Size** and a **Track**:

| Size | Criteria | Track |
| --- | --- | --- |
| S | one layer, one surface, no new data or contract | clarify → ticket → execute |
| M | two layers, or one new endpoint, no new entity | clarify → investigate → spec → plan → tickets → execute → review |
| L | new entity, contract change, cross-service flow, or any "confirm" on data | all phases, grill included |

The user confirms the size. The final question asks for the feature name.

`NNN` is derived as the highest existing number + 1, or `next_number` when that is greater. The
slug is kebab-case.

The skill prints `Creating <folder> and branch <prefix>NNN-slug from <base>. Confirm?` —
**nothing is created before confirmation**. On confirmation it creates the folder, creates and
checks out the branch, writes `00-brief.md` and the Brief block of `README.md`.

It stops if the branch already exists or the worktree is dirty. It ends with the standard
summary and Next line.

---

## 8. `kss-investigate`

Reads `README.md`, `00-brief.md`, the config and `domain_docs`.

### 8.1 Questions

Built from the brief:

- per surface — "where does it live, and its call chain down to the layers in scope";
- per layer — "existing patterns that do something similar, and the tests covering them";
- each open fact, verbatim;
- one domain agent for the glossary and ADRs, if those docs exist.

### 8.2 Explorers

1–5 read-only explorers in parallel (cap 5; group the questions when there are more). Default
model is sonnet. The skill **auto-escalates to opus** for any question touching contract,
tenant/authorization or money, printing

> This question touches `<area>`; spawning an Opus explorer for it.

before spawning. `--model opus` forces opus for all of them.

Explorer return format, ≤2k chars: **Answer / Evidence (file:line, max 8) / Reuse / Unknown**.

The main session only **synthesizes** — it does not read code itself.

### 8.3 Output

`01-investigation.md` (≤12k):

- Where it lives
- Existing patterns to reuse
- Domain terms and decisions in force
- Data and contracts touched
- Test coverage today
- Facts still missing
- `## Decisions`, split into `### Business`, `### Layout`, `### Technical`

Each decision carries a verdict:

| Verdict | Meaning | Handling |
| --- | --- | --- |
| `settled` | an ADR, a glossary term or a single existing pattern answers it | auto |
| `default` | one alternative dominates — ≥3/4 of comparable places, or an exact design-system component | auto |
| `open` | a real fork, or a question of intent | goes to the grill |

**Business decisions are never auto.** Layout is auto only with an exact match in
`layout_references`.

Auto decisions are also written to `auto-decisions.md`, one entry each:

```
## AD-NN · <type> · <verdict>
Decision:
Alternatives:
Evidence:
Confidence:
Status: auto · reviewed: no
```

The skill may revise the size, recording `Size revised: S → L, reason: …`.

README block: layers confirmed, decisions auto/open per category.

End summary shows: Found (3 lines), Size, Decisions (the auto IDs as a list; the open ones with
one line each, per category), Cost, and Next — `/kss-review-decisions` (optional), then
`/kss-grill`, or `/kss-spec` when there are no open items on an M track.

---

## 9. `kss-review-decisions` (optional)

Reads `auto-decisions.md` **only**.

Prints one table sorted by confidence ascending — ID, type, verdict, decision, confidence +
evidence — and waits for a **single** answer: either `accept all`, or a list such as
`reopen AD-04, override AD-03: cursor pagination`.

| Answer | Effect |
| --- | --- |
| accept | `reviewed: yes` |
| reopen | `status: reopened`; the item becomes open for the grill |
| override | `status: overridden`, plus a `D-` entry in `02-decisions.md` carrying the user's text and a link back |

Nothing is ever deleted.

It can also run after the grill or the spec. In that case `README.md` records
`decisions changed after spec: AD-03 → D-06`, and re-running `kss-spec` rewrites only the
affected FRs.

One turn. No interview.

---

## 10. `kss-grill`

Reads `README.md`, the Decisions section of `01-investigation.md` (**open items only**), the
auto-decision IDs, `CONTEXT.md` and the ADR index.

Asks the open items **one per turn**, in the order business → layout → technical. There is no
cap on the number of questions.

Question format:

```
Qn · <category> · from <source>
<the question>
Options found in the repo:
  a) …
  b) …
  …) something else
Lean: <only when there is one>
```

A `Lean:` is never offered for a business question — business options are consequences, not
recommendations.

The grill spawns nothing, unless an answer needs a repo fact that was not fetched: then one
sonnet explorer. **It never asks the user for facts.**

Rules:

- Never asks about a `settled` or `default` item.
- An answer contradicting an AD marks it `overridden` and creates a new `D-`.
- At most **one derived question per answer**; further branches go to Deferred or back to
  investigation.
- "Don't know" / "later" → a `## Deferred` entry `DF-NN` with an owner and a date.

Domain modeling is embedded: new or conflicting terms are fixed in one turn and written to
`CONTEXT.md`; architectural, data and contract decisions become ADRs in `docs/adr/`, which
`02-decisions.md` links to.

Closing turn: "Decided N, deferred N, overrode …. Anything to revisit?"

Writes `02-decisions.md`:

```
## D-NN · <category>
Question:
Decision:
Why:
Rejected:
Links:
Terms:
```

plus the README block. On an M track the grill runs only if there are open items; on L it always
runs.

---

## 11. `kss-spec`

Reads `README.md`, `00-brief.md`, `02-decisions.md`, `auto-decisions.md`, the investigation
sections *Where it lives*, *Data and contracts* and *Test coverage*, and the layout view the
brief points to.

### 11.1 Input audit (first)

- Every open decision must be a `D-`, `AD-` or `DF-` — otherwise stop and go back to the grill.
- Every `DF-` has an owner and a date.
- Every actor and surface appears somewhere — otherwise flag it under Open items.
- The layout view exists — otherwise flag it. **Never invent a layout.**

### 11.2 One turn

Proposes the **Test seams**: existing seams before new ones, highest first; a new seam only when
a project rule requires it, and the rule is named. The user confirms.

### 11.3 Output

`03-spec.md` (≤15k):

- Problem
- Solution
- User stories
- **Functional requirements** — `FR-NN · Given/when/then, one sentence, [D-xx, AD-yy]`. An FR
  without a citation is refused.
- **Non-functional requirements** — only those the `standards` impose *and* the feature
  triggers, each citing its rule.
- Test seams
- Contracts and data — a list, with the file each one lives in
- Layout — file and view per surface, design-system components confirmed
- Out of scope
- Open items — the `DF-` entries with owners
- **Traceability** — Story→FRs and Decision→FRs. A decision with no FR is a warning; a story
  with no FR is an error; an FR blocked by a `DF-` is marked as such.

Revision: re-running rewrites only the FRs that cite changed decisions, and appends
`## Revision N`.

Over 15k → refuse and suggest splitting the feature.

---

## 12. `kss-plan`

Reads `README.md`, `03-spec.md`, the decisions and the investigation sections.

Spawns sonnet explorers for file-level facts — signatures, model and message shapes, component
props — and opus (with the warning) for contract, tenant or money questions.

The plan designs **shape, not code**. A missing product or architecture decision stops the plan
and sends it back to the grill.

### 12.1 Output

`04-plan.md` (≤20k):

- **Approach**
- **Models and data** — per entity `new | changed | read`, its fields with type and nullability,
  migration yes/no
- **Contracts** — per message or endpoint, the exact shape on both sides, and the audit spec
- **Services and flows** — signatures, and a numbered sequence per cross-service path naming
  Kafka/gRPC/HTTP for every hop
- **UI** — per surface: design-system components by name and props, where state lives, the data
  source, empty and error states, the layout view
- **Reuse** — existing helpers, components and fixtures with their paths; this is the
  "reuse before create" checklist
- **New dependencies** — name, why the current stack cannot do it, size, licence. Each one is
  confirmed by the user in its own turn; this is never skipped.
- **File map** — a table `File | Action (create / modify / —) | Layer | Why (FR)`. Every
  `create` needs a justification against Reuse.
- **Test plan** — per seam: the spec files, the cases by name, and the empty and forbidden cases
  the rules demand
- **Risks and rollout**

Every item traces back to an FR or a decision.

Approval: the skill prints the Approach, the models/contracts table and the File map, then takes
one turn for approve/adjust. Then the README block and the summary.

---

## 13. `kss-tickets`

Reads `README.md`, `04-plan.md` (File map, Test plan, Contracts, Reuse), the FRs of `03-spec.md`
and `config.execution`. **An FR blocked by a `DF-` is never scheduled.**

### 13.1 Multi-agent mode

- Slice by File map rows grouped by layer — **one layer per ticket**.
- Estimate = files to modify + specs to create, against the 80-turn cap. Above it, re-slice —
  never write the ticket with a warning.
- The **contract ticket comes first and is the smallest**.
- After the contract, service / gateway / UI run in parallel. The UI codes against the contract
  type and a mocked client, and the ticket says so.
- Minimise chain depth; compute the critical path.
- A small, mandatory final `integration` ticket whenever more than one ticket follows the
  contract.
- Each ticket declares:

| Field | Rule |
| --- | --- |
| Model | opus for contract, tenant, money, wire specs and design-deciding work; sonnet otherwise |
| Effort | low = one layer, 1–2 files, copying an existing pattern · medium = one layer, several files, fitting the plan to the code · high = contract / wire / tenant / money / cross-service / debugging |
| Helpers | `explorer`, `runner`, or none. Depth max 2; helpers never write code; ≤5 per ticket; helper return ≤1.5k |
| Worktree | yes |

### 13.2 Single-session mode

Vertical tracer-bullet slices, each sized to fit a fresh context. Estimated by context, not
turns. Each slice declares `/clear before: yes|no`. No worktree, no graph, no per-ticket model.
Prefactor first; a wide refactor is isolated into its own slice.

### 13.3 `graph.md`

Multi-agent: a table `# | Ticket | Layer | Blocked by | Model | Effort | Est. turns | Worktree`,
followed by Critical path, Parallel after contract, and Total estimate.

Single-session: an ordered list with Files, Est. context and `/clear before`.

### 13.4 Ticket template

The ticket is **self-contained — the ticket IS the brief**:

- Title
- Header — multi-agent: `Layer · Blocked by · Blocks · Model · Effort · Helpers · Est. ·
  Worktree`; single-session: `Order · Est. context · /clear before`
- **Goal**
- **Requirements covered** — the FR text pasted in, with its citations
- **Plan excerpt** — the File map rows, the contract shapes and the Reuse entries, pasted in
- **Files** — exact paths with line ranges; and the files to read for patterns, with ranges
- **Tests** — spec files and case names; a red run is required before implementation
- **Project rules that apply** — one line each, only the rules this ticket triggers
- **Do not** — open `03-spec.md` or `04-plan.md`; read whole files over 300 lines; run the full
  suite mid-ticket
- **Report back** — a fixed format, ≤1.5k: branch, commits, files, test command and result,
  red-run evidence, deviations

One turn to approve the graph or the sequence. If `tracker` is configured, publish one card per
ticket linking the file — the file stays the source of truth.

---

## 14. `kss-execute [--ticket NN]`

Reads `README.md`, `graph.md`, `06-execution.md` (to resume) and the config. **Never the spec or
the plan.**

### 14.1 Multi-agent

- **Continuous frontier**: spawn every ticket whose blockers are `integrated`, the moment they
  are. Never group tickets into waves.
- One worktree per ticket at **`.kss/worktrees/NNN-slug/NN`** (relative to the repository root),
  off the feature branch; branch `NNN-slug/NN-ticket`. `.kss/worktrees/` is gitignored by
  `kss-init`.
- The brief is the ticket file pasted in, plus the worktree path.
- The agent type comes from Model + Effort (`kss-opus-high`, …).
- **Gates before a report is accepted**: the format is respected and ≤1.5k; red-run evidence is
  present; the commit order is test-before-implementation, or a single commit plus the red log;
  the ticket's tests are green; deviations are justified. A failing gate sends the report back to
  the same agent with the list of what is missing.
- A `kss-reviewer` reviews every finished ticket: it reads the diff and the report and returns
  `approve`, or `reject` with numbered findings (file, line, rule or FR). **The coordinator reads
  verdicts only — never diffs.**
- **Escalation**: a reject for an execution error → the same ticket, one effort level up, in the
  same worktree, with the findings pasted in. A reasoning error → model *and* effort up. Never
  skip two levels.
- A ticket unfinished past 80 turns → stop, keep the worktree, and send it back to `kss-tickets`
  to be re-sliced. The executor never splits a ticket on its own.
- **Integration** by a sonnet-low agent: rebase, merge into the feature branch, remove the
  worktree, set the state to `integrated`, unblock the dependants. A rebase conflict goes to a
  sonnet-medium with both tickets' context, then to the reviewer again.
- **Finish**: run the full suite once via a sonnet-low agent, or skip to CI per config. Open a PR
  against `base_branch` with the feature README as the body. **Never merge** — that is a human
  decision.

### 14.2 Coordinator context

Everything the coordinator needs is in `graph.md` and `06-execution.md`. Above ~150k it prints:

> Coordinator context at Xk. State is on disk. Safe to /clear and run
> `/kss-execute NNN-slug` to resume.

Resuming recomputes the frontier from the log. A ticket marked `running` with no live worktree is
reset to `ready`.

### 14.3 Single-session

The session executes the tickets in order. Before a ticket with `/clear before: yes` it stops and
prints the suggestion. The same gates apply, self-applied. A reviewer subagent runs where the
Agent tool exists; otherwise a checklist goes into the log. Commits land on the feature branch.

### 14.4 Progress board

Printed on every event — spawn, report, verdict, integrate, escalate:

```
kss · NNN-slug · execute
███████░░░  n/N integrated · x% of estimated turns
# | Ticket | State | Agent | Turns used/est | Since
Critical path: …
Elapsed: …    Tokens: …
Last: <event>
```

The states are exactly: `blocked`, `ready`, `running`, `reviewing`, `rejected`, `integrated`.
`.kss/current` holds this state as JSON: `tickets.<NN>` per ticket, and the roll-up the board's
header and footer lines come from in `execution` (§3.3).

`06-execution.md` is an append-only log of timestamped events per ticket. The README gets an
Execution block. TDD is enforced by the red-run gate and by the commit order.

---

## 15. `kss-review [--watch]`

Reads `README.md`, the PR threads and CI via `gh`, `06-execution.md` and `graph.md`.

Collects the findings since the cursor — the last comment timestamp and last CI conclusion,
stored in `.kss/current`. Each becomes `RV-NN` with file, line, author and text; an explorer maps
each one back to the ticket and FRs it came from.

A triage table (ID, Where, From, Class, Proposal) is printed, and one turn confirms it.

| Class | Handling |
| --- | --- |
| `fix` | becomes a fix ticket, numbered after the last one, grouped by file, executed via `kss-execute` with all the gates |
| `dispute` | a reply citing the decision or rule; the text is approved by the user; no code |
| `question` | answered from the decisions — or, when it is not decided, opened for a mini grill |
| `defer` | a `DF-`, replied to as out of scope, thread left open |

A finding that contradicts a decision is **never a silent fix**: either dispute it, or override it
via `kss-review-decisions` and then fix, with the spec marked for revision.

After integrating: reply on each thread with the resolving commit or the approved text; resolve
only the threads that were fixed or answered.

Rounds are numbered in `07-review.md` — a table `ID | Where | Class | Resolution | Ticket/Reply`,
plus "Open after round". The skill ends with "Ready for merge decision". **It never merges.**

### 15.1 `--watch`

Arms a `Monitor` (not a polling subagent) that polls `gh` every 5 minutes (configurable) for new
review comments, CI conclusions, and merged/closed. On a change the coordinator wakes, runs a
round, pushes to the **PR branch** (never the base), replies, and re-arms.

Autopilot per `review_autopilot`:

- `fixes` (the default) — fixes that touch no contested decision, and CI failures, are executed
  and pushed without asking. Dispute and question replies are drafted and **held**. Deferrals are
  replied to automatically.
- `all` — everything `fixes` does, **plus** the drafted dispute and question replies are posted
  without asking.
- `none` — every round stops at the triage table and waits for the user; nothing is executed,
  pushed or posted.

**In every mode, a fix that contradicts a `D-` or an `AD-` is held** — that rule never relaxes,
not even under `all`. Held items are listed by ID on every wake.

It stops when the PR is merged or closed, when the user stops it, or after 10 rounds (then it
stops and reports). The watcher dies with the session; re-running resumes from the cursor. The
board and the statusline show `watching`.

---

## 16. `kss-docs-tech` / `kss-docs-product` (optional)

Configured by `docs_root` and `docs_index`.

**Tech** reads `README.md`, `04-plan.md`, `06-execution.md`, `02-decisions.md` and the ADRs; one
explorer confirms the as-built paths against the file map. Writes
`<docs_root>/tech/NNN-slug.md`: What it does · How it works (as-built) · Contracts and data ·
Where the code lives · Decisions (links) · Testing · Operations · Deviations from plan.

**Product** reads `README.md`, `00-brief.md`, `03-spec.md`, the business decisions and the layout
references. Writes `<docs_root>/product/NNN-slug.md`: Who it is for · What changed · How to use it
· Rules and limits · Not included · Glossary.

Both update `docs_index` with one line under `## Technical` / `## Product` — a link plus a
one-sentence summary. If the index does not exist, create it with a 2–3 paragraph project summary
proposed from `CONTEXT.md`/`README.md` and confirmed in one turn, plus the two sections.

Rules: do not duplicate the feature folder — link to it; ≤12k per doc; re-running rewrites the
whole doc, keeps the index line and appends `## Changelog`; the content language follows
`docs_language` (§1).

---

## 17. `kss-status`

Reads `README.md` and `.kss/current`. Prints the phase board — or the execution board — for a
feature; with no id, lists the features with their current phase. **Writes nothing.**

---

## 18. Statusline

The script installed by `kss-init` — an absolute path into the installed plugin's
`scripts/statusline.mjs`, resolved as described in §5 — reads `<cwd>/.kss/current` and prints, for
example:

```
kss 012 · execute · 3/5 ████░░ · running: 04 (31t, 14m) · 19.8M tok
kss 012 · investigate · 3 explorers running · 2/3 returned
kss 012 · review · round 2 done · watching PR #61 · last check 3m ago
```

When no KSS run is active, it delegates to the backed-up previous statusline command, if there is
one.
