# Course pack checklist

A quick reference for authors. The loader enforces the structural rules; the
[catalogue quality rubric](../../../docs/catalogue-quality-rubric.md) governs
what the public catalogue accepts.

## course.md front matter

- `schemaVersion: 1` — the parser format, not your content version.
- `id` — must equal the directory name. Permanent.
- `title`, `description`, `category` — non-empty strings.
- `overview` — `duration`, `sessionLength`, `level`, `outcomes[]`,
  `prerequisites[]`. Keep durations honest.
- `paths[]` — at least one entry; the public catalogue expects one path with
  `id`, `label`, `serverCommand`, `testCommand`, and `workspaceHint` all set.

## Module front matter

- `id` — unique within the course, permanent, decoupled from the filename.
- `title`, `goal`, `action` — non-empty strings; the action must be
  observable.
- `sources[]` — local Markdown paths that exist.
- `questions[]` — unique `id`, a `kind` of `diagnostic`, `review`, or
  `exit`, a `prompt`, a local `reference`, and a `rubric` list.

## Boundaries

- The pack holds instruction; the learner's workspace holds their work.
- Learner answers, evidence, feedback, and progress live in the learner's
  local database — never in the pack.
- Only a correct `exit` evaluation (or the learner's explicit self-review)
  moves a section forward; nothing else may downgrade completed progress.
