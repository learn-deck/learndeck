import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CompletionReviewMementoV1 } from "../../apps/verification/src/domain/completion-review.ts";
import {
  VerificationRun,
  calculateGateSetDigest,
  type AcceptanceGate,
  type VerificationRunMementoV1,
} from "../../apps/verification/src/domain/verification-run.ts";
import type { VerificationPublicEvent } from "../../apps/verification/src/application/outgoing-message-factory.ts";
import type {
  EvidenceBundleInput,
  GateExecutionOutcome,
  InboxClassification,
  VerificationIdGenerator,
  VerificationTransaction,
  VerificationUnitOfWork,
  VerifierAssignment,
} from "../../apps/verification/src/application/ports.ts";
import { VerificationUseCases } from "../../apps/verification/src/application/verification-use-cases.ts";

const gates: readonly AcceptanceGate[] = [
  {
    gateId: "lint",
    kind: "LINT",
    commandId: "check-lint",
    mandatory: true,
    timeoutSeconds: 60,
    evidenceLimitBytes: 4096,
  },
  {
    gateId: "tests",
    kind: "TEST",
    commandId: "check-tests",
    mandatory: false,
    timeoutSeconds: 120,
    evidenceLimitBytes: 8192,
  },
];
const artifactDigest = { algorithm: "sha256" as const, value: "b".repeat(64) };

function startMessage(overrides: Record<string, unknown> = {}) {
  const base = {
    commandId: "command-start-1",
    commandType: "verification.start-verification.v1",
    schemaVersion: 1,
    issuedAt: "2026-07-18T10:00:00.000Z",
    issuer: "mission-control",
    recipient: "verification-and-review",
    subjectId: "verification-1",
    correlationId: "correlation-1",
    causationId: "artifact-submitted-1",
    data: {
      verificationRunId: "verification-1",
      attemptId: "attempt-1",
      producingRunnerId: "runner-1",
      binding: {
        missionId: "mission-1",
        missionRevision: 1,
        startingRevision: "fixture-v1",
        artifactDigest,
        gateSetDigest: calculateGateSetDigest(gates),
      },
      artifact: {
        reference: "urn:patchquest:artifact:1",
        digest: artifactDigest,
        changedPaths: ["src/quote.ts"],
      },
      acceptanceGates: gates,
    },
  };
  return { ...base, ...overrides };
}

function privateRequest(requestId: string) {
  return {
    requestId,
    correlationId: "correlation-1",
    verificationRunId: "verification-1",
  };
}

class MemoryUnitOfWork implements VerificationUnitOfWork {
  runs = new Map<string, VerificationRunMementoV1>();
  reviews = new Map<string, CompletionReviewMementoV1>();
  inbox = new Map<string, string>();
  semanticRuns = new Map<string, string>();
  outbox: VerificationPublicEvent[] = [];
  evidence = new Map<
    string,
    Readonly<{
      content: string;
      digest: { algorithm: "sha256"; value: string };
      bytes: number;
    }>
  >();
  bundleInputs: EvidenceBundleInput[] = [];
  log: string[] = [];
  failAt?: string;
  evidenceReceipt?: unknown;
  bundleResult?: unknown;
  classificationResult?: unknown;

  async execute<Result>(
    operation: (transaction: VerificationTransaction) => Promise<Result>,
  ): Promise<Result> {
    const runs = cloneMap(this.runs);
    const reviews = cloneMap(this.reviews);
    const inbox = new Map(this.inbox);
    const semanticRuns = new Map(this.semanticRuns);
    const outbox = structuredClone(this.outbox);
    const evidence = cloneMap(this.evidence);
    const bundleInputs = structuredClone(this.bundleInputs);
    const hit = (name: string) => {
      this.log.push(name);
      if (this.failAt === name) throw new Error(`injected ${name} failure`);
    };
    const transaction: VerificationTransaction = {
      runs: {
        load: async (runId) => {
          hit("runs.load");
          return clone(runs.get(runId));
        },
        save: async (memento) => {
          hit("runs.save");
          runs.set(
            memento.seed.data.verificationRunId,
            structuredClone(memento),
          );
        },
      },
      reviews: {
        load: async (reviewId) => {
          hit("reviews.load");
          return clone(reviews.get(reviewId));
        },
        create: async (memento) => {
          hit("reviews.save");
          if (reviews.has(memento.seed.completionReviewId))
            throw new Error("completion review already exists");
          reviews.set(
            memento.seed.completionReviewId,
            structuredClone(memento),
          );
        },
      },
      inbox: {
        classify: async (messageId, fingerprint, semanticRun) => {
          hit("inbox.classify");
          if (this.classificationResult !== undefined)
            return this.classificationResult as InboxClassification;
          const existing = inbox.get(messageId);
          if (existing !== undefined)
            return existing === fingerprint
              ? "EXACT_REDELIVERY"
              : "MESSAGE_ID_CONFLICT";
          if (semanticRun) {
            const semantic = semanticRuns.get(semanticRun.verificationRunId);
            if (semantic !== undefined)
              return semantic === semanticRun.semanticFingerprint
                ? "SEMANTIC_RUN_DUPLICATE"
                : "SEMANTIC_RUN_CONFLICT";
          }
          return "UNSEEN";
        },
        recordProcessed: async (messageId, fingerprint, semanticRun) => {
          hit("inbox.recordProcessed");
          inbox.set(messageId, fingerprint);
          if (semanticRun)
            semanticRuns.set(
              semanticRun.verificationRunId,
              semanticRun.semanticFingerprint,
            );
        },
      },
      outbox: {
        append: async (message) => {
          hit("outbox.append");
          outbox.push(structuredClone(message));
        },
      },
      evidence: {
        store: async (request) => {
          hit("evidence.store");
          const bytes = Buffer.byteLength(request.content);
          const digest = {
            algorithm: "sha256" as const,
            value: createHash("sha256").update(request.content).digest("hex"),
          };
          evidence.set(request.checkpointKey, {
            content: request.content,
            digest,
            bytes,
          });
          return (this.evidenceReceipt ?? { digest, bytes }) as {
            digest: { algorithm: "sha256"; value: string };
            bytes: number;
          };
        },
      },
      bundles: {
        build: async (input) => {
          hit("bundles.build");
          bundleInputs.push(structuredClone(input));
          return (this.bundleResult ?? {
            algorithm: "sha256",
            value: createHash("sha256")
              .update(JSON.stringify(input))
              .digest("hex"),
          }) as { algorithm: "sha256"; value: string };
        },
      },
    };
    const result = await operation(transaction);
    if (
      typeof result === "object" &&
      result !== null &&
      "ok" in result &&
      result.ok === false
    )
      return result;
    this.runs = runs;
    this.reviews = reviews;
    this.inbox = inbox;
    this.semanticRuns = semanticRuns;
    this.outbox = outbox;
    this.evidence = evidence;
    this.bundleInputs = bundleInputs;
    return result;
  }
}

