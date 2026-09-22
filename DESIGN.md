# KSS — Design (source of truth)

This document is the specification every builder of this plugin reads before writing a skill,
an agent, a hook or a script. It is normative: where an implementation disagrees with this
file, the implementation is wrong.

---

## 1. Purpose

KSS is a family of skills, all prefixed `kss-`, that carries a software task from a vague request
all the way to merged-and-documented. One phase per skill, with a `/clear` suggested at the end of
every phase.

KSS runs on **two harnesses — Claude Code and Codex** — from one source tree and one version.
Everything that differs between them lives in one adapter file each (§19); everything a phase writes
into the repository is harness-neutral, so a feature can be specified in one and executed in the
other.

Context lives **on disk, never in the session**: a per-feature folder holds a short index
(`README.md`) plus detail files that are read only by whoever needs them.

KSS is project-agnostic. Everything project-specific comes from `.kss/config.md`; everything
harness-specific comes from `.kss/references/harness-<name>.md`.

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

## 2. The skills (14)

| Skill | Required? | Role |
| --- | --- | --- |
| `kss-init` | once per project | Writes `.kss/config.md`, copies templates, scripts and both harness adapters into the project, and installs whatever the current harness needs |
| `kss-config` | optional | Writes the gitignored `.kss/config.local.json`: allowed models and efforts, per-tier overrides, cross-harness execution and its split (§21), and the Jev settings and key (§20) |
| `kss-clarify` | yes | Turns a vague request into a brief; picks size and track; creates folder and branch |
| `kss-investigate` | M, L | Read-only explorers map the code; classifies decisions auto vs open; on M, settles them with the user in the decision check (§8.4) |
| `kss-review-decisions` | optional | Review, accept, reopen or override the auto decisions |
| `kss-grill` | L (M only if the decision check escalates) | Interviews the user on every open decision |
| `kss-spec` | M, L | Writes the functional specification |
| `kss-plan` | M, L | Writes the implementation plan — shape, not code |
| `kss-tickets` | M, L | Slices the plan into self-contained tickets and a dependency graph |
| `kss-execute` | yes | Runs the tickets; frontier scheduling, gates, review, integration, PR |
| `kss-review` | M, L | Works the PR review round(s); optionally watches the PR |
| `kss-docs-tech` | optional | As-built technical documentation |
| `kss-docs-product` | optional | Product-facing documentation |
| `kss-status` | anytime | Prints the board; writes nothing |

**Order:** clarify → investigate → [review-decisions] → grill → spec → plan → tickets → execute
→ review → [docs-tech, docs-product]. Which of these a feature actually runs is its **track**,
fixed by its size (§3.9); every skill ends by pointing at the next phase *of that track*.

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

