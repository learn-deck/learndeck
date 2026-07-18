import { describe, expect, it } from "vitest";
import {
  CompletionReview,
  VerificationRun,
  calculateGateSetDigest,
  verificationSemanticFingerprint,
  type AcceptanceGate,
  type CheckResult,
  type StartVerificationSeed,
  type VerificationVerdictEvent,
} from "../../apps/verification/src/index.ts";

const digest = (character: string) => ({
  algorithm: "sha256" as const,
  value: character.repeat(64),
});

const gates: readonly AcceptanceGate[] = [
  {
    gateId: "tests",
    kind: "TEST",
    commandId: "check-tests",
    mandatory: true,
    timeoutSeconds: 2,
    evidenceLimitBytes: 100,
  },
  {
    gateId: "lint.optional",
    kind: "LINT",
    commandId: "check-lint",
    mandatory: false,
    timeoutSeconds: 1,
    evidenceLimitBytes: 0,
  },
  {
    gateId: "scope",
    kind: "ALLOWED_SCOPE",
    commandId: "check-allowed-scope",
    mandatory: true,
    timeoutSeconds: 3,
    evidenceLimitBytes: 1_048_576,
  },
];

function seed(
  overrides: Partial<StartVerificationSeed> = {},
): StartVerificationSeed {
  const gateSetDigest = calculateGateSetDigest(gates);
  return {
    commandId: "command-start-1",
    commandType: "verification.start-verification.v1",
    schemaVersion: 1,
    issuedAt: "2026-07-18T10:00:00.000Z",
    issuer: "mission-control",
    recipient: "verification-and-review",
    subjectId: "verification-1",
    correlationId: "correlation-1",
    causationId: "artifact-event-1",
    data: {
      verificationRunId: "verification-1",
      attemptId: "attempt-1",
      producingRunnerId: "runner-producer",
      binding: {
        missionId: "mission-1",
        missionRevision: 1,
        startingRevision: "revision-1",
        artifactDigest: digest("a"),
        gateSetDigest,
      },
      artifact: {
        reference: "urn:patchquest:artifact:1",
        digest: digest("a"),
        changedPaths: ["src/quote.ts"],
      },
      acceptanceGates: gates,
    },
    ...overrides,
  };
}

