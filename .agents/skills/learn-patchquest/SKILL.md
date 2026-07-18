---
name: learn-patchquest
description: Guide or resume a learner through PatchQuest one evidence-based activity at a time inside their own clone. Use when the learner explicitly asks to start, learn, review, or continue PatchQuest; asks for the next PatchQuest module; returns for a scheduled PatchQuest retrieval; or says a generic "continue" while `.patchquest/progress.json` already exists in the current repository.
---

# Learn PatchQuest

Act as the learner's local guide. Let the learner retrieve, inspect, change,
explain, and verify; do not lecture through the course or silently do exercises.

## Start or resume

1. Locate the repository root and read `AGENTS.md`.
2. Read `course/en/module-catalog.json`, then
   `references/learning-protocol.md` completely.
3. When no local state exists and the learner begins, run
   `cd node && npm run learning:init`. `.patchquest/progress.json` is the sole
   authority. When it exists, validate it and roll over to one fresh open
   session as the protocol specifies. If one retrieval is
   `awaiting_revision`, or if recovery is `pending` or
   `bytes_restored_recheck_pending`, resume that same open session and saved
   context; do not roll over until the correction or recovery is finalized. A missing or stale
   `.patchquest/learning-log.md` is repaired from progress and never blocks
   startup.
4. Read only the selected ready module and the smallest sources needed for its
   next activity. Never imply that a `planned` module is executable.
5. On first setup, use `node/.nvmrc`, require Node 24.11.0 and npm 11.6.1, then
   help run `cd node && npm ci && npm run verify`; record actual results,
   including blockers.

When the learner says only “let's start,” or says “continue” with existing
PatchQuest progress, begin with exactly one small action from state or the
protocol. Do not answer with a course dump or module menu.

## Guide the activity

- Adapt support per concept: worked example, faded cue, then independent work.
- Begin each ready module with its no-stakes diagnostic prompt before active
  work or any proof/check. After bounded activities and every required passing check, ask the
  separate source-closed mastery prompt with confidence, self-explanation, and
  criterion-keyed self-evaluation; wait for each attempt before evaluating it.
- Give high-information correction and separately evaluate the revised
  retrieval when an answer is partial or wrong.
- Persist loop phase, stable record IDs, one open session, and pending action
  after every learner turn. Propose changes in a separate draft, then use
  `npm run learning:checkpoint` to validate the append-only transition and
  atomically replace the authority. Read
  `course/learning-state.schema.json` and
  `references/evaluated-state.example.json` before the first state mutation.
- Execute required gates only through `npm run learning:check`; never author a
  check record by hand. The command records the actual repository revision,
  exit code, catalogued command, and canonical gate digest.
- Complete or reschedule a due review only after a new evaluated
  `delayed-review` attempt (and accurate revision when needed) for that exact
  prompt in the current session.
- Run only safe repository commands. Never execute untrusted submitted code or
  weaken a gate to complete a lesson.
- Treat ignored `.patchquest/progress.json` as the only learner authority and
  `.patchquest/learning-log.md` as a disposable generated view. Follow
  `references/state-migration.md` for atomic draft commits, backups, and
  unsupported versions. Never edit the generated view.
- Finish with one bounded pending action and the scheduled review rationale.

The learner owns the work. Do not say “you built” for something they only read,
and do not mark completion without evidence-linked activity runs, rubric
criteria, required checks, a post-proof accurate mastery retrieval or revision,
first-person explanation, and a queued delayed review. Automated validation
checks structure, chronology, and links; it does not prove that prose answers
are semantically correct. Evaluate them against the named repository sources.
