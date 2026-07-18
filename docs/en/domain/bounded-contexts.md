# Bounded contexts

## Mission Control

Mission Control owns the `Mission` aggregate and the durable
`MissionCompletionProcess` application workflow.

A mission must have an objective, immutable starting revision, explicit allowed
scope, positive attempt budget, and at least one executable acceptance gate.
Requirements cannot change after opening; a change creates a new mission
revision. Only verification matching the current mission revision, starting
revision, artifact digest, and gate-set digest may enter review. Human approval
references the exact completion review, recommendation, artifact, verification,
gate-set, and evidence-bundle identities. Completed or cancelled
missions accept no new attempts.

Commands: `DraftMission`, `DefineAcceptanceGates`, `OpenMission`,
`AuthorizeAnotherAttempt`, `ApproveMissionCompletion`,
`RejectMissionCompletion`, `CancelMission`.

Those are internal application commands. The owned
`MissionCompletionProcess` separately issues only three public inter-context
commands: `workshop.create-attempt.v1`,
`verification.start-verification.v1`, and `workshop.revoke-attempt.v1`.

Published events: `mission.opened.v1`, `mission.retry-authorized.v1`,
`mission.cancelled.v1`, `mission.completed.v1`.

## Workshop

Workshop owns the `Attempt` aggregate and `RunnerLease` value object.

An attempt belongs to exactly one mission revision and starting revision and
retains the complete immutable work contract received when it is created. It
has at most one active lease and one terminal outcome. Runner capabilities must
cover every requested capability, and the attempt number must be positive and
cannot exceed the authorized attempt budget.

A lease has an opaque lease ID and token, one owner, the capabilities declared
at acquisition, its original positive duration in seconds, and an expiry
calculated from the service's durable authoritative time. The requested
duration is bounded by the public v1 contract. A lease is already expired when
authoritative `now >= expiresAt`; equality does not leave a final instant in
which the owner may act.

Only the current unexpired lease owner, presenting the matching opaque token,
may heartbeat, abandon, fail, or submit. A heartbeat records activity and
renews the lease atomically: the new expiry is authoritative heartbeat time plus
the original lease duration. It does not accept a new duration and recording
the heartbeat cannot commit separately from renewal. An expired lease cannot be
renewed or used to abandon, fail, or submit.

The state transitions are closed:

| Current status      | Accepted transition                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `READY`             | `LeaseAttempt` produces `LEASED`; private `RevokeAttempt` produces `REVOKED`.                                                                        |
| `LEASED`            | An owner heartbeat remains `LEASED`; owner submission produces `ARTIFACT_SUBMITTED`; owner abandon/fail produces `ABANDONED`/`FAILED`.               |
| `LEASED`            | `ExpireLease` produces `LEASE_EXPIRED` only when authoritative `now >= expiresAt`; private `RevokeAttempt` produces `REVOKED`.                       |
| Any terminal status | No different outcome may replace `ARTIFACT_SUBMITTED`, `ABANDONED`, `FAILED`, `LEASE_EXPIRED`, or `REVOKED`; the same attempt is never leased again. |

`READY` has no lease owner, so `AbandonAttempt` and `FailAttempt` are not
supported from `READY`. Revocation is different: it is an authority action used
to stop an unleased `READY` attempt or a leased `LEASED` attempt, not an
owner-authenticated runner action.

Artifact submission is idempotent for an attempt and artifact digest. Repeating
the exact successful submission returns the recorded receipt without another
state change or event; a different digest conflicts and cannot replace the
terminal artifact. Workshop validates that every changed path is an
NFC-normalized, repository-relative path, but it does **not** decide whether
those paths comply with the immutable allowed scope. A syntactically valid
out-of-scope artifact is stored and published, and the attempt ends as
`ARTIFACT_SUBMITTED`; the Verification and Review context's trusted
`check-allowed-scope` gate owns the later pass/fail decision. First submission
publishes both the immutable artifact fact and the terminal attempt outcome.

Every accepted Workshop operation is recorded through one aggregate-owned
provenance chain. Private operations carry no caller-selectable causation: their
direct causation is their request ID, and their correlation ID must equal the
attempt seed's correlation ID. Public create and revoke commands retain their
validated envelope causation. Outgoing event IDs, timestamps, correlation, and
causation are persisted with the transition that produced them; the application
publishes only that recorded provenance. Artifact submission records its event
as caused by the request and the following attempt-ended event as caused by the
artifact event ID. Transition message and event IDs are unique, and rehydration
rejects any broken correlation, causation, chronology, or event chain.

