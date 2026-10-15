# The phase report (DESIGN.md §25)

Every phase ends by explaining itself to a human — what it did, what it built, each decision. You
write **one JSON file** with the content; `report.mjs` validates it and rebuilds the feature's
interactive page `<features_root>/NNN-slug/report/index.html`. You never write HTML.

## Show, do not narrate

The reader wants to understand the feature in two minutes, not read an essay. **Illustrate**:
a flow of the parts involved, a sequence of the main path, the few lines of code that carry the
rule, an example with real input and output, a table — and keep every sentence short. If a
paragraph explains how pieces connect, it should be a `flow`; how a request travels, a
`sequence`; what the user sees, an `example`; a set of cases, a `table`. Text sections are for
the one or two things a picture cannot say.

The script enforces it: summary ≤ 600 characters, `did` ≤ 7 lines of ≤ 200, a decision's text
≤ 400, a code explanation ≤ 320, a text section ≤ 700. Past a limit it refuses the file and says
which field — cut words, do not split them across more fields.

## When and how

At the end of the phase, **after its artifacts are final and before the commit**:

1. Write `<features_root>/NNN-slug/report/<phase>.json` — `<phase>` without the `kss-` prefix
   (`clarify`, `investigate`, `review-decisions`, `grill`, `spec`, `plan`, `tickets`, `execute`,
   `qa`, `review`, `docs-tech`, `docs-product`). Running a phase again overwrites its file.
2. Run `node .kss/scripts/report.mjs <features_root>/NNN-slug --phase <phase>`. It prints
   `report: …/report/index.html (<n> phases)`. If it prints `report: <file>: <problem>` and exits 1,
   fix the file and run it again — never skip it. `--phase` holds that file to the limits above
   and checks every `code` section against the repository (below).
3. The phase's commit already adds `<features_root>/NNN-slug`, so `report/` goes with it.

If `.kss/scripts/report.mjs` does not exist (a project set up before reports), skip the report
and print `Report: run kss-init to enable reports` in the summary instead of the `Report:` line.

## Language

Every string in `conversation_language` from `~/.kss/preferences.md` (absent: the language the
user writes in) — not `docs_language`. Set `"lang"` to it (`"pt-BR"`, `"en"`, `"es"`…). Code,
identifiers (`FR-03`, `D-02`), paths and labels inside code stay as they are.

## The file

```json
{
  "phase": "execute",
  "lang": "pt-BR",
  "title": "O que foi implementado",
  "summary": "One to three sentences: what exists now that did not before.",
  "did": ["one line per thing done — at most 7"],
  "sections": [ … rich blocks, below … ],
  "decisions": [
    { "id": "EX-01", "title": "…", "decision": "…", "why": "…", "rejected": ["…"],
      "kind": "execution", "status": "decided", "source": "06-execution.md" }
  ],
  "highlights": [{ "group": "…", "items": [{ "label": "FR-01", "text": "…" }] }],
  "open": ["DF-01 — … · owner · date"],
  "risks": ["one line each"],
  "artifacts": [{ "path": "02-decisions.md", "what": "…" }],
  "at": "<ISO-8601 now>"
}
```

Required: `phase` (equal to the file name), `lang`, `summary`, `did`. Everything else is optional —
leave out what the phase does not have. Decisions need `title` and `decision`; give `why`,
`rejected` and `source` whenever the artifacts have them, and never invent a reason. `kind`:
`business`, `layout`, `technical`, `scope`, `design`, `auto`, `review`, `execution`, `quality`.
`status`: `decided`, `auto`, `accepted`, `overridden`, `reopened`, `deferred`, `open`, `rejected`.
Cost, the track and the Next line are read from `metrics.jsonl` and the README — not yours.

## Sections

An ordered list; the page renders them under the summary, and the sections of every phase are
gathered in the page's **What was built** tab (execute first). Each may have a `title` (≤ 80
characters) and an `intro` (one sentence). Inline text accepts `` `code` ``, `**bold**`, `*em*`;
a `text` body also accepts `- ` lists and blank-line paragraphs.

| `type` | Fields | Use it for |
| --- | --- | --- |
| `flow` | `nodes: [{id, label, group?, detail?, changed?}]`, `edges: [{from, to, label?}]` | the parts involved and how they connect; `changed: true` marks what this feature touched; `detail` (one sentence) shows on click. ≤ 16 nodes |
| `sequence` | `participants: [..]`, `messages: [{from, to, text, kind?: "reply"\|"error", detail?}]` | how one request or action travels; the reader can play it step by step. ≤ 6 participants, ≤ 14 messages, `text` ≤ 60 |
| `code` | `file`, `line`, `code`, `lang?`, `highlight?: [line numbers]`, `explain?` | the lines that carry a rule — **copied verbatim** (below). ≤ 60 lines; elide the rest with a `// …` line |
| `diff` | `file?`, `diff` (unified) or `before`/`after`, `lang?`, `explain?` | a change best seen as before/after |
| `example` | `steps: [{label, input?, output?, lang?, note?}]` or `cases: [{name, steps}]` | what a user or a client does and gets back — real paths, payloads, messages |
| `table` | `columns`, `rows` | cases, mappings, limits, permissions |
| `files` | `items: [{path, change?: added\|modified\|deleted\|renamed, added?, deleted?, what?}]` | the files touched, grouped by folder |
| `callout` | `body`, `tone?: info\|warn\|ok\|bad` | one caveat that must not be missed |
| `text` | `body` | what no block above can say — briefly |

**Code is quoted, never written.** A `code` section names `file` (relative to the repository
root) and `line` (where the snippet starts), and every non-blank line of `code` must appear in
that file, in that order — `--phase` refuses the file otherwise. Copy from the file as it is on
the feature branch; leave out lines with a `// …` (or `# …`) line. `highlight` uses the file's
line numbers. The script records each line's real number in the file for the page.

## What each phase shows

| Phase | Sections | Decisions |
| --- | --- | --- |
| clarify | a `table` of in/out of scope; an `example` of the request as the user would live it | size and why |
| investigate | a `flow` of the code areas found (`changed` on those the feature will touch); a `table` of auto vs open items | every `AD-` (`auto`), every open item (`open`) |
| review-decisions | a `table` of each `AD-` and its verdict | each reviewed `AD-` |
| grill | a `table` question → answer | every `D-`, `DF-`, override |
| spec | an `example` per main FR (cases: happy path, refusal); a `table` of FRs → acceptance | choices the spec fixed |
| plan | a `flow` of the design; a `sequence` of the main path; a `table` of layers/seams | each design decision and what it beat |
| tickets | a `flow` of tickets by dependency (`group` = layer); a `table` ticket → tier → estimate | how the work was cut |
| **execute** | **the fullest**: a `flow` of what was built (`changed` marks), a `sequence` of the main path as implemented, 2–6 `code` sections with the rules that matter, an `example` with real input/output, a `files` block, a `callout` per caveat | deviations from the plan, escalations, rejections |
| qa | a `table` of scenarios and results; an `example` per defect found | the verdict and why |
| review | a `table` of findings by severity; `diff` for a fix that matters | each finding's resolution |
| docs-tech / docs-product | a `files` block of the pages written | what was documented where |
