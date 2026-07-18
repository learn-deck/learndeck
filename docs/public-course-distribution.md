# Public Markdown course distribution

LearnDeck separates the app from course truth. The app is an open-source Bun
application; public courses live in a second repository that contains only
Markdown content and references. This lets educators fork, review, and publish
courses without changing application code.

```mermaid
flowchart LR
  A[learn-deck/learndeck] -->|loads| B[github:learn-deck/courses@main]
  B --> C[courses/<id>/course.md]
  B --> D[courses/<id>/modules/*.md]
  B --> E[references/*.md]
  C --> F[LearnDeck local cache]
  D --> F
  E --> F
  F --> G[Course library and learning UI]
  F --> H[Local MCP]
```

## Course repository contract

The public repository is intentionally Markdown-only:

```text
README.md
LICENSE.md
courses/
  ddd-backend-foundations/
    course.md
    modules/
      00-start.md
      ...
references/
  source-index.md
```

Only files under `courses/` and `references/` ending in `.md` are synced. A
course pack must still meet the standard in
[course-authoring.md](course-authoring.md): `course.md`, ordered Markdown
modules, Markdown-local references, and source-backed questions with
author-written rubrics. Inclusion in LearnDeck's default catalogue additionally
requires the [catalogue quality rubric](catalogue-quality-rubric.md).

## Configure a public source

The app receives a public GitHub source with one explicit environment value:

```sh
LEARNDECK_COURSE_REPOSITORY=github:your-org/courses@main bun run app
```

On the learner's **Start Now** action, LearnDeck reads the repository tree,
downloads only allowed Markdown files to `.learndeck/course-cache/`, and loads
the cache. It replaces the cache only after a full sync succeeds. If GitHub
cannot be reached later, the last complete local cache remains available. If no
repository is configured, LearnDeck uses bundled local packs for development.

The release `.env.example` points to `github:learn-deck/courses@main`; copy it
to `.env` for the default public catalogue. A fork may replace that value with
its own public Markdown repository.

The source is public, but learner progress is never placed in it. Answers,
evidence, workspaces, and agent feedback remain in the separate local progress
database.

## Open-source release shape

Create two public repositories under the `learndeck` GitHub organisation:

| Repository | Responsibility |
| --- | --- |
| `learn-deck/learndeck` | Bun server, local UI, MCP, SQLite progress, templates, and documentation. |
| `learn-deck/courses` | Markdown-only public course packs and references. |

Keep the same Apache-2.0 license in both repositories as Markdown (`LICENSE.md`)
if the course repository must remain strictly Markdown-only. Add contribution
guidelines in Markdown and require a local LearnDeck verification run before a
course pull request is merged.

## Human-centred product checks

The app home should make these facts clear before someone starts:

1. What LearnDeck is and what stays on their machine.
2. What each course will help them do, how long it takes, and who it suits.
3. That an AI guide is optional and precisely what connecting it changes.
4. That choosing a course is reversible; their progress remains tied to their
   confirmed workspace.

This applies human-centred design as a working product discipline: begin with
people's context, make uncertainty legible, prototype small decisions, and use
feedback to improve the next iteration. The approach draws on [IDEO U’s
human-centred design overview](https://www.ideou.com/en-gb/blogs/inspiration/what-is-human-centered-design).
