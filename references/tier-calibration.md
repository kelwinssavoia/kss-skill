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

## Evidence

Anthropic's published comparison shows Sonnet 4.6 near Opus 4.6 on SWE-bench Verified, with a
larger gap on Terminal-Bench 2.0. Anthropic recommends medium effort as a balanced starting point
for most Sonnet agentic coding workflows and reserves higher effort for complex reasoning. These
benchmarks inform a cautious starting rubric; they do not estimate success for a particular
repository or ticket.

- [Claude Sonnet 4.6 system card](https://www-cdn.anthropic.com/78073f739564e986ff3e28522761a7a0b4484f84.pdf)
- [Anthropic effort guidance](https://platform.claude.com/docs/en/build-with-claude/effort)
