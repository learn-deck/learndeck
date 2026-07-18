# Local progress database

PatchQuest keeps a private local SQLite database at:

```text
<patchquest clone>/.patchquest/progress.db
```

The runner uses a single database with one path record per selected language and
workspace. This makes a Node, Go, and Bun implementation independent while
letting the browser UI and MCP agent see the same progress. Override the path
with `PATCHQUEST_DB_PATH` only when both processes use the same override.

## What PatchQuest stores

The Bun runner initializes the database on start. The learner creates a path in
the UI; the MCP agent reads and updates it through its tools.

| Record | Why it exists |
| --- | --- |
| Learning path | Selected language, workspace, label, and update time. |
| Section progress | Active/revision/complete state, reported evidence, and review prompt. |
| Question attempt | Exact submitted answer, confidence, source, agent feedback, and result. |
| Activity log | Learner, agent, or system action for a local audit trail. |

Each answer is a new attempt. A revision never overwrites a partial or
incorrect answer. The database helps a later agent resume honestly; it does not
semantically grade prose by itself.

## Inspect locally

```sh
sqlite3 .patchquest/progress.db \
  'SELECT section_id, status, updated_at FROM section_progress ORDER BY rowid;'
```

The database is ignored by Git. Do not commit it, copy it to a public issue, or
put credentials and private code in learner answers.
