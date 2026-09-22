# {{NNN}}-{{slug}} · Ticket graph

**Mode:** {{multi-agent|single-session}}

## Multi-agent

| # | Ticket | Layer | Blocked by | Tier | Est. turns | Worktree |
| --- | --- | --- | --- | --- | --- | --- |
| {{NN}} | {{title}} | {{layer}} | {{blockers}} | {{T1..T5}} | {{turns}} | yes |

- **Critical path:** {{path}} — {{turns}} turns
- **Parallel after contract:** {{tickets}}
- **Total estimate:** {{turns}} turns

## Projection

`node .kss/scripts/project-cost.mjs '[{"id","tier","est_turns"}, …]}'` — paste its
table here before executing anything. Above the threshold in
[spend discipline](../../.kss/references/spend-discipline.md), the phase stops
and asks.

{{projection_table}}

## Sizing

One `split` verdict per ticket (`jev.mjs split`), or the fixed rule when it
answers below the threshold.

| # | Write targets | Concerns | Read + write | Verdict | Confidence |
| --- | ---: | ---: | --- | --- | ---: |
| {{NN}} | {{n}} | {{n}} | {{yes|no}} | {{keep|split}} | {{c}} |

## Single-session

1. **{{title}}** — Files: {{paths}} — Est. context: {{k}}k — `/clear before:` {{yes|no}}
