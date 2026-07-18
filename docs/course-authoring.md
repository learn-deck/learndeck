# Course authoring and seeding standard

PatchQuest separates a reusable **course tracker** from replaceable **course
content**. The browser UI, SQLite store, and MCP need a predictable shape; a
manifest plus its sources define one course. The DDD course is a seed that
proves the format, not a special case in the runner.

```mermaid
flowchart LR
  A[Course author] --> T[templates/course.json]
  T --> M[courses/course-id.json]
  A --> D[Course sources: Markdown, links, or other evidence]
  M --> H[Learning paths]
  M --> S[Ordered sections]
  S --> Q[Diagnostic, exit, and review questions]
  M --> U[Bun UI]
  M --> P[PatchQuest MCP]
  D --> G[Agent guidance and evaluation]
  U --> L[Learner chooses course/path and submits answer]
  P --> G
  G --> DB[(Local SQLite progress)]
  L --> DB
  DB --> U
  DB --> P
```

The diagram makes the ownership boundary clear: authors can seed many courses;
learners own their answers and work; the UI and MCP share local progress but do
not own the learner's workspace.

## Required source files

| Source | Owns | Does not own |
| --- | --- | --- |
| `courses/<id>.json` | Ordered paths, sections, one action per section, question prompts, and source links. | Long explanations or hidden scoring rules. |
| Course-owned sources | Explanations, worked examples, actions, question rubrics, and later-review prompts. | Mutable learner progress. |
| `templates/course.json` | A minimal seed that becomes a new manifest with `bun run seed`. | A published course or learner data. |
| `.patchquest/progress.db` | Local paths, submissions, evaluations, reported evidence, and completion state. | Course truth; it is ignored and never committed. |

## Manifest shape

Every course manifest uses `schemaVersion: 1` and these top-level fields:

```json
{
  "schemaVersion": 1,
  "id": "short-course-id",
  "title": "Human course title",
  "description": "What the learner builds and learns.",
  "paths": [],
  "sections": []
}
```

### Paths

A path is a learner-selectable route through one course. It must specify a
stable `id` and visible `label`. `workspaceHint`, `serverCommand`, and
`testCommand` are optional and useful for coding courses. Commands are shown to
the learner; PatchQuest never runs them.

### Sections

A section must define:

- a stable `id` and short `title`;
- one learner-visible `goal`;
- one bounded `action` that can be done in a chosen workspace;
- one or more `sources` pointing to Markdown or primary references; and
- at least one question.

Keep sections ordered as the learner should take them. The runner treats a
correct exit question as completion, but an agent should also record the
learner's reported evidence before claiming real mastery.

### Questions

Every question has a stable `id`, `kind`, open `prompt`, and `reference`.
Allowed kinds are:

| Kind | When the UI asks it | What it establishes |
| --- | --- | --- |
| `diagnostic` | Before a learner studies or acts. | Existing knowledge; never completion. |
| `exit` | After the learner reports an action/evidence. | Source-closed explanation that can complete the section. |
| `review` | In a later session. | Durable recall of a related distinction. |

Questions must be answerable from the named source and should request a
decision, contrast, explanation, or evidence—not a keyword recital. Evaluation
feedback needs a target, observed answer, exact gap or confirmation, correction,
and next action. The database preserves each revision rather than overwriting
the original answer.

## New course checklist

1. Run `bun run seed -- <course-id> "Course title"` or copy
   `templates/course.json` into `courses/`.
2. Write or link the course source material and reference it from each manifest
   section.
3. Add no more than one bounded build action per section.
4. Add a diagnostic and exit question, plus a later review question where the
   distinction is important.
5. Restart `bun run app` and the MCP server, create a test path, submit an
   answer, and use MCP to record an evaluation.
6. Run `bun run verify` before sharing the course.

The DDD backend course is the included reference seed: its paths differ by
toolchain while its sections retain the same architectural decisions. A fork can
remove it entirely without changing the tracker.