An exact redelivery of a committed lease request returns the original typed
lease response, including the same opaque raw token, without another state
change or event. The raw token never enters the aggregate memento, public event,
or outbox. A confidential response-replay record keyed by request ID and
canonical fingerprint is committed atomically with aggregate, outbox, and inbox
state. Phase 5 durable storage for that private record must be encrypted,
access-controlled, and excluded from logs and published telemetry.

Commands: `CreateAttempt`, `LeaseAttempt`, `RenewLease`, `RecordHeartbeat`,
`SubmitArtifact`, `AbandonAttempt`, `ExpireLease`, `FailAttempt`,
`RevokeAttempt`.

These are private Workshop application/domain commands. The public
`heartbeatAttempt` operation maps to one atomic heartbeat-and-renewal use case.
The private `RevokeAttempt` command is the validated recipient-side translation
of `workshop.revoke-attempt.v1`; naming it here does not add a public HTTP
operation or a fourth integration command. PatchQuest v1 still exposes exactly
the three inter-context commands owned by Mission Control.

Published events: `workshop.attempt-ready.v1`,
`workshop.attempt-leased.v1`, `workshop.artifact-submitted.v1`,
`workshop.attempt-ended.v1`.

## Verification and Review

This context owns the `VerificationRun` and `CompletionReview` aggregates.

A verification run starts in `REQUESTED` and binds one exact attempt,
artifact-producing runner, mission revision, starting revision, artifact and
digest, immutable acceptance-gate set, and gate-set digest. Gates cannot change
after submission. Assignment of a distinct verifier moves the run to `RUNNING`;
`PASSED`, `FAILED`, and `ABORTED` are first-wins terminal outcomes and can never
replace one another.

### Assignment and resumable execution

The artifact-producing runner cannot verify its own work. A self-verifier is a
typed unavailable assignment: the run records the attempted verifier ID and
ends as `ABORTED` with reason `VERIFIER_UNAVAILABLE` and `retryable: true`
before any gate executes. Any typed unavailable assignment that publishes that
abort must likewise supply the actual attempted verifier ID because the public
v1 abort event requires it. If assignment infrastructure fails before it can
identify any verifier, the run remains `REQUESTED`, returns a private
application error, and publishes no fabricated abort. Retrying assignment for
that same run is therefore safe.

Gate results advance in ascending Unicode code-point order of `gateId`; v1
identifiers are ASCII, so this is also byte order. This checkpoint order is independent of
the input array order. The gate-set canonicalization rule already establishes
the same portable ordering for identity, while acceptance-fixture
`gateExecutions` arrays select deterministic outcomes rather than mandate an
execution sequence. Exactly one gate result is accepted and persisted at each
checkpoint. A restart resumes at the first gate without a committed result and
never reruns a committed checkpoint.

Phase 4C calls an abstract trusted gate-result port with the registered
`commandId`, immutable run binding and artifact, the gate's timeout/evidence
caps, and one stable persisted idempotency key for that run/gate checkpoint. It
never accepts mission-supplied executable text. Port retry reuses the checkpoint
key. The public start command carries no `workspaceReference` or `allowedScope`,
so the Phase 4C application does not claim to locate a workspace, resolve scope,
or execute a live gate. A Phase 6 adapter must obtain those trusted materials
without weakening the bound identities and return a result for validation.

### Check results, evidence, and verdicts

The private `CheckResult` union is closed and has these exact common fields:
`gateId`, `commandId`, `status`, `exitCode`, `durationMs`, `evidenceDigest`, and
`evidenceBytes`. `commandId` must be one of `check-allowed-scope`, `check-lint`,
`check-typecheck`, or `check-tests` and must equal the command registered on the
named immutable gate. `durationMs` and `evidenceBytes` are non-negative
integers; `evidenceBytes` cannot exceed that gate's `evidenceLimitBytes`.

| `status`  | Exact exit and timeout semantics                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| `PASS`    | `exitCode` is integer `0`, and `durationMs` is strictly less than the configured timeout.                            |
| `FAIL`    | `exitCode` is a non-zero integer, and `durationMs` is strictly less than the configured timeout.                     |
| `TIMEOUT` | `exitCode` is `null`, and `durationMs` is at least `timeoutSeconds * 1000`; the check counts as failed, not aborted. |

Every result carries a SHA-256 evidence digest, including a zero-byte evidence
record. Infrastructure inability to produce this result is not a fourth union
member: it aborts the run as `VERIFIER_UNAVAILABLE`,
`WORKSPACE_UNAVAILABLE`, or `EXECUTION_INFRASTRUCTURE_FAILURE`, as applicable.

