---
name: kss-init
description: Set up KSS in this project — interview for .kss/config.md, copy the templates, scripts and harness references into the project, and install whatever the current harness needs. Run once per project, before any other kss- skill.
argument-hint: "[--preferences]"
disable-model-invocation: true
---

Set this project up for the KSS workflow. Interactive: **one question per turn**, every question
showing its default. Write nothing until the interview is finished and the user has confirmed the
plan.

With `--preferences`, do **only** step 0 below — ask the conversation language, write
`~/.kss/preferences.md`, print the value, and stop. No git repository is required, nothing in the
project is read or written.

## Harness

**Resolve the harness first**, before anything else, and say which one you found:
`node .kss/scripts/harness.mjs` if the scripts are already there, otherwise read the environment
yourself — `CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT` means Claude Code, `CODEX_HOME` /
`CODEX_SANDBOX` means Codex. If neither is conclusive, **ask** — one question, two options.

The harness decides three of the write steps below (agents, statusline, hooks) and the default for
`standards`. Everything else is identical, and that is on purpose: a project initialised from one
harness is fully usable from the other, because the parts that differ live in
`.kss/references/harness-*.md` and **both** are installed (DESIGN.md §19).

## Inputs

- No arguments.
- The repository root (`git rev-parse --show-toplevel`) — everything is written relative to it.
- `templates/`, `scripts/`, `references/` and `hooks/` in this plugin, next to this skill's folder.
- `~/.kss/preferences.md`, if it exists — the user-local `conversation_language`. It is **never**
  part of any repository.
- Existing signals to propose defaults from: `CONTEXT.md`, `AGENTS.md`, `CLAUDE.md`, `docs/adr/`,
  `docs/`, `specs/`, the current branch, `git symbolic-ref refs/remotes/origin/HEAD`.

## Preconditions

1. Run inside a git repository. If not, stop: "kss-init needs a git repository."
2. If `.kss/config.md` already exists, print its current values and ask in one turn: `overwrite`,
   `edit <key>=<value> …`, or `cancel`. Never silently overwrite.
3. Resolve the **plugin root** — the directory containing `agents/`, `hooks/`, `references/`,
   `scripts/` and `templates/`, i.e. the parent of the parent of this SKILL.md. Confirm the
   candidate really is it with `ls <candidate>/references/tiers.md`. If it is not obvious, search
   the harness's own plugin cache:

   ```bash
   # Claude Code
   ls -d ~/.claude/plugins/cache/*/kss/*/references/tiers.md 2>/dev/null
   # Codex
   ls -d "${CODEX_HOME:-$HOME/.codex}"/plugins/cache/*/kss/*/references/tiers.md 2>/dev/null
   # either, vendored or cloned
   find ~ -maxdepth 6 -type f -path '*/kss/*/references/tiers.md' 2>/dev/null | head
   ```

   Store the directory two levels above that file as `<PLUGIN>`. **If the search finds nothing, or
   finds more than one, ask the user for the path** — one question, showing what you found. Never
   guess it. Without `<PLUGIN>` you cannot copy the scripts or the references; say so and stop
   rather than writing a half-configured project.

   Note that the plugin-root environment variable (`${CLAUDE_PLUGIN_ROOT}`, `${PLUGIN_ROOT}`) is
   **not** available here: it is expanded only for hook commands. That is exactly why the scripts
   and references are copied into the project (write steps 3 and 4) and why every skill calls them
   as `node .kss/scripts/<script>.mjs` and reads `.kss/references/<file>.md`.

## Procedure

Ask these in order, one per turn. Accept a bare Enter as the default. Do not batch them.

