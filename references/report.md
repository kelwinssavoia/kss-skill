# The phase report (DESIGN.md §25)

Every phase ends by explaining itself to a human: what it did and each decision it took or
recorded. You write **one JSON file** with the content; `report.mjs` validates it and rebuilds the
feature's interactive page `<features_root>/NNN-slug/report/index.html` — the track, each phase,
every decision searchable, and each phase's cost from `metrics.jsonl`. You never write HTML.

## When and how

At the end of the phase, **after its artifacts are final and before the commit**:

1. Write `<features_root>/NNN-slug/report/<phase>.json` — `<phase>` without the `kss-` prefix
   (`clarify`, `investigate`, `review-decisions`, `grill`, `spec`, `plan`, `tickets`, `execute`,
   `qa`, `review`, `docs-tech`, `docs-product`). Running a phase again overwrites its file.
2. Run `node .kss/scripts/report.mjs <features_root>/NNN-slug`. It prints
   `report: …/report/index.html (<n> phases)`. If it prints `report: <file>: <problem>` and exits 1,
   fix the file and run it again — never skip it.
3. The phase's commit already adds `<features_root>/NNN-slug`, so `report/` goes with it.

If `.kss/scripts/report.mjs` does not exist (a project set up before reports), skip the report
and print `Report: run kss-init to enable reports` in the summary instead of the `Report:` line.

## Language and tone

Write every string in `conversation_language` from `~/.kss/preferences.md` (absent: the language
the user writes in) — not `docs_language`. Set `"lang"` to it (`"pt-BR"`, `"en"`, `"es"`…).
Write for someone who did not watch the run: plain sentences, the reason behind each choice,
no internal jargon without a word of explanation. Identifiers (`FR-03`, `D-02`, paths) stay as
they are.

## The file

```json
{
  "phase": "grill",
  "lang": "pt-BR",
  "title": "Entrevista de decisões",
  "summary": "2–4 sentences: what this phase settled and why it matters for the feature.",
  "did": ["what was done, one line each — 3 to 8 lines"],
  "decisions": [
    {
      "id": "D-02",
      "title": "Who may upload the bank documents",
      "decision": "Owner and admins; every upload is audited.",
      "why": "Admins already change the deposit account today; blocking them would stall support.",
      "rejected": ["Owner only — admins would have to ask the owner"],
      "kind": "business",
      "status": "decided",
      "source": "02-decisions.md#d-02"
    }
  ],
  "highlights": [{ "group": "Requirements", "items": [{ "label": "FR-01", "text": "…" }] }],
  "open": ["DF-01 — retention period · owner: Ana · 2026-10-30"],
  "risks": ["What could still go wrong, one line each"],
  "artifacts": [{ "path": "02-decisions.md", "what": "the decisions, in full" }],
  "at": "<ISO-8601 now>"
}
```

Required: `phase` (equal to the file name), `lang`, `summary` (≤1500 characters), `did`
(non-empty, each ≤600 characters). Everything else is optional — leave out what the phase does
not have rather than writing an empty explanation.

- `decisions[].title` and `decisions[].decision` are required; `why`, `rejected`, `source`, `id`
  are what make the page useful — fill them whenever the artifacts have them. Do not invent a
  reason the artifacts do not give.
- `kind`: `business`, `layout`, `technical`, `scope`, `design`, `auto`, `review`, `execution`,
  `quality`. `status`: `decided`, `auto`, `accepted`, `overridden`, `reopened`, `deferred`,
  `open`, `rejected`.
- `artifacts[].path` is relative to the feature folder.
- Cost, the track and the Next line are **not** written by you: the script reads `metrics.jsonl`
  and the README.

## What each phase puts in it

| Phase | `decisions` | `highlights` |
| --- | --- | --- |
| clarify | size and why; scope in and out | goals, success criteria |
| investigate | every `AD-` (status `auto`) and every open item (status `open`) | layers and files the feature touches |
| review-decisions | each reviewed `AD-`: `accepted`, `overridden` or `reopened` | — |
| grill | every `D-` (`decided`), every `DF-` (`deferred`), every override | terms added, ADRs |
| spec | the choices the spec fixed that the decisions did not | FRs and NFRs, one line each |
| plan | each design decision and the alternative it beat | layers, seams, migrations |
| tickets | how the work was cut, tiers chosen | tickets with tier and dependencies |
| execute | deviations from the plan, escalations, rejections and how they ended | tickets integrated, files changed |
| qa | the verdict and why | scenarios with their result, problems found |
| review | each finding's resolution | findings by severity |
| docs-tech / docs-product | what was documented where | pages written or updated |

Keep it to what a reader needs: a decision per real fork, not one per line of the artifact.
