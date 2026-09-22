# KSS — Phase-based development for Claude Code and Codex

KSS is a family of fourteen skills, prefixed `kss-`, that carry a software task from a vague request
to merged-and-documented, one phase at a time, each its own skill invocation with a `/clear`
suggested at the end. It installs on **Claude Code** and on **Codex**, from one source tree and one
version, and a single feature can be specified in one and executed in the other — see
[Two harnesses, one feature folder](#two-harnesses-one-feature-folder). The problem it solves: a single long-lived session doing
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

## Two harnesses, one feature folder

KSS installs on **Claude Code** and on **Codex**, and a feature does not have to stay in one of
them. The spec side in one, the execution in the other, is a supported flow, not a workaround:

```
$kss-clarify … → $kss-investigate → $kss-spec → $kss-plan → $kss-tickets      (Codex)
                                                            /kss-execute → /kss-review   (Claude Code)
```

There is no export, no sync and no handoff file. Both apps open the same working copy, every phase
commits its own artifacts before it prints its summary, and **no artifact names a harness, a model
or an agent type** — a ticket says `Tier: T5`, never `Model: opus`. So the handoff is: finish the
phase, read its `Next:` line, open the other app in the same directory, type the same phase with
that app's prefix.

What differs between the two — how a phase is invoked, how a subagent is spawned, what a tier maps
to, how a read-only role is enforced, how a PR is watched — lives in one adapter file each,
`.kss/references/harness-claude-code.md` and `.kss/references/harness-codex.md`. `kss-init` installs
**both**, whichever harness you ran it from; `scripts/harness.mjs` decides which one applies at
runtime (environment, then the parent-process chain, then what `.kss/current` recorded), and asks
once if it cannot tell. `KSS_HARNESS=codex` forces it.

| | Claude Code | Codex |
| --- | --- | --- |
| Invoke a phase | `/kss-spec 012-x` | `$kss-spec 012-x` |
| Subagents | the `Agent` tool, one agent definition per tier | `spawn_agent` with `fork_turns: "none"` + per-tier `model`/`reasoning_effort` |
| Read-only roles | enforced by the agent's tool list | enforced by the preamble in the brief |
| Watch a PR | the `Monitor` tool, in the background | a foreground poll loop |
| Status line | installed by `kss-init` | none — `$kss-status` prints the board |
| Standards file | `CLAUDE.md` | `AGENTS.md` (both, when the repo has both) |

The full contract is [DESIGN.md §19](DESIGN.md#19-harnesses).

## Installation

### Claude Code

```
/plugin marketplace add kelwinssavoia/kss-skill
/plugin install kss@kss-skill
```

Enable it per project via `enabledPlugins` in `.claude/settings.json` (project or user level).

### Codex

Add the repository as a marketplace and install the same plugin — the manifest Codex reads is
`.codex-plugin/plugin.json`, next to the Claude one:

```
codex plugin marketplace add kelwinssavoia/kss-skill
codex plugin install kss
```

`$kss-init` then offers to install the three metrics hooks into the user-level
`$CODEX_HOME/hooks.json` — a Codex plugin manifest may not declare hooks, so they are a user-level
file here, exactly as the statusline is on Claude Code. Codex asks to **trust** a hook the first
time; until you grant it (`/hooks`), every phase still works and `metrics.jsonl` simply stays empty.
If you already run KSS in Claude Code on this machine, `/import` migrates the setup instead.

Two notes on the Codex packaging, both in [DESIGN.md §19.4](DESIGN.md#194-packaging): the skills
keep `disable-model-invocation: true` in their frontmatter, because that is what stops Claude Code
from invoking a phase on its own — Codex's runtime loads them fine and honours
`allow_implicit_invocation: false` for the same purpose, but its *ingestion* validator wants that
key absent, so the plugin is meant to be installed from this repository rather than submitted to
OpenAI's curated marketplace.

### Both

The metrics hooks (`SubagentStop`, `SessionEnd`, `Stop`) live in `hooks/hooks.json` — the event
names are the same on both harnesses. Claude Code merges them in automatically while the plugin is
enabled; Codex takes them from the user-level file `kss-init` offers to write.

Every phase commits the artifacts it wrote (`docs(NNN): <phase>`), the next phase commits what the
hooks appended after that, and the last phase closes the run — the feature branch is clean when a
skill says `done` (DESIGN.md §3.8).

Then, inside the project, run `/kss-init` (`$kss-init` in Codex): interactive, one question per
turn, writing nothing until you confirm the plan. It asks for every key below (offering a default),
plus execution mode (multi-agent/single-session), layout references and standards files, then:

1. Writes `.kss/config.md`.
2. Copies `templates/` into `.kss/templates/`, `scripts/` into `.kss/scripts/` and `references/`
   into `.kss/references/`, so the skills read the project's own copy and it can be customised.
   **Both harness adapters are installed, whichever harness you ran it from** — that is what makes
   the handoff below work without re-running anything.
3. *(Claude Code)* Asks whether to install the statusline into **user-level**
   `~/.claude/settings.json` (`statusLine: {type: command, command: node
   <plugin>/scripts/statusline.mjs}`), backing up any existing one to the user-level
   `~/.kss/statusline.backup.json` — KSS falls back to printing that output when no run is active.
   If the statusline is already KSS (a second project on the same machine, or an upgrade) nothing
   is backed up; the path is just refreshed. On Codex this step is skipped.
4. *(Claude Code)* Creates the thirteen-agent matrix in `.claude/agents/`, skipping files that already
   exist (asks before overwriting). On Codex there is no agent registry and nothing is written.
5. Adds `.kss/current`, `.kss/worktrees/`, `.kss/statusline.backup.json` and
   `.kss/config.local.json` to `.gitignore`; config, templates, references and feature folders stay
   tracked.

Optionally, then run `/kss-config` to write the per-machine preferences — see
[Preferences, cross-harness and Jev](#preferences-cross-harness-and-jev-kssconfiglocaljson).

### `.kss/config.md` keys

| Key | Meaning | Default |
| --- | --- | --- |
| `features_root` | Where feature folders live | `docs/features` |
| `next_number` | Used only when greater than highest existing `NNN` | highest + 1 |
| `base_branch` | Branch PRs target | remote HEAD, else `main` |
| `branch_prefix` | Prepended to `NNN-slug` in the branch name | empty |
| `domain_docs` | Glossary and ADR locations | `CONTEXT.md`, `docs/adr/` if present |
| `layout_references` | Design exports/design-system docs — the only layout truth | empty |
| `standards` | Files whose rules bind explorers and executors | `AGENTS.md` and/or `CLAUDE.md` if present |
| `explorer_tier` | Tier read-only explorers run at: `explorer` or `explorer-deep` | `explorer` |
| `auto_decide` | `false` = every decision goes to the grill | `true` |
| `execution` | `multi-agent` or `single-session` | `multi-agent` |
| `full_suite` | Always `local` — the coordinator runs the suite once after integration | `local` |
| `tracker` | `none`, or a tracker to mirror tickets into | `none` |
| `review_autopilot` | `fixes` \| `all` \| `none` | `fixes` |
| `docs_root` / `docs_index` | Where `kss-docs-*` writes | `docs` / `docs/README.md` |
| `docs_language` | Language of the *content* of generated documents | empty = follow the conversation |

With no `layout_references`, `kss-spec` refuses to invent a layout and flags every layout
question instead of guessing.

**Requirements:** Node ≥ 18 (`hooks/*.mjs`, `scripts/*.mjs`), `gh` CLI (`kss-review` reads/polls
PR threads/CI), git (every feature is a branch; each ticket gets its own worktree). Tests:
`node --test hooks/*.test.mjs scripts/*.test.mjs`.

## Skills

Written `/kss-name` below, which is how a phase is invoked in Claude Code. In Codex the same phase
is `$kss-name`, with the arguments typed after it. Nothing else about a phase differs, and you never
type the prefix into an artifact: `scripts/next.mjs` prints the right one.

### `kss-config` — `/kss-config [--show | --check | key=value …]`
Writes the gitignored `.kss/config.local.json`: the models and efforts this machine may spend per
tier, and the Jev switches, thresholds and API key. Optional; any time after `kss-init`.
- **Reads/writes:** reads `.kss/templates/config.local.json`, `.kss/references/tiers.md`; writes
  `.kss/config.local.json` and the `.gitignore` line if it is missing. Never prints the key whole.
- **Confirmation:** one turn per key, a final turn with the redacted file before writing, then a
  connectivity check when Jev is on.

### `kss-init` — `/kss-init` (no arguments)
Sets the project up for the workflow. Run once, first.
- **Reads/writes:** reads `templates/`, `CONTEXT.md`/`CLAUDE.md`/`docs/adr/`/`specs/` for
  defaults; writes `.kss/config.md`, `.kss/templates/`, `.kss/scripts/`, `.kss/references/`
  (both harness adapters), `.gitignore`, and — Claude Code only — `.claude/agents/kss-*.md` and,
  on its own yes, `~/.claude/settings.json` (statusline).
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

### `kss-investigate` — `/kss-investigate NNN-<slug> [--deep]`
Maps where the feature lives and what to reuse via parallel read-only explorers; the main session
only synthesizes. Classifies every decision the feature needs.
- **Reads/writes:** reads `README.md`, `00-brief.md`, `.kss/config.md`, `domain_docs`; writes
  `01-investigation.md`, `auto-decisions.md`, the Investigation block.
- **Confirmation:** none mid-phase — 1–5 explorers spawn, escalating to `explorer-deep` for
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

## Tiers

A ticket says how much agent it deserves, never which model — that is what lets the same ticket be
executed from either harness. The tier is the portable name; each harness adapter maps it:

| Tier | The ticket it belongs to | Claude Code | Codex |
| --- | --- | --- | --- |
| `T1` | mechanical, local work with a known pattern | `kss-sonnet-low` | `gpt-5.6-luna` · low |
| `T2` | bounded multi-file implementation following explicit patterns; the normal default | `kss-sonnet-medium` | `gpt-5.6-terra` · medium |
| `T3` | demanding same-area reconciliation with decisions already made | `kss-sonnet-high` | `gpt-5.6-terra` · high |
| `T4` | real technical judgement, unresolved semantics, or meaningful cross-layer reconciliation | `kss-opus-medium` | `gpt-6-astra` · medium |
| `T5` | long-horizon integration, difficult diagnosis, unresolved cross-service state/failure semantics, or escalation after failure | `kss-opus-high` | `gpt-6-astra` · high |
| `explorer` | one bounded read-only question, `file:line` evidence | `kss-explorer` | `gpt-5.4-mini` · low |
| `explorer-deep` | the same, on a contract / tenant / money question | `kss-opus-medium` | `gpt-6-astra` · medium |
| `reviewer` | one finished ticket's diff — approve or reject + findings; depth `full` | `kss-reviewer` | `gpt-6-astra` · high |
| `reviewer` | the same, depth `light` — only on Jev's `review_depth`, never with domain risk | `kss-reviewer-sonnet-medium` | `gpt-5.6-terra` · medium |
| `runner` | coordinator-only, final run — the given command, summarised | `kss-runner` | `gpt-5.4-mini` · low |
| `dispatcher` | coordinator-only — runs one ticket in the *other* harness's CLI, returns its report | `kss-dispatcher` | `gpt-5.4-mini` · low |

Escalation is **one tier at a time**, `T1 → T5`, never past it. Tickets written before tiers carry
`Model` + `Effort`; they are translated on the fly, never rewritten
([`references/tiers.md`](references/tiers.md)).

On Claude Code the plugin ships those agents — plus `kss-reviewer-sonnet-low`, `kss-reviewer-sonnet-high` and `kss-reviewer-opus-medium`, so `models.review` can name any pair — registered as `kss:kss-*` while it is enabled —
that prefix is the name to spawn them by. `kss-init` copies them into the project's
`.claude/agents/` **only when the plugin is not available** (a vendored install, where they answer
to the bare name); a project copy stops following releases and drifts. On Codex there is no agent
registry: the role preambles live in the Codex adapter and the coordinator pastes them into the
brief.

Executors may spawn an `explorer` as a helper, under rules every executor enforces: **depth ≤2**,
helpers **never write code**, **≤5 per ticket**, return **≤1.5k chars**. **No subagent runs tests,
lint, build or tsc**: executors write the specs and commit them before the implementation, and the
coordinator runs the whole suite once, after every ticket is integrated.

## Metrics and progress

`metrics.jsonl` lives in the feature folder, one appended line per event:

```json
{ "ts": "…", "phase": "execute", "harness": "codex", "ticket": "04", "kind": "subagent",
  "agent_type": "T5", "model": "gpt-6-astra", "effort": "high", "depth": 1, "turns": 31,
  "tokens": { "fresh_in": 12000, "cache_write": 9000, "cache_read": 41000, "out": 6000,
              "cumulative": 6200000, "ctx_end": 148000 },
  "git": { "files": 4, "added": 210, "deleted": 35, "commits": 3 } }
```

Tokens are summed from the transcript per model response — **never** the number the harness
displays for a subagent, which is its final context size, not consumption. Claude Code writes one
assistant message per line with a `usage` object, Codex writes a rollout whose `token_usage_record`
items carry the same figures, and the hooks read both. `SubagentStop` records subagents;
`SessionEnd` records the main session's phase cost; `kss-execute` records git stats per integrated
ticket.

`README.md` renders a `## Cost` table from it, one row per phase — agents, turns, cumulative
tokens split by type, wall time, files, +/−:

| Phase | Harness | Agents | Turns | Tokens (fresh/cache-w/cache-r/out) | Wall time | Files | +/− |
| --- | --- | --- | --- | --- | --- | --- | --- |
| spec | codex | 1 | 6 | 22k/4k/61k/9k | 7m | 1 | +180/−0 |
| execute | claude-code | 9 | 214 | 108k/81k/369k/54k | 41m | 17 | +842/−118 |

A phase worked from both prints both — that column is how a handoff shows up in the artifact.

The execution progress board (states: `blocked`, `ready`, `running`, `reviewing`, `rejected`,
`integrated`) prints on every spawn, report, verdict, integrate or escalate:

```
kss · 012-batch-cutoff · execute · codex
███████░░░  7/10 integrated · 82% of estimated turns
# | Ticket | State | Tier | Turns used/est | Since
04 | wallet-projection | running | T5 | 31/45 | 14m
Critical path: 01 → 03 → 04 → 09
Elapsed: 52m    Tokens: 19.8M
Last: reviewer approved 03
```

The statusline is Claude Code only (Codex has no status-line hook; there, `$kss-status` prints the
board on demand). Installed by `kss-init`, it reads `.kss/current`, e.g. `kss 012 · execute · 3/5
████░░ · running: 04 (31t, 14m) · 19.8M tok`. With no active run it falls back to the previously
installed statusline's output.

## Preferences, cross-harness and Jev (`.kss/config.local.json`)

`.kss/config.md` is the project's shared configuration and is committed. What varies per machine
and per person lives in **`.kss/config.local.json`**, written by `/kss-config`, gitignored by
`kss-init` before it can exist, because it holds an API key. Template: `templates/config.local.json`.

```jsonc
{
  "models": {
    "allowed": { "claude-code": ["sonnet", "opus"], "codex": ["gpt-5.4-mini", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-6-astra"] },
    "efforts": ["low", "medium", "high"],
    "tiers": { "T2": { "claude-code": "kss-sonnet-high", "codex": { "model": "gpt-5.6-terra", "reasoning_effort": "low" } } },
    "review": {                          // reviewer per review depth — scripts/review.mjs resolves it
      "full":  { "claude-code": { "model": "opus",   "effort": "high"   }, "codex": { "model": "gpt-6-astra",   "reasoning_effort": "high"   } },
      "light": { "claude-code": { "model": "sonnet", "effort": "medium" }, "codex": { "model": "gpt-5.6-terra", "reasoning_effort": "medium" } }
    }
  },
  "jev": {
    "enabled": true,
    "api_key": "",                       // or leave empty and set api_key_env
    "api_key_env": "TYPESAFE_API_KEY",
    "model": "jev-latest",
    "trace": true,                       // <feature>/jev-trace.jsonl, committed with the phase
    "auto_assumptions": { "enabled": true, "confidence": 0.85, "by_category": { "technical": 0.85, "layout": 0.9, "business": 1.01 }, "max_options": 12 },
    "tier_selection":   { "enabled": true, "confidence": 0.7, "on_low_confidence": "rubric" },
    "reasoning":        { "enabled": false, "confidence": 0.8, "decisions": ["escalation_class", "report_gate"], "effort_when_delegated": {} }
  }
}
```

### Cross-harness execution

With `execution.cross_harness.enabled`, `kss-execute` may run a ticket in the **other** harness's
CLI — `codex exec` from a Claude Code coordinator, `claude -p` from a Codex one — through a light
`dispatcher` subagent whose whole job is one `node .kss/scripts/dispatch.mjs run …` command.
`split` is the target proportion per harness (weights, normalised); `pick` assigns each ticket to
the harness furthest below its share, so ten `T1`–`T3` tickets at `70/30` land 7 and 3. `tiers`
bounds what may leave (default `T1`–`T3`), a harness whose CLI is not on `PATH` is skipped with a
reason, and a failed foreign run is re-spawned locally once. The foreign CLI gets the same brief a
local executor would — the harness's executor preamble plus the ticket — and its tokens, turns and
cost are written to `metrics.jsonl` by the script, tagged with the harness that ran it, so the
`## Cost` table shows the mix. Assignments are logged in `<feature>/dispatch.jsonl`;
`dispatch.mjs status NNN-slug` prints target vs observed.

```jsonc
"execution": {
  "cross_harness": {
    "enabled": true,
    "split": { "claude-code": 60, "codex": 40 },
    "tiers": ["T1", "T2", "T3"],
    "timeout_ms": 3600000,
    "cli": {
      "claude-code": { "bin": "claude", "permission_mode": "acceptEdits", "allowed_tools": ["Read", "Grep", "Glob", "Edit", "Write", "Bash(git *)"], "max_turns": 80 },
      "codex":       { "bin": "codex", "sandbox": "workspace-write", "approval_policy": "never" }
    }
  }
}
```

The `allowed_tools` default is deliberate: a foreign Claude executor can read, edit and commit, and
nothing else — which is how the "nobody but the coordinator runs tests" rule survives the CLI
boundary. Full design: [DESIGN.md §21](DESIGN.md#21-cross-harness-execution).

### Jev

[Jev](https://docs.typesafe.ai) is TypeSafe's System One classifier: it answers *choice*, *score*
and *yes/no* questions over a small JSON state with a probability per option and a confidence. It
does not generate text, so KSS hands it only forks whose options are already enumerated, each
behind its own switch and threshold:

| Switch | Phase | Effect when confidence clears the threshold |
| --- | --- | --- |
| `auto_assumptions` | `kss-investigate` | an `open` technical/layout decision becomes an `AD-`, recorded with Jev's confidence; below it, Jev's ranking is the proposed answer for the grill |
| `tier_selection` | `kss-tickets` | the ticket takes Jev's execution-uncertainty tier; below threshold, the rubric decides. Domain safeguards stay independent |
| `reasoning` (experimental) | `kss-execute` | the coordinator takes Jev's `execution`/`reasoning` class on a reject, or `pass`/`fail` on a report; with `review_depth` in `decisions`, a ticket with no domain risk that Jev calls `light` goes to the `models.review.light` reviewer |

Business decisions are never auto: their threshold defaults above 1.0 on purpose. Every call goes
through `node .kss/scripts/jev.mjs` — exit 3 means off, exit 2 means a failure the phase reports
and falls back from; no phase ever stops because Jev did not answer. `models.tiers` changes what
*this machine* spawns for a tier; tickets and graphs keep saying `T3` (DESIGN.md §19.1). The full
design, and what to measure before trusting a switch, is [DESIGN.md §20](DESIGN.md#20-jev--a-system-one-classifier-in-the-loop).

## Configuration reference

See [`.kss/config.md` keys](#kssconfigmd-keys) under Installation, and
[Preferences, cross-harness and Jev](#preferences-cross-harness-and-jev-kssconfiglocaljson) for `.kss/config.local.json`.

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
  .claude-plugin/    plugin.json, marketplace.json  — Claude Code
  .codex-plugin/     plugin.json                    — Codex
  agents/            thirteen-agent matrix — Claude Code only
  hooks/             hooks.json (SubagentStop/SessionEnd/Stop) + metrics/progress scripts
  references/        tiers.md + one adapter per harness → .kss/references/
  scripts/           harness.mjs, current.mjs, next.mjs, render-cost.mjs, statusline.mjs, jev.mjs, dispatch.mjs, review.mjs
  skills/            the 13 kss-*/SKILL.md files (+ agents/openai.yaml for Codex), skills/README.md
  templates/         copied into a project's .kss/templates/ by kss-init
  DESIGN.md          the normative spec every builder reads first
  LICENSE
  README.md          this file
```

## License

MIT — see [`LICENSE`](LICENSE).
