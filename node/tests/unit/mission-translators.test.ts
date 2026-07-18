import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type {
  MissionCancelledV1,
  WorkshopArtifactSubmittedV1,
} from "@patchquest/contracts";
import { describe, expect, it } from "vitest";
import { MissionCompletionProcess } from "../../apps/mission-control/src/application/mission-completion-process.ts";
import {
  finalizeMissionControlCommand,
  finalizeMissionPublicEvent,
} from "../../apps/mission-control/src/application/outgoing-message-factory.ts";
import {
  translateMissionControlEvent,
  translateMissionDomainEvent,
  translateMissionFact,
} from "../../apps/mission-control/src/application/translators.ts";
import {
  Mission,
  calculateGateSetDigest,
  type MissionAcceptanceGate,
} from "../../apps/mission-control/src/domain/mission.ts";

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
const artifactDigest = { algorithm: "sha256", value: "b".repeat(64) } as const;

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
]) {
  const path = resolve(process.cwd(), "../contracts/schemas/v1", filename);
  ajv.addSchema(JSON.parse(readFileSync(path, "utf8")) as object);
}

function schemaAccepts(definition: string, value: unknown): boolean {
  const validate = ajv.getSchema(
    `https://schemas.patchquest.example/contracts/v1/integration-messages.schema.json#/$defs/${definition}`,
  );
  if (!validate) throw new Error(`missing schema ${definition}`);
  return validate(value) as boolean;
}

function openedEvent() {
  const drafted = Mission.draft({
    missionId: "mission-1",
    missionRevision: 1,
    objective: "Implement shipping quote.",
    startingRevision: "fixture-shipping-v1",
    workspaceReference: "urn:patchquest:fixture:shipping-quote",
    allowedScope: { pathPatterns: ["src/shipping/**"] },
    requestedCapabilities: ["edit-trusted-fixture"],
    attemptBudget: 2,
  });
  if (!drafted.ok) throw new Error(drafted.error.message);
  drafted.value.defineAcceptanceGates({
    acceptanceGates: gates,
    gateSetDigest,
  });
  const opened = drafted.value.open({ attemptId: "attempt-1" });
  if (!opened.ok) throw new Error(opened.error.message);
  const event = opened.events[0];
  if (!event) throw new Error("missing opened event");
  return event;
}

function artifactData(): Readonly<Record<string, unknown>> {
  return {
    attemptId: "attempt-1",
    missionId: "mission-1",
    missionRevision: 1,
    startingRevision: "fixture-shipping-v1",
    runnerId: "runner-1",
    artifact: {
      reference: "urn:patchquest:artifact:1",
      digest: artifactDigest,
      changedPaths: ["src/shipping/quote.ts"],
    },
    gateSetDigest,
  };
}

function artifactEvent(): Readonly<Record<string, unknown>> {
  return {
    eventId: "event-artifact-1",
    eventType: "workshop.artifact-submitted.v1",
    schemaVersion: 1,
    occurredAt: "2026-07-12T10:00:00Z",
    producer: "workshop",
    subjectId: "attempt-1",
    correlationId: "corr-1",
    causationId: "request-submit-1",
    data: artifactData(),
  };
}

