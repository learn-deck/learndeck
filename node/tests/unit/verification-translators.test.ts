import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createVerificationPublicEvent,
  finalizeVerificationPublicEvent,
} from "../../apps/verification/src/application/outgoing-message-factory.ts";
import {
  translateAbortVerification,
  translateAdvanceVerification,
  translateAssignmentRequest,
  translateStartVerification,
} from "../../apps/verification/src/application/translators.ts";
import {
  VerificationRun,
  calculateGateSetDigest,
  type StartVerificationSeed,
} from "../../apps/verification/src/domain/verification-run.ts";
import type { ReviewRecommendationEvent } from "../../apps/verification/src/domain/completion-review.ts";
import type { VerificationDomainEvent } from "../../apps/verification/src/domain/verification-run.ts";

const gates = [
  {
    gateId: "lint",
    kind: "LINT" as const,
    commandId: "check-lint" as const,
    mandatory: true,
    timeoutSeconds: 60,
    evidenceLimitBytes: 4096,
  },
  {
    gateId: "tests",
    kind: "TEST" as const,
    commandId: "check-tests" as const,
    mandatory: false,
    timeoutSeconds: 120,
    evidenceLimitBytes: 8192,
  },
] as const;
const artifactDigest = { algorithm: "sha256" as const, value: "b".repeat(64) };
const bundleDigest = { algorithm: "sha256" as const, value: "e".repeat(64) };

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

