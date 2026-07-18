# LearnDeck — your app for learning with AI

LearnDeck is a forkable, local app for learning with AI without outsourcing
your thinking. It pairs structured, project-based courses with the learner's
own workspace. An MCP-connected AI is a calm, Socratic guide: it asks the next
useful question, evaluates a visible answer against an author-written rubric,
and never writes the learner's solution for them. Answers, evidence, feedback,
and learning records stay in local SQLite.

The included **DDD and Hexagonal Architecture** pack is the v0.1 flagship:
six to eight hours of Node.js + TypeScript, structured into satisfying
45–60-minute building sessions. It is the first focused developer course, not
the limit of the app. The format remains course-agnostic while the default
catalogue grows deliberately and stays curated for quality. See the [product
position](docs/product-positioning.md) and [catalogue quality
rubric](docs/catalogue-quality-rubric.md).

## Run locally

Requires Bun 1.3 or newer.

```sh
bun install
bun run app
```

Open [http://127.0.0.1:3030](http://127.0.0.1:3030). LearnDeck creates local
progress at `.learndeck/progress.db`; set `LEARNDECK_DB_PATH` to use a separate
database. It loads direct child course packs from `courses/`; set
`LEARNDECK_COURSES_DIR` to load a local fork's packs elsewhere.

To use the public Markdown course catalogue, copy the release configuration
before starting the app:

```sh
cp .env.example .env
bun run app
```

LearnDeck downloads only Markdown under `courses/` and `references/` into its
local cache when the learner clicks **Start Now**, then uses that cache if the
public repository is temporarily unavailable. A fork can set a different
`LEARNDECK_COURSE_REPOSITORY=github:your-org/courses@main`; without one,
LearnDeck uses its bundled packs for development. See [public course
distribution](docs/public-course-distribution.md).

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
bun run seed -- testing-fundamentals "Testing Fundamentals"
```

This creates a Markdown-only course pack:

```text
courses/testing-fundamentals/
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
Zen Mode, section-based progress, and accessible source-rendered lesson blocks.
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

## Privacy and scope

The browser binds only to `127.0.0.1`. Progress, answers, workspace paths, and
reported evidence remain in the local database and are ignored by Git. See
[SECURITY.md](SECURITY.md).
