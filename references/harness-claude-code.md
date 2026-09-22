# Harness adapter — Claude Code

Everything in KSS that depends on the agent harness is in this file and its Codex twin
(`harness-codex.md`). The skills stay neutral; they read the adapter that
`node .kss/scripts/harness.mjs` names. Tiers are in `tiers.md`.

## Invocation

| What | Here |
| --- | --- |
| Running a phase | `/kss-<phase> NNN-slug` — a slash command |
| Clearing the context between phases | `/clear` |
| The line a phase ends with | `Safe to /clear.` |

`node .kss/scripts/next.mjs <dir> --after <phase>` already prints the slash form when the harness
is `claude-code`; never type a `Next:` line by hand.

## Spawning

The `Agent` tool (`Task`) spawns one subagent per call. Several calls in **one message** run
concurrently — that is how the continuous frontier spawns everything that just became ready.

| Tier / role | `subagent_type` |
| --- | --- |
| `T1` | `kss-sonnet-low` |
| `T2` | `kss-sonnet-medium` |
| `T3` | `kss-sonnet-high` |
| `T4` | `kss-opus-medium` |
| `T5` | `kss-opus-high` |
| `explorer` | `kss-explorer` |
| `explorer-deep` | `kss-opus-medium`, with the read-only instruction in the prompt |
| `reviewer` | `kss-reviewer` (depth `full`) · `kss-reviewer-sonnet-medium` (depth `light`) — whatever `review.mjs pick` names |
| `runner` | `kss-runner` |
| `dispatcher` | `kss-dispatcher` — one `dispatch.mjs run` command, report back verbatim |

**Local overrides.** `node .kss/scripts/jev.mjs config` prints `models.tiers`; a row like
`"T2": {"claude-code": "kss-sonnet-high"}` replaces the agent for that tier on this machine only.
The name must be one of the executor agents (or its `kss:` form) — anything else is refused, and
the table above stands. The ticket and the graph keep saying `T2`. Besides the five in the table
there is **`kss-haiku`**: Claude Haiku, which takes no effort parameter, so the agent carries none and
a cross-harness run passes no `--effort`. It is never in the default ladder and may only replace
`T1`, `T2` or `T3` — a `T4`/`T5` row naming it is refused and the adapter row stands.

**Reviewer per depth.** `models.review.<full|light>.claude-code` names the reviewer for each review
depth, as `{"model": "sonnet", "effort": "high"}` or as an agent name. Five reviewer agents carry
the same read-only brief, one per pair: `kss-reviewer-sonnet-low`, `kss-reviewer-sonnet-medium`,
`kss-reviewer-sonnet-high`, `kss-reviewer-opus-medium` and `kss-reviewer` (opus/high). Never resolve
the name by hand: `node .kss/scripts/review.mjs pick '{"depth":"light","domain_risk":[]}'` does it,
checks `models.allowed` / `models.efforts`, and pins `full` on any domain risk.

**Read the names from the agent list before the first spawn.** Agents that come from the plugin are
namespaced `kss:kss-opus-high`; only a vendored copy in `.claude/agents/` answers to the bare name.
Use whichever form the list shows — a wrong name fails the spawn, not the ticket.

Model, effort, tools and the role prompt all come from the agent definition
(`agents/kss-*.md` in the plugin). The `prompt` carries only the work: for a ticket, the ticket file
pasted in verbatim plus the worktree path, and nothing else.

Sending work back to an agent — a failed report gate, a reviewer's findings, an escalation — is a
`SendMessage` to that agent's id or name, which keeps its context. A tier change is a new spawn.

## Limits

- One subagent is budgeted at **≤ ~80 turns** and **≤ ~150k context** (DESIGN.md §3.6).
- At most **5 explorers** in one fan-out; group the questions when there are more.
- Helper depth is at most 2. An executor may spawn `kss-explorer` and nothing else, and only when
  its ticket's Helpers field says so.

## Read-only roles

`kss-explorer` and every `kss-reviewer*` agent are declared with a read-only tool set in their agent files, so
the harness enforces it. Nothing extra needs to be said in the prompt.

## Running commands

The coordinator has `Bash` and runs the final suite itself, or hands the exact command to a
`kss-runner` subagent to keep the output out of its own context. **No other agent runs a test, lint,
build or type-check command, ever** (DESIGN.md §14.1).

## Watching a PR

`kss-review --watch` arms the `Monitor` tool — not a polling subagent — on a `gh` command, and the
coordinator wakes on a change. The watcher dies with the session; re-running resumes from the
cursor in `.kss/current`.

## Project conventions

| Thing | Here |
| --- | --- |
| Default `standards` entry | `CLAUDE.md` |
| Agent definitions | `agents/kss-*.md` in the plugin, `.claude/agents/` for a vendored install |
| Hook manifest | `hooks/hooks.json`, declared by the plugin manifest and merged automatically while the plugin is enabled |
| Hook events KSS uses | `SubagentStop`, `SessionEnd`, `Stop` |
| Statusline | `statusLine` in the user-level `~/.claude/settings.json` (DESIGN.md §18) |
| Transcript the metrics hooks read | Claude Code transcript JSONL; a turn is an assistant message with `usage`, deduplicated by `message.id` |
| Plugin root inside a hook | `${CLAUDE_PLUGIN_ROOT}` — set for hook commands only, never for a skill's shell |
