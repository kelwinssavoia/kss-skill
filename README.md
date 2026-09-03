# KSS — Phase-based development for Claude Code

KSS is a family of thirteen Claude Code skills, prefixed `kss-`, that carry a software task from
a vague request to merged-and-documented, one phase at a time, each its own skill invocation with
a `/clear` suggested at the end. The problem it solves: a single long-lived session doing
clarification, investigation, interview and execution together grows without bound and re-reads
its own output constantly. KSS instead keeps context **on disk, never in the session** — a
per-feature folder holds a short index (`README.md`, ≤4k) plus detail files read only by whoever
needs them — and tracks the token cost of every phase, so clearing is backed by numbers.

The motivation is measured, not assumed (2026-09-03, on a real repository): subagents carried a
fixed baseline of roughly **47k tokens per turn**, and the worst single agent reached **50M
cumulative tokens over 192 turns**. The same slice of work, cut into **4 layer-sliced agents**,
cost about **16M tokens** total, and a median agent cost about **4M tokens**. Executors re-read
their own inputs constantly — one spec read **7 times**, one ticket **17 times**. Coordinator
sessions grew from **60k to 300k tokens** by sharing investigation, interview and execution in one
session. And the Agent tool's displayed number is the **final context size**, not the
consumption — metrics come from the transcript, never the UI. The metrics hooks deduplicate
transcript lines by message id, so retried or replayed messages are not double-counted. Every cap,
slicing rule and `/clear` point below traces back to one of these numbers.

## How it works

```
clarify → investigate → [review-decisions] → grill → spec → plan → tickets → execute → review → [docs-tech, docs-product]
```

`review-decisions` is optional after investigate; `docs-tech`/`docs-product` are optional after
review. Every skill can run on its own, given a feature id `NNN-<slug>`.

### The feature folder

```
<features_root>/NNN-<slug>/
  README.md              index — ≤4k, one block per phase, current state, next command
  00-brief.md            clarified brief, size and track
  01-investigation.md    where it lives, reuse, decisions (auto/open)
  auto-decisions.md      AD- entries taken without asking
  02-decisions.md        D- entries settled in the grill
  03-spec.md             functional spec, cited FRs
  04-plan.md             implementation plan — shape, not code
  05-tickets/NN-<slug>.md, graph.md   self-contained tickets + dependency graph
  06-execution.md        append-only execution log
  07-review.md           PR review rounds, findings, resolutions
  metrics.jsonl          one line per subagent/session/git event
  notes/                 overflow detail — linked, never inlined
```

Each skill writes only its own file(s) and its own block in `README.md`. `README.md` is the
**only** file a fresh session reads at start; a spec, a plan or a ticket is never re-read by a
phase that doesn't own it.

### Size and track

`kss-clarify` proposes both from the brief:

| Size | Criteria | Track |
| --- | --- | --- |
| S | one layer, one surface, no new data/contract | clarify → ticket → execute |
| M | two layers, or one new endpoint, no new entity | clarify → investigate → spec → plan → tickets → execute → review |
| L | new entity, contract change, cross-service flow, or any "confirm" on data | all phases, incl. grill |

### The rule that never bends

Every phase ends by printing a fixed summary:

```
<Phase> done · NNN-slug
<findings / decisions / equivalent for this phase>
Cost: <line rendered from metrics.jsonl>
Safe to /clear.
Next: /kss-<next> NNN-slug
```

The next phase reads the folder, not your scrollback.

## Installation

```
/plugin marketplace add kelwinssavoia/kss-skill
/plugin install kss@kss-skill
```

Enable it per project via `enabledPlugins` in `.claude/settings.json` (project or user level).
The metrics hooks (`SubagentStop`, `SessionEnd`, `Stop`) ship in `hooks/hooks.json` and merge in
automatically while the plugin is enabled — nothing to install for them.