0. **Preferred language for conversation output? (blank = follow the user's messages)** — this is
   `conversation_language`, and it is the one answer that does **not** go into the project: it is
   written to the user-local `~/.kss/preferences.md`, shared by every project and never committed.
   If that file already exists, show its current value and only rewrite it when the user confirms;
   a bare Enter keeps it. Creating the file writes `~/.kss/` first.

1. `features_root` — where feature folders live. Default: `docs/features` (propose `specs` if that
   directory already holds `NNN-slug` folders).
2. `next_number` — the number the next feature gets, used only when it is greater than the highest
   existing `NNN`. Default: highest found + 1, else `1`.
3. `base_branch` — the branch PRs target. Default: the remote HEAD, else `main`.
4. `branch_prefix` — prepended to `NNN-slug` when creating a feature branch. Default: empty.
5. `domain_docs` — glossary and ADR locations. Default: whichever of `CONTEXT.md` and `docs/adr/`
   exist.
6. `layout_references` — design exports and design-system docs; the **only** source of layout
   truth. Default: empty. Say plainly that with none configured, `kss-spec` will refuse to invent a
   layout and will flag every layout question instead.
7. `standards` — files whose rules bind explorers and executors. Default: **whichever of
   `AGENTS.md` and `CLAUDE.md` exist** — both, when the repository has both. This list is read by
   agents on either harness, so it is never narrowed to the one the current harness prefers.
8. `explorer_tier` — the tier read-only explorers run at: `explorer`, or `explorer-deep` to read
   every question deeply. Default: `explorer`. (A project carrying the old `explorer_model` key is
   migrated: `opus` becomes `explorer-deep`, anything else becomes `explorer`.)
9. `auto_decide` — `true` lets `kss-investigate` settle low-risk decisions on its own; `false`
   sends every decision to the grill. Default: `true`.
10. `execution` — `multi-agent` or `single-session`. Explain the difference in two lines before
    asking: **multi-agent** slices by layer, runs one subagent per ticket in its own git worktree,
    reviews and integrates each; **single-session** runs vertical slices in this session with a
    `/clear` between them, no worktrees, no per-ticket tier. Default: `multi-agent`.
11. `full_suite` — always `local`: the coordinator runs the suite once after integration (`ci`
    is no longer honoured; no subagent ever runs tests, lint, build or tsc). Default: `local`.
12. `tracker` — `none`, or a tracker to mirror tickets into. Default: `none`.
13. `review_autopilot` — `fixes` | `all` | `none`. Default: `fixes`.
14. `docs_root` / `docs_index` — where `kss-docs-*` writes. Defaults: `docs` and `docs/README.md`.
15. **Language of generated documents in this project? (blank = follow the conversation)** — this
    is `docs_language`. It governs the *content* of every artifact KSS writes into the repository
    (feature `README.md`, `00-brief.md` … `06-execution.md`, `notes/`, ADRs, glossary entries,
    `kss-docs-tech`, `kss-docs-product`, ticket files, the PR body). File names, headings, field
    names and identifiers stay English either way. Default: empty. Propose the language the
    existing docs under `features_root`/`docs_root` are written in, when there is an obvious one.

Then, still one turn each:

16. Print the full config as it will be written, plus the file list below, and ask for
    confirmation. Nothing is written before this answer.
17. **Claude Code only** — ask whether to install the KSS statusline into the **user-level**
    `~/.claude/settings.json`. On Codex, skip this question entirely and say
    `Statusline: not applicable on Codex — $kss-status prints the board.`

    First read the current `statusLine.command` and classify it:
    - **absent** — nothing to back up;
    - **already KSS** — the command contains `statusline.mjs` or the word `kss`. Nothing is backed
      up (backing it up is how the fallback ends up calling itself — see DESIGN.md §18.1). Say
      "statusline is already KSS at `<old path>`; it will be pointed at `<PLUGIN>`" and only
      refresh the path;
    - **something else** — it is copied to the **user-level** `~/.kss/statusline.backup.json`,
      **unless that file already exists**, in which case the existing backup is kept and the user
      is told so. The backup is never written inside the repository.

    Show exactly what will change:
    - the backup action decided above;
    - `statusLine` becomes
      `{"type": "command", "command": "node <PLUGIN>/scripts/statusline.mjs"}`.
    This is the **one** absolute plugin path KSS writes anywhere, and it is resolved now, at init
    time, from `<PLUGIN>` (precondition 3). It has to be absolute because `~/.claude/settings.json`
    is user-level and shared by every project; the script reads `<cwd>/.kss/current`, so a single
    installed copy serves them all. Print the exact path in the question, and note that it must be
    re-run after the plugin is reinstalled at a new path.
    Say that the KSS statusline prints the previous statusline's output whenever no KSS run is
    active, so nothing is lost. **Never edit `~/.claude/settings.json` without this yes.**

18. **Codex only** — ask whether to install the three metrics hooks into the user-level
    `$CODEX_HOME/hooks.json` (`~/.codex/hooks.json` when `CODEX_HOME` is unset). A Codex plugin
    cannot ship them: the plugin ingestion contract does not accept a `hooks` field, so they are a
    user-level file here, exactly as the statusline is on Claude Code. On Claude Code skip this
    question — the plugin's own `hooks/hooks.json` is merged automatically.

    Find the file next to `config.toml`. Show exactly what will be merged, with `<PLUGIN>` already
    resolved and absolute (the plugin-root variable is not set for a hook installed this way):

    ```json
    {
      "hooks": {
        "SubagentStop": [{ "hooks": [{ "type": "command", "command": "node <PLUGIN>/hooks/metrics-subagent.mjs" }] }],
        "SessionEnd":   [{ "hooks": [{ "type": "command", "command": "node <PLUGIN>/hooks/metrics-session.mjs" }] }],
        "Stop":         [{ "hooks": [{ "type": "command", "command": "node <PLUGIN>/hooks/progress-stop.mjs" }] }]
      }
    }
    ```

    Rules for the write: **merge, never replace** — keep every event and every entry already there,
    and add only the three whose command is not present yet; back the file up to
    `~/.kss/codex-hooks.backup.json` before the first change, and never overwrite an existing
    backup. Say afterwards that **Codex asks to trust a hook before it runs it** (`/hooks`), and
    that until it is trusted every phase still works and `metrics.jsonl` simply stays empty.
    **Never edit `hooks.json` without this yes**; a `no` is fine and costs only the cost table.

On confirmation, write — in this order:

0. `~/.kss/preferences.md` — only when step 0 produced a value or a confirmed change. Create `~/.kss/`
   if it is missing. Same fenced `key: value` style as `.kss/config.md`, one key today:

   ```
   conversation_language: <answer>
   ```

   This file is **user-local**: it lives outside every repository, is never copied into one and is
   never committed. Do not add it to the project, do not reference it from `.kss/config.md`.

1. `.kss/config.md`, rendered from `<PLUGIN>/templates/config.md` with the answers substituted.
2. `.kss/templates/` — copy every file and folder under `<PLUGIN>/templates/` into it. The skills
   read templates from here, so the project can customise them. If `.kss/templates/` already
   exists, ask before overwriting; never merge silently.
3. `.kss/scripts/` — copy every `<PLUGIN>/scripts/*.mjs` **except `*.test.mjs`** plus
   `<PLUGIN>/hooks/kss-lib.mjs` (the scripts import it) into it, overwriting freely: these are
   plugin copies, not user content. The skills invoke them as `node .kss/scripts/harness.mjs`,
   `node .kss/scripts/current.mjs …`, `node .kss/scripts/next.mjs …` and
   `node .kss/scripts/render-cost.mjs …`. Verify with `node .kss/scripts/current.mjs get` — it must
   print `null` and exit 0 — and with `node .kss/scripts/harness.mjs`, which must print the harness
   you resolved above and an adapter path that exists.
4. `.kss/references/` — copy **every** file under `<PLUGIN>/references/`: `tiers.md` and the
   adapter of **each** harness, not only the current one. This is what makes the handoff work: a
   feature specified from Codex and executed from Claude Code finds its adapter already in the
   project. Overwrite freely, same as the scripts.
5. **Claude Code only** — `.claude/agents/`, and **only when the plugin's agents are not already
   available**. The plugin ships the thirteen (`kss-sonnet-low`, `kss-sonnet-medium`,
   `kss-sonnet-high`, `kss-opus-medium`, `kss-opus-high`, `kss-reviewer`, `kss-reviewer-sonnet-low`,
   `kss-reviewer-sonnet-medium`, `kss-reviewer-sonnet-high`, `kss-reviewer-opus-medium`, `kss-explorer`,
   `kss-runner`, `kss-dispatcher`) and registers them as `kss:kss-*` while it is enabled: when they are in the agent
   list, write nothing here and say so in the summary. Copy them into the project only for a
   vendored, plugin-less install — the ones that are absent, asking before overwriting any that
   exists and accepting "keep mine". **A project copy is a fork**: it stops following plugin
   releases and has to be re-synced by hand, which is how a project ends up running last month's
   rules.

   On Codex there is no agent registry and nothing is written: the role preambles live in
   `.kss/references/harness-codex.md`, which write step 4 already installed.
6. `.gitignore` — append `.kss/current`, `.kss/worktrees/`, `.kss/statusline.backup.json` and
   `.kss/config.local.json` if they are not already ignored. The first two are live state, not
   history (`.kss/worktrees/NNN-slug/NN` is where `kss-execute` puts each ticket's git worktree);
   the third is the legacy per-project backup, a user setting that must never be committed; the
   fourth is the per-machine preferences file `kss-config` writes — it carries the Jev API key, so
   it is ignored **before** it can exist. Leave
   `.kss/config.md`, `.kss/templates/`, `.kss/scripts/`, `.kss/references/` and the feature folders
   tracked.

6b. **Legacy backup migration** — always, whether or not step 17 ran. If
   `<repo>/.kss/statusline.backup.json` exists:
   - when its command contains `statusline.mjs` or `kss`, **delete it** and say
     "removed self-referencing .kss/statusline.backup.json (kss ≤ 0.1.3 bug)". Also remove it from
     git (`git rm --cached -q .kss/statusline.backup.json`) if it is tracked;
   - otherwise **move** it to `~/.kss/statusline.backup.json` when that file does not exist yet,
     or delete the project copy when a user-level backup is already there. Say which.
7. `$CODEX_HOME/hooks.json` — Codex only, and only if step 18 was a yes. Merge the three entries
   as described there, after writing `~/.kss/codex-hooks.backup.json` when that file does not exist
   yet. Keep every other event and entry byte-identical.

7b. `~/.claude/settings.json` — Claude Code only, and only if step 17 was a yes. Apply the backup
   action decided in step 17 first: write `~/.kss/statusline.backup.json` (creating `~/.kss/`)
   preserving whatever shape the old value had, or write nothing when the old value was already KSS
   or a backup exists. **Never write a backup whose command contains `statusline.mjs` or `kss`.**
   Then set `statusLine`. Keep the rest of the file byte-identical apart from that key.

On **Claude Code**, do not write hooks anywhere: the plugin's `hooks/hooks.json` is declared by
`.claude-plugin/plugin.json` and merged while the plugin is enabled. Say so in the summary. On
**Codex** they are the user-level file of step 18, because a Codex plugin manifest may not declare
hooks — and either way Codex asks to trust them once before it runs them.

## Outputs

| Path | Contents |
| --- | --- |
| `~/.kss/preferences.md` | `conversation_language` — user-local, outside the repo, never committed |
| `.kss/config.md` | the answers |
| `.kss/templates/` | the project's copy of the KSS templates |
| `.kss/config.json` | the committed Jev policy — everything but the key, so it reaches every worktree and every teammate |
| `.kss/scripts/` | `harness.mjs`, `current.mjs`, `next.mjs`, `render-cost.mjs`, `project-cost.mjs`, `statusline.mjs`, `jev.mjs`, `dispatch.mjs`, `review.mjs`, `kss-lib.mjs` |
| `.kss/references/` | `tiers.md`, `tier-calibration.md`, `spend-discipline.md` and **both** harness adapters |
| `.claude/agents/kss-*.md` | the thirteen-agent matrix (five executors, five reviewers, explorer, runner, dispatcher) — Claude Code, vendored installs only |
| `~/.kss/statusline.backup.json` | the previous statusline, when a non-KSS one was replaced — Claude Code only, user-local, never in the repo |
| `$CODEX_HOME/hooks.json` | the three metrics hooks — Codex only, user-local, never in the repo |
| `~/.kss/codex-hooks.backup.json` | the previous `hooks.json` — Codex only, written once |
| `.gitignore` | `.kss/current`, `.kss/worktrees/`, `.kss/statusline.backup.json` and `.kss/config.local.json` added |

`.kss/current` is not created here — `kss-clarify` writes it when a feature starts.

## Summary

Print exactly:

```
KSS ready · <repo name>
Harness: <claude-code|codex> (the other one works too — both adapters are installed)
Config: .kss/config.md (features_root <features_root>, execution <execution>, base <base_branch>)
Languages: conversation <conversation_language | follows you> · docs <docs_language | follows the conversation>
Templates: .kss/templates/ (<n> files)
Scripts: .kss/scripts/ (<n> files) — skills call node .kss/scripts/current.mjs
References: .kss/references/ (tiers.md + <n> harness adapters)
Agents: .claude/agents/ (<n> written, <n> kept) | not applicable on Codex
Statusline: installed (previous backed up to ~/.kss/statusline.backup.json) | installed (already KSS, path refreshed) | skipped | not applicable on Codex
Legacy backup: none | removed self-referencing .kss/statusline.backup.json | moved to ~/.kss/
Hooks: come with the plugin — SubagentStop, SessionEnd, Stop. Nothing to install. | installed into <path>/hooks.json — trust them once via /hooks, or metrics.jsonl stays empty | skipped
Preferences: <prefix>kss-config — models, efforts and Jev live in the gitignored .kss/config.local.json (optional)
Next: <prefix>kss-clarify <what you want to build>
```

`<prefix>` is `/` on Claude Code and `$` on Codex — the same rule every other skill follows through
`next.mjs`.

## Rules

- **Resolve the harness before the first question**, and install **both** adapters regardless. A
  project set up from one harness must be usable from the other without re-running this skill.
- One question per turn. Never ask two, never assume an answer that was not given.
- Nothing on disk before the confirmation turn; nothing in `~/.claude/settings.json` before its own
  yes.
- Never overwrite a file the user did not agree to overwrite — that includes agents and templates.
- Never invent a `layout_references` path. Empty is a valid answer with a stated consequence.
- `~/.kss/preferences.md` is user-local: never write it inside the repository, never commit it, and
  never overwrite an existing value without the user confirming the change.
- Never invent the plugin path either — search for it, and ask when the search is not conclusive.
- Never write a user-level file — the statusline, `hooks.json` — without its own yes, and always
  merge into it rather than replacing it.
- Never back up a `statusLine` that is already KSS, and never write `statusline.backup.json` inside
  the repository. A backup that points at the KSS statusline makes the fallback spawn itself
  (DESIGN.md §18.1).
- The plugin-root environment variable is for hooks only; the scripts and references go into
  `.kss/` so the skills can reach them without it.
- Terminal output follows `conversation_language` from `~/.kss/preferences.md` (absent: the user's
  language) — including the questions above, once the answer to step 0 is known.
- Do not run any other `kss-` skill from here. End with the Next line and stop.
