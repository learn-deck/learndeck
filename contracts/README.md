# Language-neutral contracts

This directory is the normative shared boundary for every PatchQuest
implementation.

- `openapi/patchquest.v1.yaml` defines the OpenAPI 3.1 human, runner, operator,
  and CQRS read contracts required by the canonical demo: twelve HTTP
  operations in total.
- `asyncapi/patchquest.v1.yaml` defines one channel, operation, and message for
  each of the three directed commands and twelve published events: fifteen
  integration messages in total.
- `schemas/v1/shared.schema.json` defines identifiers, SHA-256 digests,
  acceptance gates, artifacts, and exact verification bindings.
- `schemas/v1/command-envelope.schema.json` and
  `schemas/v1/event-envelope.schema.json` are stable v1 metadata envelopes.
- `schemas/v1/integration-messages.schema.json` closes every v1 message payload.
- `schemas/v1/catalog.json` is the machine-readable inventory used for parity
  checks across the OpenAPI, AsyncAPI, and schema documents.

`MissionCompletionProcess` exposes only three public commands:
`workshop.create-attempt.v1`, `verification.start-verification.v1`, and
`workshop.revoke-attempt.v1`. They are imperative requests with one recipient.
The twelve past-tense events are facts published by their owning contexts.
Internal application commands do not become transport contracts.

`docs/en/contracts/gate-command-registry.md` normatively defines gate-set
canonicalization and the portable v1 `commandId` registry. A `commandId` is a
registry key, never executable text supplied by a mission. Each stack maps the
same keys to trusted local verifier adapters.

HTTP reads are eventually consistent projections, not exported aggregates.
Unknown request and message fields are rejected. Consumers assume at-least-once
delivery and deduplicate by `commandId` or `eventId`. A breaking v1 payload
change requires a newly versioned operation or message.

Every state-changing HTTP operation requires `X-Request-Id` and
`Idempotency-Key`. `X-Request-Id` is a UUID for one inbound request and becomes
its causation identity; `Idempotency-Key` is stable across retries of one
logical command; `X-Correlation-Id` follows the whole workflow and may be
created by the server when omitted.

Mission creation and all four CQRS read operations are intentionally public in
the canonical educational contract. Public projections must omit credentials,
prompts, patch contents, and private verifier output. Human approval, rejection,
and cancellation; runner lease, heartbeat, and artifact submission; and
controlled replay require provider-neutral bearer authentication plus local
role authorization. The contract does not prescribe an identity provider,
token format, claims, or scopes. A deployment may protect public operations at
an external admission layer without changing these portable domain contracts.

Controlled DLQ replay is the bearer-authenticated, operator-only
`replayDeadLetter` operation. It uses optimistic dead-letter revision and
digest checks, validates a distinct replacement against exactly one nested
command or event contract, derives type and identity only from that envelope,
and records operator, reason, and linkage as immutable audit data.

## Phase 3 validation tooling

The Node verification gate pins its contract tooling in
`/node/package-lock.json`:

- Redocly CLI validates the OpenAPI 3.1 document offline;
- `@asyncapi/parser` parses and semantically validates the AsyncAPI 3.0 document
  in-process from `scripts/verify-repository.ts`;
- Ajv plus `ajv-formats` validates Draft 2020-12 schemas and fixtures.

AsyncAPI validation deliberately uses the parser library rather than the
AsyncAPI CLI. The repository needs structured parser diagnostics and the parsed
document in the same verifier process for reference, message, channel,
operation, catalog, and scenario-payload parity checks. A separate CLI pass
would duplicate parsing without providing that typed in-process data.

Repository scripts invoke locked local dependencies. They do not use floating
`npx`, remote validators, or globally installed tools as the verification gate.

These contracts contain no Node, Fastify, PostgreSQL, RabbitMQ, provider SDK,
database entity, or implementation source type. A future stack must be able to
implement them without reading `/node`.

The Node consumer mirrors this boundary in `node/packages/contracts`: closed,
readonly TypeScript unions for exactly the three public commands and twelve
public events. It contains transport DTOs and message-type inventories only,
never Mission, Attempt, VerificationRun, CompletionReview, process-manager, or
persistence models.
