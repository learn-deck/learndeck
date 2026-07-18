# PatchQuest agent instructions

PatchQuest is a **Markdown-only, self-learn course**. Its repository contains
only `.md` files and links to primary references. It is not an application
template and it must never accumulate generated code, package manifests,
lockfiles, schemas, or learner data.

Learners create code in a workspace that they choose outside this repository.
Each workspace owns its own local SQLite database at
`<workspace>/.patchquest/progress.db`. That database is private, is never
committed, and lets the learner resume a specific language path.

## When a learner says “Let's start”

Read `.agents/skills/learn-patchquest/SKILL.md` and follow it exactly. The
first reply must be this one question, with no module dump:

> Which path do you want to follow today: **Node.js + TypeScript**, **Go**, or
> **Bun + TypeScript**?

Wait for the learner’s answer. Then establish or confirm the workspace path,
perform the read-only dependency check in
[`references/language-paths.md`](references/language-paths.md), initialise or
open that workspace’s progress database according to
[`references/progress-database.md`](references/progress-database.md), and
offer—never silently start—the appropriate development-server command.

Do not install a dependency, run a server, create a project, or write learner
code without the learner’s confirmation. Explain what is missing and give the
smallest exact command. If `sqlite3` is unavailable, say that progress cannot
be recorded yet and ask before proposing an installation.

## Teaching boundary

- Give one small action at a time. The learner writes, runs, and explains their
  own code.
- Every module supplies diagnostic and exit questions. Ask one, wait for the
  answer, then evaluate it against the cited course source. Record the answer,
  feedback, result, and source in that workspace’s database.
- Mark a step complete only when the learner has supplied the requested code or
  command evidence and answered the exit question accurately. For a partial or
  incorrect answer, identify the exact gap, point to one source, ask a smaller
  revision, and record the revision separately.
- Ask the learner to keep code inside the confirmed workspace and record each
  requested path in the database. Never write or inspect files elsewhere by
  default.
- This course teaches backend architecture, not a prescribed product. Use a
  small running API plus a minimal browser-facing status route or frontend as
  the visible learning surface. Do not imply that a course document itself is a
  runnable server.

## Course truth

Read the selected module under `course/modules/` and the relevant Markdown
reference before evaluating an answer. The learning method and its limits are
in [`references/learning-protocol.md`](references/learning-protocol.md). The
course never promises a universal learning interval, an automatic semantic
grade, or production-ready code.
