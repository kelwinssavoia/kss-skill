# App mode (DESIGN.md §26)

kss-desktop starts every phase with `--app` among its arguments. `--app` is a flag, never part of a
request, a slug or a ticket id — strip it before reading the arguments. Without it, nothing here
applies and the phase talks to the terminal as it always did.

In app mode the person is looking at the app, not at the terminal. Every turn that **waits for the
person** — a question, a confirmation, a draft to approve, a stop that needs a decision, a phase
that must run first — is **published** before it is printed, so the app can show it as a card and
answer it with a click, a free text or an edited draft. The terminal still shows the same text:
the app is a second door, never the only one.

## Publish: `ask.mjs post`

Pipe one JSON object on stdin (a quoted heredoc, so nothing needs escaping):

```bash
node .kss/scripts/ask.mjs post <<'JSON'
{ "phase": "plan", "kind": "approve", "title": "Approve the plan",
  "text": "Approach, contracts and file map below. Approve, or edit the draft.",
  "draft": "notes/plan-draft.md" }
JSON
```

It prints the ask's id (`plan-3`) — keep it. Then print the same question in the terminal and end
your turn. Never open the harness's multiple-choice dialog in app mode: the app cannot click it.

| Field | |
| --- | --- |
| `phase` | the running phase, without `kss-` |
| `kind` | `question` · `confirm` · `approve` · `blocked` · `handoff` (below) |
| `title` | ≤ 80 characters — what is being decided |
| `text` | the question and the context needed to answer it, markdown, ≤ 1500 characters |
| `options` | `[{ "key": "a", "label": "…", "description": "its consequence", "lean": false }]` in the order printed. `something else` is never an option — the app always offers free text. `lean: true` on the one you recommend, never on a business question |
| `category` | `business` · `layout` · `technical`, when it is a decision |
| `source` | where the question comes from (`01-investigation.md`, `FR-03`, `suite run 3`) |
| `draft` | for `approve`: a file (relative to the feature folder, or absolute) holding the draft as markdown. Write the draft there first |
| `run`, `then` | for `handoff`: `{ "phase": "spec", "args": "NNN-slug" }` each |

| `kind` | When | Options |
| --- | --- | --- |
| `question` | a decision, a missing fact only the person knows, a name | the options found; `[]` for free text only |
| `confirm` | "Creating … Confirm?", a size, a go-ahead, a new dependency | omit them: the app shows Confirm / Change. Or give your own |
| `approve` | a draft the person may edit before it is written: the plan, the test seams, the ticket cut, the triage table | omit them: the app shows Approve / Edit draft / Ask for changes |
| `blocked` | the phase cannot go on without the person: a third failing suite run, a cap reached, a ticket past its budget, an unreadable input | the ways out you can take (`retry once more`, `send to review with the failures listed`, `stop here`) |
| `handoff` | a precondition names an earlier phase that has to run first (the plan finds no spec) | none — the app runs `run`, then starts this phase again |

## Read the answer: `ask.mjs answer`

The app answers with one line typed into this terminal:

```
[kss-app] answer plan-3: b) Keep the cache in Redis
```

On a line that starts with `[kss-app] answer <id>`, run `node .kss/scripts/ask.mjs answer <id>`
**before anything else**. It prints the full answer and clears the ask:

```
choice: b) Keep the cache in Redis
text: …free text, when given…
draft: edited — .kss/inbox/plan-3.answer.md
```

`draft: edited` means the person changed the draft: **read that file — it replaces yours**, and
treat its changes as the person's decisions. `draft: unchanged` means approved as it was. A choice
and a free text are exactly a typed answer: every rule of the phase about answers still holds.

If the person answers in the terminal instead, run `node .kss/scripts/ask.mjs clear` before going
on, so the card disappears.

## Progress: what the phase is doing now

At each step of the procedure, one line, so the app's phase view says where the phase is:

```bash
node .kss/scripts/current.mjs set '{"progress":{"step":4,"total":9,"label":"Designing the shape"}}'
```

`label` ≤ 60 characters, in `conversation_language`. Clear it (`{"progress":null}`) with the
summary. Cheap — skip it for steps that take a single command.

## Decisions inside a phase

A phase that finds an **undecided product or architecture question** does not stop and send the
person to the grill any more: it asks it on the spot, in the grill's format (`kind: question`, the
category, the source, the options found in the repository with their consequences, a lean only on
a non-business question). Then:

- the answer is recorded as the next `D-NN` in `02-decisions.md`, with `Source: <phase>` and the
  question, exactly as the grill records it (create the file from `.kss/templates/02-decisions.md`
  when the track had no grill); an answer that overrides an `AD-NN` marks it `overridden` there;
- "don't know" / "later" → a `DF-NN` with an owner and a date, asked in the same turn;
- the phase continues from where it stopped, using the decision.

More than **five** such questions in one phase means the investigation missed a whole area: then
publish a `handoff` to `investigate` (on L, to `grill`) instead of interviewing here.

## When a phase needs an earlier one

A precondition that names an earlier phase (`Run kss-spec NNN-slug first`) publishes a `handoff`
with `run` = that phase and `then` = this one, prints the stop line as before, and ends. The app
runs `run`, and when it finishes, starts `then` again — every phase resumes from the feature
folder, so nothing is lost.

## Never

- Never publish a question you would not have asked in the terminal: app mode changes the door,
  not the rules of the phase.
- Never leave an ask behind: the summary of the phase runs `ask.mjs clear` first.
- Never read `.kss/inbox/` for anything but the answer you were told about.