describe("Verification translators", () => {
  it("translates the root DTO into a detached immutable seed with two fingerprints", () => {
    const source = startMessage();
    const translated = translateStartVerification(source);
    expect(translated).toMatchObject({ ok: true });
    if (!translated.ok) return;
    expect(
      schemaAccepts("VerificationStartVerificationV1", translated.value.dto),
    ).toBe(true);
    expect(translated.value.seed).toEqual(source);
    expect(translated.value.deliveryFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(translated.value.semanticFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(translated.value)).toBe(true);
    expect(Object.isFrozen(translated.value.seed.data.acceptanceGates)).toBe(
      true,
    );
    (source.data.artifact.changedPaths as string[])[0] = "secret.txt";
    expect(translated.value.seed.data.artifact.changedPaths).toEqual([
      "src/quote.ts",
    ]);
  });

  it("keeps delivery identity separate from canonical semantic run identity", () => {
    const first = translateStartVerification(startMessage());
    const second = translateStartVerification(
      startMessage({
        commandId: "command-start-2",
        issuedAt: "2026-07-18T10:01:00Z",
      }),
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.deliveryFingerprint).not.toBe(
      first.value.deliveryFingerprint,
    );
    expect(second.value.semanticFingerprint).toBe(
      first.value.semanticFingerprint,
    );
  });

  it("rejects open records, invalid binding digests, registry mismatches, and drive-relative paths", () => {
    const open = startMessage();
    (open as Record<string, unknown>)["extra"] = true;
    const mismatch = startMessage();
    mismatch.data.binding.artifactDigest = {
      algorithm: "sha256",
      value: "a".repeat(64),
    };
    const wrongGate = structuredClone(startMessage()) as unknown as {
      data: { acceptanceGates: unknown[] };
    };
    wrongGate.data.acceptanceGates = [
      { ...gates[0], commandId: "check-tests" as const },
    ];
    const driveRelative = startMessage();
    driveRelative.data.artifact.changedPaths = ["C:repo/file.ts"];
    for (const candidate of [open, mismatch, wrongGate, driveRelative])
      expect(translateStartVerification(candidate)).toMatchObject({
        ok: false,
      });
  });

  it.each([
    ["plain relative", "src/quote.ts", true],
    ["NFC relative", "src/caf\u00e9.ts", true],
    ["wildcard", "src/*.ts", false],
    ["globstar", "src/**/quote.ts", false],
    ["question glob", "src/quote?.ts", false],
    ["bracket glob", "src/[ab].ts", false],
    ["POSIX absolute", "/src/quote.ts", false],
    ["drive absolute", "C:/repo/quote.ts", false],
    ["drive relative", "C:repo/quote.ts", false],
    ["traversal", "src/../quote.ts", false],
    ["backslash", "src\\quote.ts", false],
    ["NFD relative", "src/cafe\u0301.ts", false],
    ["dot segment", "src/./quote.ts", false],
    ["trailing slash", "src/quote/", false],
  ])(
    "keeps translator/domain repository-path parity for %s",
    (_label, path, accepted) => {
      const candidate = startMessage();
      candidate.data.artifact.changedPaths = [path];
      const translated = translateStartVerification(candidate);
      const domain = VerificationRun.start(
        candidate as unknown as StartVerificationSeed,
      );
      expect(translated.ok).toBe(accepted);
      expect(domain.ok).toBe(accepted);
      expect(translated.ok).toBe(domain.ok);
    },
  );

  it("rejects inherited, accessor, proxy, sparse, cyclic, lossy, non-finite, and negative-zero topology", () => {
    const inherited = Object.create({
      commandType: "verification.start-verification.v1",
    });
    Object.assign(inherited, startMessage());
    const accessor = startMessage();
    Object.defineProperty(accessor, "commandType", {
      enumerable: true,
      get: () => "verification.start-verification.v1",
    });
    const sparse = structuredClone(startMessage()) as unknown as {
      data: { acceptanceGates: unknown[] };
    };
    sparse.data.acceptanceGates = new Array(2);
    sparse.data.acceptanceGates[0] = gates[0];
    const cyclic = startMessage();
    (cyclic as Record<string, unknown>)["self"] = cyclic;
    for (const candidate of [
      inherited,
      accessor,
      new Proxy(startMessage(), {}),
      sparse,
      cyclic,
      { ...startMessage(), lossy: undefined },
      { ...startMessage(), nonfinite: Number.POSITIVE_INFINITY },
      { ...startMessage(), negativeZero: -0 },
    ])
      expect(translateStartVerification(candidate)).toMatchObject({
        ok: false,
      });
  });

  it("strictly translates only the closed private assignment, advance, and cancellation inputs", () => {
    const identity = {
      requestId: "request-1",
      correlationId: "correlation-1",
      verificationRunId: "verification-1",
    };
    expect(translateAssignmentRequest(identity)).toMatchObject({ ok: true });
    expect(translateAdvanceVerification(identity)).toMatchObject({ ok: true });
    expect(
      translateAbortVerification({ ...identity, reason: "MISSION_CANCELLED" }),
    ).toMatchObject({ ok: true });
    expect(
      translateAssignmentRequest({ ...identity, extra: true }),
    ).toMatchObject({ ok: false });
    expect(
      translateAbortVerification({
        ...identity,
        reason: "WORKSPACE_UNAVAILABLE",
      }),
    ).toMatchObject({ ok: false });
  });
});

function metadata(eventId: string, causationId = "command-start-1") {
  return {
    eventId,
    occurredAt: "2026-07-18T10:05:00.000Z",
    correlationId: "correlation-1",
    causationId,
  };
}

const binding = startMessage().data.binding;

function eventFixtures(): readonly [
  VerificationDomainEvent | ReviewRecommendationEvent,
  string,
][] {
  return [
    [
      {
        kind: "VERIFICATION_PASSED",
        metadata: metadata("event-pass-1"),
        verificationRunId: "verification-1",
        attemptId: "attempt-1",
        binding,
        verifierId: "verifier-1",
        verdict: "PASSED",
        checkCount: 2,
        evidenceBundleDigest: bundleDigest,
      },
      "VerificationPassedV1",
    ],
    [
      {
        kind: "VERIFICATION_FAILED",
        metadata: metadata("event-fail-1"),
        verificationRunId: "verification-1",
        attemptId: "attempt-1",
        binding,
        verifierId: "verifier-1",
        verdict: "FAILED",
        checkCount: 2,
        failedGateIds: ["lint"],
        evidenceBundleDigest: bundleDigest,
      },
      "VerificationFailedV1",
    ],
    [
      {
        kind: "VERIFICATION_ABORTED",
        metadata: metadata("event-abort-1"),
        verificationRunId: "verification-1",
        attemptId: "attempt-1",
        binding,
        verifierId: "verifier-1",
        outcome: "ABORTED",
        reason: "WORKSPACE_UNAVAILABLE",
        retryable: true,
        evidenceBundleDigest: bundleDigest,
        detail: "fixture unavailable",
      },
      "VerificationAbortedV1",
    ],
    [
      {
        kind: "REVIEW_RECOMMENDATION_ISSUED",
        metadata: metadata("event-review-1", "event-pass-1"),
        completionReviewId: "review-1",
        verificationRunId: "verification-1",
        binding,
        verdict: "PASSED",
        evidenceBundleDigest: bundleDigest,
        recommendation: "APPROVE",
      },
      "ReviewRecommendationIssuedV1",
    ],
  ];
}

describe("Verification outgoing event factory", () => {
  it("creates exactly four detached, deeply frozen, root-schema-valid events", () => {
    for (const [event, definition] of eventFixtures()) {
      const built = createVerificationPublicEvent(event);
      expect(built).toMatchObject({ ok: true });
      if (!built.ok) continue;
      expect(schemaAccepts(definition, built.value)).toBe(true);
      expect(Object.isFrozen(built.value)).toBe(true);
      expect(Object.isFrozen(built.value.data)).toBe(true);
    }
  });

  it("preserves exact optional abort/recommendation fields and rejects private leaks", () => {
    const abort = eventFixtures()[2]![0];
    const built = createVerificationPublicEvent(abort);
    expect(built).toMatchObject({
      ok: true,
      value: {
        data: {
          evidenceBundleDigest: bundleDigest,
          detail: "fixture unavailable",
        },
      },
    });
    if (!built.ok) return;
    expect(
      finalizeVerificationPublicEvent({
        ...built.value,
        data: {
          ...built.value.data,
          workspaceHandle: "/tmp/private",
          credential: "secret",
          rawEvidence: "private output",
          prompt: "private prompt",
        },
      }),
    ).toMatchObject({ ok: false });

    const withoutOptionals = {
      ...(abort as Extract<
        VerificationDomainEvent,
        { kind: "VERIFICATION_ABORTED" }
      >),
    } as {
      evidenceBundleDigest?: unknown;
      detail?: unknown;
    } & Extract<VerificationDomainEvent, { kind: "VERIFICATION_ABORTED" }>;
    delete withoutOptionals.evidenceBundleDigest;
    delete withoutOptionals.detail;
    const minimal = createVerificationPublicEvent(withoutOptionals);
    expect(minimal).toMatchObject({ ok: true });
    if (minimal.ok) {
      expect("evidenceBundleDigest" in minimal.value.data).toBe(false);
      expect("detail" in minimal.value.data).toBe(false);
    }
  });

  it("uses recorded provenance and never accepts malformed or invented envelope fields", () => {
    const recommendation = eventFixtures()[3]![0];
    const built = createVerificationPublicEvent(recommendation);
    expect(built).toMatchObject({
      ok: true,
      value: {
        causationId: "event-pass-1",
        subjectId: "review-1",
      },
    });
    if (!built.ok) return;
    expect(
      finalizeVerificationPublicEvent({ ...built.value, producer: "runner" }),
    ).toMatchObject({
      ok: false,
    });
  });
});
