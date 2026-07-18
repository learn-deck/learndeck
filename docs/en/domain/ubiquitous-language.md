# Ubiquitous language

| Term                  | Meaning                                                                                                                          | Owner                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Mission               | The versioned contract for one desired coding outcome.                                                                           | Mission Control            |
| Objective             | A concise statement of the required outcome.                                                                                     | Mission Control            |
| Starting Revision     | The immutable source revision from which work begins.                                                                            | Mission Control            |
| Allowed Scope         | Paths and capabilities that a submitted change may touch.                                                                        | Mission Control            |
| Requested Capability  | A provider-neutral ability required from a runner.                                                                               | Mission Control            |
| Acceptance Gate       | An executable, immutable check required for completion.                                                                          | Mission Control            |
| Gate Command ID       | A portable registry key resolved to trusted verifier code by each stack; never mission-supplied executable text.                 | Shared contract identifier |
| Gate-set Digest       | A digest identifying the exact acceptance-gate set.                                                                              | Mission Control            |
| Attempt Budget        | The positive maximum number of authorized attempts.                                                                              | Mission Control            |
| Completion Approval   | A human decision bound to an exact artifact and verdict.                                                                         | Mission Control            |
| Attempt               | One authorized execution opportunity for one mission revision.                                                                   | Workshop                   |
| Runner                | An actor behind a runner port that can perform an attempt.                                                                       | Workshop                   |
| Runner Lease          | Time-bounded ownership of an attempt by one runner, evaluated against a durable authoritative time source.                       | Workshop                   |
| Heartbeat             | Evidence that a lease owner remains active; it is not completion.                                                                | Workshop                   |
| Workspace             | The isolated working view prepared from the starting revision.                                                                   | Workshop                   |
| Artifact              | An immutable submitted result addressed by digest and reference.                                                                 | Workshop                   |
| Attempt Outcome       | The single terminal result of an attempt.                                                                                        | Workshop                   |
| Verification Plan     | The checks derived from the immutable acceptance gates.                                                                          | Verification and Review    |
| Acceptance Check      | One deterministic verification step and its bounded evidence.                                                                    | Verification and Review    |
| Artifact Digest       | A content-derived identity for the submitted artifact.                                                                           | Shared contract identifier |
| Verdict               | `PASSED` or `FAILED`, derived only from completed acceptance checks.                                                             | Verification and Review    |
| Verification Aborted  | A technical outcome where infrastructure or cancellation prevented a gate verdict; never a failed gate.                          | Verification and Review    |
| Evidence Bundle       | Bounded check results and digests supporting a verdict.                                                                          | Verification and Review    |
| Completion Review     | Evaluation binding one exact artifact, verification run, verdict, and evidence bundle for a mission revision.                    | Verification and Review    |
| Review Recommendation | One immutable `APPROVE` or `REQUEST_REVISION` advice issued by Completion Review; not a human decision.                          | Verification and Review    |
| Controlled Replay     | An operator-authorized, idempotent, audited replacement of one dead-lettered message after optimistic state and contract checks. | Operations contract        |
| Correlation ID        | Identifier connecting one workflow across service boundaries.                                                                    | Integration contract       |
| Causation ID          | Identifier of the message or action that caused another.                                                                         | Integration contract       |

These terms are deliberately provider-neutral. “Prompt,” model names, SDK
objects, tool calls, and API keys are adapter concerns, not domain language.
