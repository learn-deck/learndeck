import { describe, expect, it } from "vitest";
import { createWorkshopPublicEvent } from "../../apps/workshop/src/application/outgoing-message-factory.ts";
import {
  Attempt,
  calculateGateSetDigest,
  type AcceptanceGate,
} from "../../apps/workshop/src/domain/attempt.ts";

describe("Workshop allowed-scope ownership seam", () => {
  it("accepts and publishes secrets.txt while deferring check-allowed-scope to Verification", () => {
    const gates: readonly AcceptanceGate[] = [
      {
        gateId: "allowed-scope",
        kind: "ALLOWED_SCOPE",
        commandId: "check-allowed-scope",
        mandatory: true,
        timeoutSeconds: 30,
        evidenceLimitBytes: 4096,
      },
    ];
    const created = Attempt.create({
      messageId: "command-create-scope-seam",
      correlationId: "correlation-scope-seam",
      causationId: "event-mission-opened-scope-seam",
      at: "2026-07-18T10:00:00.000Z",
      missionId: "mission-scope-seam",
      missionRevision: 1,
      attemptId: "attempt-scope-seam",
      attemptNumber: 1,
      attemptBudget: 1,
      workContract: {
        objective: "Change only shipping code.",
        startingRevision: "fixture-shipping-v1",
        workspaceReference: "urn:patchquest:fixture:shipping-quote",
        allowedScope: { pathPatterns: ["src/shipping/**"] },
        requestedCapabilities: ["edit-trusted-fixture"],
        acceptanceGates: gates,
        gateSetDigest: calculateGateSetDigest(gates),
      },
    });
    if (!created.ok) throw new Error(created.error.message);
    const leased = created.value.lease({
      messageId: "request-lease-scope-seam",
      correlationId: "correlation-scope-seam",
      causationId: "request-lease-scope-seam",
      at: "2026-07-18T10:00:00.000Z",
      runnerId: "runner-scope-seam",
      runnerCapabilities: ["edit-trusted-fixture"],
      requestedLeaseSeconds: 60,
      leaseId: "lease-scope-seam",
      leaseToken: "opaque-scope-seam-token-at-least-thirty-two-characters",
    });
    if (!leased.ok) throw new Error(leased.error.message);
    const submitted = created.value.submit({
      messageId: "request-submit-scope-seam",
      correlationId: "correlation-scope-seam",
      causationId: "request-submit-scope-seam",
      at: "2026-07-18T10:00:20.000Z",
      runnerId: "runner-scope-seam",
      leaseToken: "opaque-scope-seam-token-at-least-thirty-two-characters",
      missionId: "mission-scope-seam",
      missionRevision: 1,
      attemptId: "attempt-scope-seam",
      startingRevision: "fixture-shipping-v1",
      artifact: {
        reference: "urn:patchquest:artifact:scope-seam",
        digest: { algorithm: "sha256", value: "b".repeat(64) },
        changedPaths: ["secrets.txt"],
      },
      gateSetDigest: calculateGateSetDigest(gates),
    });

    expect(submitted).toMatchObject({
      ok: true,
      disposition: "applied",
      value: { outcome: "ARTIFACT_SUBMITTED" },
      events: [
        {
          kind: "ARTIFACT_SUBMITTED",
          artifact: { changedPaths: ["secrets.txt"] },
        },
        { kind: "ATTEMPT_ENDED", outcome: "ARTIFACT_SUBMITTED" },
      ],
    });
    expect(created.value.snapshot).toMatchObject({
      status: "ARTIFACT_SUBMITTED",
      workContract: { allowedScope: { pathPatterns: ["src/shipping/**"] } },
      artifact: { changedPaths: ["secrets.txt"] },
    });
    if (!submitted.ok) return;
    const outgoing = submitted.events.map((event) =>
      createWorkshopPublicEvent(event, created.value.snapshot),
    );
    expect(outgoing).toHaveLength(2);
    expect(outgoing.every((result) => result.ok)).toBe(true);
    expect(outgoing[0]).toMatchObject({
      ok: true,
      value: {
        eventType: "workshop.artifact-submitted.v1",
        data: { artifact: { changedPaths: ["secrets.txt"] } },
      },
    });
    expect(outgoing[1]).toMatchObject({
      ok: true,
      value: {
        eventType: "workshop.attempt-ended.v1",
        data: { outcome: "ARTIFACT_SUBMITTED" },
      },
    });

    // Phase 4C owns execution of this retained gate; this seam proves only the
    // Workshop success and publication half of the forbidden-path scenario.
    expect(
      created.value.snapshot.workContract.acceptanceGates[0]?.commandId,
    ).toBe("check-allowed-scope");
  });
});
