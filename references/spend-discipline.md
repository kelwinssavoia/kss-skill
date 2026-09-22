# Spend discipline

**Status:** adopted · derived from the 026 retrospective.

KSS turns a decision taken in the grill into tickets, agents and dollars without
ever showing the bill first. On 026 that produced seven tickets, twenty-four
agents and about $47 for a card that asked for a boolean and two entry points.
Nothing went wrong in the execution. The scope was simply never priced while it
was still cheap to change.

These are the five habits that put a number in front of the spend.

## 1 · Cost grows with the square of the turns

The Messages API is stateless, so every turn resends the whole conversation.
Cache reads make that affordable, not free: one agent's cumulative cost scales
with the **square** of its turns, not with the turns. The 026 metrics show it
plainly:

| Agent | Turns | Cache read | Per turn |
| --- | ---: | ---: | ---: |
| integrator | 6 | 114.8k | 19k |
| fix | 42 | 1.42M | 34k |
| executor | 78 | 7.75M | 99k |
| executor, ticket 01 | 112 | 14.52M | 130k |
| executor, ticket 03 | 152 | 28.68M | 189k |

The last two rows are the same kind of work. 1.95× the turns cost 3.70×, and
1.95² is 3.80.

This is the whole argument for subagents: seven fresh contexts pay seven small
parabolas instead of one enormous one. It is also why a subagent that outgrows
its budget destroys that saving on its own. Ticket 03's executor was 16% of the
entire feature.

## 2 · Project the cost before executing

`/kss-tickets` runs `.kss/scripts/project-cost.mjs` over the drafted tickets and
pastes its table into `graph.md`. It counts an executor, a reviewer and an
integrator per ticket, and applies the measured overrun.

```
node .kss/scripts/project-cost.mjs '[{"id":"01","tier":"T3","est_turns":35}, …]'
```

Against 026's real tickets it projects $34.47, where the subagents actually cost
about $32. Close enough to argue with, which is the point.

**Above 5 tickets or $30 projected, the phase stops and asks for an explicit
human go-ahead before `/kss-execute`.** Below that it prints the table and
carries on.

The model is fitted from one feature on one repository. Re-fit it when
`metrics.jsonl` disagrees; the constants and the price table are at the top of
the script.

## 3 · One unit of work per ticket

A ticket is split when any of these holds:

- more than **six write targets**
- more than **one service concern**
- both a **read path and a write path** in the same ticket
- an estimate above **55 turns**, which leaves no room under the 80-turn budget
  after a single rejection

`jev.mjs split` asks the same question with the ticket's shape as state, and the
rule above is the rubric it falls back to below the threshold. The verdict is
advice to the coordinator, never an automatic rewrite.

On 026 this would have cut ticket 03 into its read side (the predicate plus
readiness, payout and revalidation) and its write side (the mutation, the
activity and the controller), and ticket 01 into models plus proto. Those were
the two tickets that escalated.

## 4 · The budget is reported, because it cannot be enforced

No harness can kill a subagent mid-flight. So the 80-turn and 150k-context
budgets are held in two weaker ways:

- `render-cost.mjs` prints an **Over budget** block naming every agent that went
  past either one, and the coordinator records it in the execution log.
- the executor agents are told to return what they have when they reach the
  budget, saying what remains, instead of pushing on.

Real prevention is habit 3. A right-sized ticket never reaches 80 turns.

## 5 · Read the trace after every feature

`jev-trace.jsonl` records every verdict with its confidence and its full
probability spread, and nobody reads it afterwards.

On 026 the first tier pass put **all seven tickets at T5**, five of them at
confidence 0.91 or above, and it was wrong: it was reading domain risk as
execution effort. High confidence with a wrong answer is the worst calibration
signal there is, and it sat unread in the file.

What fixed it was not the model or the threshold. It was the `instructions`
string in `buildTier`, which now says outright that a domain-risk category does
not raise a tier by itself. After that rewrite the verdicts spread across T2, T3
and T5 with much lower confidence, which is the correct behaviour for genuinely
ambiguous tickets.

So, once per feature, compare what Jev chose against what happened:

- wrong with **high** confidence → rewrite the criteria text, not the threshold
- right with **low** confidence → the threshold can come down
- consistently open → the state handed to it is too thin

This depends on the metrics being true. Until `render-cost.mjs` credits agents
by their spawn row, the recorded turns are fiction and the tier cannot be
scored. See [tier calibration](tier-calibration.md).

## 6 · Tooling defects leave the feature

A defect found in KSS during a feature goes to `.scratch/` as an issue, and the
feature carries on, unless it actually blocks delivery.

026 spent 35 minutes and five commits on tier calibration in the middle of its
critical path. The research was right and is now policy. It blocked nothing: the
seven tiers could have been set by hand in two minutes and the work done later,
in a separate session, on a clean and much cheaper context.
