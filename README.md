# PatchQuest: Self-Learn Backend Development with DDD and Hexagonal Architecture in Node.js, Go, and Bun

PatchQuest is a Markdown-only course for learning to build a small backend
well: model the domain first, put infrastructure behind ports, test behaviour,
persist deliberately, and make the system observable. Choose one path—**Node.js
+ TypeScript**, **Go**, or **Bun + TypeScript**—and build the same ideas in your
own workspace.

There is deliberately no starter application, generated schema, lockfile, or
hidden test harness in this repository. The course provides references,
questions, and a local-agent protocol. Your code belongs in the workspace you
choose; the course tracks that path in a private local SQLite database.

## Start with a coding agent

Clone this repository, open it with a coding agent that reads `AGENTS.md`, and
say:

> Let's start.

The agent first asks you to choose **Node.js + TypeScript**, **Go**, or **Bun +
TypeScript**. It then confirms your code workspace, checks only that path’s
dependencies, creates or resumes `<workspace>/.patchquest/progress.db`, and
suggests the right development-server command for your project. It does not
install dependencies or start a server without your approval.

## The self-learn protocol

The course uses a short evidence-based loop:

1. Answer a small question from memory before reading the next source.
2. Read one compact reference or inspect one bounded code area.
3. Write, structure, run, or test one small piece in your chosen workspace.
4. Explain why it works, self-check it, and answer an exit question.
5. Receive source-linked feedback, revise if needed, and return later for a
   related recall question.

This is effective because retrieval exposes gaps that rereading can hide,
spaced revisits make knowledge more durable, worked examples can be faded as
knowledge grows, and specific feedback makes a correction actionable. Those
are design constraints, not a promise about anyone’s speed or retention; see
[the learning protocol](references/learning-protocol.md) and its primary
sources.

## Course map

| Step | Learn by doing | Questions included |
| --- | --- | --- |
| [00 · Start a path](course/modules/00-start-a-path.md) | Choose language, workspace, database, and a visible dev loop. | Setup and path questions |
| [01 · Model the domain](course/modules/01-model-the-domain.md) | Define language, use cases, and invariants before routes. | Ownership and invariant questions |
| [02 · Draw the hexagon](course/modules/02-draw-the-hexagon.md) | Separate domain, application, ports, and adapters. | Dependency-direction questions |
| [03 · Make an API useful](course/modules/03-make-an-api-useful.md) | Build one thin endpoint and a minimal visible status surface. | Boundary and error questions |
| [04 · Persist through a port](course/modules/04-persist-through-a-port.md) | Add a repository port and replaceable adapter. | Transaction and persistence questions |
| [05 · Prove behaviour](course/modules/05-prove-behaviour.md) | Add fast domain tests and a few boundary tests. | Test-value questions |
| [06 · Handle failure deliberately](course/modules/06-handle-failure-deliberately.md) | Model expected failures, idempotency, and retries. | Failure-classification questions |
| [07 · Observe and ship](course/modules/07-observe-and-ship.md) | Add useful logs, a health check, and a small release checklist. | Operational reasoning questions |

## References

- [Language paths and dependency checks](references/language-paths.md)
- [Per-workspace progress database](references/progress-database.md)
- [Learning protocol and research sources](references/learning-protocol.md)
- [Architecture and backend source index](references/source-index.md)

## Repository promise

This repository contains only references and Markdown. Learner code, generated
files, local progress, and dependencies live outside it. The public course page
is at [kevinmamaqi.com/patchquest](https://kevinmamaqi.com/patchquest/).
