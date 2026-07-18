import type {
  MissionCancelledV1,
  MissionCompletedV1,
  MissionRetryAuthorizedV1,
  ReviewRecommendationIssuedV1,
  VerificationAbortedV1,
  VerificationFailedV1,
  VerificationPassedV1,
  WorkshopArtifactSubmittedV1,
  WorkshopAttemptEndedV1,
  WorkshopAttemptLeasedV1,
  WorkshopAttemptReadyV1,
} from "@patchquest/contracts";
import { describe, expect, it } from "vitest";
import {
  MissionCompletionProcess,
  type RetryDispatch,
} from "../../apps/mission-control/src/application/mission-completion-process.ts";
import { normalizedContentFingerprint } from "../../apps/mission-control/src/application/message-validation.ts";
import {
  Mission,
  calculateGateSetDigest,
  type MissionAcceptanceGate,
  type MissionProcessSeed,
} from "../../apps/mission-control/src/domain/mission.ts";

const now = "2026-07-12T10:00:00Z";
const correlationId = "corr-process-1";
const gates: readonly MissionAcceptanceGate[] = [
  {
    gateId: "tests",
    kind: "TEST",
    commandId: "check-tests",
    mandatory: true,
    timeoutSeconds: 60,
    evidenceLimitBytes: 16_384,
  },
];
const gateSetDigest = calculateGateSetDigest(gates);
const artifact = {
  reference: "urn:patchquest:artifact:1",
  digest: { algorithm: "sha256", value: "b".repeat(64) },
  changedPaths: ["src/shipping/quote.ts"],
} as const;
const evidenceBundleDigest = {
  algorithm: "sha256",
  value: "c".repeat(64),
} as const;

function seed(attemptBudget = 3): MissionProcessSeed {
  const drafted = Mission.draft({
    missionId: "mission-1",
    missionRevision: 1,
    objective: "Implement shipping quote.",
    startingRevision: "fixture-shipping-v1",
    workspaceReference: "urn:patchquest:fixture:shipping-quote",
    allowedScope: { pathPatterns: ["src/shipping/**"] },
    requestedCapabilities: ["edit-trusted-fixture"],
    attemptBudget,
  });
  if (!drafted.ok) throw new Error(drafted.error.message);
  const mission = drafted.value;
  const defined = mission.defineAcceptanceGates({
    acceptanceGates: gates,
    gateSetDigest,
  });
  if (!defined.ok) throw new Error(defined.error.message);
  const opened = mission.open({ attemptId: "attempt-1" });
  if (!opened.ok) throw new Error(opened.error.message);
  return opened.value.processSeed;
}

