# Per-workspace progress database

PatchQuest keeps one private SQLite database **per learner workspace**:

```text
<workspace>/.patchquest/progress.db
```

The course repository stays Markdown-only. Never put progress in the course
clone, share it across language paths, or commit it to a learner project.

## Initialise after the learner confirms the path

First check that SQLite is available:

```sh
sqlite3 --version
```

Then the agent may create the directory and initialise the database in the
confirmed workspace. It must set `workspace_path` to the absolute path and
`language` to `node`, `go`, or `bun`.

```sh
mkdir -p "$WORKSPACE/.patchquest"
sqlite3 "$WORKSPACE/.patchquest/progress.db" <<'SQL'
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  note TEXT
);
CREATE TABLE IF NOT EXISTS steps (
  step_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('not_started','active','revision','complete')),
  started_at TEXT,
  completed_at TEXT,
  next_action TEXT,
  review_question TEXT
);
CREATE TABLE IF NOT EXISTS question_attempts (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  step_id TEXT NOT NULL REFERENCES steps(step_id),
  kind TEXT NOT NULL CHECK (kind IN ('diagnostic','exit','review','revision')),
  prompt TEXT NOT NULL,
  answer TEXT NOT NULL,
  confidence INTEGER CHECK (confidence BETWEEN 0 AND 100),
  result TEXT NOT NULL CHECK (result IN ('correct','partial','incorrect')),
  feedback TEXT NOT NULL,
  source_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  step_id TEXT NOT NULL REFERENCES steps(step_id),
  path TEXT NOT NULL,
  purpose TEXT NOT NULL,
  evidence TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS commands_run (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  step_id TEXT NOT NULL REFERENCES steps(step_id),
  command TEXT NOT NULL,
  result_summary TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
SQL
```

## Minimum records

The agent writes or updates these keys in `meta`:

| Key | Value |
| --- | --- |
| `workspace_path` | Confirmed absolute workspace path |
| `language` | `node`, `go`, or `bun` |
| `course_version` | Current course revision or `markdown-only-v1` |
| `current_step` | The one active step ID |

Every learner answer is a new `question_attempts` row. A revision never
overwrites an incorrect answer. Every requested code or documentation path is
an `artifacts` row, and every learner-reported command is a `commands_run` row.
This makes progress inspectable without pretending that a database can judge
semantic correctness on its own.

## Resume

At the next session, the agent opens only the confirmed workspace database:

```sh
sqlite3 "$WORKSPACE/.patchquest/progress.db" \
  'SELECT step_id, status, next_action, review_question FROM steps ORDER BY started_at;'
```

Resume an `active` or `revision` step first. If none exists, ask the stored
review question for the most recently completed step before beginning the next
module. The agent evaluates that answer against the named Markdown source and
stores it as a new attempt.
