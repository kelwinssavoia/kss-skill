# The living feature (DESIGN.md §25.1)

`report/<phase>.json` is a snapshot of one phase. `report/feature.json` is **the feature as it
is now**, product and technical: what is planned and being built, the decisions currently in force
(and which ones changed), the rules with the real code that implements them, the architecture,
interactive state machines, and simulators where the user types their own values to test edge
cases. Every phase updates it. The report page opens on it, in the **Feature** tab (`#feature`).

You never write `feature.json` yourself. You send a **patch** to `feature.mjs`, the only writer.
It merges the patch, keeps the history, validates everything, checks quoted code against the
repository and rebuilds `report/index.html`.

## The command

```sh
node .kss/scripts/feature.mjs <features_root>/NNN-slug --phase <phase> < patch.json
node .kss/scripts/feature.mjs <features_root>/NNN-slug --phase <phase> --patch patch.json
```

It prints `feature: …/report/feature.json (<n> requirements, <n> rules, <n> decisions)`. If it
prints `feature: <problem>` and exits 1, nothing was written: fix the patch and run it again.
Never skip it. Run it **after** the phase report (`report.mjs --phase`), before the commit. The
file goes into the commit with `report/`.

`report.mjs <dir>` (no `--phase`) rebuilds the page from what is on disk, feature included.
Execute runs it after each ticket integration so the progress stays live.

## Patch semantics

```json
{
  "change": "one line: what this phase changed in the feature",
  "requirements": [{ "id": "FR-03", "status": "building" }, { "id": "FR-07", "removed": true }],
  "decisions": [{ "id": "D-02", "decision": "Corte às 16h", "why": "O banco estendeu a janela." }]
}
```

- **`change` is required.** It goes into the "What changed" timeline with the time and the phase.
  A patch without it is refused.
- **Objects merge** key by key (`product`, `architecture`). `null` deletes a key.
- **Arrays whose items all have an `id` are upserted by id**, with fields merged: send only what
  changed (`{ "id": "FR-03", "status": "done" }` keeps the text). This applies inside sections
  too: a simulator's `inputs` and `rules`, a machine's `states`.
- **`{ "id": "X", "removed": true }`**: a requirement becomes `status: "dropped"` (it stays,
  struck through); anything else is removed. Both are recorded in "What changed". To replace an
  item whole, remove it and add it again in the same patch.
