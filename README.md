# PatchQuest: Self-Learn Backend Development with DDD and Hexagonal Architecture in Node.js, Go, and Bun

PatchQuest turns a structured course into a small local learning workspace. A
learner chooses **Node.js + TypeScript**, **Go**, or **Bun + TypeScript**, sees
their path and questions in a browser, and submits answers there. A coding agent
connects through MCP to guide the next action, record evidence, and evaluate
only the answers the learner has submitted.

The included example is **Self-Learn Backend Development: DDD and Hexagonal
Architecture**. It walks a single backend from domain model to a small runbook
without prescribing one framework or hiding the architecture behind a starter
repository.

## Run locally

Requires Bun 1.3 or newer.

```sh
bun install
bun run dev
```

Open [http://127.0.0.1:3030](http://127.0.0.1:3030). PatchQuest creates one
local SQLite database at `.patchquest/progress.db` by default. Override its
location with `PATCHQUEST_DB_PATH` when you need a separate database, for
example for a workshop or test run.

The UI lets a learner:

1. choose a language path and their code workspace;
2. see every course section and path-specific progress;
3. read the current action and its sources;
4. submit a diagnostic, exit, or review answer with confidence; and
5. see source-linked agent feedback after evaluation.

After the learner chooses a path, the agent runs only that path's read-only
dependency checks, reports what is present or missing, and suggests the
learner's development-server command. It never installs dependencies or starts
the learner's server without their approval.

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

## Create a course

The reusable course format, source responsibilities, and authoring flow are in
[Course authoring](docs/course-authoring.md). The DDD backend example lives in
[`course/ddd-course.json`](course/ddd-course.json); its explanations and
evidence sources stay in the Markdown modules and references.

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
