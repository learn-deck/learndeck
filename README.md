# LearnDeck — your app for learning with AI

LearnDeck is a forkable, local app for learning with AI without outsourcing
your thinking. It pairs structured, project-based courses with the learner's
own workspace. An MCP-connected AI is a calm, Socratic guide: it asks the next
useful question, evaluates a visible answer against an author-written rubric,
and never writes the learner's solution for them. Answers, evidence, feedback,
and learning records stay in local SQLite.

Courses live in the public catalogue at
[learn-deck/courses](https://github.com/learn-deck/courses) and sync into the
app; the v0.1 flagship is **DDD and Hexagonal Architecture** — six to eight
hours of Node.js + TypeScript in satisfying 45–60-minute building sessions.
This repository bundles only a small [format example
pack](courses/example-course/course.md) for documentation and development.
The format remains course-agnostic while the default catalogue grows
deliberately and stays curated for quality. See the [product
position](docs/product-positioning.md) and [catalogue quality
rubric](docs/catalogue-quality-rubric.md).

## Run locally

Requires Bun 1.3 or newer. Check your version first:

```sh
bun --version
```

From this clone, install dependencies and start the app:

```sh
bun install
bun run app
```

If startup reports `EADDRINUSE` or that port `3030` is already in use, stop the
other LearnDeck process, or run `PORT=3031 bun run app` and open the URL
LearnDeck prints.

Open [http://127.0.0.1:3030](http://127.0.0.1:3030). LearnDeck creates local
progress at `.learndeck/progress.db`. Set `LEARNDECK_DB_PATH` to use a separate
database.

## What stays local

- Progress is SQLite at `.learndeck/progress.db`; `LEARNDECK_DB_PATH` overrides it.
- Connecting Codex targets `~/.codex/config.toml`, Cursor targets `~/.cursor/mcp.json`, and Claude Code targets `~/.claude.json`.
- A connection adds exactly one `learndeck` MCP entry to the selected guide. Disconnect removes only that entry through `DELETE /api/integrations/:id/connect`.
- Per-path progress can be exported with `GET /api/paths/:id/export` or reset with `DELETE /api/paths/:id`.

The primary catalogue is the public GitHub course repository; while no
repository is configured, only the bundled `example-course` format pack
loads, which keeps development working offline. To select the public catalogue, copy the release
configuration before `bun run app`:

```sh
cp .env.example .env
```

The release configuration selects `github:learn-deck/courses@main`. When the
learner clicks **Start Now**, LearnDeck syncs only Markdown under `courses/`
and `references/` into its local cache. If GitHub is unavailable, it uses the
last complete cache. A fork can set a different
`LEARNDECK_COURSE_REPOSITORY=github:your-org/courses@main`. To publish a
course of your own, follow [public course
distribution](docs/public-course-distribution.md); for failures, see
[troubleshooting](docs/troubleshooting.md).

On first launch, LearnDeck:

1. detects **Codex**, **Cursor**, and **Claude Code** locally without launching
   them or reading credentials;
2. lets the learner choose any detected Codex, Cursor, and Claude Code hosts,
   adding only LearnDeck's own MCP entry to those selected and asking for a
   restart;
3. lets the learner choose an active guide and switch among connected guides
   without losing local progress;
4. introduces the app, lets the learner explore courses by category, and makes
   each course's time, level, and outcome visible before entry;
5. asks only for the learner's project workspace after they choose a course;
   and
6. displays the next action, sources, questions, answer history, and
   source-linked agent feedback.

Connection is opt-in. The app never installs an agent, starts a learner's
server, runs submitted code, or changes unrelated MCP servers.

## Add a course

```sh
bun run seed -- api-design-basics "API Design Basics"
```

This creates a Markdown-only course pack (seeding fails if the course ID
already exists, so pick a new one):

```text
courses/api-design-basics/
  course.md
  modules/00-orient.md
```

`course.md` contains course identity, category, tags, duration, outcomes,
prerequisites, and the runtime the app resolves for the learner. Each ordered
Markdown module contains its goal, bounded action, source links, questions, and
author-written evaluation rubrics in YAML front matter plus learner-facing
Markdown. The loader validates local source links are real `.md` files. See
[the course-pack standard](docs/course-authoring.md) for the diagram, contract,
and authoring checklist.

The browser UI is a dark-first learning environment with local theme preference,
Focus Mode, section-based progress, and accessible source-rendered lesson blocks.
Its maintainable design rules live in [the UI system](docs/ui-system.md).

## Agent integration

LearnDeck exposes one local stdio MCP server. Use the app's **Connect** button
for Codex, Cursor, or Claude Code. Another compatible host can use the
equivalent of:

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

The documented tools list courses, paths, progress, the next activity, reported
evidence, and submitted-answer evaluation. See [MCP integration](docs/mcp.md).

## Verify

```sh
bun run verify
```

## Optional: a local macOS app

On macOS you can build a double-clickable LearnDeck.app for your own machine.
It needs `swiftc` (Xcode Command Line Tools) and Bun:

```sh
bash scripts/package-macos.sh
open dist/LearnDeck.app
```

The script compiles the server into a standalone binary, stages `public/`,
`courses/`, and `references/` inside the bundle, and compiles a native
AppKit/WKWebView shell (`native/macos/LearnDeckApp.swift`). Launching the app
starts the server on a free local port and opens a native window; quitting the
app stops the server. The app's data lives outside the bundle at
`~/Library/Application Support/LearnDeck/` (`progress.db`, `course-cache/`,
and `server.log`), so rebuilds never touch progress.

This is developer tooling, not a distribution channel: the app is unsigned and
not notarized, and the supported install remains cloning the repository. One
known limitation: connecting an AI guide from the packaged app writes an MCP
entry that points at this repository checkout, so keep the clone in place or
reconnect after moving it.

## Privacy and scope

The browser binds only to `127.0.0.1`. Progress, answers, workspace paths, and
reported evidence remain in the local database and are ignored by Git. By
default, that database and the public-course cache live under `.learndeck/`;
the packaged macOS app keeps them under
`~/Library/Application Support/LearnDeck/` instead. See the [local progress
database](references/progress-database.md) and [SECURITY.md](SECURITY.md).
