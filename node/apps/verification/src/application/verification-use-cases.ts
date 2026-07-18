import { createHash } from "node:crypto";
import {
  CompletionReview,
  type CompletionReviewMementoV1,
} from "../domain/completion-review.js";
import {
  VerificationRun,
  type AbortReason,
  type VerificationDomainEvent,
  type VerificationErrorCode,
  type VerificationRunMementoV1,
  type VerificationSnapshot,
} from "../domain/verification-run.js";
import {
  createVerificationPublicEvent,
  type VerificationPublicEvent,
} from "./outgoing-message-factory.js";
import type {
  AuthoritativeClock,
  VerificationIdGenerator,
  VerificationTransaction,
  VerificationUnitOfWork,
  VerifierAssignment,
  VerifierAssignmentPort,
  WorkspaceMaterialization,
  WorkspaceMaterializerPort,
  GateExecutionOutcome,
  GateExecutorPort,
  InboxClassification,
  TrustedWorkspaceHandle,
} from "./ports.js";
import {
  translateAbortVerification,
  translateAdvanceVerification,
  translateAssignmentRequest,
  translateStartVerification,
  type AssignmentRequest,
} from "./translators.js";
import {
  isBoundedText,
  hasExactKeys,
  hasJsonTopology,
  isIdentifier,
  isJsonObject,
  isSha256Digest,
  jsonFingerprint,
} from "./message-validation.js";

export type VerificationApplicationErrorCode =
  | VerificationErrorCode
  | "CONTRACT_INVALID"
  | "PRIVATE_INPUT_INVALID"
  | "MESSAGE_ID_CONFLICT"
  | "RUN_ID_CONFLICT"
  | "RUN_NOT_FOUND"
  | "CORRELATION_MISMATCH"
  | "REVIEW_ID_CONFLICT"
  | "INCONSISTENT_REDELIVERY"
  | "OUTGOING_MESSAGE_INVALID"
  | "PORT_RESULT_INVALID"
  | "VERIFIER_IDENTITY_UNAVAILABLE";

export type VerificationApplicationResult<Value = undefined> =
  | Readonly<{
      ok: true;
      disposition: "applied" | "idempotent";
      value: Value;
      events: readonly VerificationPublicEvent[];
    }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: VerificationApplicationErrorCode;
        message: string;
      }>;
    }>;

export interface StartVerificationOutcome {
  readonly snapshot: VerificationSnapshot;
  readonly assignment: "ASSIGNED" | "ABORTED";
}

type CommittedVerifierIdentityFailure = Readonly<{
  committedError: "VERIFIER_IDENTITY_UNAVAILABLE";
}>;

const committedVerifierIdentityFailure: CommittedVerifierIdentityFailure =
  Object.freeze({ committedError: "VERIFIER_IDENTITY_UNAVAILABLE" });

function verifierIdentityUnavailable<
  Value,
>(): VerificationApplicationResult<Value> {
  return failed(
    "VERIFIER_IDENTITY_UNAVAILABLE",
    "The assignment provider could not identify a verifier.",
  );
}

function failed<Value>(
  code: VerificationApplicationErrorCode,
  message: string,
): VerificationApplicationResult<Value> {
  return { ok: false, error: { code, message } };
}

function isExactPortObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Readonly<Record<string, unknown>> {
  return (
    isJsonObject(value) &&
    hasJsonTopology(value) &&
    hasExactKeys(value, required, optional)
  );
}

function hasPortJsonTopology(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return isJsonObject(value) && hasJsonTopology(value);
}

function isVerifierAssignment(value: unknown): value is VerifierAssignment {
  if (!hasPortJsonTopology(value)) return false;
  if (value["kind"] === "UNIDENTIFIED_FAILURE")
    return isExactPortObject(value, ["kind"]);
  if (
    value["kind"] === "ASSIGNED" &&
    isExactPortObject(value, ["kind", "verifierId"])
  )
    return isIdentifier(value["verifierId"]);
  return (
    value["kind"] === "UNAVAILABLE" &&
    isExactPortObject(value, ["kind", "verifierId", "retryable"]) &&
    isIdentifier(value["verifierId"]) &&
    typeof value["retryable"] === "boolean"
  );
}

