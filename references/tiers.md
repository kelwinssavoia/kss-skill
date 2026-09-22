# Tiers — execution effort and uncertainty

A ticket says **what** must be done and how much execution effort and uncertainty it contains. It never says which model,
because the same feature folder is worked from more than one harness: the spec phases in one, the
execution in another (DESIGN.md §19). The tier is the portable name; each harness adapter maps it
to whatever it actually spawns.

## The ladder

| Tier | Name | When a ticket gets it |
| --- | --- | --- |
| `T1` | light | mechanical, local work with a known pattern. Also pure integration such as rebase, merge, or worktree cleanup. |
| `T2` | standard | bounded multi-file implementation following explicit patterns; the normal default. |
| `T3` | demanding | same-area reconciliation that is demanding but whose decisions are already made. |
| `T4` | design | real technical judgement, unresolved design or data semantics, or meaningful cross-layer reconciliation. |
| `T5` | critical | long-horizon end-to-end integration, difficult diagnosis, genuinely unresolved cross-service state or failure semantics, or an escalation after a failed ticket. |

## Domain risk is a separate decision

Migration, API/proto or wire changes, authorization and tenant paths, money-related rules, and
other domain-risk categories do **not** determine the tier by themselves. A mechanically specified
contract or migration may therefore be T2 or T3; a low-risk task with hard diagnosis may be T5.

Risk instead determines mandatory safeguards: the relevant migration discipline, real-codec or
contract coverage, authentication and permission checks, no-scope and forged-tenant cases,
review, and the final suite gate. Model choice can reduce execution uncertainty; it cannot replace
those controls. See [tier calibration](tier-calibration.md).

Plus three fixed roles, which are not a ladder and are never assigned to a ticket:

| Role | What it does |
| --- | --- |
| `explorer` | answers **one** bounded, read-only question about the code, with `file:line` evidence |
| `explorer-deep` | the same job on a question that touches a contract, tenant isolation or money — the questions where a cheap wrong answer is expensive. `kss-investigate` and `kss-plan` escalate to it on their own, saying so before they spawn |
| `reviewer` | reads one finished ticket's diff and report, returns approve or reject with numbered findings; read-only |
| `runner` | runs exactly the command it is given and returns the summary and the failures; **coordinator-only**, and only for the single final run |
| `dispatcher` | runs exactly one `dispatch.mjs run …`, which executes a ticket in the other harness's CLI, and returns its report verbatim; **coordinator-only**, only when cross-harness execution is on (DESIGN.md §21) |

**Escalation is one step at a time**: `T1 → T2 → T3 → T4 → T5`. An execution error (the design was
right, the code is not) moves one tier up in the same worktree with the findings pasted in. A
reasoning error (the approach itself is wrong) may move two, but never more, and never past `T5`.

## What each harness spawns

The mapping is the adapter's, not the ticket's. It is reproduced here so a reader of a feature
folder can see the equivalence without opening either adapter.

| Tier | Claude Code agent | Codex model · reasoning effort |
| --- | --- | --- |
| `T1` | `kss-sonnet-low` | `gpt-5.6-luna` · `low` |
| `T2` | `kss-sonnet-medium` | `gpt-5.6-terra` · `medium` |
| `T3` | `kss-sonnet-high` | `gpt-5.6-terra` · `high` |
| `T4` | `kss-opus-medium` | `gpt-6-astra` · `medium` |
| `T5` | `kss-opus-high` | `gpt-6-astra` · `high` |

For Claude Code, this is Sonnet low/medium/high at T1/T2/T3 and Opus medium/high at T4/T5.
`kss-haiku` (Claude Haiku, no effort setting) exists for `models.tiers` to map `T1`–`T3` to; it is
never a default and never `T4`/`T5`.
| `explorer` | `kss-explorer` | `gpt-5.4-mini` · `low`, read-only |
| `explorer-deep` | `kss-opus-medium`, prompted read-only | `gpt-6-astra` · `medium`, read-only |
| `reviewer` (depth `full`) | `kss-reviewer` | `gpt-6-astra` · `high`, read-only |
| `reviewer` (depth `light`) | `kss-reviewer-sonnet-medium` | `gpt-5.6-terra` · `medium`, read-only |
| `runner` | `kss-runner` | `gpt-5.4-mini` · `low` |
| `dispatcher` | `kss-dispatcher` | `gpt-5.4-mini` · `low` |

A harness whose model list has moved on overrides the right-hand column in its own adapter. The
left column — the tier — never changes, which is the whole point.

A **machine** may override a row too: `models.tiers` in the gitignored `.kss/config.local.json`
(written by `kss-config`) names, per tier and per harness, the agent (Claude Code) or the
`{model, reasoning_effort}` (Codex) to spawn instead. The adapter reads it before the first spawn;
the ticket still says `T3`. Names must be in `models.allowed` / `models.efforts`, and a `T5` is
never mapped to less than the adapter's own `T5`. `haiku` is accepted for `T1`–`T3` only.

The reviewer has its own map, `models.review`, keyed by **review depth** rather than tier: `full`
(the default, and forced whenever the ticket touches a contract, wire, authorization, tenant
isolation, money or a migration) and `light` (only when Jev's `review_depth` classification says so
with confidence). `scripts/review.mjs pick` resolves a depth to a reviewer; see DESIGN.md §20.2.

## Reading a ticket written before tiers

Tickets and graphs from KSS ≤ 0.1.4 carry `**Model:** opus|sonnet · **Effort:** low|medium|high`
instead of a tier. Translate on the fly; do not rewrite the ticket:

| Model + Effort | Tier |
| --- | --- |
| `sonnet` + `low` | `T1` |
| `sonnet` + `medium` | `T2` |
| `sonnet` + `high` | `T3` |
| `opus` + `medium` | `T4` |
| `opus` + `high` | `T5` |

There was never an `opus` + `low`. A ticket carrying it is a defect: read it as `T4`, and say so in
the execution log.

The config key moved with it: `explorer_model: sonnet|opus` became
`explorer_tier: explorer|explorer-deep`. A project still carrying the old key reads `opus` as
`explorer-deep` and anything else as `explorer`; `kss-init` rewrites it on its next run.
