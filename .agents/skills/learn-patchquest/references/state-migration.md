# Local state initialization, backup, and migration

`course/learning-state.schema.json` version 1 is the only supported state
version. `.patchquest/progress.json` is the sole learner authority.
`.patchquest/learning-log.md` is a deterministic disposable projection.

For a first run, use `npm run learning:init` from `node/`. Initialization is
atomic and idempotent. It creates validated progress with a fresh open session
and an initial full checkpoint, then generates the readable log. There is no
original learner state, so initialization creates no backup and must not invent
one (the no backup rule). An empty or log-only `.patchquest/` directory is safe:
initialization creates progress and replaces the stale projection. If progress
exists, it must validate; a missing log is simply repaired.

Never edit authoritative progress in place. Copy it to a separate draft, edit
only the draft, and commit it from `node/`:

```sh
cp ../.patchquest/progress.json ../.patchquest/progress.draft.json
# Edit only progress.draft.json.
npm run learning:checkpoint -- ../.patchquest/progress.json ../.patchquest/progress.draft.json "Describe the learner transition"
npm run learning:state -- ../.patchquest/progress.json
```

The checkpoint command validates the draft transition, prevents rewriting the
append-only evidence/history, preserves the existing hash chain, adds a
snapshot of current loop, pending action, recovery, calibration, concept
levels, review queue, and evidence IDs, and records a digest over the complete
authoritative state except the checkpoint chain itself. It creates a timestamped
non-overwriting backup under `.patchquest/backups/` and writes progress with one
atomic rename. Retroactive edits to prose evidence, checks, reviews, recovery,
completion, or session history therefore make the latest checkpoint stale.
The draft is removed only after that succeeds. If validation or the write
fails, progress is unchanged and the draft remains available for diagnosis.

Do not add check records to a draft. Run the exact catalogued command through:

```sh
npm run learning:check -- ../.patchquest/progress.json <module-id> <check-id>
```

That command records actual exit status, repository revision, and canonical
gate digest through the same atomic state-write path. Repair or inspect the
derived log at any time without changing progress:

```sh
npm run learning:log -- ../.patchquest/progress.json
npm run learning:state -- ../.patchquest/progress.json
```

For a deliberate module 04 break, prepare and restore only through the guarded
commands so the failed and passing checks and exact file fingerprint are linked:

```sh
npm run learning:recovery:prepare -- ../.patchquest/progress.json <target> <module-id> <activity-id> <check-id>
# Make only the prepared mutation, then record the expected failure with learning:check.
npm run learning:recovery:restore -- ../.patchquest/progress.json
```

Restore first checkpoints `bytes_restored_recheck_pending` after exact byte
restoration and before the recheck. Failed or blocked rechecks, a stop after
restoration, and a stop after a recorded passing recheck are all retried with
the same command; no second deliberate mutation is required.

At the start of a later work session, run:

```sh
npm run learning:resume -- ../.patchquest/progress.json
```

Normally it backs up progress, closes the prior open session, opens a fresh
non-overlapping session, routes a due review, appends a checkpoint, atomically
writes progress, and regenerates the log. Do not manually reuse a session ID.
Exception: if any attempt is `awaiting_revision`, or recovery is `pending` or
`bytes_restored_recheck_pending`, resume leaves the same session and saved
context open without changing progress. Due reviews remain queued for the rest
of that logical session. Checkpoint the evaluated revision or finalize recovery;
a later resume may then roll over and route the review normally.

If `schemaVersion` is missing or is not `1`, back up the original progress,
stop, and explain that no migration exists yet. Never coerce, overwrite, or
delete an unsupported version. A future version must add an explicit tested
migration before an agent changes learner evidence.

If the pre-v1 `.patchquest/learning-progress.md` exists, preserve it unchanged.
After learner confirmation, initialize v1 state without copying completion
claims; cite the legacy file in a separate human review note rather than
injecting unstructured prose into progress.
