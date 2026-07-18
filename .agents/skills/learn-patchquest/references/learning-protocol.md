# PatchQuest learning protocol

Use this protocol to choose, evaluate, and record one activity. Course content
defines what to learn; this file defines how to guide it.

## Resume before teaching

1. Read `course/en/module-catalog.json`.
2. `.patchquest/progress.json` is the sole authority. If it does not exist and
   the learner starts, run `cd node && npm run learning:init`. Initialization
   assigns a fresh session, validates the state, writes it atomically, and then
   generates `.patchquest/learning-log.md` as a disposable projection. A stale
   or missing projection is regenerated and never blocks startup.
3. On a later work session, validate the authority, then run
   `cd node && npm run learning:resume -- ../.patchquest/progress.json` once.
   If a retrieval is `awaiting_revision`, or recovery is `pending` or
   `bytes_restored_recheck_pending`, resume the same open logical session and
   saved context without changing progress. The learner must checkpoint the
   evaluated revision or finalize recovery first. Otherwise, resume backs up
   progress, closes the prior open session, creates a new open non-overlapping
   session, updates the clock, appends a full checkpoint, and atomically replaces
   progress. Exactly one session is open; all earlier sessions are closed.
4. Read `course/learning-state.schema.json`. Before the first evaluated
   mutation, read `references/evaluated-state.example.json`.
5. Follow `references/state-migration.md` before every write.
6. Select the current ready module. A planned module is unavailable even if its
   title exists. Retain the last ready pending action.
7. Prefer one due retrieval from `reviewQueue`; otherwise use `current`. Never
   present a list when one next action is known.

## Persist every turn

After each learner response, start from an exact copy of progress, write the
proposed transition to `.patchquest/progress.draft.json`, and record the active
`loopPhase`, `pendingAction.owner`, and one pending action before replying. Use
catalogued activity IDs. Every retrieval, revision, activity, completion,
review schedule, review event, and recovery event receives a globally unique
ID. Never reuse evidence.

Commit the draft from `node/`:

```sh
npm run learning:checkpoint -- ../.patchquest/progress.json ../.patchquest/progress.draft.json "Describe the learner transition"
npm run learning:state -- ../.patchquest/progress.json
```

The checkpoint command rejects changes to prior evidence, sessions, checks, or
the existing checkpoint chain; permits only the defined
`awaiting_revision` → `evaluated` attempt transition; owns the timestamp;
appends a hash-chained checkpoint containing the operational snapshot and a
digest of the full authoritative state (excluding the checkpoint chain itself);
backs up the authority; and replaces it with one atomic rename. A later edit to
an answer, feedback, check, review, recovery, completion, session, or other
authoritative evidence invalidates the latest checkpoint. The command consumes
the draft only after success. It then regenerates the human-readable learning
log. `npm run learning:log --
../.patchquest/progress.json` is only a deterministic projection repair; the
Markdown view never supplies evidence and never blocks progress validation.

## Calibrate from evidence

Use the module's catalogued diagnostic prompt as a brief no-stakes retrieval
strictly before the earliest completion activity and before any required check.
It establishes what the
learner already knows but never satisfies completion. Use the distinct
catalogued mastery prompt only after all completion activities and required
checks pass.
Initial calibration is `unassessed`; self-reported experience is context, not
proof. After evaluated retrieval, record support per concept in
`conceptLevels`; do not assign a global expertise label.

If the learner has no usable schema, first show the compact orientation or
worked example named by the module. Then close the source and ask its open-ended
prompt with confidence from 0–100 and predicted outcome (`accurate`, `partial`,
or `incorrect`).

- `worked-example`: offer one cue or frame and one example; ask the learner to
  explain it and complete the next step.
- `faded`: retain the goal and one cue; ask for the missing connection.
- `independent`: remove cues and ask for related transfer or contrast.

Fade through worked example → explanation → partial completion → independent
application → related mixed transfer. Do not add difficulty while the learner
is already overloaded.

## Run one learning loop

Give only the next item and wait between items.

1. **Diagnose** — close the source; record the module diagnostic answer,
   confidence, prediction, self-evaluation, and feedback before active work.
2. **Acquire** — use the smallest explanation, source, or worked example.
3. **Inspect** — reopen the smallest source with adaptive support.
4. **Act** — ask for one bounded trace, explanation, edit, or command.
5. **Explain** — check why the result follows against repository evidence.
6. **Self-evaluate** — score every catalogued rubric criterion from 0–2 with
   criterion-specific evidence. Never store only an aggregate.
7. **Correct** — state target, evidence, exact gap, process error, and smallest
   corrective support. For a partial/wrong answer, require a source-closed
   revision. First persist the partial/incorrect attempt as
   `awaiting_revision`; later append one standalone, fully evaluated revision
   and transition the attempt to `evaluated`.
8. **Prove** — execute every catalogued gate with `npm run learning:check --
../.patchquest/progress.json <module-id> <check-id>`. Record only the result
   produced by that command; blocked is not passed.
