# PatchQuest: local course tracker with UI and MCP

PatchQuest is a small, forkable course tracker. It loads one or more JSON course
manifests, lets a learner choose a course and path in a browser, and stores
answers, evidence, feedback, and completion locally in SQLite. A coding agent
uses MCP to guide the learner and evaluate only the answers submitted in the UI.

The included **DDD and Hexagonal Architecture** course is a seed: a working
example of the manifest format, not the product's sole purpose. Replace it or
add courses for any subject with the same tracker, UI, and MCP.

## Run locally

Requires Bun 1.3 or newer.

```sh
bun install
bun run dev
```

Open [http://127.0.0.1:3030](http://127.0.0.1:3030). PatchQuest creates one
local SQLite database at `.patchquest/progress.db` by default. Override its
location with `PATCHQUEST_DB_PATH` when you need a separate database, for
example for a workshop or test run. Courses load from `courses/`; set
`PATCHQUEST_COURSES_DIR` when a fork keeps manifests elsewhere.

The UI lets a learner:

1. choose a seeded course, then a learning path and workspace/context;
2. see every course section and path-specific progress;
3. read the current action and its sources;
4. submit a diagnostic, exit, or review answer with confidence; and
5. see source-linked agent feedback after evaluation.

Courses may optionally declare development and test commands. When a course
does, the agent can run only its stated read-only checks, report what is
available, and suggest the learner's command. It never installs dependencies or
starts a learner server without approval.

## Seed or add a course

Fork this repository, then create a new manifest from the generic seed:

```sh
bun run seed -- testing-fundamentals "Testing Fundamentals"
```

Edit the generated `courses/testing-fundamentals.json`, add its source material,
and restart the UI and MCP server. The complete contract and diagram are in
[Course authoring](docs/course-authoring.md). The shipped DDD example is
[`courses/ddd-backend-foundations.json`](courses/ddd-backend-foundations.json).

## Connect a coding agent

PatchQuest exposes a stdio MCP server:

```sh
bun run mcp
```

Configure the command in your agent host as described in
[MCP integration](docs/mcp.md). The MCP exposes deterministic tools to read the
course, create/select a path, retrieve progress, record reported evidence, and
evaluate a submitted answer. It never starts the learner's service or executes
their code.

## MCP capabilities

The MCP exposes deterministic course, path, progress, evidence, and evaluation
tools; see [MCP integration](docs/mcp.md). It never starts the learner's service
or executes their code.

## Verify

```sh
bun run verify
```

This runs the local store/API tests and builds the Bun server plus MCP entry
points.

## Privacy and scope

PatchQuest binds only to `127.0.0.1`. Progress, answers, and workspace paths
stay in the local SQLite database and are ignored by Git. See
[SECURITY.md](SECURITY.md) for the operational boundary.
