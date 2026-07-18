# LearnDeck MCP integration

LearnDeck exposes one local stdio MCP server. It shares the same local SQLite
database as the UI, so an agent's evaluation is visible in the browser without
copying answers through chat.

## Connect from the app

Start `bun run app`, open the local URL, then press **Start Now**. LearnDeck
prepares the local course/progress space and offers every detected guide. Select
one or more guides, then explicitly connect them; detection is local-only and
does not launch an agent or read credentials. The explicit connection adds only
LearnDeck's `learndeck` MCP entry:

| Host | Detection | Explicit connection |
| --- | --- | --- |
| Codex | `codex` CLI, `Codex.app`, or `~/.codex/` | `codex mcp add learndeck -- <bun> <mcp.ts>` |
| Cursor | launcher, `Cursor.app`, or `~/.cursor/` | merges only `learndeck` into `~/.cursor/mcp.json` |
| Claude Code | `claude` CLI or its configuration | uses its user-scope stdio MCP command |

Restart the selected host after connecting. LearnDeck never overwrites another
MCP server, installs a host, starts a learner service, or executes learner code.
The learner may select a different connected guide later from **AI guides**.
All guides share the same local SQLite progress, so switching never loses
course state or answer history.

## Manual setup

For another MCP client, use its equivalent of:

```json
{
  "mcpServers": {
    "learndeck": {
      "command": "/absolute/path/to/bun",
      "args": ["/absolute/path/to/learndeck/src/mcp.ts"]
    }
  }
}
```

Set `LEARNDECK_DB_PATH` in both the UI and MCP process only when they must use
a non-default shared database. `PATCHQUEST_DB_PATH` remains a temporary alias
for existing local runs.

## Tools

| Tool | Purpose |
| --- | --- |
| `learndeck_list_courses` | List locally loaded Markdown course packs before selection. |
| `learndeck_get_course` | Read a course's runtime, ordered modules, actions, questions, and sources. |
| `learndeck_list_paths` | Read existing local learning records for one course. |
| `learndeck_create_path` | Create a local learning record after the learner confirms a workspace. |
| `learndeck_get_progress` | Read section state, submissions, feedback, and completion count. |
| `learndeck_get_next_activity` | Return one next module/question. |
| `learndeck_record_evidence` | Store learner-reported code paths or command results. |
| `learndeck_evaluate_answer` | Evaluate exactly one answer submitted through the UI. |

## Required agent behavior

1. Read the course briefing and progress before teaching. For the bundled DDD
   course, resolve the declared Node.js + TypeScript runtime rather than asking
   the learner to choose a language.
2. Ask one bounded question or action at a time.
3. Direct answers to the browser UI; evaluate only attempts still marked
   `submitted`.
4. Be a Socratic tutor, not a ghostwriter. Use the named Markdown source and
   author-written question rubric when evaluating. Feedback states what is
   solid, the observed answer, exact gap or confirmation, one correction or
   next question, and a next action. The learner chooses whether to revise or
   continue.
5. Record only learner-reported evidence. Never install dependencies, run the
   learner server, execute submitted code, or inspect outside the confirmed
   workspace.
