# kss-desktop

A desktop app for KSS (Electron). It opens a repository the way an editor opens a folder, then
lets you run the whole KSS flow from one window: several features in parallel, each in its own git
worktree, every phase in Claude Code or Codex, chats and shells next to them, and an inspector for
every subagent of an execute. The specification is [DESIGN.md §24](../../DESIGN.md).

It is a **reader and a launcher**: every phase runs in the harness's own interactive CLI, inside
a real terminal, with the harness's own plugin and hooks, so whatever a phase writes is exactly what
it writes from a terminal. A feature started here can be continued from a terminal and vice versa.

## Run it

```
cd apps/desktop
npm install
npm run dev        # electron-vite with hot reload
npm run build && npm start
npm test           # node --test, the main-process logic
npm run typecheck
npm run install-app  # build KSS.app (dist/) and install it in /Applications, ad-hoc signed
npm run icon       # re-render build/icon.png and icon.icns after editing build/icon.svg
```

`claude` and/or `codex` must be on the `PATH` of your login shell. The app resolves that
environment once at start-up, because an app launched from the Dock does not inherit it.

## What it does

| | |
| --- | --- |
| **Open a project** | Detects `.kss/config.md` (offers `kss-init` when absent), the features under `features_root`, the installed CLIs, `.kss/qa.config.json` and every worktree |
| **Sessions** | **New session** creates a worktree in `<parent>/<repo>.kss-sessions/<slug>`, detached at `base_branch`, copies `.kss/config.local.json` and the root `.env*`, and starts `kss-clarify <request>` there. Clarify creates the feature branch. Sessions run in parallel; each has its own `.kss/current` |
| **Phases** | **Run / Resume** the README's `Next:` in Claude or Codex — a fresh process, what `/clear` + the command is in a terminal. The harness chosen per phase is remembered per project |
| **Chats and shells** | **Claude chat**, **Codex chat** and **Terminal** open in the session's worktree |
| **Bypass permissions** | A switch in the sidebar, on by default: new chats and phases start with `--dangerously-skip-permissions` (Claude) or `--dangerously-bypass-approvals-and-sandbox` (Codex); their tab shows ⚡ |
| **Board** | The kss-ui model (`mods/kss-ui/hooks/kss.ts`, imported): phases of the track, grill queue, tickets with turns vs estimate, the execution log, tokens |
| **Subagent inspector** | Click a ticket: its **objective** (the ticket file: goal, FRs, files, tests, and its log entries), its **changes** (commits since the feature branch, committed and uncommitted diff, new files) and its **activity** (the subagent's brief, every tool call, what it says it is doing, turns and tokens — from the Claude Code or Codex transcript found by the worktree path) |

| **QA** | The **QA** view of a session runs `kss-qa` one step at a time — Plan, Up, ▶ per scenario, Judge, Report, Down — each as `qa.mjs` in a terminal shown under the list. A scenario being driven is streamed live from the driver's Chrome (CDP screencast); every recorded step shows its screenshot, expected and observed values; the driver's verdict, Jev's and the issues follow. One QA environment at a time across all sessions: **Up** is refused while another session holds it |

The live view needs the project's `.kss/scripts/qa.mjs` to write `.kss/qa/.runtime/live.json`;
an older copy shows a notice — run `kss-init` again to update the scripts.

## Layout

```
src/main/       Electron main: project + sessions (git worktrees), board, inspector, transcripts, ptys
src/preload/    the IPC bridge (window.kss)
src/renderer/   React UI, xterm.js terminals
src/shared/     types and the pure command builders shared by both sides
build/          the logo: icon.svg is the source; icon.png and icon.icns are rendered from it
```
