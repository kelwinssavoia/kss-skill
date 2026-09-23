# KSS skills

One folder per skill, each a `SKILL.md`. They run in the order below; `DESIGN.md` is the
normative spec for every one of them.

| Skill | Purpose | Argument hint |
| --- | --- | --- |
| `kss-init` | Sets KSS up in a project: writes `.kss/config.md`, copies the templates, scripts and both harness adapters, and installs whatever the current harness needs. Once per project. | *(no arguments)* |
| `kss-config` | Writes the gitignored `.kss/config.local.json`: which models and efforts each harness may spend, per-tier overrides, cross-harness execution (Claude Code ↔ Codex via CLI, with a percentage split), and whether Jev settles auto-assumptions, picks tiers or takes coordinator judgements — each with its own confidence threshold and the API key. Optional; any time after `kss-init`. | `[--show \| --check \| key=value …]` |
| `kss-clarify` | Turns a vague request into a brief, picks size and track, creates the feature folder and branch. | `<free text \| path \| url>` |
| `kss-investigate` | Read-only explorers map where the feature lives and what to reuse; every decision is classified auto or open. On M (no grill) it ends with the decision check: one table, one answer, every open item decided or deferred. | `NNN-<slug> [--deep]` |
| `kss-review-decisions` | Shows the auto decisions in one table and accepts, reopens or overrides them in a single turn. Optional. | `NNN-<slug>` |
| `kss-grill` | Interviews the user on every open decision, one per turn, business → layout → technical. L only, unless the M decision check escalates. | `NNN-<slug>` |
| `kss-spec` | Writes `03-spec.md`: the functional specification, every FR cited to a recorded decision. | `NNN-<slug>` |
| `kss-plan` | Writes `04-plan.md`: the implementation shape — models, contracts, flows, UI, reuse, file map, test plan. | `NNN-<slug>` |
| `kss-tickets` | Slices the plan into self-contained tickets plus the dependency graph. | `NNN-<slug>` |
| `kss-execute` | Runs the tickets to done: continuous-frontier scheduling in worktrees, gates, review, integration, PR. | `NNN-<slug> [--ticket NN]` |
| `kss-qa` | Blind acceptance test through the web UI: a planner that never saw the code writes scenarios and a seed from the request and the spec, a disposable local environment comes up, a cheap model drives the browser leaving a screenshot per step, Jev judges each scenario, and `qa/report.md` carries the verdict. Optional, after `kss-execute`. | `NNN-<slug> [--replan] [--only S-01] [--keep-up]` |
| `kss-review` | Works the PR review rounds — triage, fix, dispute, answer, defer, reply — and can watch the PR. | `NNN-<slug> [--watch]` |
| `kss-docs-tech` | Writes the as-built technical documentation and links it from the docs index. Optional. | `NNN-<slug>` |
| `kss-docs-product` | Writes the product-facing documentation and links it from the docs index. Optional. | `NNN-<slug>` |
| `kss-status` | Prints the phase board or the execution board. Writes nothing; run it any time. | `[NNN-slug]` |
