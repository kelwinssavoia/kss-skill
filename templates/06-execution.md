# {{NNN}}-{{slug}} · Execution log

Append-only. One timestamped line per event. States: `blocked`, `ready`, `running`,
`reviewing`, `rejected`, `integrated`.

## Board (last render)

```
kss · {{NNN}}-{{slug}} · execute
{{bar}}  {{n}}/{{N}} integrated · {{pct}}% of estimated turns

| # | Ticket | State | Agent | Turns used/est | Since |
| --- | --- | --- | --- | --- | --- |
| {{NN}} | {{title}} | {{state}} | {{agent}} | {{used}}/{{est}} | {{since}} |

Critical path: {{path}}
Elapsed: {{elapsed}}   Tokens: {{tokens}}
Last: {{event}}
```

## Log

- `{{ts}}` · **{{NN}}** · {{spawn|report|verdict|integrate|escalate}} · {{detail}}

## Git per integrated ticket

| # | Commits | Files | + | − |
| --- | --- | --- | --- | --- |
| {{NN}} | {{commits}} | {{files}} | {{added}} | {{deleted}} |

## Finish
- Full suite: {{command}} — {{result|skipped to CI}}
- PR: {{url}} → {{base_branch}} — **not merged** (human decision)
