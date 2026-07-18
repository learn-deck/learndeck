# Contributing to PatchQuest

PatchQuest accepts focused improvements to the Bun tracker, MCP integration,
course standard, seed templates, source references, and learner experience.

- Keep the UI local-only and preserve the separation between course content,
  learner workspace, and ignored progress data.
- Keep the tracker course-agnostic. Add or change a course through its manifest
  and named sources together; do not add UI-only questions without evidence.
- Keep MCP writes narrow and learner-visible. MCP tools must not run learner
  code or access arbitrary paths.
- Preserve the DDD seed's three implementation paths unless a change is
  explicitly path-specific; other courses may define their own paths.
- Run `bun run verify` before proposing a change.
