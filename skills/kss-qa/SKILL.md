---
name: kss-qa
description: Blind acceptance test of a feature through its web UI — a planner that never saw the code writes scenarios and a feature-specific seed from the request and the functional spec, a script brings up a disposable local environment, a cheap model drives a real browser (browser-use) scenario by scenario leaving a screenshot per step, Jev judges each scenario, and a report with a verdict lands in the feature folder. Run it after kss-execute, before or alongside kss-review.
argument-hint: NNN-<slug> [--replan] [--only S-01,S-02] [--keep-up]
disable-model-invocation: true
---

# kss-qa

Find out whether the delivered feature does what was **asked**, the way a tester who never saw
the code would. Everything that decides the outcome runs outside this session:
`node .kss/scripts/qa.mjs` spawns the blind planner, brings the environment up, spawns one blind
driver per scenario, asks Jev, and writes the report. You orchestrate, show the plan, relay the
verdict and route what failed. You never test by hand and never "help" a scenario pass.

## Inputs

- `.kss/config.md` — `features_root`, `docs_language`.
- `~/.kss/preferences.md` — `conversation_language` for everything printed in this session.
- `.kss/qa.config.json` — the project adapter (compose files, databases and their ready/migrate/
  seed commands, the auth provider, env overrides, service catalog, apps, project rules, models).
  **Required.**
- `<features_root>/NNN-slug/00-brief.md` and `03-spec.md` — the script reads them; you do not
  paste them anywhere.

**Do not read:** source files, diffs, `04-plan.md` or the tickets. What the blind agents get is
decided by the script (the request, the spec sections listed in `spec.sections`, the schemas, the
environment catalog) — never widen it, never add hints to the plan from what you know of the code.

## Preconditions

1. `.kss/config.md` must exist — else stop with `No .kss/config.md found. Run kss-init first.`
2. `.kss/qa.config.json` must exist — else stop with
   `No .kss/qa.config.json. Describe this project's local environment first (DESIGN.md §22.3).`
3. `03-spec.md` must exist — else stop with `No spec for NNN-slug. kss-qa tests against 03-spec.md.`
4. `claude`, `browser-use` (`uv tool install browser-use`), `docker`, Chrome/Chromium, and whatever
   the adapter's database commands call (`psql` for the defaults) on the PATH. Name what is
   missing and stop.
5. The working tree is on the feature branch (or its integrated worktree) — the run records
   `HEAD`; warn in one line if the tree is dirty.
6. The dev stack's app ports are free (the script checks and names them).

## Steps

1. **Plan.** If `<feature>/qa/plan.json` is missing, or `--replan` was given:
   `node .kss/scripts/qa.mjs plan --feature NNN-slug [--force]`. Then print `qa/plan.md`'s
   scenario table (id, title, covers, persona) and its **Assumptions to confirm**, and ask one
   question: run as planned, or edit first? A plan with assumptions the user rejects is edited in
   `plan.json` / `seed/` (by the user, or by you on their exact instruction) — never re-derived from
   the code.
2. **Run.** `node .kss/scripts/qa.mjs all --feature NNN-slug [--only …] [--keep-up]` in the
   background; it plans only when needed, brings the environment up, drives every scenario, judges,
   reports and tears everything down (unless `--keep-up`). Exit 0 approved, 4 rejected,
   5 inconclusive, 1 setup error. On a setup error, read the named service log under
   `.kss/qa/.runtime/logs/`, fix the **adapter** (`.kss/qa.config.json`, compose override) if the
   environment is wrong, and retry; if the application itself cannot start, that is a finding —
   report it, do not patch the app here.
3. **Report.** Read `<feature>/qa/report.md` and print the verdict line, the scenario table and
   the Problems and Adjustments sections, condensed.
4. **Route.** A `fail` is a defect against an FR: list it as `QA-NN · FR-xx · <one line>` and offer
   to open fix tickets through `kss-execute` (numbered after the last ticket, with all the gates).
   An `inconclusive` or `blocked` scenario is shown with its note (Jev disagreed, low confidence,
   environment); offer `--only <id>` to re-run it. An adjustment is listed, not ticketed, unless
   the user asks.
5. **Commit** `docs(NNN): qa <verdict lowercase>` with `<feature>/qa/` (plan, seed, report,
   result, the run's evidence; service logs are gitignored).

## Output

```
QA NNN-slug — <APPROVED|REJECTED|INCONCLUSIVE> · run <id> · <n> scenarios · $<cost>
<scenario table>
Problems: <n> · Adjustments: <n> · Not UI-testable: <FR list>
Report: <features_root>/NNN-slug/qa/report.md
Next: <verbatim output of node .kss/scripts/next.mjs <features_root>/NNN-slug --after qa>
```

## Rules

- **Blind means blind.** No code, diff, plan or ticket reaches the planner or the driver; the
  script's inputs are the whole contract. Never edit `plan.json` to match what the code does.
- **The verdict is mechanical.** Any `fail` rejects; all `pass` approves; anything else is
  inconclusive. A scenario is final only when the driver and Jev agree above the threshold
  (`jev.qa_judge.confidence`); with Jev off the driver's verdict stands and the report says so.
- The environment is disposable and local: its own compose project and volumes, its own ports,
  external providers unreachable. Never point it at staging or production.
- Evidence is never curated: every step's screenshot and text stays as the driver recorded it.
- This skill never merges, never pushes, and never fixes the application itself.
- Terminal output follows `conversation_language`; the report follows `docs_language`. File
  names, headings, field names and identifiers stay English.
