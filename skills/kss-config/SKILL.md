---
name: kss-config
description: Write or edit .kss/config.local.json — the gitignored, per-machine preferences of KSS: which models and efforts the harness may use per tier and per review depth, whether tickets may be executed cross-harness (Claude Code ↔ Codex via their CLIs, with a percentage split), and whether Jev (TypeSafe's System One classifier) settles auto-assumptions, picks ticket tiers or takes coordinator judgements, each with its own confidence threshold and the API key. Run it after kss-init, or any time to change a preference.
argument-hint: "[--show | --check | <key>=<value> …]"
disable-model-invocation: true
---

# kss-config

Own the one KSS file that is **never committed**: `.kss/config.local.json`. It holds what varies
per machine and per person — the model catalogue each harness may spend, the effort ladder, and
everything about Jev, including its API key. `.kss/config.md` stays the project's shared, tracked
configuration; nothing in it moves here.

Interactive by default: **one question per turn**, each showing the current value (or the
default), a bare Enter keeps it. Nothing is written until the confirmation turn.

## Modes

| Invocation | What happens |
| --- | --- |
| `kss-config` | full interview below |
| `kss-config --show` | print the effective config — `node .kss/scripts/jev.mjs config` — and stop. The key is redacted; never print it whole |
| `kss-config --check` | `node .kss/scripts/jev.mjs check`: one tiny request to Jev, print `ok · <model> · <latency>` or the error, and stop |
| `kss-config <key>=<value> …` | set only those keys (dot paths: `jev.enabled=true`, `jev.auto_assumptions.by_category.layout=0.95`, `models.tiers.T2.claude-code=kss-sonnet-high`, `models.review.light.claude-code=kss-reviewer-sonnet-high`), show the diff, ask one yes, write |

## Inputs

- `.kss/config.local.json` if it exists — the current values.
- `.kss/templates/config.local.json` — the template with every key and its default (copied by
  `kss-init`; fall back to `<PLUGIN>/templates/config.local.json` when the project copy is
  missing).
- `.kss/references/tiers.md` and the harness adapters — the tier ladder and what each harness spawns
  today, so the `models.tiers` question can list real names.
- `node .kss/scripts/harness.mjs` — which harness this is, to phrase the model questions.
- `~/.kss/preferences.md` — `conversation_language` for everything printed.
- `TYPESAFE_API_KEY` in the environment, if set — offered as the default key source.

## Preconditions

1. `.kss/config.md` must exist, else stop with: `No .kss/config.md found. Run kss-init first.`
2. `.kss/scripts/jev.mjs` must exist. If it does not, the project was initialised by an older KSS:
   say `Run kss-init again to refresh .kss/scripts/ (jev.mjs is missing)` and stop.
3. `.gitignore` must ignore `.kss/config.local.json`. If it does not, **add the line before anything
   else is written** — this file carries a secret. Say so in one line.

## The interview

Ask in this order, one per turn. Group headers are printed once, as a line, before their first
question.

**Models** — what each harness may spend.

1. `models.allowed.<harness>` — the model names this harness may use, for the harness you are in
   (the other harness's list is kept as is). Default: what the adapter maps today, plus `haiku` on
   Claude Code, which only matters once a `models.tiers` row names `kss-haiku`.
2. `models.efforts` — the effort ladder. Default `["low","medium","high"]`. Note that Claude Code
   agents carry their effort in the agent definition, so on Claude Code this list only bounds what
   `models.tiers` may name; on Codex it is passed as `reasoning_effort`.
3. `models.tiers` — per-tier overrides, only if the user wants any. Show the current ladder from
   `tiers.md` (T1…T5, explorer, explorer-deep, reviewer, runner) and ask which rows to override.
   On Claude Code a row is an agent name (`kss-sonnet-high`, or `kss-haiku` for `T1`–`T3` only —
   Haiku takes no effort, so none is asked for it); on Codex it is
   `{"model": …, "reasoning_effort": …}`. Every name must be in `models.allowed` / `models.efforts`,
   else refuse the value and ask again. Default: none — the adapter's table stands.
3r. `models.review` — which reviewer each **review depth** spawns, for the harness you are in.
   Show both rows with their current values: `full` (every ticket by default, and forced whenever
   the ticket touches a contract, wire, authorization, tenant isolation, money or a migration) and
   `light` (only when Jev's `review_depth` answers `light` with confidence — question 12). On Claude
   Code a value is `{"model": "sonnet|opus", "effort": "low|medium|high"}` or a reviewer agent name
   (`kss-reviewer`, `kss-reviewer-opus-medium`, `kss-reviewer-sonnet-high`,
   `kss-reviewer-sonnet-medium`, `kss-reviewer-sonnet-low`); `opus`/`low` has no agent and is
   refused. On Codex it is `{"model": …, "reasoning_effort": …}`. Every name must be in
   `models.allowed` / `models.efforts`. Defaults: `full` opus/high (`gpt-6-astra`/high), `light`
   sonnet/medium (`gpt-5.6-terra`/medium). When the user sets `full` below the default, say in one
   line that every ticket — domain-risk ones included — will then be reviewed by that pair, and ask
   once more. Verify the result with `node .kss/scripts/review.mjs pick '{"depth":"light"}'` and
   `'{"depth":"full"}'` after writing, and print any `warning` they return.

**Execution** — cross-harness (DESIGN.md §21). Say in two lines first: when on, `kss-execute`
may run a ticket in the *other* harness's CLI (`claude -p` from Codex, `codex exec` from Claude
Code) through a light `dispatcher` subagent, keeping the split you set. Requires the other CLI on
this machine, logged in.

3a. `execution.cross_harness.enabled` — Default `false`. If `false`, skip 3b–3e.
3b. `execution.cross_harness.split` — percentage per harness, e.g. `claude-code=60 codex=40`.
    Weights are normalised, so `70/30` and `7/3` are the same. Default `50/50`. A harness with
    weight 0 is never used.
3c. `execution.cross_harness.tiers` — which tiers may leave the local harness. Default
    `T1, T2, T3`. Say why the default stops there: `T4`/`T5` carry material execution uncertainty,
    and a cross-CLI run has no reviewer conversation, only a report. Domain-risk safeguards remain
    mandatory at every tier.
3d. `execution.cross_harness.cli` — the binary names (or absolute paths), and per harness the
    knobs: Claude Code `permission_mode` (default `acceptEdits`), `allowed_tools` (default
    read/edit/write tools plus `Bash(git *)` — that is what keeps a foreign executor from running
    tests, which nobody but the coordinator may do), `max_turns` (80); Codex `sandbox`
    (`workspace-write`) and `approval_policy` (`never`). Defaults stand unless the user objects.
3e. `execution.cross_harness.timeout_ms` — Default one hour.
    Then run `command -v <bin>` for each harness in the split and report which are missing; a
    missing one is not fatal — `pick` keeps those tickets local and says so.

**Jev** — the classifier. Say in two lines what it is before the first question: a model that
answers *choice / score / yes-no* questions over a small JSON state with a probability per option
and a confidence; it does not write text. KSS uses it only where the options are already
enumerated, and every use has its own threshold.

4. `jev.enabled` — Default `false`. If `false`, skip 5–13, keep whatever values are there.
5. **API key** — where the key comes from. Options: `env` (read `TYPESAFE_API_KEY`, or another
   variable name the user gives → `jev.api_key_env`), or `file` (paste it → `jev.api_key`).
   Default: `env` when `TYPESAFE_API_KEY` is set, else `file`. **Never echo a pasted key back**;
   confirm with its first 4 and last 4 characters.
6. `jev.model` — Default `jev-latest`.
7. `jev.trace` — append every Jev decision (state, ranked options, confidence, gate) to
   `<feature>/jev-trace.jsonl`. Default `true`. This file is committed with the feature: it is how
   thresholds get tuned later.
8. `jev.auto_assumptions.enabled` — let `kss-investigate` hand each `open` technical/layout decision
   to Jev, with the options the explorers found, and mark it auto when confidence clears the
   threshold. Default `true`.
9. `jev.auto_assumptions.confidence` and `by_category` — the default threshold and the per-category
   ones. Defaults: `0.85`, technical `0.85`, layout `0.9`, business `1.01`. Say plainly that
   **business stays above 1.0 unless the user lowers it on purpose** — KSS's rule is that business
   decisions are never auto, and a threshold above 1 keeps it that way while leaving the knob
   visible. Accept one line: `0.8 technical=0.8 layout=0.95`.
10. `jev.tier_selection.enabled` and `confidence` — let `kss-tickets` ask Jev for the tier of each
    ticket and use it when confidence clears the threshold; below it, `on_low_confidence`
    (`rubric` = apply the rubric yourself, `ask` = ask the user). Defaults `true`, `0.7`, `rubric`.
11. `jev.reasoning.enabled` — **experimental**. Let the coordinator hand its own judgement calls to
    Jev: `escalation_class` (execution vs reasoning error after a reject) and `report_gate` (does an
    executor report pass). Default `false`. Say the honest limit in one line: Jev cannot do an
    executor's reasoning — it cannot write code or a plan — so what this saves is the coordinator's
    deliberation on already-enumerated forks, not the executor's work.
12. `jev.reasoning.decisions` and `confidence` — which of `escalation_class`, `report_gate`,
    `size`, `review_depth` are delegated, and the threshold. Defaults: the first two, `0.8`.
    `review_depth` lets `kss-execute` send a ticket with no domain risk to the `light` reviewer of
    `models.review`; say in one line that it trades review strength for cost and stays off by
    default until the feature's `jev-trace.jsonl` shows Jev calibrated on this project.
13. `jev.reasoning.effort_when_delegated` — optional: a tier → effort map applied by the adapter
    when a ticket's fork points were pre-decided (Codex only today; on Claude Code the agent's
    effort is fixed in its definition and a different effort is a different agent name in
    `models.tiers`). Default: empty.

Then:

14. Print the whole file as it will be written, key redacted, plus the `.gitignore` line if it is
    being added, and ask for one confirmation. Nothing on disk before this yes.
15. If `jev.enabled`, run `node .kss/scripts/jev.mjs check` and print its result. A failure here is
    reported, not fatal: the file is still written, and every phase falls back to its rubric when Jev
    does not answer.

## Outputs

| Path | Contents |
| --- | --- |
| `.kss/config.local.json` | the answers, merged over the template's defaults; pretty-printed, 2 spaces, trailing newline |
| `.gitignore` | `.kss/config.local.json`, added when missing |

Nothing else. Not `.kss/config.md`, not a feature folder, not `~/.kss/preferences.md`.

## Summary

Print exactly:

```
KSS config · <repo name>
File: .kss/config.local.json (gitignored: yes)
Models: <harness> → <allowed list> · efforts <list> · tier overrides <n | none>
Review: full → <agent | model/effort> · light → <agent | model/effort>
Cross-harness: <off | on · claude-code 60% / codex 40% · tiers T1–T3 · CLIs found: <list> · missing: <list | none>>
Jev: <off | on · <model> · key from <env NAME | file>>
  auto-assumptions: <on · technical ≥0.85 · layout ≥0.9 · business never | off>
  tier selection:   <on · ≥0.7 · below → rubric | off>
  reasoning:        <on · escalation_class, report_gate[, review_depth] · ≥0.8 | off (experimental)>
  trace:            <on → <feature>/jev-trace.jsonl | off>
Check: <ok · jev-1.13.0 · 320 ms | skipped | failed: <reason> — phases fall back to their rubric>
Next: <prefix>kss-clarify <what you want to build>   (or nothing, if a feature is already running)
```

`<prefix>` is `/` on Claude Code and `$` on Codex.

## Rules

- **The file is gitignored before it is written.** No exception, no "the user can add it later".
- Never print the API key whole — not in the confirmation, not in the summary, not in an error.
  `jev.mjs config` already redacts it; do the same when you show a pasted value.
- One question per turn; a bare Enter keeps the current value.
- Nothing on disk before the confirmation turn.
- Business decisions are auto only if the user explicitly lowers `by_category.business` below 1.
  Never propose it.
- A model or effort that is not in `models.allowed` / `models.efforts` is refused, not written.
- Cross-harness never includes `T4`/`T5` unless the user lists them explicitly, and the summary
  says so when they do.
- `models.tiers` overrides bind the adapter of *this machine only*: they never make it into a
  ticket, a graph or any feature artifact, which keep saying `T3` (DESIGN.md §19.1).
- Do not run any other `kss-` skill from here. End with the summary and stop.
- Terminal output follows `conversation_language` from `~/.kss/preferences.md` (absent: the user's
  language). Keys and values in the file stay English.