Then, inside the project, run `/kss-init`: interactive, one question per turn, writing nothing
until you confirm the plan. It asks for every key below (offering a default), plus execution mode
(multi-agent/single-session), layout references and standards files, then:

1. Writes `.kss/config.md`.
2. Copies `templates/` into `.kss/templates/` and `scripts/` into `.kss/scripts/`, so the skills
   read the project's own copy and it can be customised.
3. Asks whether to install the statusline into **user-level** `~/.claude/settings.json`
   (`statusLine: {type: command, command: node <plugin>/scripts/statusline.mjs}`), backing up any
   existing one to `.kss/statusline.backup.json` — KSS falls back to printing that output when no
   run is active.
4. Creates the eight-agent matrix in `.claude/agents/`, skipping files that already exist (asks
   before overwriting).
5. Adds `.kss/current` and `.kss/worktrees/` to `.gitignore` (live state); config, templates and
   feature folders stay tracked.

### `.kss/config.md` keys

| Key | Meaning | Default |
| --- | --- | --- |
| `features_root` | Where feature folders live | `docs/features` |
| `next_number` | Used only when greater than highest existing `NNN` | highest + 1 |
| `base_branch` | Branch PRs target | remote HEAD, else `main` |
| `branch_prefix` | Prepended to `NNN-slug` in the branch name | empty |
| `domain_docs` | Glossary and ADR locations | `CONTEXT.md`, `docs/adr/` if present |
| `layout_references` | Design exports/design-system docs — the only layout truth | empty |
| `standards` | Files whose rules bind explorers and executors | `CLAUDE.md` if present |
| `explorer_model` | Default model for read-only explorers | `sonnet` |
| `auto_decide` | `false` = every decision goes to the grill | `true` |
| `execution` | `multi-agent` or `single-session` | `multi-agent` |
| `full_suite` | `ci` or `local` — where the suite runs at execute's end | `ci` |
| `tracker` | `none`, or a tracker to mirror tickets into | `none` |
| `review_autopilot` | `fixes` \| `all` \| `none` | `fixes` |
| `docs_root` / `docs_index` | Where `kss-docs-*` writes | `docs` / `docs/README.md` |
| `docs_language` | Language of the *content* of generated documents | empty = follow the conversation |

With no `layout_references`, `kss-spec` refuses to invent a layout and flags every layout
question instead of guessing.

**Requirements:** Node ≥ 18 (`hooks/*.mjs`, `scripts/*.mjs`), `gh` CLI (`kss-review` reads/polls
PR threads/CI), git (every feature is a branch; each ticket gets its own worktree).

## Skills

### `kss-init` — `/kss-init` (no arguments)
Sets the project up for the workflow. Run once, first.
- **Reads/writes:** reads `templates/`, `CONTEXT.md`/`CLAUDE.md`/`docs/adr/`/`specs/` for
  defaults; writes `.kss/config.md`, `.kss/templates/`, `.kss/scripts/`, `.claude/agents/kss-*.md`,
  `.gitignore`, and, on its own yes, `~/.claude/settings.json` (statusline).
- **Confirmation:** one turn/key, a final turn with config + file list before writing, a separate
  yes/no for the statusline.
- **Next:** `/kss-clarify <what you want to build>`

### `kss-clarify` — `/kss-clarify <free text | path | url>`
Turns a vague request into a short, verifiable brief and picks how much process it deserves.
Never reads code.
- **Reads/writes:** reads `.kss/config.md`, `CONTEXT.md`; writes `00-brief.md`, the Brief block,
  creates the feature folder and branch.
- **Confirmation:** ≤5 questions, one per turn, to fill Symptom / Expected outcome / Actors and
  surfaces / Out of scope / Layers touched / Open facts; Size + Track confirmed; feature name
  asked; `Creating <folder> and branch … from <base>. Confirm?` before anything exists.
- **Next:** `/kss-investigate NNN-slug` (M/L) or `/kss-tickets NNN-slug` (S)

