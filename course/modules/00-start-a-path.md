# 00 · Start a path

## Outcome

I can name my language path, keep my course code in one workspace, record local
progress, and expose one minimal development surface.

## Diagnostic question

Before reading the setup reference: why should the course repository and the
application workspace be different folders? Include one risk that separation
avoids.

## Build one visible base

1. Confirm the language and absolute workspace path with the agent.
2. Follow only that path's dependency checks in
   [`references/language-paths.md`](../../references/language-paths.md).
3. Initialise the workspace's `.patchquest/progress.db` using
   [`references/progress-database.md`](../../references/progress-database.md).
4. Ask the agent to record the proposed project structure before creating it.
   Keep application code under a clear root such as `src/` (Node or Bun) or
   `cmd/` plus `internal/` (Go).
5. Create the smallest development surface: one health/status route and, if
   useful, a tiny browser page or plain response that makes the route visible.
   Keep it deliberately boring.
6. Run the appropriate development command yourself when the agent suggests
   it, then record the command, result, and paths you created.

## Exit question

State your language, workspace path, progress-database path, and development
command. Why is that database allowed in the workspace but not in the course
repository?

## Later review

From memory, sketch the course folder versus workspace folder boundary and name
two things that must never be committed to the course.
