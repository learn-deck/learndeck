# Contributing to LearnDeck

LearnDeck accepts focused improvements to the Bun tracker, MCP integration,
course standard, seed templates, source references, and learner experience.

## Where things go

- Bugs and scoped work → open an issue.
- Course ideas and learner stories → [GitHub Discussions](https://github.com/learn-deck/learndeck/discussions).
- Course submissions → a pull request against the [course authoring standard](docs/course-authoring.md).
- Security reports → follow [SECURITY.md](SECURITY.md).

- Keep the UI local-only and preserve the separation between course content,
  learner workspace, and ignored progress data.
- Keep the tracker course-agnostic. Add or change a course through its manifest
  and named sources together; do not add UI-only questions without evidence.
- The default catalogue is curated and project-based. Before proposing a public
  pack, meet the [catalogue quality rubric](docs/catalogue-quality-rubric.md):
  truthful outcomes, one working project, source-backed questions, and an
  author-written rubric for each question.
- Keep MCP writes narrow and learner-visible. MCP tools must not run learner
  code or access arbitrary paths.
- Keep AI guidance Socratic: it may clarify, question, and evaluate, but must
  not replace the learner's reasoning or write their solution.
- Preserve the DDD seed's single Node.js + TypeScript path unless a change is
  explicitly path-specific; other courses may define their own paths.
- Run `bun run verify` before proposing a change.