### `kss-investigate` — `/kss-investigate NNN-<slug> [--model opus]`
Maps where the feature lives and what to reuse via parallel read-only explorers; the main session
only synthesizes. Classifies every decision the feature needs.
- **Reads/writes:** reads `README.md`, `00-brief.md`, `.kss/config.md`, `domain_docs`; writes
  `01-investigation.md`, `auto-decisions.md`, the Investigation block.
- **Confirmation:** none mid-phase — 1–5 explorers spawn, escalating to opus for
  contract/tenant/money questions (printed notice); the summary lists decisions.
- **Next:** `/kss-review-decisions` (optional), then `/kss-grill`, or `/kss-spec` on M with no
  open items.

### `kss-review-decisions` (optional) — `/kss-review-decisions NNN-<slug>`
One-turn review of every decision `kss-investigate` took alone, weakest confidence first.
- **Reads/writes:** reads `auto-decisions.md` only; updates entries in place, an override adds a
  `D-` entry too. Nothing is deleted.
- **Confirmation:** one table, one answer — `accept all`, or `reopen AD-NN`/`override
  AD-NN: <text>`.
- **Next:** back to `/kss-grill`, or a re-run of `/kss-spec` if run after the spec.

### `kss-grill` — `/kss-grill NNN-<slug>`
Interviews the user on every open decision, one per turn, business → layout → technical, no cap.
- **Reads/writes:** reads `README.md`, open items in `01-investigation.md`, `CONTEXT.md`, ADRs;
  writes `02-decisions.md` (D-/DF-), `CONTEXT.md` terms, ADRs in `docs/adr/`.
- **Confirmation:** each open item its own turn — question, repo-sourced options, ≤1 derived
  follow-up; "don't know" defers it. Closes with "Decided N, deferred N, overrode …?"
- **Next:** `/kss-spec NNN-slug`

### `kss-spec` — `/kss-spec NNN-<slug>`
Writes the functional spec: what the system must do and how it's proven, never how it's coded.
- **Reads/writes:** reads `README.md`, `00-brief.md`, `02-decisions.md`, `auto-decisions.md`,
  investigation sections, layout view; writes `03-spec.md` (≤15k), the Spec block.
- **Confirmation:** input audit first (decisions resolved, `DF-` owners, layout view present);
  one turn to agree the test seams before writing.
- **Next:** `/kss-plan NNN-slug`

### `kss-plan` — `/kss-plan NNN-<slug>`
Writes the implementation plan — shape, not code — via file-level facts from read-only explorers.
- **Reads/writes:** reads `README.md`, `03-spec.md`, decisions/investigation sections; writes
  `04-plan.md` (≤20k), the Plan block.
- **Confirmation:** each new dependency confirmed on its own turn (name, why the stack can't, size,
  licence); one approval turn on Approach, models/contracts and File map.
- **Next:** `/kss-tickets NNN-slug`

### `kss-tickets` — `/kss-tickets NNN-<slug>`
Slices the plan into self-contained tickets plus a dependency graph; branches on
`config.execution`.
- **Reads/writes:** reads `README.md`, `04-plan.md`, FRs of `03-spec.md`, `.kss/config.md`;
  writes `05-tickets/NN-<slug>.md`, `graph.md`; a tracker card per ticket when configured.
- **Confirmation:** one turn to approve the graph or sequence.
- **Next:** `/kss-execute NNN-slug`

### `kss-execute` — `/kss-execute NNN-<slug> [--ticket NN]`
Runs the ticket graph to done as **coordinator** — schedules, spawns, reads reports/verdicts,
integrates, logs. Never writes the feature's code or reads a diff itself.
- **Reads/writes:** reads `README.md`, `graph.md`, `06-execution.md`, `.kss/config.md` — never the
  spec or plan; writes `06-execution.md`, worktree commits merged to the feature branch,
  `.kss/current`, opens the PR.
