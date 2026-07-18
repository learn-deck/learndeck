# ADR 0006: Design for at-least-once delivery

- Status: accepted
- Date: 2026-07-12

## Context

Asynchronous brokers and crash recovery can redeliver messages. Claiming
exactly-once delivery would hide failure modes rather than remove them.

## Decision

Assume at-least-once delivery. Consumers are idempotent, submissions bind stable
identities, and business state changes are coordinated with durable inbox and
outbox records in each implementation. Invalid or poison messages remain
observable and require controlled replay through the normative
`replayDeadLetter` HTTP operation. Replay requires a stable HTTP idempotency key,
provider-neutral bearer authentication, authenticated operator identity and
reason, the expected dead-letter revision, the original message digest, and a
complete contract-valid replacement with a distinct message ID. The nested
envelope is the only source of replacement type and identity. Acceptance
atomically records immutable linkage from original to replacement. Direct
broker redrive is not a conforming operator path.

## Consequences

Duplicate delivery is normal and testable. Implementations must define
idempotency keys, atomicity boundaries, retry limits, dead-letter handling, and
crash recovery rather than relying on broker optimism.
