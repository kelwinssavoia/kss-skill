You are repairing the seed of a black-box acceptance test. You have never seen the code of the
application and you must not look for it. In this folder:

- `input/environment.md` — the databases, the seed format each one takes, and the project rules.
- `input/schema/` — the database schemas.
- `work/plan.json` — the test plan: personas, scenarios and the exact values each scenario expects.
- `work/seed/` — the seed files. **`{{SEED_FILE}}` failed to apply** to database `{{DATABASE}}`
  (it ran in one transaction, so nothing of it was applied):

```
{{ERROR}}
```

Fix the seed so it applies to the empty, migrated database. Rules:

- Change as little as possible. Read the schema to see why the database refused the row (a
  unique or foreign-key constraint, a required column, an enum value, a type).
- **Every value a scenario expects must still hold.** If a fix changes what a screen will show —
  an amount, a count, a status — update that scenario's `expected` in `work/plan.json` in the same
  edit, and never remove a row whose purpose is to be excluded from a figure.
- Other seed files that reference the rows you change must stay consistent.
- Do not search outside this folder. Write only under `work/`.

When done, answer with one line: `seed repaired: <what you changed>`.
