# Public Markdown course distribution

LearnDeck separates the app from course truth. The app is an open-source Bun
application; public courses live in a second repository that contains only
Markdown content and references. This lets educators fork, review, and publish
courses without changing application code.

The GitHub-synced repository is the primary catalogue: when
`LEARNDECK_COURSE_REPOSITORY` is set, LearnDeck loads courses from it (or from
the last complete local cache when GitHub is unreachable). The Markdown packs
bundled in the app repository load only when no repository is configured — a
development fallback, not the catalogue.

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

## Contribute a course

The **Add your course** action on the courses page links to the public course
repository. To contribute a new pack:

1. **Fork the course repository** (`learn-deck/courses`, or the repository
   your fork of the app names in `LEARNDECK_COURSE_REPOSITORY`) on GitHub.
2. **Author the pack** as `courses/<course-id>/course.md` plus ordered
   `modules/*.md` files. Start from
   [`templates/course.md`](../templates/course.md) and
   [`templates/module.md`](../templates/module.md) — or run
   `bun run seed -- <course-id> "Course title"` in a LearnDeck clone and copy
   the seeded folder — then follow the
   [course-pack standard](course-authoring.md). Keep every local source a
   Markdown file under `courses/` or `references/`; nothing else is synced.
3. **Meet the [catalogue quality rubric](catalogue-quality-rubric.md)**:
   truthful outcomes, one working project, source-backed questions, and an
   author-written rubric for each question.
4. **Test against your fork.** Point a local LearnDeck at it and take one real
   path through the browser (and MCP, if a guide is connected):

   ```sh
   LEARNDECK_COURSE_REPOSITORY=github:your-user/courses@your-branch bun run app
   ```

   Loading fails loudly when front matter, sources, or rubrics are invalid, so
   a clean **Start Now** is the pack-level check.
5. **Open a pull request** against the course repository. A maintainer reviews
   it against the rubric before it joins the default catalogue.

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
