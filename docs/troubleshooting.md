# Troubleshooting

## Bun is missing or too old

**Symptom:** `bun --version` fails, or reports a version below `1.3`.

**Cause:** LearnDeck requires Bun `>=1.3`, as declared in `package.json`.

**Fix:** Install or update Bun to version 1.3 or newer, then verify it with:

```sh
bun --version
```

From the LearnDeck clone, run:

```sh
bun install
bun run app
```

This repository does not define a separate Bun installation command.

## Port 3030 is already in use

**Symptom:** Startup reports `EADDRINUSE` or that port `3030` is already in use.

**Cause:** `src/server.ts` binds to `127.0.0.1:3030` by default. It reads the
`PORT` environment variable when one is provided.

**Fix:** Stop the other LearnDeck process and start this one again. If both
must run, start LearnDeck on another port:

```sh
PORT=3031 bun run app
```

Then open [http://127.0.0.1:3031](http://127.0.0.1:3031). There is no separate
port configuration file.

## No AI guide is detected

**Symptom:** The setup screen says: “No supported guide is detected yet. You
can continue now and connect one later.”

**Cause:** Detection is local and checks the following signals in
`src/integrations.ts`:

- Codex: the `codex` executable, `Codex.app` in `/Applications` or
  `~/Applications` on macOS, the `~/.codex/` directory, or a configured
  `learndeck` server in `~/.codex/config.toml`.
- Cursor: the `cursor` or `cursor-agent` executable, `Cursor.app` in
  `/Applications` or `~/Applications` on macOS, the `~/.cursor/` directory,
  or a configured `learndeck` server in `~/.cursor/mcp.json`.
- Claude Code: the `claude` executable or a configured `learndeck` server in
  `~/.claude.json`.

Detection does not launch a guide or read its credentials. A configuration
file by itself is not enough for Claude Code; it must contain the LearnDeck
MCP entry.

**Fix:** Open the supported guide once or make its CLI available on `PATH`,
return to LearnDeck, and connect it from the detected-guide screen. You can
continue without a guide and connect one later.

## A guide is connected but the agent does not see LearnDeck MCP

**Symptom:** LearnDeck reports that the guide is ready, but the agent cannot
use the `learndeck` MCP server.

**Cause:** The connection adds LearnDeck's MCP entry to the selected host's
configuration, but the host must be restarted before it loads that entry.
The paths reported and used by `src/integrations.ts` are:

| Guide | Configuration file |
| --- | --- |
| Codex | `~/.codex/config.toml` |
| Claude Code | `~/.claude.json` |
| Cursor | `~/.cursor/mcp.json` |

Codex and Claude Code receive the entry through their CLI commands; Cursor's
JSON file is updated by merging only the `learndeck` entry. The MCP entry
points to this clone's `src/mcp.ts` and uses the running Bun executable.

To disconnect a guide, use the Disconnect control on the AI guides screen or
call `DELETE /api/integrations/:id/connect`. Either way LearnDeck removes only
its own `learndeck` entry, preserves other MCP entries, and names the config
file it changed.

**Fix:** Fully restart the selected Codex, Claude Code, or Cursor host, then
ask it to use LearnDeck. If it was not connected from the app, return to the
AI guides screen and connect it first.

## The workspace path is rejected

**Symptom:** Confirming a workspace fails with `workspacePath must be
absolute: ...`, `workspacePath parent does not exist ...`, or `workspacePath
already exists but is not a directory: ...`.

**Cause:** When a learning path is created, `src/server.ts` requires an
absolute workspace path whose parent directory already exists. LearnDeck
creates the final folder itself when it is missing, but it never creates the
parent chain, and it refuses a path that points at an existing file.

**Fix:** Enter an absolute path (for example `/Users/you/projects/my-course`),
create the parent folder first if needed, and pick a path that is either free
or already a directory.

## A course pack fails to load

**Symptom:** Startup or **Start Now** reports an error such as `... must begin
with YAML front matter fenced by --- lines.`, `... needs a non-empty <field>.`,
`... references a missing Markdown source: ...`, `... is not a supported
LearnDeck course pack.`, or `No LearnDeck course packs found in ...`.

**Cause:** `src/course.ts` validates every pack when it loads: `course.md`
front matter must carry `schemaVersion: 1` and the required identity, overview,
and paths fields; every module needs front matter with `id`, `title`, `goal`,
`action`, `sources`, and at least one question; and every local source or
question reference must resolve to a real `.md` file relative to its module.
One invalid pack stops the whole catalogue from loading.

**Fix:** Read the error message — it names the file and field. Repair the pack
against [the course-pack standard](course-authoring.md), or remove the broken
folder from `courses/`, then restart the app so both the UI and MCP server
reload it.

## An answer cannot be evaluated or self-reviewed

**Symptom:** The agent's `learndeck_evaluate_answer` call, or the UI's
self-review action, fails with `Only submitted answers may be evaluated.` or
`Only submitted answers may be self-reviewed.`

**Cause:** Each attempt is evaluated at most once. Once its result is
`correct`, `partial`, `incorrect`, or `self_reviewed`, it can no longer be
evaluated or self-reviewed; a revision is a new attempt.

**Fix:** Submit a new answer in the browser and evaluate that attempt. Nothing
is lost — earlier attempts and their feedback stay in the answer history.

## GitHub course sync is unavailable or offline

**Symptom:** Starting the app reports a public repository error such as
`Could not read public course repository ...`, or the course library cannot be
prepared after **Start Now**.

**Cause:** When `LEARNDECK_COURSE_REPOSITORY` is set, LearnDeck reads the GitHub
tree and downloads the allowed Markdown files. It replaces the cache only
after a complete sync succeeds. If the sync fails and a complete local cache
already exists, `src/course.ts` loads that cache instead.

**Fix:** Check that the repository value uses the verified form
`github:owner/repository@branch` and restore access to GitHub, then start the
app and click **Start Now** again. For the release value in `.env.example`,
the default cache is:

```text
.learndeck/course-cache/learn-deck-courses-main/courses/
```

The fallback is the last complete local cache. If no complete cache exists,
the configured public catalogue cannot be loaded while GitHub is unavailable.

## Resetting or exporting local progress

**Symptom:** You need to back up the learning record, or start again with no
saved paths, answers, feedback, or evidence.

**Cause:** By default, the SQLite database is:

```text
.learndeck/progress.db
```

It contains learning paths, section progress, question attempts, and the
activity log. It does not contain the Markdown course packs. If
`LEARNDECK_DB_PATH` is set, that configured path is the database instead; the
UI and MCP process must use the same override.

**Fix:** The local server exposes per-path progress operations:

- `GET /api/paths/:id/export` returns that path's JSON export as a download.
- `DELETE /api/paths/:id` resets that path, including its attempts, evidence,
  and progress rows.

The browser exposes both as Export progress and Reset path controls on the
course surface; the API routes above do the same thing directly. For a full
manual backup, stop the app and copy
the database file to a safe location. To reset all local progress, stop the app
and delete `.learndeck/progress.db`; the next start creates a new empty
database. Deleting it removes all local learning paths, section progress,
question attempts, and activity-log records. Do not delete the file while the
app is running.

## The macOS app does not build or start

**Symptom:** `scripts/package-macos.sh` exits with `swiftc not found` or
`bun not found`, or the built `LearnDeck.app` shows a "LearnDeck could not
start" alert.

**Cause:** The packaging script requires macOS with the Xcode Command Line
Tools (`swiftc`) and Bun on `PATH`. The built app starts the compiled server
on a free local port and waits up to 20 seconds for `/` to answer HTTP 200; if
that fails, it shows the alert and quits.

**Fix:** Install the missing tool (`xcode-select --install` for `swiftc`) and
rebuild with `bash scripts/package-macos.sh`. For a startup alert, read the
server log the alert names:

```text
~/Library/Application Support/LearnDeck/server.log
```

The app's database and course cache also live in that folder (`progress.db`
and `course-cache/`), outside the bundle, so rebuilding or deleting
`dist/LearnDeck.app` never touches progress.

## Connecting a guide from the macOS app stops working

**Symptom:** A guide connected from `LearnDeck.app` reports a `stale` LearnDeck
entry, or the agent cannot start the `learndeck` MCP server.

**Cause:** The packaged app bakes the repository path into its
`Contents/Info.plist` (`LearnDeckRoot`) at build time. The MCP entry it writes
points at that checkout's `src/mcp.ts`, which also needs the repository's
installed dependencies. Moving or deleting the clone breaks the entry.

**Fix:** Keep the clone where it was when you built the app, or rebuild the
app from the repository's new location and reconnect the guide so the entry is
repaired.