function hasOptionalDiagnosticText(
  value: Readonly<Record<string, unknown>>,
): boolean {
  return (
    (value["detail"] === undefined || typeof value["detail"] === "string") &&
    (value["diagnostic"] === undefined ||
      typeof value["diagnostic"] === "string")
  );
}

function isTrustedWorkspaceHandle(
  value: unknown,
): value is TrustedWorkspaceHandle {
  return (
    isExactPortObject(value, ["workspaceHandleId"]) &&
    isIdentifier(value["workspaceHandleId"])
  );
}

function isWorkspaceMaterialization(
  value: unknown,
): value is WorkspaceMaterialization {
  if (!hasPortJsonTopology(value)) return false;
  if (
    value["kind"] === "AVAILABLE" &&
    isExactPortObject(value, ["kind", "workspace"])
  )
    return isTrustedWorkspaceHandle(value["workspace"]);
  return (
    value["kind"] === "UNAVAILABLE" &&
    isExactPortObject(value, ["kind", "retryable"], ["detail", "diagnostic"]) &&
    typeof value["retryable"] === "boolean" &&
    hasOptionalDiagnosticText(value)
  );
}

function isGateExecutionOutcome(
  value: unknown,
  gate: Readonly<{
    timeoutSeconds: number;
    evidenceLimitBytes: number;
  }>,
): value is GateExecutionOutcome {
  if (!hasPortJsonTopology(value)) return false;
  if (value["kind"] === "COMPLETED") {
    if (
      !isExactPortObject(value, [
        "kind",
        "status",
        "exitCode",
        "durationMs",
        "evidence",
      ]) ||
      !Number.isSafeInteger(value["durationMs"]) ||
      Number(value["durationMs"]) < 0 ||
      typeof value["evidence"] !== "string" ||
      Buffer.byteLength(value["evidence"], "utf8") > gate.evidenceLimitBytes
    )
      return false;
    const durationMs = Number(value["durationMs"]);
    const timeoutMs = gate.timeoutSeconds * 1000;
    if (value["status"] === "PASS")
      return value["exitCode"] === 0 && durationMs < timeoutMs;
    if (value["status"] === "FAIL")
      return (
        Number.isSafeInteger(value["exitCode"]) &&
        Number(value["exitCode"]) !== 0 &&
        durationMs < timeoutMs
      );
    return (
      value["status"] === "TIMEOUT" &&
      value["exitCode"] === null &&
      durationMs >= timeoutMs
    );
  }
  return (
    (value["kind"] === "VERIFIER_UNAVAILABLE" ||
      value["kind"] === "INFRASTRUCTURE_FAILURE") &&
    isExactPortObject(value, ["kind", "retryable"], ["detail", "diagnostic"]) &&
    typeof value["retryable"] === "boolean" &&
    hasOptionalDiagnosticText(value)
  );
}

function isEvidenceReceipt(
  value: unknown,
  limitBytes: number,
  expectedDigest: Readonly<{ algorithm: "sha256"; value: string }>,
  expectedBytes: number,
): value is Readonly<{
  digest: Readonly<{ algorithm: "sha256"; value: string }>;
  bytes: number;
}> {
  return (
    isExactPortObject(value, ["digest", "bytes"]) &&
    isSha256Digest(value["digest"]) &&
    Number.isSafeInteger(value["bytes"]) &&
    Number(value["bytes"]) === expectedBytes &&
    expectedBytes <= limitBytes &&
    value["digest"].algorithm === expectedDigest.algorithm &&
    value["digest"].value === expectedDigest.value
  );
}

function isInboxClassification(value: unknown): value is InboxClassification {
  return (
    typeof value === "string" &&
    [
      "UNSEEN",
      "EXACT_REDELIVERY",
      "MESSAGE_ID_CONFLICT",
      "SEMANTIC_RUN_DUPLICATE",
      "SEMANTIC_RUN_CONFLICT",
    ].includes(value)
  );
}

