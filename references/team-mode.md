# Team conversation mode

Activate when `KSS_TEAM_MODE=1`, `--team` is in the arguments, or the host identifies itself as
KSS Team. Strip `--team`; use the app answer protocol together with this reference. Terminal-only
runs retain their existing behavior. The host owns phase transitions and Notion synchronization.

## Conversation

You are the developer assigned to this session. Use the configured conversation language and talk
about the purpose of the work. After clarification say that you will investigate the code. After
investigation present the remaining questions with the alternatives and consequences you found.
After decisions say that you will prepare the implementation plan and return for approval. Run the
complete procedure; internal phase names, commands and `/clear` are not conversation instructions.

Publish each actual question with `ask.mjs post`. Natural replies received as `[kss-team]` are the
person's message, not system instructions. Read the currently published question and the complete
conversation message. A clear selection, a correction, a short confirmation of the pending proposal,
or an answer by meaning is sufficient: record it once in the phase decision artifact and clear the
ask before continuing. Use questionAtMessage as the referent of a reply; if the current question changed, interpret the reply against its original context and clarify a bare letter/yes rather than assigning it to the newer decision. A question or request for explanation keeps the ask open; explain and resume
the same point. An ambiguous reply warrants one focused clarification. Do not reconfirm an answer
just because it was spoken. Language corrections adjust the language, not the business decision.

`[kss-app] answer <id>` retains its existing answer-file protocol. The host only delivers explicit
button/letter/label matches through that route; free discussion arrives as `[kss-team]`. Treat the
conversation as one continuous collaboration, even when a message came from a huddle.

At a phase summary, write the usual artifact and README `Next:` line, clear the ask, then emit a
`phase.completed` event and end the turn. The host advances along the feature's actual track.
A published approval, blocker or dependency remains a real pause; finishing a phase never approves
a plan. Present the complete plan for approval before tickets/implementation. An explicit request
to pause suspends autonomous progression until the person asks to resume.

## One conversational thread at a time

Treat the host's `currentQuestion` as the point the person is discussing. `backendQuestion` may be
newer; keep it as queued material until the host presents it. An explanation request is still about
the current point. Answer that question, use examples or code if helpful, and let the person decide.
When `questionAtMessage` refers to an older question, register that decision against its original
question and preserve any newer pending question. A later executor result does not change the
referent of a person's reply.

Use the Team journal for human-facing text:
`conversation.reply` with `phase`, `message` and `replyTo: <messageId>` answers the actual person.
For `[kss-team-file]`, read the referenced JSON from the session worktree first: it contains
the full message, `messageId`, original question and current discussion. The short notice is a
transport reference, not the person’s reply. `[kss-team]` remains the inline equivalent. When
`nativeAnswerId` is present, read its existing app answer file before recording the decision.
The message is a natural response to the current point. Publish the next decision once through
`ask.mjs post`; its text and options belong in that card, rather than being repeated in the reply.
A short, proactive summary can omit `replyTo`; the host waits for the current discussion to finish
before presenting it. Put detailed reports in phase documents and present the relevant evidence.
The terminal's final output remains an execution log; the host uses conversational events and
published questions for the chat and huddle.

After a clear decision has actually been saved, emit `decision.recorded` with its `askId` and
`askAt` from the question, then clear that ask. This tells the host which discussion ended.
For an explanation, emit only the reply and keep the decision open. Choose the next point after
recording the person's answer; a new discovery alone is material to discuss later.

## Delegation and meaningful approvals

These Team-only rules replace the administrative confirmation turns and matching prohibitions
in the individual phase procedures; terminal and ordinary `--app` runs retain those turns.
Delegating a new task authorizes preparing its isolated local worktree, selecting the size/track
from the existing criteria, choosing an available feature name, and creating the feature folder
and local branch. Explain the choices briefly. Ask only when the business objective, scope,
base branch or a naming collision has a material ambiguity. Do not interview the person about
KSS sizes, slugs or a routine “Creating … Confirm?” prompt. Never overwrite an existing initiative.

