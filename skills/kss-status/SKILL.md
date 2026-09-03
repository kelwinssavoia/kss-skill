---
name: kss-status
description: Print where a KSS feature stands — the phase board, or the execution board while tickets are running. With no argument, list every feature and its phase. Writes nothing.
argument-hint: "[NNN-slug]"
disable-model-invocation: true
---

Report the state of the KSS work in this repository. **This skill writes nothing** — no file, no
state, no git command that mutates. If something looks wrong, say so; do not repair it.

## Inputs

- Optional argument: a feature id `NNN-slug` (accept a bare `NNN` and resolve it).
- `.kss/config.md` — for `features_root`.
- `.kss/current` — the live state, when a run is active.
- `<features_root>/<NNN-slug>/README.md` — the index.
- `<features_root>/<NNN-slug>/05-tickets/graph.md` and `06-execution.md`, only when the phase is
  `execute` and `.kss/current` has no ticket states.

Read nothing else. Never read `03-spec.md`, `04-plan.md` or any ticket file.

## Preconditions

1. `.kss/config.md` must exist. If not: "KSS is not set up here — run /kss-init." and stop.
2. With an argument, the feature folder must exist. If not, list the ids that do and stop.
3. A missing or empty `.kss/current` is not an error: fall back to the README's state line.

## Procedure

1. Read `.kss/config.md` and resolve `features_root`.
2. **No argument** — list every `NNN-slug` folder under `features_root`, newest number first:

   ```
   kss features · <features_root>
   NNN-slug          <phase>        <last touched>   <one line: the README Next line>
   ```

   Mark the one named in `.kss/current` with a leading `▸`. Then stop.
3. **With an argument** — read `.kss/current` and the feature README.
4. If the phase is `execute`, print the **execution board** (below). Otherwise print the **phase
   board**.
5. If `.kss/current` names a different feature than the one asked about, print the board from the
   README alone and add a line: `Note: the active run is <other feature>.`
6. If a ticket is `running` but its `worktree` path (normally `.kss/worktrees/NNN-slug/NN`) does
   not exist, add a line
   `Stale: ticket NN is marked running with no worktree — /kss-execute will reset it to ready.`
   Do not change anything.

## Outputs

Nothing. This skill only prints.

## Summary

**Phase board** — the order is fixed; mark each phase `done`, `→ current`, `skipped (track S)` or
blank, using the README blocks that exist:

```
kss · NNN-slug · <size> · <track>
clarify ✓ · investigate ✓ · decisions ✓ · grill ✓ · spec ✓ · plan → · tickets · execute · review · docs
Branch: <branch> → <base>
State: <the README State line>
<phase>: <the first line of that phase's README block>
Cost: <total agents> agents · <turns> turns · <cumulative> tokens
Next: <the README Next line>
```

**Execution board** — exactly the shape in DESIGN.md §14.4:

```
kss · NNN-slug · execute
███████░░░  n/N integrated · x% of estimated turns
# | Ticket | State | Agent | Turns used/est | Since
Critical path: …
Elapsed: …    Tokens: …
Last: <event>
```

States are exactly `blocked`, `ready`, `running`, `reviewing`, `rejected`, `integrated`. Take them
from `.kss/current.tickets` — a **map keyed by `NN`**, each value
`{state, agent_type, started_at, turns, est_turns, worktree}` (DESIGN.md §3.3). Take
`n/N integrated`, `Critical path` and `Last` from `.kss/current.execution`
(`integrated`, `total`, `critical_path`, `last`), falling back to `graph.md` for the critical path
and the final line of `06-execution.md` for the last event when that key is absent. `Tokens` is the
cumulative sum from `metrics.jsonl`. Read `.kss/current` with
`node .kss/scripts/current.mjs get` when the scripts are installed.

**Review phase** adds, after the State line:

```
Review: round <n> · <open> open of <total> findings · <watching PR #nn, last check Nm ago | not watching>
```

taken from `.kss/current.review` (`round`, `open`, `watching`, `last_check`).

## Rules

- Read-only, always. No writes, no `git checkout`, no `gh` calls that change anything (`gh pr view`
  is fine; do it only when the README names a PR).
- Print numbers you actually read. A field with no source prints `—`, never a guess.
- Do not summarise the feature's content — this is a status board, not a report.
- Do not suggest the next command beyond echoing the README's own `Next` line.
- Never run another `kss-` skill from here.