function start(attemptBudget = 3) {
  const result = MissionCompletionProcess.start(seed(attemptBudget), {
    openedEventId: "event-opened-1",
    commandId: "command-create-1",
    issuedAt: now,
    correlationId,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

function attemptReady(
  attemptId = "attempt-1",
  attemptNumber = 1,
  eventId = "event-ready-1",
): WorkshopAttemptReadyV1 {
  return {
    eventId,
    eventType: "workshop.attempt-ready.v1",
    schemaVersion: 1,
    occurredAt: now,
    producer: "workshop",
    subjectId: attemptId,
    correlationId,
    causationId: "command-create-1",
    data: {
      attemptId,
      missionId: "mission-1",
      missionRevision: 1,
      startingRevision: "fixture-shipping-v1",
      attemptNumber,
      requestedCapabilities: ["edit-trusted-fixture"],
    },
  };
}

function attemptLeased(eventId = "event-leased-1"): WorkshopAttemptLeasedV1 {
  return {
    eventId,
    eventType: "workshop.attempt-leased.v1",
    schemaVersion: 1,
    occurredAt: now,
    producer: "workshop",
    subjectId: "attempt-1",
    correlationId,
    causationId: "request-lease-1",
    data: {
      attemptId: "attempt-1",
      runnerId: "runner-1",
      leaseId: "lease-1",
      runnerCapabilities: ["edit-trusted-fixture"],
      expiresAt: "2026-07-12T10:01:00Z",
    },
  };
}

function artifactSubmitted(
  eventId = "event-artifact-1",
): WorkshopArtifactSubmittedV1 {
  return {
    eventId,
    eventType: "workshop.artifact-submitted.v1",
    schemaVersion: 1,
    occurredAt: now,
    producer: "workshop",
    subjectId: "attempt-1",
    correlationId,
    causationId: "request-submit-1",
    data: {
      attemptId: "attempt-1",
      missionId: "mission-1",
      missionRevision: 1,
      startingRevision: "fixture-shipping-v1",
      runnerId: "runner-1",
      artifact,
      gateSetDigest,
    },
  };
}

function binding() {
  return {
    missionId: "mission-1",
    missionRevision: 1,
    startingRevision: "fixture-shipping-v1",
    artifactDigest: artifact.digest,
    gateSetDigest,
  } as const;
}

function passed(eventId = "event-passed-1"): VerificationPassedV1 {
  return {
    eventId,
    eventType: "verification.passed.v1",
    schemaVersion: 1,
    occurredAt: now,
    producer: "verification-and-review",
    subjectId: "verification-1",
    correlationId,
    causationId: "command-verification-1",
    data: {
      verificationRunId: "verification-1",
      attemptId: "attempt-1",
      binding: binding(),
      verifierId: "verifier-1",
      verdict: "PASSED",
      checkCount: 1,
      evidenceBundleDigest,
    },
  };
}

function recommendation(
  eventId = "event-recommendation-1",
): ReviewRecommendationIssuedV1 {
  return {
    eventId,
    eventType: "review.recommendation-issued.v1",
    schemaVersion: 1,
    occurredAt: now,
    producer: "verification-and-review",
    subjectId: "review-1",
    correlationId,
    causationId: "event-passed-1",
    data: {
      completionReviewId: "review-1",
      verificationRunId: "verification-1",
      binding: binding(),
      verdict: "PASSED",
      evidenceBundleDigest,
      recommendation: "APPROVE",
    },
  };
}

function retry(
  reason: MissionRetryAuthorizedV1["data"]["reason"],
  causationId: string,
): RetryDispatch {
  return {
    commandId: "command-create-2",
    issuedAt: now,
    attemptId: "attempt-2",
    authorization: {
      eventId: "event-retry-2",
      eventType: "mission.retry-authorized.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "mission-control",
      subjectId: "mission-1",
      correlationId,
      causationId,
      data: {
        missionId: "mission-1",
        missionRevision: 1,
        nextAttemptNumber: 2,
        attemptBudget: 3,
        reason,
      },
    },
  };
}

function toVerifying(process: MissionCompletionProcess): void {
  process.recordAttemptReady(attemptReady());
  process.recordAttemptLeased(attemptLeased());
  process.recordArtifactSubmitted(artifactSubmitted(), {
    commandId: "command-verification-1",
    verificationRunId: "verification-1",
    issuedAt: now,
  });
  process.markVerificationDispatched("command-verification-1");
}

describe("MissionCompletionProcess", () => {
  it("starts from the full open result and sends the immutable work contract", () => {
    const { process, result } = start();
    expect(result).toMatchObject({
      ok: true,
      snapshot: { state: "ATTEMPT_REQUESTED", attemptsAuthorized: 1 },
      commands: [
        {
          commandType: "workshop.create-attempt.v1",
          correlationId,
          causationId: "event-opened-1",
          data: {
            attemptId: "attempt-1",
            attemptNumber: 1,
            workspaceReference: "urn:patchquest:fixture:shipping-quote",
            acceptanceGates: gates,
          },
        },
      ],
    });
    expect(process.snapshot.verificationRunId).toBeUndefined();
  });

  it("preserves direct causation when artifact submission starts verification", () => {
    const { process } = start();
    process.recordAttemptReady(attemptReady());
    process.recordAttemptLeased(attemptLeased());
    const result = process.recordArtifactSubmitted(artifactSubmitted(), {
      commandId: "command-verification-1",
      verificationRunId: "verification-1",
      issuedAt: now,
    });
    expect(result).toMatchObject({
      ok: true,
      snapshot: { state: "VERIFICATION_REQUESTED" },
      commands: [
        {
          commandType: "verification.start-verification.v1",
          correlationId,
          causationId: "event-artifact-1",
          data: {
            attemptId: "attempt-1",
            producingRunnerId: "runner-1",
            binding: { artifactDigest: artifact.digest, gateSetDigest },
          },
        },
      ],
    });
    expect(
      process.markVerificationDispatched("command-verification-1"),
    ).toMatchObject({
      ok: true,
      snapshot: { state: "VERIFYING" },
    });
  });

  it("ignores duplicate and stale facts without outgoing intent", () => {
    const { process } = start();
    const ready = attemptReady();
    expect(process.recordAttemptReady(ready)).toMatchObject({
      ok: true,
      disposition: "applied",
    });
    expect(process.recordAttemptReady(ready)).toMatchObject({
      ok: true,
      disposition: "idempotent",
      commands: [],
    });
    const stale = attemptReady("attempt-stale", 1, "event-ready-stale");
    expect(process.recordAttemptReady(stale)).toMatchObject({
      ok: true,
      disposition: "ignored",
      commands: [],
    });
  });

  it.each([
    ["LEASE_EXPIRED", "ATTEMPT_EXPIRED"],
    ["FAILED", "ATTEMPT_FAILED"],
    ["ABANDONED", "ATTEMPT_FAILED"],
  ] as const)("authorizes a bounded retry after %s", (outcome, reason) => {
    const { process } = start();
    process.recordAttemptReady(attemptReady());
    process.recordAttemptLeased(attemptLeased());
    const ended: WorkshopAttemptEndedV1 = {
      eventId: `event-ended-${outcome}`,
      eventType: "workshop.attempt-ended.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "workshop",
      subjectId: "attempt-1",
      correlationId,
      causationId: "runner-fact",
      data: {
        attemptId: "attempt-1",
        missionId: "mission-1",
        missionRevision: 1,
        outcome,
      },
    };
    const result = process.recordAttemptEnded(
      ended,
      retry(reason, ended.eventId),
    );
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        state: "RETRY_REQUESTED",
        attemptId: "attempt-2",
        attemptsAuthorized: 2,
      },
      commands: [
        {
          commandType: "workshop.create-attempt.v1",
          causationId: "event-retry-2",
          data: { attemptNumber: 2 },
        },
      ],
    });
  });

  it("rejects a retry authorization with indirect causation without partial state", () => {
    const { process } = start();
    process.recordAttemptReady(attemptReady());
    process.recordAttemptLeased(attemptLeased());
    const ended: WorkshopAttemptEndedV1 = {
      eventId: "event-ended-failed",
      eventType: "workshop.attempt-ended.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "workshop",
      subjectId: "attempt-1",
      correlationId,
      causationId: "runner-fact",
      data: {
        attemptId: "attempt-1",
        missionId: "mission-1",
        missionRevision: 1,
        outcome: "FAILED",
      },
    };
    const before = process.snapshot;
    const result = process.recordAttemptEnded(
      ended,
      retry("ATTEMPT_FAILED", "not-the-ended-event"),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_PROCESS_FACT" },
    });
    expect(process.snapshot).toEqual(before);
  });

  it("rejects reuse of an already authorized attempt ID without partial state", () => {
    const { process } = start();
    process.recordAttemptReady(attemptReady());
    process.recordAttemptLeased(attemptLeased());
    const ended: WorkshopAttemptEndedV1 = {
      eventId: "event-ended-duplicate-attempt",
      eventType: "workshop.attempt-ended.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "workshop",
      subjectId: "attempt-1",
      correlationId,
      causationId: "runner-fact",
      data: {
        attemptId: "attempt-1",
        missionId: "mission-1",
        missionRevision: 1,
        outcome: "FAILED",
      },
    };
    const before = process.snapshot;
    expect(
      process.recordAttemptEnded(ended, {
        ...retry("ATTEMPT_FAILED", ended.eventId),
        attemptId: "attempt-1",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_PROCESS_FACT" },
    });
    expect(process.snapshot).toEqual(before);
  });

  it("routes a retryable abort through VERIFICATION_ABORTED and never resumes the run", () => {
    const { process } = start();
    toVerifying(process);
    const aborted: VerificationAbortedV1 = {
      eventId: "event-aborted-1",
      eventType: "verification.aborted.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "verification-and-review",
      subjectId: "verification-1",
      correlationId,
      causationId: "command-verification-1",
      data: {
        verificationRunId: "verification-1",
        attemptId: "attempt-1",
        binding: binding(),
        verifierId: "verifier-1",
        outcome: "ABORTED",
        reason: "EXECUTION_INFRASTRUCTURE_FAILURE",
        retryable: true,
      },
    };
    const result = process.recordVerificationAborted(
      aborted,
      retry("VERIFICATION_ABORTED", aborted.eventId),
    );
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        state: "RETRY_REQUESTED",
        attemptId: "attempt-2",
      },
      commands: [{ causationId: "event-retry-2" }],
    });
    if (result.ok) expect(result.snapshot.verificationRunId).toBeUndefined();
  });

  it("stops at human decision when an abort is not authorized to retry", () => {
    const { process } = start();
    toVerifying(process);
    const aborted: VerificationAbortedV1 = {
      eventId: "event-aborted-1",
      eventType: "verification.aborted.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "verification-and-review",
      subjectId: "verification-1",
      correlationId,
      causationId: "command-verification-1",
      data: {
        verificationRunId: "verification-1",
        attemptId: "attempt-1",
        binding: binding(),
        verifierId: "verifier-1",
        outcome: "ABORTED",
        reason: "WORKSPACE_UNAVAILABLE",
        retryable: false,
      },
    };
    expect(process.recordVerificationAborted(aborted)).toMatchObject({
      ok: true,
      snapshot: { state: "NEEDS_HUMAN_DECISION" },
      commands: [],
    });
  });

  it("moves from exact verdict and recommendation to human completion", () => {
    const { process } = start();
    toVerifying(process);
    expect(process.recordVerificationVerdict(passed())).toMatchObject({
      ok: true,
      snapshot: { state: "VERIFYING" },
    });
    expect(process.recordReviewRecommendation(recommendation())).toMatchObject({
      ok: true,
      snapshot: {
        state: "AWAITING_HUMAN_REVIEW",
        completionReviewId: "review-1",
      },
    });
    const completed: MissionCompletedV1 = {
      eventId: "event-completed-1",
      eventType: "mission.completed.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "mission-control",
      subjectId: "mission-1",
      correlationId,
      causationId: "request-approve-1",
      data: {
        missionId: "mission-1",
        missionRevision: 1,
        completionReviewId: "review-1",
        recommendation: "APPROVE",
        verificationRunId: "verification-1",
        artifactDigest: artifact.digest,
        gateSetDigest,
        evidenceBundleDigest,
        approvedBy: "human-reviewer",
      },
    };
    expect(process.complete(completed)).toMatchObject({
      ok: true,
      snapshot: { state: "COMPLETED" },
      commands: [],
    });
  });

  it("clears rejected cycle bindings before attempt two reaches a fresh approval", () => {
    const { process } = start();
    toVerifying(process);
    process.recordVerificationVerdict(passed());
    process.recordReviewRecommendation(recommendation());
    expect(
      process.recordHumanRejection(
        "decision-reject-1",
        retry("HUMAN_AUTHORIZED", "decision-reject-1"),
      ),
    ).toMatchObject({
      ok: true,
      snapshot: {
        state: "RETRY_REQUESTED",
        attemptId: "attempt-2",
        attemptsAuthorized: 2,
      },
    });
    expect(process.snapshot.verificationRunId).toBeUndefined();
    expect(process.snapshot.completionReviewId).toBeUndefined();

    const ready2: WorkshopAttemptReadyV1 = {
      ...attemptReady("attempt-2", 2, "event-ready-2"),
      causationId: "command-create-2",
    };
    const leased2: WorkshopAttemptLeasedV1 = {
      ...attemptLeased("event-leased-2"),
      subjectId: "attempt-2",
      data: { ...attemptLeased().data, attemptId: "attempt-2" },
    };
    const artifact2: WorkshopArtifactSubmittedV1 = {
      ...artifactSubmitted("event-artifact-2"),
      subjectId: "attempt-2",
      data: { ...artifactSubmitted().data, attemptId: "attempt-2" },
    };
    process.recordAttemptReady(ready2);
    process.recordAttemptLeased(leased2);
    process.recordArtifactSubmitted(artifact2, {
      commandId: "command-verification-2",
      verificationRunId: "verification-2",
      issuedAt: now,
    });
    process.markVerificationDispatched("command-verification-2");
    const passed2: VerificationPassedV1 = {
      ...passed("event-passed-2"),
      subjectId: "verification-2",
      causationId: "command-verification-2",
      data: {
        ...passed().data,
        verificationRunId: "verification-2",
        attemptId: "attempt-2",
      },
    };
    const recommendation2: ReviewRecommendationIssuedV1 = {
      ...recommendation("event-recommendation-2"),
      subjectId: "review-2",
      causationId: "event-passed-2",
      data: {
        ...recommendation().data,
        completionReviewId: "review-2",
        verificationRunId: "verification-2",
      },
    };
    expect(process.recordVerificationVerdict(passed2)).toMatchObject({
      ok: true,
      disposition: "applied",
    });
    expect(process.recordReviewRecommendation(recommendation2)).toMatchObject({
      ok: true,
      snapshot: {
        state: "AWAITING_HUMAN_REVIEW",
        completionReviewId: "review-2",
      },
    });
    const restored = MissionCompletionProcess.rehydrate(process.toMemento());
    expect(restored).toMatchObject({ ok: true });
    if (!restored.ok) return;
    const completed2: MissionCompletedV1 = {
      eventId: "event-completed-2",
      eventType: "mission.completed.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "mission-control",
      subjectId: "mission-1",
      correlationId,
      causationId: "request-approve-2",
      data: {
        missionId: "mission-1",
        missionRevision: 1,
        completionReviewId: "review-2",
        recommendation: "APPROVE",
        verificationRunId: "verification-2",
        artifactDigest: artifact.digest,
        gateSetDigest,
        evidenceBundleDigest,
        approvedBy: "human-reviewer",
      },
    };
    expect(restored.process.complete(completed2)).toMatchObject({
      ok: true,
      snapshot: { state: "COMPLETED" },
    });
  });

  it("makes terminal verification first-wins across duplicate IDs and verdict kinds", () => {
    const { process } = start();
    toVerifying(process);
    const winner = passed();
    expect(process.recordVerificationVerdict(winner)).toMatchObject({
      ok: true,
      disposition: "applied",
    });
    expect(
      process.recordVerificationVerdict({
        ...winner,
        data: { ...winner.data, checkCount: 2 },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "MESSAGE_ID_CONFLICT" },
    });
    const failed: VerificationFailedV1 = {
      ...winner,
      eventId: "event-failed-conflict",
      eventType: "verification.failed.v1",
      data: {
        ...winner.data,
        verdict: "FAILED",
        failedGateIds: ["tests"],
      },
    };
    expect(process.recordVerificationVerdict(failed)).toMatchObject({
      ok: false,
      error: { code: "CONFLICTING_VERIFICATION_FACT" },
    });
    expect(
      process.recordVerificationVerdict({
        ...winner,
        eventId: "event-passed-duplicate-delivery",
        occurredAt: "2026-07-12T10:01:00Z",
      }),
    ).toMatchObject({ ok: true, disposition: "idempotent" });
  });

  it("enforces direct causation for verdicts and recommendations", () => {
    const { process } = start();
    toVerifying(process);
    expect(
      process.recordVerificationVerdict({
        ...passed(),
        causationId: "not-the-verification-command",
      }),
    ).toMatchObject({ ok: false, error: { code: "STALE_FACT" } });
    expect(process.recordVerificationVerdict(passed())).toMatchObject({
      ok: true,
    });
    expect(
      process.recordReviewRecommendation({
        ...recommendation(),
        causationId: "not-the-winning-verdict",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_TRANSITION" },
    });
  });

  it("rehydrates mid-flow with fingerprints and identical continuation", () => {
    const { process } = start();
    toVerifying(process);
    const restored = MissionCompletionProcess.rehydrate(
      structuredClone(process.toMemento()),
    );
    expect(restored).toMatchObject({ ok: true });
    if (!restored.ok) return;
    expect(restored.process.snapshot).toEqual(process.snapshot);
    expect(restored.process.recordVerificationVerdict(passed())).toEqual(
      process.recordVerificationVerdict(passed()),
    );
    expect(
      MissionCompletionProcess.rehydrate({
        ...process.toMemento(),
        mementoVersion: 2,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_VERSION_UNSUPPORTED" },
    });
    expect(
      MissionCompletionProcess.rehydrate({
        ...process.toMemento(),
        attemptsAuthorized: 2,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_MEMENTO_INVALID" },
    });
    expect(
      MissionCompletionProcess.rehydrate({
        ...process.toMemento(),
        workContract: {
          ...process.toMemento().workContract,
          gateSetDigest: { algorithm: "sha256", value: "0".repeat(64) },
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_MEMENTO_INVALID" },
    });
  });

  it("clones artifact inputs and makes dispatch acknowledgement idempotent", () => {
    const { process } = start();
    process.recordAttemptReady(attemptReady());
    process.recordAttemptLeased(attemptLeased());
    const mutable = structuredClone(artifactSubmitted());
    expect(
      process.recordArtifactSubmitted(mutable, {
        commandId: "command-verification-1",
        verificationRunId: "verification-1",
        issuedAt: now,
      }),
    ).toMatchObject({ ok: true });
    const mutableArtifact = mutable.data.artifact as unknown as {
      changedPaths: string[];
      digest: { value: string };
    };
    mutableArtifact.changedPaths[0] = "mutated.ts";
    mutableArtifact.digest.value = "f".repeat(64);
    expect(process.toMemento().artifact).toEqual(artifact);
    expect(
      process.markVerificationDispatched("command-verification-1"),
    ).toMatchObject({ ok: true, disposition: "applied" });
    expect(
      process.markVerificationDispatched("command-verification-1"),
    ).toMatchObject({ ok: true, disposition: "idempotent" });
  });

  it("revokes requested/active work on cancellation", () => {
    for (const active of [false, true]) {
      const { process } = start();
      process.recordAttemptReady(attemptReady());
      if (active) process.recordAttemptLeased(attemptLeased());
      const cancelled: MissionCancelledV1 = {
        eventId: `event-cancelled-${active}`,
        eventType: "mission.cancelled.v1",
        schemaVersion: 1,
        occurredAt: now,
        producer: "mission-control",
        subjectId: "mission-1",
        correlationId,
        causationId: "request-cancel",
        data: {
          missionId: "mission-1",
          missionRevision: 1,
          cancelledBy: "human-operator",
          reason: "No longer needed.",
        },
      };
      expect(
        process.cancel(cancelled, {
          commandId: `command-revoke-${active}`,
          issuedAt: now,
        }),
      ).toMatchObject({
        ok: true,
        snapshot: { state: "CANCELLED" },
        commands: [
          {
            commandType: "workshop.revoke-attempt.v1",
            causationId: cancelled.eventId,
            data: { attemptId: "attempt-1", reason: "MISSION_CANCELLED" },
          },
        ],
      });
    }
  });

  it("requires revoke metadata before mutating active cancellation state", () => {
    const { process } = start();
    const before = process.snapshot;
    const cancelled: MissionCancelledV1 = {
      eventId: "event-cancelled-missing-dispatch",
      eventType: "mission.cancelled.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "mission-control",
      subjectId: "mission-1",
      correlationId,
      causationId: "request-cancel",
      data: {
        missionId: "mission-1",
        missionRevision: 1,
        cancelledBy: "human-operator",
        reason: "No longer needed.",
      },
    };
    expect(process.cancel(cancelled)).toMatchObject({
      ok: false,
      error: { code: "INVALID_PROCESS_FACT" },
    });
    expect(process.snapshot).toEqual(before);
  });

  it("does not revoke after the artifact has moved to verification", () => {
    const { process } = start();
    toVerifying(process);
    const cancelled: MissionCancelledV1 = {
      eventId: "event-cancelled-verifying",
      eventType: "mission.cancelled.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "mission-control",
      subjectId: "mission-1",
      correlationId,
      causationId: "request-cancel",
      data: {
        missionId: "mission-1",
        missionRevision: 1,
        cancelledBy: "human-operator",
        reason: "No longer needed.",
      },
    };
    expect(process.cancel(cancelled)).toMatchObject({
      ok: true,
      snapshot: { state: "CANCELLED" },
      commands: [],
    });
  });

  it("does not let trace data influence state or commands", () => {
    const first = MissionCompletionProcess.start(seed(), {
      openedEventId: "event-opened-1",
      commandId: "command-create-1",
      issuedAt: now,
      correlationId,
      trace: { traceId: "trace-a", sampled: true },
    });
    const second = MissionCompletionProcess.start(seed(), {
      openedEventId: "event-opened-1",
      commandId: "command-create-1",
      issuedAt: now,
      correlationId,
      trace: { traceId: "trace-b", sampled: false },
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.result).toEqual(second.result);
    expect(first.process.snapshot).toEqual(second.process.snapshot);
    for (const process of [first.process, second.process]) {
      process.recordAttemptReady(attemptReady());
      process.recordAttemptLeased(attemptLeased());
    }
    const firstVerification = first.process.recordArtifactSubmitted(
      artifactSubmitted(),
      {
        commandId: "command-verification-1",
        verificationRunId: "verification-1",
        issuedAt: now,
        trace: { traceId: "dispatch-trace-a" },
      },
    );
    const secondVerification = second.process.recordArtifactSubmitted(
      artifactSubmitted(),
      {
        commandId: "command-verification-1",
        verificationRunId: "verification-1",
        issuedAt: now,
        trace: { traceId: "dispatch-trace-b" },
      },
    );
    expect(firstVerification).toEqual(secondVerification);
    expect(first.process.toMemento()).toEqual(second.process.toMemento());
  });

  it("validates outgoing metadata before mutation and deeply freezes emitted commands", () => {
    for (const metadata of [
      {
        openedEventId: "bad id",
        commandId: "command-create-1",
        issuedAt: now,
        correlationId,
      },
      {
        openedEventId: "event-opened-1",
        commandId: "bad id",
        issuedAt: now,
        correlationId,
      },
      {
        openedEventId: "event-opened-1",
        commandId: "command-create-1",
        issuedAt: "2026-04-31T10:00:00Z",
        correlationId,
      },
      {
        openedEventId: "event-opened-1",
        commandId: "command-create-1",
        issuedAt: now,
        correlationId: "bad id",
      },
    ]) {
      expect(MissionCompletionProcess.start(seed(), metadata)).toMatchObject({
        ok: false,
        error: { code: "INVALID_PROCESS_FACT" },
      });
    }

    const { process, result } = start();
    const createCommand = result.commands[0]!;
    if (createCommand.commandType !== "workshop.create-attempt.v1")
      throw new Error("unexpected opening command");
    expect(Object.isFrozen(createCommand)).toBe(true);
    expect(Object.isFrozen(createCommand.data)).toBe(true);
    expect(Object.isFrozen(createCommand.data.acceptanceGates)).toBe(true);
    process.recordAttemptReady(attemptReady());
    process.recordAttemptLeased(attemptLeased());
    const beforeDispatch = process.toMemento();
    expect(
      process.recordArtifactSubmitted(artifactSubmitted(), {
        commandId: "bad id",
        verificationRunId: "verification-1",
        issuedAt: now,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_PROCESS_FACT" } });
    expect(process.toMemento()).toEqual(beforeDispatch);

    const cancelled: MissionCancelledV1 = {
      eventId: "event-cancel-invalid-metadata",
      eventType: "mission.cancelled.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "mission-control",
      subjectId: "mission-1",
      correlationId,
      causationId: "request-cancel",
      data: {
        missionId: "mission-1",
        missionRevision: 1,
        cancelledBy: "human-reviewer",
        reason: "Stop.",
      },
    };
    expect(
      process.cancel(cancelled, {
        commandId: "command-revoke-1",
        issuedAt: "not-a-time",
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_PROCESS_FACT" } });
    expect(process.toMemento()).toEqual(beforeDispatch);

    const ended: WorkshopAttemptEndedV1 = {
      eventId: "event-ended-invalid-feedback",
      eventType: "workshop.attempt-ended.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "workshop",
      subjectId: "attempt-1",
      correlationId,
      causationId: "runner-fact",
      data: {
        attemptId: "attempt-1",
        missionId: "mission-1",
        missionRevision: 1,
        outcome: "FAILED",
      },
    };
    const invalidRetry = structuredClone(
      retry("ATTEMPT_FAILED", ended.eventId),
    );
    (
      invalidRetry.authorization.data as unknown as { feedback?: string }
    ).feedback = "x".repeat(2001);
    expect(process.recordAttemptEnded(ended, invalidRetry)).toMatchObject({
      ok: false,
      error: { code: "INVALID_PROCESS_FACT" },
    });
    expect(process.toMemento()).toEqual(beforeDispatch);
  });

  it("rejects open or accessor-backed process inputs before reading fields", () => {
    const openingMetadata = {
      openedEventId: "event-opened-topology",
      commandId: "command-create-topology",
      issuedAt: now,
      correlationId,
    };
    const withAccessor = (
      source: object,
      key: string,
    ): {
      readonly value: Record<string, unknown>;
      readonly reads: () => number;
    } => {
      const value = structuredClone(source) as Record<string, unknown>;
      const retained = value[key];
      delete value[key];
      let count = 0;
      Object.defineProperty(value, key, {
        enumerable: true,
        get() {
          count += 1;
          return retained;
        },
      });
      return { value, reads: () => count };
    };

    const openSeed = { ...seed(), unexpected: true };
    const openMetadata = { ...openingMetadata, unexpected: true };
    expect(
      MissionCompletionProcess.start(openSeed as never, openingMetadata),
    ).toMatchObject({ ok: false, error: { code: "INVALID_PROCESS_FACT" } });
    expect(
      MissionCompletionProcess.start(seed(), openMetadata as never),
    ).toMatchObject({ ok: false, error: { code: "INVALID_PROCESS_FACT" } });

    const accessorSeed = withAccessor(seed(), "missionId");
    expect(
      MissionCompletionProcess.start(
        accessorSeed.value as never,
        openingMetadata,
      ),
    ).toMatchObject({ ok: false, error: { code: "INVALID_PROCESS_FACT" } });
    expect(accessorSeed.reads()).toBe(0);

    const accessorOpening = withAccessor(openingMetadata, "issuedAt");
    expect(
      MissionCompletionProcess.start(seed(), accessorOpening.value as never),
    ).toMatchObject({ ok: false, error: { code: "INVALID_PROCESS_FACT" } });
    expect(accessorOpening.reads()).toBe(0);

    let nestedTraceReads = 0;
    const trace = {};
    Object.defineProperty(trace, "traceId", {
      enumerable: true,
      get() {
        nestedTraceReads += 1;
        return "trace-topology";
      },
    });
    expect(
      MissionCompletionProcess.start(seed(), {
        ...openingMetadata,
        trace,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_PROCESS_FACT" } });
    expect(nestedTraceReads).toBe(0);

    const { process } = start();
    const before = process.toMemento();
    const verificationDispatch = {
      commandId: "command-verification-topology",
      verificationRunId: "verification-topology",
      issuedAt: now,
    };
    expect(
      process.recordArtifactSubmitted(artifactSubmitted(), {
        ...verificationDispatch,
        unexpected: true,
      } as never),
    ).toMatchObject({ ok: false, error: { code: "INVALID_PROCESS_FACT" } });
    const accessorVerification = withAccessor(
      verificationDispatch,
      "verificationRunId",
    );
    expect(
      process.recordArtifactSubmitted(
        artifactSubmitted(),
        accessorVerification.value as never,
      ),
    ).toMatchObject({ ok: false, error: { code: "INVALID_PROCESS_FACT" } });
    expect(accessorVerification.reads()).toBe(0);

    const ended: WorkshopAttemptEndedV1 = {
      eventId: "event-ended-topology",
      eventType: "workshop.attempt-ended.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "workshop",
      subjectId: "attempt-1",
      correlationId,
      causationId: "runner-fact",
      data: {
        attemptId: "attempt-1",
        missionId: "mission-1",
        missionRevision: 1,
        outcome: "FAILED",
      },
    };
    const retryDispatch = retry("ATTEMPT_FAILED", ended.eventId);
    expect(
      process.recordAttemptEnded(ended, {
        ...retryDispatch,
        unexpected: true,
      } as never),
    ).toMatchObject({ ok: false, error: { code: "INVALID_PROCESS_FACT" } });
    const openAuthorization = structuredClone(retryDispatch);
    (openAuthorization.authorization as unknown as Record<string, unknown>)[
      "unexpected"
    ] = true;
    expect(process.recordAttemptEnded(ended, openAuthorization)).toMatchObject({
      ok: false,
      error: { code: "INVALID_PROCESS_FACT" },
    });
    const accessorRetry = withAccessor(retryDispatch, "authorization");
    expect(
      process.recordAttemptEnded(ended, accessorRetry.value as never),
    ).toMatchObject({ ok: false, error: { code: "INVALID_PROCESS_FACT" } });
    expect(accessorRetry.reads()).toBe(0);

    const cancelled: MissionCancelledV1 = {
      eventId: "event-cancelled-topology",
      eventType: "mission.cancelled.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "mission-control",
      subjectId: "mission-1",
      correlationId,
      causationId: "request-cancel-topology",
      data: {
        missionId: "mission-1",
        missionRevision: 1,
        cancelledBy: "human-reviewer",
        reason: "Stop.",
      },
    };
    const cancellationMetadata = {
      commandId: "command-revoke-topology",
      issuedAt: now,
    };
    expect(
      process.cancel(cancelled, {
        ...cancellationMetadata,
        unexpected: true,
      } as never),
    ).toMatchObject({ ok: false, error: { code: "INVALID_PROCESS_FACT" } });
    const accessorCancellation = withAccessor(
      cancellationMetadata,
      "commandId",
    );
    expect(
      process.cancel(cancelled, accessorCancellation.value as never),
    ).toMatchObject({ ok: false, error: { code: "INVALID_PROCESS_FACT" } });
    expect(accessorCancellation.reads()).toBe(0);
    expect(process.toMemento()).toEqual(before);
  });

  it("binds replay to the complete audited immutable seed", () => {
    const valid = start().process.toMemento();
    type MutableReplayProjection = {
      missionId: string;
      missionRevision: number;
      correlationId: string;
      attemptBudget: number;
      workContract: {
        objective: string;
        startingRevision: string;
        workspaceReference: string;
        allowedScope: { pathPatterns: string[] };
        requestedCapabilities: string[];
        acceptanceGates: MissionAcceptanceGate[];
        gateSetDigest: { algorithm: "sha256"; value: string };
      };
      auditTrail: Array<{
        kind: string;
        payload: {
          seed: {
            missionId: string;
            missionRevision: number;
            workContract: MutableReplayProjection["workContract"];
            attemptBudget: number;
            attemptsAuthorized: number;
            attemptId: string;
            attemptNumber: number;
          };
          metadata: {
            openedEventId: string;
            commandId: string;
            issuedAt: string;
            correlationId: string;
          };
        };
        previousDigest: string;
        entryDigest: string;
      }>;
    };
    const alternateGates: readonly MissionAcceptanceGate[] = [
      {
        gateId: "typecheck",
        kind: "TYPECHECK",
        commandId: "check-typecheck",
        mandatory: true,
        timeoutSeconds: 90,
        evidenceLimitBytes: 4096,
      },
    ];
    const mutations: Array<(value: MutableReplayProjection) => void> = [
      (value) => (value.missionId = "mission-2"),
      (value) => (value.missionRevision = 2),
      (value) => (value.correlationId = "corr-process-2"),
      (value) => (value.attemptBudget = 4),
      (value) => (value.workContract.objective = "A different objective."),
      (value) => (value.workContract.startingRevision = "fixture-shipping-v2"),
      (value) =>
        (value.workContract.workspaceReference =
          "urn:patchquest:fixture:different"),
      (value) =>
        (value.workContract.allowedScope.pathPatterns = ["src/other/**"]),
      (value) =>
        (value.workContract.requestedCapabilities = ["different-capability"]),
      (value) => {
        value.workContract.acceptanceGates = [...alternateGates];
        value.workContract.gateSetDigest =
          calculateGateSetDigest(alternateGates);
      },
      (value) =>
        (value.workContract.gateSetDigest = {
          algorithm: "sha256",
          value: "f".repeat(64),
        }),
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(
        valid,
      ) as unknown as MutableReplayProjection;
      mutate(changed);
      expect(MissionCompletionProcess.rehydrate(changed)).toMatchObject({
        ok: false,
        error: { code: "PERSISTENCE_MEMENTO_INVALID" },
      });
    }

    const auditMutations: Array<(value: MutableReplayProjection) => void> = [
      (value) =>
        (value.auditTrail[0]!.payload.seed.missionId = "mission-audit-2"),
      (value) => (value.auditTrail[0]!.payload.seed.missionRevision = 2),
      (value) =>
        (value.auditTrail[0]!.payload.seed.workContract.objective =
          "Changed inside the trusted audit seed."),
      (value) =>
        (value.auditTrail[0]!.payload.seed.workContract.startingRevision =
          "fixture-shipping-v2"),
      (value) =>
        (value.auditTrail[0]!.payload.seed.workContract.workspaceReference =
          "urn:patchquest:fixture:audit-change"),
      (value) =>
        (value.auditTrail[0]!.payload.seed.workContract.allowedScope.pathPatterns =
          ["src/audit-change/**"]),
      (value) =>
        (value.auditTrail[0]!.payload.seed.workContract.requestedCapabilities =
          ["audit-change"]),
      (value) =>
        (value.auditTrail[0]!.payload.seed.workContract.acceptanceGates[0] = {
          ...value.auditTrail[0]!.payload.seed.workContract.acceptanceGates[0]!,
          timeoutSeconds: 91,
        }),
      (value) =>
        (value.auditTrail[0]!.payload.seed.workContract.gateSetDigest.value =
          "e".repeat(64)),
      (value) => (value.auditTrail[0]!.payload.seed.attemptBudget = 4),
      (value) =>
        (value.auditTrail[0]!.payload.seed.attemptId = "attempt-audit"),
      (value) =>
        (value.auditTrail[0]!.payload.metadata.openedEventId =
          "event-opened-audit"),
      (value) =>
        (value.auditTrail[0]!.payload.metadata.commandId =
          "command-create-audit"),
      (value) =>
        (value.auditTrail[0]!.payload.metadata.issuedAt =
          "2026-07-12T11:00:00Z"),
      (value) =>
        (value.auditTrail[0]!.payload.metadata.correlationId =
          "corr-process-audit"),
    ];
    for (const mutate of auditMutations) {
      const changed = structuredClone(
        valid,
      ) as unknown as MutableReplayProjection;
      mutate(changed);
      expect(MissionCompletionProcess.rehydrate(changed)).toMatchObject({
        ok: false,
        error: { code: "PERSISTENCE_MEMENTO_INVALID" },
      });
    }

    const coherentAuditRewrite = structuredClone(
      valid,
    ) as unknown as MutableReplayProjection;
    coherentAuditRewrite.auditTrail[0]!.payload.seed.workContract.objective =
      "Changed inside a coherently re-digested audit seed.";
    let previousDigest = "0".repeat(64);
    for (const entry of coherentAuditRewrite.auditTrail) {
      entry.previousDigest = previousDigest;
      entry.entryDigest = normalizedContentFingerprint({
        kind: entry.kind,
        payload: entry.payload,
        previousDigest,
      });
      previousDigest = entry.entryDigest;
    }
    expect(
      MissionCompletionProcess.rehydrate(coherentAuditRewrite),
    ).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_MEMENTO_INVALID" },
    });
  });

  it("reserves outgoing IDs for the process lifetime across kinds and restarts", () => {
    expect(
      MissionCompletionProcess.start(seed(), {
        openedEventId: "same-opening-id",
        commandId: "same-opening-id",
        issuedAt: now,
        correlationId,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_PROCESS_FACT" } });

    const process = start().process;
    const outgoingCollision = attemptReady("attempt-1", 1, "event-opened-1");
    expect(process.recordAttemptReady(outgoingCollision)).toMatchObject({
      ok: false,
      error: { code: "MESSAGE_ID_CONFLICT" },
    });
    const selfCausal = {
      ...attemptReady("attempt-1", 1, "event-self-causal"),
      causationId: "event-self-causal",
    };
    expect(process.recordAttemptReady(selfCausal)).toMatchObject({
      ok: false,
      error: { code: "MESSAGE_ID_CONFLICT" },
    });

    process.recordAttemptReady(attemptReady());
    process.recordAttemptLeased(attemptLeased());
    const beforeVerification = process.toMemento();
    expect(
      process.recordArtifactSubmitted(artifactSubmitted(), {
        commandId: "command-create-1",
        verificationRunId: "verification-1",
        issuedAt: now,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_PROCESS_FACT" } });
    expect(process.toMemento()).toEqual(beforeVerification);

    const ended: WorkshopAttemptEndedV1 = {
      eventId: "event-ended-identity",
      eventType: "workshop.attempt-ended.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "workshop",
      subjectId: "attempt-1",
      correlationId,
      causationId: "runner-fact",
      data: {
        attemptId: "attempt-1",
        missionId: "mission-1",
        missionRevision: 1,
        outcome: "FAILED",
      },
    };
    const commandReuse = {
      ...retry("ATTEMPT_FAILED", ended.eventId),
      commandId: "command-create-1",
    };
    expect(process.recordAttemptEnded(ended, commandReuse)).toMatchObject({
      ok: false,
      error: { code: "INVALID_PROCESS_FACT" },
    });
    expect(process.toMemento()).toEqual(beforeVerification);
    const authorizationReuse = structuredClone(
      retry("ATTEMPT_FAILED", ended.eventId),
    );
    (authorizationReuse.authorization as unknown as Record<string, unknown>)[
      "eventId"
    ] = "event-opened-1";
    expect(process.recordAttemptEnded(ended, authorizationReuse)).toMatchObject(
      { ok: false, error: { code: "INVALID_PROCESS_FACT" } },
    );
    expect(process.toMemento()).toEqual(beforeVerification);

    const cancellation: MissionCancelledV1 = {
      eventId: "command-create-1",
      eventType: "mission.cancelled.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "mission-control",
      subjectId: "mission-1",
      correlationId,
      causationId: "request-cancel-identity",
      data: {
        missionId: "mission-1",
        missionRevision: 1,
        cancelledBy: "human-reviewer",
        reason: "Stop.",
      },
    };
    expect(
      process.cancel(cancellation, {
        commandId: "command-revoke-identity",
        issuedAt: now,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "MESSAGE_ID_CONFLICT" },
    });
    expect(process.toMemento()).toEqual(beforeVerification);
    expect(
      process.cancel(
        { ...cancellation, eventId: "event-cancel-identity" },
        { commandId: "command-create-1", issuedAt: now },
      ),
    ).toMatchObject({ ok: false, error: { code: "INVALID_PROCESS_FACT" } });
    expect(process.toMemento()).toEqual(beforeVerification);

    const restored = MissionCompletionProcess.rehydrate(
      structuredClone(process.toMemento()),
    );
    expect(restored).toMatchObject({ ok: true });
    if (!restored.ok) return;
    expect(
      restored.process.recordAttemptEnded(ended, commandReuse),
    ).toMatchObject({ ok: false, error: { code: "INVALID_PROCESS_FACT" } });
  });

  it("accepts late matching verification dispatch acknowledgements in every downstream state", () => {
    const withoutAck = () => {
      const { process } = start();
      process.recordAttemptReady(attemptReady());
      process.recordAttemptLeased(attemptLeased());
      process.recordArtifactSubmitted(artifactSubmitted(), {
        commandId: "command-verification-1",
        verificationRunId: "verification-1",
        issuedAt: now,
      });
      return process;
    };
    const abort = (
      reason: VerificationAbortedV1["data"]["reason"] = "WORKSPACE_UNAVAILABLE",
    ): VerificationAbortedV1 => ({
      eventId: `event-abort-${reason}`,
      eventType: "verification.aborted.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "verification-and-review",
      subjectId: "verification-1",
      correlationId,
      causationId: "command-verification-1",
      data: {
        verificationRunId: "verification-1",
        attemptId: "attempt-1",
        binding: binding(),
        verifierId: "verifier-1",
        outcome: "ABORTED",
        reason,
        retryable: false,
      },
    });
    const cancelled = (id: string): MissionCancelledV1 => ({
      eventId: id,
      eventType: "mission.cancelled.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "mission-control",
      subjectId: "mission-1",
      correlationId,
      causationId: "request-cancel",
      data: {
        missionId: "mission-1",
        missionRevision: 1,
        cancelledBy: "human-reviewer",
        reason: "Stop.",
      },
    });

    const downstream = [
      (() => {
        const process = withoutAck();
        process.recordVerificationVerdict(passed());
        return process;
      })(),
      (() => {
        const process = withoutAck();
        process.recordVerificationAborted(abort());
        return process;
      })(),
      (() => {
        const process = withoutAck();
        process.recordVerificationVerdict(passed());
        process.recordReviewRecommendation(recommendation());
        return process;
      })(),
      (() => {
        const process = withoutAck();
        process.cancel(cancelled("event-cancel-late-ack"));
        return process;
      })(),
    ];
    for (const process of downstream) {
      expect(
        process.markVerificationDispatched("command-verification-1"),
      ).toMatchObject({ ok: true, disposition: "idempotent" });
      expect(
        process.markVerificationDispatched("different-command"),
      ).toMatchObject({ ok: false, error: { code: "MESSAGE_ID_CONFLICT" } });
    }
  });

  it("converges cancellation and bound aborts in either order and rejects conflicts", () => {
    const cancelled = (id: string): MissionCancelledV1 => ({
      eventId: id,
      eventType: "mission.cancelled.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "mission-control",
      subjectId: "mission-1",
      correlationId,
      causationId: "request-cancel",
      data: {
        missionId: "mission-1",
        missionRevision: 1,
        cancelledBy: "human-reviewer",
        reason: "Stop.",
      },
    });
    const aborted = (
      id: string,
      reason: VerificationAbortedV1["data"]["reason"],
    ): VerificationAbortedV1 => ({
      eventId: id,
      eventType: "verification.aborted.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "verification-and-review",
      subjectId: "verification-1",
      correlationId,
      causationId: "command-verification-1",
      data: {
        verificationRunId: "verification-1",
        attemptId: "attempt-1",
        binding: binding(),
        verifierId: "verifier-1",
        outcome: "ABORTED",
        reason,
        retryable: false,
      },
    });

    const cancelFirst = start().process;
    toVerifying(cancelFirst);
    expect(cancelFirst.cancel(cancelled("event-cancel-first"))).toMatchObject({
      ok: true,
      snapshot: { state: "CANCELLED" },
    });
    expect(
      cancelFirst.recordVerificationAborted(
        aborted("event-cancel-abort-second", "MISSION_CANCELLED"),
      ),
    ).toMatchObject({ ok: true, snapshot: { state: "CANCELLED" } });

    const abortFirst = start().process;
    toVerifying(abortFirst);
    expect(
      abortFirst.recordVerificationAborted(
        aborted("event-cancel-abort-first", "MISSION_CANCELLED"),
      ),
    ).toMatchObject({ ok: true, snapshot: { state: "CANCELLED" } });
    expect(abortFirst.cancel(cancelled("event-cancel-second"))).toMatchObject({
      ok: true,
      snapshot: { state: "CANCELLED" },
    });

    const conflicting = start().process;
    toVerifying(conflicting);
    conflicting.cancel(cancelled("event-cancel-conflict"));
    expect(
      conflicting.recordVerificationAborted(
        aborted("event-wrong-abort", "WORKSPACE_UNAVAILABLE"),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "CONFLICTING_VERIFICATION_FACT" },
    });
  });

  it("supports either aggregate/process invocation order for a future atomic cancellation-abort handler", () => {
    const prepareAggregate = () => {
      const drafted = Mission.draft({
        missionId: "mission-1",
        missionRevision: 1,
        objective: "Implement shipping quote.",
        startingRevision: "fixture-shipping-v1",
        workspaceReference: "urn:patchquest:fixture:shipping-quote",
        allowedScope: { pathPatterns: ["src/shipping/**"] },
        requestedCapabilities: ["edit-trusted-fixture"],
        attemptBudget: 3,
      });
      if (!drafted.ok) throw new Error(drafted.error.message);
      drafted.value.defineAcceptanceGates({
        acceptanceGates: gates,
        gateSetDigest,
      });
      drafted.value.open({ attemptId: "attempt-1" });
      drafted.value.recordArtifactSubmitted({
        missionRevision: 1,
        attemptId: "attempt-1",
        startingRevision: "fixture-shipping-v1",
        artifactDigest: artifact.digest,
        gateSetDigest,
      });
      drafted.value.cancel({
        missionRevision: 1,
        cancelledBy: "human-reviewer",
        reason: "Stop.",
      });
      return drafted.value;
    };
    for (const order of ["aggregate-first", "process-first"] as const) {
      const aggregate = prepareAggregate();
      const process = start().process;
      toVerifying(process);
      process.cancel({
        eventId: `event-cancel-${order}`,
        eventType: "mission.cancelled.v1",
        schemaVersion: 1,
        occurredAt: now,
        producer: "mission-control",
        subjectId: "mission-1",
        correlationId,
        causationId: `request-cancel-${order}`,
        data: {
          missionId: "mission-1",
          missionRevision: 1,
          cancelledBy: "human-reviewer",
          reason: "Stop.",
        },
      });
      const event: VerificationAbortedV1 = {
        eventId: `event-bound-cancel-abort-${order}`,
        eventType: "verification.aborted.v1",
        schemaVersion: 1,
        occurredAt: now,
        producer: "verification-and-review",
        subjectId: "verification-1",
        correlationId,
        causationId: "command-verification-1",
        data: {
          verificationRunId: "verification-1",
          attemptId: "attempt-1",
          binding: binding(),
          verifierId: "verifier-1",
          outcome: "ABORTED",
          reason: "MISSION_CANCELLED",
          retryable: false,
        },
      };
      const aggregateOperation = () =>
        aggregate.recordVerificationAborted({
          attemptId: event.data.attemptId,
          verificationRunId: event.data.verificationRunId,
          binding: event.data.binding,
          reason: event.data.reason,
          retryable: event.data.retryable,
        });
      const processOperation = () => process.recordVerificationAborted(event);
      const results =
        order === "aggregate-first"
          ? [aggregateOperation(), processOperation()]
          : [processOperation(), aggregateOperation()];
      for (const result of results)
        expect(result, order).toMatchObject({ ok: true });
      expect(aggregate.snapshot.status).toBe("CANCELLED");
      expect(process.snapshot.state).toBe("CANCELLED");
      expect(aggregateOperation()).toMatchObject({
        ok: true,
        disposition: "idempotent",
      });
      expect(processOperation()).toMatchObject({
        ok: true,
        disposition: "idempotent",
      });
    }
  });

  it("accepts every reachable process state memento and rejects an invariant mutation per state", () => {
    const requested = start().process;
    const active = start().process;
    active.recordAttemptReady(attemptReady());
    active.recordAttemptLeased(attemptLeased());
    const verificationRequested = start().process;
    verificationRequested.recordAttemptReady(attemptReady());
    verificationRequested.recordAttemptLeased(attemptLeased());
    verificationRequested.recordArtifactSubmitted(artifactSubmitted(), {
      commandId: "command-verification-1",
      verificationRunId: "verification-1",
      issuedAt: now,
    });
    const verifying = start().process;
    toVerifying(verifying);
    const awaiting = start().process;
    toVerifying(awaiting);
    awaiting.recordVerificationVerdict(passed());
    awaiting.recordReviewRecommendation(recommendation());
    const retrying = start().process;
    retrying.recordAttemptReady(attemptReady());
    retrying.recordAttemptLeased(attemptLeased());
    const ended: WorkshopAttemptEndedV1 = {
      eventId: "event-ended-matrix",
      eventType: "workshop.attempt-ended.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "workshop",
      subjectId: "attempt-1",
      correlationId,
      causationId: "runner-fact",
      data: {
        attemptId: "attempt-1",
        missionId: "mission-1",
        missionRevision: 1,
        outcome: "FAILED",
      },
    };
    retrying.recordAttemptEnded(ended, retry("ATTEMPT_FAILED", ended.eventId));
    const needs = start().process;
    needs.recordAttemptReady(attemptReady());
    needs.recordAttemptLeased(attemptLeased());
    needs.recordAttemptEnded({ ...ended, eventId: "event-ended-needs" });
    const completed = start().process;
    toVerifying(completed);
    completed.recordVerificationVerdict(passed());
    completed.recordReviewRecommendation(recommendation());
    const completeEvent: MissionCompletedV1 = {
      eventId: "event-complete-matrix",
      eventType: "mission.completed.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "mission-control",
      subjectId: "mission-1",
      correlationId,
      causationId: "decision-approve",
      data: {
        missionId: "mission-1",
        missionRevision: 1,
        completionReviewId: "review-1",
        recommendation: "APPROVE",
        verificationRunId: "verification-1",
        artifactDigest: artifact.digest,
        gateSetDigest,
        evidenceBundleDigest,
        approvedBy: "human-reviewer",
      },
    };
    completed.complete(completeEvent);
    const cancelledProcess = start().process;
    const cancelEvent: MissionCancelledV1 = {
      eventId: "event-cancel-matrix",
      eventType: "mission.cancelled.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "mission-control",
      subjectId: "mission-1",
      correlationId,
      causationId: "request-cancel",
      data: {
        missionId: "mission-1",
        missionRevision: 1,
        cancelledBy: "human-reviewer",
        reason: "Stop.",
      },
    };
    cancelledProcess.cancel(cancelEvent, {
      commandId: "command-revoke-matrix",
      issuedAt: now,
    });

    const cases = [
      ["ATTEMPT_REQUESTED", requested],
      ["ATTEMPT_ACTIVE", active],
      ["VERIFICATION_REQUESTED", verificationRequested],
      ["VERIFYING", verifying],
      ["AWAITING_HUMAN_REVIEW", awaiting],
      ["RETRY_REQUESTED", retrying],
      ["NEEDS_HUMAN_DECISION", needs],
      ["COMPLETED", completed],
      ["CANCELLED", cancelledProcess],
    ] as const;
    for (const [state, process] of cases) {
      const valid = process.toMemento();
      expect(valid.state).toBe(state);
      expect(
        MissionCompletionProcess.rehydrate(structuredClone(valid)),
      ).toMatchObject({ ok: true });
      const invalid = structuredClone(valid) as unknown as Record<
        string,
        unknown
      >;
      if (state === "VERIFICATION_REQUESTED") delete invalid["artifact"];
      else if (state === "VERIFYING") delete invalid["producingRunnerId"];
      else if (state === "AWAITING_HUMAN_REVIEW")
        delete invalid["recommendationEvent"];
      else if (state === "COMPLETED") delete invalid["terminalOutcome"];
      else {
        invalid["producingRunnerId"] = "runner-impossible";
      }
      expect(MissionCompletionProcess.rehydrate(invalid), state).toMatchObject({
        ok: false,
        error: { code: "PERSISTENCE_MEMENTO_INVALID" },
      });

      const forgedState = structuredClone(valid) as unknown as Record<
        string,
        unknown
      >;
      forgedState["state"] = state === "COMPLETED" ? "CANCELLED" : "COMPLETED";
      expect(
        MissionCompletionProcess.rehydrate(forgedState),
        `${state} forged state`,
      ).toMatchObject({
        ok: false,
        error: { code: "PERSISTENCE_MEMENTO_INVALID" },
      });

      const missingFingerprint = structuredClone(valid);
      (
        missingFingerprint.outgoingMessageIds as unknown as Array<unknown>
      ).splice(0, 1);
      expect(
        MissionCompletionProcess.rehydrate(missingFingerprint),
        `${state} missing fingerprint`,
      ).toMatchObject({
        ok: false,
        error: { code: "PERSISTENCE_MEMENTO_INVALID" },
      });

      const missingTransitionFact = structuredClone(valid);
      (missingTransitionFact.auditTrail as unknown as Array<unknown>).splice(
        -1,
        1,
      );
      expect(
        MissionCompletionProcess.rehydrate(missingTransitionFact),
        `${state} missing transition fact`,
      ).toMatchObject({
        ok: false,
        error: { code: "PERSISTENCE_MEMENTO_INVALID" },
      });
    }
  });

  it("rejects sparse top-level and nested process memento arrays", () => {
    const process = start().process;
    toVerifying(process);
    process.recordVerificationVerdict(passed());
    const valid = process.toMemento();
    const mutations: Array<(value: Record<string, unknown>) => void> = [
      (value) => (value["authorizedAttemptIds"] = new Array(1)),
      (value) => (value["messageFingerprints"] = new Array(1)),
      (value) => (value["outcomeFingerprintsByRun"] = new Array(1)),
      (value) => (value["verificationHistory"] = new Array(1)),
      (value) => (value["verificationDispatches"] = new Array(1)),
      (value) => (value["verificationAcknowledgements"] = new Array(1)),
      (value) => (value["outgoingMessageIds"] = new Array(1)),
      (value) => (value["auditTrail"] = new Array(1)),
      (value) => {
        const pairs = value["messageFingerprints"] as unknown[];
        pairs[0] = new Array(2);
      },
      (value) => {
        const contract = value["workContract"] as Record<string, unknown>;
        contract["acceptanceGates"] = new Array(1);
      },
      (value) => {
        const contract = value["workContract"] as Record<string, unknown>;
        contract["requestedCapabilities"] = new Array(1);
      },
      (value) => {
        const contract = value["workContract"] as Record<string, unknown>;
        const scope = contract["allowedScope"] as Record<string, unknown>;
        scope["pathPatterns"] = new Array(1);
      },
      (value) => {
        const artifactValue = value["artifact"] as Record<string, unknown>;
        artifactValue["changedPaths"] = new Array(1);
      },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(valid) as unknown as Record<
        string,
        unknown
      >;
      mutate(changed);
      expect(MissionCompletionProcess.rehydrate(changed)).toMatchObject({
        ok: false,
        error: { code: "PERSISTENCE_MEMENTO_INVALID" },
      });
    }
  });

  it("keeps prior verification dispatch acknowledgements durable across retry reset", () => {
    const { process } = start();
    process.recordAttemptReady(attemptReady());
    process.recordAttemptLeased(attemptLeased());
    process.recordArtifactSubmitted(artifactSubmitted(), {
      commandId: "command-verification-1",
      verificationRunId: "verification-1",
      issuedAt: now,
    });
    const aborted: VerificationAbortedV1 = {
      eventId: "event-abort-before-ack",
      eventType: "verification.aborted.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "verification-and-review",
      subjectId: "verification-1",
      correlationId,
      causationId: "command-verification-1",
      data: {
        verificationRunId: "verification-1",
        attemptId: "attempt-1",
        binding: binding(),
        verifierId: "verifier-1",
        outcome: "ABORTED",
        reason: "EXECUTION_INFRASTRUCTURE_FAILURE",
        retryable: true,
        evidenceBundleDigest,
        detail: "The isolated verifier lost its worker.",
      },
    };
    expect(
      process.recordVerificationAborted(
        aborted,
        retry("VERIFICATION_ABORTED", aborted.eventId),
      ),
    ).toMatchObject({
      ok: true,
      snapshot: { state: "RETRY_REQUESTED", attemptId: "attempt-2" },
    });
    expect(
      process.markVerificationDispatched("command-verification-1"),
    ).toMatchObject({ ok: true, disposition: "idempotent" });
    expect(
      process.markVerificationDispatched("unknown-verification-command"),
    ).toMatchObject({ ok: false, error: { code: "MESSAGE_ID_CONFLICT" } });

    const restored = MissionCompletionProcess.rehydrate(
      structuredClone(process.toMemento()),
    );
    expect(restored).toMatchObject({ ok: true });
    if (!restored.ok) return;
    expect(
      restored.process.markVerificationDispatched("command-verification-1"),
    ).toMatchObject({ ok: true, disposition: "idempotent" });
  });

  it("rejects verification run reuse across retries before emitting or mutating", () => {
    const { process } = start();
    toVerifying(process);
    const aborted: VerificationAbortedV1 = {
      eventId: "event-abort-for-run-reuse",
      eventType: "verification.aborted.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "verification-and-review",
      subjectId: "verification-1",
      correlationId,
      causationId: "command-verification-1",
      data: {
        verificationRunId: "verification-1",
        attemptId: "attempt-1",
        binding: binding(),
        verifierId: "verifier-1",
        outcome: "ABORTED",
        reason: "WORKSPACE_UNAVAILABLE",
        retryable: true,
      },
    };
    process.recordVerificationAborted(
      aborted,
      retry("VERIFICATION_ABORTED", aborted.eventId),
    );
    const ready2: WorkshopAttemptReadyV1 = {
      ...attemptReady("attempt-2", 2, "event-ready-run-reuse"),
      causationId: "command-create-2",
    };
    const leased2: WorkshopAttemptLeasedV1 = {
      ...attemptLeased("event-leased-run-reuse"),
      subjectId: "attempt-2",
      data: { ...attemptLeased().data, attemptId: "attempt-2" },
    };
    const artifact2: WorkshopArtifactSubmittedV1 = {
      ...artifactSubmitted("event-artifact-run-reuse"),
      subjectId: "attempt-2",
      data: { ...artifactSubmitted().data, attemptId: "attempt-2" },
    };
    process.recordAttemptReady(ready2);
    process.recordAttemptLeased(leased2);
    const before = process.toMemento();
    expect(
      process.recordArtifactSubmitted(artifact2, {
        commandId: "command-verification-reused",
        verificationRunId: "verification-1",
        issuedAt: now,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_PROCESS_FACT" } });
    expect(process.toMemento()).toEqual(before);
  });

  it("preserves optional abort evidence/detail and recommendation reason through persistence", () => {
    const abortProcess = start().process;
    toVerifying(abortProcess);
    const aborted: VerificationAbortedV1 = {
      eventId: "event-abort-optionals",
      eventType: "verification.aborted.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "verification-and-review",
      subjectId: "verification-1",
      correlationId,
      causationId: "command-verification-1",
      data: {
        verificationRunId: "verification-1",
        attemptId: "attempt-1",
        binding: binding(),
        verifierId: "verifier-1",
        outcome: "ABORTED",
        reason: "WORKSPACE_UNAVAILABLE",
        retryable: false,
        evidenceBundleDigest,
        detail: "Workspace checkout was unavailable.",
      },
    };
    abortProcess.recordVerificationAborted(aborted);
    expect(abortProcess.toMemento().terminalOutcome).toEqual(aborted);
    expect(
      MissionCompletionProcess.rehydrate(
        structuredClone(abortProcess.toMemento()),
      ),
    ).toMatchObject({ ok: true });

    const reviewProcess = start().process;
    toVerifying(reviewProcess);
    reviewProcess.recordVerificationVerdict(passed());
    const withReason: ReviewRecommendationIssuedV1 = {
      ...recommendation(),
      data: {
        ...recommendation().data,
        reason: "All mandatory gates passed with bound evidence.",
      },
    };
    reviewProcess.recordReviewRecommendation(withReason);
    expect(reviewProcess.toMemento().recommendationEvent).toEqual(withReason);
    expect(
      MissionCompletionProcess.rehydrate(
        structuredClone(reviewProcess.toMemento()),
      ),
    ).toMatchObject({ ok: true });
  });

  it("preserves exact-redelivery and same-ID conflict semantics after restart", () => {
    const process = start().process;
    toVerifying(process);
    const event = passed();
    process.recordVerificationVerdict(event);
    const restored = MissionCompletionProcess.rehydrate(
      structuredClone(process.toMemento()),
    );
    expect(restored).toMatchObject({ ok: true });
    if (!restored.ok) return;
    expect(restored.process.recordVerificationVerdict(event)).toMatchObject({
      ok: true,
      disposition: "idempotent",
    });
    expect(
      restored.process.recordVerificationVerdict({
        ...event,
        data: {
          ...event.data,
          evidenceBundleDigest: {
            algorithm: "sha256",
            value: "d".repeat(64),
          },
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "MESSAGE_ID_CONFLICT" } });
  });

  it("rejects foreign historical facts even when their fingerprints are recomputed", () => {
    const process = start().process;
    toVerifying(process);
    const aborted: VerificationAbortedV1 = {
      eventId: "event-abort-foreign-history",
      eventType: "verification.aborted.v1",
      schemaVersion: 1,
      occurredAt: now,
      producer: "verification-and-review",
      subjectId: "verification-1",
      correlationId,
      causationId: "command-verification-1",
      data: {
        verificationRunId: "verification-1",
        attemptId: "attempt-1",
        binding: binding(),
        verifierId: "verifier-1",
        outcome: "ABORTED",
        reason: "WORKSPACE_UNAVAILABLE",
        retryable: true,
      },
    };
    process.recordVerificationAborted(
      aborted,
      retry("VERIFICATION_ABORTED", aborted.eventId),
    );
    const forged = structuredClone(process.toMemento());
    const historical = forged.verificationHistory[0] as unknown as {
      eventId: string;
      occurredAt: string;
      data: { verificationRunId: string; binding: { missionId: string } };
      [key: string]: unknown;
    };
    historical.data.binding.missionId = "mission-foreign";
    const audit = forged.auditTrail.find(
      (entry) => entry.kind === "ABORTED",
    ) as unknown as {
      payload: {
        event: {
          data: { binding: { missionId: string } };
        };
      };
    };
    audit.payload.event.data.binding.missionId = "mission-foreign";
    const messageEntry = forged.messageFingerprints.find(
      ([id]) => id === historical.eventId,
    ) as unknown as [string, string];
    messageEntry[1] = testFingerprint(historical);
    const outcomeMaterial = Object.fromEntries(
      Object.entries(historical).filter(
        ([key]) => key !== "eventId" && key !== "occurredAt",
      ),
    );
    const outcomeEntry = forged.outcomeFingerprintsByRun.find(
      ([id]) => id === historical.data.verificationRunId,
    ) as unknown as [string, string];
    outcomeEntry[1] = testFingerprint(outcomeMaterial);
    expect(MissionCompletionProcess.rehydrate(forged)).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_MEMENTO_INVALID" },
    });
  });
});

function testFingerprint(value: unknown): string {
  return normalizedContentFingerprint(value);
}
