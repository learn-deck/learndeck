# ADR 0009: Restartable verification with independent evidence integrity

- Status: accepted
- Date: 2026-07-18

## Context

A `VerificationRun` executes an immutable acceptance-gate set against one
submitted artifact and must survive a verifier crash, a lost response, and a
redelivered start without double-executing a gate, fabricating a result, or
trusting an adapter's own accounting of its evidence. [ADR 0005](0005-independent-verification.md)
established that the producing runner cannot verify its own artifact and that a
failed or timed-out mandatory gate cannot be overridden. [ADR 0008](0008-portable-gate-commands.md)
made the gate set and each `commandId` portable and closed. This ADR records how
the Phase 4C domain and application make that verification restartable and how
they keep evidence honest without yet owning a database, an evidence store, or a
real executor.

## Decision

**One trusted gate result per persisted checkpoint.** A run advances one missing
gate per unit-of-work call, in ascending code-point `gateId` order. Each gate has
a persisted checkpoint; the evidence-bundle port runs only after every checkpoint
carries a result. Optional gate failures remain evidence only. A run is `FAILED`
only when a mandatory gate is non-`PASS`, and `failedGateIds` is exactly the
sorted mandatory `FAIL`/`TIMEOUT` gate IDs.

**Stable tuple-based checkpoint idempotency.** A checkpoint key is
`checkpoint:<sha256>` of the RFC 8785 canonical JSON of the tuple
`[verificationRunId, gateId]`. Because identifiers may contain `:`, identity is a
hash of the canonical tuple, never delimiter concatenation. The executor receives
that key as its idempotency key, so a replayed call resolves to the same
committed checkpoint instead of re-executing.

**Independent evidence-receipt verification.** The application computes the
SHA-256 digest and the UTF-8 byte length of the exact executor evidence itself,
then requires the evidence-store receipt to match that digest, that byte count,
and the gate's evidence cap before any aggregate mutation. A wrong-but-valid
digest, a mismatched byte count, or oversized evidence fails closed with a typed
port-result error and no state change. Empty and multibyte evidence are covered.

**Timeout versus infrastructure abort.** A `CheckResult` records
`gateId`, `commandId`, `status`, `exitCode`, `durationMs`, `evidenceDigest`, and
`evidenceBytes`. Below the configured timeout, `PASS` requires exit `0` and `FAIL`
a non-zero integer exit; at or beyond the timeout, `TIMEOUT` requires a `null`
exit. Infrastructure inability to produce that record is an abort, not a check:
it creates no `CheckResult` and no failed-gate list, and may carry only a bounded,
separately materialized diagnostic digest and detail.

**Trusted retryability classification with two forced edges.** Retryability comes
from the trusted classified adapter result, except that self-verification is
forced retryable (`VERIFIER_UNAVAILABLE`) and mission cancellation is forced
non-retryable (`MISSION_CANCELLED`). The first accepted start command remains the
cause of the eventual verdict or abort across resume and trusted private
cancellation.

**No-identity assignment stays retryable and silent.** When assignment fails
without naming a verifier, the run stays `REQUESTED`, the application returns the
typed private error `VERIFIER_IDENTITY_UNAVAILABLE`, and it emits no public event,
because a public `verification.aborted.v1` requires an actual verifier ID. Redelivery
and reassignment remain possible.

**Adapters are deferred.** Phase 4C consumes trusted abstract results through
ports. Concrete workspace materialization, evidence storage, and gate execution —
with real timeouts, cancellation wiring, and the durable inbox/outbox/unit-of-work
of [ADR 0006](0006-at-least-once-delivery.md) — are Phase 5–6 adapter work, in line
with the sandbox deferral of [ADR 0007](0007-sandbox-deferral.md).

## Consequences

Verification is resumable and idempotent at the domain/application layer with no
network, database, broker, or host command execution. Evidence cannot enter an
aggregate unless the application has independently reproduced its digest and byte
length, so a compromised or buggy store cannot silently alter a verdict. The
tuple checkpoint key and first-wins outcome make crash-and-retry safe to model
now and safe to back with real infrastructure later. These are domain and
application guarantees on trusted abstract results; they are not a claim of live
workspace resolution, sandboxed execution, or authenticated tamper resistance,
which remain Phase 5–6 work.