After every gate has a committed result, and not before, an evidence-bundle port
receives the complete ordered result set and returns its digest. The run becomes
`PASSED` if and only if every mandatory gate is `PASS`; a mandatory `FAIL` or
`TIMEOUT` makes it `FAILED`. Optional failures and timeouts remain in the
evidence bundle but do not make the verdict fail. On
`verification.failed.v1`, `failedGateIds` is exactly the non-empty ordered set
of **mandatory** gate IDs whose result is `FAIL` or `TIMEOUT`; optional failures
are intentionally evidence-only.

The same port has a separate bounded abort-diagnostics operation. When trusted
infrastructure fails after a verifier is known, it may materialize an optional
`evidenceBundleDigest` and optional non-empty bounded `detail` for
`verification.aborted.v1` from diagnostics and any already committed
checkpoints. This is not the all-gates verdict bundle and must not invent a
`CheckResult`, `failedGateIds`, or verdict. Self-verifier rejection occurs
before execution and carries neither an evidence-bundle digest nor a fabricated
check; the infrastructure-abort fixture demonstrates the optional digest case.

When execution infrastructure cannot produce a gate result, the run instead
ends with `ABORTED` and publishes `verification.aborted.v1`. Aborted is neither
`PASSED` nor `FAILED`, has no failed-gate list, and cannot create a completion
review. Verifier, workspace, and execution-infrastructure unavailability are
classified by trusted application policy: `retryable: true` says only that a
fresh bounded attempt may be useful, while `false` requires human handling.
Self-verifier rejection is specifically retryable. Cancellation is always
`MISSION_CANCELLED` with `retryable: false`. The private cancellation input is
trusted context ingress, not another public v1 command. It can abort only a run
that already records a verifier ID; an unassigned `REQUESTED` run cannot
fabricate the verifier ID required by the public event, remains `REQUESTED`, and
publishes no abort. The ingress/assignment policy that resolves that race, plus
external cancellation routing and ordering, is deferred to the Phase 5/6
adapters.

Every assignment, workspace, execution, evidence-receipt, and evidence-bundle
port result crosses a closed runtime boundary before application code branches
on its fields. Trusted infrastructure supplies the retryability bit for verifier,
workspace, and execution outages; the aggregate persists that exact decision in
its memento and abort event. The aggregate overrides no forced case:
self-verifier rejection is always `true`, and mission cancellation is always
`false`.

### Idempotency, provenance, and review

The first accepted start command owns the run's correlation and causation
origin. Verdict and abort events are caused by that original command ID,
including after checkpoint resume or private cancellation. The aggregate
persists event IDs, timestamps, correlation, and causation with the transition;
outgoing factories publish only that recorded provenance. Reuse of a
`verificationRunId` with identical normalized verification inputs under a
different command ID is a semantic duplicate: it returns the recorded run,
does not request gate results again, and emits nothing. The application still records
the distinct inbox delivery in its future transaction. Any changed bound input
under the same run ID is a conflict. Reuse of one command ID with different
normalized content is also a message-ID conflict.

`CompletionReview` opens only from a `PASSED` or `FAILED` event and binds that
exact verification run, mission revision, artifact digest, gate-set digest,
verdict, and evidence-bundle digest. It derives `APPROVE` from `PASSED` and
`REQUEST_REVISION` from `FAILED`; callers cannot choose or override the
recommendation. The immutable recommendation event is caused by the exact
verdict event ID. It is advice only: Mission Control separately records the
human approval or rejection against the same identities. An abort opens no
review.

Both aggregates expose exact, versioned mementos. A `VerificationRun` memento
contains the complete normalized start seed, original command provenance,
canonical gate order, verifier assignment when known, persisted checkpoint
idempotency keys and results, the next checkpoint, evidence-bundle identity,
terminal state, and recorded outgoing provenance. A `CompletionReview` memento
contains its complete verdict binding, derived recommendation, and recorded
event provenance. Rehydration validates exact ordinary JSON topology and
replays the aggregate rules; derived projections, checkpoint order, bindings,
and first-wins terminal facts must match exactly. The same strict topology used
by the delivered contexts applies: closed ordinary objects, dense ordinary
arrays, no accessors, symbols, custom prototypes, proxies, cycles, sparse
indices, non-JSON values, non-finite numbers, or negative zero.

Phase 4C delivers only these domain/application rules, translators, abstract
trusted result/materialization ports, mementos, and offline tests. Real verifier
execution—including live `check-allowed-scope`—and evidence storage,
database/inbox/outbox, broker, HTTP/Fastify, cancellation wiring, and live
service acceptance remain Phase 5/6 adapter work.

Commands: `StartVerification`, `RecordCheckResult`, `CompleteVerification`,
`AbortVerification`, `OpenCompletionReview`, `IssueReviewRecommendation`.

Published events: `verification.passed.v1`, `verification.failed.v1`,
`verification.aborted.v1`, `review.recommendation-issued.v1`.
