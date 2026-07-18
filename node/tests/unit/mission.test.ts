import { describe, expect, it } from "vitest";
import { createAndOpenMission } from "../../apps/mission-control/src/application/create-mission.ts";
import {
  Mission,
  calculateGateSetDigest,
  type CompletionBinding,
  type MissionAcceptanceGate,
  type MissionDigest,
} from "../../apps/mission-control/src/domain/mission.ts";

const artifactDigest: MissionDigest = {
  algorithm: "sha256",
  value: "b".repeat(64),
};
const evidenceDigest: MissionDigest = {
  algorithm: "sha256",
  value: "c".repeat(64),
};
const gates: readonly MissionAcceptanceGate[] = [
  {
    gateId: "tests",
    kind: "TEST",
    commandId: "check-tests",
    mandatory: true,
    timeoutSeconds: 60,
    evidenceLimitBytes: 16_384,
  },
  {
    gateId: "allowed-scope",
    kind: "ALLOWED_SCOPE",
    commandId: "check-allowed-scope",
    mandatory: true,
    timeoutSeconds: 10,
    evidenceLimitBytes: 4096,
  },
];
const gateSetDigest = calculateGateSetDigest(gates);

function draft(attemptBudget = 2): Mission {
  const result = Mission.draft({
    missionId: "mission-1",
    missionRevision: 1,
    objective: "Implement the shipping quote.",
    startingRevision: "fixture-shipping-v1",
    workspaceReference: "urn:patchquest:fixture:shipping-quote",
    allowedScope: { pathPatterns: ["src/shipping/**"] },
    requestedCapabilities: ["edit-trusted-fixture"],
    attemptBudget,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function open(attemptBudget = 2): Mission {
  const mission = draft(attemptBudget);
  const defined = mission.defineAcceptanceGates({
    acceptanceGates: gates,
    gateSetDigest,
  });
  if (!defined.ok) throw new Error(defined.error.message);
  const opened = mission.open({ attemptId: "attempt-1" });
  if (!opened.ok) throw new Error(opened.error.message);
  return mission;
}

function verificationBinding() {
  return {
    missionId: "mission-1",
    missionRevision: 1,
    startingRevision: "fixture-shipping-v1",
    artifactDigest,
    gateSetDigest,
  } as const;
}

function completionBinding(): CompletionBinding {
  return {
    missionRevision: 1,
    completionReviewId: "review-1",
    recommendation: "APPROVE",
    verificationRunId: "verification-1",
    artifactDigest,
    gateSetDigest,
    evidenceBundleDigest: evidenceDigest,
  };
}

function advanceToReview(mission: Mission): void {
  expect(
    mission.recordAttemptLeased({
      missionRevision: 1,
      attemptId: "attempt-1",
      attemptNumber: 1,
    }).ok,
  ).toBe(true);
  expect(
    mission.recordArtifactSubmitted({
      missionRevision: 1,
      attemptId: "attempt-1",
      startingRevision: "fixture-shipping-v1",
      artifactDigest,
      gateSetDigest,
    }).ok,
  ).toBe(true);
  expect(
    mission.recordVerificationVerdict({
      attemptId: "attempt-1",
      verificationRunId: "verification-1",
      binding: verificationBinding(),
      verdict: "PASSED",
      evidenceBundleDigest: evidenceDigest,
    }).ok,
  ).toBe(true);
  expect(
    mission.recordReviewRecommendation({
      completionReviewId: "review-1",
      verificationRunId: "verification-1",
      binding: verificationBinding(),
      verdict: "PASSED",
      evidenceBundleDigest: evidenceDigest,
      recommendation: "APPROVE",
    }).ok,
  ).toBe(true);
}

describe("Mission", () => {
  it("treats public creation as atomic Draft -> DefineGates -> Open", () => {
    const result = createAndOpenMission({
      missionId: "mission-atomic",
      missionRevision: 1,
      objective: "Implement the shipping quote.",
      startingRevision: "fixture-shipping-v1",
      workspaceReference: "urn:patchquest:fixture:shipping-quote",
      allowedScope: { pathPatterns: ["src/shipping/**"] },
      requestedCapabilities: ["edit-trusted-fixture"],
      attemptBudget: 2,
      acceptanceGates: gates,
      gateSetDigest,
      attemptId: "attempt-atomic-1",
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        mission: { snapshot: { status: "OPEN", attemptsAuthorized: 1 } },
        opened: {
          processSeed: {
            attemptId: "attempt-atomic-1",
            workContract: {
              workspaceReference: "urn:patchquest:fixture:shipping-quote",
            },
          },
        },
      },
      events: [{ kind: "MISSION_OPENED" }],
    });
    const invalid = createAndOpenMission({
      missionId: "mission-atomic-invalid",
      missionRevision: 1,
      objective: "Implement the shipping quote.",
      startingRevision: "fixture-shipping-v1",
      workspaceReference: "urn:patchquest:fixture:shipping-quote",
      allowedScope: { pathPatterns: ["src/shipping/**"] },
      requestedCapabilities: ["edit-trusted-fixture"],
      attemptBudget: 2,
      acceptanceGates: gates,
      gateSetDigest: { algorithm: "sha256", value: "0".repeat(64) },
      attemptId: "attempt-atomic-1",
    });
    expect(invalid).toMatchObject({
      ok: false,
      error: { code: "GATE_SET_DIGEST_MISMATCH" },
    });
    expect("value" in invalid).toBe(false);
  });

  it("matches the normative four-gate digest vector independent of input order", () => {
    const vector: readonly MissionAcceptanceGate[] = [
      gates[0]!,
      {
        gateId: "lint",
        kind: "LINT",
        commandId: "check-lint",
        mandatory: true,
        timeoutSeconds: 30,
        evidenceLimitBytes: 8192,
      },
      {
        gateId: "typecheck",
        kind: "TYPECHECK",
        commandId: "check-typecheck",
        mandatory: true,
        timeoutSeconds: 30,
        evidenceLimitBytes: 8192,
      },
      gates[1]!,
    ];
    expect(calculateGateSetDigest(vector).value).toBe(
      "bd060aa33a81ad01287b5bb18700a65f7c25707084f142ca044d6f1391a1833b",
    );
  });

  it.each([
    ["", "valid mission ID"],
    ["mission-1", "valid mission"],
  ])("validates draft inputs: %s (%s)", (missionId) => {
    const result = Mission.draft({
      missionId,
      missionRevision: 1,
      objective: "objective",
      startingRevision: "revision",
      workspaceReference: "urn:patchquest:test",
      allowedScope: { pathPatterns: ["src/**"] },
      requestedCapabilities: ["edit"],
      attemptBudget: 1,
    });
    expect(result.ok).toBe(missionId.length > 0);
  });

  it("rejects duplicate gates and a digest mismatch without opening", () => {
    const duplicate = draft().defineAcceptanceGates({
      acceptanceGates: [gates[0]!, gates[0]!],
      gateSetDigest,
    });
    expect(duplicate).toMatchObject({
      ok: false,
      error: { code: "DUPLICATE_GATE" },
    });

    const mission = draft();
    const mismatch = mission.defineAcceptanceGates({
      acceptanceGates: gates,
      gateSetDigest: { algorithm: "sha256", value: "0".repeat(64) },
    });
    expect(mismatch).toMatchObject({
      ok: false,
      error: { code: "GATE_SET_DIGEST_MISMATCH" },
    });
    expect(mission.snapshot.status).toBe("DRAFT");
  });

  it("freezes the complete work contract and seeds attempt one with workspace context", () => {
    const mission = draft();
    expect(
      mission.defineAcceptanceGates({ acceptanceGates: gates, gateSetDigest })
        .ok,
    ).toBe(true);
    const result = mission.open({ attemptId: "attempt-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.processSeed).toMatchObject({
      attemptsAuthorized: 1,
      attemptId: "attempt-1",
      attemptNumber: 1,
      workContract: {
        workspaceReference: "urn:patchquest:fixture:shipping-quote",
      },
    });
    expect(
      Object.isFrozen(result.value.processSeed.workContract.acceptanceGates),
    ).toBe(true);
    expect(
      mission.defineAcceptanceGates({ acceptanceGates: gates, gateSetDigest }),
    ).toMatchObject({
      ok: false,
      error: { code: "REQUIREMENTS_IMMUTABLE" },
    });
  });

  it("binds a passing recommendation and human approval exactly", () => {
    const mission = open();
    advanceToReview(mission);
    const result = mission.approveCompletion({
      ...completionBinding(),
      decidedBy: "human-reviewer",
    });
    expect(result).toMatchObject({
      ok: true,
      value: { status: "COMPLETED", humanDecision: "APPROVED" },
      events: [{ kind: "MISSION_COMPLETED", approvedBy: "human-reviewer" }],
    });
    expect(
      mission.authorizeAnotherAttempt({
        attemptId: "attempt-2",
        reason: "HUMAN_AUTHORIZED",
      }),
    ).toMatchObject({ ok: false, error: { code: "MISSION_TERMINAL" } });
  });

  it.each([
    ["missionRevision", 2],
    ["completionReviewId", "review-stale"],
    ["verificationRunId", "verification-stale"],
    ["artifactDigest", { algorithm: "sha256", value: "d".repeat(64) }],
    ["gateSetDigest", { algorithm: "sha256", value: "d".repeat(64) }],
    ["evidenceBundleDigest", { algorithm: "sha256", value: "d".repeat(64) }],
  ])("rejects a stale human binding field: %s", (field, replacement) => {
    const mission = open();
    advanceToReview(mission);
    const changed = { ...completionBinding(), [field]: replacement };
    const result = mission.rejectCompletion({
      ...changed,
      decidedBy: "human-reviewer",
      reason: "needs revision",
      authorizeAnotherAttempt: false,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "STALE_COMPLETION_BINDING" },
    });
    expect(mission.snapshot.humanDecision).toBeUndefined();
  });

  it("rejects approval for a failed verification", () => {
    const mission = open();
    mission.recordAttemptLeased({
      missionRevision: 1,
      attemptId: "attempt-1",
      attemptNumber: 1,
    });
    mission.recordArtifactSubmitted({
      missionRevision: 1,
      attemptId: "attempt-1",
      startingRevision: "fixture-shipping-v1",
      artifactDigest,
      gateSetDigest,
    });
    mission.recordVerificationVerdict({
      attemptId: "attempt-1",
      verificationRunId: "verification-1",
      binding: verificationBinding(),
      verdict: "FAILED",
      evidenceBundleDigest: evidenceDigest,
    });
    mission.recordReviewRecommendation({
      completionReviewId: "review-1",
      verificationRunId: "verification-1",
      binding: verificationBinding(),
      verdict: "FAILED",
      evidenceBundleDigest: evidenceDigest,
      recommendation: "REQUEST_REVISION",
    });
    expect(
      mission.approveCompletion({
        ...completionBinding(),
        decidedBy: "human-reviewer",
      }),
    ).toMatchObject({ ok: false, error: { code: "STALE_COMPLETION_BINDING" } });
  });

  it("preserves a rejection and atomically authorizes one bounded retry", () => {
    const mission = open();
    advanceToReview(mission);
    const result = mission.rejectCompletion({
      ...completionBinding(),
      decidedBy: "human-reviewer",
      reason: "Clarify the message.",
      authorizeAnotherAttempt: true,
      nextAttemptId: "attempt-2",
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "OPEN",
        attemptsAuthorized: 2,
        latestAttemptId: "attempt-2",
        cycleHistory: [
          {
            attemptId: "attempt-1",
            humanDecision: "REJECTED",
            decisionReason: "Clarify the message.",
          },
        ],
      },
      events: [
        {
          kind: "MISSION_RETRY_AUTHORIZED",
          reason: "HUMAN_AUTHORIZED",
          feedback: "Clarify the message.",
        },
      ],
    });
    expect(result.ok && result.value.humanDecision).toBeUndefined();
    expect(result.ok && result.value.latestArtifactDigest).toBeUndefined();
    expect(
      mission.recordVerificationVerdict({
        attemptId: "attempt-1",
        verificationRunId: "verification-1",
        binding: verificationBinding(),
        verdict: "PASSED",
        evidenceBundleDigest: evidenceDigest,
      }),
    ).toMatchObject({ ok: true, disposition: "idempotent" });
    expect(
      mission.recordVerificationVerdict({
        attemptId: "attempt-1",
        verificationRunId: "verification-1",
        binding: verificationBinding(),
        verdict: "PASSED",
        evidenceBundleDigest: {
          algorithm: "sha256",
          value: "f".repeat(64),
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "CONFLICTING_VERIFICATION_FACT" },
    });

    const artifact2 = { algorithm: "sha256", value: "d".repeat(64) } as const;
    const evidence2 = { algorithm: "sha256", value: "e".repeat(64) } as const;
    const binding2 = {
      ...verificationBinding(),
      artifactDigest: artifact2,
    };
    expect(
      mission.recordAttemptLeased({
        missionRevision: 1,
        attemptId: "attempt-2",
        attemptNumber: 2,
      }).ok,
    ).toBe(true);
    expect(
      mission.recordArtifactSubmitted({
        missionRevision: 1,
        attemptId: "attempt-2",
        startingRevision: "fixture-shipping-v1",
        artifactDigest: artifact2,
        gateSetDigest,
      }).ok,
    ).toBe(true);
    expect(
      mission.recordVerificationVerdict({
        attemptId: "attempt-2",
        verificationRunId: "verification-2",
        binding: binding2,
        verdict: "PASSED",
        evidenceBundleDigest: evidence2,
      }).ok,
    ).toBe(true);
    expect(
      mission.recordReviewRecommendation({
        completionReviewId: "review-2",
        verificationRunId: "verification-2",
        binding: binding2,
        verdict: "PASSED",
        evidenceBundleDigest: evidence2,
        recommendation: "APPROVE",
      }).ok,
    ).toBe(true);
    expect(
      mission.approveCompletion({
        missionRevision: 1,
        completionReviewId: "review-2",
        recommendation: "APPROVE",
        verificationRunId: "verification-2",
        artifactDigest: artifact2,
        gateSetDigest,
        evidenceBundleDigest: evidence2,
        decidedBy: "human-reviewer",
      }),
    ).toMatchObject({ ok: true, value: { status: "COMPLETED" } });
  });

  it("rejects conflicting terminal verification facts and duplicate attempt IDs", () => {
    const mission = open(3);
    mission.recordArtifactSubmitted({
      missionRevision: 1,
      attemptId: "attempt-1",
      startingRevision: "fixture-shipping-v1",
      artifactDigest,
      gateSetDigest,
    });
    expect(
      mission.recordVerificationVerdict({
        attemptId: "attempt-1",
        verificationRunId: "verification-1",
        binding: verificationBinding(),
        verdict: "PASSED",
        evidenceBundleDigest: evidenceDigest,
      }),
    ).toMatchObject({ ok: true, disposition: "applied" });
    expect(
      mission.recordVerificationAborted({
        attemptId: "attempt-1",
        verificationRunId: "verification-1",
        binding: verificationBinding(),
        reason: "WORKSPACE_UNAVAILABLE",
        retryable: true,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "CONFLICTING_VERIFICATION_FACT" },
    });
    expect(
      mission.authorizeAnotherAttempt({
        attemptId: "attempt-1",
        reason: "HUMAN_AUTHORIZED",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_TRANSITION" },
    });
  });

  it("rehydrates a complete memento without changing continuation behavior", () => {
    const mission = open(3);
    mission.recordArtifactSubmitted({
      missionRevision: 1,
      attemptId: "attempt-1",
      startingRevision: "fixture-shipping-v1",
      artifactDigest,
      gateSetDigest,
    });
    const memento = mission.toMemento();
    const restored = Mission.rehydrate(structuredClone(memento));
    expect(restored).toMatchObject({ ok: true });
    if (!restored.ok) return;
    expect(restored.value.snapshot).toEqual(mission.snapshot);
    const verdict = {
      attemptId: "attempt-1",
      verificationRunId: "verification-1",
      binding: verificationBinding(),
      verdict: "PASSED" as const,
      evidenceBundleDigest: evidenceDigest,
    };
    expect(restored.value.recordVerificationVerdict(verdict)).toEqual(
      mission.recordVerificationVerdict(verdict),
    );
    expect(Mission.rehydrate({ ...memento, mementoVersion: 2 })).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_VERSION_UNSUPPORTED" },
    });
    expect(
      Mission.rehydrate({ ...memento, attemptsAuthorized: 99 }),
    ).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_MEMENTO_INVALID" },
    });
    expect(
      Mission.rehydrate({
        ...memento,
        workContract: memento.workContract
          ? {
              ...memento.workContract,
              gateSetDigest: { algorithm: "sha256", value: "0".repeat(64) },
            }
          : undefined,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_MEMENTO_INVALID" },
    });
  });

  it("never authorizes an attempt outside a recorded retry-eligible state", () => {
    const openMission = open(3);
    const runningMission = open(3);
    runningMission.recordAttemptLeased({
      missionRevision: 1,
      attemptId: "attempt-1",
      attemptNumber: 1,
    });
    const verifyingMission = open(3);
    verifyingMission.recordArtifactSubmitted({
      missionRevision: 1,
      attemptId: "attempt-1",
      startingRevision: "fixture-shipping-v1",
      artifactDigest,
      gateSetDigest,
    });
    const reviewMission = open(3);
    advanceToReview(reviewMission);
    for (const mission of [
      openMission,
      runningMission,
      verifyingMission,
      reviewMission,
    ]) {
      const before = mission.snapshot;
      expect(
        mission.authorizeAnotherAttempt({
          attemptId: "attempt-2",
          reason: "HUMAN_AUTHORIZED",
        }),
      ).toMatchObject({
        ok: false,
        error: { code: "UNSUPPORTED_TRANSITION" },
      });
      expect(mission.snapshot).toEqual(before);
    }
  });

  it("requires the recorded retry reason and a fresh attempt ID", () => {
    const mission = open(3);
    mission.recordAttemptEnded({
      missionRevision: 1,
      attemptId: "attempt-1",
      outcome: "LEASE_EXPIRED",
    });
    expect(
      mission.authorizeAnotherAttempt({
        attemptId: "attempt-2",
        reason: "ATTEMPT_FAILED",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_TRANSITION" },
    });
    expect(
      mission.authorizeAnotherAttempt({
        attemptId: "attempt-1",
        reason: "ATTEMPT_EXPIRED",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_TRANSITION" },
    });
    expect(
      mission.authorizeAnotherAttempt({
        attemptId: "attempt-2",
        reason: "ATTEMPT_EXPIRED",
      }),
    ).toMatchObject({
      ok: true,
      value: { status: "OPEN", latestAttemptId: "attempt-2" },
    });
  });

  it("clones verification evidence before storing it", () => {
    const mission = open(2);
    const mutableArtifact = {
      algorithm: "sha256" as const,
      value: "b".repeat(64),
    };
    mission.recordArtifactSubmitted({
      missionRevision: 1,
      attemptId: "attempt-1",
      startingRevision: "fixture-shipping-v1",
      artifactDigest: mutableArtifact,
      gateSetDigest,
    });
    const mutableEvidence = {
      algorithm: "sha256" as const,
      value: "c".repeat(64),
    };
    const mutableBinding = {
      ...verificationBinding(),
      artifactDigest: mutableArtifact,
    };
    mission.recordVerificationVerdict({
      attemptId: "attempt-1",
      verificationRunId: "verification-1",
      binding: mutableBinding,
      verdict: "PASSED",
      evidenceBundleDigest: mutableEvidence,
    });
    mutableArtifact.value = "d".repeat(64);
    mutableEvidence.value = "e".repeat(64);
    expect(mission.snapshot.latestArtifactDigest).toEqual(artifactDigest);
    expect(mission.snapshot.latestEvidenceBundleDigest).toEqual(evidenceDigest);
    expect(mission.toMemento().verificationOutcome).toMatchObject({
      binding: { artifactDigest },
      evidenceBundleDigest: evidenceDigest,
    });
  });

  it("does not record a rejection that requests an exhausted retry", () => {
    const mission = open(1);
    advanceToReview(mission);
    const result = mission.rejectCompletion({
      ...completionBinding(),
      decidedBy: "human-reviewer",
      reason: "retry",
      authorizeAnotherAttempt: true,
      nextAttemptId: "attempt-2",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "ATTEMPT_BUDGET_EXHAUSTED" },
    });
    expect(mission.snapshot.humanDecision).toBeUndefined();
  });

  it("handles retryable abort, exhausted budget, and stale duplicate facts deterministically", () => {
    const mission = open(1);
    mission.recordAttemptLeased({
      missionRevision: 1,
      attemptId: "attempt-1",
      attemptNumber: 1,
    });
    mission.recordArtifactSubmitted({
      missionRevision: 1,
      attemptId: "attempt-1",
      startingRevision: "fixture-shipping-v1",
      artifactDigest,
      gateSetDigest,
    });
    const aborted = mission.recordVerificationAborted({
      attemptId: "attempt-1",
      verificationRunId: "verification-1",
      binding: verificationBinding(),
      reason: "EXECUTION_INFRASTRUCTURE_FAILURE",
      retryable: true,
    });
    expect(aborted).toMatchObject({
      ok: true,
      value: { status: "NEEDS_HUMAN_DECISION" },
    });
    expect(
      mission.recordVerificationAborted({
        attemptId: "attempt-1",
        verificationRunId: "verification-1",
        binding: verificationBinding(),
        reason: "EXECUTION_INFRASTRUCTURE_FAILURE",
        retryable: true,
      }),
    ).toMatchObject({ ok: true, disposition: "idempotent" });
    expect(
      mission.authorizeAnotherAttempt({
        attemptId: "attempt-2",
        reason: "VERIFICATION_ABORTED",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "ATTEMPT_BUDGET_EXHAUSTED" },
    });
  });

  it("cancels once and rejects later work", () => {
    const mission = open();
    const cancelled = mission.cancel({
      missionRevision: 1,
      cancelledBy: "human-operator",
      reason: "No longer needed.",
    });
    expect(cancelled).toMatchObject({
      ok: true,
      value: { status: "CANCELLED" },
      events: [{ kind: "MISSION_CANCELLED" }],
    });
    expect(
      mission.recordAttemptLeased({
        missionRevision: 1,
        attemptId: "attempt-1",
        attemptNumber: 1,
      }),
    ).toMatchObject({ ok: false, error: { code: "MISSION_TERMINAL" } });
  });

  it("converges a cancellation and its exact bound verifier abort in either order", () => {
    const cancellationAbort = {
      attemptId: "attempt-1",
      verificationRunId: "verification-1",
      binding: verificationBinding(),
      reason: "MISSION_CANCELLED" as const,
      retryable: false,
    };
    const prepare = () => {
      const mission = open();
      mission.recordArtifactSubmitted({
        missionRevision: 1,
        attemptId: "attempt-1",
        startingRevision: "fixture-shipping-v1",
        artifactDigest,
        gateSetDigest,
      });
      return mission;
    };

    const cancelFirst = prepare();
    expect(
      cancelFirst.cancel({
        missionRevision: 1,
        cancelledBy: "human-reviewer",
        reason: "Stop.",
      }),
    ).toMatchObject({ ok: true, value: { status: "CANCELLED" } });
    expect(
      cancelFirst.recordVerificationAborted(cancellationAbort),
    ).toMatchObject({
      ok: true,
      disposition: "applied",
      value: { status: "CANCELLED" },
    });
    expect(
      cancelFirst.recordVerificationAborted(cancellationAbort),
    ).toMatchObject({ ok: true, disposition: "idempotent" });
    expect(
      cancelFirst.recordVerificationAborted({
        ...cancellationAbort,
        reason: "WORKSPACE_UNAVAILABLE",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "CONFLICTING_VERIFICATION_FACT" },
    });
    expect(
      Mission.rehydrate(structuredClone(cancelFirst.toMemento())),
    ).toMatchObject({ ok: true, value: { snapshot: { status: "CANCELLED" } } });

    const abortFirst = prepare();
    expect(
      abortFirst.recordVerificationAborted(cancellationAbort),
    ).toMatchObject({ ok: true, value: { status: "NEEDS_HUMAN_DECISION" } });
    expect(
      abortFirst.cancel({
        missionRevision: 1,
        cancelledBy: "human-reviewer",
        reason: "Stop.",
      }),
    ).toMatchObject({ ok: true, value: { status: "CANCELLED" } });
  });

  it.each([
    ["unknown kind", { ...gates[0], kind: "BOGUS" }],
    ["unregistered command", { ...gates[0], commandId: "run-anything" }],
    ["kind/command mismatch", { ...gates[0], commandId: "check-lint" }],
    ["non-boolean mandatory", { ...gates[0], mandatory: "yes" }],
    ["open gate object", { ...gates[0], shell: "npm test" }],
  ])("rejects an invalid gate contract before opening: %s", (_label, gate) => {
    const mission = draft();
    const result = mission.defineAcceptanceGates({
      acceptanceGates: [gate as MissionAcceptanceGate],
      gateSetDigest: calculateGateSetDigest([gate as MissionAcceptanceGate]),
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_MISSION" },
    });
    expect(mission.snapshot).toMatchObject({
      status: "DRAFT",
      attemptsAuthorized: 0,
    });
  });

  it("round-trips the typed decision reason through snapshots and persistence", () => {
    const mission = open();
    advanceToReview(mission);
    expect(
      mission.rejectCompletion({
        ...completionBinding(),
        decidedBy: "human-reviewer",
        reason: "The boundary needs one more explicit invariant.",
        authorizeAnotherAttempt: false,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        humanDecision: "REJECTED",
        decisionReason: "The boundary needs one more explicit invariant.",
      },
    });
    const restored = Mission.rehydrate(structuredClone(mission.toMemento()));
    expect(restored).toMatchObject({
      ok: true,
      value: {
        snapshot: {
          humanDecision: "REJECTED",
          decisionReason: "The boundary needs one more explicit invariant.",
        },
      },
    });
  });

  it("accepts every reachable mission state memento and rejects an invariant mutation per state", () => {
    const draftMission = draft(3);
    const openMission = open(3);
    const activeMission = open(3);
    activeMission.recordAttemptLeased({
      missionRevision: 1,
      attemptId: "attempt-1",
      attemptNumber: 1,
    });
    const verifyingMission = open(3);
    verifyingMission.recordArtifactSubmitted({
      missionRevision: 1,
      attemptId: "attempt-1",
      startingRevision: "fixture-shipping-v1",
      artifactDigest,
      gateSetDigest,
    });
    const reviewMission = open(3);
    advanceToReview(reviewMission);
    const needsMission = open(3);
    needsMission.recordAttemptEnded({
      missionRevision: 1,
      attemptId: "attempt-1",
      outcome: "FAILED",
    });
    const completedMission = open(3);
    advanceToReview(completedMission);
    completedMission.approveCompletion({
      ...completionBinding(),
      decidedBy: "human-reviewer",
    });
    const cancelledMission = open(3);
    cancelledMission.cancel({
      missionRevision: 1,
      cancelledBy: "human-reviewer",
      reason: "Stopped deliberately.",
    });

    const cases = [
      {
        status: "DRAFT",
        mission: draftMission,
        mutate: (value: Record<string, unknown>) => {
          value["latestAttemptId"] = "attempt-impossible";
        },
      },
      {
        status: "OPEN",
        mission: openMission,
        mutate: (value: Record<string, unknown>) => {
          value["latestArtifactDigest"] = artifactDigest;
        },
      },
      {
        status: "ATTEMPT_RUNNING",
        mission: activeMission,
        mutate: (value: Record<string, unknown>) => {
          value["retryEligibility"] = "ATTEMPT_FAILED";
        },
      },
      {
        status: "VERIFICATION_RUNNING",
        mission: verifyingMission,
        mutate: (value: Record<string, unknown>) => {
          value["humanDecision"] = "REJECTED";
          value["decisionReason"] = "Impossible before review.";
        },
      },
      {
        status: "COMPLETION_REVIEW",
        mission: reviewMission,
        mutate: (value: Record<string, unknown>) => {
          value["retryEligibility"] = "REVISION_REQUESTED";
        },
      },
      {
        status: "NEEDS_HUMAN_DECISION",
        mission: needsMission,
        mutate: (value: Record<string, unknown>) => {
          delete value["retryEligibility"];
        },
      },
      {
        status: "COMPLETED",
        mission: completedMission,
        mutate: (value: Record<string, unknown>) => {
          delete value["decisionReason"];
        },
      },
      {
        status: "CANCELLED",
        mission: cancelledMission,
        mutate: (value: Record<string, unknown>) => {
          value["humanDecision"] = "APPROVED";
          value["decisionReason"] = "Impossible after cancellation.";
        },
      },
    ] as const;

    for (const entry of cases) {
      const valid = entry.mission.toMemento();
      expect(valid.status).toBe(entry.status);
      expect(Mission.rehydrate(structuredClone(valid))).toMatchObject({
        ok: true,
      });
      const invalid = structuredClone(valid) as unknown as Record<
        string,
        unknown
      >;
      entry.mutate(invalid);
      expect(Mission.rehydrate(invalid), entry.status).toMatchObject({
        ok: false,
        error: { code: "PERSISTENCE_MEMENTO_INVALID" },
      });
    }
  });

  it("rejects unknown properties throughout every persisted nested mission value", () => {
    const mission = open(3);
    advanceToReview(mission);
    mission.approveCompletion({
      ...completionBinding(),
      decidedBy: "human-reviewer",
    });
    const valid = mission.toMemento();
    const nested = (
      root: unknown,
      path: readonly (string | number)[],
    ): unknown => {
      let current = root;
      for (const segment of path) {
        if (typeof segment === "number") {
          if (!Array.isArray(current)) return undefined;
          current = current[segment];
        } else {
          if (
            current === null ||
            typeof current !== "object" ||
            Array.isArray(current)
          )
            return undefined;
          current = (current as Record<string, unknown>)[segment];
        }
      }
      return current;
    };
    const paths = [
      ["draft"],
      ["draft", "allowedScope"],
      ["workContract"],
      ["workContract", "allowedScope"],
      ["workContract", "acceptanceGates", 0],
      ["workContract", "gateSetDigest"],
      ["latestArtifactDigest"],
      ["verificationOutcome"],
      ["verificationOutcome", "binding"],
      ["verificationOutcome", "binding", "artifactDigest"],
      ["verificationOutcome", "evidenceBundleDigest"],
      ["completionBinding"],
      ["completionBinding", "artifactDigest"],
      ["cycleHistory", 0],
      ["cycleHistory", 0, "artifactDigest"],
      ["cycleHistory", 0, "verificationOutcome"],
      ["cycleHistory", 0, "verificationOutcome", "binding"],
      ["cycleHistory", 0, "completionBinding"],
    ] as const;
    for (const path of paths) {
      const changed = structuredClone(valid);
      const target = nested(changed, path);
      if (
        target === null ||
        typeof target !== "object" ||
        Array.isArray(target)
      )
        throw new Error(`missing nested test target ${path.join(".")}`);
      (target as Record<string, unknown>)["unexpected"] = true;
      expect(Mission.rehydrate(changed), path.join(".")).toMatchObject({
        ok: false,
        error: { code: "PERSISTENCE_MEMENTO_INVALID" },
      });
    }

    const cancelled = open();
    cancelled.cancel({
      missionRevision: 1,
      cancelledBy: "human-reviewer",
      reason: "Stop.",
    });
    const changedCancellation = structuredClone(cancelled.toMemento());
    const cancellation = nested(changedCancellation, ["cancellation"]);
    if (
      cancellation === null ||
      typeof cancellation !== "object" ||
      Array.isArray(cancellation)
    )
      throw new Error("missing cancellation test target");
    (cancellation as Record<string, unknown>)["unexpected"] = true;
    expect(Mission.rehydrate(changedCancellation)).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_MEMENTO_INVALID" },
    });
  });

  it("rejects draft cancellation and invalid completion-review IDs before mutation", () => {
    const draftMission = draft();
    expect(
      draftMission.cancel({
        missionRevision: 1,
        cancelledBy: "human-reviewer",
        reason: "A draft has no public lifecycle to cancel.",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_TRANSITION" },
    });
    expect(draftMission.snapshot.status).toBe("DRAFT");

    const mission = open();
    mission.recordArtifactSubmitted({
      missionRevision: 1,
      attemptId: "attempt-1",
      startingRevision: "fixture-shipping-v1",
      artifactDigest,
      gateSetDigest,
    });
    mission.recordVerificationVerdict({
      attemptId: "attempt-1",
      verificationRunId: "verification-1",
      binding: verificationBinding(),
      verdict: "PASSED",
      evidenceBundleDigest: evidenceDigest,
    });
    const before = mission.toMemento();
    expect(
      mission.recordReviewRecommendation({
        completionReviewId: "bad review id",
        verificationRunId: "verification-1",
        binding: verificationBinding(),
        verdict: "PASSED",
        evidenceBundleDigest: evidenceDigest,
        recommendation: "APPROVE",
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_MISSION" } });
    expect(mission.toMemento()).toEqual(before);
  });

  it("rejects invalid private-fact enums, booleans, combinations, and nested topology before mutation", () => {
    const endedMission = open();
    const endedBefore = endedMission.toMemento();
    expect(
      endedMission.recordAttemptEnded({
        missionRevision: 1,
        attemptId: "attempt-1",
        outcome: "TIMED_OUT",
      } as never),
    ).toMatchObject({ ok: false, error: { code: "INVALID_MISSION" } });
    expect(endedMission.toMemento()).toEqual(endedBefore);

    const verifying = open();
    verifying.recordArtifactSubmitted({
      missionRevision: 1,
      attemptId: "attempt-1",
      startingRevision: "fixture-shipping-v1",
      artifactDigest,
      gateSetDigest,
    });
    const before = verifying.toMemento();
    expect(
      verifying.recordVerificationVerdict({
        attemptId: "attempt-1",
        verificationRunId: "verification-1",
        binding: verificationBinding(),
        verdict: "PASS",
        evidenceBundleDigest: evidenceDigest,
      } as never),
    ).toMatchObject({ ok: false, error: { code: "INVALID_MISSION" } });
    for (const mutation of [
      { reason: "UNKNOWN_REASON", retryable: false },
      { reason: "WORKSPACE_UNAVAILABLE", retryable: "yes" },
      { reason: "MISSION_CANCELLED", retryable: true },
    ]) {
      expect(
        verifying.recordVerificationAborted({
          attemptId: "attempt-1",
          verificationRunId: "verification-1",
          binding: verificationBinding(),
          ...mutation,
        } as never),
      ).toMatchObject({ ok: false, error: { code: "INVALID_MISSION" } });
    }
    expect(
      verifying.recordVerificationVerdict({
        attemptId: "attempt-1",
        verificationRunId: "verification-1",
        binding: {
          ...verificationBinding(),
          inheritedSemanticField: true,
        },
        verdict: "PASSED",
        evidenceBundleDigest: evidenceDigest,
      } as never),
    ).toMatchObject({ ok: false, error: { code: "INVALID_MISSION" } });
    expect(verifying.toMemento()).toEqual(before);
  });

  it("enforces exact own JSON topology on every aggregate operation", () => {
    expect(
      Mission.draft({
        missionId: "mission-extra",
        missionRevision: 1,
        objective: "Objective.",
        startingRevision: "revision-1",
        workspaceReference: "urn:patchquest:extra",
        allowedScope: { pathPatterns: ["src/**"] },
        requestedCapabilities: ["edit"],
        attemptBudget: 1,
        unexpected: true,
      } as never),
    ).toMatchObject({ ok: false, error: { code: "INVALID_MISSION" } });
    const inheritedDraft = Object.create({
      missionId: "mission-inherited",
      missionRevision: 1,
      objective: "Objective.",
      startingRevision: "revision-1",
      workspaceReference: "urn:patchquest:inherited",
      allowedScope: { pathPatterns: ["src/**"] },
      requestedCapabilities: ["edit"],
      attemptBudget: 1,
    });
    expect(Mission.draft(inheritedDraft)).toMatchObject({
      ok: false,
      error: { code: "INVALID_MISSION" },
    });
    let accessorRead = false;
    const accessorDraft = {
      missionId: "mission-accessor",
      missionRevision: 1,
      startingRevision: "revision-1",
      workspaceReference: "urn:patchquest:accessor",
      allowedScope: { pathPatterns: ["src/**"] },
      requestedCapabilities: ["edit"],
      attemptBudget: 1,
    } as Record<string, unknown>;
    Object.defineProperty(accessorDraft, "objective", {
      enumerable: true,
      get() {
        accessorRead = true;
        return "Objective.";
      },
    });
    expect(Mission.draft(accessorDraft as never)).toMatchObject({
      ok: false,
      error: { code: "INVALID_MISSION" },
    });
    expect(accessorRead).toBe(false);

    const mission = open(3);
    const before = mission.toMemento();
    const operations = [
      () =>
        mission.defineAcceptanceGates({
          acceptanceGates: gates,
          gateSetDigest,
          unexpected: true,
        } as never),
      () => mission.open({ attemptId: "attempt-2", unexpected: true } as never),
      () =>
        mission.authorizeAnotherAttempt({
          attemptId: "attempt-2",
          reason: "ATTEMPT_FAILED",
          unexpected: true,
        } as never),
      () =>
        mission.approveCompletion({
          ...completionBinding(),
          decidedBy: "human-reviewer",
          unexpected: true,
        } as never),
      () =>
        mission.rejectCompletion({
          ...completionBinding(),
          decidedBy: "human-reviewer",
          reason: "No.",
          authorizeAnotherAttempt: false,
          unexpected: true,
        } as never),
      () =>
        mission.cancel({
          missionRevision: 1,
          cancelledBy: "human-reviewer",
          reason: "Stop.",
          unexpected: true,
        } as never),
      () =>
        mission.recordAttemptLeased({
          missionRevision: 1,
          attemptId: "attempt-1",
          attemptNumber: 1,
          unexpected: true,
        } as never),
      () =>
        mission.recordAttemptEnded({
          missionRevision: 1,
          attemptId: "attempt-1",
          outcome: "FAILED",
          unexpected: true,
        } as never),
      () =>
        mission.recordArtifactSubmitted({
          missionRevision: 1,
          attemptId: "attempt-1",
          startingRevision: "fixture-shipping-v1",
          artifactDigest,
          gateSetDigest,
          unexpected: true,
        } as never),
      () =>
        mission.recordVerificationVerdict({
          attemptId: "attempt-1",
          verificationRunId: "verification-1",
          binding: verificationBinding(),
          verdict: "PASSED",
          evidenceBundleDigest: evidenceDigest,
          unexpected: true,
        } as never),
      () =>
        mission.recordVerificationAborted({
          attemptId: "attempt-1",
          verificationRunId: "verification-1",
          binding: verificationBinding(),
          reason: "WORKSPACE_UNAVAILABLE",
          retryable: false,
          unexpected: true,
        } as never),
      () =>
        mission.recordReviewRecommendation({
          completionReviewId: "review-1",
          verificationRunId: "verification-1",
          binding: verificationBinding(),
          verdict: "PASSED",
          evidenceBundleDigest: evidenceDigest,
          recommendation: "APPROVE",
          unexpected: true,
        } as never),
    ];
    for (const operation of operations)
      expect(operation()).toMatchObject({
        ok: false,
        error: { code: "INVALID_MISSION" },
      });
    expect(mission.toMemento()).toEqual(before);
  });

  it("rejects sparse aggregate arrays and round-trips accepted branch facts immediately", () => {
    const sparseStrings = new Array<string>(1);
    expect(
      Mission.draft({
        missionId: "mission-sparse",
        missionRevision: 1,
        objective: "Objective.",
        startingRevision: "revision-1",
        workspaceReference: "urn:patchquest:sparse",
        allowedScope: { pathPatterns: sparseStrings },
        requestedCapabilities: ["edit"],
        attemptBudget: 1,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_MISSION" } });
    expect(() =>
      calculateGateSetDigest(new Array<MissionAcceptanceGate>(1)),
    ).toThrow(/dense array/);
    const mission = draft();
    const before = mission.toMemento();
    expect(
      mission.defineAcceptanceGates({
        acceptanceGates: new Array<MissionAcceptanceGate>(1),
        gateSetDigest,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_MISSION" } });
    expect(mission.toMemento()).toEqual(before);

    const ended = open();
    expect(
      ended.recordAttemptEnded({
        missionRevision: 1,
        attemptId: "attempt-1",
        outcome: "FAILED",
      }),
    ).toMatchObject({ ok: true });
    expect(Mission.rehydrate(structuredClone(ended.toMemento()))).toMatchObject(
      {
        ok: true,
      },
    );

    const aborted = open();
    aborted.recordArtifactSubmitted({
      missionRevision: 1,
      attemptId: "attempt-1",
      startingRevision: "fixture-shipping-v1",
      artifactDigest,
      gateSetDigest,
    });
    expect(
      aborted.recordVerificationAborted({
        attemptId: "attempt-1",
        verificationRunId: "verification-1",
        binding: verificationBinding(),
        reason: "WORKSPACE_UNAVAILABLE",
        retryable: false,
      }),
    ).toMatchObject({ ok: true });
    expect(
      Mission.rehydrate(structuredClone(aborted.toMemento())),
    ).toMatchObject({ ok: true });
  });

  it("rejects a proxied gate before sorting or invoking proxy traps", () => {
    const trapCounts = {
      get: 0,
      getOwnPropertyDescriptor: 0,
      getPrototypeOf: 0,
    };
    const gate = new Proxy(gates[0]!, {
      get(target, key, receiver) {
        trapCounts.get += 1;
        return Reflect.get(target, key, receiver);
      },
      getOwnPropertyDescriptor(target, key) {
        trapCounts.getOwnPropertyDescriptor += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      getPrototypeOf(target) {
        trapCounts.getPrototypeOf += 1;
        return Reflect.getPrototypeOf(target);
      },
    });
    expect(() => calculateGateSetDigest([gate])).toThrow(TypeError);
    expect(trapCounts).toEqual({
      get: 0,
      getOwnPropertyDescriptor: 0,
      getPrototypeOf: 0,
    });
  });

  it("round-trips causally valid rejected-review cancellation and rejects forged cancellation chains", () => {
    const mission = open();
    advanceToReview(mission);
    mission.rejectCompletion({
      ...completionBinding(),
      decidedBy: "human-reviewer",
      reason: "Do not continue this mission.",
      authorizeAnotherAttempt: false,
    });
    mission.cancel({
      missionRevision: 1,
      cancelledBy: "human-reviewer",
      reason: "Cancelled after reviewing the bound result.",
    });
    expect(
      Mission.rehydrate(structuredClone(mission.toMemento())),
    ).toMatchObject({
      ok: true,
      value: {
        snapshot: {
          status: "CANCELLED",
          humanDecision: "REJECTED",
          decisionReason: "Do not continue this mission.",
        },
      },
    });

    const plainCancelled = open();
    plainCancelled.cancel({
      missionRevision: 1,
      cancelledBy: "human-reviewer",
      reason: "Stop.",
    });
    const forged = structuredClone(
      plainCancelled.toMemento(),
    ) as unknown as Record<string, unknown>;
    forged["humanDecision"] = "REJECTED";
    forged["decisionReason"] = "Fabricated without a completion binding.";
    expect(Mission.rehydrate(forged)).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_MEMENTO_INVALID" },
    });
  });

  it("round-trips after every accepted mission operation in a complete lifecycle", () => {
    const mission = draft(3);
    const expectRoundTrip = () => {
      const restored = Mission.rehydrate(structuredClone(mission.toMemento()));
      expect(restored).toMatchObject({ ok: true });
      if (restored.ok)
        expect(restored.value.snapshot).toEqual(mission.snapshot);
    };
    expectRoundTrip();
    expect(
      mission.defineAcceptanceGates({ acceptanceGates: gates, gateSetDigest }),
    ).toMatchObject({ ok: true });
    expectRoundTrip();
    expect(mission.open({ attemptId: "attempt-1" })).toMatchObject({
      ok: true,
    });
    expectRoundTrip();
    expect(
      mission.recordAttemptLeased({
        missionRevision: 1,
        attemptId: "attempt-1",
        attemptNumber: 1,
      }),
    ).toMatchObject({ ok: true });
    expectRoundTrip();
    expect(
      mission.recordArtifactSubmitted({
        missionRevision: 1,
        attemptId: "attempt-1",
        startingRevision: "fixture-shipping-v1",
        artifactDigest,
        gateSetDigest,
      }),
    ).toMatchObject({ ok: true });
    expectRoundTrip();
    expect(
      mission.recordVerificationVerdict({
        attemptId: "attempt-1",
        verificationRunId: "verification-1",
        binding: verificationBinding(),
        verdict: "PASSED",
        evidenceBundleDigest: evidenceDigest,
      }),
    ).toMatchObject({ ok: true });
    expectRoundTrip();
    expect(
      mission.recordReviewRecommendation({
        completionReviewId: "review-1",
        verificationRunId: "verification-1",
        binding: verificationBinding(),
        verdict: "PASSED",
        evidenceBundleDigest: evidenceDigest,
        recommendation: "APPROVE",
      }),
    ).toMatchObject({ ok: true });
    expectRoundTrip();
    expect(
      mission.rejectCompletion({
        ...completionBinding(),
        decidedBy: "human-reviewer",
        reason: "One more attempt is required.",
        authorizeAnotherAttempt: false,
      }),
    ).toMatchObject({ ok: true });
    expectRoundTrip();
    expect(
      mission.authorizeAnotherAttempt({
        attemptId: "attempt-2",
        reason: "HUMAN_AUTHORIZED",
        feedback: "One more attempt is required.",
      }),
    ).toMatchObject({ ok: true });
    expectRoundTrip();
    expect(
      mission.cancel({
        missionRevision: 1,
        cancelledBy: "human-reviewer",
        reason: "Stop after the bounded retry was opened.",
      }),
    ).toMatchObject({ ok: true });
    expectRoundTrip();
  });
});
