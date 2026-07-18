# ADR 0004: Keep mission completion in Mission Control

- Status: accepted
- Date: 2026-07-12

## Context

Completion spans attempts, verification, retry budgets, and human approval. No
single aggregate transaction can own the entire asynchronous workflow.

## Decision

`MissionCompletionProcess` is a persisted process manager in Mission Control's
application layer. It consumes integration facts, records its state, and emits
commands through an outbox. It does not live in an HTTP gateway, broker callback,
shared package, or domain entity.

The cross-context workflow is explicit orchestration rather than pure event
choreography. The process manager issues a deliberately small public command
surface: `workshop.create-attempt.v1`,
`verification.start-verification.v1`, and `workshop.revoke-attempt.v1`. Commands
are imperative messages with one intended recipient; events are published facts.
Internal aggregate and application commands remain private and are not mirrored
into the integration catalog.

## Consequences

Mission Control can enforce attempt budgets and final lifecycle decisions while
the other contexts remain autonomous and authoritative for their own outcomes.
The additional coupling is intentional and visible in the versioned command
contracts. Process transitions require idempotency, correlation, causation,
timeout handling, and explicit recovery tests.

`verification.aborted.v1` is a process outcome distinct from a gate verdict.
The process manager may authorize a bounded retry when the event is retryable;
otherwise it moves to human decision (or cancellation when that is the stated
reason). Retryability is permission to create a fresh bounded attempt, not to
turn the terminal aborted run into a verdict, and budget must still remain.
`MISSION_CANCELLED` is always non-retryable. The process manager MUST NOT open a
completion review for an aborted verification.
