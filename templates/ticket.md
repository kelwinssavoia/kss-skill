# {{NN}} · {{ticket_title}}

<!-- multi-agent header -->
**Layer:** {{layer}} · **Blocked by:** {{blocked_by}} · **Blocks:** {{blocks}} ·
**Model:** {{opus|sonnet}} · **Effort:** {{low|medium|high}} · **Helpers:** {{explorer|none}} ·
**Est.:** {{turns}} turns · **Worktree:** yes

<!-- single-session header
**Order:** {{n}} · **Est. context:** {{k}}k · **/clear before:** {{yes|no}}
-->

## Goal
{{one_paragraph}}

## Requirements covered
- **FR-{{NN}}** · {{full_FR_text_pasted}} [{{citations}}]

## Plan excerpt

| File | Action | Layer | Why (FR) |
| --- | --- | --- | --- |
| {{path}} | {{action}} | {{layer}} | {{FR}} |

**Contract shapes:**
```
{{shapes_pasted_from_plan}}
```

**Reuse:**
- {{what}} — {{path}}

## Files
- **Write:** {{path}} — lines {{range}}
- **Read for pattern:** {{path}} — lines {{range}}

## Tests
- **Spec file:** {{spec_file}}
- **Cases:** {{case_names}}
- **Write these specs first and commit them before the implementation. Never run them** — the
  coordinator runs the suite once, after integration.

## Project rules that apply
- {{rule}} — {{one_line}}

## Do not
- Open `03-spec.md` or `04-plan.md` — everything you need is in this ticket.
- Read whole files over 300 lines; use ranges.
- Run any test, lint, build or type-check command — nobody but the coordinator runs them, once,
  at the end.

## Report back (≤1.5k chars, this exact shape)
```
Ticket: {{NN}}-{{slug}} · <state: done | blocked>
Branch: {{branch}} (worktree {{path}})
Commits: {{sha}} test: … / {{sha}} feat: …
Files: {{paths}}
Tests: {{spec files written}} · not run (coordinator runs the suite after integration)
Deviations: {{none | what and why}}
Blocked on: {{only when state is blocked}}
```

<!-- This is the same shape every kss-* executor agent is told to return; do not diverge. -->
