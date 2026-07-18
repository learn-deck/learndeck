import { describe, expect, it } from "vitest";
import {
  Attempt,
  calculateGateSetDigest,
  type AcceptanceGate,
  type AttemptResult,
  type CreateAttempt,
  type LeaseAttempt,
  type LeaseOwnerCommand,
  type SubmitArtifact,
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
const at = "2026-07-18T10:00:00.000Z";
const token = "lease-token-that-is-at-least-thirty-two-characters";

function createCommand(): CreateAttempt {
  return {
    messageId: "command-create-1",
    correlationId: "correlation-1",
    causationId: "event-opened-1",
    at,
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
  };
}

function ready() {
  const created = Attempt.create(createCommand());
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function leaseCommand(overrides: Partial<LeaseAttempt> = {}): LeaseAttempt {
  const messageId = overrides.messageId ?? "request-lease-1";
  return {
    messageId,
    correlationId: "correlation-1",
    causationId: overrides.causationId ?? messageId,
    at,
    runnerId: "runner-1",
    runnerCapabilities: ["edit-trusted-fixture", "extra"],
    requestedLeaseSeconds: 60,
    leaseId: "lease-1",
    leaseToken: token,
    ...overrides,
  };
}

function leased() {
  const attempt = ready();
  const result = attempt.lease(leaseCommand());
  if (!result.ok) throw new Error(result.error.message);
  return attempt;
}

function owner(overrides: Partial<LeaseOwnerCommand> = {}): LeaseOwnerCommand {
  const messageId = overrides.messageId ?? "request-heartbeat-1";
  return {
    messageId,
    correlationId: "correlation-1",
    causationId: overrides.causationId ?? messageId,
    at: "2026-07-18T10:00:20.000Z",
    runnerId: "runner-1",
    leaseToken: token,
    ...overrides,
  };
}

function submission(overrides: Partial<SubmitArtifact> = {}): SubmitArtifact {
  const messageId = overrides.messageId ?? "request-submit-1";
  return {
    ...owner({
      messageId,
      causationId: overrides.causationId ?? messageId,
    }),
    missionId: "mission-1",
    missionRevision: 1,
    attemptId: "attempt-1",
    startingRevision: "fixture-shipping-v1",
    artifact: {
      reference: "urn:patchquest:artifact:1",
      digest: { algorithm: "sha256", value: "b".repeat(64) },
      changedPaths: ["src/shipping/quote.ts"],
    },
    gateSetDigest,
    ...overrides,
  };
}

function expectRoundTrip(attempt: Attempt): void {
  const memento = structuredClone(attempt.toMemento());
  const restored = Attempt.rehydrate(memento);
  expect(restored).toMatchObject({ ok: true });
  if (restored.ok) expect(restored.value.toMemento()).toEqual(memento);
}

function revokeInput(
  overrides: Partial<Parameters<Attempt["revoke"]>[0]> = {},
): Parameters<Attempt["revoke"]>[0] {
  return {
    messageId: "command-revoke-1",
    correlationId: "correlation-1",
    causationId: "event-cancelled-1",
    at: "2026-07-18T10:00:30.000Z",
    missionId: "mission-1",
    missionRevision: 1,
    attemptId: "attempt-1",
    reason: "MISSION_CANCELLED",
    ...overrides,
  };
}

describe("Workshop Attempt state machine", () => {
  it("creates the exact immutable READY work contract and emits readiness", () => {
    const command = createCommand();
    const result = Attempt.create(command);
    expect(result).toMatchObject({
      ok: true,
      disposition: "applied",
      value: { snapshot: { status: "READY", attemptId: "attempt-1" } },
      events: [{ kind: "ATTEMPT_READY" }],
    });
    (command.workContract.allowedScope.pathPatterns as string[])[0] =
      "foreign/**";
    if (!result.ok) return;
    expect(
      result.value.snapshot.workContract.allowedScope.pathPatterns,
    ).toEqual(["src/shipping/**"]);
    expect(Object.isFrozen(result.value.snapshot.workContract)).toBe(true);
  });

  it("uses normative ASCII gate ordering for punctuation-heavy gate IDs", () => {
    const punctuationGates: readonly AcceptanceGate[] = [
      { ...gates[0]!, gateId: "gate:a" },
      { ...gates[0]!, gateId: "gate.Z" },
      { ...gates[0]!, gateId: "gate_a" },
      { ...gates[0]!, gateId: "gate-2" },
      { ...gates[0]!, gateId: "gate.10" },
    ];
    // Fixed language-neutral contract vector; this test deliberately does not
    // import another bounded context to obtain its expected value.
    expect(calculateGateSetDigest(punctuationGates)).toEqual({
      algorithm: "sha256",
      value: "ad9ecf91d7dfd30907e8f2a6a70e8b40bf9baa790b3e07662582f41498a76ace",
    });
  });

  it("accepts zero and maximum evidence bounds and rejects mismatched gate registry pairs", () => {
    for (const evidenceLimitBytes of [0, 1_048_576]) {
      const boundedGates: readonly AcceptanceGate[] = [
        { ...gates[0]!, evidenceLimitBytes },
      ];
      const base = createCommand();
      const command: CreateAttempt = {
        ...base,
        workContract: {
          ...base.workContract,
          acceptanceGates: boundedGates,
          gateSetDigest: calculateGateSetDigest(boundedGates),
        },
      };
      expect(Attempt.create(command)).toMatchObject({ ok: true });
    }
    const mismatched: readonly AcceptanceGate[] = [
      { ...gates[0]!, kind: "LINT", commandId: "check-tests" },
    ];
    const base = createCommand();
    const command: CreateAttempt = {
      ...base,
      workContract: {
        ...base.workContract,
        acceptanceGates: mismatched,
        gateSetDigest: calculateGateSetDigest(mismatched),
      },
    };
    expect(Attempt.create(command)).toMatchObject({
      ok: false,
      error: { code: "INVALID_ATTEMPT" },
    });
    for (const evidenceLimitBytes of [-1, 1_048_577, 1.5]) {
      const invalidGates: readonly AcceptanceGate[] = [
        { ...gates[0]!, evidenceLimitBytes },
      ];
      const invalidBase = createCommand();
      expect(
        Attempt.create({
          ...invalidBase,
          workContract: {
            ...invalidBase.workContract,
            acceptanceGates: invalidGates,
            gateSetDigest: calculateGateSetDigest(invalidGates),
          },
        }),
      ).toMatchObject({ ok: false, error: { code: "INVALID_ATTEMPT" } });
    }
  });

  it.each([
    "/src/shipping/**",
    "C:/repo/**",
    "c:/repo/**",
    "C:repo/**",
    "c:repo/**",
    "src/../shipping/**",
    "src\\shipping\\**",
    "src/cafe\u0301/**",
  ])("rejects non-normalized allowed scope %s", (pathPattern) => {
    const base = createCommand();
    const command: CreateAttempt = {
      ...base,
      workContract: {
        ...base.workContract,
        allowedScope: { pathPatterns: [pathPattern] },
      },
    };
    expect(Attempt.create(command)).toMatchObject({
      ok: false,
      error: { code: "INVALID_ATTEMPT" },
    });
  });

  it.each([
    [0, 2],
    [3, 2],
  ])(
    "rejects attempt number %s against budget %s",
    (attemptNumber, attemptBudget) => {
      expect(
        Attempt.create({ ...createCommand(), attemptNumber, attemptBudget }),
      ).toMatchObject({ ok: false, error: { code: "INVALID_ATTEMPT" } });
    },
  );

  it("leases only READY with a capability superset and bounded duration", () => {
    const attempt = ready();
    expect(
      attempt.lease(
        leaseCommand({ runnerCapabilities: ["edit-trusted-fixture"] }),
      ),
    ).toMatchObject({
      ok: true,
      value: {
        leaseToken: token,
        snapshot: {
          status: "LEASED",
          lease: { expiresAt: "2026-07-18T10:01:00.000Z" },
        },
      },
      events: [{ kind: "ATTEMPT_LEASED", leaseId: "lease-1" }],
    });
    expect(attempt.toMemento().lease).not.toHaveProperty("leaseToken");
    expect(JSON.stringify(attempt.toMemento())).not.toContain(token);
    expect(attempt.lease(leaseCommand())).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_TRANSITION" },
    });
  });

  it.each([
    [[], "INVALID_ATTEMPT"],
    [["other"], "CAPABILITIES_INSUFFICIENT"],
    [["edit-trusted-fixture"], "LEASE_DURATION_INVALID", 0],
    [["edit-trusted-fixture"], "LEASE_DURATION_INVALID", 3601],
  ])(
    "rejects invalid leasing constraints %#",
    (runnerCapabilities, code, duration = 60) => {
      const result = ready().lease(
        leaseCommand({
          runnerCapabilities,
          requestedLeaseSeconds: duration,
        }),
      );
      expect(result).toMatchObject({ ok: false, error: { code } });
    },
  );

  it("records heartbeat and renews atomically by the original duration", () => {
    const attempt = leased();
    expect(attempt.heartbeat(owner())).toMatchObject({
      ok: true,
      events: [],
      value: {
        lease: {
          lastHeartbeatAt: "2026-07-18T10:00:20.000Z",
          expiresAt: "2026-07-18T10:01:20.000Z",
          originalDurationSeconds: 60,
        },
      },
    });
  });

  it("round-trips after every prefix in a multi-heartbeat submission sequence", () => {
    const attempt = ready();
    expectRoundTrip(attempt);
    expect(attempt.lease(leaseCommand())).toMatchObject({ ok: true });
    expectRoundTrip(attempt);
    expect(
      attempt.heartbeat(
        owner({ messageId: "heartbeat-1", causationId: "heartbeat-1" }),
      ),
    ).toMatchObject({ ok: true });
    expectRoundTrip(attempt);
    expect(
      attempt.heartbeat(
        owner({
          messageId: "heartbeat-2",
          causationId: "heartbeat-2",
          at: "2026-07-18T10:00:40.000Z",
        }),
      ),
    ).toMatchObject({ ok: true });
    expectRoundTrip(attempt);
    expect(
      attempt.submit(
        submission({
          messageId: "submit-after-heartbeats",
          causationId: "submit-after-heartbeats",
          at: "2026-07-18T10:00:50.000Z",
        }),
      ),
    ).toMatchObject({ ok: true });
    expectRoundTrip(attempt);
  });

  it("rejects backward clocks and reused message IDs before mutation", () => {
    const readyAttempt = ready();
    for (const command of [
      leaseCommand({
        messageId: "lease-before-create",
        at: "2026-07-18T09:59:59.999Z",
      }),
      leaseCommand({ messageId: "command-create-1" }),
    ]) {
      const before = readyAttempt.toMemento();
      expect(readyAttempt.lease(command)).toMatchObject({ ok: false });
      expect(readyAttempt.toMemento()).toEqual(before);
    }

    const attempt = leased();
    expect(
      attempt.heartbeat(
        owner({
          messageId: "heartbeat-latest",
          causationId: "heartbeat-latest",
        }),
      ),
    ).toMatchObject({ ok: true });
    const before = attempt.toMemento();
    const backwardAt = "2026-07-18T10:00:10.000Z";
    const probes = [
      attempt.heartbeat(
        owner({ messageId: "heartbeat-backward", at: backwardAt }),
      ),
      attempt.submit(
        submission({ messageId: "submit-backward", at: backwardAt }),
      ),
      attempt.abandon({
        ...owner({ messageId: "abandon-backward", at: backwardAt }),
        reason: "backward",
      }),
      attempt.fail({
        ...owner({ messageId: "fail-backward", at: backwardAt }),
        reason: "backward",
      }),
      attempt.expire({
        messageId: "expire-backward",
        correlationId: "correlation-1",
        causationId: "expire-backward",
        at: backwardAt,
      }),
      attempt.revoke(
        revokeInput({ messageId: "revoke-backward", at: backwardAt }),
      ),
      attempt.heartbeat(
        owner({
          messageId: "request-lease-1",
          at: "2026-07-18T10:00:30.000Z",
        }),
      ),
      attempt.submit(
        submission({
          messageId: "heartbeat-latest",
          at: "2026-07-18T10:00:30.000Z",
        }),
      ),
      attempt.abandon({
        ...owner({
          messageId: "heartbeat-latest",
          at: "2026-07-18T10:00:30.000Z",
        }),
        reason: "reused",
      }),
      attempt.fail({
        ...owner({
          messageId: "heartbeat-latest",
          at: "2026-07-18T10:00:30.000Z",
        }),
        reason: "reused",
      }),
      attempt.expire({
        messageId: "heartbeat-latest",
        correlationId: "correlation-1",
        causationId: "heartbeat-latest",
        at: "2026-07-18T10:01:20.000Z",
      }),
      attempt.revoke(
        revokeInput({
          messageId: "heartbeat-latest",
          at: "2026-07-18T10:00:30.000Z",
        }),
      ),
    ];
    for (const result of probes) expect(result).toMatchObject({ ok: false });
    expect(attempt.toMemento()).toEqual(before);
  });

  it.each(["submit", "abandon", "fail", "expire", "revoke"] as const)(
    "keeps %s chronological after a heartbeat and immediately round-trippable",
    (operation) => {
      const attempt = leased();
      attempt.heartbeat(
        owner({
          messageId: "heartbeat-terminal",
          causationId: "heartbeat-terminal",
        }),
      );
      if (operation === "submit")
        expect(
          attempt.submit(
            submission({
              messageId: "submit-terminal",
              at: "2026-07-18T10:00:30.000Z",
            }),
          ),
        ).toMatchObject({ ok: true });
      else if (operation === "abandon")
        expect(
          attempt.abandon({
            ...owner({
              messageId: "abandon-terminal",
              at: "2026-07-18T10:00:30.000Z",
            }),
            reason: "Stopped.",
          }),
        ).toMatchObject({ ok: true });
      else if (operation === "fail")
        expect(
          attempt.fail({
            ...owner({
              messageId: "fail-terminal",
              at: "2026-07-18T10:00:30.000Z",
            }),
            reason: "Failed.",
          }),
        ).toMatchObject({ ok: true });
      else if (operation === "expire")
        expect(
          attempt.expire({
            messageId: "expire-terminal",
            correlationId: "correlation-1",
            causationId: "expire-terminal",
            at: "2026-07-18T10:01:20.000Z",
          }),
        ).toMatchObject({ ok: true });
      else
        expect(
          attempt.revoke(
            revokeInput({
              messageId: "revoke-terminal",
              at: "2026-07-18T10:00:30.000Z",
            }),
          ),
        ).toMatchObject({ ok: true });
      expectRoundTrip(attempt);
    },
  );

  it.each([
    [{ runnerId: "runner-2" }, "LEASE_AUTHORIZATION_FAILED"],
    [
      { leaseToken: "wrong-token-that-is-at-least-thirty-two-characters" },
      "LEASE_AUTHORIZATION_FAILED",
    ],
    [{ at: "2026-07-18T10:01:00.000Z" }, "LEASE_EXPIRED"],
  ])("rejects owner action for %#", (overrides, code) => {
    expect(leased().heartbeat(owner(overrides))).toMatchObject({
      ok: false,
      error: { code },
    });
  });

  it("submits once with exact binding and persisted two-event causation, then replays the receipt", () => {
    const attempt = leased();
    const first = attempt.submit(submission());
    expect(first).toMatchObject({
      ok: true,
      disposition: "applied",
      value: {
        outcome: "ARTIFACT_SUBMITTED",
        artifactDigest: { value: "b".repeat(64) },
      },
      events: [
        { kind: "ARTIFACT_SUBMITTED" },
        {
          kind: "ATTEMPT_ENDED",
          outcome: "ARTIFACT_SUBMITTED",
        },
      ],
    });
    if (first.ok)
      expect(first.events[1]?.metadata.causationId).toBe(
        first.events[0]?.metadata.eventId,
      );
    expect(
      attempt.submit(submission({ at: "2026-07-19T10:00:00.000Z" })),
    ).toMatchObject({
      ok: true,
      disposition: "idempotent",
      events: [],
      value: { recordedAt: "2026-07-18T10:00:20.000Z" },
    });
    expect(
      attempt.submit(
        submission({
          artifact: {
            ...submission().artifact,
            digest: { algorithm: "sha256", value: "c".repeat(64) },
          },
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "ARTIFACT_DIGEST_CONFLICT" },
    });
  });

  it.each([
    [{ missionRevision: 2 }, "ARTIFACT_BINDING_MISMATCH"],
    [
      { gateSetDigest: { algorithm: "sha256", value: "c".repeat(64) } },
      "ARTIFACT_BINDING_MISMATCH",
    ],
    [{ at: "2026-07-18T10:01:00.000Z" }, "LEASE_EXPIRED"],
  ])("rejects invalid artifact submission %#", (overrides, code) => {
    expect(
      leased().submit(submission(overrides as Partial<SubmitArtifact>)),
    ).toMatchObject({
      ok: false,
      error: { code },
    });
  });

  it.each([
    "/src/shipping/quote.ts",
    "C:/repo/file.ts",
    "c:/repo/file.ts",
    "C:repo/file.ts",
    "c:repo/file.ts",
    "src/shipping/../quote.ts",
    "src\\shipping\\quote.ts",
    "src/shipping/cafe\u0301.ts",
  ])("rejects non-normalized changed path %s", (changedPath) => {
    expect(
      leased().submit(
        submission({
          artifact: {
            ...submission().artifact,
            changedPaths: [changedPath],
          },
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_ATTEMPT" },
    });
  });

  it.each([
    "secrets.txt",
    "src/shipping-other/quote.ts",
    "src/application/quote.ts",
  ])(
    "accepts syntactically valid out-of-scope path %s for later verification",
    (changedPath) => {
      expect(
        leased().submit(
          submission({
            artifact: {
              ...submission().artifact,
              changedPaths: [changedPath],
            },
          }),
        ),
      ).toMatchObject({
        ok: true,
        disposition: "applied",
        events: [
          { kind: "ARTIFACT_SUBMITTED" },
          { kind: "ATTEMPT_ENDED", outcome: "ARTIFACT_SUBMITTED" },
        ],
      });
    },
  );

  it("retains allowed scope without enforcing it during submission", () => {
    const base = createCommand();
    const created = Attempt.create({
      ...base,
      workContract: {
        ...base.workContract,
        allowedScope: { pathPatterns: ["src/app/**"] },
      },
    });
    if (!created.ok) throw new Error(created.error.message);
    expect(created.value.lease(leaseCommand())).toMatchObject({ ok: true });
    expect(
      created.value.submit(
        submission({
          artifact: {
            ...submission().artifact,
            changedPaths: ["src/application/quote.ts"],
          },
        }),
      ),
    ).toMatchObject({
      ok: true,
      value: { outcome: "ARTIFACT_SUBMITTED" },
    });
    expect(created.value.snapshot.workContract.allowedScope).toEqual({
      pathPatterns: ["src/app/**"],
    });
  });

  it.each([
    ["abandon", "ABANDONED"],
    ["fail", "FAILED"],
  ] as const)(
    "supports owner-authenticated %s only from LEASED",
    (operation, status) => {
      const attempt = leased();
      const result = attempt[operation]({
        ...owner(),
        reason: `${status} reason`,
      });
      expect(result).toMatchObject({
        ok: true,
        value: { status },
        events: [{ kind: "ATTEMPT_ENDED", outcome: status }],
      });
      expect(
        ready()[operation]({ ...owner(), reason: "not owned" }),
      ).toMatchObject({
        ok: false,
        error: { code: "UNSUPPORTED_TRANSITION" },
      });
    },
  );

  it("expires at equality, never one instant later", () => {
    const attempt = leased();
    expect(
      attempt.expire({
        messageId: "request-expire-early",
        correlationId: "correlation-1",
        causationId: "request-expire-early",
        at: "2026-07-18T10:00:59.999Z",
      }),
    ).toMatchObject({ ok: false, error: { code: "LEASE_NOT_EXPIRED" } });
    expect(
      attempt.expire({
        messageId: "request-expire-1",
        correlationId: "correlation-1",
        causationId: "request-expire-1",
        at: "2026-07-18T10:01:00.000Z",
      }),
    ).toMatchObject({ ok: true, value: { status: "LEASE_EXPIRED" } });
  });

  it.each(["READY", "LEASED"] as const)(
    "revokes %s without lease-owner credentials",
    (state) => {
      const attempt = state === "READY" ? ready() : leased();
      expect(
        attempt.revoke({
          messageId: "command-revoke-1",
          correlationId: "correlation-1",
          causationId: "event-cancelled-1",
          at: "2026-07-18T10:00:30.000Z",
          missionId: "mission-1",
          missionRevision: 1,
          attemptId: "attempt-1",
          reason: "MISSION_CANCELLED",
        }),
      ).toMatchObject({ ok: true, value: { status: "REVOKED" } });
    },
  );

  it("rejects mismatched private provenance before mutation across the lease lifecycle", () => {
    const probes: readonly (() => AttemptResult<unknown>)[] = [
      () =>
        ready().lease(
          leaseCommand({
            correlationId: "correlation-forged",
            messageId: "lease-forged-correlation",
          }),
        ),
      () =>
        ready().lease(
          leaseCommand({
            messageId: "lease-forged-causation",
            causationId: "caller-selected-cause",
          }),
        ),
      () =>
        leased().heartbeat(
          owner({
            messageId: "heartbeat-forged",
            correlationId: "correlation-forged",
          }),
        ),
      () =>
        leased().submit(
          submission({
            messageId: "submit-forged",
            causationId: "caller-selected-cause",
          }),
        ),
      () =>
        leased().abandon({
          ...owner({
            messageId: "abandon-forged",
            correlationId: "correlation-forged",
          }),
          reason: "Stopped.",
        }),
      () =>
        leased().fail({
          ...owner({
            messageId: "fail-forged",
            causationId: "caller-selected-cause",
          }),
          reason: "Failed.",
        }),
      () =>
        leased().expire({
          messageId: "expire-forged",
          correlationId: "correlation-forged",
          causationId: "expire-forged",
          at: "2026-07-18T10:01:00.000Z",
        }),
    ];
    for (const probe of probes)
      expect(probe()).toMatchObject({
        ok: false,
        error: { code: "TRANSITION_PROVENANCE_INVALID" },
      });
  });

  it("rejects public revocation correlation mismatch but retains envelope causation", () => {
    const attempt = ready();
    const before = attempt.toMemento();
    expect(
      attempt.revoke(
        revokeInput({
          correlationId: "correlation-forged",
          causationId: "event-cancelled-retained",
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "TRANSITION_PROVENANCE_INVALID" },
    });
    expect(attempt.toMemento()).toEqual(before);
    const accepted = attempt.revoke(
      revokeInput({ causationId: "event-cancelled-retained" }),
    );
    expect(accepted).toMatchObject({ ok: true });
    expect(attempt.toMemento().transitions.at(-1)?.identity.causationId).toBe(
      "event-cancelled-retained",
    );
    if (accepted.ok)
      expect(accepted.events[0]?.metadata.causationId).toBe("command-revoke-1");
  });

  it.each([
    "ARTIFACT_SUBMITTED",
    "ABANDONED",
    "FAILED",
    "LEASE_EXPIRED",
    "REVOKED",
  ] as const)("keeps terminal %s immutable", (terminal) => {
    const attempt = leased();
    if (terminal === "ARTIFACT_SUBMITTED") attempt.submit(submission());
    else if (terminal === "ABANDONED")
      attempt.abandon({ ...owner(), reason: "abandoned" });
    else if (terminal === "FAILED")
      attempt.fail({ ...owner(), reason: "failed" });
    else if (terminal === "LEASE_EXPIRED")
      attempt.expire({
        messageId: "request-expire",
        correlationId: "correlation-1",
        causationId: "request-expire",
        at: "2026-07-18T10:01:00.000Z",
      });
    else
      attempt.revoke({
        messageId: "command-revoke",
        correlationId: "correlation-1",
        causationId: "event-cancel",
        at,
        missionId: "mission-1",
        missionRevision: 1,
        attemptId: "attempt-1",
        reason: "MISSION_CANCELLED",
      });
    expect(attempt.lease(leaseCommand())).toMatchObject({
      ok: false,
      error: { code: "ATTEMPT_TERMINAL" },
    });
    expect(attempt.snapshot.status).toBe(terminal);
  });

  it("rejects every unsupported READY operation without mutation", () => {
    const attempt = ready();
    const before = attempt.toMemento();
    expect(attempt.heartbeat(owner())).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_TRANSITION" },
    });
    expect(attempt.submit(submission())).toMatchObject({
      ok: false,
      error: { code: "LEASE_AUTHORIZATION_FAILED" },
    });
    expect(attempt.abandon({ ...owner(), reason: "not leased" })).toMatchObject(
      {
        ok: false,
        error: { code: "UNSUPPORTED_TRANSITION" },
      },
    );
    expect(attempt.fail({ ...owner(), reason: "not leased" })).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_TRANSITION" },
    });
    expect(
      attempt.expire({
        messageId: "request-expire",
        correlationId: "correlation-1",
        causationId: "request-expire",
        at,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_TRANSITION" },
    });
    expect(attempt.toMemento()).toEqual(before);
  });

  it.each(["ABANDONED", "FAILED", "LEASE_EXPIRED", "REVOKED"] as const)(
    "rejects every owner/authority transition after terminal %s without mutation",
    (terminal) => {
      const attempt = leased();
      if (terminal === "ABANDONED")
        attempt.abandon({ ...owner(), reason: "abandoned" });
      else if (terminal === "FAILED")
        attempt.fail({ ...owner(), reason: "failed" });
      else if (terminal === "LEASE_EXPIRED")
        attempt.expire({
          messageId: "request-expire",
          correlationId: "correlation-1",
          causationId: "request-expire",
          at: "2026-07-18T10:01:00.000Z",
        });
      else
        attempt.revoke({
          messageId: "command-revoke",
          correlationId: "correlation-1",
          causationId: "event-cancel",
          at,
          missionId: "mission-1",
          missionRevision: 1,
          attemptId: "attempt-1",
          reason: "MISSION_CANCELLED",
        });
      const before = attempt.toMemento();
      for (const result of [
        attempt.lease(leaseCommand()),
        attempt.heartbeat(owner()),
        attempt.abandon({ ...owner(), reason: "again" }),
        attempt.fail({ ...owner(), reason: "again" }),
        attempt.expire({
          messageId: "request-expire-again",
          correlationId: "correlation-1",
          causationId: "request-expire-again",
          at: "2026-07-18T10:02:00.000Z",
        }),
        attempt.revoke({
          messageId: "command-revoke-again",
          correlationId: "correlation-1",
          causationId: "event-cancel-again",
          at,
          missionId: "mission-1",
          missionRevision: 1,
          attemptId: "attempt-1",
          reason: "MISSION_CANCELLED",
        }),
      ])
        expect(result).toMatchObject({
          ok: false,
          error: { code: "ATTEMPT_TERMINAL" },
        });
      expect(attempt.toMemento()).toEqual(before);
    },
  );
});

describe("Attempt memento", () => {
  function variants(): readonly Attempt[] {
    const readyAttempt = ready();
    const leasedAttempt = leased();
    const heartbeatAttempt = leased();
    heartbeatAttempt.heartbeat(owner());
    const submitted = leased();
    submitted.submit(submission());
    const abandoned = leased();
    abandoned.abandon({ ...owner(), reason: "Stopped by runner." });
    const failed = leased();
    failed.fail({ ...owner(), reason: "Runner failed." });
    const expired = leased();
    expired.expire({
      messageId: "request-expire",
      correlationId: "correlation-1",
      causationId: "request-expire",
      at: "2026-07-18T10:01:00.000Z",
    });
    const revokedReady = ready();
    revokedReady.revoke({
      messageId: "command-revoke-ready",
      correlationId: "correlation-1",
      causationId: "event-cancel",
      at,
      missionId: "mission-1",
      missionRevision: 1,
      attemptId: "attempt-1",
      reason: "MISSION_CANCELLED",
    });
    const revokedLeased = leased();
    revokedLeased.revoke({
      messageId: "command-revoke-leased",
      correlationId: "correlation-1",
      causationId: "event-cancel",
      at,
      missionId: "mission-1",
      missionRevision: 1,
      attemptId: "attempt-1",
      reason: "MISSION_CANCELLED",
    });
    return [
      readyAttempt,
      leasedAttempt,
      heartbeatAttempt,
      submitted,
      abandoned,
      failed,
      expired,
      revokedReady,
      revokedLeased,
    ];
  }

  it("round-trips every reachable projection exactly", () => {
    for (const attempt of variants()) {
      const memento = structuredClone(attempt.toMemento());
      const restored = Attempt.rehydrate(memento);
      expect(restored, attempt.snapshot.status).toMatchObject({ ok: true });
      if (restored.ok) expect(restored.value.toMemento()).toEqual(memento);
    }
  });

  it.each([
    ["status", (value: Record<string, unknown>) => (value["status"] = "READY")],
    [
      "raw token",
      (value: Record<string, unknown>) =>
        ((value["lease"] as Record<string, unknown>)["leaseToken"] = token),
    ],
    [
      "forged receipt",
      (value: Record<string, unknown>) =>
        ((value["receipt"] as Record<string, unknown>)["attemptId"] =
          "attempt-2"),
    ],
    [
      "sparse history",
      (value: Record<string, unknown>) => (value["transitions"] = new Array(2)),
    ],
    [
      "duplicate lease transition",
      (value: Record<string, unknown>) => {
        const transitions = value["transitions"] as unknown[];
        transitions.splice(2, 0, structuredClone(transitions[1]));
      },
    ],
    [
      "terminal timestamp after artifact expiry",
      (value: Record<string, unknown>) => {
        const transitions = value["transitions"] as Array<{
          identity: { at: string };
        }>;
        const terminal = transitions.at(-1);
        if (terminal) terminal.identity.at = "2026-07-18T10:02:00.000Z";
      },
    ],
  ])("rejects adversarial %s mutation", (_label, mutate) => {
    const attempt = leased();
    attempt.submit(submission());
    const changed = structuredClone(attempt.toMemento()) as unknown as Record<
      string,
      unknown
    >;
    mutate(changed);
    expect(Attempt.rehydrate(changed)).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_MEMENTO_INVALID" },
    });
  });

  it.each([
    [
      "transition correlation",
      (transition: MutableTransition): void => {
        transition.identity.correlationId = "correlation-forged";
      },
    ],
    [
      "private transition causation",
      (transition: MutableTransition): void => {
        transition.identity.causationId = "caller-selected-cause";
      },
    ],
    [
      "event correlation",
      (transition: MutableTransition): void => {
        transition.events[0]!.metadata.correlationId = "correlation-forged";
      },
    ],
    [
      "direct event causation",
      (transition: MutableTransition): void => {
        transition.events[0]!.metadata.causationId = "forged-cause";
      },
    ],
    [
      "chained ended causation",
      (transition: MutableTransition): void => {
        transition.events[1]!.metadata.causationId = "forged-cause";
      },
    ],
    [
      "derived event identity",
      (transition: MutableTransition): void => {
        transition.events[0]!.metadata.eventId = `event:${"c".repeat(64)}`;
      },
    ],
    [
      "duplicate event identity",
      (transition: MutableTransition): void => {
        transition.events[1]!.metadata.eventId =
          transition.events[0]!.metadata.eventId;
      },
    ],
    [
      "event timestamp",
      (transition: MutableTransition): void => {
        transition.events[0]!.metadata.occurredAt = "2026-07-18T10:00:21.000Z";
      },
    ],
  ] as const)("rejects forged %s provenance", (_label, mutate) => {
    const attempt = leased();
    attempt.submit(submission());
    const changed = structuredClone(attempt.toMemento()) as unknown as {
      transitions: MutableTransition[];
    };
    const terminal = changed.transitions.at(-1);
    if (!terminal) throw new Error("missing terminal transition");
    mutate(terminal);
    expect(Attempt.rehydrate(changed)).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_MEMENTO_INVALID" },
    });
  });

  it("rejects proxies, cycles, accessors, custom prototypes, and non-finite values", () => {
    const base = leased().toMemento();
    const cycle = structuredClone(base) as unknown as Record<string, unknown>;
    cycle["cycle"] = cycle;
    const accessor = structuredClone(base) as unknown as Record<
      string,
      unknown
    >;
    Object.defineProperty(accessor, "status", {
      enumerable: true,
      get: () => "LEASED",
    });
    const custom = Object.assign(Object.create({}), structuredClone(base));
    const nonFinite = structuredClone(base) as unknown as Record<
      string,
      unknown
    >;
    (nonFinite["seed"] as Record<string, unknown>)["missionRevision"] =
      Number.NaN;
    for (const value of [
      new Proxy(structuredClone(base), {}),
      cycle,
      accessor,
      custom,
      nonFinite,
    ])
      expect(Attempt.rehydrate(value)).toMatchObject({ ok: false });
  });
});

interface MutableTransition {
  identity: { correlationId: string; causationId: string };
  events: Array<{
    metadata: {
      eventId: string;
      occurredAt: string;
      correlationId: string;
      causationId: string;
    };
  }>;
}