- **Confirmation:** none mid-run in multi-agent (self-schedules the frontier); single-session
  stops before a `/clear before: yes` ticket. Never merges.
- **Next:** `/kss-review NNN-slug` (M/L) once the PR is open.

### `kss-review` — `/kss-review NNN-<slug> [--watch]`
Works a PR review round: collects findings since the cursor, triages, fixes/disputes/answers/
defers, replies, resolves. Never merges.
- **Reads/writes:** reads `README.md`, PR threads/CI via `gh`, `06-execution.md`, `graph.md`;
  writes `07-review.md`, fix tickets executed via `kss-execute`, thread replies/resolutions,
  `.kss/current.review`.
- **Confirmation:** one turn to confirm the triage table; `--watch` autopilots rounds per
  `review_autopilot`, up to 10 or until merged/closed/stopped.
- **Next:** "Ready for merge decision" (human merges), then `kss-docs-tech`/`kss-docs-product`.

### `kss-docs-tech` / `kss-docs-product` (optional)
`/kss-docs-tech NNN-<slug>` writes as-built tech docs — the repo is the truth, the plan only the
outline. `/kss-docs-product NNN-<slug>` writes product docs: who it's for, what changed, how to
use it, what it doesn't do.
- **Reads/writes:** tech reads `README.md`, `04-plan.md`, `06-execution.md`, `02-decisions.md`,
  ADRs → `<docs_root>/tech/NNN-slug.md`; product reads `README.md`, `00-brief.md`, `03-spec.md`,
  business decisions, layout refs → `<docs_root>/product/NNN-slug.md`. Both ≤12k, both add one
  line to `docs_index`.
- **Confirmation:** standard summary only; tech runs one explorer to confirm as-built paths.
- **Next:** tech → `/kss-docs-product` (optional); product → nothing further.

### `kss-status` — `/kss-status [NNN-slug]`
Prints the phase or execution board, or lists every feature with no argument. Writes nothing.
- **Reads/writes:** reads `.kss/config.md`, `.kss/current`, the feature `README.md`, and, only
  during `execute` with no cached ticket state, `graph.md`/`06-execution.md`.
- **Confirmation:** none — a single print.
- **Next:** echoes `README.md`'s `Next:` line; never suggests beyond it.

## Agents

`kss-init` installs eight agents into the project's `.claude/agents/`:

| Agent | Model | Effort | Role |
| --- | --- | --- | --- |
| `kss-sonnet-low` | sonnet | low | Executor — 1 layer, 1–2 files, copies a pattern; also integration/full-suite runs |
| `kss-sonnet-medium` | sonnet | medium | Executor — 1 layer, several files, fits plan to code |
| `kss-sonnet-high` | sonnet | high | Executor — demanding single-layer ticket, decided design |
| `kss-opus-medium` | opus | medium | Executor — design judgement, or escalation from sonnet |
| `kss-opus-high` | opus | high | Executor — contract, wire, tenant, money, cross-service, hard bugs |
| `kss-reviewer` | opus | high | Read-only — reviews a finished ticket, approve/reject + findings |
| `kss-explorer` | sonnet | low | Read-only — answers one bounded question, file:line evidence |
| `kss-runner` | sonnet | low | Runs the given command, returns only summary lines and failures |

There is deliberately no `kss-opus-low`, nothing above `high`. Executors may spawn
`kss-explorer`/`kss-runner` as helpers, under rules every executor enforces: **depth ≤2**,
helpers **never write code**, **≤5 per ticket**, return **≤1.5k chars**.

## Metrics and progress

`metrics.jsonl` lives in the feature folder, one appended line per event:

```json
{ "ts": "…", "phase": "execute", "ticket": "04", "kind": "subagent", "agent_type": "kss-opus-high",
  "model": "opus", "effort": "high", "depth": 1, "turns": 31,
  "tokens": { "fresh_in": 12000, "cache_write": 9000, "cache_read": 41000, "out": 6000,
              "cumulative": 6200000, "ctx_end": 148000 },
  "git": { "files": 4, "added": 210, "deleted": 35, "commits": 3 } }
```