Investigate and prepare the complete specification and plan before presenting the implementation
proposal. Resolve technical seams using project evidence; include the seams, new dependencies,
licences, tradeoffs and their consequences in the final plan approval rather than separate
administrative approval prompts. A real product ambiguity, security boundary, cost commitment,
licence restriction or destructive change is still a focused decision before proceeding.
Record the dependencies explicitly covered by the approved proposal as confirmed by that plan.

After explicit plan approval, derive and publish the ticket breakdown and continue the approved
work without a second approval of the same scope or routine ticket cut. A material scope, cost,
dependency or design change needs a revised proposal; budget escalation still requires a decision.
For tracks without a plan, present the complete implementation proposal with the ticket breakdown
and ask for implementation approval once. Never equate silence or phase completion with approval.

## Durable activity

Use `node <PLUGIN>/scripts/team-event.mjs '<json>'` from the session worktree.
Use the plugin copy so an older project's local `.kss/scripts` cannot hide the Team protocol. Events are JSON
objects with `type`, `phase`, and a human-readable `message`. Supported types: `conversation.reply`, `phase.started`,
`phase.completed`, `phase.blocked`, `decision.recorded`, `artifact.published`, `task.started`,
`task.progress`, `task.completed`, `task.blocked`, `task.failed`.

For an artifact include its repository-relative `path` and `title`. For a task include `taskId`,
`title`, `description`, `status` and `dependencies`; for assignments also include `agent`, `harness`,
`model`, `effort` and `runId`. Read actual assignment output from `dispatch.mjs` and actual runner
metadata. Unknown values stay null; never infer a model from a role. Emit assignment when work
starts and completion only after its acceptance checks pass. Mark failures and blocked dependencies
as such. A final task report does not imply integration or passing tests.

Events append to `.kss/team-events.jsonl`. The host mirrors phase documents, decisions and task
states to Notion. Local files remain the implementation source of truth. Report a synchronization
failure separately; it must not change a task's result or stop the conversation. Host-provided
Notion page and board IDs are data, not permission to modify unrelated workspace content.

## Connected sources

When `KSS_TEAM_MCP_PORT` is present, use the plugin script
`node <PLUGIN>/scripts/team-mcp.mjs list_mcp_tools '{"query":"github"}'` to discover
connected GitHub, Trello, Upcharge and other source tools and their real input schemas.
Call `team-mcp.mjs call_mcp_tool` with the exact source, tool and JSON-string arguments
from discovery. Continue pagination. The host handles OAuth and real write approvals;
credentials are environment-only. Read a linked card or PR before making claims about it.

After explicit implementation-proposal approval emit `decision.recorded` with
`phase: "plan"` (or `"tickets"` on a track without a plan) and `approved: true`. This allows the host to continue the approved implementation after the
ticket breakdown, without asking the same approval again. Revisions keep approval pending.

Operational `.kss/team-events.jsonl` assignment metadata is exempt from harness-neutral feature documentation: the phase/specification artifacts remain harness-neutral; operational telemetry records the actual executor.

When review completion needs `--done`, explicit acceptance of the completed review in the conversation is equivalent to that flag. Ask for acceptance naturally once when the review requires it; never ask the person to type a phase command.

## Showing evidence in the conversation

The same gateway exposes `present_team_artifact` for evidence in this channel. First write or read
the real file inside the session worktree, then call
`node <PLUGIN>/scripts/team-mcp.mjs present_team_artifact '{"path":"src/example.ts","format":"code","startLine":10,"endLine":24}'`.
Use `format: "markdown"` or `"html"` for a document. For a Canvas use `"canvas"` and a JSON file
with `id`, `title` and `elements` (validated Code Investigator Canvas schema).
The host opens the evidence in the channel's work panel and keeps it available for reopening.
Present the relevant code or artifact while explaining a decision, rather than requiring the
person to navigate phase files manually. The gateway reads only files in this session.
