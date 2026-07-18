import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type { CompletionReviewMementoV1 } from "../../apps/verification/src/domain/completion-review.ts";
import {
  calculateGateSetDigest,
  type AcceptanceGate,
  type VerificationRunMementoV1,
} from "../../apps/verification/src/domain/verification-run.ts";
import type { VerificationPublicEvent } from "../../apps/verification/src/application/outgoing-message-factory.ts";
import type {
  EvidenceBundleInput,
  GateExecutionOutcome,
  GateExecutorPort,
  VerificationIdGenerator,
  VerificationTransaction,
  VerificationUnitOfWork,
  VerifierAssignment,
  WorkspaceMaterialization,
  WorkspaceMaterializerPort,
} from "../../apps/verification/src/application/ports.ts";
import { VerificationUseCases } from "../../apps/verification/src/application/verification-use-cases.ts";

// ---------------------------------------------------------------------------
// Canonical scenario derivation.
//
// These seams are derived from the implementation-neutral acceptance fixtures
// in `/acceptance/scenarios`. Each test loads a fixture and reconstructs its
// start command, artifact, binding, and gates from the fixture data, so that a
// change to a fixture breaks the test instead of silently drifting from the
// hand-built approximation these tests used before.
//
// The tests exercise the domain/application seams with trusted abstract gate
// results. They do not materialize a live workspace or execute host commands;
// resolving `allowedScope` and evaluating changed paths in a real workspace
// remain Phase 6 adapter work.
// ---------------------------------------------------------------------------

type GateOutcomeName =
  "PASS" | "FAIL" | "TIMEOUT" | "INFRASTRUCTURE_UNAVAILABLE";

interface GateExecutionSpec {
  readonly gateId: string;
  readonly outcome: GateOutcomeName;
}

interface ScenarioDigest {
  readonly algorithm: "sha256";
  readonly value: string;
}

interface ScenarioArtifact {
  readonly reference: string;
  readonly digest: ScenarioDigest;
  readonly changedPaths: readonly string[];
}

interface StartBinding {
  readonly missionId: string;
  readonly missionRevision: number;
  readonly startingRevision: string;
  readonly artifactDigest: ScenarioDigest;
  readonly gateSetDigest: ScenarioDigest;
}

interface StartData {
  readonly verificationRunId: string;
  readonly attemptId: string;
  readonly producingRunnerId: string;
  readonly binding: StartBinding;
  readonly artifact: ScenarioArtifact;
  readonly acceptanceGates: readonly AcceptanceGate[];
}

interface StartCommand {
  readonly commandId: string;
  readonly commandType: "verification.start-verification.v1";
  readonly schemaVersion: 1;
  readonly issuedAt: string;
  readonly issuer: "mission-control";
  readonly recipient: "verification-and-review";
  readonly subjectId: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly data: StartData;
}

interface ScenarioInput {
  readonly kind: string;
  readonly operationId?: string;
  readonly messageType?: string;
  readonly request?: {
    readonly body?: {
      readonly artifact?: ScenarioArtifact;
      readonly gateSetDigest?: ScenarioDigest;
    };
  };
  readonly body?: StartCommand;
}

interface ExpectedVerificationRun {
  readonly verificationRunId: string;
  readonly status: "REQUESTED" | "RUNNING" | "PASSED" | "FAILED" | "ABORTED";
  readonly failedGateIds?: readonly string[];
  readonly verifierId?: string;
  readonly evidenceBundleDigest?: ScenarioDigest;
}

interface ExpectedCompletionReview {
  readonly recommendation: "APPROVE" | "REQUEST_REVISION";
}

interface Scenario {
  readonly fixtureControls: {
    readonly gateExecutions?: readonly GateExecutionSpec[];
    readonly verifierAssignments?: Readonly<Record<string, string>>;
    readonly generatedIds?: Readonly<Record<string, string>>;
  };
  readonly identities: {
    readonly correlationId: string;
    readonly ids: Readonly<Record<string, string>>;
  };
  readonly inputs: readonly ScenarioInput[];
  readonly expected: {
    readonly finalState: {
      readonly verificationRuns: readonly ExpectedVerificationRun[];
      readonly completionReviews: readonly ExpectedCompletionReview[];
    };
  };
}

