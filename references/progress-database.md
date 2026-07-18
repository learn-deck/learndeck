# Local progress database

LearnDeck keeps a private local SQLite database at:

```text
<learndeck clone>/.learndeck/progress.db
```

The packaged macOS app uses
`~/Library/Application Support/LearnDeck/progress.db` instead, so rebuilding
the app never touches progress.

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
| Section progress | Section state — `not_started`, `active`, `revision`, `self_reviewed`, or `complete` — with the latest evidence and review prompt. |
| Question attempt | Exact submitted answer, confidence, source, feedback, and result (`submitted`, `correct`, `partial`, `incorrect`, or `self_reviewed`). |
| Evidence | Every learner- or guide-reported note, with its optional file or command reference and who recorded it. |
| Activity log | Learner, agent, or system action for a local audit trail. |

Each answer is a new attempt. A revision never overwrites a partial or
incorrect answer, and evidence records are additive. The database helps a
later agent resume honestly; it does not semantically grade prose by itself.

Per-path progress can be exported as JSON with `GET /api/paths/:id/export` or
reset with `DELETE /api/paths/:id`; the browser exposes both as Export
progress and Reset path.

## Inspect locally

```sh
sqlite3 .learndeck/progress.db \
  'SELECT section_id, status, updated_at FROM section_progress ORDER BY rowid;'
```

The database is ignored by Git. Do not commit it, copy it to a public issue, or
put credentials and private code in learner answers.