export class VerificationUseCases {
  readonly #unitOfWork: VerificationUnitOfWork;
  readonly #clock: AuthoritativeClock;
  readonly #ids: VerificationIdGenerator;
  readonly #assignments: VerifierAssignmentPort;
  readonly #workspaces: WorkspaceMaterializerPort;
  readonly #executor: GateExecutorPort;

  constructor(
    dependencies: Readonly<{
      unitOfWork: VerificationUnitOfWork;
      clock: AuthoritativeClock;
      ids: VerificationIdGenerator;
      assignments: VerifierAssignmentPort;
      workspaces: WorkspaceMaterializerPort;
      executor: GateExecutorPort;
    }>,
  ) {
    this.#unitOfWork = dependencies.unitOfWork;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#assignments = dependencies.assignments;
    this.#workspaces = dependencies.workspaces;
    this.#executor = dependencies.executor;
  }

  async handleStartVerification(
    message: unknown,
  ): Promise<VerificationApplicationResult<StartVerificationOutcome>> {
    const translated = translateStartVerification(message);
    if (!translated.ok)
      return failed(translated.error.code, translated.error.message);
    const { seed, deliveryFingerprint, semanticFingerprint } = translated.value;
    const result = await this.#unitOfWork.execute<
      | VerificationApplicationResult<StartVerificationOutcome>
      | CommittedVerifierIdentityFailure
    >(async (transaction) => {
      const classification = await transaction.inbox.classify(
        seed.commandId,
        deliveryFingerprint,
        {
          verificationRunId: seed.data.verificationRunId,
          semanticFingerprint,
        },
      );
      if (!isInboxClassification(classification))
        return failed(
          "PORT_RESULT_INVALID",
          "The inbox returned an invalid classification.",
        );
      if (classification === "MESSAGE_ID_CONFLICT")
        return failed(
          "MESSAGE_ID_CONFLICT",
          "The command ID already names different content.",
        );
      if (classification === "SEMANTIC_RUN_CONFLICT")
        return failed(
          "RUN_ID_CONFLICT",
          "The verification run ID already names different work.",
        );
      const stored = await transaction.runs.load(seed.data.verificationRunId);
      if (
        classification === "EXACT_REDELIVERY" ||
        classification === "SEMANTIC_RUN_DUPLICATE"
      ) {
        if (!stored)
          return failed(
            "INCONSISTENT_REDELIVERY",
            "The processed command has no corresponding verification run.",
          );
        const restored = VerificationRun.rehydrate(stored);
        if (!restored.ok)
          return failed(restored.error.code, restored.error.message);
        const comparison = restored.value.compareStart(seed);
        if (
          (classification === "EXACT_REDELIVERY" &&
            comparison !== "EXACT_DELIVERY_DUPLICATE") ||
          (classification === "SEMANTIC_RUN_DUPLICATE" &&
            comparison !== "SEMANTIC_DUPLICATE" &&
            comparison !== "EXACT_DELIVERY_DUPLICATE")
        )
          return failed(
            comparison === "MESSAGE_ID_CONFLICT"
              ? "MESSAGE_ID_CONFLICT"
              : "RUN_ID_CONFLICT",
            "Inbox classification disagrees with the immutable verification seed.",
          );
        if (classification === "SEMANTIC_RUN_DUPLICATE")
          await transaction.inbox.recordProcessed(
            seed.commandId,
            deliveryFingerprint,
            {
              verificationRunId: seed.data.verificationRunId,
              semanticFingerprint,
            },
          );
        if (restored.value.snapshot.status === "REQUESTED")
          return committedVerifierIdentityFailure;
        return this.#startSuccess("idempotent", restored.value, []);
      }
      if (stored) {
        const restored = VerificationRun.rehydrate(stored);
        if (!restored.ok)
          return failed(restored.error.code, restored.error.message);
        const comparison = restored.value.compareStart(seed);
        if (comparison === "MESSAGE_ID_CONFLICT")
          return failed(
            "MESSAGE_ID_CONFLICT",
            "The command ID already names different content.",
          );
        if (comparison === "RUN_ID_CONFLICT" || comparison === "INVALID")
          return failed(
            "RUN_ID_CONFLICT",
            "The verification run ID already names different work.",
          );
        await transaction.inbox.recordProcessed(
          seed.commandId,
          deliveryFingerprint,
          {
            verificationRunId: seed.data.verificationRunId,
            semanticFingerprint,
          },
        );
        if (restored.value.snapshot.status === "REQUESTED")
          return committedVerifierIdentityFailure;
        return this.#startSuccess("idempotent", restored.value, []);
      }
      const started = VerificationRun.start(seed);
      if (!started.ok) return failed(started.error.code, started.error.message);
      const run = started.value;
      const assignment = await this.#assign(run);
      if (!assignment.ok) {
        if (assignment.error.code !== "VERIFIER_IDENTITY_UNAVAILABLE")
          return assignment;
        await transaction.runs.save(run.toMemento());
        await transaction.inbox.recordProcessed(
          seed.commandId,
          deliveryFingerprint,
          {
            verificationRunId: seed.data.verificationRunId,
            semanticFingerprint,
          },
        );
        return committedVerifierIdentityFailure;
      }
      const outgoing = this.#buildEvents(assignment.events);
      if (!outgoing.ok) return outgoing;
      await transaction.runs.save(run.toMemento());
      for (const event of outgoing.value)
        await transaction.outbox.append(event);
      await transaction.inbox.recordProcessed(
        seed.commandId,
        deliveryFingerprint,
        {
          verificationRunId: seed.data.verificationRunId,
          semanticFingerprint,
        },
      );
      return {
        ok: true,
        disposition: "applied",
        value: {
          snapshot: run.snapshot,
          assignment:
            run.snapshot.status === "RUNNING" ? "ASSIGNED" : "ABORTED",
        },
        events: outgoing.value,
      };
    });
    return "committedError" in result
      ? verifierIdentityUnavailable<StartVerificationOutcome>()
      : result;
  }

