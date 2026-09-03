# {{NN}} · {{ticket_title}}

<!-- multi-agent header -->
**Layer:** {{layer}} · **Blocked by:** {{blocked_by}} · **Blocks:** {{blocks}} ·
**Model:** {{opus|sonnet}} · **Effort:** {{low|medium|high}} · **Helpers:** {{explorer|runner|none}} ·
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
- A **red run is required before implementation**; paste the failing output in the report.

## Project rules that apply
- {{rule}} — {{one_line}}

## Do not
- Open `03-spec.md` or `04-plan.md` — everything you need is in this ticket.
- Read whole files over 300 lines; use ranges.
- Run the full test suite mid-ticket.

## Report back (≤1.5k chars, this exact shape)
```
Ticket: {{NN}}-{{slug}} · <state: done | blocked>
Branch: {{branch}} (worktree {{path}})
Commits: {{sha}} test: … / {{sha}} feat: …
Files: {{paths}}
Tests: {{command}} → {{result}}
Red run: {{the failing assertion / first failure line}}
Deviations: {{none | what and why}}
Blocked on: {{only when state is blocked}}
```

<!-- This is the same shape every kss-* executor agent is told to return; do not diverge. -->
