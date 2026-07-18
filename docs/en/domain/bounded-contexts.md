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

An attempt belongs to exactly one mission revision and starting revision. It has
at most one active lease and one terminal outcome. A lease has an opaque token,
owner, capability set, and expiry supplied by the service's durable,
authoritative time source. Only its owner may renew, abandon, fail, or submit.
Expired leases cannot submit. Submission is idempotent for an attempt and
artifact digest. Runner capabilities must cover the mission request, and attempt
numbers cannot exceed the authorized budget.

Commands: `CreateAttempt`, `LeaseAttempt`, `RenewLease`, `RecordHeartbeat`,
`SubmitArtifact`, `AbandonAttempt`, `ExpireLease`, `FailAttempt`.

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