function clone<Value>(value: Value | undefined): Value | undefined {
  return value === undefined ? undefined : structuredClone(value);
}

function cloneMap<Key, Value>(source: Map<Key, Value>): Map<Key, Value> {
  return new Map(
    [...source].map(([key, value]) => [key, structuredClone(value)]),
  );
}

function accessorResult(): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  Object.defineProperty(value, "kind", {
    enumerable: true,
    get: () => "UNIDENTIFIED_FAILURE",
  });
  return value;
}

function cyclicResult(): Record<string, unknown> {
  const value: Record<string, unknown> = { kind: "UNIDENTIFIED_FAILURE" };
  value["cycle"] = value;
  return value;
}

function harness(
  options: Readonly<{
    assignment?: unknown;
    executions?: readonly unknown[];
    workspace?: unknown;
    ids?: VerificationIdGenerator;
  }> = {},
) {
  const unit = new MemoryUnitOfWork();
  let assignment: unknown =
    options.assignment ??
    ({ kind: "ASSIGNED", verifierId: "verifier-1" } as const);
  const executionQueue = [...(options.executions ?? [])];
  const assignmentRequests: unknown[] = [];
  const workspaceRequests: unknown[] = [];
  const executionRequests: Array<Readonly<Record<string, unknown>>> = [];
  let id = 0;
  const useCases = new VerificationUseCases({
    unitOfWork: unit,
    clock: { now: () => new Date("2026-07-18T10:05:00.000Z") },
    ids: options.ids ?? { nextId: (kind) => `private-${kind}-${++id}` },
    assignments: {
      assign: async (request) => {
        assignmentRequests.push(structuredClone(request));
        return assignment as VerifierAssignment;
      },
    },
    workspaces: {
      materialize: async (request) => {
        workspaceRequests.push(structuredClone(request));
        return (options.workspace ?? {
          kind: "AVAILABLE",
          workspace: { workspaceHandleId: "trusted-workspace-1" },
        }) as Awaited<
          ReturnType<
            import("../../apps/verification/src/application/ports.ts").WorkspaceMaterializerPort["materialize"]
          >
        >;
      },
    },
    executor: {
      execute: async (request) => {
        executionRequests.push(
          structuredClone(request) as unknown as Readonly<
            Record<string, unknown>
          >,
        );
        return (executionQueue.shift() ?? {
          kind: "COMPLETED",
          status: "PASS",
          exitCode: 0,
          durationMs: 10,
          evidence: "ok",
        }) as GateExecutionOutcome;
      },
    },
  });
  return {
    unit,
    useCases,
    assignmentRequests,
    workspaceRequests,
    executionRequests,
    setAssignment(next: VerifierAssignment) {
      assignment = next;
    },
  };
}