describe("Mission Control translators", () => {
  it("emits the exact public mission-opened payload while retaining workspace only in-process", () => {
    const translated = translateMissionDomainEvent(openedEvent(), {
      eventId: "event-opened-1",
      occurredAt: "2026-07-12T10:00:00Z",
      correlationId: "corr-1",
      causationId: "request-create-1",
    });
    expect(translated).toEqual({
      ok: true,
      value: {
        eventId: "event-opened-1",
        eventType: "mission.opened.v1",
        schemaVersion: 1,
        occurredAt: "2026-07-12T10:00:00Z",
        producer: "mission-control",
        subjectId: "mission-1",
        correlationId: "corr-1",
        causationId: "request-create-1",
        data: {
          missionId: "mission-1",
          missionRevision: 1,
          objective: "Implement shipping quote.",
          startingRevision: "fixture-shipping-v1",
          allowedScope: { pathPatterns: ["src/shipping/**"] },
          requestedCapabilities: ["edit-trusted-fixture"],
          acceptanceGates: gates,
          gateSetDigest,
          attemptBudget: 2,
        },
      },
    });
    if (!translated.ok) return;
    expect("workspaceReference" in translated.value.data).toBe(false);
  });

  it("constructs a typed private-boundary event from a valid public fact", () => {
    expect(schemaAccepts("WorkshopArtifactSubmittedV1", artifactEvent())).toBe(
      true,
    );
    const translated = translateMissionControlEvent(artifactEvent());
    expect(translated).toMatchObject({
      ok: true,
      value: {
        eventType: "workshop.artifact-submitted.v1",
        data: {
          missionId: "mission-1",
          artifact: { digest: artifactDigest },
        },
      },
    });
    if (!translated.ok) return;
    if (translated.value.eventType !== "workshop.artifact-submitted.v1")
      throw new Error("unexpected translated event");
    expect(
      translateMissionFact(translated.value, {
        missionRevision: 1,
        currentAttemptNumber: 1,
      }),
    ).toEqual({
      kind: "RECORD_ARTIFACT_SUBMITTED",
      fact: {
        missionRevision: 1,
        attemptId: "attempt-1",
        startingRevision: "fixture-shipping-v1",
        artifactDigest,
        gateSetDigest,
      },
    });
  });

  it.each([
    ["open envelope", { ...artifactEvent(), unexpected: true }],
    [
      "open data",
      {
        ...artifactEvent(),
        data: { ...artifactData(), unexpected: true },
      },
    ],
    ["wrong producer", { ...artifactEvent(), producer: "mission-control" }],
    [
      "bad digest",
      {
        ...artifactEvent(),
        data: {
          ...artifactData(),
          gateSetDigest: { algorithm: "sha256", value: "bad" },
        },
      },
    ],
  ])("rejects an invalid %s", (_label, value) => {
    expect(translateMissionControlEvent(value)).toMatchObject({
      ok: false,
      error: { code: "CONTRACT_INVALID" },
    });
  });

  it("rejects a retryable cancellation abort at the translator boundary", () => {
    const value = {
      eventId: "event-aborted-1",
      eventType: "verification.aborted.v1",
      schemaVersion: 1,
      occurredAt: "2026-07-12T10:00:00Z",
      producer: "verification-and-review",
      subjectId: "verification-1",
      correlationId: "corr-1",
      causationId: "command-verification-1",
      data: {
        verificationRunId: "verification-1",
        attemptId: "attempt-1",
        binding: {
          missionId: "mission-1",
          missionRevision: 1,
          startingRevision: "fixture-shipping-v1",
          artifactDigest,
          gateSetDigest,
        },
        verifierId: "verifier-1",
        outcome: "ABORTED",
        reason: "MISSION_CANCELLED",
        retryable: true,
      },
    };
    expect(translateMissionControlEvent(value)).toMatchObject({
      ok: false,
      error: { code: "CONTRACT_INVALID" },
    });
    expect(schemaAccepts("VerificationAbortedV1", value)).toBe(false);
  });

  it.each([
    [
      "date-only timestamp",
      "WorkshopArtifactSubmittedV1",
      { ...artifactEvent(), occurredAt: "2026-07-12" },
    ],
    [
      "impossible calendar timestamp",
      "WorkshopArtifactSubmittedV1",
      { ...artifactEvent(), occurredAt: "2026-04-31T10:00:00Z" },
    ],
    [
      "513-character path",
      "WorkshopArtifactSubmittedV1",
      {
        ...artifactEvent(),
        data: {
          ...artifactData(),
          artifact: {
            reference: "urn:patchquest:artifact:1",
            digest: artifactDigest,
            changedPaths: ["x".repeat(513)],
          },
        },
      },
    ],
    [
      "129-character capability",
      "WorkshopAttemptReadyV1",
      {
        eventId: "event-ready-1",
        eventType: "workshop.attempt-ready.v1",
        schemaVersion: 1,
        occurredAt: "2026-07-12T10:00:00Z",
        producer: "workshop",
        subjectId: "attempt-1",
        correlationId: "corr-1",
        causationId: "command-create-1",
        data: {
          attemptId: "attempt-1",
          missionId: "mission-1",
          missionRevision: 1,
          startingRevision: "fixture-shipping-v1",
          attemptNumber: 1,
          requestedCapabilities: ["x".repeat(129)],
        },
      },
    ],
    [
      "invalid failed gate identifier",
      "VerificationFailedV1",
      {
        eventId: "event-failed-1",
        eventType: "verification.failed.v1",
        schemaVersion: 1,
        occurredAt: "2026-07-12T10:00:00Z",
        producer: "verification-and-review",
        subjectId: "verification-1",
        correlationId: "corr-1",
        causationId: "command-verification-1",
        data: {
          verificationRunId: "verification-1",
          attemptId: "attempt-1",
          binding: {
            missionId: "mission-1",
            missionRevision: 1,
            startingRevision: "fixture-shipping-v1",
            artifactDigest,
            gateSetDigest,
          },
          verifierId: "verifier-1",
          verdict: "FAILED",
          checkCount: 1,
          failedGateIds: ["bad gate"],
          evidenceBundleDigest: {
            algorithm: "sha256",
            value: "c".repeat(64),
          },
        },
      },
    ],
  ])(
    "matches the root JSON Schema rejection for %s",
    (_label, schema, value) => {
      expect(schemaAccepts(schema, value)).toBe(false);
      expect(translateMissionControlEvent(value)).toMatchObject({
        ok: false,
        error: { code: "CONTRACT_INVALID" },
      });
    },
  );

  it("matches AJV when every inbound array-bearing public fact is sparse", () => {
    const ready = {
      eventId: "event-ready-sparse",
      eventType: "workshop.attempt-ready.v1",
      schemaVersion: 1,
      occurredAt: "2026-07-12T10:00:00Z",
      producer: "workshop",
      subjectId: "attempt-1",
      correlationId: "corr-1",
      causationId: "command-create-1",
      data: {
        attemptId: "attempt-1",
        missionId: "mission-1",
        missionRevision: 1,
        startingRevision: "fixture-shipping-v1",
        attemptNumber: 1,
        requestedCapabilities: new Array(1),
      },
    };
    const leased = {
      eventId: "event-leased-sparse",
      eventType: "workshop.attempt-leased.v1",
      schemaVersion: 1,
      occurredAt: "2026-07-12T10:00:00Z",
      producer: "workshop",
      subjectId: "attempt-1",
      correlationId: "corr-1",
      causationId: "request-lease-1",
      data: {
        attemptId: "attempt-1",
        runnerId: "runner-1",
        leaseId: "lease-1",
        runnerCapabilities: new Array(1),
        expiresAt: "2026-07-12T10:01:00Z",
      },
    };
    const submitted = structuredClone(artifactEvent()) as Record<
      string,
      unknown
    >;
    const submittedData = submitted["data"] as Record<string, unknown>;
    const submittedArtifact = submittedData["artifact"] as Record<
      string,
      unknown
    >;
    submittedArtifact["changedPaths"] = new Array(1);
    const failed = {
      eventId: "event-failed-sparse",
      eventType: "verification.failed.v1",
      schemaVersion: 1,
      occurredAt: "2026-07-12T10:00:00Z",
      producer: "verification-and-review",
      subjectId: "verification-1",
      correlationId: "corr-1",
      causationId: "command-verification-1",
      data: {
        verificationRunId: "verification-1",
        attemptId: "attempt-1",
        binding: {
          missionId: "mission-1",
          missionRevision: 1,
          startingRevision: "fixture-shipping-v1",
          artifactDigest,
          gateSetDigest,
        },
        verifierId: "verifier-1",
        verdict: "FAILED",
        checkCount: 1,
        failedGateIds: new Array(1),
        evidenceBundleDigest: {
          algorithm: "sha256",
          value: "c".repeat(64),
        },
      },
    };
    for (const [schema, value] of [
      ["WorkshopAttemptReadyV1", ready],
      ["WorkshopAttemptLeasedV1", leased],
      ["WorkshopArtifactSubmittedV1", submitted],
      ["VerificationFailedV1", failed],
    ] as const) {
      expect(schemaAccepts(schema, value), schema).toBe(false);
      expect(translateMissionControlEvent(value), schema).toMatchObject({
        ok: false,
        error: { code: "CONTRACT_INVALID" },
      });
    }
  });

  it.each(["2026-07-12t10:00:00z", "2026-07-12 10:00:00+0100"])(
    "matches the root JSON Schema acceptance for RFC3339 form %s",
    (occurredAt) => {
      const value = { ...artifactEvent(), occurredAt };
      expect(schemaAccepts("WorkshopArtifactSubmittedV1", value)).toBe(true);
      expect(translateMissionControlEvent(value)).toMatchObject({ ok: true });
    },
  );

  it("rejects unsupported Mission-owned events on the inbound context boundary", () => {
    const outgoing = translateMissionDomainEvent(openedEvent(), {
      eventId: "event-opened-1",
      occurredAt: "2026-07-12T10:00:00Z",
      correlationId: "corr-1",
      causationId: "request-create-1",
    });
    if (!outgoing.ok) throw new Error(outgoing.error.message);
    const translated = translateMissionControlEvent(outgoing.value);
    expect(translated).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_MESSAGE" },
    });
  });

  it("rejects inherited and accessor-backed public facts without invoking accessors", () => {
    const inherited = Object.create(artifactEvent());
    expect(translateMissionControlEvent(inherited)).toMatchObject({
      ok: false,
      error: { code: "CONTRACT_INVALID" },
    });
    const accessor = structuredClone(artifactEvent()) as Record<
      string,
      unknown
    >;
    delete accessor["data"];
    let accessorRead = false;
    Object.defineProperty(accessor, "data", {
      enumerable: true,
      get() {
        accessorRead = true;
        return artifactData();
      },
    });
    expect(translateMissionControlEvent(accessor)).toMatchObject({
      ok: false,
      error: { code: "CONTRACT_INVALID" },
    });
    expect(accessorRead).toBe(false);
  });

  it("validates private-fact context topology before reading it", () => {
    const translated = translateMissionControlEvent(artifactEvent());
    if (
      !translated.ok ||
      translated.value.eventType !== "workshop.artifact-submitted.v1"
    )
      throw new Error("unexpected translated event");
    expect(
      translateMissionFact(translated.value, {
        missionRevision: 1,
        currentAttemptNumber: 1,
        unexpected: true,
      } as never),
    ).toBeUndefined();
    const context = {
      missionRevision: 1,
      currentAttemptNumber: 1,
    } as Record<string, unknown>;
    delete context["missionRevision"];
    let contextRead = false;
    Object.defineProperty(context, "missionRevision", {
      enumerable: true,
      get() {
        contextRead = true;
        return 1;
      },
    });
    expect(
      translateMissionFact(translated.value, context as never),
    ).toBeUndefined();
    expect(contextRead).toBe(false);
  });

  it("keeps all three emitted commands aligned with their root schemas and deeply immutable", () => {
    const drafted = Mission.draft({
      missionId: "mission-outgoing",
      missionRevision: 1,
      objective: "Implement shipping quote.",
      startingRevision: "fixture-shipping-v1",
      workspaceReference: "urn:patchquest:fixture:shipping-quote",
      allowedScope: { pathPatterns: ["src/shipping/**"] },
      requestedCapabilities: ["edit-trusted-fixture"],
      attemptBudget: 2,
    });
    if (!drafted.ok) throw new Error(drafted.error.message);
    drafted.value.defineAcceptanceGates({
      acceptanceGates: gates,
      gateSetDigest,
    });
    const opened = drafted.value.open({ attemptId: "attempt-outgoing-1" });
    if (!opened.ok) throw new Error(opened.error.message);
    const started = MissionCompletionProcess.start(opened.value.processSeed, {
      openedEventId: "event-opened-outgoing",
      commandId: "command-create-outgoing",
      issuedAt: "2026-07-12T10:00:00Z",
      correlationId: "corr-outgoing",
    });
    if (!started.ok) throw new Error(started.error.message);
    const create = started.result.commands[0]!;

    const artifactSubmitted: WorkshopArtifactSubmittedV1 = {
      eventId: "event-artifact-outgoing",
      eventType: "workshop.artifact-submitted.v1",
      schemaVersion: 1,
      occurredAt: "2026-07-12T10:00:00Z",
      producer: "workshop",
      subjectId: "attempt-outgoing-1",
      correlationId: "corr-outgoing",
      causationId: "submit-outgoing",
      data: {
        attemptId: "attempt-outgoing-1",
        missionId: "mission-outgoing",
        missionRevision: 1,
        startingRevision: "fixture-shipping-v1",
        runnerId: "runner-outgoing",
        artifact: {
          reference: "urn:patchquest:artifact:outgoing",
          digest: artifactDigest,
          changedPaths: ["src/shipping/quote.ts"],
        },
        gateSetDigest,
      },
    };
    const verification = started.process.recordArtifactSubmitted(
      artifactSubmitted,
      {
        commandId: "command-verify-outgoing",
        verificationRunId: "verification-outgoing",
        issuedAt: "2026-07-12T10:00:00Z",
      },
    );
    if (!verification.ok) throw new Error(verification.error.message);
    const verify = verification.commands[0]!;

    const revokeStarted = MissionCompletionProcess.start(
      opened.value.processSeed,
      {
        openedEventId: "event-opened-revoke",
        commandId: "command-create-revoke",
        issuedAt: "2026-07-12T10:00:00Z",
        correlationId: "corr-revoke",
      },
    );
    if (!revokeStarted.ok) throw new Error(revokeStarted.error.message);
    const cancellation: MissionCancelledV1 = {
      eventId: "event-cancel-revoke",
      eventType: "mission.cancelled.v1",
      schemaVersion: 1,
      occurredAt: "2026-07-12T10:00:00Z",
      producer: "mission-control",
      subjectId: "mission-outgoing",
      correlationId: "corr-revoke",
      causationId: "request-cancel",
      data: {
        missionId: "mission-outgoing",
        missionRevision: 1,
        cancelledBy: "human-reviewer",
        reason: "Stop.",
      },
    };
    const revoked = revokeStarted.process.cancel(cancellation, {
      commandId: "command-revoke-outgoing",
      issuedAt: "2026-07-12T10:00:00Z",
    });
    if (!revoked.ok) throw new Error(revoked.error.message);
    const revoke = revoked.commands[0]!;

    for (const [schema, command] of [
      ["WorkshopCreateAttemptV1", create],
      ["VerificationStartVerificationV1", verify],
      ["WorkshopRevokeAttemptV1", revoke],
    ] as const) {
      expect(schemaAccepts(schema, command), schema).toBe(true);
      expect(Object.isFrozen(command), schema).toBe(true);
      expect(Object.isFrozen(command.data), schema).toBe(true);
      for (const changed of [
        (() => {
          const copy = structuredClone(command);
          (copy as unknown as Record<string, unknown>)["unexpectedTop"] = true;
          return copy;
        })(),
        (() => {
          const copy = structuredClone(command);
          (copy.data as unknown as Record<string, unknown>)["unexpectedData"] =
            true;
          return copy;
        })(),
      ]) {
        expect(schemaAccepts(schema, changed), `${schema} schema closure`).toBe(
          false,
        );
        expect(
          finalizeMissionControlCommand(changed),
          `${schema} factory closure`,
        ).toMatchObject({
          ok: false,
          error: { code: "OUTGOING_MESSAGE_INVALID" },
        });
      }
    }

    const nestedCommandMutations = [
      (() => {
        const copy = structuredClone(create);
        if (copy.commandType !== "workshop.create-attempt.v1") return copy;
        (copy.data.allowedScope as unknown as Record<string, unknown>)[
          "unexpectedNested"
        ] = true;
        return copy;
      })(),
      (() => {
        const copy = structuredClone(verify);
        if (copy.commandType !== "verification.start-verification.v1")
          return copy;
        (copy.data.binding as unknown as Record<string, unknown>)[
          "unexpectedNested"
        ] = true;
        return copy;
      })(),
    ] as const;
    for (const [index, changed] of nestedCommandMutations.entries()) {
      const schema =
        index === 0
          ? "WorkshopCreateAttemptV1"
          : "VerificationStartVerificationV1";
      expect(schemaAccepts(schema, changed)).toBe(false);
      expect(finalizeMissionControlCommand(changed)).toMatchObject({
        ok: false,
        error: { code: "OUTGOING_MESSAGE_INVALID" },
      });
    }

    const unknownCommand = structuredClone(create) as unknown as Record<
      string,
      unknown
    >;
    unknownCommand["commandType"] = "workshop.unknown.v1";
    expect(schemaAccepts("WorkshopCreateAttemptV1", unknownCommand)).toBe(
      false,
    );
    expect(
      finalizeMissionControlCommand(unknownCommand as unknown as typeof create),
    ).toMatchObject({ ok: false, error: { code: "OUTGOING_MESSAGE_INVALID" } });

    const sparseCreateGates = structuredClone(create);
    const sparseCreateCapabilities = structuredClone(create);
    const sparseCreateScope = structuredClone(create);
    for (const command of [
      sparseCreateGates,
      sparseCreateCapabilities,
      sparseCreateScope,
    ]) {
      if (command.commandType !== "workshop.create-attempt.v1")
        throw new Error("unexpected create command");
    }
    (sparseCreateGates.data as unknown as Record<string, unknown>)[
      "acceptanceGates"
    ] = new Array(1);
    (sparseCreateCapabilities.data as unknown as Record<string, unknown>)[
      "requestedCapabilities"
    ] = new Array(1);
    if (sparseCreateScope.commandType !== "workshop.create-attempt.v1")
      throw new Error("unexpected create command");
    (sparseCreateScope.data.allowedScope as unknown as Record<string, unknown>)[
      "pathPatterns"
    ] = new Array(1);
    const sparseVerifyGates = structuredClone(verify);
    const sparseVerifyPaths = structuredClone(verify);
    for (const command of [sparseVerifyGates, sparseVerifyPaths]) {
      if (command.commandType !== "verification.start-verification.v1")
        throw new Error("unexpected verification command");
    }
    (sparseVerifyGates.data as unknown as Record<string, unknown>)[
      "acceptanceGates"
    ] = new Array(1);
    if (sparseVerifyPaths.commandType !== "verification.start-verification.v1")
      throw new Error("unexpected verification command");
    (sparseVerifyPaths.data.artifact as unknown as Record<string, unknown>)[
      "changedPaths"
    ] = new Array(1);
    for (const [schema, changed] of [
      ["WorkshopCreateAttemptV1", sparseCreateGates],
      ["WorkshopCreateAttemptV1", sparseCreateCapabilities],
      ["WorkshopCreateAttemptV1", sparseCreateScope],
      ["VerificationStartVerificationV1", sparseVerifyGates],
      ["VerificationStartVerificationV1", sparseVerifyPaths],
    ] as const) {
      expect(schemaAccepts(schema, changed), `${schema} sparse schema`).toBe(
        false,
      );
      expect(finalizeMissionControlCommand(changed)).toMatchObject({
        ok: false,
        error: { code: "OUTGOING_MESSAGE_INVALID" },
      });
    }
  });

  it("keeps every emitted Mission event aligned with its root schema and detached from callers", () => {
    const makeMission = () => {
      const drafted = Mission.draft({
        missionId: "mission-events",
        missionRevision: 1,
        objective: "Implement shipping quote.",
        startingRevision: "fixture-shipping-v1",
        workspaceReference: "urn:patchquest:fixture:shipping-quote",
        allowedScope: { pathPatterns: ["src/shipping/**"] },
        requestedCapabilities: ["edit-trusted-fixture"],
        attemptBudget: 2,
      });
      if (!drafted.ok) throw new Error(drafted.error.message);
      drafted.value.defineAcceptanceGates({
        acceptanceGates: gates,
        gateSetDigest,
      });
      const opened = drafted.value.open({ attemptId: "attempt-1" });
      if (!opened.ok) throw new Error(opened.error.message);
      return drafted.value;
    };
    const metadata = (suffix: string) => ({
      eventId: `event-${suffix}`,
      occurredAt: "2026-07-12T10:00:00Z",
      correlationId: "corr-events",
      causationId: `cause-${suffix}`,
    });
    const openedDomain = structuredClone(openedEvent());
    if (openedDomain.kind !== "MISSION_OPENED")
      throw new Error("unexpected opened domain event");
    const openedPublic = translateMissionDomainEvent(
      openedDomain,
      metadata("opened"),
    );
    if (!openedPublic.ok) throw new Error(openedPublic.error.message);

    const retryMission = makeMission();
    retryMission.recordAttemptEnded({
      missionRevision: 1,
      attemptId: "attempt-1",
      outcome: "FAILED",
    });
    const retried = retryMission.authorizeAnotherAttempt({
      attemptId: "attempt-2",
      reason: "ATTEMPT_FAILED",
      feedback: "Repair the failed attempt.",
    });
    if (!retried.ok) throw new Error(retried.error.message);
    const retryPublic = translateMissionDomainEvent(
      retried.events[0]!,
      metadata("retry"),
    );
    if (!retryPublic.ok) throw new Error(retryPublic.error.message);

    const cancelMission = makeMission();
    const cancelled = cancelMission.cancel({
      missionRevision: 1,
      cancelledBy: "human-reviewer",
      reason: "Stop.",
    });
    if (!cancelled.ok) throw new Error(cancelled.error.message);
    const cancelPublic = translateMissionDomainEvent(
      cancelled.events[0]!,
      metadata("cancelled"),
    );
    if (!cancelPublic.ok) throw new Error(cancelPublic.error.message);

    const completeMission = makeMission();
    completeMission.recordArtifactSubmitted({
      missionRevision: 1,
      attemptId: "attempt-1",
      startingRevision: "fixture-shipping-v1",
      artifactDigest,
      gateSetDigest,
    });
    const evidence = { algorithm: "sha256", value: "c".repeat(64) } as const;
    const binding = {
      missionId: "mission-events",
      missionRevision: 1,
      startingRevision: "fixture-shipping-v1",
      artifactDigest,
      gateSetDigest,
    } as const;
    completeMission.recordVerificationVerdict({
      attemptId: "attempt-1",
      verificationRunId: "verification-1",
      binding,
      verdict: "PASSED",
      evidenceBundleDigest: evidence,
    });
    completeMission.recordReviewRecommendation({
      completionReviewId: "review-1",
      verificationRunId: "verification-1",
      binding,
      verdict: "PASSED",
      evidenceBundleDigest: evidence,
      recommendation: "APPROVE",
    });
    const completed = completeMission.approveCompletion({
      missionRevision: 1,
      completionReviewId: "review-1",
      recommendation: "APPROVE",
      verificationRunId: "verification-1",
      artifactDigest,
      gateSetDigest,
      evidenceBundleDigest: evidence,
      decidedBy: "human-reviewer",
    });
    if (!completed.ok) throw new Error(completed.error.message);
    const completedPublic = translateMissionDomainEvent(
      completed.events[0]!,
      metadata("completed"),
    );
    if (!completedPublic.ok) throw new Error(completedPublic.error.message);

    for (const [schema, event] of [
      ["MissionOpenedV1", openedPublic.value],
      ["MissionRetryAuthorizedV1", retryPublic.value],
      ["MissionCancelledV1", cancelPublic.value],
      ["MissionCompletedV1", completedPublic.value],
    ] as const) {
      expect(schemaAccepts(schema, event), schema).toBe(true);
      expect(Object.isFrozen(event), schema).toBe(true);
      expect(Object.isFrozen(event.data), schema).toBe(true);
      for (const changed of [
        (() => {
          const copy = structuredClone(event);
          (copy as unknown as Record<string, unknown>)["unexpectedTop"] = true;
          return copy;
        })(),
        (() => {
          const copy = structuredClone(event);
          (copy.data as unknown as Record<string, unknown>)["unexpectedData"] =
            true;
          return copy;
        })(),
      ]) {
        expect(schemaAccepts(schema, changed), `${schema} schema closure`).toBe(
          false,
        );
        expect(
          finalizeMissionPublicEvent(changed),
          `${schema} factory closure`,
        ).toMatchObject({
          ok: false,
          error: { code: "OUTGOING_MESSAGE_INVALID" },
        });
      }
    }
    const openedNested = structuredClone(openedPublic.value);
    if (openedNested.eventType !== "mission.opened.v1")
      throw new Error("unexpected opened event");
    (openedNested.data.allowedScope as unknown as Record<string, unknown>)[
      "unexpectedNested"
    ] = true;
    expect(schemaAccepts("MissionOpenedV1", openedNested)).toBe(false);
    expect(finalizeMissionPublicEvent(openedNested)).toMatchObject({
      ok: false,
      error: { code: "OUTGOING_MESSAGE_INVALID" },
    });
    const completedNested = structuredClone(completedPublic.value);
    if (completedNested.eventType !== "mission.completed.v1")
      throw new Error("unexpected completed event");
    (
      completedNested.data.evidenceBundleDigest as unknown as Record<
        string,
        unknown
      >
    )["unexpectedNested"] = true;
    expect(schemaAccepts("MissionCompletedV1", completedNested)).toBe(false);
    expect(finalizeMissionPublicEvent(completedNested)).toMatchObject({
      ok: false,
      error: { code: "OUTGOING_MESSAGE_INVALID" },
    });
    const unknownEvent = structuredClone(
      openedPublic.value,
    ) as unknown as Record<string, unknown>;
    unknownEvent["eventType"] = "mission.unknown.v1";
    expect(schemaAccepts("MissionOpenedV1", unknownEvent)).toBe(false);
    expect(
      finalizeMissionPublicEvent(
        unknownEvent as unknown as typeof openedPublic.value,
      ),
    ).toMatchObject({ ok: false, error: { code: "OUTGOING_MESSAGE_INVALID" } });
    for (const mutate of [
      (value: typeof openedPublic.value) => {
        if (value.eventType !== "mission.opened.v1") return;
        (value.data.allowedScope as unknown as Record<string, unknown>)[
          "pathPatterns"
        ] = new Array(1);
      },
      (value: typeof openedPublic.value) => {
        if (value.eventType !== "mission.opened.v1") return;
        (value.data as unknown as Record<string, unknown>)[
          "requestedCapabilities"
        ] = new Array(1);
      },
      (value: typeof openedPublic.value) => {
        if (value.eventType !== "mission.opened.v1") return;
        (value.data as unknown as Record<string, unknown>)["acceptanceGates"] =
          new Array(1);
      },
    ]) {
      const changed = structuredClone(openedPublic.value);
      mutate(changed);
      expect(schemaAccepts("MissionOpenedV1", changed)).toBe(false);
      expect(finalizeMissionPublicEvent(changed)).toMatchObject({
        ok: false,
        error: { code: "OUTGOING_MESSAGE_INVALID" },
      });
    }
    const mutableContract = openedDomain.workContract as unknown as {
      objective: string;
      acceptanceGates: Array<{ gateId: string }>;
    };
    mutableContract.objective = "mutated after translation";
    mutableContract.acceptanceGates[0]!.gateId = "mutated-gate";
    expect(openedPublic.value.data).toMatchObject({
      objective: "Implement shipping quote.",
      acceptanceGates: [{ gateId: "tests" }],
    });
  });

  it.each([
    ["eventId", "bad id"],
    ["occurredAt", "2026-04-31T10:00:00Z"],
    ["correlationId", "bad id"],
    ["causationId", "bad id"],
  ])("rejects invalid outgoing metadata field %s", (field, value) => {
    expect(
      translateMissionDomainEvent(openedEvent(), {
        eventId: "event-opened-metadata",
        occurredAt: "2026-07-12T10:00:00Z",
        correlationId: "corr-metadata",
        causationId: "cause-metadata",
        [field]: value,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "CONTRACT_INVALID" },
    });
  });

  it("rejects inherited, accessor-backed, and open-ended outgoing inputs without invoking accessors", () => {
    const metadata = {
      eventId: "event-opened-topology",
      occurredAt: "2026-07-12T10:00:00Z",
      correlationId: "corr-topology",
      causationId: "cause-topology",
    };
    expect(
      translateMissionDomainEvent(
        openedEvent(),
        Object.create(metadata) as never,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "CONTRACT_INVALID" },
    });

    const accessorMetadata = { ...metadata } as Record<string, unknown>;
    delete accessorMetadata["occurredAt"];
    let metadataAccessorRead = false;
    Object.defineProperty(accessorMetadata, "occurredAt", {
      enumerable: true,
      get() {
        metadataAccessorRead = true;
        return "2026-07-12T10:00:00Z";
      },
    });
    expect(
      translateMissionDomainEvent(openedEvent(), accessorMetadata as never),
    ).toMatchObject({
      ok: false,
      error: { code: "CONTRACT_INVALID" },
    });
    expect(metadataAccessorRead).toBe(false);

    const openEvent = structuredClone(openedEvent()) as unknown as Record<
      string,
      unknown
    >;
    openEvent["unexpected"] = true;
    expect(
      translateMissionDomainEvent(openEvent as never, metadata),
    ).toMatchObject({
      ok: false,
      error: { code: "CONTRACT_INVALID" },
    });

    const accessorEvent = structuredClone(openedEvent()) as unknown as Record<
      string,
      unknown
    >;
    const workContract = accessorEvent["workContract"] as Record<
      string,
      unknown
    >;
    delete workContract["objective"];
    let eventAccessorRead = false;
    Object.defineProperty(workContract, "objective", {
      enumerable: true,
      get() {
        eventAccessorRead = true;
        return "Implement shipping quote.";
      },
    });
    expect(
      translateMissionDomainEvent(accessorEvent as never, metadata),
    ).toMatchObject({
      ok: false,
      error: { code: "CONTRACT_INVALID" },
    });
    expect(eventAccessorRead).toBe(false);
  });

  it("matches AJV for every contract-valid verification-abort optional-field combination", () => {
    const base = {
      eventId: "event-abort-optionals",
      eventType: "verification.aborted.v1",
      schemaVersion: 1,
      occurredAt: "2026-07-12T10:00:00Z",
      producer: "verification-and-review",
      subjectId: "verification-1",
      correlationId: "corr-1",
      causationId: "command-verification-1",
      data: {
        verificationRunId: "verification-1",
        attemptId: "attempt-1",
        binding: {
          missionId: "mission-1",
          missionRevision: 1,
          startingRevision: "fixture-shipping-v1",
          artifactDigest,
          gateSetDigest,
        },
        verifierId: "verifier-1",
        outcome: "ABORTED",
        reason: "WORKSPACE_UNAVAILABLE",
        retryable: false,
      },
    } as const;
    const combinations = [
      {},
      { evidenceBundleDigest: { algorithm: "sha256", value: "c".repeat(64) } },
      { detail: "Workspace checkout failed." },
      {
        evidenceBundleDigest: {
          algorithm: "sha256",
          value: "c".repeat(64),
        },
        detail: "Workspace checkout failed.",
      },
    ] as const;
    for (const optional of combinations) {
      const event = { ...base, data: { ...base.data, ...optional } };
      expect(schemaAccepts("VerificationAbortedV1", event)).toBe(true);
      expect(translateMissionControlEvent(event)).toMatchObject({ ok: true });
    }
  });

  it("matches AJV for both recommendation reason optional-field combinations", () => {
    const base = {
      eventId: "event-recommendation-optionals",
      eventType: "review.recommendation-issued.v1",
      schemaVersion: 1,
      occurredAt: "2026-07-12T10:00:00Z",
      producer: "verification-and-review",
      subjectId: "review-1",
      correlationId: "corr-1",
      causationId: "event-passed-1",
      data: {
        completionReviewId: "review-1",
        verificationRunId: "verification-1",
        binding: {
          missionId: "mission-1",
          missionRevision: 1,
          startingRevision: "fixture-shipping-v1",
          artifactDigest,
          gateSetDigest,
        },
        verdict: "PASSED",
        evidenceBundleDigest: {
          algorithm: "sha256",
          value: "c".repeat(64),
        },
        recommendation: "APPROVE",
      },
    } as const;
    for (const optional of [
      {},
      { reason: "All mandatory gates passed." },
    ] as const) {
      const event = { ...base, data: { ...base.data, ...optional } };
      expect(schemaAccepts("ReviewRecommendationIssuedV1", event)).toBe(true);
      expect(translateMissionControlEvent(event)).toMatchObject({ ok: true });
    }
  });
});
