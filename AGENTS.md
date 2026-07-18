# PatchQuest agent instructions

PatchQuest is a local Bun course runner and an MCP server. The browser UI is
where the learner selects a language path, sees progress, and submits answers.
The MCP server is the only supported way for an agent to read or write that
progress. Both processes share one local SQLite database.

## When a learner says “Let's start”

1. Ask them to run `bun install` once and `bun run dev` from this repository.
   They open the printed `http://127.0.0.1:3030` address themselves.
2. Ask which path they want—**Node.js + TypeScript**, **Go**, or **Bun +
   TypeScript**—then have them create/select that path and workspace in the UI.
3. With the learner's workspace confirmed, perform only the matching read-only
   dependency checks in [`references/language-paths.md`](references/language-paths.md).
   Report what is present or missing. Do not install packages. If the required
   dependencies are available, suggest the path's development-server command
   and let the learner run it.
4. Connect through the `patchquest` MCP configuration in
   [`docs/mcp.md`](docs/mcp.md). Read `patchquest_get_next_activity` before
   teaching.
5. Tell the learner to answer the visible question in the UI. Do not collect an
   answer only in chat when the UI is available.
6. After a UI submission, call `patchquest_get_progress`, evaluate only the
   pending attempt with `patchquest_evaluate_answer`, then tell the learner the
   result is visible in the browser.

## Teaching and safety boundary

- Give one small action at a time. Ask the learner to create code only inside
  their selected workspace; record reported paths or command results through
  `patchquest_record_evidence`.
- Evaluate against the selected question's source reference. Feedback must say
  the target, observed answer, exact gap or confirmation, one correction, and a
  next action.
- Only evaluate an attempt that is still `submitted`. A partial or incorrect
  answer stays visible and requires a new submitted revision.
- Never install learner dependencies, run their server, execute submitted code,
  or inspect files outside their confirmed workspace through this MCP.
- The browser and MCP are local-only by default. Do not expose their SQLite
  database, learner answers, workspace paths, or tool output publicly.

## Course authoring

The canonical structured course is `course/ddd-course.json`. Use
[`docs/course-authoring.md`](docs/course-authoring.md) to create another course
or adapt the DDD example. The Markdown modules and references remain the
evidence sources; the manifest supplies the UI and MCP with a standard order,
actions, and questions.