function loadScenario(id: string): Scenario {
  return JSON.parse(
    readFileSync(
      new URL(`../../../acceptance/scenarios/${id}.json`, import.meta.url),
      "utf8",
    ),
  ) as Scenario;
}

// The normative four-gate registry. ADR 0008 canonicalizes the full gate array
// and its SHA-256 is the portable gate-set identity. System-level fixtures
// declare only the gate IDs and outcomes plus that digest, so we rebuild the
// full gates here and prove equivalence by digest below.
const CANONICAL_GATES: Readonly<Record<string, AcceptanceGate>> = {
  "allowed-scope": {
    gateId: "allowed-scope",
    kind: "ALLOWED_SCOPE",
    commandId: "check-allowed-scope",
    mandatory: true,
    timeoutSeconds: 10,
    evidenceLimitBytes: 4096,
  },
  lint: {
    gateId: "lint",
    kind: "LINT",
    commandId: "check-lint",
    mandatory: true,
    timeoutSeconds: 30,
    evidenceLimitBytes: 8192,
  },
  typecheck: {
    gateId: "typecheck",
    kind: "TYPECHECK",
    commandId: "check-typecheck",
    mandatory: true,
    timeoutSeconds: 30,
    evidenceLimitBytes: 8192,
  },
  tests: {
    gateId: "tests",
    kind: "TEST",
    commandId: "check-tests",
    mandatory: true,
    timeoutSeconds: 60,
    evidenceLimitBytes: 16_384,
  },
};

const RECONSTRUCTED_ISSUED_AT = "2026-07-12T11:00:10.000Z";

/**
 * Reconstructs the exact `verification.start-verification.v1` command a fixture
 * describes. Verification-context fixtures carry the command directly as an
 * integration-message input; system-level fixtures declare the gates, artifact,
 * and immutable gate-set digest separately, so we rebuild the command and prove
 * the reconstructed gate set matches the fixture digest.
 */
function deriveStartCommand(scenario: Scenario): StartCommand {
  const messageInput = scenario.inputs.find(
    (input) =>
      input.kind === "integrationMessage" &&
      input.messageType === "verification.start-verification.v1" &&
      input.body !== undefined,
  );
  if (messageInput?.body) return structuredClone(messageInput.body);

  const executions = scenario.fixtureControls.gateExecutions ?? [];
  const gates = executions.map((spec) => {
    const gate = CANONICAL_GATES[spec.gateId];
    if (!gate)
      throw new Error(
        `fixture declares gate ${spec.gateId} outside the canonical registry`,
      );
    return gate;
  });

  const submit = scenario.inputs.find(
    (input) => input.operationId === "submitArtifact",
  );
  const artifact = submit?.request?.body?.artifact;
  const gateSetDigest = submit?.request?.body?.gateSetDigest;
  if (!artifact || !gateSetDigest)
    throw new Error(
      "system-level fixture is missing a submitted artifact and gate-set digest",
    );
  if (calculateGateSetDigest(gates).value !== gateSetDigest.value)
    throw new Error(
      "reconstructed gate set does not match the fixture gate-set digest",
    );

  const generated = scenario.fixtureControls.generatedIds ?? {};
  const runId = generated["verificationRunId"];
  if (!runId)
    throw new Error("system-level fixture has no generated verificationRunId");
  const missionId =
    generated["missionId"] ?? scenario.identities.ids["missionId"];
  const attemptId =
    generated["attemptId"] ?? scenario.identities.ids["attemptId"];
  const producingRunnerId = scenario.identities.ids["runnerId"];
  if (!missionId || !attemptId || !producingRunnerId)
    throw new Error(
      "system-level fixture is missing mission, attempt, or runner identity",
    );

  return {
    commandId: `command-start-${runId}`,
    commandType: "verification.start-verification.v1",
    schemaVersion: 1,
    issuedAt: RECONSTRUCTED_ISSUED_AT,
    issuer: "mission-control",
    recipient: "verification-and-review",
    subjectId: runId,
    correlationId: scenario.identities.correlationId,
    causationId: `artifact-submitted-${runId}`,
    data: {
      verificationRunId: runId,
      attemptId,
      producingRunnerId,
      binding: {
        missionId,
        missionRevision: 1,
        startingRevision: "fixture-shipping-v1",
        artifactDigest: artifact.digest,
        gateSetDigest,
      },
      artifact,
      acceptanceGates: gates,
    },
  };
}

