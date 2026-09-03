# {{NNN}}-{{slug}} · Plan

Cap 20k chars. Shape, not code. Every item traces to an FR or a decision.

## Approach
{{approach}}

## Models and data

| Entity | Action | Fields (type, nullability) | Migration |
| --- | --- | --- | --- |
| {{entity}} | {{new\|changed\|read}} | {{fields}} | {{yes\|no}} |

## Contracts

### {{message_or_endpoint}}
- **Sender shape:** {{shape}}
- **Receiver shape:** {{shape}}
- **File:** {{proto_or_dto_file}}
- **Audit spec:** {{spec_file}}

## Services and flows

- `{{signature}}` — {{what_it_does}} — {{FR}}

### Flow: {{flow_name}}
1. {{caller}} → {{callee}} via {{HTTP|gRPC|Kafka}} — {{payload}}
2. …

## UI

### {{surface}}
- **Components:** {{design_system_component}}({{props}})
- **State lives in:** {{where}}
- **Data source:** {{endpoint_or_hook}}
- **Empty state:** {{copy}}
- **Error state:** {{copy}}
- **Layout view:** {{layout_file}} · {{view}}

## Reuse

| What | Path | Used by |
| --- | --- | --- |
| {{helper_component_fixture}} | {{path}} | {{ticket_or_file}} |

## New dependencies

| Name | Why the stack cannot | Size | Licence | Confirmed |
| --- | --- | --- | --- | --- |
| {{name}} | {{why}} | {{size}} | {{licence}} | {{yes\|pending}} |

## File map

| File | Action | Layer | Why (FR) |
| --- | --- | --- | --- |
| {{path}} | {{create\|modify\|—}} | {{layer}} | {{FR-NN}} |

<!-- Every `create` needs a justification against Reuse. -->

## Test plan

### Seam: {{seam}}
- **Spec file:** {{spec_file}}
- **Cases:**
  - {{case_name}}
  - {{empty_case_name}}
  - {{forbidden_case_name}}

## Risks and rollout
- **Risk:** {{risk}} — mitigation: {{mitigation}}
- **Rollout:** {{rollout}}
