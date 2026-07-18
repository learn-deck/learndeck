# MCP integration

PatchQuest uses a local stdio MCP server. It shares the same
`.patchquest/progress.db` as the browser UI, so an agent's evaluation appears in
the learner's current page without copying answers through chat. The server
loads every manifest in `courses/`, making the MCP course-agnostic.

## Connect

Start the server through the agent host, not manually in a terminal. The host
owns the stdio process and completes the MCP handshake.

```json
{
  "mcpServers": {
    "patchquest": {
      "command": "bun",
      "args": ["run", "mcp"],
      "cwd": "/absolute/path/to/patchquest"
    }
  }
}
```

Replace `cwd` with the clone's absolute path. Set `PATCHQUEST_DB_PATH` in the
MCP server environment only when it must use a non-default database; the UI and
MCP must use exactly the same path.

## Tools

| Tool | Purpose |
| --- | --- |
| `patchquest_list_courses` | List locally seeded courses before choosing one. |
| `patchquest_get_course` | Read one course's paths, ordered sections, actions, questions, and source references. |
| `patchquest_list_paths` | See a learner's existing paths for the selected course. |
| `patchquest_create_path` | Create a path only after the learner chooses its course, path, and workspace/context in the UI. |
| `patchquest_get_progress` | Read section status, pending submissions, feedback, and completed count. |
| `patchquest_get_next_activity` | Get one next section/question instead of dumping the whole course. |
| `patchquest_record_evidence` | Record a learner-reported path, command result, or other evidence. |
| `patchquest_evaluate_answer` | Evaluate one UI-submitted answer with source-linked feedback. |

## Interaction contract

1. The agent calls `patchquest_list_courses`; the learner chooses a course and
   path in the browser.
2. For a coding course that declares commands, the agent runs only its named
   read-only checks, reports the result, and suggests—not starts—the learner's
   development command.
3. The agent reads the next activity through MCP and guides one small action.
4. The learner submits their answer in the browser.
5. The agent reads the submitted attempt, evaluates it using the named source,
   and calls `patchquest_evaluate_answer`.
6. The learner sees the feedback and status in the browser. A partial or
   incorrect answer remains part of the record; the learner submits a revision.

PatchQuest's stdio transport follows the MCP tool model: a host discovers tools
with `tools/list` and invokes them with `tools/call`. Tools use validated input
schemas and report execution problems as actionable tool results. See the
[MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

## Boundaries

The server is intentionally local and does not run user code, inspect a
workspace, install packages, or expose an HTTP MCP endpoint. Agent hosts should
show the learner which tool calls are being made and retain normal confirmation
controls for writes.
