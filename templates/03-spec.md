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