9. **Master** — after proof, close the source and answer the separate mastery
   prompt. Record confidence, prediction, all rubric criteria, feedback, and
   the exact passing check IDs. If partial or wrong, persist it as
   `awaiting_revision`, then append one accurate source-closed revision later.
10. **Feedback** — give one next action and one self-monitoring question.
11. **Record** — atomically checkpoint progress, regenerate its disposable log
    projection, and leave one `current.pendingAction`.

Praise never substitutes for diagnostic feedback. Do not turn an effect size
into a claim about learning speed.

## Space and interleave responsibly

Schedule every evaluated prompt. Choose a provisional gap from retention goal,
outcome, calibration, and likely next session; record a schema-defined
heuristic and specific reason. Use a shorter gap after correction and extend
only after successful unaided retrieval. If timing is unknown, use
`atNextSession: true`. There is no universal interval or success prediction.

Retrieve before showing the prior answer. `reviewQueue` contains only active
schedules; `reviewHistory` is append-only evidence. A globally unique review
ID is created by `scheduled`. `completed` consumes that active ID and removes
it from the queue. `rescheduled` also consumes the active ID, creates a new
globally unique ID, links it through `priorReviewId`, and puts only the new ID
in the queue. Never orphan an event, reuse an ID, or keep a completed schedule
active.
`atNextSession` becomes due only after session rollover. `notBefore` becomes due
at its timestamp. A due review is the current action before new content unless
an unfinished correction or recovery owns the logical session. Keep the review
queued through that entire session; after the blocker is finalized, a later
normal rollover makes the review current.
Neither `completed` nor `rescheduled` is a scheduling-only edit: each requires
a new evaluated `delayed-review` attempt for the scheduled prompt in the event's
current session, after the schedule is due. Partial or incorrect delayed recall
requires its own accurate revision before the event can be recorded.

Interleave only catalogued `interleaveOnlyWith` pairs after initial fluency in
both. Use contrast or strategy selection, never unrelated task switching.

## Complete only from linked evidence

A completion is one object, never a module-ID string. It must reference:

- every catalogued completion activity run;
- passing runs for every required check;
- exactly one evaluated post-proof mastery retrieval whose exact original or
  revision ID is accurate and binds all required passing checks; a revision is
  a full attempt with rubric, calibration, feedback, and the same check set;
- every rubric criterion scored 2 with evidence;
- a first-person takeaway beginning “I …”;
- an immutable scheduled review-history record for a catalogued delayed prompt
  (the active queue may later contain a linked reschedule).

Every passing check is bound to its module, activity, session, exact catalogued
command, actual repository/worktree revision, exit code, `learning:check`
recorder, and canonical gate digest. Activity and retrieval evidence explicitly
links the check run. A completion uses only checks, activities, and retrieval
evidence from its own module/session and matching revision/digest. Its activity
and check evidence must precede completion, and an attempt must precede its
standalone revision, which must precede completion. No evidence record can
satisfy two completions.

Validate all cross-record links before claiming completion. Planned modules
cannot be completed.

## Recover interrupted mutation exercises

Before a deliberate break, inspect the target's existing diff and never
overwrite learner changes. From `node/`, prepare an exact guarded copy and
pending checkpoint before mutation:

```sh
npm run learning:recovery:prepare -- ../.patchquest/progress.json <target> <module-id> <activity-id> <check-id>
```

Make only the named mutation, then run the expected gate through
`learning:check` and preserve its actual failed check run. Restore through the
guarded command, never a broad reset:

```sh
npm run learning:recovery:restore -- ../.patchquest/progress.json
```

Restore validates the prepared copy, atomically restores the exact bytes, then
checkpoints `bytes_restored_recheck_pending` before running the same gate. That
intermediate authority links the actual failed check and exact restored
fingerprint. A failed or blocked recheck remains retryable without recreating
the deliberate mutation. A passing recheck is recorded before an immutable
final `restored` event links both check run IDs. If execution stops after byte
restoration or after the passing check, rerun `learning:recovery:restore`; it
resumes from the persisted/file fingerprint state without overwriting new
changes. All three events remain append-only in `recoveryHistory`. On resume,
both unfinished statuses (`pending` and
`bytes_restored_recheck_pending`) keep the same open logical session and remain
the current action without changing progress. Any due review stays queued until
recovery finalizes and a later normal rollover routes it. Restored bytes stay
unchanged; restore the recovery before new work.

## Evaluation boundary

Schema and protocol validation establish structural integrity: stable identity,
chronology, append-only evidence, exact gate provenance, checkpoint freshness,
and required links. They cannot determine whether a free-form explanation is
conceptually true or whether feedback is pedagogically sound. The guide must
compare answers with the named module sources and executable evidence; the
learner's self-evaluation and a human's judgment remain part of mastery.

## Finish a session

End with:

- **I completed:** linked evidence only.
- **I can explain:** corrected first-person takeaway.
- **Next review:** scheduled prompt and rationale.
- **Next:** exactly one pending action copied from state.
