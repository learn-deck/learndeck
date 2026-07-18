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

A verification run binds the exact mission revision, starting revision,
artifact digest, and gate-set digest. Gates cannot change after submission. The
artifact-producing runner cannot verify its own work. Every check records its
command identifier, exit status, duration, and bounded output or evidence
digest. `PASSED` requires every mandatory check to pass; an agent cannot
override a failed or timed-out mandatory check. Identical verification inputs
replay idempotently.

`CompletionReview` binds one exact mission revision, artifact digest,
verification run, verdict, and evidence-bundle digest. It records one immutable
recommendation (`APPROVE` or `REQUEST_REVISION`) and publishes that advice as
`review.recommendation-issued.v1`. A recommendation is never a completion
decision: Mission Control must separately record the human's approval or
rejection against those same identities.

When execution infrastructure cannot produce a gate result, the run ends with
an `ABORTED` outcome and publishes `verification.aborted.v1`. Aborted is neither
`PASSED` nor `FAILED`, has no failed-gate list, and cannot create a completion
review. Its `retryable` flag only declares whether a fresh bounded attempt for
the same immutable work may be authorized. Cancellation is never retryable;
other abort reasons still require budget and process-manager authorization.

Commands: `StartVerification`, `RecordCheckResult`, `CompleteVerification`,
`AbortVerification`, `OpenCompletionReview`, `IssueReviewRecommendation`.

Published events: `verification.passed.v1`, `verification.failed.v1`,
`verification.aborted.v1`, `review.recommendation-issued.v1`.
