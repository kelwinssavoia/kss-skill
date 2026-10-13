# Tier calibration — execution uncertainty

## Decision

T1–T5 measure the execution effort and uncertainty of a ticket, not the sensitivity of the domain
it touches. The normal starting point for an explicitly specified, pattern-following implementation
is T2. Raise the tier only when the expected execution requires more reconciliation, judgement,
diagnosis, or long-horizon state management.

## Safeguards remain independent

Database migrations, API/proto and wire contracts, authorization and tenant paths, money-related
rules, and end-to-end boundaries retain their mandatory tests, reviews, and final gates regardless
of tier. A stronger model can reduce execution uncertainty; it cannot replace those controls.

## Scoring a tier after the fact

A rubric nobody checks drifts. Once per feature, compare the tier Jev chose against what the
ticket actually took, from `jev-trace.jsonl` and `metrics.jsonl`. Wrong with high confidence means
the criteria text is wrong, not the threshold; right with low confidence means the threshold can
come down.

This is worth stating because it has already happened. On one feature the first tier pass put all
seven tickets at T5, five of them at confidence 0.91 or above, because it was reading domain risk
as execution effort. The fix was the `instructions` string in `buildTier`, which now says outright
that a domain-risk category does not raise a tier by itself.

The routine, and the rest of the habits that keep a feature's spend visible before it is spent,
are in [spend discipline](spend-discipline.md).

## Evidence

Anthropic's published comparison shows Sonnet 4.6 near Opus 4.6 on SWE-bench Verified, with a
larger gap on Terminal-Bench 2.0. Anthropic recommends medium effort as a balanced starting point
for most Sonnet agentic coding workflows and reserves higher effort for complex reasoning. These
benchmarks inform a cautious starting rubric; they do not estimate success for a particular
repository or ticket.

Re-checked 2026-10-13 for the 5.5 generation. Haiku 5.5 (released 2026-10-07) is the first Haiku
that takes an effort; Anthropic starts it at `medium` for agentic work, notes that at `low` it skips
searches and checks in long agent prompts, and recommends `high` for strict instruction following.
It scores 64.8% on SWE-bench Pro against Sonnet 5.5's 81.3%, at about a twentieth of the price
($0.10/$0.50 vs $2/$10 per MTok) — so it takes `T1` at `high`, plus the explorer (`medium`) and
the runner and dispatcher (`low`), and never `T4`/`T5`. Sonnet 5.5 nearly matches Opus 5.5 on
coding benchmarks; its guide starts well-specified agentic coding at `medium` and moves to `high`
for harder or longer work. Because KSS tickets carry every decision, `T3` runs at `medium` like
`T2`; Opus 5.5 keeps `medium` (its default) at `T4` and `high` at `T5`.

- [Anthropic effort guidance, per model](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Models overview and pricing](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Claude Sonnet 4.6 system card](https://www-cdn.anthropic.com/78073f739564e986ff3e28522761a7a0b4484f84.pdf)
- [Anthropic effort guidance](https://platform.claude.com/docs/en/build-with-claude/effort)
