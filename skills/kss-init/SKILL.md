---
name: kss-init
description: Set up KSS in this project — interview for .kss/config.md, copy the templates, the scripts and the agent matrix into the project, and install the statusline. Run once per project, before any other kss- skill.
argument-hint: "[no arguments]"
disable-model-invocation: true
---

Set this project up for the KSS workflow. Interactive: **one question per turn**, every question
showing its default. Write nothing until the interview is finished and the user has confirmed the
plan.

## Inputs

- No arguments.
- The repository root (`git rev-parse --show-toplevel`) — everything is written relative to it.
- `templates/config.md` and `templates/` in this plugin, next to this skill's folder.
- Existing signals to propose defaults from: `CONTEXT.md`, `CLAUDE.md`, `docs/adr/`, `docs/`,
  `specs/`, the current branch, `git symbolic-ref refs/remotes/origin/HEAD`.

## Preconditions

1. Run inside a git repository. If not, stop: "kss-init needs a git repository."
2. If `.kss/config.md` already exists, print its current values and ask in one turn: `overwrite`,
   `edit <key>=<value> …`, or `cancel`. Never silently overwrite.
3. Resolve the **plugin root** — the directory containing `agents/`, `hooks/`, `scripts/` and
   `templates/`, i.e. the parent of the parent of this SKILL.md. Confirm the candidate really is it
   with `ls <candidate>/scripts/statusline.mjs`. If it is not obvious, search:

   ```bash
   ls -d ~/.claude/plugins/cache/*/kss/*/scripts/statusline.mjs 2>/dev/null
   find ~/.claude/plugins -type f -path '*/kss/*/scripts/statusline.mjs' 2>/dev/null | head
   ```

   Store the directory two levels above that file as `<PLUGIN>`. **If the search finds nothing, or
   finds more than one, ask the user for the path** — one question, showing what you found. Never
   guess it. Without `<PLUGIN>` you cannot copy the scripts or install the statusline; say so and
   stop rather than writing a half-configured project.

   Note that `${CLAUDE_PLUGIN_ROOT}` is **not** available here: it is expanded only for hook
   commands. That is exactly why the scripts are copied into the project (step 3 of the write
   list) and why every skill calls them as `node .kss/scripts/<script>.mjs`.

## Procedure

Ask these in order, one per turn. Accept a bare Enter as the default. Do not batch them.

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
7. `standards` — files whose rules bind explorers and executors. Default: `CLAUDE.md` if present.
8. `explorer_model` — default model for read-only explorers. Default: `sonnet`.
9. `auto_decide` — `true` lets `kss-investigate` settle low-risk decisions on its own; `false`
   sends every decision to the grill. Default: `true`.
10. `execution` — `multi-agent` or `single-session`. Explain the difference in two lines before
    asking: **multi-agent** slices by layer, runs one subagent per ticket in its own git worktree,
    reviews and integrates each; **single-session** runs vertical slices in this session with a
    `/clear` between them, no worktrees, no per-ticket model. Default: `multi-agent`.
11. `full_suite` — `ci` or `local`: where the whole test suite runs at the end of execute.
    Default: `ci`.
12. `tracker` — `none`, or a tracker to mirror tickets into. Default: `none`.
13. `review_autopilot` — `fixes` | `all` | `none`. Default: `fixes`.
14. `docs_root` / `docs_index` — where `kss-docs-*` writes. Defaults: `docs` and `docs/README.md`.

Then, still one turn each:

15. Print the full config as it will be written, plus the file list below, and ask for
    confirmation. Nothing is written before this answer.
16. Ask whether to install the KSS statusline into the **user-level** `~/.claude/settings.json`.
    Show exactly what will change:
    - the existing `statusLine` value (if any) is copied to `<repo>/.kss/statusline.backup.json`;
    - `statusLine` becomes
      `{"type": "command", "command": "node <PLUGIN>/scripts/statusline.mjs"}`.
    This is the **one** absolute plugin path KSS writes anywhere, and it is resolved now, at init
    time, from `<PLUGIN>` (precondition 3). It has to be absolute because `~/.claude/settings.json`
    is user-level and shared by every project; the script reads `<cwd>/.kss/current`, so a single
    installed copy serves them all. Print the exact path in the question, and note that it must be
    re-run after the plugin is reinstalled at a new path.
    Say that the KSS statusline prints the previous statusline's output whenever no KSS run is
    active, so nothing is lost. **Never edit `~/.claude/settings.json` without this yes.**