Every phase ends by **committing its artifacts** (§3.8) and then printing a fixed summary:

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
  "harness": "codex",
  "phase_started_at": "2026-09-03T10:00:00.000Z",
  "ticket": "04",
  "session": { "turns": 31, "ctx": 148000, "updated_at": "…" },
  "tickets": {
    "04": {
      "state": "running",
      "tier": "T5",
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
| `harness` | `scripts/harness.mjs`, on entry to every skill | `claude-code` or `codex` — which harness is running this phase (§19). The metrics hooks copy it onto every line they write |
| `phase_started_at` | every skill on entry | ISO 8601 |
| `ticket` | `kss-execute` | the ticket a subagent's cost is attributed to; absent outside execute |
| `session.turns` / `session.ctx` | the `Stop` hook | running turn count and last context size of the main session |
| `tickets.<NN>` | `kss-execute` | a **map keyed by ticket id**; each value is `{state, tier, started_at, turns, est_turns, worktree}`, `state` exactly `blocked` \| `ready` \| `running` \| `reviewing` \| `rejected` \| `integrated` |
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

`phase: "done"` is the closed run, written by `node .kss/scripts/current.mjs end` at the end of the
last skill (§3.8): `feature` stays, the live keys (`ticket`, `tickets`, `execution`, `review`,
`explorers`) are dropped, and `isActive()` in `kss-lib.mjs` is false — every hook is a no-op and
the statusline falls back, exactly as with no file. `current.mjs clear` deletes the file outright.

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

Which agent a tier actually becomes is the harness adapter's business (§19); the tier ladder itself
is `references/tiers.md`, and it is `T1`–`T5` plus the `explorer`, `explorer-deep`, `reviewer` and
`runner` roles.

### 3.7 Explorers

Explorers are read-only. They grep first, read ranges, never read a whole file over 300 lines,
never touch `node_modules`, and are never told to read `CLAUDE.md` (it is already in their
system prompt).

---

### 3.8 Nothing left in the tree

Measured 2026-09-14: after every feature, `metrics.jsonl`, a re-rendered `README.md`, an ADR or
`CONTEXT.md` were sitting uncommitted on the feature branch, and `.kss/worktrees/` kept the
directories of integrated tickets. Two causes, both structural:

- the `SessionEnd` hook appends the main session's cost **after** the skill has finished — it runs
  on the `/clear` between phases — so the phase that committed is dirty again a second later;
- no skill ever closed the run: `.kss/current` kept naming the feature after the PR, so every later
  `/clear` and every subagent kept appending, and `render-cost` in review/docs rewrote the README
  with nobody committing it.

The rule, applied by every phase skill through two fixed steps:

1. **Sweep on entry** (precondition 0 of every skill). If
   `git status --porcelain -- <features_root> <domain_docs> <docs_root> .kss/config.md` lists
   anything, commit it as `docs(NNN): <previous phase> artifacts` before doing anything else. This
   is where the previous phase's `SessionEnd` line lands. Never stash, never discard, never fold
   it into the new phase's commit.
2. **Commit on exit** (first step of every Summary). `docs(NNN): <phase>` covering the same paths;
   the summary is printed only when those paths are clean. `.kss/current` and `.kss/worktrees/`
   are gitignored and never part of it.

And one closing step for the skills that can be the last one of a feature (`kss-review`,
`kss-docs-tech`, `kss-docs-product`): after their commit, `node .kss/scripts/current.mjs end`. From
then on the hooks write nothing and the statusline is the previous one; any later `kss-` skill on
the feature re-opens the run by writing `phase`. The one thing given up is the main session's own
cost for that last phase (§6) — a metrics line that would otherwise be the eternal leftover.

`kss-execute` additionally removes each ticket's worktree directory at integration and runs
`git worktree prune` before opening the PR, so `.kss/worktrees/NNN-slug/` is empty when the feature
is done.

### 3.9 Tracks and the Next line

The size chosen in `kss-clarify` fixes the track, and the track fixes what every skill suggests
next. Measured 2026-09-14: skills hard-coded their own `Next:` and an M feature was sent to the
grill it does not have, then to `review-decisions`, before anyone reached the spec. The table below
is the only source of truth, encoded once in `scripts/next.mjs` and read by every skill:

| Size | Track | Optional along the way | After the last phase |
| --- | --- | --- | --- |
| S | clarify → tickets → execute | review, docs-tech, docs-product | `nothing on track S — … optional` |
| M | clarify → investigate → spec → plan → tickets → execute → review | review-decisions, grill (only by escalation from the decision check, §8.4), docs-tech, docs-product | `nothing on track M — … optional` |
| L | clarify → investigate → grill → spec → plan → tickets → execute → review → docs-tech → docs-product | review-decisions (offered before the grill when auto decisions exist) | `documented — nothing left to run` |

Rules:

- A skill prints `Next:` **only** as the output of
  `node .kss/scripts/next.mjs <features_root>/NNN-slug --after <phase>` — never typed by hand —
  and writes the same text into the README header. `--auto <n>` adds the review-decisions offer on
  L; `--escalate grill` is what `kss-investigate` passes on M when the user asked for the grill.
- A skill asked to run a phase that is **off-track** for the size (`next.mjs --check <phase>` →
  `off-track`, e.g. `kss-investigate` on S) stops and prints the on-track Next. An **optional**
  phase runs normally and, when done, resumes the track at the first phase after its canonical
  position. `review-decisions` re-run after the spec goes back to `spec` (a revision).
- The size can be revised by `kss-investigate` (§8.3); from then on `next.mjs` reads the new size
  from the README header, so the suggestions follow the revision automatically.
- `kss-status` marks the phases a track does not contain as `skipped (track <S|M|L>)`.

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
explorer_tier: explorer     # or explorer-deep
auto_decide: true          # false = every decision is asked
execution: multi-agent     # or single-session
full_suite: local          # always local: the coordinator runs the suite once after integration
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
4. Adds `.kss/current`, `.kss/worktrees/` and `.kss/statusline.backup.json` to the project's
   `.gitignore` — the first two are live state, the third is a legacy per-user file that must
   never be committed. `.kss/config.md`, `.kss/templates/` and `.kss/scripts/` stay tracked.
4b. Copies `references/` into the project's `.kss/references/` — `tiers.md` and **both** harness
   adapters, never only the current one. That is what lets a project initialised from one harness be
   driven from the other without re-running `kss-init` (§19).
5. **Claude Code only.** Installs the statusline into the user-level `~/.claude/settings.json` —
   `statusLine: {type: command, command: node <plugin>/scripts/statusline.mjs}` — after asking.
   The statusline is a *user-level* setting shared by every project, so it is the one place that
   keeps an **absolute path into the installed plugin**, resolved once at init time: `kss-init`
   looks for `~/.claude/plugins/cache/*/kss/*/scripts/statusline.mjs` (falling back to
   `find ~/.claude/plugins -type f -path '*/kss/*/scripts/statusline.mjs'`) and, when that finds
   nothing or more than one, **asks the user for the path** rather than guessing. The script reads
   `<cwd>/.kss/current`, so one installed copy serves every project.
   Any existing statusline configuration is backed up to the **user-level**
   `~/.kss/statusline.backup.json` — next to `preferences.md`, because `statusLine` is a user
   setting and its backup is too. The KSS statusline script shows the previous statusline's output
   whenever no KSS run is active. Two rules keep this safe (§18 "Fallback safety"):
   - if the existing `statusLine` already *is* the KSS statusline (any version, any path), nothing
     is backed up — the command is merely updated to the current plugin path;
   - an existing `~/.kss/statusline.backup.json` is never overwritten.

   Versions ≤ 0.1.3 wrote the backup per project, to `<project>/.kss/statusline.backup.json`. The
   second project initialised on a machine therefore got a backup of the KSS statusline itself,
   and the fallback spawned itself without end. `kss-init` now removes such a self-referencing
   file when it finds one and moves a genuine one to `~/.kss/`.

   The metrics hooks (`SubagentStop`, `SessionEnd`, `Stop`) need **no installation**: they ship in
   the plugin's `hooks/hooks.json` and merge automatically while the plugin is enabled. Every hook
   script is a no-op when `.kss/current` is absent or names no feature.
6. **Claude Code only.** Uses the agent matrix the plugin ships, registered as `kss:kss-*` while it
   is enabled. On Codex there is no agent registry: the role preambles live in the Codex adapter,
   which step 4b already installed. It
   writes into the project's `.claude/agents/` **only when those agents are not available** — a
   vendored, plugin-less install — copying only the files that are absent and asking before
   overwriting one. A project copy is a fork that no longer follows plugin releases:

| Agent | Model | Effort | Notes |
| --- | --- | --- | --- |
| `kss-sonnet-low` | sonnet | low | executor; may spawn helpers |
| `kss-sonnet-medium` | sonnet | medium | executor; may spawn helpers |
| `kss-sonnet-high` | sonnet | high | executor; may spawn helpers |
| `kss-opus-medium` | opus | medium | executor; may spawn helpers |
| `kss-opus-high` | opus | high | executor; may spawn helpers |
| `kss-haiku` | haiku | — | executor; may spawn helpers. No effort: Haiku rejects the parameter. Never a default — only a `models.tiers` row for `T1`–`T3` spawns it |
| `kss-reviewer` | opus | high | read-only; review depth `full` by default |
| `kss-reviewer-opus-medium` | opus | medium | read-only; same brief, for `models.review` |
| `kss-reviewer-sonnet-high` | sonnet | high | read-only; same brief, for `models.review` |
| `kss-reviewer-sonnet-medium` | sonnet | medium | read-only; review depth `light` by default |
| `kss-reviewer-sonnet-low` | sonnet | low | read-only; same brief, for `models.review` |
| `kss-explorer` | sonnet | low | read-only |
| `kss-runner` | sonnet | low | coordinator-only, final run: runs tests / lint / tsc; returns only summary lines and failures |
| `kss-dispatcher` | sonnet | low | coordinator-only; runs one `dispatch.mjs run` (a ticket in the other harness's CLI) and returns its report verbatim (§21) |

There is **no `kss-opus-low`** by design, and nothing above `high`.

---

## 6. Metrics

`metrics.jsonl` lives in the feature folder. Append-only, one line per event:

```json
{
  "ts": "…", "phase": "…", "harness": "claude-code|codex", "ticket": "…",
  "kind": "subagent|session|git",
  "agent_type": "…", "model": "…", "effort": "…", "parent": "…", "depth": 1,
  "turns": 0, "duration_ms": 0, "tool_uses": 0,
  "tokens": { "fresh_in": 0, "cache_write": 0, "cache_read": 0, "out": 0,
              "cumulative": 0, "ctx_end": 0 },
  "git": { "files": 0, "added": 0, "deleted": 0, "commits": 0 }
}
```

Rules:

- Tokens are summed from the transcript per model response — **never** from the number the harness
  displays for a subagent, which is its final context size. Claude Code writes one assistant message
  per line with a `usage` object; Codex writes a rollout whose `token_usage_record` items carry the
  same figures. `kss-lib.mjs` sniffs which and reads both (§19).
- **The hooks deduplicate by response identity** — `message.id` on Claude Code (falling back to
  `requestId`/`uuid`), `response_id` on Codex: one assistant
  message is one turn and is counted once, however many content blocks or transcript lines it
  spans. Counting lines double-counts multi-block messages — that is what inflated the first
  measurement in §1.1.
- The `SubagentStop` hook records subagents, with `parent` and `depth`.
- The `SessionEnd` hook (reason `clear` or `exit`) records the main session's phase cost,
  attributed via `.kss/current`.
- `kss-execute` records git statistics per integrated ticket.
- `README.md` gets a rendered `## Cost` table, one row per phase: harness, agents, turns,
  cumulative tokens split by type, wall time, files, +/−. A phase worked from both harnesses prints
  both, which is how a handoff shows up in the artifact.
- Hooks write **only while the run is active** (`isActive()`: a feature is named and `phase` is not
  `done`). The `SessionEnd` line of a phase is committed by the next phase's sweep (§3.8); the
  `SessionEnd` line of the *last* phase is deliberately not recorded — the run is already closed.

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
| M | two layers, or one new endpoint, no new entity | clarify → investigate → spec → plan → tickets → execute → review — the open decisions are settled with the user at the end of investigate (§8.4), no grill |
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

1–5 read-only explorers in parallel (cap 5; group the questions when there are more), in the
`explorer` role at the tier `explorer_tier` names. The skill **auto-escalates to `explorer-deep`**
for any question touching contract, tenant/authorization or money, printing

> This question touches `<area>`; reading it with a deep explorer.

before spawning. `--deep` uses `explorer-deep` for all of them.

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
one line each, per category — on M, the `D-` ids the decision check produced instead), Cost, and
Next from `next.mjs` (§3.9): on L `/kss-grill` (with `/kss-review-decisions` offered first when
there are auto decisions); on M `/kss-spec`, or `/kss-grill` when the user escalated.

### 8.4 Decision check — tracks without a grill

On a track with no grill (M), the investigation is the **last moment a human sees the decisions
before the spec is written from them**. So `kss-investigate` does not end with a list of ids: after
writing its outputs, and before the commit and the summary, it runs one closing turn.

1. Print **one table** with every decision, auto and open, sorted business → layout → technical
   and, inside a category, open first then confidence ascending:

   ```
   ID | Type | Verdict | Question | Decision / proposed | Confidence + evidence
   ```

   Open items get a provisional id `O-N` and a **proposed** answer: the lean the explorers found,
   or `no lean — needs you`.
2. Ask for **one answer**, stating the accepted forms:

   ```
   ok                                       accept every auto decision and every proposal
   O-2: <decision>, AD-04: <override>       decide or override by id; anything not named is accepted
   defer O-3: <owner>, <date>               park an open item as a DF-
   grill                                    stop here and run /kss-grill instead
   ```
3. Apply it exactly as `kss-review-decisions` and `kss-grill` would: accepted `AD-` → `reviewed:
   yes`; an override → `status: overridden` plus a `D-` in `02-decisions.md` linking back; every
   `O-` decided (by proposal or by the user) → a `D-` in `02-decisions.md` with the user's or the
   proposed text as Decision and the investigation evidence as Why; `defer` → a `DF-` with owner
   and date. **No open item may be left undecided**: if the answer leaves one without a `D-` or a
   `DF-`, ask again for those ids only — still one turn, still one table. Business decisions are
   proposed but never accepted silently: `ok` accepts them because the user typed it.
4. Fill the **Decisions** block of the README in the grill's shape (`Decided: … · Overrode: … ·
   Deferred: …`, plus `Decided inline: yes`), so `kss-spec`'s precondition is the same on every
   track: a filled Decisions block.
5. `grill` as the answer skips 3–4, leaves everything as classified and makes Next
   `/kss-grill NNN-slug` (`next.mjs --escalate grill`).

On L the check does not run — the grill is the interview, one decision per turn.

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
affected FRs. On M it is redundant with the decision check (§8.4) but allowed; its Next is
`/kss-spec` there, `/kss-grill` on L (§3.9).

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

Spawns `explorer`s for file-level facts — signatures, model and message shapes, component props —
and `explorer-deep` (with the warning) for contract, tenant or money questions.

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
| Tier | `T1` mechanical local work · `T2` bounded pattern-following, the normal default · `T3` demanding same-area reconciliation on a decided design · `T4` real judgement, unresolved semantics, or meaningful cross-layer reconciliation · `T5` long-horizon integration, difficult diagnosis, unresolved cross-service state/failure semantics, or escalation after failure. **Never a model name** (§19). Domain safeguards are independent. |
| Helpers | `explorer` or none — `runner` is the coordinator's alone. Depth max 2; helpers never write code or run commands; ≤5 per ticket; helper return ≤1.5k |
| Worktree | yes |

### 13.2 Single-session mode

Vertical tracer-bullet slices, each sized to fit a fresh context. Estimated by context, not
turns. Each slice declares `/clear before: yes|no`. No worktree, no graph, no per-ticket tier.
Prefactor first; a wide refactor is isolated into its own slice.

### 13.3 `graph.md`

Multi-agent: a table `# | Ticket | Layer | Blocked by | Tier | Est. turns | Worktree`,
followed by Critical path, Parallel after contract, and Total estimate.

Single-session: an ordered list with Files, Est. context and `/clear before`.

### 13.4 Ticket template

The ticket is **self-contained — the ticket IS the brief**:

- Title
- Header — multi-agent: `Layer · Blocked by · Blocks · Tier · Helpers · Est. · Worktree`; single-session: `Order · Est. context · /clear before`
- **Goal**
- **Requirements covered** — the FR text pasted in, with its citations
- **Plan excerpt** — the File map rows, the contract shapes and the Reuse entries, pasted in
- **Files** — exact paths with line ranges; and the files to read for patterns, with ranges
- **Tests** — spec files and case names; written and committed before the implementation, and
  run by nobody (the coordinator runs the suite once after integration)
- **Project rules that apply** — one line each, only the rules this ticket triggers
- **Do not** — open `03-spec.md` or `04-plan.md`; read whole files over 300 lines; run any test,
  lint, build or tsc command
- **Report back** — a fixed format, ≤1.5k: branch, commits, files, the spec files written (not
  run), deviations

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
- The tier comes from the graph; the harness adapter turns it into a spawn (§19).
- **Gates before a report is accepted**: the format is respected and ≤1.5k; the commit order is
  test-before-implementation (two commits, the test one first); deviations are justified. A
  failing gate sends the report back to the same agent with the list of what is missing.
- **No subagent runs tests, lint, build or tsc**, at any point — the reason is load: 60 subagents
  once ran 250 test rounds in one feature and saturated the machine.
- A `kss-reviewer` reviews every finished ticket: it reads the diff and the report and returns
  `approve`, or `reject` with numbered findings (file, line, rule or FR). **The coordinator reads
  verdicts only — never diffs.**
- **Escalation**: a reject for an execution error → the same ticket, **one tier up**, in the same
  worktree, with the findings pasted in. A reasoning error may move two. Never more, never past
  `T5`.
- A ticket unfinished past 80 turns → stop, keep the worktree, and send it back to `kss-tickets`
  to be re-sliced. The executor never splits a ticket on its own.
- **Integration** by a `T1` agent: rebase, merge into the feature branch, remove the worktree, set
  the state to `integrated`, unblock the dependants. A rebase conflict goes to a `T2` with both
  tickets' context, then to the reviewer again.
- **Finish**: the **coordinator itself** runs the project's full suite once, plus its lint,
  build and type-check targets, maps failures back to the owning tickets, and runs it at most
  once more — a third failure stops and goes to the user. Open a PR against
  `base_branch` with the feature README as the body. **Never merge** — that is a human decision.

### 14.2 Coordinator context

Everything the coordinator needs is in `graph.md` and `06-execution.md`. Above ~150k it prints:

> Coordinator context at Xk. State is on disk. Safe to /clear and run
> `/kss-execute NNN-slug` to resume.

Resuming recomputes the frontier from the log. A ticket marked `running` with no live worktree is
reset to `ready`.

### 14.3 Single-session

The session executes the tickets in order. Before a ticket with `/clear before: yes` it stops and
prints the suggestion. The same gates apply, self-applied. A reviewer subagent runs where the harness
can spawn one; otherwise a checklist goes into the log. Commits land on the feature branch.

### 14.4 Progress board

Printed on every event — spawn, report, verdict, integrate, escalate:

```
kss · NNN-slug · execute · <harness>
███████░░░  n/N integrated · x% of estimated turns
# | Ticket | State | Tier | Turns used/est | Since
Critical path: …
Elapsed: …    Tokens: …
Last: <event>
```

The states are exactly: `blocked`, `ready`, `running`, `reviewing`, `rejected`, `integrated`.
`.kss/current` holds this state as JSON: `tickets.<NN>` per ticket, and the roll-up the board's
header and footer lines come from in `execution` (§3.3).

`06-execution.md` is an append-only log of timestamped events per ticket. The README gets an
Execution block. TDD is enforced by the commit order — test committed before implementation —
and by the reviewer reading the test against the diff, never by a run.

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
plus "Open after round". The skill commits `07-review.md`, `metrics.jsonl` and the re-rendered
README (`docs(NNN): review`), closes the run with `current.mjs end` (§3.8) and ends with "Ready for
merge decision". **It never merges.**

### 15.1 `--watch`

Watches the PR the way the harness adapter says — a background monitor where the harness has one,
never a polling subagent — checking `gh` every 5 minutes (configurable) for new review comments, CI
conclusions, and merged/closed. On a change the coordinator wakes, runs a
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

## 18. Statusline (Claude Code only)

Codex has no status-line hook; there, `kss-status` prints the board on demand and `kss-init` says
so instead of installing anything.

The script installed by `kss-init` — an absolute path into the installed plugin's
`scripts/statusline.mjs`, resolved as described in §5 — reads `<cwd>/.kss/current` and prints, for
example:

```
kss 012 · execute · 3/5 ████░░ · running: 04 (31t, 14m) · 19.8M tok
kss 012 · investigate · 3 explorers running · 2/3 returned
kss 012 · review · round 2 done · watching PR #61 · last check 3m ago
```

When no KSS run is active, it delegates to the backed-up previous statusline command, if there is
one — read from `~/.kss/statusline.backup.json`, or from the legacy `<cwd>/.kss/statusline.backup.json`.

### 18.1 Fallback safety

The fallback runs an arbitrary shell command with the same stdin. The 2026-09-14 incident — 400
concurrent `statusline.mjs` processes and a load average of 430 on an 8-core machine — came from
a backup that pointed back at the KSS statusline: each invocation spawned itself, `spawnSync`'s
timeout killed only the direct child, and the grandchildren lived on as orphans of launchd. Every
layer below is required; none is redundant.

1. **Self-reference is never run.** A backup command matching `statusline.mjs` or the word `kss`
   is ignored (`isSelfReferencing`), whichever file it came from.
2. **The child cannot spawn.** The fallback child runs with `KSS_STATUSLINE_CHILD=1` in its
   environment. A statusline that starts with that variable set prints the plain
   `<model> · <ctx%>` line and never reaches the fallback.
3. **Timeouts kill the group.** The child is started `detached` in its own process group and the
   whole group gets `SIGKILL` after 2 s, so a child that forked cannot leave orphans. Claude Code
   does not wait longer than that for a statusline anyway.
4. **Only `~/.kss/` is written.** `kss-init` never writes the backup inside a project again, and
   never backs up a `statusLine` that is already KSS.

`scripts/statusline.test.mjs` (`node --test scripts/`) pins all of this: a self-referencing backup
in the project and in `$HOME`, a hanging backup, the child guard, and a genuine backup that is
honoured.

---

## 19. Harnesses

KSS runs on **Claude Code** and on **Codex**, from one source tree and one version. This section is
the contract between them; `references/harness-claude-code.md` and `references/harness-codex.md` are
the two implementations of it, and `references/tiers.md` is the vocabulary they share.

### 19.1 The rule

**No artifact KSS writes into a repository may name a harness, a model or an agent type.** Not a
ticket, not a graph, not a spec, not a README block, not a log line. The reason is the whole point of
this section: the phases of one feature are routinely run from different harnesses — the spec side in
one, the execution in the other — and an artifact that says `opus` is an artifact the other harness
cannot execute.

What the artifacts say instead is a **tier** (`T1`–`T5`) or a **role** (`explorer`,
`explorer-deep`, `reviewer`, `runner`). `references/tiers.md` fixes what each one means and carries
the compat table for tickets written before tiers (`Model` + `Effort`, KSS ≤ 0.1.4), which are read,
never rewritten.

`.kss/current` is the one exception, and only because it is gitignored session state: it records
`harness` so the board, the metrics hooks and the cost table can say where a phase ran.

### 19.2 Detection

`scripts/harness.mjs` decides, in this order: `KSS_HARNESS` → environment markers (`CLAUDECODE`,
`CLAUDE_CODE_ENTRYPOINT`; `CODEX_HOME`, `CODEX_SANDBOX`) → the parent-process chain → the `harness`
already recorded in `.kss/current` → `unknown`.

`unknown` is not an error. The skill asks the user once — one question, two options — and records the
answer with `harness.mjs --set <name>`. Every phase runs the script on entry, prints nothing about it
unless it had to ask, and reads the adapter it names.

### 19.3 What an adapter owns

An adapter answers exactly these, and nothing a skill can answer for itself:

| Question | Why it cannot live in a skill |
| --- | --- |
| How a phase is invoked (`/kss-spec` vs `$kss-spec`) | it is printed into `Next:` lines and READMEs |
| How the context is cleared between phases | the wording differs, the discipline does not |
| How a subagent is spawned, waited on, re-tasked and closed | different tools, different lifecycles |
| What each tier and role maps to | different model catalogues |
| How a read-only role is enforced | a tool list in one, a preamble in the brief in the other |
| Who may run a command, and how | the single final run is the coordinator's either way |
| How a PR is watched | a background monitor in one, a foreground loop in the other |
| The default `standards` file, the hook manifest, the status line, the transcript format | packaging |

Two consequences worth stating, because they are easy to get wrong:

- **Codex needs `fork_turns: "none"` on every KSS spawn.** A full-history fork inherits the parent's
  model, rejects a `model`/`reasoning_effort` override, and drags the coordinator's thread into a
  ticket whose brief is supposed to be self-contained. The adapter is also the *authorisation* Codex
  requires for a per-spawn model override: it is a skill instruction, which is one of the three
  sources Codex accepts.
- **Codex has no per-agent tool list.** `explorer` and `reviewer` are read-only by instruction, so
  the adapter carries the preamble the coordinator pastes above the question or the diff target. On
  Claude Code the same text is the agent definition's body (`agents/kss-*.md`). The two must say the
  same thing; `agents/` is the source when they drift.

### 19.4 Packaging

One tree, two manifests. Nothing is generated, nothing is duplicated:

```
.claude-plugin/plugin.json     Claude Code: skills, agents, hooks
.codex-plugin/plugin.json      Codex: skills (not hooks — see below)
skills/<name>/SKILL.md         shared — harness-neutral body
skills/<name>/agents/openai.yaml   Codex only: UI metadata + allow_implicit_invocation: false
agents/kss-*.md                Claude Code only: the fourteen registered agents
references/                    tiers.md + one adapter per harness → copied to .kss/references/
hooks/hooks.json               both: SubagentStop, SessionEnd, Stop — the event names match
scripts/, templates/           shared → copied to .kss/scripts/, .kss/templates/
```

Two places where the two contracts genuinely disagree, and what KSS does about each:

**Hooks.** Codex's plugin ingestion contract does not accept a `hooks` field in `plugin.json`
(`validate_plugin.py`: "field `hooks` is not accepted"), although the plugin spec document lists it.
So `.codex-plugin/plugin.json` declares skills only, and on Codex `kss-init` merges the three hook
entries into the **user-level** `$CODEX_HOME/hooks.json` instead — with its own yes/no turn, a
backup, and a merge that keeps every entry already there. That is the same shape as the Claude Code
statusline: one user-level file, written only on an explicit yes, with an absolute `<PLUGIN>` path
because the plugin-root variable is not set for a hook installed that way. Codex then asks to
**trust** the hook once (`/hooks`); until it is trusted, every phase works and `metrics.jsonl`
stays empty.

**`disable-model-invocation`.** It stays `true` in the frontmatter, and that is a deliberate,
documented deviation: it is what stops Claude Code from invoking a phase on its own, which the whole
family depends on, and Claude Code offers no other way to express it. Codex's *runtime* parses the
key and loads the skill regardless — verified with `codex debug prompt-input`, which lists a KSS
skill carrying it — and `allow_implicit_invocation: false` in `agents/openai.yaml` is what actually
keeps a phase out of Codex's automatic routing, the same intent. Codex's *ingestion* validator,
however, requires the frontmatter key to be absent or `false`, so the plugin as shipped would be
rejected by OpenAI's curated marketplace. Installing it from this repository's own marketplace is
unaffected. If that ever has to change, the key goes and Claude Code loses only the protection
against automatic invocation — not a rule, a safeguard.

### 19.5 The handoff

There is no export, no sync and no handoff file. Both harnesses open the same working copy, and
every phase already commits its own artifacts before it prints its summary (§3.8). Specifying a
feature in Codex and executing it in Claude Code is therefore: finish the phase, read its `Next:`
line, open the other app in the same directory, type the same phase with that app's prefix.

What makes it work is §19.1 — and what proves it worked is the `Harness` column of the `## Cost`
table, which names every harness that touched each phase.

---

## 20. Jev — a System One classifier in the loop

### 20.1 What it is, and what it is not

Jev (TypeSafe, `docs.typesafe.ai`) is not a language model in the sense the rest of this document
uses the word. It takes a small JSON **state** and a set of typed **questions** — `choice` (pick one
label), `score` (a rubric level), `noul` (is this true) — and returns, per question, a probability
for every label and a **confidence** derived from how concentrated that distribution is. One call,
many questions, evaluated in parallel; output tokens are free; the request is bounded at 64k tokens
with 32k for the state. It does not generate text, it does not count reliably, it does not compare
dates, and its accuracy drops as the state fills with material unrelated to the question.

So in KSS Jev is used for exactly one kind of moment: a **fork whose options are already
enumerated**, where the phase would otherwise spend a model turn — or a user turn — choosing. It
is never asked to write, plan, or find anything. Three such moments exist, each behind its own
switch and its own threshold, because "a confidence threshold is not one number".

### 20.2 The four uses

| Use | Phase | What is sent | What comes back | Threshold (default) |
| --- | --- | --- | --- | --- |
| **Auto-assumptions** | `kss-investigate` | one `open` technical or layout decision, the options the explorers found, one line of evidence each | `auto` → an `AD-` with Jev's confidence in the record; `open` → stays open, the ranked list becomes the proposed answer | technical 0.85 · layout 0.9 · business > 1 (never) |
| **Tier selection** | `kss-tickets` | one ticket summary: layer, file count, contracts, execution uncertainty, domain risk, safeguards | `auto` → the tier; `open` → the rubric decides, Jev's ranking is a hint | 0.7 |
| **Ticket sizing** | `kss-tickets` | one drafted ticket's shape: write targets, directories, service concerns, estimate, whether it crosses read and write | `keep` / `split`; `open` → the fixed rule in `references/spend-discipline.md` | 0.7 |
| **Coordinator judgements** | `kss-execute` | a reviewer's findings, an executor's report, or a finished ticket about to be reviewed | `cosmetic` / `execution` / `reasoning`; `pass` / `fail`; `full` / `light` | 0.8 |

Three rules hold across all of them. **Business decisions are never auto**: the threshold for that
category defaults above 1.0, so the knob exists and is visible but no default ever trips it.
**Domain risk is not a tier floor**: contract, tenant isolation, money, migration and wire work
keep their prescribed safeguards whatever execution tier Jev or the rubric selects. And **Jev never
chooses less scrutiny by default**: `review_depth`, which picks a cheaper reviewer, ships but
stays out of the default `reasoning.decisions` list until a project's own trace shows the
classifier is calibrated there. Under-reviewing is the one mistake in this list that ships a
defect instead of costing money.

When a project does turn it on, the depth becomes a reviewer through `scripts/review.mjs pick`,
from `models.review.<full|light>.<harness>` in the layered config — on Claude Code a
`{model, effort}` pair or a `kss-reviewer*` agent name (one agent per pair, same brief), on Codex a
`{model, reasoning_effort}`. Two rules live in the script, not in the prompt, so no coordinator can
talk its way past them: **any domain-risk category the ticket carries forces `full`**, whatever Jev
said; and **a missing, unknown or disallowed value keeps the default reviewer**, so a broken config
never buys a cheaper review. Only an explicit `models.review.full` below opus/high lowers `full`, and
the script flags it (`below_default`).

The third use is where the `jev-eval-agent` case study points — the classifier decides the fork,
the model runs with less reasoning — and where the analogy is weakest for KSS. An executor's
reasoning is writing code against a ticket, which Jev cannot do. What can be delegated is the
**coordinator's** deliberation on already-enumerated classes, and the effort of a ticket whose fork
points were settled before it was spawned (`effort_when_delegated`, Codex only, because a Claude
Code agent's effort is fixed in its definition). It ships off by default, traced, so the trace can
say whether it earns its keep.

### 20.3 The contract

- **One script**, `scripts/jev.mjs`, copied to `.kss/scripts/` by `kss-init` like the others. No
  dependency: `fetch` against `POST /v1/systemone`, bearer auth, the model from the config. Exit
  codes are part of the contract: `0` an answer, `3` off (skip silently), `2` a failure (say so,
  fall back), `1` a usage error. **No phase ever stops because Jev did not answer.**
- **One file**, `.kss/config.local.json`, written by `kss-config`, gitignored by `kss-init` before it
  can exist. It holds the API key (or the name of the environment variable that does), the
  switches, the thresholds, and the per-machine model overrides (`models.allowed`, `models.efforts`,
  `models.tiers`, `models.review`). It is the only KSS file that may name a model, and it never leaves the machine.
- **Nothing Jev says is written as fact.** An auto-assumption records `jev: <choice> <confidence> ≥
  <threshold> · runner-up`; a tier records `(jev 0.82)` in a comment; an execution event logs
  `jev: <kind> <choice> <confidence>`. The user can always see that a machine decided, and how sure
  it was.
- **Every call is traced** to `<feature>/jev-trace.jsonl` (state, ranked options, confidence, gate,
  latency) while `jev.trace` is on, and the file is committed with the phase. That trace is the
  only honest way to tune a threshold: count how many `auto` verdicts the grill would have
  overridden, and how many `open` verdicts the user answered exactly as Jev's top option.
- **§19.1 stands.** The local file may name models; no artifact does. A `models.tiers` override
  changes what this machine spawns for `T3`, not what the ticket says.

### 20.4 What to measure before believing it

The claim is three-fold — fewer tokens, less wall time, more consistent decisions — and each has a
number in the existing metrics. Before and after turning a switch on, over the same kind of
feature: the count of `Qn` turns the grill printed (auto-assumptions); the coordinator's turns and
tokens in `kss-tickets` and `kss-execute` (tier selection, judgements); the escalation count per
feature (whether Jev's tiers were too low). And from the trace, the two error rates above. A switch
whose trace shows the user overriding it more than one time in ten is turned off again.

---

## 21. Cross-harness execution

### 21.1 The idea

§19 made one feature folder workable from two harnesses *in sequence*: spec here, execute there.
This section makes the execution itself mixed: a coordinator running in Claude Code may hand a
ticket to Codex, and one running in Codex may hand a ticket to Claude Code, **in the same run**, in
a proportion the user sets. The reasons are the ones the user has: spreading a run across two
subscriptions, comparing the two on like-for-like tickets, and keeping a run moving when one side
is rate-limited.

Nothing about the ticket changes. It still says `T2`; the foreign harness's adapter table (or the
machine's `models.tiers` override) still turns that into a model and an effort. What changes is
*who* runs it: instead of the harness's own subagent tool, the harness's **CLI**, non-interactive,
in the ticket's worktree, with the brief on stdin.

### 21.2 The mechanism

```
coordinator (harness A)
  └─ dispatch.mjs pick      → "codex" | "claude-code" | local (exit 3)
  └─ writes NN.brief.md     = executor preamble (adapter B) + ticket + worktree
  └─ spawns `dispatcher`    (light, local subagent: sonnet-low / gpt-5.4-mini-low)
       └─ dispatch.mjs run  → spawns CLI B in the worktree, brief on stdin
            claude -p --model … --effort … --output-format json --permission-mode acceptEdits
                      --allowedTools Read Grep Glob Edit Write "Bash(git *)" --max-turns 80
            codex exec --json --cd <wt> -m … -c model_reasoning_effort="…" -s workspace-write
                      -c approval_policy="never" -o <last-message> -
       └─ returns the report block + one `Dispatch:` line
  └─ gates, reviews, integrates exactly as for a local ticket
```

Three facts make this hold together:

- **The brief is identical.** A foreign executor receives the same preamble a local one would on
  that harness, then the ticket, then the worktree path — nothing else. The CLI is just another
  spawn primitive.
- **The report is identical.** `claude -p --output-format json` returns the final message in
  `result`; `codex exec -o <file>` writes it. Both are the ticket's Report-back block, so the
  coordinator's gate does not know or care where the ticket ran.
- **The cost is recorded by the script.** `SubagentStop` never fires for a CLI child, so
  `dispatch.mjs run` writes the `kind: "subagent"` metrics line itself — `harness` set to the
  foreign one, `agent_type: cross:<harness>:<tier>`, tokens from the CLI's own usage figures
  (Claude: `usage`; Codex: the sum of `turn.completed` events, with the cached and cache-written
  tokens subtracted from `input_tokens` as `kss-lib` does for rollouts), `cost_usd` when the CLI
  reports one. The `## Cost` table's `Harness` column then shows the mix per phase, which is the
  point of running it.

### 21.3 The split

`execution.cross_harness.split` is a weight per harness; `pick` normalises it and assigns each
ticket by **largest deficit**: the harness whose observed count is furthest below
`share × (n + 1)` gets the next ticket, ties go to the local harness. Over ten tickets a `70/30`
split lands exactly 7 and 3 whatever the order they become ready in. The observed counts come
from `<feature>/dispatch.jsonl`, an append-only log the script writes on every `pick` and `run`, so
a resumed run continues the same split.

Three guards, all in the script, none in the coordinator's judgement:

- `tiers` — which tiers may leave the local harness, default `T1`–`T3`. `T4` and `T5` carry design
  and contract judgement, and a CLI run has no `SendMessage` back to it: a reject means a fresh
  spawn. The user may add them; the default does not.
- A harness whose CLI binary is not on `PATH` is skipped, and `pick` says so in `unavailable`.
- A failed or timed-out foreign run is re-spawned **locally**, same tier, once, and logged as an
  escalation with the reason `cross-harness fallback`. It never bounces to the other harness again.

### 21.4 What a foreign executor may do

The CLI flags are the enforcement, and they are configuration, not prose:

| | Claude Code (`claude -p`) | Codex (`codex exec`) |
| --- | --- | --- |
| Edit and commit | `--permission-mode acceptEdits` + `--allowedTools … "Bash(git *)"` | `-s workspace-write` |
| Run tests, lint, build | **not allowed** — no other `Bash` pattern is in the list | by instruction only (the preamble); the sandbox cannot distinguish `git` from `npm test` |
| Ask the user | impossible in print mode — `approval_policy` / permission denials fail the call | `-c approval_policy="never"` |
| Turn budget | `--max-turns 80` | the preamble's ~80 |
| Wall clock | `timeout_ms`, default one hour, then `SIGTERM` and a local fallback | same |

The asymmetry in the second row is real and worth knowing: on Claude Code the tool list makes the
no-tests rule mechanical; on Codex it is the preamble's rule 3, as it is for a native Codex
subagent. The coordinator's final run is the same either way.

### 21.5 What to measure

`dispatch.mjs status` prints target vs observed. `metrics.jsonl` now carries, per ticket, the
harness, model, effort, turns, tokens and (for Claude) dollars; `06-execution.md` carries the
verdict and escalation per ticket. Joining the two by ticket answers the questions the split was
turned on for: reject rate per harness at the same tier, turns and tokens per accepted ticket per
harness, and whether the foreign fallback fired. A harness that is rejected twice as often as the
other at `T2` is not saving anything; the split goes back to what the trace supports.
