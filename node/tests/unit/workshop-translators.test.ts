import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  Attempt,
  calculateGateSetDigest,
  type AcceptanceGate,
  type AttemptDomainEvent,
} from "../../apps/workshop/src/domain/attempt.ts";
import {
  createWorkshopPublicEvent,
  finalizeWorkshopPublicEvent,
  type WorkshopPublicEvent,
} from "../../apps/workshop/src/application/outgoing-message-factory.ts";
import {
  translateAbandonAttempt,
  translateCreateAttempt,
  translateExpireLease,
  translateFailAttempt,
  translateHeartbeat,
  translateLeaseAttempt,
  translateRevokeAttempt,
  translateSubmitArtifact,
  translateWorkshopCommand,
} from "../../apps/workshop/src/application/translators.ts";

const gates: readonly AcceptanceGate[] = [
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
const token = "opaque-lease-token-at-least-thirty-two-characters";

function createMessage(): Readonly<Record<string, unknown>> {
  return {
    commandId: "command-create-1",
    commandType: "workshop.create-attempt.v1",
    schemaVersion: 1,
    issuedAt: "2026-07-18T10:00:00.000Z",
    issuer: "mission-control",
    recipient: "workshop",
    subjectId: "attempt-1",
    correlationId: "correlation-1",
    causationId: "event-opened-1",
    data: {
      missionId: "mission-1",
      missionRevision: 1,
      objective: "Implement the shipping quote.",
      startingRevision: "fixture-shipping-v1",
      workspaceReference: "urn:patchquest:fixture:shipping-quote",
      allowedScope: { pathPatterns: ["src/shipping/**"] },
      requestedCapabilities: ["edit-trusted-fixture"],
      acceptanceGates: gates,
      gateSetDigest,
      attemptId: "attempt-1",
      attemptNumber: 1,
      attemptBudget: 2,
    },
  };
}

function revokeMessage(): Readonly<Record<string, unknown>> {
  return {
    commandId: "command-revoke-1",
    commandType: "workshop.revoke-attempt.v1",
    schemaVersion: 1,
    issuedAt: "2026-07-18T10:01:00.000Z",
    issuer: "mission-control",
    recipient: "workshop",
    subjectId: "attempt-1",
    correlationId: "correlation-1",
    causationId: "event-cancelled-1",
    data: {
      missionId: "mission-1",
      missionRevision: 1,
      attemptId: "attempt-1",
      reason: "MISSION_CANCELLED",
    },
  };
}

const identity = {
  requestId: "request-1",
  correlationId: "correlation-1",
  attemptId: "attempt-1",
};

describe("Workshop translators", () => {
  it("strictly translates the complete public create work contract", () => {
    const message = createMessage();
    const translated = translateCreateAttempt(message);
    expect(translated).toEqual({
      ok: true,
      value: {
        messageId: "command-create-1",
        correlationId: "correlation-1",
        causationId: "event-opened-1",
        issuedAt: "2026-07-18T10:00:00.000Z",
        missionId: "mission-1",
        missionRevision: 1,
        attemptId: "attempt-1",
        attemptNumber: 1,
        attemptBudget: 2,
        workContract: {
          objective: "Implement the shipping quote.",
          startingRevision: "fixture-shipping-v1",
          workspaceReference: "urn:patchquest:fixture:shipping-quote",
          allowedScope: { pathPatterns: ["src/shipping/**"] },
          requestedCapabilities: ["edit-trusted-fixture"],
          acceptanceGates: gates,
          gateSetDigest,
        },
      },
    });
    expect(translated).toMatchObject({ ok: true });
    if (translated.ok) {
      expect(Object.isFrozen(translated.value)).toBe(true);
      expect(Object.isFrozen(translated.value.workContract)).toBe(true);
    }
  });

  it("accepts a valid RFC 3339 offset and rejects a normalized invalid date", () => {
    expect(
      translateCreateAttempt({
        ...createMessage(),
        issuedAt: "2026-07-18T12:00:00+02:00",
      }),
    ).toMatchObject({ ok: true });
    expect(
      translateCreateAttempt({
        ...createMessage(),
        issuedAt: "2026-02-31T10:00:00Z",
      }),
    ).toMatchObject({ ok: false });
  });

  it("enforces gate evidence boundaries and exact registry pairs at the public boundary", () => {
    for (const evidenceLimitBytes of [0, 1_048_576]) {
      const boundedGates: readonly AcceptanceGate[] = [
        { ...gates[0]!, evidenceLimitBytes },
      ];
      expect(
        translateCreateAttempt({
          ...createMessage(),
          data: {
            ...(createMessage()["data"] as object),
            acceptanceGates: boundedGates,
            gateSetDigest: calculateGateSetDigest(boundedGates),
          },
        }),
      ).toMatchObject({ ok: true });
    }
    const mismatched: readonly AcceptanceGate[] = [
      { ...gates[0]!, kind: "LINT", commandId: "check-tests" },
    ];
    expect(
      translateCreateAttempt({
        ...createMessage(),
        data: {
          ...(createMessage()["data"] as object),
          acceptanceGates: mismatched,
          gateSetDigest: calculateGateSetDigest(mismatched),
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "CONTRACT_INVALID" },
    });
    for (const evidenceLimitBytes of [-1, 1_048_577, 1.5]) {
      const invalidGates: readonly AcceptanceGate[] = [
        { ...gates[0]!, evidenceLimitBytes },
      ];
      expect(
        translateCreateAttempt({
          ...createMessage(),
          data: {
            ...(createMessage()["data"] as object),
            acceptanceGates: invalidGates,
            gateSetDigest: calculateGateSetDigest(invalidGates),
          },
        }),
      ).toMatchObject({
        ok: false,
        error: { code: "CONTRACT_INVALID" },
      });
    }
  });

  it("strictly translates the public revoke command to private authority input", () => {
    expect(translateRevokeAttempt(revokeMessage())).toMatchObject({
      ok: true,
      value: {
        messageId: "command-revoke-1",
        missionId: "mission-1",
        missionRevision: 1,
        attemptId: "attempt-1",
        reason: "MISSION_CANCELLED",
      },
    });
  });

  it.each([
    ["open envelope", { ...createMessage(), unexpected: true }],
    [
      "open data",
      {
        ...createMessage(),
        data: { ...(createMessage()["data"] as object), unexpected: true },
      },
    ],
    [
      "wrong recipient",
      { ...createMessage(), recipient: "verification-and-review" },
    ],
    ["subject mismatch", { ...createMessage(), subjectId: "attempt-2" }],
    [
      "bad gate digest",
      {
        ...createMessage(),
        data: {
          ...(createMessage()["data"] as object),
          gateSetDigest: { algorithm: "sha256", value: "b".repeat(64) },
        },
      },
    ],
  ])("rejects invalid public %s", (_label, message) => {
    expect(translateCreateAttempt(message)).toMatchObject({
      ok: false,
      error: { code: "CONTRACT_INVALID" },
    });
  });

  it("rejects unsupported public messages", () => {
    expect(
      translateWorkshopCommand({
        ...createMessage(),
        commandType: "verification.start-verification.v1",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_MESSAGE" },
    });
  });

  it("strictly translates every private Workshop input without OpenAPI DTO coupling", () => {
    expect(
      translateLeaseAttempt({
        ...identity,
        runnerId: "runner-1",
        runnerCapabilities: ["edit-trusted-fixture"],
        requestedLeaseSeconds: 60,
      }),
    ).toMatchObject({ ok: true });
    expect(
      translateHeartbeat({
        ...identity,
        runnerId: "runner-1",
        leaseToken: token,
      }),
    ).toMatchObject({ ok: true });
    expect(
      translateSubmitArtifact({
        ...identity,
        runnerId: "runner-1",
        leaseToken: token,
        missionId: "mission-1",
        missionRevision: 1,
        startingRevision: "fixture-shipping-v1",
        artifact: {
          reference: "urn:patchquest:artifact:1",
          digest: { algorithm: "sha256", value: "b".repeat(64) },
          changedPaths: ["src/shipping/quote.ts"],
        },
        gateSetDigest,
      }),
    ).toMatchObject({ ok: true });
    expect(
      translateAbandonAttempt({
        ...identity,
        runnerId: "runner-1",
        leaseToken: token,
        reason: "Stopped.",
      }),
    ).toMatchObject({ ok: true });
    expect(
      translateFailAttempt({
        ...identity,
        runnerId: "runner-1",
        leaseToken: token,
        reason: "Failed.",
      }),
    ).toMatchObject({ ok: true });
    expect(translateExpireLease(identity)).toMatchObject({ ok: true });
  });

  it("rejects open, sparse, and non-JSON private inputs", () => {
    const valid = {
      ...identity,
      runnerId: "runner-1",
      runnerCapabilities: ["edit-trusted-fixture"],
      requestedLeaseSeconds: 60,
    };
    const sparse = { ...valid, runnerCapabilities: new Array(1) };
    const cyclic = { ...valid } as Record<string, unknown>;
    cyclic["cycle"] = cyclic;
    for (const value of [
      { ...valid, extra: true },
      { ...valid, causationId: "caller-selected-cause" },
      sparse,
      cyclic,
      new Proxy(valid, {}),
    ])
      expect(translateLeaseAttempt(value)).toMatchObject({ ok: false });
  });

  it.each([
    "/src/shipping/quote.ts",
    "C:/repo/file.ts",
    "c:/repo/file.ts",
    "C:repo/file.ts",
    "c:repo/file.ts",
    "src/../shipping/quote.ts",
    "src\\shipping\\quote.ts",
    "src/shipping/cafe\u0301.ts",
  ])("rejects invalid private changed-path topology %s", (changedPath) => {
    expect(
      translateSubmitArtifact({
        ...identity,
        runnerId: "runner-1",
        leaseToken: token,
        missionId: "mission-1",
        missionRevision: 1,
        startingRevision: "fixture-shipping-v1",
        artifact: {
          reference: "urn:patchquest:artifact:1",
          digest: { algorithm: "sha256", value: "b".repeat(64) },
          changedPaths: [changedPath],
        },
        gateSetDigest,
      }),
    ).toMatchObject({ ok: false, error: { code: "PRIVATE_INPUT_INVALID" } });
  });
});

const require = createRequire(import.meta.url);
const Ajv2020: typeof import("ajv/dist/2020.js").default = require("ajv/dist/2020.js");
const addFormats: typeof import("ajv-formats").default = require("ajv-formats");
const ajv = new Ajv2020({
  strict: true,
  strictRequired: false,
  strictTypes: false,
  allErrors: true,
});
addFormats(ajv);
for (const filename of [
  "shared.schema.json",
  "event-envelope.schema.json",
  "command-envelope.schema.json",
  "integration-messages.schema.json",
])
  ajv.addSchema(
    JSON.parse(
      readFileSync(
        resolve(process.cwd(), "../contracts/schemas/v1", filename),
        "utf8",
      ),
    ) as object,
  );

function schemaAccepts(definition: string, value: unknown): boolean {
  const validate = ajv.getSchema(
    `https://schemas.patchquest.example/contracts/v1/integration-messages.schema.json#/$defs/${definition}`,
  );
  if (!validate) throw new Error(`missing schema ${definition}`);
  return validate(value) as boolean;
}

describe("Workshop outgoing event factory", () => {
  function metadata(eventId: string, causationId = "request-1") {
    return {
      eventId,
      occurredAt: "2026-07-18T10:00:20.000Z",
      correlationId: "correlation-1",
      causationId,
    };
  }

  function eventFixtures(): readonly [AttemptDomainEvent, string][] {
    return [
      [
        { kind: "ATTEMPT_READY", metadata: metadata("event-ready-1") },
        "WorkshopAttemptReadyV1",
      ],
      [
        {
          kind: "ATTEMPT_LEASED",
          metadata: metadata("event-leased-1"),
          leaseId: "lease-1",
          runnerId: "runner-1",
          runnerCapabilities: ["edit-trusted-fixture"],
          expiresAt: "2026-07-18T10:01:00.000Z",
        },
        "WorkshopAttemptLeasedV1",
      ],
      [
        {
          kind: "ARTIFACT_SUBMITTED",
          metadata: metadata("event-artifact-1"),
          runnerId: "runner-1",
          artifact: {
            reference: "urn:patchquest:artifact:1",
            digest: { algorithm: "sha256", value: "b".repeat(64) },
            changedPaths: ["src/shipping/quote.ts"],
          },
        },
        "WorkshopArtifactSubmittedV1",
      ],
      [
        {
          kind: "ATTEMPT_ENDED",
          metadata: metadata("event-ended-1", "event-artifact-1"),
          outcome: "ARTIFACT_SUBMITTED",
        },
        "WorkshopAttemptEndedV1",
      ],
    ];
  }

  it("creates exactly the four Workshop events as detached frozen root-schema-valid messages", () => {
    const created = Attempt.create({
      messageId: "command-create-1",
      correlationId: "correlation-1",
      causationId: "event-opened-1",
      at: "2026-07-18T10:00:00.000Z",
      missionId: "mission-1",
      missionRevision: 1,
      attemptId: "attempt-1",
      attemptNumber: 1,
      attemptBudget: 2,
      workContract: {
        objective: "Implement shipping.",
        startingRevision: "fixture-shipping-v1",
        workspaceReference: "urn:patchquest:fixture:shipping-quote",
        allowedScope: { pathPatterns: ["src/shipping/**"] },
        requestedCapabilities: ["edit-trusted-fixture"],
        acceptanceGates: gates,
        gateSetDigest,
      },
    });
    if (!created.ok) throw new Error(created.error.message);
    for (const [event, schema] of eventFixtures()) {
      const result = createWorkshopPublicEvent(event, created.value.snapshot);
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) continue;
      expect(schemaAccepts(schema, result.value), schema).toBe(true);
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.data)).toBe(true);
      expect(JSON.stringify(result.value)).not.toContain(token);
      expect(JSON.stringify(result.value)).not.toContain("tokenVerifier");
    }
  });

  it("rejects open outgoing event candidates", () => {
    const open = {
      eventId: "event-ready-1",
      eventType: "workshop.attempt-ready.v1",
      schemaVersion: 1,
      occurredAt: "2026-07-18T10:00:00.000Z",
      producer: "workshop",
      subjectId: "attempt-1",
      correlationId: "correlation-1",
      causationId: "command-create-1",
      data: {
        attemptId: "attempt-1",
        missionId: "mission-1",
        missionRevision: 1,
        startingRevision: "fixture-shipping-v1",
        attemptNumber: 1,
        requestedCapabilities: ["edit-trusted-fixture"],
      },
      unexpected: true,
    };
    expect(
      finalizeWorkshopPublicEvent(open as unknown as WorkshopPublicEvent),
    ).toMatchObject({ ok: false });
  });
});