function executionOutcome(
  name: GateOutcomeName,
  gate: AcceptanceGate,
): GateExecutionOutcome {
  switch (name) {
    case "PASS":
      return {
        kind: "COMPLETED",
        status: "PASS",
        exitCode: 0,
        durationMs: 10,
        evidence: `gate ${gate.gateId} passed on trusted inputs`,
      };
    case "FAIL":
      return {
        kind: "COMPLETED",
        status: "FAIL",
        exitCode: 1,
        durationMs: Math.min(25, gate.timeoutSeconds * 1000 - 1),
        evidence: `${gate.gateId}: a changed path is outside the trusted scope`,
      };
    case "TIMEOUT":
      return {
        kind: "COMPLETED",
        status: "TIMEOUT",
        exitCode: null,
        durationMs: gate.timeoutSeconds * 1000,
        evidence: `${gate.gateId} reached the configured timeout`,
      };
    case "INFRASTRUCTURE_UNAVAILABLE":
      return {
        kind: "INFRASTRUCTURE_FAILURE",
        retryable: true,
        detail: "infrastructure unavailable: ".padEnd(2500, "x"),
        diagnostic: "d".repeat(2500),
      };
  }
}

function outcomesByGate(
  scenario: Scenario,
  gates: readonly AcceptanceGate[],
): Map<string, GateExecutionOutcome> {
  const byId = new Map<string, AcceptanceGate>(
    gates.map((gate) => [gate.gateId, gate]),
  );
  const outcomes = new Map<string, GateExecutionOutcome>();
  for (const spec of scenario.fixtureControls.gateExecutions ?? []) {
    const gate = byId.get(spec.gateId);
    if (!gate)
      throw new Error(
        `fixture gate ${spec.gateId} is not part of the derived gate set`,
      );
    outcomes.set(spec.gateId, executionOutcome(spec.outcome, gate));
  }
  return outcomes;
}

function verifierAssignmentFor(
  scenario: Scenario,
  runId: string,
): VerifierAssignment | undefined {
  const verifierId = scenario.fixtureControls.verifierAssignments?.[runId];
  return verifierId === undefined
    ? undefined
    : { kind: "ASSIGNED", verifierId };
}

function expectedRun(scenario: Scenario): ExpectedVerificationRun {
  const run = scenario.expected.finalState.verificationRuns[0];
  if (!run) throw new Error("fixture declares no expected verification run");
  return run;
}

function expectedReview(scenario: Scenario): ExpectedCompletionReview {
  const review = scenario.expected.finalState.completionReviews[0];
  if (!review)
    throw new Error("fixture declares no expected completion review");
  return review;
}

function advance(requestId: string, start: StartCommand) {
  return {
    requestId,
    correlationId: start.correlationId,
    verificationRunId: start.data.verificationRunId,
  };
}

async function drainCheckpoints(
  useCases: VerificationUseCases,
  start: StartCommand,
  count: number,
) {
  let result = await useCases.executeNextCheckpoint(
    advance(`advance-${start.data.verificationRunId}-0`, start),
  );
  for (let index = 1; index < count; index += 1)
    result = await useCases.executeNextCheckpoint(
      advance(`advance-${start.data.verificationRunId}-${index}`, start),
    );
  return result;
}

function clone<Value>(value: Value | undefined): Value | undefined {
  return value === undefined ? undefined : structuredClone(value);
}

class MemoryVerificationUnit implements VerificationUnitOfWork {
  readonly runs = new Map<string, VerificationRunMementoV1>();
  readonly reviews = new Map<string, CompletionReviewMementoV1>();
  readonly inbox = new Map<string, string>();
  readonly semanticRuns = new Map<string, string>();
  readonly outbox: VerificationPublicEvent[] = [];
  readonly evidence = new Map<
    string,
    Readonly<{
      content: string;
      digest: { algorithm: "sha256"; value: string };
      bytes: number;
    }>
  >();
  readonly bundleInputs: EvidenceBundleInput[] = [];