- **Other arrays are replaced**: `actors`, `inScope`, `outOfScope`, `transitions`, `edges`…
- **`code` blocks are replaced whole** when re-sent (a rule's `code`, an item of `code`).
- **Decision history is automatic.** When a decision's `decision` text changes, its previous
  text, phase, time and reason go to `history`, and the decision gets the `changed` badge. Never
  write `history`, `changes`, `updatedAt`, `updatedBy`, `progress` — they are ignored.

## The model

```json
{
  "feature": "012-batch-cutoff", "lang": "pt-BR", "updatedAt": "…", "updatedBy": "plan",
  "product": { "title": "…", "problem": "…", "outcome": "…", "actors": ["…"], "inScope": ["…"], "outOfScope": ["…"] },
  "stories": [{ "id": "US-1", "text": "…" }],
  "requirements": [{ "id": "FR-01", "text": "…", "stories": ["US-1"], "decisions": ["D-02"], "status": "planned" }],
  "rules": [{ "id": "R-01", "title": "…", "text": "…", "fr": ["FR-02"], "decisions": ["D-02"],
              "code": { "file": "src/cutoff.ts", "line": 12, "code": "…", "lang": "ts", "highlight": [14] } }],
  "decisions": [{ "id": "D-02", "title": "…", "decision": "…", "why": "…", "kind": "business", "status": "decided", "phase": "grill" }],
  "architecture": { "flow": { "nodes": […], "edges": […] }, "sequence": { "participants": […], "messages": […] } },
  "states": [ <states section> ],
  "simulators": [ <simulator section> ],
  "code": [ { "id": "review-gate", "file": "…", "line": 3, "code": "…", "explain": "…" } ],
  "changes": [{ "at": "…", "phase": "spec", "text": "…" }]
}
```

Limits: `product.title` ≤ 120, `problem`/`outcome` ≤ 600, a requirement, story or rule text ≤ 400,
a decision ≤ 400, at most 60 items per list, 8 simulators, 8 machines, 12 code blocks. `kind` and
`status` of decisions use the same lists as the phase report (`report.md`). Requirement `status`:
`planned`, `building`, `done`, `dropped`. Every id named in `stories`, `decisions`, `fr` or a
simulator rule's `rule` must exist in the model.

**Progress is derived, not written.** Once tickets exist, `report.mjs` reads `05-tickets/*.md`
("Requirements covered"), `graph.md`, `06-execution.md` and `.kss/current`: a requirement is
**done** when every ticket covering it is integrated, **building** when any has started. The page
draws the ticket graph colored by state. A `status` you write only counts for a requirement no
ticket covers (and `dropped` always wins).

**Quoted, never written.** A rule's `code` and each `code` block are checked like a `code`
section with `report.mjs --phase`: every line must be in the file, in order (`// …` elides). Only
the blocks your patch sends are checked; older ones stay as they were quoted.

## Two section types (also usable in phase reports)

### `states` — an interactive state machine

```json
{ "type": "states", "id": "batch", "title": "Ciclo do lote", "initial": "draft",
  "states": [{ "id": "draft", "label": "Rascunho" }, { "id": "queued", "label": "Na fila", "detail": "Aguarda o corte." },
             { "id": "review", "label": "Em revisão" }, { "id": "sent", "label": "Enviado" }],
  "transitions": [
    { "from": "draft", "to": "queued", "event": "enviar", "guard": "valor ≤ 50 mil", "fr": ["FR-01"] },
    { "from": "draft", "to": "review", "event": "enviar", "guard": "valor > 50 mil", "fr": ["FR-04"] },
    { "from": "review", "to": "queued", "event": "aprovar" },
    { "from": "queued", "to": "sent", "event": "corte" } ] }
```

The reader walks it: the current state is lit, each event leaving it is a button (with its
guard), the path walked so far is shown, and Reset starts over. ≤ 12 states; `event` ≤ 40,
`guard` ≤ 120 characters. Inside `feature.json` the `type` may be left out.

### `simulator` — the rule as a form

```json
{ "type": "simulator", "id": "cutoff", "title": "Corte e tarifa", "intro": "Mude a hora e o valor.", "hit": "first",
  "inputs": [
    { "id": "at", "label": "Hora do envio", "type": "time", "default": "10:00" },
    { "id": "amount", "label": "Valor", "type": "number", "default": 1000, "min": 0, "unit": "R$" } ],
  "derive": [{ "id": "late", "label": "Depois do corte", "expr": "hour(at) >= 15" }],
  "rules": [
    { "id": "review", "label": "Valor alto", "when": "amount > 50000", "then": { "day": "'review'", "fee": "0" }, "rule": "R-02", "fr": ["FR-04"] },
    { "id": "late", "when": "late", "then": { "day": "'next'", "fee": "round(amount * 0.02, 2)" }, "rule": "R-01", "fr": ["FR-02"] },
    { "id": "early", "when": "true", "then": { "day": "'same'", "fee": "round(amount * 0.01, 2)" }, "rule": "R-01", "fr": ["FR-01"] } ],
  "outputs": [{ "id": "day", "label": "Sai em", "format": "text" }, { "id": "fee", "label": "Tarifa", "format": "money", "unit": "R$" }],
  "scenarios": [
    { "name": "14:59 sai hoje", "inputs": { "at": "14:59" }, "expect": { "day": "same", "fee": 10 } },
    { "name": "15:00 vai para amanhã", "inputs": { "at": "15:00" }, "expect": { "day": "next", "fee": 20 } } ] }
```

- `inputs[].type`: `number`, `text`, `boolean`, `enum` (with `options`), `date` (`'YYYY-MM-DD'`),
  `time` (`'HH:MM'`). `default` must fit the type. Ids are plain names (`a-z`, digits, `_`), not
  a function name nor `true`/`false`/`null`.
- `derive` values are computed in order; each may use the inputs and earlier derived values.
- `rules` are evaluated in order. `hit: "first"` applies the first rule whose `when` holds (put a
  `"when": "true"` fallback last); `"all"` applies every one that holds, later ones overwriting.
  `then` maps output ids to expressions. **A text result is a quoted string inside the
  expression**: `"'next'"`, not `"next"` (that would be a name).
- `outputs[].format`: `money` (2 decimals, `unit` as the currency sign), `percent` (a fraction:
  `0.15` shows 15%), `number`, `text`, `boolean`.
- `scenarios` with `expect` are **run by the script**: if the rules do not produce the expected
  output it refuses, naming the scenario, the output, both values and the rule that fired. Fix the
  rule (or, if the spec example was wrong, say so to the user) — never delete the scenario.

The page shows the inputs as a form and recomputes as the user types: the outputs, which rule
fired, every rule's condition as true/false (so the user sees *why*), the derived values, the
scenarios as one-click presets with ✓/✗ against `expect`, and "Your scenarios", where the user
saves their own inputs with a name and optional expected values (kept in the browser). Any
scenario can be copied as text or sent to the agent: the page posts
`{ type: "kss:scenario", feature, simulator, title, scenario, inputs, outputs, fired, expected, note }`
to its parent window, and kss-desktop opens a chat with it.

**Expressions** (no JavaScript — a small safe language, `scripts/expr.mjs`): numbers, `'text'` or
`"text"`, `true`/`false`/`null`, input and derived ids; `!` and unary `-`; `* / %`; `+ -` (`+`
joins text); `< <= > >=` (two numbers or two texts); `==` `!=` (strict); `&&` `||`
(short-circuit); `c ? a : b`; parentheses. Functions: `min`, `max`, `abs`, `round(x, digits?)`,
`floor`, `ceil`, `len`, `lower`, `upper`, `contains(text|list, x)`, `startsWith`,
`in(x, a, b, …)`, `hour('HH:MM')`, `minutes('HH:MM')` (since midnight), `day('YYYY-MM-DD')`
(weekday, 0 = Sunday), `daysBetween(a, b)`, `if(c, a, b)`. No property access, indexing or
assignment; an unknown name is refused when the script compiles it.

## Rules for the model

- **The simulator models the implemented rule exactly.** Every simulator rule names its `rule`
  (`R-NN`); after execute, that rule's `code` shows where it lives. If the code does something the
  simulator does not, the simulator is wrong — correct it to match the code, and say so.
- **Scenarios come from the spec's examples and edge cases** (boundaries: 14:59 / 15:00, zero,
  the maximum, empty). Each gets an `expect`.
