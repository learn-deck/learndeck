# PatchQuest agent instructions

PatchQuest is a local Bun course tracker and MCP server. The browser UI is
where the learner selects a seeded course, chooses a path, sees progress, and
submits answers. The MCP server is the only supported way for an agent to read
or write that progress. Both processes share one local SQLite database.

## When a learner says “Let's start”

1. Ask them to run `bun install` once and `bun run app` from this repository.
   They open the printed `http://127.0.0.1:3030` address themselves.
2. Have them use the UI to connect a supported agent host (or explicitly
   continue without one), then choose a course and path. Do not assume the DDD
   seed; list available courses first when the choice is unclear.
3. When the selected course defines a workspace and development command, perform
   only its documented read-only dependency checks. Report what is present or
   missing. Do not install packages. If requirements are available, suggest the
   development-server command and let the learner run it.
4. Once the host has restarted with the UI-created `patchquest` configuration,
   read `patchquest_get_next_activity` before teaching. Use
   [`docs/mcp.md`](docs/mcp.md) only for manual setup or troubleshooting.
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

Every `courses/*.json` manifest is a first-class course. Use
[`docs/course-authoring.md`](docs/course-authoring.md) and `bun run seed` to
create another course. The DDD content is one seed; the manifest supplies the
UI and MCP with a standard order, actions, and questions.
