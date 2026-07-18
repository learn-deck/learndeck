# Local progress database

LearnDeck keeps a private local SQLite database at:

```text
<learndeck clone>/.learndeck/progress.db
```

The runner uses a single database with one learning record per confirmed
workspace. This lets the browser UI and MCP agent see the same progress while
keeping attempts from separate backend projects apart. Override the path with
`LEARNDECK_DB_PATH` only when both processes use the same override.

## What LearnDeck stores

The Bun runner initializes the database on start. The learner confirms a
project workspace in the UI; the MCP agent reads and updates its learning
record through its tools.

| Record | Why it exists |
| --- | --- |
| Learning record | Course runtime, project workspace, label, and update time. |
| Section progress | Active/revision/complete state, reported evidence, and review prompt. |
| Question attempt | Exact submitted answer, confidence, source, agent feedback, and result. |
| Activity log | Learner, agent, or system action for a local audit trail. |

Each answer is a new attempt. A revision never overwrites a partial or
incorrect answer. The database helps a later agent resume honestly; it does not
semantically grade prose by itself.

## Inspect locally

```sh
sqlite3 .learndeck/progress.db \
  'SELECT section_id, status, updated_at FROM section_progress ORDER BY rowid;'
```

The database is ignored by Git. Do not commit it, copy it to a public issue, or
put credentials and private code in learner answers.