function requested(input = seed()): VerificationRun {
  const result = VerificationRun.start(input);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function running(): VerificationRun {
  const run = requested();
  const assigned = run.assign({
    requestId: "assign-1",
    at: "2026-07-18T10:00:01.000Z",
    verifierId: "verifier-1",
    availability: "AVAILABLE",
  });
  if (!assigned.ok) throw new Error(assigned.error.message);
  return run;
}

function resultFor(
  gate: AcceptanceGate,
  status: CheckResult["status"] = "PASS",
  overrides: Partial<CheckResult> = {},
): CheckResult {
  return {
    gateId: gate.gateId,
    commandId: gate.commandId,
    status,
    exitCode: status === "PASS" ? 0 : status === "FAIL" ? 1 : null,
    durationMs: status === "TIMEOUT" ? gate.timeoutSeconds * 1000 : 10,
    evidenceDigest: digest("e"),
    evidenceBytes: 0,
    ...overrides,
  };
}

function recordNext(
  run: VerificationRun,
  status: CheckResult["status"] = "PASS",
  overrides: Partial<CheckResult> = {},
): ReturnType<VerificationRun["recordCheckResult"]> {
  const next = run.resumeState;
  if (!next.nextGate || !next.checkpointKey) throw new Error("No next gate");
  const sequence = run.snapshot.completedGateCount + 1;
  return run.recordCheckResult({
    requestId: `result-${sequence}`,
    at: `2026-07-18T10:00:0${sequence + 1}.000Z`,
    checkpointKey: next.checkpointKey,
    result: resultFor(next.nextGate, status, overrides),
  });
}

function completed(
  statuses: readonly CheckResult["status"][] = ["PASS", "PASS", "PASS"],
): { run: VerificationRun; event: VerificationVerdictEvent } {
  const run = running();
  for (const status of statuses) {
    const recorded = recordNext(run, status);
    if (!recorded.ok) throw new Error(recorded.error.message);
  }
  const complete = run.complete({
    requestId: "complete-1",
    at: "2026-07-18T10:00:10.000Z",
    evidenceBundleDigest: digest("b"),
  });
  if (!complete.ok) throw new Error(complete.error.message);
  return { run, event: complete.events[0] as VerificationVerdictEvent };
}

function roundTrip(run: VerificationRun): void {
  const memento = structuredClone(run.toMemento());
  const restored = VerificationRun.rehydrate(memento);
  if (!restored.ok)
    throw new Error(`${restored.error.code}: ${restored.error.message}`);
  if (restored.ok) expect(restored.value.toMemento()).toEqual(memento);
}

describe("VerificationRun start and immutable binding", () => {
  it("normalizes shuffled gates, retains exact provenance, and creates stable checkpoints", () => {
    const input = seed();
    const run = requested(input);
    expect(run.snapshot).toMatchObject({
      status: "REQUESTED",
      verificationRunId: "verification-1",
      nextGateId: "lint.optional",
      totalGateCount: 3,
    });
    expect(run.snapshot.gates.map((gate) => gate.gateId)).toEqual([
      "lint.optional",
      "scope",
      "tests",
    ]);
    expect(run.toMemento().seed.commandId).toBe("command-start-1");
    expect(run.toMemento().seed.causationId).toBe("artifact-event-1");
    expect(run.checkpointKeyFor("scope")).toMatch(/^checkpoint:[a-f0-9]{64}$/);
    (input.data.artifact.changedPaths as string[])[0] = "forged.ts";
    expect(run.snapshot.binding.artifactDigest).toEqual(digest("a"));
    expect(Object.isFrozen(run.snapshot.gates)).toBe(true);
    roundTrip(run);
  });

  it("uses an unambiguous run/gate tuple for stable checkpoint keys", () => {
    const makeRun = (runId: string, gateId: string, commandId: string) => {
      const acceptanceGates: readonly AcceptanceGate[] = [
        {
          gateId,
          kind: "LINT",
          commandId: "check-lint",
          mandatory: true,
          timeoutSeconds: 1,
          evidenceLimitBytes: 1,
        },
      ];
      const base = seed();
      return requested({
        ...base,
        commandId,
        subjectId: runId,
        data: {
          ...base.data,
          verificationRunId: runId,
          binding: {
            ...base.data.binding,
            gateSetDigest: calculateGateSetDigest(acceptanceGates),
          },
          acceptanceGates,
        },
      });
    };
    const left = makeRun("a:b", "c", "command-left");
    const right = makeRun("a", "b:c", "command-right");
    expect(left.checkpointKeyFor("c")).not.toBe(right.checkpointKeyFor("b:c"));
    roundTrip(left);
    roundTrip(right);
  });

  it("shares the fixed punctuation-heavy canonical digest vector without cross-context imports", () => {
    const punctuation: readonly AcceptanceGate[] = [
      {
        ...gates[0]!,
        gateId: "gate:a",
        timeoutSeconds: 60,
        evidenceLimitBytes: 16_384,
      },
      {
        ...gates[0]!,
        gateId: "gate.Z",
        timeoutSeconds: 60,
        evidenceLimitBytes: 16_384,
      },
      {
        ...gates[0]!,
        gateId: "gate_a",
        timeoutSeconds: 60,
        evidenceLimitBytes: 16_384,
      },
      {
        ...gates[0]!,
        gateId: "gate-2",
        timeoutSeconds: 60,
        evidenceLimitBytes: 16_384,
      },
      {
        ...gates[0]!,
        gateId: "gate.10",
        timeoutSeconds: 60,
        evidenceLimitBytes: 16_384,
      },
    ];
    expect(calculateGateSetDigest(punctuation).value).toBe(
      "ad9ecf91d7dfd30907e8f2a6a70e8b40bf9baa790b3e07662582f41498a76ace",
    );
  });

  it.each([
    { subjectId: "other" },
    { data: { ...seed().data, verificationRunId: "other" } },
    {
      data: {
        ...seed().data,
        binding: { ...seed().data.binding, artifactDigest: digest("c") },
      },
    },
    {
      data: {
        ...seed().data,
        artifact: { ...seed().data.artifact, changedPaths: ["C:repo/file.ts"] },
      },
    },
    {
      data: {
        ...seed().data,
        acceptanceGates: [{ ...gates[0]!, kind: "LINT" as const }],
      },
    },
  ])(
    "rejects binding, path, registry, and global-identity forgery %#",
    (override) => {
      expect(
        VerificationRun.start(seed(override as Partial<StartVerificationSeed>)),
      ).toMatchObject({
        ok: false,
        error: { code: "INVALID_START" },
      });
    },
  );

  it("distinguishes exact delivery, semantic duplicate, message-ID conflict, and run conflict", () => {
    const run = requested();
    expect(run.compareStart(seed())).toBe("EXACT_DELIVERY_DUPLICATE");
    expect(
      run.compareStart(
        seed({
          commandId: "command-start-2",
          issuedAt: "2026-07-18T11:00:00Z",
        }),
      ),
    ).toBe("SEMANTIC_DUPLICATE");
    expect(run.compareStart(seed({ issuedAt: "2026-07-18T11:00:00Z" }))).toBe(
      "MESSAGE_ID_CONFLICT",
    );
    expect(
      run.compareStart(
        seed({
          commandId: "command-start-2",
          data: { ...seed().data, attemptId: "attempt-2" },
        }),
      ),
    ).toBe("RUN_ID_CONFLICT");
    expect(verificationSemanticFingerprint(seed())).toHaveLength(64);
  });
});

describe("VerificationRun assignment and gate checkpoints", () => {
  it("assigns only a distinct available verifier and round-trips", () => {
    const run = running();
    expect(run.snapshot).toMatchObject({
      status: "RUNNING",
      verifierId: "verifier-1",
    });
    expect(
      run.assign({
        requestId: "assign-2",
        at: "2026-07-18T10:00:02Z",
        verifierId: "verifier-2",
        availability: "AVAILABLE",
      }),
    ).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_TRANSITION" } });
    roundTrip(run);
  });

  it.each([
    ["runner-producer", "AVAILABLE", "SELF_REJECTED"],
    ["verifier-unavailable", "UNAVAILABLE", "UNAVAILABLE"],
  ] as const)(
    "aborts typed unavailable assignment %s/%s",
    (verifierId, availability, outcome) => {
      const run = requested();
      const assigned = run.assign({
        requestId: "assign-unavailable",
        at: "2026-07-18T10:00:01Z",
        verifierId,
        availability,
        retryable: true,
      });
      expect(assigned).toMatchObject({
        ok: true,
        events: [
          {
            kind: "VERIFICATION_ABORTED",
            reason: "VERIFIER_UNAVAILABLE",
            retryable: true,
            verifierId,
            metadata: { causationId: "command-start-1" },
          },
        ],
      });
      expect(run.toMemento().assignment?.outcome).toBe(outcome);
      expect(run.toMemento().abortEvidence).toBeUndefined();
      roundTrip(run);
    },
  );

  it("rejects a caller attempt to make self-verifier rejection nonretryable", () => {
    const run = requested();
    const before = run.toMemento();
    expect(
      run.assign({
        requestId: "assign-forged-self",
        at: "2026-07-18T10:00:01Z",
        verifierId: "runner-producer",
        availability: "AVAILABLE",
        retryable: false,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_ASSIGNMENT" } });
    expect(run.toMemento()).toEqual(before);
  });

  it("does not fabricate an abort when assignment has no actual verifier ID", () => {
    const run = requested();
    const before = run.toMemento();
    expect(
      run.assign({
        requestId: "assign-bad",
        at: "2026-07-18T10:00:01Z",
        verifierId: "",
        availability: "UNAVAILABLE",
        retryable: true,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_ASSIGNMENT" } });
    expect(run.toMemento()).toEqual(before);
  });

  it("records exactly the first missing gate and resumes without rerunning it", () => {
    const run = running();
    const wrongGate = run.snapshot.gates[1]!;
    expect(
      run.recordCheckResult({
        requestId: "out-of-order",
        at: "2026-07-18T10:00:02Z",
        checkpointKey: run.checkpointKeyFor(wrongGate.gateId) as string,
        result: resultFor(wrongGate),
      }),
    ).toMatchObject({ ok: false, error: { code: "CHECKPOINT_OUT_OF_ORDER" } });
    const first = recordNext(run, "FAIL");
    expect(first).toMatchObject({ ok: true, disposition: "applied" });
    const memento = run.toMemento();
    const record = memento.checkpoints[0]!;
    expect(
      run.recordCheckResult({
        requestId: "duplicate-response-loss",
        at: "2026-07-18T10:00:04Z",
        checkpointKey: record.checkpointKey,
        result: record.result as CheckResult,
      }),
    ).toMatchObject({ ok: true, disposition: "idempotent" });
    expect(
      run.recordCheckResult({
        requestId: "conflict",
        at: "2026-07-18T10:00:04Z",
        checkpointKey: record.checkpointKey,
        result: {
          ...(record.result as CheckResult),
          status: "PASS",
          exitCode: 0,
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "CHECK_RESULT_CONFLICT" } });
    expect(run.resumeState.nextGate?.gateId).toBe("scope");
    roundTrip(run);
  });

  it.each([
    ["PASS", 0, 1999, true],
    ["PASS", 0, 2000, false],
    ["FAIL", -1, 1999, true],
    ["FAIL", 0, 10, false],
    ["FAIL", 1.5, 10, false],
    ["TIMEOUT", null, 1999, false],
    ["TIMEOUT", null, 2000, true],
    ["TIMEOUT", 1, 2000, false],
  ] as const)(
    "enforces exact result boundary %s/%s/%s",
    (status, exitCode, durationMs, valid) => {
      const run = running();
      recordNext(run); // optional lint
      recordNext(run); // scope
      const next = run.resumeState;
      const response = run.recordCheckResult({
        requestId: "boundary-result",
        at: "2026-07-18T10:00:09Z",
        checkpointKey: next.checkpointKey as string,
        result: resultFor(next.nextGate as AcceptanceGate, status, {
          exitCode,
          durationMs,
        }),
      });
      expect(response.ok).toBe(valid);
    },
  );

  it("enforces evidence caps, registry binding, exact topology, and safe integers", () => {
    for (const result of [
      resultFor(gates[1]!, "PASS", { evidenceBytes: 1 }),
      resultFor(gates[1]!, "PASS", { commandId: "check-tests" }),
      resultFor(gates[1]!, "PASS", { durationMs: -0 }),
      resultFor(gates[1]!, "PASS", { evidenceBytes: 0.5 }),
    ]) {
      const run = running();
      const response = run.recordCheckResult({
        requestId: "bad-result",
        at: "2026-07-18T10:00:02Z",
        checkpointKey: run.resumeState.checkpointKey as string,
        result,
      });
      expect(response).toMatchObject({
        ok: false,
        error: { code: "INVALID_CHECK_RESULT" },
      });
    }
  });
});

describe("VerificationRun verdicts and aborts", () => {
  it("keeps optional failures as evidence and passes after every result", () => {
    const { run, event } = completed(["FAIL", "PASS", "PASS"]);
    expect(event).toMatchObject({
      kind: "VERIFICATION_PASSED",
      verdict: "PASSED",
      checkCount: 3,
      metadata: { causationId: "command-start-1" },
    });
    expect(run.snapshot.status).toBe("PASSED");
    roundTrip(run);
  });

  it.each(["FAIL", "TIMEOUT"] as const)(
    "fails for mandatory %s and sorts failed IDs",
    (status) => {
      const { run, event } = completed(["PASS", status, "FAIL"]);
      expect(event).toMatchObject({
        kind: "VERIFICATION_FAILED",
        verdict: "FAILED",
        failedGateIds: ["scope", "tests"],
        checkCount: 3,
        metadata: { causationId: "command-start-1" },
      });
      expect(run.snapshot.status).toBe("FAILED");
      roundTrip(run);
    },
  );

  it("rejects completion before all results without mutation", () => {
    const run = running();
    const before = run.toMemento();
    expect(
      run.complete({
        requestId: "too-early",
        at: "2026-07-18T10:00:02Z",
        evidenceBundleDigest: digest("b"),
      }),
    ).toMatchObject({ ok: false, error: { code: "CHECKS_INCOMPLETE" } });
    expect(run.toMemento()).toEqual(before);
  });

  it.each([
    ["VERIFIER_UNAVAILABLE", true],
    ["VERIFIER_UNAVAILABLE", false],
    ["WORKSPACE_UNAVAILABLE", true],
    ["WORKSPACE_UNAVAILABLE", false],
    ["EXECUTION_INFRASTRUCTURE_FAILURE", true],
    ["EXECUTION_INFRASTRUCTURE_FAILURE", false],
    ["MISSION_CANCELLED", false],
  ] as const)(
    "persists trusted retryability for %s/%s",
    (reason, retryable) => {
      const run = running();
      recordNext(run);
      const aborted = run.abort({
        requestId: `abort-${reason}`,
        at: "2026-07-18T10:00:05Z",
        reason,
        retryable,
        evidenceBundleDigest: digest("d"),
        detail: "Bounded diagnostic.",
      });
      expect(aborted).toMatchObject({
        ok: true,
        events: [
          {
            kind: "VERIFICATION_ABORTED",
            reason,
            retryable,
            evidenceBundleDigest: digest("d"),
            detail: "Bounded diagnostic.",
            metadata: { causationId: "command-start-1" },
          },
        ],
      });
      expect(run.snapshot.results).toHaveLength(1);
      roundTrip(run);
    },
  );

  it("rejects a caller attempt to make cancellation retryable", () => {
    const run = running();
    const before = run.toMemento();
    expect(
      run.abort({
        requestId: "abort-forged-cancel",
        at: "2026-07-18T10:00:02Z",
        reason: "MISSION_CANCELLED",
        retryable: true,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_ABORT" } });
    expect(run.toMemento()).toEqual(before);
  });

  it("requires a known verifier for public terminal abort and bounds diagnostics", () => {
    const run = requested();
    expect(
      run.abort({
        requestId: "abort-unassigned",
        at: "2026-07-18T10:00:01Z",
        reason: "MISSION_CANCELLED",
        retryable: false,
      }),
    ).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_TRANSITION" } });
    const active = running();
    expect(
      active.abort({
        requestId: "abort-detail",
        at: "2026-07-18T10:00:02Z",
        reason: "MISSION_CANCELLED",
        retryable: false,
        detail: "x".repeat(2001),
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_ABORT" } });
  });

  it("makes all terminal outcomes first-wins and immutable", () => {
    const passed = completed().run;
    const before = passed.toMemento();
    expect(
      passed.abort({
        requestId: "late-abort",
        at: "2026-07-18T10:00:11Z",
        reason: "MISSION_CANCELLED",
        retryable: false,
      }),
    ).toMatchObject({ ok: false, error: { code: "RUN_TERMINAL" } });
    expect(passed.toMemento()).toEqual(before);
  });

  it("round-trips after every accepted prefix", () => {
    const run = requested();
    roundTrip(run);
    run.assign({
      requestId: "assign-1",
      at: "2026-07-18T10:00:01Z",
      verifierId: "verifier-1",
      availability: "AVAILABLE",
    });
    roundTrip(run);
    for (let index = 0; index < 3; index += 1) {
      recordNext(run);
      roundTrip(run);
    }
    run.complete({
      requestId: "complete-prefix",
      at: "2026-07-18T10:00:10Z",
      evidenceBundleDigest: digest("b"),
    });
    roundTrip(run);
  });
});

describe("VerificationRun strict mementos", () => {
  it.each([
    ["status", "FAILED"],
    ["semanticFingerprint", "0".repeat(64)],
    ["executionCount", 99],
    ["nextCheckpointIndex", 99],
  ])("rejects forged projection %s", (field, forged) => {
    const memento = structuredClone(
      completed().run.toMemento(),
    ) as unknown as Record<string, unknown>;
    memento[field] = forged;
    expect(VerificationRun.rehydrate(memento)).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_MEMENTO_INVALID" },
    });
  });

  it.each([
    "seed",
    "canonicalGates",
    "checkpoints",
    "assignment",
    "terminalAction",
    "terminalOutcome",
    "terminalEvent",
  ])("rejects forged nested field %s", (field) => {
    const memento = structuredClone(
      completed().run.toMemento(),
    ) as unknown as Record<string, unknown>;
    const target = memento[field];
    if (Array.isArray(target)) target.reverse();
    else if (target && typeof target === "object")
      (target as Record<string, unknown>)["forged"] = true;
    expect(VerificationRun.rehydrate(memento)).toMatchObject({ ok: false });
  });

  it("rejects inherited, accessor, proxy, sparse, cyclic, custom, symbol, nonfinite, and negative-zero topology", () => {
    const base = structuredClone(requested().toMemento());
    const accessor = structuredClone(base) as unknown as Record<
      string,
      unknown
    >;
    Object.defineProperty(accessor, "status", {
      enumerable: true,
      get: () => "REQUESTED",
    });
    const sparse = structuredClone(base) as unknown as {
      checkpoints: unknown[];
    };
    sparse.checkpoints = new Array(3);
    const cyclic = structuredClone(base) as unknown as Record<string, unknown>;
    cyclic["cycle"] = cyclic;
    const symbol = structuredClone(base) as unknown as Record<
      PropertyKey,
      unknown
    >;
    symbol[Symbol("x")] = true;
    const inherited = Object.create(base) as unknown;
    const custom = structuredClone(base) as unknown as Record<string, unknown>;
    custom["extra"] = new Map();
    const nonfinite = structuredClone(base) as unknown as Record<
      string,
      unknown
    >;
    nonfinite["extra"] = Number.POSITIVE_INFINITY;
    const negativeZero = structuredClone(base) as unknown as Record<
      string,
      unknown
    >;
    negativeZero["extra"] = -0;
    const proxy = new Proxy(structuredClone(base), {});
    for (const probe of [
      accessor,
      sparse,
      cyclic,
      symbol,
      inherited,
      custom,
      nonfinite,
      negativeZero,
      proxy,
    ])
      expect(VerificationRun.rehydrate(probe)).toMatchObject({ ok: false });
  });

  it("rejects chronology and original-event provenance forgery", () => {
    const chronology = structuredClone(completed().run.toMemento());
    if (chronology.assignment)
      (chronology.assignment as unknown as Record<string, unknown>)["at"] =
        "2026-07-18T09:00:00Z";
    expect(VerificationRun.rehydrate(chronology)).toMatchObject({ ok: false });
    const provenance = structuredClone(completed().run.toMemento());
    if (provenance.terminalEvent)
      (provenance.terminalEvent.metadata as unknown as Record<string, unknown>)[
        "causationId"
      ] = "other";
    expect(VerificationRun.rehydrate(provenance)).toMatchObject({ ok: false });
  });

  it("rejects retryability mismatches between the abort outcome and event", () => {
    const run = running();
    const aborted = run.abort({
      requestId: "abort-nonretryable-workspace",
      at: "2026-07-18T10:00:02Z",
      reason: "WORKSPACE_UNAVAILABLE",
      retryable: false,
    });
    expect(aborted).toMatchObject({ ok: true });
    roundTrip(run);

    const forgedEvent = structuredClone(run.toMemento());
    if (forgedEvent.terminalEvent?.kind === "VERIFICATION_ABORTED")
      (
        forgedEvent.terminalEvent as unknown as { retryable: boolean }
      ).retryable = true;
    expect(VerificationRun.rehydrate(forgedEvent)).toMatchObject({ ok: false });

    const forgedOutcome = structuredClone(run.toMemento());
    if (forgedOutcome.terminalOutcome?.kind === "ABORT")
      (
        forgedOutcome.terminalOutcome as unknown as { retryable: boolean }
      ).retryable = true;
    expect(VerificationRun.rehydrate(forgedOutcome)).toMatchObject({
      ok: false,
    });
  });
});

describe("CompletionReview", () => {
  it.each([
    [["PASS", "PASS", "PASS"], "APPROVE", "PASSED"],
    [["PASS", "FAIL", "PASS"], "REQUEST_REVISION", "FAILED"],
  ] as const)(
    "derives %s mapping and preserves verdict causation",
    (statuses, recommendation, verdict) => {
      const { event } = completed(statuses);
      const opened = CompletionReview.open({
        completionReviewId: "review-1",
        verdictEvent: event,
      });
      expect(opened).toMatchObject({
        ok: true,
        value: { snapshot: { status: "OPEN", recommendation, verdict } },
      });
      if (!opened.ok) return;
      const review = opened.value;
      const issued = review.issue({
        requestId: "issue-review-1",
        at: "2026-07-18T10:00:11Z",
        reason: "Deterministic recommendation.",
      });
      expect(issued).toMatchObject({
        ok: true,
        events: [
          {
            kind: "REVIEW_RECOMMENDATION_ISSUED",
            recommendation,
            verdict,
            metadata: { causationId: event.metadata.eventId },
            binding: event.binding,
            evidenceBundleDigest: event.evidenceBundleDigest,
          },
        ],
      });
      const memento = structuredClone(review.toMemento());
      const restored = CompletionReview.rehydrate(memento);
      expect(restored).toMatchObject({ ok: true });
      if (restored.ok) expect(restored.value.toMemento()).toEqual(memento);
    },
  );

  it("forbids aborted events and rejects forged verdict provenance", () => {
    const aborted = running();
    const response = aborted.abort({
      requestId: "abort-review",
      at: "2026-07-18T10:00:02Z",
      reason: "MISSION_CANCELLED",
      retryable: false,
    });
    if (!response.ok) throw new Error(response.error.message);
    expect(
      CompletionReview.open({
        completionReviewId: "review-abort",
        verdictEvent: response.events[0] as unknown as VerificationVerdictEvent,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_REVIEW" } });
    const { event } = completed();
    const forged = structuredClone(event) as unknown as Record<string, unknown>;
    (forged["metadata"] as Record<string, unknown>)["eventId"] = "event:forged";
    expect(
      CompletionReview.open({
        completionReviewId: "review-forged",
        verdictEvent: forged as unknown as VerificationVerdictEvent,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_REVIEW" } });
  });

  it("is first-wins/idempotent and rejects conflicting reason or chronology", () => {
    const { event } = completed();
    const opened = CompletionReview.open({
      completionReviewId: "review-1",
      verdictEvent: event,
    });
    if (!opened.ok) throw new Error(opened.error.message);
    const issue = {
      requestId: "issue-review-1",
      at: "2026-07-18T10:00:11Z",
      reason: "Reason.",
    };
    expect(opened.value.issue(issue)).toMatchObject({
      ok: true,
      disposition: "applied",
    });
    expect(opened.value.issue(issue)).toMatchObject({
      ok: true,
      disposition: "idempotent",
    });
    expect(opened.value.issue({ ...issue, reason: "Other." })).toMatchObject({
      ok: false,
      error: { code: "RECOMMENDATION_CONFLICT" },
    });
    const fresh = CompletionReview.open({
      completionReviewId: "review-2",
      verdictEvent: event,
    });
    if (!fresh.ok) throw new Error(fresh.error.message);
    expect(
      fresh.value.issue({ requestId: "old", at: "2026-07-18T09:00:00Z" }),
    ).toMatchObject({
      ok: false,
      error: { code: "TRANSITION_CHRONOLOGY_INVALID" },
    });
  });

  it("bounds reasons and rejects forged mementos/provenance", () => {
    const { event } = completed();
    const opened = CompletionReview.open({
      completionReviewId: "review-1",
      verdictEvent: event,
    });
    if (!opened.ok) throw new Error(opened.error.message);
    expect(
      opened.value.issue({
        requestId: "issue-long",
        at: "2026-07-18T10:00:11Z",
        reason: "x".repeat(2001),
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_RECOMMENDATION" } });
    opened.value.issue({ requestId: "issue-ok", at: "2026-07-18T10:00:11Z" });
    const forged = structuredClone(opened.value.toMemento());
    if (forged.recommendationEvent)
      (
        forged.recommendationEvent.metadata as unknown as Record<
          string,
          unknown
        >
      )["causationId"] = "wrong-verdict";
    expect(CompletionReview.rehydrate(forged)).toMatchObject({ ok: false });
  });

  it.each([
    "2026-02-31T10:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T10:00:00+24:00",
    "2026-01-01 10:00:00Z",
    "2026-1-01T10:00:00Z",
    "2026-01-01T10:00:00",
  ])(
    "rejects invalid/noncanonical recommendation instant %s without mutation",
    (at) => {
      const { event } = completed();
      const opened = CompletionReview.open({
        completionReviewId: "review-strict-instant",
        verdictEvent: event,
      });
      if (!opened.ok) throw new Error(opened.error.message);
      const before = opened.value.toMemento();
      expect(
        opened.value.issue({ requestId: "issue-invalid-instant", at }),
      ).toMatchObject({
        ok: false,
        error: { code: "INVALID_RECOMMENDATION" },
      });
      expect(opened.value.toMemento()).toEqual(before);
    },
  );

  it("accepts a valid leap day and RFC3339 offset and rejects instant memento forgery", () => {
    const event = structuredClone(completed().event);
    (event.metadata as unknown as { occurredAt: string }).occurredAt =
      "2024-02-29T09:00:00+01:00";
    const opened = CompletionReview.open({
      completionReviewId: "review-leap-day",
      verdictEvent: event,
    });
    if (!opened.ok) throw new Error(opened.error.message);
    const issued = opened.value.issue({
      requestId: "issue-leap-day",
      at: "2024-02-29T10:00:00+01:00",
    });
    expect(issued).toMatchObject({ ok: true });
    const memento = structuredClone(opened.value.toMemento());
    expect(CompletionReview.rehydrate(memento)).toMatchObject({ ok: true });

    const forgedIssue = structuredClone(memento);
    if (forgedIssue.issue)
      (forgedIssue.issue as unknown as { at: string }).at =
        "2024-02-31T10:00:00+01:00";
    expect(CompletionReview.rehydrate(forgedIssue)).toMatchObject({
      ok: false,
    });

    const forgedEvent = structuredClone(memento);
    if (forgedEvent.recommendationEvent)
      (
        forgedEvent.recommendationEvent.metadata as unknown as {
          occurredAt: string;
        }
      ).occurredAt = "2024-02-31T10:00:00+01:00";
    expect(CompletionReview.rehydrate(forgedEvent)).toMatchObject({
      ok: false,
    });
  });
});