Tokens are summed from the transcript JSONL `usage` field per assistant turn — **never** the
number the Agent tool displays, which is the final context size, not consumption. `SubagentStop`
records subagents; `SessionEnd` records the main session's phase cost; `kss-execute` records git
stats per integrated ticket.

`README.md` renders a `## Cost` table from it, one row per phase — agents, turns, cumulative
tokens split by type, wall time, files, +/−:

| Phase | Agents | Turns | Tokens (fresh/cache-w/cache-r/out) | Wall time | Files | +/− |
| --- | --- | --- | --- | --- | --- | --- |
| execute | 9 | 214 | 108k/81k/369k/54k | 41m | 17 | +842/−118 |

The execution progress board (states: `blocked`, `ready`, `running`, `reviewing`, `rejected`,
`integrated`) prints on every spawn, report, verdict, integrate or escalate:

```
kss · 012-batch-cutoff · execute
███████░░░  7/10 integrated · 82% of estimated turns
# | Ticket | State | Agent | Turns used/est | Since
04 | wallet-projection | running | kss-opus-high | 31/45 | 14m
Critical path: 01 → 03 → 04 → 09
Elapsed: 52m    Tokens: 19.8M
Last: kss-reviewer approved 03
```

The statusline (installed by `kss-init`) reads `.kss/current`, e.g. `kss 012 · execute · 3/5
████░░ · running: 04 (31t, 14m) · 19.8M tok`. With no active run it falls back to the previously
installed statusline's output.

## Configuration reference

See [`.kss/config.md` keys](#kssconfigmd-keys) under Installation.

## Conventions

- **Language — two levels.** *Terminal output* (boards, questions, summaries, progress,
  explanations) follows `conversation_language` in `~/.kss/preferences.md`; absent, it follows the
  language the user writes in. *Document content* (feature `README.md`, `00-brief.md` …
  `06-execution.md`, notes, ADRs, glossary entries, `kss-docs-*`, ticket files, PR body) follows
  `docs_language` in `.kss/config.md`; absent, it follows the conversation. File names, headings,
  field names, identifiers and the skill instructions themselves stay English.
  `~/.kss/preferences.md` is **user-local**: it lives outside every repository, is shared by all
  of them, and is never committed. Write it with `/kss-init` or `/kss-init --preferences`:

  ```
  conversation_language: pt-BR
  ```
- **Size caps**, refusal not truncation: `README.md` 4k, `01-investigation.md` 12k, `03-spec.md`
  15k, `04-plan.md` 20k, ticket/helper return 1.5k, each `kss-docs-*` doc 12k. Excess moves to
  `notes/`, linked not inlined; a spec over cap is refused with "split the feature".
- **Subagent budget.** ≤~80 turns, ≤~150k context. A ticket above 80 turns is re-sliced, never
  written and shipped with a warning.
- **Identifiers:** `AD-NN` auto decision, `D-NN` grilled decision, `DF-NN` deferred decision,
  `FR-NN` functional requirement, `US-N` user story, `RV-NN` review finding.

## Repository layout

```
kss-skill/
  .claude-plugin/    plugin.json, marketplace.json
  agents/            eight-agent matrix, installed into consuming projects
  hooks/             hooks.json (SubagentStop/SessionEnd/Stop) + metrics/progress scripts
  scripts/           current.mjs, render-cost.mjs, statusline.mjs
  skills/            the 13 kss-*/SKILL.md files, plus skills/README.md
  templates/         copied into a project's .kss/templates/ by kss-init
  DESIGN.md          the normative spec every builder reads first
  LICENSE
  README.md          this file
```

## License

MIT — see [`LICENSE`](LICENSE).