  async retryVerifierAssignment(
    message: unknown,
  ): Promise<
    VerificationApplicationResult<StartVerificationOutcome | undefined>
  > {
    const translated = translateAssignmentRequest(message);
    if (!translated.ok)
      return failed(translated.error.code, translated.error.message);
    const input = translated.value;
    const fingerprint = jsonFingerprint(input);
    const result = await this.#unitOfWork.execute<
      | VerificationApplicationResult<StartVerificationOutcome | undefined>
      | CommittedVerifierIdentityFailure
    >(async (transaction) => {
      const duplicate = await this.#privateDuplicate<StartVerificationOutcome>(
        transaction,
        input,
        fingerprint,
        (run) => {
          const snapshot = run.snapshot;
          return {
            snapshot,
            assignment: snapshot.status === "RUNNING" ? "ASSIGNED" : "ABORTED",
          };
        },
      );
      if (duplicate) {
        if (duplicate.ok && duplicate.value?.snapshot.status === "REQUESTED")
          return committedVerifierIdentityFailure;
        return duplicate;
      }
      const loaded = await this.#load(transaction, input.verificationRunId);
      if (!loaded.ok) return loaded;
      const correlationError = this.#correlationError(loaded.value, input);
      if (correlationError) return correlationError;
      if (loaded.value.snapshot.status !== "REQUESTED")
        return failed(
          loaded.value.snapshot.status === "PASSED" ||
            loaded.value.snapshot.status === "FAILED" ||
            loaded.value.snapshot.status === "ABORTED"
            ? "RUN_TERMINAL"
            : "UNSUPPORTED_TRANSITION",
          "Only a requested verification run may retry assignment.",
        );
      const assignment = await this.#assign(loaded.value);
      if (!assignment.ok) {
        if (assignment.error.code !== "VERIFIER_IDENTITY_UNAVAILABLE")
          return assignment;
        await transaction.runs.save(loaded.value.toMemento());
        await transaction.inbox.recordProcessed(input.requestId, fingerprint);
        return committedVerifierIdentityFailure;
      }
      const outgoing = this.#buildEvents(assignment.events);
      if (!outgoing.ok) return outgoing;
      await transaction.runs.save(loaded.value.toMemento());
      for (const event of outgoing.value)
        await transaction.outbox.append(event);
      await transaction.inbox.recordProcessed(input.requestId, fingerprint);
      const assignedSnapshot: VerificationSnapshot = loaded.value.snapshot;
      return {
        ok: true,
        disposition: "applied",
        value: {
          snapshot: assignedSnapshot,
          assignment:
            assignedSnapshot.status === "RUNNING" ? "ASSIGNED" : "ABORTED",
        },
        events: outgoing.value,
      };
    });
    return "committedError" in result
      ? verifierIdentityUnavailable<StartVerificationOutcome | undefined>()
      : result;
  }

  async executeNextCheckpoint(
    message: unknown,
  ): Promise<VerificationApplicationResult<VerificationSnapshot | undefined>> {
    const translated = translateAdvanceVerification(message);
    if (!translated.ok)
      return failed(translated.error.code, translated.error.message);
    const input = translated.value;
    const fingerprint = jsonFingerprint(input);
    return this.#unitOfWork.execute(async (transaction) => {
      const duplicate = await this.#privateDuplicate<VerificationSnapshot>(
        transaction,
        input,
        fingerprint,
        (run) => run.snapshot,
      );
      if (duplicate) return duplicate;
      const loaded = await this.#load(transaction, input.verificationRunId);
      if (!loaded.ok) return loaded;
      const correlationError = this.#correlationError(loaded.value, input);
      if (correlationError) return correlationError;
      const run = loaded.value;
      const snapshot = run.snapshot;
      if (snapshot.status !== "RUNNING" || !snapshot.verifierId)
        return failed(
          ["PASSED", "FAILED", "ABORTED"].includes(snapshot.status)
            ? "RUN_TERMINAL"
            : "UNSUPPORTED_TRANSITION",
          "Only a running verification with a known verifier may execute a gate.",
        );
      const memento = run.toMemento();
      const next = run.resumeState;
      if (!next.nextGate || !next.checkpointKey)
        return failed(
          "CHECKS_INCOMPLETE",
          "The run has no missing checkpoint to execute.",
        );

      const materialized = await this.#workspaces.materialize({
        binding: memento.seed.data.binding,
        artifact: memento.seed.data.artifact,
      });
      if (!isWorkspaceMaterialization(materialized))
        return failed(
          "PORT_RESULT_INVALID",
          "The workspace materializer returned an invalid result.",
        );
      if (materialized.kind === "UNAVAILABLE")
        return this.#abortFromFailure(
          transaction,
          run,
          input,
          fingerprint,
          "WORKSPACE_UNAVAILABLE",
          materialized.retryable,
          materialized.detail,
          materialized.diagnostic,
        );

      const executed = await this.#executor.execute({
        verificationRunId: snapshot.verificationRunId,
        verifierId: snapshot.verifierId,
        workspace: materialized.workspace,
        gate: next.nextGate,
        commandId: next.nextGate.commandId,
        idempotencyKey: next.checkpointKey,
      });
      if (!isGateExecutionOutcome(executed, next.nextGate))
        return failed(
          "PORT_RESULT_INVALID",
          "The gate executor returned an invalid result.",
        );
      if (executed.kind !== "COMPLETED")
        return this.#abortFromFailure(
          transaction,
          run,
          input,
          fingerprint,
          executed.kind === "VERIFIER_UNAVAILABLE"
            ? "VERIFIER_UNAVAILABLE"
            : "EXECUTION_INFRASTRUCTURE_FAILURE",
          executed.retryable,
          executed.detail,
          executed.diagnostic,
        );

      const evidenceBytes = Buffer.byteLength(executed.evidence, "utf8");
      const evidenceDigest = {
        algorithm: "sha256" as const,
        value: createHash("sha256")
          .update(executed.evidence, "utf8")
          .digest("hex"),
      };
      if (evidenceBytes > next.nextGate.evidenceLimitBytes)
        return failed(
          "PORT_RESULT_INVALID",
          "The gate executor returned oversized evidence.",
        );

      const storedEvidence = await transaction.evidence.store({
        verificationRunId: snapshot.verificationRunId,
        gateId: next.nextGate.gateId,
        checkpointKey: next.checkpointKey,
        content: executed.evidence,
        limitBytes: next.nextGate.evidenceLimitBytes,
      });
      if (
        !isEvidenceReceipt(
          storedEvidence,
          next.nextGate.evidenceLimitBytes,
          evidenceDigest,
          evidenceBytes,
        )
      )
        return failed(
          "PORT_RESULT_INVALID",
          "The evidence store returned an invalid receipt.",
        );

      const recorded = run.recordCheckResult({
        requestId: this.#ids.nextId("check-result"),
        at: this.#now(),
        checkpointKey: next.checkpointKey,
        result: {
          gateId: next.nextGate.gateId,
          commandId: next.nextGate.commandId,
          status: executed.status,
          exitCode: executed.exitCode,
          durationMs: executed.durationMs,
          evidenceDigest,
          evidenceBytes,
        },
      });
      if (!recorded.ok)
        return failed(recorded.error.code, recorded.error.message);

      if (run.resumeState.nextGate) {
        await transaction.runs.save(run.toMemento());
        await transaction.inbox.recordProcessed(input.requestId, fingerprint);
        return {
          ok: true,
          disposition: recorded.disposition,
          value: run.snapshot,
          events: [],
        };
      }

      const bundleDigest = await transaction.bundles.build({
        kind: "VERIFICATION",
        verificationRunId: snapshot.verificationRunId,
        binding: memento.seed.data.binding,
        artifact: memento.seed.data.artifact,
        verifierId: snapshot.verifierId,
        results: run.resumeState.results,
      });
      if (!isSha256Digest(bundleDigest))
        return failed(
          "PORT_RESULT_INVALID",
          "The evidence bundle returned an invalid digest.",
        );
      const completed = run.complete({
        requestId: this.#ids.nextId("complete"),
        at: this.#now(),
        evidenceBundleDigest: bundleDigest,
      });
      if (!completed.ok)
        return failed(completed.error.code, completed.error.message);
      const verdict = completed.events[0];
      if (!verdict || verdict.kind === "VERIFICATION_ABORTED")
        return failed(
          "OUTGOING_MESSAGE_INVALID",
          "Completion did not record a verdict.",
        );
      const completionReviewId = this.#ids.nextId("completion-review");
      if (await transaction.reviews.load(completionReviewId))
        return failed(
          "REVIEW_ID_CONFLICT",
          "The generated completion-review ID already exists.",
        );
      const opened = CompletionReview.open({
        completionReviewId,
        verdictEvent: verdict,
      });
      if (!opened.ok)
        return failed("PORT_RESULT_INVALID", opened.error.message);
      const review = opened.value;
      const issued = review.issue({
        requestId: this.#ids.nextId("recommendation"),
        at: this.#now(),
      });
      if (!issued.ok)
        return failed("PORT_RESULT_INVALID", issued.error.message);
      const recommendation = issued.events[0];
      if (!recommendation)
        return failed(
          "OUTGOING_MESSAGE_INVALID",
          "Completion review did not record a recommendation.",
        );
      const outgoing = this.#buildEvents([verdict, recommendation]);
      if (!outgoing.ok) return outgoing;

      // Both aggregates become durable before their ordered public facts.
      await transaction.runs.save(run.toMemento());
      await transaction.reviews.create(review.toMemento());
      for (const event of outgoing.value)
        await transaction.outbox.append(event);
      await transaction.inbox.recordProcessed(input.requestId, fingerprint);
      return {
        ok: true,
        disposition: "applied",
        value: run.snapshot,
        events: outgoing.value,
      };
    });
  }

  async abortVerification(
    message: unknown,
  ): Promise<VerificationApplicationResult<VerificationSnapshot | undefined>> {
    const translated = translateAbortVerification(message);
    if (!translated.ok)
      return failed(translated.error.code, translated.error.message);
    const input = translated.value;
    const fingerprint = jsonFingerprint(input);
    return this.#unitOfWork.execute(async (transaction) => {
      const duplicate = await this.#privateDuplicate<VerificationSnapshot>(
        transaction,
        input,
        fingerprint,
        (run) => run.snapshot,
      );
      if (duplicate) return duplicate;
      const loaded = await this.#load(transaction, input.verificationRunId);
      if (!loaded.ok) return loaded;
      const correlationError = this.#correlationError(loaded.value, input);
      if (correlationError) return correlationError;
      const aborted = loaded.value.abort({
        requestId: this.#ids.nextId("abort"),
        at: this.#now(),
        reason: "MISSION_CANCELLED",
        retryable: false,
      });
      if (!aborted.ok) return failed(aborted.error.code, aborted.error.message);
      const outgoing = this.#buildEvents(aborted.events);
      if (!outgoing.ok) return outgoing;
      await transaction.runs.save(loaded.value.toMemento());
      for (const event of outgoing.value)
        await transaction.outbox.append(event);
      await transaction.inbox.recordProcessed(input.requestId, fingerprint);
      return {
        ok: true,
        disposition: aborted.disposition,
        value: loaded.value.snapshot,
        events: outgoing.value,
      };
    });
  }

  async #assign(run: VerificationRun): Promise<
    | Readonly<{ ok: true; events: readonly VerificationDomainEvent[] }>
    | Readonly<{
        ok: false;
        error: Readonly<{
          code: VerificationApplicationErrorCode;
          message: string;
        }>;
      }>
  > {
    const snapshot = run.snapshot;
    const assignment = await this.#assignments.assign({
      verificationRunId: snapshot.verificationRunId,
      attemptId: snapshot.attemptId,
      producingRunnerId: snapshot.producingRunnerId,
    });
    if (!isVerifierAssignment(assignment))
      return {
        ok: false,
        error: {
          code: "PORT_RESULT_INVALID",
          message: "The verifier assignment port returned an invalid result.",
        },
      };
    if (assignment.kind === "UNIDENTIFIED_FAILURE")
      return {
        ok: false,
        error: {
          code: "VERIFIER_IDENTITY_UNAVAILABLE",
          message: "The assignment provider could not identify a verifier.",
        },
      };
    const self = assignment.verifierId === snapshot.producingRunnerId;
    const assigned = run.assign({
      requestId: this.#ids.nextId("assignment"),
      at: this.#now(),
      verifierId: assignment.verifierId,
      availability:
        assignment.kind === "ASSIGNED" ? "AVAILABLE" : "UNAVAILABLE",
      ...(self
        ? { retryable: true }
        : assignment.kind === "UNAVAILABLE"
          ? { retryable: assignment.retryable }
          : {}),
    });
    return assigned.ok
      ? { ok: true, events: assigned.events }
      : { ok: false, error: assigned.error };
  }

  async #abortFromFailure(
    transaction: VerificationTransaction,
    run: VerificationRun,
    input: AssignmentRequest,
    fingerprint: string,
    reason: Exclude<AbortReason, "MISSION_CANCELLED">,
    retryable: boolean,
    detail?: string,
    diagnostic?: string,
  ): Promise<VerificationApplicationResult<VerificationSnapshot | undefined>> {
    const snapshot = run.snapshot;
    const memento = run.toMemento();
    if (!snapshot.verifierId)
      return failed(
        "UNSUPPORTED_TRANSITION",
        "An abort requires a known verifier.",
      );
    const boundedDetail =
      detail && isBoundedText(detail, 2000) ? detail : detail?.slice(0, 2000);
    const boundedDiagnostic = diagnostic?.slice(0, 2000);
    const evidenceBundleDigest = boundedDiagnostic
      ? await transaction.bundles.build({
          kind: "ABORT",
          verificationRunId: snapshot.verificationRunId,
          binding: memento.seed.data.binding,
          artifact: memento.seed.data.artifact,
          verifierId: snapshot.verifierId,
          reason,
          diagnostic: boundedDiagnostic,
        })
      : undefined;
    if (
      evidenceBundleDigest !== undefined &&
      !isSha256Digest(evidenceBundleDigest)
    )
      return failed(
        "PORT_RESULT_INVALID",
        "The abort bundle returned an invalid digest.",
      );
    const aborted = run.abort({
      requestId: this.#ids.nextId("abort"),
      at: this.#now(),
      reason,
      retryable,
      ...(evidenceBundleDigest ? { evidenceBundleDigest } : {}),
      ...(boundedDetail ? { detail: boundedDetail } : {}),
    });
    if (!aborted.ok) return failed(aborted.error.code, aborted.error.message);
    const outgoing = this.#buildEvents(aborted.events);
    if (!outgoing.ok) return outgoing;
    await transaction.runs.save(run.toMemento());
    for (const event of outgoing.value) await transaction.outbox.append(event);
    await transaction.inbox.recordProcessed(input.requestId, fingerprint);
    return {
      ok: true,
      disposition: aborted.disposition,
      value: run.snapshot,
      events: outgoing.value,
    };
  }

  async #load(
    transaction: VerificationTransaction,
    verificationRunId: string,
  ): Promise<VerificationApplicationResult<VerificationRun>> {
    const memento = await transaction.runs.load(verificationRunId);
    if (!memento)
      return failed("RUN_NOT_FOUND", "The verification run does not exist.");
    const restored = VerificationRun.rehydrate(memento);
    return restored.ok
      ? { ok: true, disposition: "applied", value: restored.value, events: [] }
      : failed(restored.error.code, restored.error.message);
  }

  async #privateDuplicate<Value>(
    transaction: VerificationTransaction,
    input: AssignmentRequest,
    fingerprint: string,
    response: (run: VerificationRun) => Value,
  ): Promise<VerificationApplicationResult<Value | undefined> | undefined> {
    const classification = await transaction.inbox.classify(
      input.requestId,
      fingerprint,
    );
    if (!isInboxClassification(classification))
      return failed(
        "PORT_RESULT_INVALID",
        "The inbox returned an invalid classification.",
      );
    if (classification === "MESSAGE_ID_CONFLICT")
      return failed(
        "MESSAGE_ID_CONFLICT",
        "The request ID already names different content.",
      );
    if (classification === "EXACT_REDELIVERY") {
      const loaded = await this.#load(transaction, input.verificationRunId);
      if (!loaded.ok) return loaded;
      const correlationError = this.#correlationError(loaded.value, input);
      if (correlationError) return correlationError;
      return {
        ok: true,
        disposition: "idempotent",
        value: response(loaded.value),
        events: [],
      };
    }
    return undefined;
  }

  #correlationError(
    run: VerificationRun,
    input: AssignmentRequest,
  ): VerificationApplicationResult<never> | undefined {
    return run.toMemento().seed.correlationId === input.correlationId
      ? undefined
      : failed(
          "CORRELATION_MISMATCH",
          "The private request correlation does not match the verification run.",
        );
  }

  #startSuccess(
    disposition: "applied" | "idempotent",
    run: VerificationRun,
    events: readonly VerificationPublicEvent[],
  ): VerificationApplicationResult<StartVerificationOutcome> {
    const snapshot = run.snapshot;
    return {
      ok: true,
      disposition,
      value: {
        snapshot,
        assignment: snapshot.status === "RUNNING" ? "ASSIGNED" : "ABORTED",
      },
      events,
    };
  }

  #buildEvents(
    events: readonly (
      | VerificationDomainEvent
      | import("../domain/completion-review.js").ReviewRecommendationEvent
    )[],
  ):
    | Readonly<{ ok: true; value: readonly VerificationPublicEvent[] }>
    | VerificationApplicationResult<never> {
    const outgoing: VerificationPublicEvent[] = [];
    for (const event of events) {
      const built = createVerificationPublicEvent(event);
      if (!built.ok) return failed(built.error.code, built.error.message);
      outgoing.push(built.value);
    }
    return { ok: true, value: Object.freeze(outgoing) };
  }

  #now(): string {
    const now = this.#clock.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
      throw new TypeError(
        "The authoritative clock returned an invalid instant.",
      );
    return now.toISOString();
  }
}

// These imports intentionally keep the public repository contracts discoverable
// from this module's declarations without introducing persistence implementations.
export type { VerificationRunMementoV1, CompletionReviewMementoV1 };
