# Contributing to PatchQuest

PatchQuest accepts focused improvements to the Bun runner, MCP integration,
course standard, DDD example, source references, and learner experience.

- Keep the UI local-only and preserve the separation between course content,
  learner workspace, and ignored progress data.
- Add a section through the manifest, Markdown module, and named sources
  together; do not add UI-only questions without evidence.
- Keep MCP writes narrow and learner-visible. MCP tools must not run learner
  code or access arbitrary paths.
- Preserve all three implementation paths unless a change is explicitly
  path-specific.
- Run `bun run verify` before proposing a change.
