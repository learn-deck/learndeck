# Learn PatchQuest with your local agent

This is a course I learn by exploring and building inside my own clone. I do not
need to find the right chapter, copy prompts from a website, or wait for a hosted
tutorial. I open the repository with my coding agent and say:

> Let's start.

The repository's local `learn-patchquest` skill then guides me through one small
activity at a time. It calibrates support from my answers, gives me a bounded
action, evaluates evidence, corrects errors, schedules a later retrieval, and
records resumable progress locally.

## Start

1. Clone and open PatchQuest in a coding agent that reads `AGENTS.md` and local
   Agent Skills.
2. From the repository root, say **“Let's start.”**
3. Follow one visible step at a time.

If the agent does not discover repository skills automatically, say:

> Read `AGENTS.md` and use `.agents/skills/learn-patchquest/SKILL.md`. Let's
> start.

The first setup gate is:

```sh
cd node
nvm use # or use another version manager that reads .nvmrc
node --version # must be v24.11.0
npm --version # must be 11.6.1
npm ci
npm run verify
```

## How a learning session works

The guide uses a short, adaptive loop rather than unlocking pages by time
spent:

1. Before active work, I answer a no-stakes diagnostic from a closed source,
   record confidence, and predict how well I did.
2. I study one compact explanation or worked example, then close the source.
3. I take one bounded action and explain why the result follows.
4. I score every rubric criterion from 0–2 with evidence before the guide
   evaluates it.
5. The guide states the target, observed evidence, exact gap, correction,
   process advice, one next action, and a self-monitoring question.
6. After the real required checks pass, I answer a distinct source-closed
   mastery prompt. The diagnostic cannot satisfy completion.
7. If I was wrong or partial, I answer again from memory and the guide evaluates
   that revision separately before moving on.
8. The guide schedules a delayed review based on my goal and result. Completing
   or rescheduling it requires a new evaluated attempt for that exact prompt in
   the due session. The gap is
   provisional; there is no single interval that fits every learner or goal.

Early exercises may use cues and worked examples. Those supports fade toward
partial completion, independent work, and finally mixed transfer among related,
easily confused concepts. Unrelated topics are not mixed just to make practice
feel harder.

## My path

| Module                        | What I can say when I finish                                                           | Availability |
| ----------------------------- | -------------------------------------------------------------------------------------- | ------------ |
| 00 · Orient myself            | I can explain what I am building and prove my clone is healthy.                        | Ready        |
| 01 · Model before code        | I can draw the three responsibilities and defend their boundaries.                     | Ready        |
| 02 · Make promises executable | I can trace one behavior across HTTP, events, schemas, and a scenario.                 | Ready        |
| 03 · Design for failure       | I can explain why retries, duplicates, expiry, and aborts do not corrupt the workflow. | Ready        |
| 04 · Protect the architecture | I can break a dependency rule on purpose and watch the architecture test stop me.      | Ready        |
| 05 · Build Mission Control    | I can implement mission lifecycle rules behind ports.                                  | Planned      |
| 06 · Build the Workshop       | I can implement leases, heartbeats, attempts, and idempotent submission.               | Planned      |
| 07 · Verify independently     | I can bind an exact artifact to evidence and a human decision.                         | Planned      |
| 08 · Connect and observe      | I can integrate the contexts with reliable messages and useful telemetry.              | Planned      |
| 09 · Show and ship it         | I can run, explain, and publish the complete canonical demo.                           | Planned      |

Ready modules use the real documentation, contracts, fixtures, and verification
spine already in the repository. Planned modules stay visibly locked until their
executable implementation exists; the guide must never pretend otherwise.

## Module sources

- [00 · Orient myself](modules/00-orient-myself.md)
- [01 · Model before code](modules/01-model-before-code.md)
- [02 · Make promises executable](modules/02-make-promises-executable.md)
- [03 · Design for failure](modules/03-design-for-failure.md)
- [04 · Protect the architecture](modules/04-protect-the-architecture.md)
- [Research basis and limitations](learning-research.md)

## Local, resumable progress

The agent creates one ignored authoritative state with `npm run learning:init`
when I begin:

- `.patchquest/progress.json` holds my current activity, evidence-based support
  level per concept, active loop phase, pending action, stable session/run IDs,
  answer/confidence calibration, criterion scores, checks, corrections,
  evaluated revisions, linked completions, active delayed-review queue, and
  append-only review/recovery history. Its checkpoints form a digest chain and
  include a digest of the full authoritative state, so a later agent can detect
  retroactive evidence edits and see the exact saved loop boundary.
- `.patchquest/learning-log.md` is a deterministic human-readable projection of
  progress. It is safe to delete; startup and validation regenerate it. It is
  never evidence and never blocks resume.

The state format is defined by
[`../learning-state.schema.json`](../learning-state.schema.json) and can be
checked with:

```sh
cd node
npm run learning:state -- ../.patchquest/progress.json
```

The guide never edits the authority in place. It proposes the next transition
in a separate draft and asks the checkpoint command to validate append-only
history, add a full hash-chained snapshot, back up progress, and replace it
with one atomic rename:

```sh
cd node
cp ../.patchquest/progress.json ../.patchquest/progress.draft.json
# The agent updates only progress.draft.json.
npm run learning:checkpoint -- ../.patchquest/progress.json ../.patchquest/progress.draft.json "Describe the learner transition"
npm run learning:state -- ../.patchquest/progress.json
```

Required gates run through `npm run learning:check --
../.patchquest/progress.json <module-id> <check-id>`. This executes the exact
catalogued command and records its real exit code, repository revision, and
canonical gate digest. An activity, retrieval, or completion must link that run
instead of inventing a passing check.

On a later work session, `npm run learning:resume --
../.patchquest/progress.json` normally closes the previous open session, opens a
fresh non-overlapping one, and makes next-session reviews due before new content.
If my answer is still `awaiting_revision`, or recovery is `pending` or
`bytes_restored_recheck_pending`, resume keeps the same logical session and exact
saved context without changing progress. Any due review stays queued for that
session. After my revision is evaluated or recovery is finalized, a later
resume rolls over and surfaces the review normally.

For module 04's deliberate break, the guide uses
`learning:recovery:prepare` before the mutation and
`learning:recovery:restore` afterward. The restore is guarded by an exact copy
and SHA-256 fingerprint. It persists a
`bytes_restored_recheck_pending` checkpoint before rerunning the gate, so a
failed, blocked, or interrupted recheck can resume without deliberately
breaking the file again. The final event links the actual failed and passing
check runs, and the workflow does not use a broad worktree reset.

These files belong to me and are ignored by Git. They are evidence of my
learning process, not normative course content. Course truth remains in the
English domain documentation, root contracts, and executable scenarios. The
machine-readable [`module-catalog.json`](module-catalog.json) keeps agents
honest about which modules are ready and which remain planned.

Automated validation proves the structure, chronology, evidence provenance,
and checkpoint integrity of this record. It cannot judge whether a free-form
answer is conceptually correct. The local guide still compares my explanation
with the named repository sources, and my self-evaluation remains visible.