On confirmation, write — in this order:

1. `.kss/config.md`, rendered from `<PLUGIN>/templates/config.md` with the answers substituted.
2. `.kss/templates/` — copy every file and folder under `<PLUGIN>/templates/` into it. The skills
   read templates from here, so the project can customise them. If `.kss/templates/` already
   exists, ask before overwriting; never merge silently.
3. `.kss/scripts/` — copy every `<PLUGIN>/scripts/*.mjs` plus `<PLUGIN>/hooks/kss-lib.mjs` (the
   scripts import it) into it, overwriting freely: these are plugin copies, not user content. The
   skills invoke them as `node .kss/scripts/current.mjs …` and
   `node .kss/scripts/render-cost.mjs …`. Verify with
   `node .kss/scripts/current.mjs get` — it must print `null` and exit 0.
4. `.claude/agents/` — copy the eight files from `<PLUGIN>/agents/`
   (`kss-sonnet-low`, `kss-sonnet-medium`, `kss-sonnet-high`, `kss-opus-medium`, `kss-opus-high`,
   `kss-reviewer`, `kss-explorer`, `kss-runner`). Copy only the ones that are absent; for each one
   that already exists, ask before overwriting and accept "keep mine".
5. `.gitignore` — append `.kss/current` and `.kss/worktrees/` if they are not already ignored.
   Both are live state, not history (`.kss/worktrees/NNN-slug/NN` is where `kss-execute` puts each
   ticket's git worktree). Leave `.kss/config.md`, `.kss/templates/`, `.kss/scripts/` and the
   feature folders tracked.
6. `~/.claude/settings.json` — only if step 16 was a yes. Back up `statusLine` first, preserving
   whatever shape it had, into `<repo>/.kss/statusline.backup.json`. Keep the rest of the file
   byte-identical apart from that key.

Do **not** write hooks into any settings file. The plugin's `hooks/hooks.json` is merged
automatically while the plugin is enabled; say so in the summary.

## Outputs

| Path | Contents |
| --- | --- |
| `.kss/config.md` | the answers |
| `.kss/templates/` | the project's copy of the KSS templates |
| `.kss/scripts/` | `current.mjs`, `render-cost.mjs`, `statusline.mjs`, `kss-lib.mjs` — what the skills call |
| `.claude/agents/kss-*.md` | the eight-agent matrix |
| `.kss/statusline.backup.json` | the previous statusline, when one was replaced |
| `.gitignore` | `.kss/current` and `.kss/worktrees/` added |

`.kss/current` is not created here — `kss-clarify` writes it when a feature starts.

## Summary

Print exactly:

```
KSS ready · <repo name>
Config: .kss/config.md (features_root <features_root>, execution <execution>, base <base_branch>)
Templates: .kss/templates/ (<n> files)
Scripts: .kss/scripts/ (<n> files) — skills call node .kss/scripts/current.mjs
Agents: .claude/agents/ (<n> written, <n> kept)
Statusline: installed | skipped (previous backed up to .kss/statusline.backup.json)
Hooks: come with the plugin — SubagentStop, SessionEnd, Stop. Nothing to install.
Next: /kss-clarify <what you want to build>
```

## Rules

- One question per turn. Never ask two, never assume an answer that was not given.
- Nothing on disk before the confirmation turn; nothing in `~/.claude/settings.json` before its own
  yes.
- Never overwrite a file the user did not agree to overwrite — that includes agents and templates.
- Never invent a `layout_references` path. Empty is a valid answer with a stated consequence.
- Never invent the plugin path either — search for it, and ask when the search is not conclusive.
- `${CLAUDE_PLUGIN_ROOT}` is for hooks only; the scripts go into `.kss/scripts/` so the skills can
  reach them without it.
- Do not run any other `kss-` skill from here. End with the Next line and stop.