  async execute<Result>(
    operation: (transaction: VerificationTransaction) => Promise<Result>,
  ): Promise<Result> {
    return operation({
      runs: {
        load: async (runId) => clone(this.runs.get(runId)),
        save: async (memento) => {
          this.runs.set(
            memento.seed.data.verificationRunId,
            structuredClone(memento),
          );
        },
      },
      reviews: {
        load: async (reviewId) => clone(this.reviews.get(reviewId)),
        create: async (memento) => {
          if (this.reviews.has(memento.seed.completionReviewId))
            throw new Error("completion review already exists");
          this.reviews.set(
            memento.seed.completionReviewId,
            structuredClone(memento),
          );
        },
      },
      inbox: {
        classify: async (messageId, fingerprint, semanticRun) => {
          const existing = this.inbox.get(messageId);
          if (existing !== undefined)
            return existing === fingerprint
              ? "EXACT_REDELIVERY"
              : "MESSAGE_ID_CONFLICT";
          if (semanticRun) {
            const semantic = this.semanticRuns.get(
              semanticRun.verificationRunId,
            );
            if (semantic !== undefined)
              return semantic === semanticRun.semanticFingerprint
                ? "SEMANTIC_RUN_DUPLICATE"
                : "SEMANTIC_RUN_CONFLICT";
          }
          return "UNSEEN";
        },
        recordProcessed: async (messageId, fingerprint, semanticRun) => {
          this.inbox.set(messageId, fingerprint);
          if (semanticRun)
            this.semanticRuns.set(
              semanticRun.verificationRunId,
              semanticRun.semanticFingerprint,
            );
        },
      },
      outbox: {
        append: async (message) => {
          this.outbox.push(structuredClone(message));
        },
      },
      evidence: {
        store: async (request) => {
          const bytes = Buffer.byteLength(request.content);
          const digest = {
            algorithm: "sha256" as const,
            value: createHash("sha256").update(request.content).digest("hex"),
          };
          this.evidence.set(request.checkpointKey, {
            content: request.content,
            digest,
            bytes,
          });
          return { digest, bytes };
        },
      },
      bundles: {
        build: async (input) => {
          this.bundleInputs.push(structuredClone(input));
          return {
            algorithm: "sha256",
            value: createHash("sha256")
              .update(JSON.stringify(input))
              .digest("hex"),
          };
        },
      },
    });
  }
}

type ExecutionRequest = Parameters<GateExecutorPort["execute"]>[0];
type WorkspaceRequest = Parameters<WorkspaceMaterializerPort["materialize"]>[0];

interface Trace {
  readonly assignments: unknown[];
  readonly workspaces: WorkspaceRequest[];
  readonly executions: ExecutionRequest[];
}

interface RuntimeOptions {
  readonly assignment?: VerifierAssignment | undefined;
  readonly workspace?: WorkspaceMaterialization | undefined;
  readonly outcomesByGate?:
    ReadonlyMap<string, GateExecutionOutcome> | undefined;
}

class StableIds {
  #next = 0;

  nextId(kind: Parameters<VerificationIdGenerator["nextId"]>[0]): string {
    this.#next += 1;
    return `private-${kind}-${this.#next}`;
  }
}

function runtime(
  unit = new MemoryVerificationUnit(),
  options: RuntimeOptions = {},
  trace: Trace = { assignments: [], workspaces: [], executions: [] },
  ids = new StableIds(),
) {
  const useCases = new VerificationUseCases({
    unitOfWork: unit,
    // Later than every fixture's command `issuedAt` so transition chronology
    // (a transition may not predate the accepted start command) always holds.
    clock: { now: () => new Date("2026-07-12T16:00:00.000Z") },
    ids: { nextId: (kind) => ids.nextId(kind) },
    assignments: {
      assign: async (request) => {
        trace.assignments.push(structuredClone(request));
        return (
          options.assignment ?? {
            kind: "ASSIGNED",
            verifierId: "verifier-independent",
          }
        );
      },
    },
    workspaces: {
      materialize: async (request) => {
        trace.workspaces.push(structuredClone(request));
        return (
          options.workspace ?? {
            kind: "AVAILABLE",
            workspace: { workspaceHandleId: "trusted-fixture-workspace" },
          }
        );
      },
    },
    executor: {
      execute: async (request) => {
        trace.executions.push(structuredClone(request));
        const mapped = options.outcomesByGate?.get(request.gate.gateId);
        return (
          mapped ?? {
            kind: "COMPLETED",
            status: "PASS",
            exitCode: 0,
            durationMs: 10,
            evidence: "gate passed",
          }
        );
      },
    },
  });
  return { unit, trace, ids, useCases };
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
        new URL(`../../../contracts/schemas/v1/${filename}`, import.meta.url),
        "utf8",
      ),
    ) as object,
  );

