import { describe, expect, it } from "vitest";
import type { WorkshopPublicEvent } from "../../apps/workshop/src/application/outgoing-message-factory.ts";
import type {
  LeaseResponseReplayRecord,
  WorkshopTransaction,
  WorkshopUnitOfWork,
} from "../../apps/workshop/src/application/ports.ts";
import { WorkshopUseCases } from "../../apps/workshop/src/application/workshop-use-cases.ts";
import {
  calculateGateSetDigest,
  type AcceptanceGate,
  type AttemptMementoV1,
} from "../../apps/workshop/src/domain/attempt.ts";

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

function createMessage(overrides: Record<string, unknown> = {}) {
  const base = {
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
  return { ...base, ...overrides };
}

function leaseRequest(requestId = "request-lease-1") {
  return {
    requestId,
    correlationId: "correlation-1",
    attemptId: "attempt-1",
    runnerId: "runner-1",
    runnerCapabilities: ["edit-trusted-fixture"],
    requestedLeaseSeconds: 60,
  };
}

function ownerRequest(requestId: string) {
  return {
    requestId,
    correlationId: "correlation-1",
    attemptId: "attempt-1",
    runnerId: "runner-1",
    leaseToken: token,
  };
}

function submitRequest(requestId = "request-submit-1") {
  return {
    ...ownerRequest(requestId),
    missionId: "mission-1",
    missionRevision: 1,
    startingRevision: "fixture-shipping-v1",
    artifact: {
      reference: "urn:patchquest:artifact:1",
      digest: { algorithm: "sha256", value: "b".repeat(64) },
      changedPaths: ["src/shipping/quote.ts"],
    },
    gateSetDigest,
  };
}

class MemoryUnitOfWork implements WorkshopUnitOfWork {
  attempts = new Map<string, AttemptMementoV1>();
  inbox = new Map<string, string>();
  leaseResponses = new Map<string, LeaseResponseReplayRecord>();
  outbox: WorkshopPublicEvent[] = [];
  log: string[] = [];
  failAt?: string;

  async execute<Result>(
    operation: (transaction: WorkshopTransaction) => Promise<Result>,
  ): Promise<Result> {
    const attempts = new Map(
      [...this.attempts].map(([id, memento]) => [id, structuredClone(memento)]),
    );
    const inbox = new Map(this.inbox);
    const leaseResponses = new Map(
      [...this.leaseResponses].map(([key, record]) => [
        key,
        structuredClone(record),
      ]),
    );
    const outbox = [...this.outbox];
    const hit = (name: string) => {
      this.log.push(name);
      if (this.failAt === name) throw new Error(`injected ${name} failure`);
    };
    const result = await operation({
      attempts: {
        load: async (attemptId) => {
          hit("attempts.load");
          const value = attempts.get(attemptId);
          return value ? structuredClone(value) : undefined;
        },
        save: async (memento) => {
          hit("attempts.save");
          attempts.set(memento.seed.attemptId, structuredClone(memento));
        },
      },
      inbox: {
        classify: async (messageId, fingerprint) => {
          hit("inbox.classify");
          const existing = inbox.get(messageId);
          return existing === undefined
            ? "UNSEEN"
            : existing === fingerprint
              ? "EXACT_REDELIVERY"
              : "MESSAGE_ID_CONFLICT";
        },
        recordProcessed: async (messageId, fingerprint) => {
          hit("inbox.recordProcessed");
          inbox.set(messageId, fingerprint);
        },
      },
      leaseResponses: {
        load: async (requestId, fingerprint) => {
          hit("leaseResponses.load");
          const record = leaseResponses.get(`${requestId}:${fingerprint}`);
          return record ? structuredClone(record) : undefined;
        },
        save: async (record) => {
          hit("leaseResponses.save");
          leaseResponses.set(
            `${record.requestId}:${record.normalizedFingerprint}`,
            structuredClone(record),
          );
        },
      },
      outbox: {
        append: async (message) => {
          hit("outbox.append");
          outbox.push(structuredClone(message));
        },
      },
    });
    this.attempts = attempts;
    this.inbox = inbox;
    this.leaseResponses = leaseResponses;
    this.outbox = outbox;
    return result;
  }
}

function harness() {
  const unitOfWork = new MemoryUnitOfWork();
  let now = new Date("2026-07-18T10:00:00.000Z");
  let leaseId = 0;
  const useCases = new WorkshopUseCases({
    unitOfWork,
    clock: { now: () => new Date(now) },
    ids: {
      nextId: () => `lease-${++leaseId}`,
    },
    tokens: { nextToken: () => token },
  });
  return {
    unitOfWork,
    useCases,
    setNow: (value: string) => (now = new Date(value)),
  };
}

describe("Workshop application use cases", () => {
  it("orders translate/fingerprint, classify, load, action, append, save, and inbox atomically for create", async () => {
    const { useCases, unitOfWork } = harness();
    const result = await useCases.createAttempt(createMessage());
    expect(result).toMatchObject({
      ok: true,
      disposition: "applied",
      value: { status: "READY" },
      events: [
        {
          eventType: "workshop.attempt-ready.v1",
          eventId: expect.any(String),
          causationId: "command-create-1",
        },
      ],
    });
    expect(unitOfWork.log).toEqual([
      "inbox.classify",
      "attempts.load",
      "outbox.append",
      "attempts.save",
      "inbox.recordProcessed",
    ]);
  });

  it("short-circuits exact inbox redelivery and conflicts same-ID changed normalized content", async () => {
    const { useCases, unitOfWork } = harness();
    await useCases.createAttempt(createMessage());
    unitOfWork.log = [];
    expect(await useCases.createAttempt(createMessage())).toEqual({
      ok: true,
      disposition: "idempotent",
      value: undefined,
      events: [],
    });
    expect(unitOfWork.log).toEqual(["inbox.classify"]);
    expect(
      await useCases.createAttempt(
        createMessage({
          data: {
            ...(createMessage()["data"] as object),
            objective: "Changed objective.",
          },
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "MESSAGE_ID_CONFLICT" } });
  });

  it("leases and heartbeats using authoritative time while keeping token out of persistence/events", async () => {
    const { useCases, unitOfWork, setNow } = harness();
    await useCases.createAttempt(createMessage());
    unitOfWork.log = [];
    const leased = await useCases.leaseAttempt(leaseRequest());
    expect(leased).toMatchObject({
      ok: true,
      value: {
        leaseToken: token,
        snapshot: { lease: { expiresAt: "2026-07-18T10:01:00.000Z" } },
      },
      events: [
        {
          eventType: "workshop.attempt-leased.v1",
          causationId: "request-lease-1",
        },
      ],
    });
    expect(JSON.stringify([...unitOfWork.attempts.values()])).not.toContain(
      token,
    );
    expect(JSON.stringify(unitOfWork.outbox)).not.toContain(token);
    expect(JSON.stringify(unitOfWork.log)).not.toContain(token);
    expect(JSON.stringify([...unitOfWork.leaseResponses.values()])).toContain(
      token,
    );
    expect(unitOfWork.log).toEqual([
      "inbox.classify",
      "attempts.load",
      "outbox.append",
      "attempts.save",
      "leaseResponses.save",
      "inbox.recordProcessed",
    ]);
    const committedEvents = unitOfWork.outbox.length;
    unitOfWork.log = [];
    expect(await useCases.leaseAttempt(leaseRequest())).toEqual({
      ok: true,
      disposition: "idempotent",
      value: leased.ok ? leased.value : undefined,
      events: [],
    });
    expect(unitOfWork.log).toEqual(["inbox.classify", "leaseResponses.load"]);
    expect(unitOfWork.outbox).toHaveLength(committedEvents);
    expect(
      await useCases.leaseAttempt({
        ...leaseRequest(),
        requestedLeaseSeconds: 61,
      }),
    ).toMatchObject({ ok: false, error: { code: "MESSAGE_ID_CONFLICT" } });
    setNow("2026-07-18T10:00:20.000Z");
    const beforeEvents = unitOfWork.outbox.length;
    expect(
      await useCases.heartbeatAttempt(ownerRequest("request-heartbeat-1")),
    ).toMatchObject({
      ok: true,
      value: { lease: { expiresAt: "2026-07-18T10:01:20.000Z" } },
      events: [],
    });
    expect(unitOfWork.outbox).toHaveLength(beforeEvents);
  });

  it("fails closed when an exact committed lease lacks its confidential response record", async () => {
    const { useCases, unitOfWork } = harness();
    await useCases.createAttempt(createMessage());
    await useCases.leaseAttempt(leaseRequest());
    unitOfWork.leaseResponses.clear();
    expect(await useCases.leaseAttempt(leaseRequest())).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_MEMENTO_INVALID" },
    });
  });

  it("publishes submit -> artifact -> ended causation and handles same-digest replay without business effects", async () => {
    const { useCases, unitOfWork, setNow } = harness();
    await useCases.createAttempt(createMessage());
    await useCases.leaseAttempt(leaseRequest());
    setNow("2026-07-18T10:00:20.000Z");
    const first = await useCases.submitArtifact(submitRequest());
    expect(first).toMatchObject({
      ok: true,
      disposition: "applied",
      events: [
        {
          eventType: "workshop.artifact-submitted.v1",
          eventId: expect.any(String),
          causationId: "request-submit-1",
        },
        {
          eventType: "workshop.attempt-ended.v1",
          eventId: expect.any(String),
          causationId: expect.any(String),
        },
      ],
    });
    if (first.ok)
      expect(first.events[1]?.causationId).toBe(first.events[0]?.eventId);
    const persistedEvents = unitOfWork.attempts
      .get("attempt-1")
      ?.transitions.at(-1)?.events;
    expect(persistedEvents).toHaveLength(2);
    for (const [index, persisted] of persistedEvents?.entries() ?? [])
      expect(first.ok ? first.events[index] : undefined).toMatchObject({
        eventId: persisted.metadata.eventId,
        occurredAt: persisted.metadata.occurredAt,
        correlationId: persisted.metadata.correlationId,
        causationId: persisted.metadata.causationId,
      });
    unitOfWork.log = [];
    const eventCount = unitOfWork.outbox.length;
    expect(
      await useCases.submitArtifact(submitRequest("request-submit-2")),
    ).toMatchObject({
      ok: true,
      disposition: "idempotent",
      events: [],
      value: { recordedAt: "2026-07-18T10:00:20.000Z" },
    });
    expect(unitOfWork.log).toEqual([
      "inbox.classify",
      "attempts.load",
      "inbox.recordProcessed",
    ]);
    expect(unitOfWork.outbox).toHaveLength(eventCount);
    expect(
      await useCases.submitArtifact({
        ...submitRequest("request-submit-wrong-auth"),
        leaseToken: "wrong-token-that-is-at-least-thirty-two-characters",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "LEASE_AUTHORIZATION_FAILED" },
    });
  });

  it("publishes revoke -> ended with no owner authorization", async () => {
    const { useCases } = harness();
    await useCases.createAttempt(createMessage());
    expect(
      await useCases.revokeAttempt({
        commandId: "command-revoke-1",
        commandType: "workshop.revoke-attempt.v1",
        schemaVersion: 1,
        issuedAt: "2026-07-18T10:00:30.000Z",
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
      }),
    ).toMatchObject({
      ok: true,
      value: { status: "REVOKED" },
      events: [
        {
          eventType: "workshop.attempt-ended.v1",
          causationId: "command-revoke-1",
          data: { outcome: "REVOKED", reason: "MISSION_CANCELLED" },
        },
      ],
    });
  });

  it.each(["outbox.append", "attempts.save", "inbox.recordProcessed"])(
    "leaves all durable ports unchanged when %s fails",
    async (failAt) => {
      const { useCases, unitOfWork } = harness();
      unitOfWork.failAt = failAt;
      await expect(useCases.createAttempt(createMessage())).rejects.toThrow(
        `injected ${failAt} failure`,
      );
      expect(unitOfWork.attempts.size).toBe(0);
      expect(unitOfWork.inbox.size).toBe(0);
      expect(unitOfWork.outbox).toEqual([]);
    },
  );

  it.each([
    "outbox.append",
    "attempts.save",
    "leaseResponses.save",
    "inbox.recordProcessed",
  ])(
    "rolls back lease response and business state when %s fails",
    async (failAt) => {
      const { useCases, unitOfWork } = harness();
      await useCases.createAttempt(createMessage());
      const beforeAttempt = structuredClone(
        unitOfWork.attempts.get("attempt-1"),
      );
      const beforeOutbox = structuredClone(unitOfWork.outbox);
      const beforeInbox = new Map(unitOfWork.inbox);
      unitOfWork.failAt = failAt;
      await expect(useCases.leaseAttempt(leaseRequest())).rejects.toThrow(
        `injected ${failAt} failure`,
      );
      expect(unitOfWork.attempts.get("attempt-1")).toEqual(beforeAttempt);
      expect(unitOfWork.outbox).toEqual(beforeOutbox);
      expect(unitOfWork.inbox).toEqual(beforeInbox);
      expect(unitOfWork.leaseResponses.size).toBe(0);
    },
  );

  it("rejects divergent private/public provenance before committing state or outgoing intent", async () => {
    const { useCases, unitOfWork } = harness();
    await useCases.createAttempt(createMessage());
    const baselineEvents = unitOfWork.outbox.length;
    expect(
      await useCases.leaseAttempt({
        ...leaseRequest("request-lease-forged-correlation"),
        correlationId: "correlation-forged",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "TRANSITION_PROVENANCE_INVALID" },
    });
    expect(
      await useCases.leaseAttempt({
        ...leaseRequest("request-lease-caller-causation"),
        causationId: "caller-selected-cause",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "PRIVATE_INPUT_INVALID" },
    });
    expect(
      await useCases.revokeAttempt({
        commandId: "command-revoke-forged-correlation",
        commandType: "workshop.revoke-attempt.v1",
        schemaVersion: 1,
        issuedAt: "2026-07-18T10:00:30.000Z",
        issuer: "mission-control",
        recipient: "workshop",
        subjectId: "attempt-1",
        correlationId: "correlation-forged",
        causationId: "event-cancelled-retained",
        data: {
          missionId: "mission-1",
          missionRevision: 1,
          attemptId: "attempt-1",
          reason: "MISSION_CANCELLED",
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "TRANSITION_PROVENANCE_INVALID" },
    });
    expect(unitOfWork.outbox).toHaveLength(baselineEvents);
    expect(unitOfWork.leaseResponses.size).toBe(0);
    expect(unitOfWork.inbox.has("request-lease-forged-correlation")).toBe(
      false,
    );
    expect(unitOfWork.inbox.has("command-revoke-forged-correlation")).toBe(
      false,
    );
  });

  it("does not mark invalid or rejected business input processed", async () => {
    const { useCases, unitOfWork } = harness();
    expect(
      await useCases.leaseAttempt({ ...leaseRequest(), extra: true }),
    ).toMatchObject({
      ok: false,
      error: { code: "PRIVATE_INPUT_INVALID" },
    });
    expect(unitOfWork.log).toEqual([]);
    await useCases.createAttempt(createMessage());
    unitOfWork.log = [];
    expect(
      await useCases.heartbeatAttempt({
        ...ownerRequest("request-heartbeat-expired"),
      }),
    ).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_TRANSITION" } });
    expect(unitOfWork.log).toEqual(["inbox.classify", "attempts.load"]);
  });
});
