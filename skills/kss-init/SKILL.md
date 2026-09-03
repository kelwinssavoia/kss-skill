---
name: kss-init
description: Set up KSS in this project — interview for .kss/config.md, copy the templates, the scripts and the agent matrix into the project, and install the statusline. Run once per project, before any other kss- skill.
argument-hint: "[--preferences]"
disable-model-invocation: true
---

Set this project up for the KSS workflow. Interactive: **one question per turn**, every question
showing its default. Write nothing until the interview is finished and the user has confirmed the
plan.

With `--preferences`, do **only** step 0 below — ask the conversation language, write
`~/.kss/preferences.md`, print the value, and stop. No git repository is required, nothing in the
project is read or written.

## Inputs

- No arguments.
- The repository root (`git rev-parse --show-toplevel`) — everything is written relative to it.
- `templates/config.md` and `templates/` in this plugin, next to this skill's folder.
- `~/.kss/preferences.md`, if it exists — the user-local `conversation_language`. It is **never**
  part of any repository.
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
15. **Language of generated documents in this project? (blank = follow the conversation)** — this
    is `docs_language`. It governs the *content* of every artifact KSS writes into the repository
    (feature `README.md`, `00-brief.md` … `06-execution.md`, `notes/`, ADRs, glossary entries,
    `kss-docs-tech`, `kss-docs-product`, ticket files, the PR body). File names, headings, field
    names and identifiers stay English either way. Default: empty. Propose the language the
    existing docs under `features_root`/`docs_root` are written in, when there is an obvious one.

Then, still one turn each:

16. Print the full config as it will be written, plus the file list below, and ask for
    confirmation. Nothing is written before this answer.
17. Ask whether to install the KSS statusline into the **user-level** `~/.claude/settings.json`.
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
6. `~/.claude/settings.json` — only if step 17 was a yes. Back up `statusLine` first, preserving
   whatever shape it had, into `<repo>/.kss/statusline.backup.json`. Keep the rest of the file
   byte-identical apart from that key.

Do **not** write hooks into any settings file. The plugin's `hooks/hooks.json` is merged
automatically while the plugin is enabled; say so in the summary.

## Outputs

| Path | Contents |
| --- | --- |
| `~/.kss/preferences.md` | `conversation_language` — user-local, outside the repo, never committed |
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
Languages: conversation <conversation_language | follows you> · docs <docs_language | follows the conversation>
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
- `~/.kss/preferences.md` is user-local: never write it inside the repository, never commit it, and
  never overwrite an existing value without the user confirming the change.
- Never invent the plugin path either — search for it, and ask when the search is not conclusive.
- `${CLAUDE_PLUGIN_ROOT}` is for hooks only; the scripts go into `.kss/scripts/` so the skills can
  reach them without it.
- Terminal output follows `conversation_language` from `~/.kss/preferences.md` (absent: the user's
  language) — including the questions above, once the answer to step 0 is known.
- Do not run any other `kss-` skill from here. End with the Next line and stop.
