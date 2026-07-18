# Ubiquitous language

| Term                  | Meaning                                                                                                                                                | Owner                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| Mission               | The versioned contract for one desired coding outcome.                                                                                                 | Mission Control            |
| Objective             | A concise statement of the required outcome.                                                                                                           | Mission Control            |
| Starting Revision     | The immutable source revision from which work begins.                                                                                                  | Mission Control            |
| Allowed Scope         | Immutable path policy carried by an attempt and enforced later by Verification's trusted `check-allowed-scope` gate, not by Workshop submission.       | Mission Control            |
| Requested Capability  | A provider-neutral ability required from a runner.                                                                                                     | Mission Control            |
| Acceptance Gate       | An executable, immutable check required for completion.                                                                                                | Mission Control            |
| Gate Command ID       | A portable registry key resolved to trusted verifier code by each stack; never mission-supplied executable text.                                       | Shared contract identifier |
| Gate-set Digest       | A digest identifying the exact acceptance-gate set.                                                                                                    | Mission Control            |
| Attempt Budget        | The positive maximum number of authorized attempts.                                                                                                    | Mission Control            |
| Completion Approval   | A human decision bound to an exact artifact and verdict.                                                                                               | Mission Control            |
| Attempt               | One authorized execution opportunity for one mission revision.                                                                                         | Workshop                   |
| Runner                | An actor behind a runner port that can perform an attempt.                                                                                             | Workshop                   |
| Runner Lease          | Time-bounded ownership of an attempt by one runner, including its original duration; it is expired when authoritative `now >= expiresAt`.              | Workshop                   |
| Heartbeat             | Owner-authenticated activity that atomically renews expiry from authoritative time using the lease's original duration; it is not completion.          | Workshop                   |
| Workspace             | The isolated working view prepared from the starting revision.                                                                                         | Workshop                   |
| Artifact              | An immutable submitted result addressed by digest and reference; Workshop validates path topology while Verification decides allowed-scope compliance. | Workshop                   |
| Attempt Outcome       | The single terminal result of an attempt.                                                                                                              | Workshop                   |
| Revocation            | An authority action that ends a `READY` or `LEASED` attempt as `REVOKED`; it is not a lease-owner abandon or failure.                                  | Workshop                   |
| Verification Plan     | The checks derived from the immutable acceptance gates.                                                                                                | Verification and Review    |
| Acceptance Check      | One deterministic gate checkpoint, executed in canonical `gateId` order and committed with its stable idempotency key and bounded result evidence.     | Verification and Review    |
| Artifact Digest       | A content-derived identity for the submitted artifact.                                                                                                 | Shared contract identifier |
| Verdict               | `PASSED` or `FAILED`, derived only from completed acceptance checks.                                                                                   | Verification and Review    |
| Verification Aborted  | A technical outcome where infrastructure or cancellation prevented a gate verdict; never a failed gate.                                                | Verification and Review    |
| Evidence Bundle       | The complete ordered check-result set and digest, assembled only after every gate has a committed result.                                              | Verification and Review    |
| Completion Review     | Evaluation binding one exact artifact, verification run, verdict, and evidence bundle for a mission revision.                                          | Verification and Review    |
| Review Recommendation | One immutable `APPROVE` or `REQUEST_REVISION` advice issued by Completion Review; not a human decision.                                                | Verification and Review    |
| Controlled Replay     | An operator-authorized, idempotent, audited replacement of one dead-lettered message after optimistic state and contract checks.                       | Operations contract        |
| Correlation ID        | Identifier connecting one workflow across service boundaries.                                                                                          | Integration contract       |
| Causation ID          | Identifier of the message or action that caused another.                                                                                               | Integration contract       |
| Lease Response Replay | Confidential exact-response record that returns the original opaque token after committed response loss without publishing or aggregate persistence.   | Workshop                   |

These terms are deliberately provider-neutral. “Prompt,” model names, SDK
objects, tool calls, and API keys are adapter concerns, not domain language.
