# KSS skills

One folder per skill, each a `SKILL.md`. They run in the order below; `DESIGN.md` is the
normative spec for every one of them.

| Skill | Purpose | Argument hint |
| --- | --- | --- |
| `kss-init` | Sets KSS up in a project: writes `.kss/config.md`, copies the templates and scripts, installs the agent matrix and the statusline. Once per project. | *(no arguments)* |
| `kss-clarify` | Turns a vague request into a brief, picks size and track, creates the feature folder and branch. | `<free text \| path \| url>` |
| `kss-investigate` | Read-only explorers map where the feature lives and what to reuse; every decision is classified auto or open. | `NNN-<slug> [--model opus]` |
| `kss-review-decisions` | Shows the auto decisions in one table and accepts, reopens or overrides them in a single turn. Optional. | `NNN-<slug>` |
| `kss-grill` | Interviews the user on every open decision, one per turn, business → layout → technical. | `NNN-<slug>` |
| `kss-spec` | Writes `03-spec.md`: the functional specification, every FR cited to a recorded decision. | `NNN-<slug>` |
| `kss-plan` | Writes `04-plan.md`: the implementation shape — models, contracts, flows, UI, reuse, file map, test plan. | `NNN-<slug>` |
| `kss-tickets` | Slices the plan into self-contained tickets plus the dependency graph. | `NNN-<slug>` |
| `kss-execute` | Runs the tickets to done: continuous-frontier scheduling in worktrees, gates, review, integration, PR. | `NNN-<slug> [--ticket NN]` |
| `kss-review` | Works the PR review rounds — triage, fix, dispute, answer, defer, reply — and can watch the PR. | `NNN-<slug> [--watch]` |
| `kss-docs-tech` | Writes the as-built technical documentation and links it from the docs index. Optional. | `NNN-<slug>` |
| `kss-docs-product` | Writes the product-facing documentation and links it from the docs index. Optional. | `NNN-<slug>` |
| `kss-status` | Prints the phase board or the execution board. Writes nothing; run it any time. | `[NNN-slug]` |
