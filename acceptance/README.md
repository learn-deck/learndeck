# Language-neutral acceptance scenarios

This directory is the executable specification shared by every PatchQuest
implementation. The JSON files describe inputs and observable outcomes; they do
not prescribe a programming language, framework, database, broker, clock
library, agent provider, or deployment topology.

Each scenario is an independent probe. An implementation must arrange the exact
`initialState`, apply `inputs` in sequence, and compare the observable result
with `expected`. `advanceTime` means advancing the Workshop context's durable,
authoritative time source. `controlledReplay` is an authenticated operator
decision; it is deliberately not an ordinary message delivery.

The scenario format is defined by [`scenario.schema.json`](scenario.schema.json).
Every fixture declares the JSON Schema dialect with the absolute
`$schema` URI and associates itself with that local schema through the separate
`scenarioSchema` field. A relative path is never used as a dialect identifier.
Contract names are drawn only from
[`contracts/schemas/v1/catalog.json`](../contracts/schemas/v1/catalog.json).
HTTP requests and integration-message payloads remain subject to the normative
OpenAPI and JSON Schema documents; this acceptance schema does not duplicate
those contracts.

## Portable harness protocol

For an HTTP input, the harness resolves the fields allowed by the named OpenAPI
operation, invokes it, then checks `expect.status` and the response subset in
`expect.response`. Query inputs contain only `request.pathParams`; command
inputs also contain the required `request.headers` and `request.body`.
`X-Correlation-Id` and `Idempotency-Key` are explicit on commands even when an
implementation normally injects them through middleware.

Fixtures include a deterministic bearer credential for every privileged human,
runner, and replay HTTP mutation. Mission creation and CQRS queries omit it
intentionally because those operations are public in the canonical educational
contract. Fixture bearer values are inert test data, never production secrets.

Implementations generate their own IDs, lease tokens, and evidence digests.
`captures` maps a name to an RFC 6901 JSON Pointer rooted at the observed HTTP
response, message, or awaited state. A later exact string of the form
`${capture.name}` substitutes that value. `${input.N.requestId}` addresses
`X-Request-Id` for HTTP sequence `N`; `${input.N.commandId}` and
`${input.N.eventId}` address integration-envelope identities. Substitution
happens before normative contract validation.

An `await` input polls only durable observable state or published messages.
`until: state` or `message` requires its declared condition; `quiescent`
means there is no immediately deliverable work and all prior committed outbox
records have either been published or made observably retryable. The harness
fails after `timeoutMs` and polls no faster than `pollEveryMs`; it never uses
traces as a completion signal.

`fixtureControls` configures portable deterministic seams: authoritative time
per sequence, generated IDs, evidence digests, fixture secrets, gate outcomes,
verifier assignments, and telemetry availability. Any generated value asserted
by a scenario must be captured or named by these controls. These are acceptance-driver
ports, not broker, database, sandbox, agent-provider, or observability-provider
choices. Gate IDs map to trusted commands through
[`gate-command-registry.md`](../docs/en/contracts/gate-command-registry.md);
the Node mapping will be executable implementation code, never mission input.

Published-message assertions match command/event kind, contract type, payload
subset, message ID, correlation ID, and the direct causation ID. Capture
pointers let one message become the asserted cause of the next. Suppressions
are sequence-scoped objects, never ambiguous prose. State assertions use typed
Mission, Attempt, VerificationRun, CompletionReview, MissionCompletionProcess,
DeadLetter, and projection snapshots; digest fields use the contract
`Digest` object.

## Scenario map

| Scenario                              | Primary contracts                                                                                                             | Decisions and domain documentation  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `happy-completion`                    | `createMission`, `leaseAttempt`, `heartbeatAttempt`, `submitArtifact`, `approveMissionCompletion`; normal command/event chain | ADRs 0002–0005; canonical demo      |
| `forbidden-path`                      | `submitArtifact`, `verification.start-verification.v1`, `verification.failed.v1`, `review.recommendation-issued.v1`           | ADR 0005; failure catalog           |
| `duplicate-artifact-submission`       | `submitArtifact`, `workshop.artifact-submitted.v1`                                                                            | ADR 0006; failure catalog           |
| `expired-lease-retry`                 | `submitArtifact`, `workshop.attempt-ended.v1`, `mission.retry-authorized.v1`, `workshop.create-attempt.v1`                    | ADRs 0004 and 0006; failure catalog |
| `failed-mandatory-gate`               | `verification.start-verification.v1`, `verification.failed.v1`, `review.recommendation-issued.v1`                             | ADR 0005; failure catalog           |
| `verifier-retry-idempotency`          | `verification.start-verification.v1`, `verification.passed.v1`                                                                | ADRs 0005 and 0006; failure catalog |
| `attempt-exhaustion`                  | `workshop.attempt-ended.v1`                                                                                                   | ADR 0004; failure catalog           |
| `human-rejection-retry`               | `rejectMissionCompletion`, `mission.retry-authorized.v1`, `workshop.create-attempt.v1`                                        | ADRs 0004 and 0005; failure catalog |
| `cancellation-revoke`                 | `cancelMission`, `mission.cancelled.v1`, `workshop.revoke-attempt.v1`, `workshop.attempt-ended.v1`                            | ADR 0004; failure catalog           |
| `poison-message-controlled-replay`    | malformed then valid `workshop.artifact-submitted.v1`, `verification.start-verification.v1`                                   | ADR 0006; failure catalog           |
| `conflicting-artifact-resubmission`   | `submitArtifact` conflict                                                                                                     | failure catalog                     |
| `stale-completion-bindings`           | `rejectMissionCompletion` conflict                                                                                            | ADR 0005; failure catalog           |
| `self-verification-rejected`          | verifier assignment policy                                                                                                    | ADR 0005; failure catalog           |
| `verification-infrastructure-aborted` | `verification.aborted.v1`                                                                                                     | ADRs 0004–0005; failure catalog     |
| `retryable-verification-abort`        | `verification.aborted.v1`, `mission.retry-authorized.v1`, `workshop.create-attempt.v1`                                        | ADRs 0004–0005; failure catalog     |
| `telemetry-outage-domain-continuity`  | durable verification cascade                                                                                                  | ADR 0006; failure catalog           |

Relevant sources:

- [`docs/en/workflows/canonical-demo.md`](../docs/en/workflows/canonical-demo.md)
- [`docs/en/workflows/failure-catalog.md`](../docs/en/workflows/failure-catalog.md)
- [`docs/en/domain/bounded-contexts.md`](../docs/en/domain/bounded-contexts.md)
- [`docs/en/decisions/0004-process-manager-ownership.md`](../docs/en/decisions/0004-process-manager-ownership.md)
- [`docs/en/decisions/0005-independent-verification.md`](../docs/en/decisions/0005-independent-verification.md)
- [`docs/en/decisions/0006-at-least-once-delivery.md`](../docs/en/decisions/0006-at-least-once-delivery.md)

## Conformance rules

An implementation passes a scenario only when:

1. inputs are applied in ascending `sequence` order;
2. each step returns the declared outcome and business-effect count;
3. published messages match kind, type, payload subset, message identity,
   correlation, and direct causation, while scoped suppressions remain absent;
4. final aggregate/process/read-model snapshots match `expected`;
5. correlation, causation, and idempotency identities are preserved; and
6. no observation depends on traces or on exactly-once delivery.

The `body` of a deliberately poison input is expected to violate its named
message contract. Every other HTTP or integration input must validate against
the normative v1 contract before the scenario is executed.
For a byte-identical redelivery, `{ "sameAsSequence": N }` resolves to the
fully specified body of input `N` before contract validation and execution.
