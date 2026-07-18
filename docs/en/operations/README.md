# Operations

PatchQuest has no executable platform in this phase. Operational documentation
will be added with real health, readiness, migration, demo, failure-demo, reset,
and shutdown commands. Until then, this directory must not describe aspirational
commands or imply that arbitrary submissions are safely sandboxed.

The language-neutral HTTP contract nevertheless defines the required
`replayDeadLetter` operator operation now, so every future stack implements the
same safety, idempotency, validation, and audit semantics. This is a contract,
not a claim that an endpoint is currently running.

All eight state-changing HTTP operations require `X-Request-Id` as a UUID
causation identity. It identifies one inbound request and therefore changes on
a transport retry. `Idempotency-Key` identifies the logical command and stays
stable across that retry; `X-Correlation-Id` connects the wider workflow. These
three identities are intentionally not interchangeable.

`getMissionCompletionReview` exposes the exact public recommendation,
verification run, artifact, gate-set, and evidence-bundle bindings needed to
construct an approval or rejection request. Mission creation and all four CQRS
reads are intentionally public in the educational contract. Human approval,
rejection, and cancellation require provider-neutral bearer authentication and
local human-role authorization; runner lease, heartbeat, and artifact submission
require the same authentication with local runner-role authorization. Controlled
replay requires local operations-role authorization. The replacement envelope
is the sole source of its message type and identity; the request cannot supply
redundant values that disagree with it.
