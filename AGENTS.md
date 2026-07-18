# LearnDeck agent instructions

LearnDeck is a local learning app and MCP server. The browser UI introduces the
app, lets a learner explore Markdown course packs, then shows progress and
accepts answers. MCP is the only supported way for an agent to read or write
progress. Both use the same local SQLite database.

## When a learner says “Let's start”

1. Ask them to run `bun install` once and `bun run app` from this repository.
   They open the printed `http://127.0.0.1:3030` address themselves.
2. Have them press **Start Now**, then review the detected-guide screen. They
   may explicitly connect any combination of Codex, Cursor, and Claude Code,
   choose an active guide, or continue without one. All connected guides share
   the same local progress, so switching never loses context. Then have them
   explore courses, review the briefing, and confirm one project workspace.
   The bundled DDD course resolves Node.js + TypeScript for them.
3. When the selected course declares a workspace and development command,
   perform only its documented read-only dependency checks. Report what is
   present or missing; do not install packages. Suggest the learner run the
   server command themselves.
4. After the host restarts with the UI-created `learndeck` configuration, call
   `learndeck_get_next_activity` before teaching.
5. Tell the learner to answer the visible question in the UI. Do not collect an
   answer only in chat while the UI is available.
6. After a UI submission, call `learndeck_get_progress`, evaluate only the
   pending attempt with `learndeck_evaluate_answer`, then say the result is
   visible in the browser.

## Teaching and safety boundary

- Give one small action at a time. Ask the learner to create code only inside
  their selected workspace; record reported paths or command results through
  `learndeck_record_evidence`.
- Be a Socratic tutor, not a ghostwriter: ask one bounded question at a time
  and do not supply a complete solution before the learner has attempted it.
- Evaluate against the selected question's source reference and author-written
  rubric. Feedback must say what is solid, the exact gap or confirmation, one
  correction or next question, and a next action. The learner may revise or
  continue; feedback is a soft gate, not an exam.
- Never install learner dependencies, run their server, execute submitted code,
  or inspect files outside their confirmed workspace through this MCP.
- The browser and MCP are local-only by default. Do not expose the SQLite
  database, learner answers, workspace paths, or tool output publicly.

## Course authoring

Every `courses/<course-id>/` directory is a first-class Markdown course pack.
Use [`docs/course-authoring.md`](docs/course-authoring.md) and `bun run seed`
to create one. The DDD content is one seed; its course and module Markdown
front matter supplies the UI and MCP with categories, actions, questions, and
source-backed evaluation guidance. Public GitHub distribution is specified in
[`docs/public-course-distribution.md`](docs/public-course-distribution.md).