function schemaAccepts(definition: string, value: unknown): boolean {
  const validate = ajv.getSchema(
    `https://schemas.patchquest.example/contracts/v1/integration-messages.schema.json#/$defs/${definition}`,
  );
  if (!validate) throw new Error(`missing root schema ${definition}`);
  return validate(value) as boolean;
}

function expectPublicEventsAreRootSchemaValid(
  events: readonly VerificationPublicEvent[],
): void {
  const definitionByType = {
    "verification.passed.v1": "VerificationPassedV1",
    "verification.failed.v1": "VerificationFailedV1",
    "verification.aborted.v1": "VerificationAbortedV1",
    "review.recommendation-issued.v1": "ReviewRecommendationIssuedV1",
  } as const;
  for (const event of events)
    expect(schemaAccepts(definitionByType[event.eventType], event)).toBe(true);
}

describe("Phase 4C Verification application acceptance seams", () => {
  it("routes the forbidden-path fixture through all four canonical gates and owns its failed result", async () => {
    const scenario = loadScenario("forbidden-path");
    const start = deriveStartCommand(scenario);
    const gates = start.data.acceptanceGates;
    const failure = expectedRun(scenario);
    const review = expectedReview(scenario);

    // Fixture-drift guards: the reconstructed canonical gate set must match the
    // fixture's four declared gates and its immutable gate-set digest.
    expect(gates.map((gate) => gate.gateId).sort()).toEqual(
      (scenario.fixtureControls.gateExecutions ?? [])
        .map((spec) => spec.gateId)
        .sort(),
    );
    expect(calculateGateSetDigest(gates).value).toBe(
      start.data.binding.gateSetDigest.value,
    );
    expect(schemaAccepts("VerificationStartVerificationV1", start)).toBe(true);
    expect(Object.hasOwn(start.data, "allowedScope")).toBe(false);
    expect(Object.hasOwn(start.data, "workspaceReference")).toBe(false);

    const h = runtime(undefined, {
      assignment: verifierAssignmentFor(scenario, start.data.verificationRunId),
      outcomesByGate: outcomesByGate(scenario, gates),
    });
    const started = await h.useCases.handleStartVerification(start);
    expect(started).toMatchObject({
      ok: true,
      value: {
        assignment: "ASSIGNED",
        snapshot: { status: "RUNNING", nextGateId: "allowed-scope" },
      },
    });

    const completed = await drainCheckpoints(h.useCases, start, gates.length);
    expect(completed).toMatchObject({
      ok: true,
      value: {
        status: failure.status,
        terminalOutcome: {
          verdict: "FAILED",
          failedGateIds: failure.failedGateIds,
        },
      },
      events: [
        {
          eventType: "verification.failed.v1",
          data: { failedGateIds: failure.failedGateIds },
        },
        {
          eventType: "review.recommendation-issued.v1",
          data: { recommendation: review.recommendation },
        },
      ],
    });

    const changedPaths = start.data.artifact.changedPaths;
    expect(h.trace.workspaces).toHaveLength(gates.length);
    for (const request of h.trace.workspaces)
      expect(request.artifact.changedPaths).toEqual(changedPaths);
    expect(h.trace.executions).toHaveLength(gates.length);
    expect(h.trace.executions[0]).toMatchObject({
      gate: { gateId: "allowed-scope" },
      commandId: "check-allowed-scope",
      workspace: { workspaceHandleId: "trusted-fixture-workspace" },
    });
    const execution = h.trace.executions[0];
    expect(execution && Object.hasOwn(execution, "allowedScope")).toBe(false);
    expect(execution && Object.hasOwn(execution, "workspaceReference")).toBe(
      false,
    );
    expect(execution && Object.hasOwn(execution, "changedPaths")).toBe(false);
    expect([...h.unit.evidence.values()][0]?.content).toContain(
      "outside the trusted scope",
    );
    const bundle = h.unit.bundleInputs[0];
    expect(bundle?.kind).toBe("VERIFICATION");
    expect(bundle?.kind === "VERIFICATION" ? bundle.results : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ gateId: "allowed-scope", status: "FAIL" }),
      ]),
    );
    expect(h.unit.reviews).toHaveLength(1);
    if (completed.ok) expectPublicEventsAreRootSchemaValid(completed.events);

    // Trusted-result routing seam. Resolving allowedScope and evaluating the
    // changed paths in a live workspace remain Phase 6 work.
  });

  it("turns the failed-mandatory-gate fixture timeout into FAILED with bounded evidence", async () => {
    const scenario = loadScenario("failed-mandatory-gate");
    const start = deriveStartCommand(scenario);
    const gates = start.data.acceptanceGates;
    const failure = expectedRun(scenario);
    const review = expectedReview(scenario);

    const h = runtime(undefined, {
      assignment: verifierAssignmentFor(scenario, start.data.verificationRunId),
      outcomesByGate: outcomesByGate(scenario, gates),
    });
    await h.useCases.handleStartVerification(start);
    const completed = await drainCheckpoints(h.useCases, start, gates.length);

    expect(completed).toMatchObject({
      ok: true,
      value: {
        status: failure.status,
        results: [{ gateId: "tests", status: "TIMEOUT", exitCode: null }],
      },
      events: [
        {
          eventType: "verification.failed.v1",
          data: { failedGateIds: failure.failedGateIds },
        },
        {
          eventType: "review.recommendation-issued.v1",
          data: { recommendation: review.recommendation },
        },
      ],
    });
    expect([...h.unit.evidence.values()][0]).toMatchObject({
      content: "tests reached the configured timeout",
    });
    expect(h.unit.bundleInputs).toMatchObject([
      {
        kind: "VERIFICATION",
        results: [{ gateId: "tests", status: "TIMEOUT" }],
      },
    ]);
    if (completed.ok) expectPublicEventsAreRootSchemaValid(completed.events);
  });

  it("rejects the producing runner as verifier from the self-verification fixture", async () => {
    const scenario = loadScenario("self-verification-rejected");
    const start = deriveStartCommand(scenario);
    const assignment = verifierAssignmentFor(
      scenario,
      start.data.verificationRunId,
    );
    // The fixture assigns the producing runner as verifier.
    expect(assignment).toMatchObject({
      kind: "ASSIGNED",
      verifierId: start.data.producingRunnerId,
    });

    const h = runtime(undefined, { assignment });
    const result = await h.useCases.handleStartVerification(start);

    expect(result).toMatchObject({
      ok: true,
      value: { assignment: "ABORTED", snapshot: { status: "ABORTED" } },
      events: [
        {
          eventType: "verification.aborted.v1",
          data: { reason: "VERIFIER_UNAVAILABLE", retryable: true },
        },
      ],
    });
    expect(h.trace.workspaces).toHaveLength(0);
    expect(h.trace.executions).toHaveLength(0);
    expect(h.unit.reviews).toHaveLength(0);
    if (result.ok) expectPublicEventsAreRootSchemaValid(result.events);
  });

  it("aborts on the infrastructure-abort fixture with bounded diagnostics and no review", async () => {
    const scenario = loadScenario("verification-infrastructure-aborted");
    const start = deriveStartCommand(scenario);
    const gates = start.data.acceptanceGates;
    const aborted = expectedRun(scenario);

    const h = runtime(undefined, {
      assignment: verifierAssignmentFor(scenario, start.data.verificationRunId),
      outcomesByGate: outcomesByGate(scenario, gates),
    });
    await h.useCases.handleStartVerification(start);
    const result = await h.useCases.executeNextCheckpoint(
      advance("advance-infrastructure-abort", start),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: aborted.status,
        terminalOutcome: {
          reason: "EXECUTION_INFRASTRUCTURE_FAILURE",
          retryable: true,
        },
      },
      events: [
        {
          eventType: "verification.aborted.v1",
          data: {
            reason: "EXECUTION_INFRASTRUCTURE_FAILURE",
            retryable: true,
            evidenceBundleDigest: {
              algorithm: "sha256",
              value: expect.stringMatching(/^[a-f0-9]{64}$/),
            },
          },
        },
      ],
    });
    expect(aborted.evidenceBundleDigest).toBeDefined();
    expect(h.unit.bundleInputs).toHaveLength(1);
    expect(h.unit.bundleInputs[0]).toMatchObject({
      kind: "ABORT",
      reason: "EXECUTION_INFRASTRUCTURE_FAILURE",
    });
    expect(
      h.unit.bundleInputs[0]?.kind === "ABORT"
        ? h.unit.bundleInputs[0].diagnostic
        : "",
    ).toHaveLength(2000);
    const abortEvent = result.ok ? result.events[0] : undefined;
    expect(
      abortEvent?.eventType === "verification.aborted.v1"
        ? abortEvent.data.detail
        : "",
    ).toHaveLength(2000);
    expect(h.unit.evidence).toHaveLength(0);
    expect(h.unit.reviews).toHaveLength(0);
    if (result.ok) expectPublicEventsAreRootSchemaValid(result.events);
  });

  it("keeps WORKSPACE_UNAVAILABLE retryable and MISSION_CANCELLED nonretryable without reviews", async () => {
    // No canonical fixture drives a workspace outage or a private cancellation
    // at this seam, so the start command is derived from the failed-gate fixture
    // and the workspace/cancellation behavior is exercised directly.
    const scenario = loadScenario("failed-mandatory-gate");
    const base = deriveStartCommand(scenario);
    const assignment = verifierAssignmentFor(
      scenario,
      base.data.verificationRunId,
    );

    const unavailable = runtime(undefined, {
      assignment,
      workspace: {
        kind: "UNAVAILABLE",
        retryable: true,
        detail: "trusted workspace is not ready",
        diagnostic: "materializer diagnostic",
      },
    });
    await unavailable.useCases.handleStartVerification(base);
    const workspaceAbort = await unavailable.useCases.executeNextCheckpoint(
      advance("advance-workspace-abort", base),
    );
    expect(workspaceAbort).toMatchObject({
      ok: true,
      events: [
        {
          eventType: "verification.aborted.v1",
          data: { reason: "WORKSPACE_UNAVAILABLE", retryable: true },
        },
      ],
    });
    expect(unavailable.trace.executions).toHaveLength(0);
    expect(unavailable.unit.reviews).toHaveLength(0);

    const cancelled = runtime(undefined, { assignment });
    await cancelled.useCases.handleStartVerification(base);
    const missionAbort = await cancelled.useCases.abortVerification({
      ...advance("cancel-mission", base),
      reason: "MISSION_CANCELLED",
    });
    expect(missionAbort).toMatchObject({
      ok: true,
      events: [
        {
          eventType: "verification.aborted.v1",
          data: { reason: "MISSION_CANCELLED", retryable: false },
        },
      ],
    });
    expect(cancelled.trace.executions).toHaveLength(0);
    expect(cancelled.unit.reviews).toHaveLength(0);
    if (workspaceAbort.ok)
      expectPublicEventsAreRootSchemaValid(workspaceAbort.events);
    if (missionAbort.ok)
      expectPublicEventsAreRootSchemaValid(missionAbort.events);
  });

  it("redelivers exact and semantic starts from the verifier-retry fixture without repeating work", async () => {
    const scenario = loadScenario("verifier-retry-idempotency");
    const start = deriveStartCommand(scenario);
    const gates = start.data.acceptanceGates;
    const h = runtime(undefined, {
      assignment: verifierAssignmentFor(scenario, start.data.verificationRunId),
      outcomesByGate: outcomesByGate(scenario, gates),
    });
    await h.useCases.handleStartVerification(start);
    await drainCheckpoints(h.useCases, start, gates.length);

    const exact = await h.useCases.handleStartVerification(start);
    const semantic = await h.useCases.handleStartVerification({
      ...structuredClone(start),
      commandId: `${start.commandId}-redelivery`,
      issuedAt: "2026-07-12T15:00:11.000Z",
    });
    const conflict = await h.useCases.handleStartVerification({
      ...structuredClone(start),
      commandId: `${start.commandId}-conflict`,
      issuedAt: "2026-07-12T15:00:12.000Z",
      data: { ...structuredClone(start.data), attemptId: "attempt-other" },
    });

    expect(exact).toMatchObject({
      ok: true,
      disposition: "idempotent",
      value: { snapshot: { status: "PASSED" } },
      events: [],
    });
    expect(semantic).toMatchObject({
      ok: true,
      disposition: "idempotent",
      value: { snapshot: { status: "PASSED" } },
      events: [],
    });
    expect(conflict).toMatchObject({
      ok: false,
      error: { code: "RUN_ID_CONFLICT" },
    });
    expect(h.trace.assignments).toHaveLength(1);
    expect(h.trace.executions).toHaveLength(gates.length);
    expect(h.unit.outbox).toHaveLength(2);
  });

  it("publishes PASSED before APPROVE for the happy-completion fixture with the verdict causation chain", async () => {
    const scenario = loadScenario("happy-completion");
    const start = deriveStartCommand(scenario);
    const gates = start.data.acceptanceGates;
    const passing = expectedRun(scenario);
    const review = expectedReview(scenario);
    expect(schemaAccepts("VerificationStartVerificationV1", start)).toBe(true);

    const h = runtime(undefined, {
      assignment: verifierAssignmentFor(scenario, start.data.verificationRunId),
      outcomesByGate: outcomesByGate(scenario, gates),
    });
    await h.useCases.handleStartVerification(start);
    const completed = await drainCheckpoints(h.useCases, start, gates.length);

    expect(completed).toMatchObject({
      ok: true,
      value: { status: passing.status },
      events: [
        {
          eventType: "verification.passed.v1",
          causationId: start.commandId,
          data: { verdict: "PASSED" },
        },
        {
          eventType: "review.recommendation-issued.v1",
          data: { verdict: "PASSED", recommendation: review.recommendation },
        },
      ],
    });
    if (!completed.ok) return;
    expect(completed.events[1]?.causationId).toBe(completed.events[0]?.eventId);
    expect(h.unit.outbox.map((event) => event.eventType)).toEqual([
      "verification.passed.v1",
      "review.recommendation-issued.v1",
    ]);
    expectPublicEventsAreRootSchemaValid(completed.events);
  });

  it("resumes the happy-completion checkpoints after a response-loss retry without repeating a committed gate", async () => {
    const scenario = loadScenario("happy-completion");
    const start = deriveStartCommand(scenario);
    const gates = start.data.acceptanceGates;
    const unit = new MemoryVerificationUnit();
    const trace: Trace = { assignments: [], workspaces: [], executions: [] };
    const ids = new StableIds();
    const options: RuntimeOptions = {
      assignment: verifierAssignmentFor(scenario, start.data.verificationRunId),
      outcomesByGate: outcomesByGate(scenario, gates),
    };
    const orderedGateIds = [...gates]
      .map((gate) => gate.gateId)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

    const firstRuntime = runtime(unit, options, trace, ids);
    await firstRuntime.useCases.handleStartVerification(start);
    const lostResponse = await firstRuntime.useCases.executeNextCheckpoint(
      advance("advance-checkpoint-one", start),
    );
    expect(lostResponse).toMatchObject({
      ok: true,
      value: {
        status: "RUNNING",
        completedGateCount: 1,
        nextGateId: orderedGateIds[1],
      },
    });
    expect(trace.executions).toMatchObject([
      { gate: { gateId: orderedGateIds[0] } },
    ]);

    const restarted = runtime(unit, options, trace, ids);
    const retried = await restarted.useCases.executeNextCheckpoint(
      advance("advance-checkpoint-one", start),
    );
    expect(retried).toMatchObject({
      ok: true,
      disposition: "idempotent",
      value: { completedGateCount: 1, nextGateId: orderedGateIds[1] },
      events: [],
    });
    expect(trace.executions).toHaveLength(1);

    let completed = retried;
    for (let index = 1; index < gates.length; index += 1)
      completed = await restarted.useCases.executeNextCheckpoint(
        advance(`advance-checkpoint-${index + 1}`, start),
      );
    expect(completed).toMatchObject({
      ok: true,
      value: { status: "PASSED", completedGateCount: gates.length },
    });
    expect(trace.executions.map((request) => request.gate.gateId)).toEqual(
      orderedGateIds,
    );
    const persisted = unit.runs.get(start.data.verificationRunId);
    expect(trace.executions.map((request) => request.idempotencyKey)).toEqual(
      persisted?.checkpoints.map((checkpoint) => checkpoint.checkpointKey),
    );
    expect(
      new Set(trace.executions.map((request) => request.idempotencyKey)),
    ).toHaveLength(gates.length);
    expect(
      trace.executions.every((request) =>
        /^checkpoint:[a-f0-9]{64}$/.test(request.idempotencyKey),
      ),
    ).toBe(true);
    if (completed.ok) expectPublicEventsAreRootSchemaValid(completed.events);
  });
});
