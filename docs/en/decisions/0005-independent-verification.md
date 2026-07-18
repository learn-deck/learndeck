# ADR 0005: Separate production, verification, and approval

- Status: accepted
- Date: 2026-07-12

## Context

A runner evaluating its own artifact creates a conflict of responsibility, and
a technical pass does not capture human judgment about completion.

## Decision

The artifact-producing runner cannot verify its own work. Verification binds an
exact mission revision, starting revision, artifact digest, and gate-set digest.
All mandatory checks must pass for a `PASSED` verdict. `CompletionReview` binds
the exact verdict and evidence and emits one immutable recommendation. Mission
Control must then record a separate human approval or rejection against those
same identities, including `completionReviewId`, recommendation, verification
run, artifact digest, gate-set digest, and evidence-bundle digest.

An execution-infrastructure failure or cancellation is an `ABORTED` outcome,
not a `FAILED` verdict. It publishes `verification.aborted.v1`, does not invent
failed checks, and cannot open a completion review. A retryable infrastructure
abort may lead Mission Control to authorize a fresh attempt within budget;
cancellation is non-retryable and follows the cancellation path.

## Consequences

Evidence is independently reproducible; neither a technical verdict nor a
review recommendation can silently become approval. The workflow needs stable
identities and preserves human rejection even when verification passes.
