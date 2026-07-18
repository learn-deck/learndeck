# Node.js + TypeScript setup checks

This reference belongs to the bundled DDD Backend Foundations course. There is
one technical route through it: Node.js and TypeScript. LearnDeck or an AI
guide may check what is installed after you confirm a project folder, but they
do not install packages or start a server for you.

## Check the tools already available

Run these read-only checks in a terminal when an AI guide asks you to:

```sh
node --version
npm --version
test -f package.json && npm pkg get scripts
```

You need Node.js 22 or newer, npm, and a project `package.json`. If a project
already exists, check whether it has `dev` and `test` scripts. A missing tool or
script is a setup note to resolve deliberately, never an invitation for an
agent to silently change the stack.

## Install and run deliberately

If the project has a committed lockfile, `npm ci` is the reproducible install
command. If it has no lockfile yet, read the project instructions and decide
whether `npm install` is appropriate. Run either command yourself only after
you understand why it is needed.

When the project declares the scripts, you run:

```sh
npm run dev
npm test
```

Tell LearnDeck or your AI guide the command and result after you run it. The
progress record should describe what happened, not claim it happened.

## A small starting shape

The course uses this shape because it makes the dependency direction easy to
see, not because every application needs every folder on day one:

```text
<project>/
  src/
    domain/
    application/
    ports/
    adapters/
      http/
      persistence/
  test/
```

Start with the smallest useful subset. In the first lesson, empty folders and
a `GET /health` route are enough. The later lessons give each area a job.

## Development server rule

The server is your project, not LearnDeck. After the checks, the AI guide
suggests `npm run dev` and asks you to run it. It records your reported address
or result through LearnDeck MCP only after you report it. A health route is
enough initially; a browser page is optional and exists only to make behaviour
visible.
