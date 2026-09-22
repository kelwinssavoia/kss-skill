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

- [Claude Sonnet 4.6 system card](https://www-cdn.anthropic.com/78073f739564e986ff3e28522761a7a0b4484f84.pdf)
- [Anthropic effort guidance](https://platform.claude.com/docs/en/build-with-claude/effort)
