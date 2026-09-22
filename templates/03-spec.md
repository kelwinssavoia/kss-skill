# {{NNN}}-{{slug}} · Spec

Cap 15k chars. Over cap the skill refuses and asks for the feature to be split.
{{revision_marker}}

## Problem
{{problem}}

## Solution
{{solution}}

## User stories
- **US-{{N}}** — As a {{actor}}, I want {{goal}}, so that {{value}}.

## Functional requirements
- **FR-{{NN}}** · Given {{given}}, when {{when}}, then {{then}}. [{{D-xx}}, {{AD-yy}}]
  <!-- An FR with no citation is refused. -->

## Non-functional requirements
- **NFR-{{NN}}** — {{requirement}} — required by {{standard_file}} § {{rule}}

## Test seams
- {{seam}} — {{existing|new}} — {{spec_file}}{{rule_that_requires_a_new_seam}}

## Contracts and data
- {{message_or_entity}} — {{file}}

## Layout
- {{surface}} — {{layout_file}} · view {{view}} — components: {{design_system_components}}

## Card versus scope

What the source asked for, beside what this spec builds. Every row on the right
with no counterpart on the left is a widening: it is allowed, it is usually
right, and it has to be visible as a widening rather than dissolve into the FR
list. Name the decision that authorised it.

| The card asked | We are building | Authorised by |
| --- | --- | --- |
| {{literal_line_from_the_source}} | {{what_the_spec_covers}} | — |
| — | {{widening}} | {{D-xx}} |

- Widenings: {{count}}. Anything in scope with no card line and no decision is an error.

## Out of scope
- {{out_of_scope}}

## Open items
- **DF-{{NN}}** — {{question}} · owner: {{owner}} · date: {{date}}

## Traceability

| Story | FRs |
| --- | --- |
| US-{{N}} | {{frs}} |

| Decision | FRs |
| --- | --- |
| {{D-xx}} | {{frs}} |

- Decision with no FR: warning.
- Story with no FR: error.
- FR blocked by a DF-: marked.

## Revision {{N}}
{{what_changed_and_which_FRs_were_rewritten}}