- **Never invent behaviour.** A rule, decision or transition that no artifact states is not
  added. A requirement no one has decided is not a rule yet.
- Keep the model short and current: replace text that changed, drop what was dropped. The history
  of decisions and the change log keep the past; the rest shows the present.
- Write in `conversation_language`, like the phase report. Ids, code and paths stay as they are.

## What each phase writes into it

| Phase | Patch |
| --- | --- |
| clarify | `product` (title, problem, outcome, actors, in/out of scope) |
| investigate | `architecture.flow` of the code areas found (`changed` on those the feature touches); every `AD-` as a decision (`kind: "auto"` or `"technical"`) |
| review-decisions | the `AD-` decisions whose verdict changed them |
| grill | every `D-` and `DF-` decision; overrides change a decision's text (history follows) |
| spec | `stories`, `requirements` (with their stories and decisions), `rules`, `states`, `simulators` with scenarios taken from the spec's examples and edge cases |
| plan | `architecture.flow` and `architecture.sequence` of the design; the design decisions; refinements to `rules` |
| tickets | nothing required — progress comes from the tickets; a `change` line only if the cut dropped or split a requirement |
| execute (its report subagent) | every rule's `code`, quoted from the real diff; `code` blocks for the rest that matters; simulator rules corrected to match what the code actually does; requirement `status` for anything no ticket covers |
| qa / review | the rules, decisions or simulator rules their fixes changed |
| docs-tech / docs-product | nothing unless the docs changed the feature's description |