describe("Verification application use cases", () => {
  it("persists REQUESTED and returns a stable typed error when assignment has no verifier ID", async () => {
    const h = harness({ assignment: { kind: "UNIDENTIFIED_FAILURE" } });
    const started = await h.useCases.handleStartVerification(startMessage());
    expect(started).toMatchObject({
      ok: false,
      error: { code: "VERIFIER_IDENTITY_UNAVAILABLE" },
    });
    expect(h.unit.runs.get("verification-1")?.status).toBe("REQUESTED");
    expect(h.unit.log.at(-1)).toBe("inbox.recordProcessed");
    expect(h.executionRequests).toHaveLength(0);
    expect(h.workspaceRequests).toHaveLength(0);
    expect(h.unit.evidence).toHaveLength(0);
    expect(h.unit.bundleInputs).toHaveLength(0);
    expect(h.unit.reviews).toHaveLength(0);
    expect(h.unit.outbox).toHaveLength(0);
    expect(
      VerificationRun.rehydrate(
        structuredClone(h.unit.runs.get("verification-1")),
      ),
    ).toMatchObject({ ok: true, value: { snapshot: { status: "REQUESTED" } } });

    expect(
      await h.useCases.handleStartVerification(startMessage()),
    ).toMatchObject({
      ok: false,
      error: { code: "VERIFIER_IDENTITY_UNAVAILABLE" },
    });
    expect(h.assignmentRequests).toHaveLength(1);

    const retry = privateRequest("retry-assignment-unidentified");
    expect(await h.useCases.retryVerifierAssignment(retry)).toMatchObject({
      ok: false,
      error: { code: "VERIFIER_IDENTITY_UNAVAILABLE" },
    });
    expect(h.unit.inbox.has(retry.requestId)).toBe(true);
    expect(await h.useCases.retryVerifierAssignment(retry)).toMatchObject({
      ok: false,
      error: { code: "VERIFIER_IDENTITY_UNAVAILABLE" },
    });
    expect(h.assignmentRequests).toHaveLength(2);

    h.setAssignment({ kind: "ASSIGNED", verifierId: "verifier-1" });
    const retried = await h.useCases.retryVerifierAssignment(
      privateRequest("retry-assignment-1"),
    );
    expect(retried).toMatchObject({
      ok: true,
      value: { assignment: "ASSIGNED", snapshot: { status: "RUNNING" } },
    });
    expect(
      await h.useCases.retryVerifierAssignment(
        privateRequest("retry-assignment-1"),
      ),
    ).toMatchObject({
      ok: true,
      disposition: "idempotent",
      value: { assignment: "ASSIGNED", snapshot: { status: "RUNNING" } },
    });
  });

  it.each([
    [{ kind: "ASSIGNED", verifierId: "runner-1" } as const, "SELF_REJECTED"],
    [
      {
        kind: "UNAVAILABLE",
        verifierId: "verifier-2",
        retryable: true,
      } as const,
      "UNAVAILABLE",
    ],
  ])(
    "aborts self/unavailable assignments without executing gates (%s)",
    async (assignment, outcome) => {
      const h = harness({ assignment });
      const result = await h.useCases.handleStartVerification(startMessage());
      expect(result).toMatchObject({
        ok: true,
        value: { assignment: "ABORTED", snapshot: { status: "ABORTED" } },
        events: [
          {
            eventType: "verification.aborted.v1",
            causationId: "command-start-1",
            data: { reason: "VERIFIER_UNAVAILABLE", retryable: true },
          },
        ],
      });
      expect(h.unit.runs.get("verification-1")?.assignment?.outcome).toBe(
        outcome,
      );
      expect(h.executionRequests).toHaveLength(0);
    },
  );

  it("handles exact delivery, semantic same-run duplicate, and run/message conflicts before assignment", async () => {
    const h = harness();
    await h.useCases.handleStartVerification(startMessage());
    const exact = await h.useCases.handleStartVerification(startMessage());
    const semantic = await h.useCases.handleStartVerification(
      startMessage({
        commandId: "command-start-2",
        issuedAt: "2026-07-18T10:01:00Z",
      }),
    );
    const conflict = await h.useCases.handleStartVerification(
      startMessage({
        commandId: "command-start-3",
        data: { ...startMessage().data, attemptId: "attempt-other" },
      }),
    );
    const messageConflict = await h.useCases.handleStartVerification(
      startMessage({
        commandId: "command-start-1",
        causationId: "other-event",
      }),
    );
    expect(exact).toMatchObject({
      ok: true,
      disposition: "idempotent",
      events: [],
    });
    expect(semantic).toMatchObject({
      ok: true,
      disposition: "idempotent",
      events: [],
    });
    expect(conflict).toMatchObject({
      ok: false,
      error: { code: "RUN_ID_CONFLICT" },
    });
    expect(messageConflict).toMatchObject({
      ok: false,
      error: { code: "MESSAGE_ID_CONFLICT" },
    });
    expect(h.assignmentRequests).toHaveLength(1);
    expect(h.unit.runs.get("verification-1")?.seed.commandId).toBe(
      "command-start-1",
    );
  });

  it("executes exactly one ordered gate per call with a stable run+gate key", async () => {
    const h = harness({
      executions: [
        {
          kind: "COMPLETED",
          status: "PASS",
          exitCode: 0,
          durationMs: 10,
          evidence: "lint ok",
        },
        {
          kind: "COMPLETED",
          status: "FAIL",
          exitCode: 1,
          durationMs: 20,
          evidence: "tests fail",
        },
      ],
    });
    await h.useCases.handleStartVerification(startMessage());
    const first = await h.useCases.executeNextCheckpoint(
      privateRequest("advance-1"),
    );
    expect(first).toMatchObject({
      ok: true,
      value: { status: "RUNNING", completedGateCount: 1, nextGateId: "tests" },
      events: [],
    });
    expect(h.executionRequests).toHaveLength(1);
    expect(h.executionRequests[0]).toMatchObject({
      commandId: "check-lint",
      gate: { gateId: "lint" },
      idempotencyKey: expect.stringMatching(/^checkpoint:/),
    });

    const second = await h.useCases.executeNextCheckpoint(
      privateRequest("advance-2"),
    );
    expect(second).toMatchObject({
      ok: true,
      value: { status: "PASSED", completedGateCount: 2 },
      events: [
        { eventType: "verification.passed.v1", causationId: "command-start-1" },
        { eventType: "review.recommendation-issued.v1" },
      ],
    });
    expect(second.ok && second.events[1]?.causationId).toBe(
      second.ok ? second.events[0]?.eventId : undefined,
    );
    expect(h.executionRequests).toHaveLength(2);
    expect(h.executionRequests[1]).toMatchObject({ commandId: "check-tests" });
    expect(h.unit.outbox.map((event) => event.eventType)).toEqual([
      "verification.passed.v1",
      "review.recommendation-issued.v1",
    ]);
    expect(h.unit.reviews).toHaveLength(1);
    expect(h.unit.log.at(-1)).toBe("inbox.recordProcessed");
  });

  it("derives failed verdict and revision recommendation only from mandatory results", async () => {
    const h = harness({
      executions: [
        {
          kind: "COMPLETED",
          status: "FAIL",
          exitCode: 2,
          durationMs: 10,
          evidence: "bad",
        },
        {
          kind: "COMPLETED",
          status: "PASS",
          exitCode: 0,
          durationMs: 10,
          evidence: "ok",
        },
      ],
    });
    await h.useCases.handleStartVerification(startMessage());
    await h.useCases.executeNextCheckpoint(privateRequest("advance-1"));
    const completed = await h.useCases.executeNextCheckpoint(
      privateRequest("advance-2"),
    );
    expect(completed).toMatchObject({
      ok: true,
      events: [
        {
          eventType: "verification.failed.v1",
          data: { failedGateIds: ["lint"] },
        },
        {
          eventType: "review.recommendation-issued.v1",
          data: { recommendation: "REQUEST_REVISION" },
        },
      ],
    });
    expect(h.unit.bundleInputs).toMatchObject([
      {
        kind: "VERIFICATION",
        results: [{ gateId: "lint" }, { gateId: "tests" }],
      },
    ]);
  });

  it.each([
    [
      "workspace",
      {
        workspace: {
          kind: "UNAVAILABLE",
          retryable: true,
          detail: "missing",
          diagnostic: "bounded trace",
        },
      } as const,
      "WORKSPACE_UNAVAILABLE",
    ],
    [
      "verifier",
      {
        executions: [
          { kind: "VERIFIER_UNAVAILABLE", retryable: true, detail: "gone" },
        ],
      } as const,
      "VERIFIER_UNAVAILABLE",
    ],
    [
      "infrastructure",
      {
        executions: [
          {
            kind: "INFRASTRUCTURE_FAILURE",
            retryable: true,
            detail: "offline",
          },
        ],
      } as const,
      "EXECUTION_INFRASTRUCTURE_FAILURE",
    ],
  ])(
    "turns typed %s inability into a retryable abort",
    async (_label, options, reason) => {
      const h = harness(options);
      await h.useCases.handleStartVerification(startMessage());
      const result = await h.useCases.executeNextCheckpoint(
        privateRequest("advance-1"),
      );
      expect(result).toMatchObject({
        ok: true,
        value: { status: "ABORTED" },
        events: [
          {
            eventType: "verification.aborted.v1",
            data: { reason, retryable: true },
          },
        ],
      });
      expect(h.unit.reviews).toHaveLength(0);
      expect(h.executionRequests).toHaveLength(
        reason === "WORKSPACE_UNAVAILABLE" ? 0 : 1,
      );
    },
  );

  it.each([
    [
      "verifier assignment",
      {
        assignment: {
          kind: "UNAVAILABLE",
          verifierId: "verifier-2",
          retryable: false,
        },
      },
      "VERIFIER_UNAVAILABLE",
      "start",
    ],
    [
      "workspace",
      { workspace: { kind: "UNAVAILABLE", retryable: false } },
      "WORKSPACE_UNAVAILABLE",
      "advance",
    ],
    [
      "execution",
      {
        executions: [{ kind: "INFRASTRUCTURE_FAILURE", retryable: false }],
      },
      "EXECUTION_INFRASTRUCTURE_FAILURE",
      "advance",
    ],
  ] as const)(
    "persists a trusted nonretryable %s classification",
    async (_label, options, reason, entrypoint) => {
      const h = harness(options);
      const started = await h.useCases.handleStartVerification(startMessage());
      const result =
        entrypoint === "start"
          ? started
          : await h.useCases.executeNextCheckpoint(
              privateRequest(`nonretryable-${reason}`),
            );
      expect(result).toMatchObject({
        ok: true,
        events: [
          {
            eventType: "verification.aborted.v1",
            data: { reason, retryable: false },
          },
        ],
      });
      expect(h.unit.runs.get("verification-1")?.terminalOutcome).toEqual({
        kind: "ABORT",
        reason,
        retryable: false,
      });
    },
  );

  it("cancels only an assigned run, is nonretryable, and never creates a review", async () => {
    const h = harness();
    await h.useCases.handleStartVerification(startMessage());
    const cancelled = await h.useCases.abortVerification({
      ...privateRequest("cancel-1"),
      reason: "MISSION_CANCELLED",
    });
    expect(cancelled).toMatchObject({
      ok: true,
      events: [
        {
          eventType: "verification.aborted.v1",
          causationId: "command-start-1",
          data: { reason: "MISSION_CANCELLED", retryable: false },
        },
      ],
    });
    expect(h.unit.reviews).toHaveLength(0);

    const pending = harness({ assignment: { kind: "UNIDENTIFIED_FAILURE" } });
    await pending.useCases.handleStartVerification(startMessage());
    expect(
      await pending.useCases.abortVerification({
        ...privateRequest("cancel-2"),
        reason: "MISSION_CANCELLED",
      }),
    ).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_TRANSITION" } });
  });

  it("redelivers a committed checkpoint response without re-materializing or re-executing", async () => {
    const h = harness();
    await h.useCases.handleStartVerification(startMessage());
    const request = privateRequest("advance-1");
    await h.useCases.executeNextCheckpoint(request);
    const redelivered = await h.useCases.executeNextCheckpoint(request);
    expect(redelivered).toMatchObject({
      ok: true,
      disposition: "idempotent",
      events: [],
    });
    expect(h.workspaceRequests).toHaveLength(1);
    expect(h.executionRequests).toHaveLength(1);
  });

  it.each([
    "runs.save",
    "reviews.save",
    "outbox.append",
    "evidence.store",
    "bundles.build",
  ])("rolls back transaction state when %s fails", async (failAt) => {
    const h = harness();
    if (failAt === "runs.save") {
      h.unit.failAt = failAt;
      await expect(
        h.useCases.handleStartVerification(startMessage()),
      ).rejects.toThrow("injected");
      expect(h.unit.runs).toHaveLength(0);
      expect(h.unit.inbox).toHaveLength(0);
      expect(h.unit.outbox).toHaveLength(0);
      return;
    }
    await h.useCases.handleStartVerification(startMessage());
    if (
      failAt === "bundles.build" ||
      failAt === "reviews.save" ||
      failAt === "outbox.append"
    )
      await h.useCases.executeNextCheckpoint(privateRequest("advance-1"));
    const before = structuredClone(h.unit.runs.get("verification-1"));
    h.unit.failAt = failAt;
    await expect(
      h.useCases.executeNextCheckpoint(
        privateRequest(
          failAt === "bundles.build" ||
            failAt === "reviews.save" ||
            failAt === "outbox.append"
            ? "advance-2"
            : "advance-1",
        ),
      ),
    ).rejects.toThrow("injected");
    expect(h.unit.runs.get("verification-1")).toEqual(before);
    expect(
      h.unit.inbox.has(
        failAt === "bundles.build" ||
          failAt === "reviews.save" ||
          failAt === "outbox.append"
          ? "advance-2"
          : "advance-1",
      ),
    ).toBe(false);
  });

  it("keeps the first terminal verdict immutable against later cancel/advance attempts", async () => {
    const h = harness();
    await h.useCases.handleStartVerification(startMessage());
    await h.useCases.executeNextCheckpoint(privateRequest("advance-1"));
    await h.useCases.executeNextCheckpoint(privateRequest("advance-2"));
    expect(
      await h.useCases.abortVerification({
        ...privateRequest("cancel-after-terminal"),
        reason: "MISSION_CANCELLED",
      }),
    ).toMatchObject({ ok: false, error: { code: "RUN_TERMINAL" } });
    expect(
      await h.useCases.executeNextCheckpoint(privateRequest("advance-3")),
    ).toMatchObject({
      ok: false,
      error: { code: "RUN_TERMINAL" },
    });
    expect(h.unit.outbox).toHaveLength(2);
  });

  it.each(["retry", "advance", "cancel"] as const)(
    "rejects a mismatched private correlation before %s side effects",
    async (operation) => {
      const h =
        operation === "retry"
          ? harness({ assignment: { kind: "UNIDENTIFIED_FAILURE" } })
          : harness();
      await h.useCases.handleStartVerification(startMessage());
      const before = structuredClone(h.unit.runs.get("verification-1"));
      const inboxBefore = new Map(h.unit.inbox);
      const outboxBefore = structuredClone(h.unit.outbox);
      const assignmentCalls = h.assignmentRequests.length;
      h.unit.log.length = 0;
      const input = {
        ...privateRequest(`wrong-correlation-${operation}`),
        correlationId: "correlation-other",
      };
      const result =
        operation === "retry"
          ? await h.useCases.retryVerifierAssignment(input)
          : operation === "advance"
            ? await h.useCases.executeNextCheckpoint(input)
            : await h.useCases.abortVerification({
                ...input,
                reason: "MISSION_CANCELLED",
              });

      expect(result).toMatchObject({
        ok: false,
        error: { code: "CORRELATION_MISMATCH" },
      });
      expect(h.unit.runs.get("verification-1")).toEqual(before);
      expect(h.unit.inbox).toEqual(inboxBefore);
      expect(h.unit.outbox).toEqual(outboxBefore);
      expect(h.assignmentRequests).toHaveLength(assignmentCalls);
      expect(h.workspaceRequests).toHaveLength(0);
      expect(h.executionRequests).toHaveLength(0);
      expect(h.unit.evidence).toHaveLength(0);
      expect(h.unit.bundleInputs).toHaveLength(0);
      expect(h.unit.log).toEqual(["inbox.classify", "runs.load"]);
    },
  );

  it.each(["start", "retry", "advance", "cancel"] as const)(
    "rejects malformed inbox classifications before %s downstream work",
    async (operation) => {
      for (const classification of [
        "UNSEEN_EVIL",
        7,
        false,
        { classification: "UNSEEN", extra: true },
        Object.create({ classification: "UNSEEN" }),
        accessorResult(),
        new Proxy({ classification: "UNSEEN" }, {}),
        cyclicResult(),
      ]) {
        const h =
          operation === "retry"
            ? harness({ assignment: { kind: "UNIDENTIFIED_FAILURE" } })
            : harness();
        if (operation !== "start")
          await h.useCases.handleStartVerification(startMessage());
        const runBefore = structuredClone(h.unit.runs.get("verification-1"));
        const inboxBefore = new Map(h.unit.inbox);
        const outboxBefore = structuredClone(h.unit.outbox);
        const assignmentCalls = h.assignmentRequests.length;
        h.unit.log.length = 0;
        h.unit.classificationResult = classification;
        const input = privateRequest(`invalid-classification-${operation}`);
        const result =
          operation === "start"
            ? await h.useCases.handleStartVerification(startMessage())
            : operation === "retry"
              ? await h.useCases.retryVerifierAssignment(input)
              : operation === "advance"
                ? await h.useCases.executeNextCheckpoint(input)
                : await h.useCases.abortVerification({
                    ...input,
                    reason: "MISSION_CANCELLED",
                  });

        expect(result).toMatchObject({
          ok: false,
          error: { code: "PORT_RESULT_INVALID" },
        });
        expect(h.unit.runs.get("verification-1")).toEqual(runBefore);
        expect(h.unit.inbox).toEqual(inboxBefore);
        expect(h.unit.outbox).toEqual(outboxBefore);
        expect(h.assignmentRequests).toHaveLength(assignmentCalls);
        expect(h.workspaceRequests).toHaveLength(0);
        expect(h.executionRequests).toHaveLength(0);
        expect(h.unit.evidence).toHaveLength(0);
        expect(h.unit.bundleInputs).toHaveLength(0);
        expect(h.unit.reviews).toHaveLength(0);
        expect(h.unit.log).toEqual(["inbox.classify"]);
      }
    },
  );

  it.each([
    ["extra", { kind: "UNIDENTIFIED_FAILURE", secret: "no" }],
    ["inherited", Object.create({ kind: "UNIDENTIFIED_FAILURE" })],
    ["accessor", accessorResult()],
    ["custom", new (class PortResult {})()],
    ["proxy", new Proxy({ kind: "UNIDENTIFIED_FAILURE" }, {})],
    ["sparse", new Array(1)],
    ["cyclic", cyclicResult()],
    ["unknown-kind", { kind: "SOMETHING_ELSE" }],
    ["wrong-primitive", "UNIDENTIFIED_FAILURE"],
  ])("rejects %s assignment result topology", async (_label, assignment) => {
    const h = harness({ assignment });
    const result = await h.useCases.handleStartVerification(startMessage());
    expect(result).toMatchObject({
      ok: false,
      error: { code: "PORT_RESULT_INVALID" },
    });
    expect(h.unit.runs).toHaveLength(0);
    expect(h.unit.inbox).toHaveLength(0);
    expect(h.unit.outbox).toHaveLength(0);
    expect(h.workspaceRequests).toHaveLength(0);
    expect(h.executionRequests).toHaveLength(0);
  });

  it.each([
    [
      "secret workspace extra",
      {
        kind: "AVAILABLE",
        workspace: { workspaceHandleId: "workspace-1", token: "secret" },
      },
    ],
    ["unknown kind", { kind: "READY" }],
    ["wrong diagnostic", { kind: "UNAVAILABLE", retryable: true, detail: 1 }],
    ["accessor", accessorResult()],
    ["proxy", new Proxy({ kind: "AVAILABLE", workspace: {} }, {})],
    ["cycle", cyclicResult()],
  ])(
    "rejects %s materializer result before execution",
    async (_label, workspace) => {
      const h = harness({ workspace });
      await h.useCases.handleStartVerification(startMessage());
      const before = structuredClone(h.unit.runs.get("verification-1"));
      const result = await h.useCases.executeNextCheckpoint(
        privateRequest("invalid-workspace"),
      );
      expect(result).toMatchObject({
        ok: false,
        error: { code: "PORT_RESULT_INVALID" },
      });
      expect(h.unit.runs.get("verification-1")).toEqual(before);
      expect(h.executionRequests).toHaveLength(0);
      expect(h.unit.evidence).toHaveLength(0);
      expect(h.unit.inbox.has("invalid-workspace")).toBe(false);
    },
  );

  it.each([
    [
      "extra field",
      {
        kind: "COMPLETED",
        status: "PASS",
        exitCode: 0,
        durationMs: 1,
        evidence: "ok",
        extra: true,
      },
    ],
    [
      "unknown status",
      {
        kind: "COMPLETED",
        status: "MAYBE",
        exitCode: 0,
        durationMs: 1,
        evidence: "ok",
      },
    ],
    [
      "wrong exit",
      {
        kind: "COMPLETED",
        status: "PASS",
        exitCode: 1,
        durationMs: 1,
        evidence: "ok",
      },
    ],
    [
      "wrong duration",
      {
        kind: "COMPLETED",
        status: "PASS",
        exitCode: 0,
        durationMs: -1,
        evidence: "ok",
      },
    ],
    [
      "wrong evidence",
      {
        kind: "COMPLETED",
        status: "PASS",
        exitCode: 0,
        durationMs: 1,
        evidence: 7,
      },
    ],
    [
      "oversized UTF-8 evidence",
      {
        kind: "COMPLETED",
        status: "PASS",
        exitCode: 0,
        durationMs: 1,
        evidence: "€".repeat(1400),
      },
    ],
    ["unknown kind", { kind: "NOT_EXECUTED" }],
    [
      "bad diagnostic",
      { kind: "VERIFIER_UNAVAILABLE", retryable: true, diagnostic: [] },
    ],
    ["accessor", accessorResult()],
    ["proxy", new Proxy({ kind: "COMPLETED" }, {})],
    ["cycle", cyclicResult()],
  ])(
    "rejects %s executor result before evidence storage",
    async (_label, execution) => {
      const h = harness({ executions: [execution] });
      await h.useCases.handleStartVerification(startMessage());
      const before = structuredClone(h.unit.runs.get("verification-1"));
      const result = await h.useCases.executeNextCheckpoint(
        privateRequest("invalid-execution"),
      );
      expect(result).toMatchObject({
        ok: false,
        error: { code: "PORT_RESULT_INVALID" },
      });
      expect(h.unit.runs.get("verification-1")).toEqual(before);
      expect(h.unit.evidence).toHaveLength(0);
      expect(h.unit.bundleInputs).toHaveLength(0);
      expect(h.unit.inbox.has("invalid-execution")).toBe(false);
    },
  );

  it.each([
    ["empty", "", 0],
    ["multibyte UTF-8", "€", 3],
    ["exact byte limit", "x".repeat(4096), 4096],
  ])(
    "independently binds %s evidence digest and byte count",
    async (_label, evidence, expectedBytes) => {
      const h = harness({
        executions: [
          {
            kind: "COMPLETED",
            status: "PASS",
            exitCode: 0,
            durationMs: 1,
            evidence,
          },
        ],
      });
      await h.useCases.handleStartVerification(startMessage());
      const result = await h.useCases.executeNextCheckpoint(
        privateRequest(`evidence-${expectedBytes}`),
      );
      const expectedDigest = createHash("sha256")
        .update(evidence, "utf8")
        .digest("hex");
      expect(result).toMatchObject({
        ok: true,
        value: {
          results: [
            {
              evidenceBytes: expectedBytes,
              evidenceDigest: { algorithm: "sha256", value: expectedDigest },
            },
          ],
        },
      });
      expect(h.unit.evidence.values().next().value).toMatchObject({
        content: evidence,
        bytes: expectedBytes,
        digest: { algorithm: "sha256", value: expectedDigest },
      });
      expect(h.unit.bundleInputs).toHaveLength(0);
    },
  );

  it("rejects evidence one byte over the limit before storage", async () => {
    const h = harness({
      executions: [
        {
          kind: "COMPLETED",
          status: "PASS",
          exitCode: 0,
          durationMs: 1,
          evidence: "x".repeat(4097),
        },
      ],
    });
    await h.useCases.handleStartVerification(startMessage());
    const before = structuredClone(h.unit.runs.get("verification-1"));
    const result = await h.useCases.executeNextCheckpoint(
      privateRequest("evidence-over-limit"),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "PORT_RESULT_INVALID" },
    });
    expect(h.unit.runs.get("verification-1")).toEqual(before);
    expect(h.unit.evidence).toHaveLength(0);
    expect(h.unit.bundleInputs).toHaveLength(0);
    expect(h.unit.inbox.has("evidence-over-limit")).toBe(false);
  });

  it.each([
    ["extra", { digest: artifactDigest, bytes: 2, extra: true }],
    ["bad digest", { digest: { algorithm: "sha1", value: "a" }, bytes: 2 }],
    [
      "wrong valid digest",
      { digest: { algorithm: "sha256", value: "a".repeat(64) }, bytes: 2 },
    ],
    [
      "wrong valid byte count",
      {
        digest: {
          algorithm: "sha256",
          value: createHash("sha256").update("ok", "utf8").digest("hex"),
        },
        bytes: 1,
      },
    ],
    ["bad bytes", { digest: artifactDigest, bytes: "2" }],
    ["accessor", accessorResult()],
    ["proxy", new Proxy({ digest: artifactDigest, bytes: 2 }, {})],
    ["cycle", cyclicResult()],
  ])(
    "rejects %s evidence receipt and rolls back storage",
    async (_label, receipt) => {
      const h = harness();
      await h.useCases.handleStartVerification(startMessage());
      const before = structuredClone(h.unit.runs.get("verification-1"));
      h.unit.evidenceReceipt = receipt;
      const result = await h.useCases.executeNextCheckpoint(
        privateRequest("invalid-evidence-receipt"),
      );
      expect(result).toMatchObject({
        ok: false,
        error: { code: "PORT_RESULT_INVALID" },
      });
      expect(h.unit.runs.get("verification-1")).toEqual(before);
      expect(h.unit.evidence).toHaveLength(0);
      expect(h.unit.bundleInputs).toHaveLength(0);
      expect(h.unit.reviews).toHaveLength(0);
      expect(h.unit.outbox).toHaveLength(0);
      expect(h.unit.inbox.has("invalid-evidence-receipt")).toBe(false);
    },
  );

  it.each([
    ["extra", { algorithm: "sha256", value: "a".repeat(64), extra: true }],
    ["wrong primitive", "digest"],
    ["accessor", accessorResult()],
    ["proxy", new Proxy({ algorithm: "sha256", value: "a".repeat(64) }, {})],
    ["cycle", cyclicResult()],
  ])(
    "rejects %s verdict bundle result and rolls back the final checkpoint",
    async (_label, bundle) => {
      const h = harness();
      await h.useCases.handleStartVerification(startMessage());
      await h.useCases.executeNextCheckpoint(privateRequest("bundle-first"));
      const before = structuredClone(h.unit.runs.get("verification-1"));
      const evidenceBefore = cloneMap(h.unit.evidence);
      h.unit.bundleResult = bundle;
      const result = await h.useCases.executeNextCheckpoint(
        privateRequest("invalid-verdict-bundle"),
      );
      expect(result).toMatchObject({
        ok: false,
        error: { code: "PORT_RESULT_INVALID" },
      });
      expect(h.unit.runs.get("verification-1")).toEqual(before);
      expect(h.unit.evidence).toEqual(evidenceBefore);
      expect(h.unit.reviews).toHaveLength(0);
      expect(h.unit.outbox).toHaveLength(0);
      expect(h.unit.inbox.has("invalid-verdict-bundle")).toBe(false);
    },
  );

  it("rejects an invalid abort bundle result without committing the abort", async () => {
    const h = harness({
      workspace: {
        kind: "UNAVAILABLE",
        retryable: false,
        diagnostic: "workspace diagnostic",
      },
    });
    await h.useCases.handleStartVerification(startMessage());
    const before = structuredClone(h.unit.runs.get("verification-1"));
    h.unit.bundleResult = { algorithm: "sha256", value: "short" };
    const result = await h.useCases.executeNextCheckpoint(
      privateRequest("invalid-abort-bundle"),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "PORT_RESULT_INVALID" },
    });
    expect(h.unit.runs.get("verification-1")).toEqual(before);
    expect(h.unit.bundleInputs).toHaveLength(0);
    expect(h.unit.outbox).toHaveLength(0);
    expect(h.unit.inbox.has("invalid-abort-bundle")).toBe(false);
  });

  it("rejects a generated completion-review ID collision atomically", async () => {
    let sequence = 0;
    const h = harness({
      ids: {
        nextId: (kind) =>
          kind === "completion-review"
            ? "completion-review-fixed"
            : `private-${kind}-${++sequence}`,
      },
    });
    await h.useCases.handleStartVerification(startMessage());
    await h.useCases.executeNextCheckpoint(privateRequest("run-1-first"));
    await h.useCases.executeNextCheckpoint(privateRequest("run-1-second"));
    const firstReview = structuredClone(
      h.unit.reviews.get("completion-review-fixed"),
    );
    const firstOutbox = structuredClone(h.unit.outbox);

    const secondBase = startMessage();
    await h.useCases.handleStartVerification(
      startMessage({
        commandId: "command-start-2",
        subjectId: "verification-2",
        correlationId: "correlation-2",
        data: {
          ...secondBase.data,
          verificationRunId: "verification-2",
          attemptId: "attempt-2",
        },
      }),
    );
    const request = (requestId: string) => ({
      requestId,
      correlationId: "correlation-2",
      verificationRunId: "verification-2",
    });
    await h.useCases.executeNextCheckpoint(request("run-2-first"));
    const beforeSecondCompletion = structuredClone(
      h.unit.runs.get("verification-2"),
    );
    const result = await h.useCases.executeNextCheckpoint(
      request("run-2-second"),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "REVIEW_ID_CONFLICT" },
    });
    expect(h.unit.reviews).toHaveLength(1);
    expect(h.unit.reviews.get("completion-review-fixed")).toEqual(firstReview);
    expect(h.unit.runs.get("verification-2")).toEqual(beforeSecondCompletion);
    expect(h.unit.outbox).toEqual(firstOutbox);
    expect(h.unit.inbox.has("run-2-second")).toBe(false);
  });
});
