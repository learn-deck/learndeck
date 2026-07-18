import { createHash } from "node:crypto";
import {
  canonicalizeJson,
  deepFreezeCopy,
  hasExactOwnKeys,
  hasJsonTopology,
  isDenseJsonArray,
  isJsonObject,
  jsonFingerprint,
} from "./json-topology.js";

export type VerificationRunStatus =
  "REQUESTED" | "RUNNING" | "PASSED" | "FAILED" | "ABORTED";
export type GateCommandId =
  "check-allowed-scope" | "check-lint" | "check-typecheck" | "check-tests";
export type AbortReason =
  | "VERIFIER_UNAVAILABLE"
  | "WORKSPACE_UNAVAILABLE"
  | "EXECUTION_INFRASTRUCTURE_FAILURE"
  | "MISSION_CANCELLED";

export interface Digest {
  readonly algorithm: "sha256";
  readonly value: string;
}

export interface AcceptanceGate {
  readonly gateId: string;
  readonly kind: "ALLOWED_SCOPE" | "LINT" | "TYPECHECK" | "TEST";
  readonly commandId: GateCommandId;
  readonly mandatory: boolean;
  readonly timeoutSeconds: number;
  readonly evidenceLimitBytes: number;
}

export interface Artifact {
  readonly reference: string;
  readonly digest: Digest;
  readonly changedPaths: readonly string[];
}

export interface VerificationBinding {
  readonly missionId: string;
  readonly missionRevision: number;
  readonly startingRevision: string;
  readonly artifactDigest: Digest;
  readonly gateSetDigest: Digest;
}

export interface StartVerificationSeed {
  readonly commandId: string;
  readonly commandType: "verification.start-verification.v1";
  readonly schemaVersion: 1;
  readonly issuedAt: string;
  readonly issuer: "mission-control";
  readonly recipient: "verification-and-review";
  readonly subjectId: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly data: Readonly<{
    verificationRunId: string;
    attemptId: string;
    producingRunnerId: string;
    binding: VerificationBinding;
    artifact: Artifact;
    acceptanceGates: readonly AcceptanceGate[];
  }>;
}

export type CheckResult = Readonly<{
  gateId: string;
  commandId: GateCommandId;
  status: "PASS" | "FAIL" | "TIMEOUT";
  exitCode: number | null;
  durationMs: number;
  evidenceDigest: Digest;
  evidenceBytes: number;
}>;

export interface PrivateIdentity {
  readonly requestId: string;
  readonly at: string;
}

export interface AssignVerifier extends PrivateIdentity {
  readonly verifierId: string;
  readonly availability: "AVAILABLE" | "UNAVAILABLE";
  readonly retryable?: boolean;
}

export interface RecordCheckResult extends PrivateIdentity {
  readonly checkpointKey: string;
  readonly result: CheckResult;
}

export interface CompleteVerification extends PrivateIdentity {
  readonly evidenceBundleDigest: Digest;
}

export interface AbortVerification extends PrivateIdentity {
  readonly reason: AbortReason;
  readonly retryable: boolean;
  readonly evidenceBundleDigest?: Digest;
  readonly detail?: string;
}

export interface EventMetadata {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
}

export type VerificationVerdictEvent =
  | Readonly<{
      kind: "VERIFICATION_PASSED";
      metadata: EventMetadata;
      verificationRunId: string;
      attemptId: string;
      binding: VerificationBinding;
      verifierId: string;
      verdict: "PASSED";
      checkCount: number;
      evidenceBundleDigest: Digest;
    }>
  | Readonly<{
      kind: "VERIFICATION_FAILED";
      metadata: EventMetadata;
      verificationRunId: string;
      attemptId: string;
      binding: VerificationBinding;
      verifierId: string;
      verdict: "FAILED";
      checkCount: number;
      failedGateIds: readonly string[];
      evidenceBundleDigest: Digest;
    }>;

export type VerificationDomainEvent =
  | VerificationVerdictEvent
  | Readonly<{
      kind: "VERIFICATION_ABORTED";
      metadata: EventMetadata;
      verificationRunId: string;
      attemptId: string;
      binding: VerificationBinding;
      verifierId: string;
      outcome: "ABORTED";
      reason: AbortReason;
      retryable: boolean;
      evidenceBundleDigest?: Digest;
      detail?: string;
    }>;

export type VerificationErrorCode =
  | "INVALID_START"
  | "INVALID_ASSIGNMENT"
  | "INVALID_CHECK_RESULT"
  | "INVALID_COMPLETION"
  | "INVALID_ABORT"
  | "UNSUPPORTED_TRANSITION"
  | "RUN_TERMINAL"
  | "SELF_VERIFICATION_FORBIDDEN"
  | "CHECKPOINT_OUT_OF_ORDER"
  | "CHECK_RESULT_CONFLICT"
  | "CHECKS_INCOMPLETE"
  | "MESSAGE_ID_CONFLICT"
  | "TRANSITION_CHRONOLOGY_INVALID"
  | "PERSISTENCE_MEMENTO_INVALID"
  | "PERSISTENCE_VERSION_UNSUPPORTED";

export type VerificationResult<Value> =
  | Readonly<{
      ok: true;
      disposition: "applied" | "idempotent";
      value: Value;
      events: readonly VerificationDomainEvent[];
    }>
  | Readonly<{
      ok: false;
      error: Readonly<{ code: VerificationErrorCode; message: string }>;
    }>;

export type StartComparison =
  | "EXACT_DELIVERY_DUPLICATE"
  | "SEMANTIC_DUPLICATE"
  | "MESSAGE_ID_CONFLICT"
  | "RUN_ID_CONFLICT"
  | "INVALID";

export interface AssignmentRecord {
  readonly requestId: string;
  readonly at: string;
  readonly verifierId: string;
  readonly outcome: "ASSIGNED" | "SELF_REJECTED" | "UNAVAILABLE";
}

export interface CheckpointRecord {
  readonly gateId: string;
  readonly checkpointKey: string;
  readonly recordedRequestId?: string;
  readonly recordedAt?: string;
  readonly result?: CheckResult;
}

export type TerminalOutcome =
  | Readonly<{
      kind: "VERDICT";
      verdict: "PASSED" | "FAILED";
      checkCount: number;
      failedGateIds: readonly string[];
    }>
  | Readonly<{
      kind: "ABORT";
      reason: AbortReason;
      retryable: boolean;
    }>;

export interface VerificationRunMementoV1 {
  readonly mementoType: "patchquest.verification-run";
  readonly mementoVersion: 1;
  readonly status: VerificationRunStatus;
  readonly seed: StartVerificationSeed;
  readonly semanticFingerprint: string;
  readonly canonicalGates: readonly AcceptanceGate[];
  readonly checkpoints: readonly CheckpointRecord[];
  readonly executionCount: number;
  readonly nextCheckpointIndex: number;
  readonly assignment?: AssignmentRecord;
  readonly evidenceBundleDigest?: Digest;
  readonly abortEvidence?: Readonly<{
    evidenceBundleDigest?: Digest;
    detail?: string;
  }>;
  readonly terminalAction?: PrivateIdentity;
  readonly terminalOutcome?: TerminalOutcome;
  readonly terminalEvent?: VerificationDomainEvent;
}

export interface VerificationSnapshot {
  readonly verificationRunId: string;
  readonly attemptId: string;
  readonly producingRunnerId: string;
  readonly status: VerificationRunStatus;
  readonly binding: VerificationBinding;
  readonly gates: readonly AcceptanceGate[];
  readonly verifierId?: string;
  readonly nextGateId?: string;
  readonly nextCheckpointKey?: string;
  readonly completedGateCount: number;
  readonly totalGateCount: number;
  readonly results: readonly CheckResult[];
  readonly evidenceBundleDigest?: Digest;
  readonly terminalOutcome?: TerminalOutcome;
}

interface MutableState {
  status: VerificationRunStatus;
  seed: StartVerificationSeed;
  semanticFingerprint: string;
  canonicalGates: readonly AcceptanceGate[];
  checkpoints: CheckpointRecord[];
  assignment?: AssignmentRecord | undefined;
  evidenceBundleDigest?: Digest | undefined;
  abortEvidence?:
    { evidenceBundleDigest?: Digest; detail?: string } | undefined;
  terminalAction?: PrivateIdentity | undefined;
  terminalOutcome?: TerminalOutcome | undefined;
  terminalEvent?: VerificationDomainEvent | undefined;
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const fingerprintPattern = /^[a-f0-9]{64}$/;
const gateCommandByKind: Readonly<Record<string, GateCommandId>> = {
  ALLOWED_SCOPE: "check-allowed-scope",
  LINT: "check-lint",
  TYPECHECK: "check-typecheck",
  TEST: "check-tests",
};

function failure<Value>(
  code: VerificationErrorCode,
  message: string,
): VerificationResult<Value> {
  return { ok: false, error: { code, message } };
}

function success<Value>(
  disposition: "applied" | "idempotent",
  value: Value,
  events: readonly VerificationDomainEvent[] = [],
): VerificationResult<Value> {
  return { ok: true, disposition, value, events: Object.freeze([...events]) };
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" && value.length >= 1 && value.length <= maximum
  );
}

export function isCanonicalVerificationInstant(
  value: unknown,
): value is string {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4})-(\d\d)-(\d\d)[Tt](\d\d):(\d\d):(\d\d(?:\.\d+)?)([Zz]|([+-])(\d\d):(\d\d))$/.exec(
      value,
    );
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (days[month] ?? 0) &&
    Number(match[4]) <= 23 &&
    Number(match[5]) <= 59 &&
    Number(match[6]) < 60 &&
    Number(match[9] ?? 0) <= 23 &&
    Number(match[10] ?? 0) <= 59
  );
}

const isTimestamp = isCanonicalVerificationInstant;

function isDigest(value: unknown): value is Digest {
  return (
    isJsonObject(value) &&
    hasExactOwnKeys(value, ["algorithm", "value"]) &&
    value["algorithm"] === "sha256" &&
    typeof value["value"] === "string" &&
    digestPattern.test(value["value"])
  );
}

function sameDigest(left: Digest, right: Digest): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

function isRepositoryPath(value: unknown): value is string {
  if (
    !isBoundedText(value, 512) ||
    value.startsWith("/") ||
    /^[A-Za-z]:/u.test(value) ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value.normalize("NFC") !== value
  )
    return false;
  return (
    !value.includes("*") &&
    !value.includes("?") &&
    !value.includes("[") &&
    !value.includes("]") &&
    value
      .split("/")
      .every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

function isArtifact(value: unknown): value is Artifact {
  if (
    !isJsonObject(value) ||
    !hasExactOwnKeys(value, ["reference", "digest", "changedPaths"]) ||
    !isBoundedText(value["reference"], 2048) ||
    !isDigest(value["digest"]) ||
    !isDenseJsonArray(value["changedPaths"]) ||
    value["changedPaths"].length < 1 ||
    !value["changedPaths"].every(isRepositoryPath) ||
    new Set(value["changedPaths"]).size !== value["changedPaths"].length
  )
    return false;
  try {
    new URL(value["reference"]);
    return true;
  } catch {
    return false;
  }
}

function isAcceptanceGate(value: unknown): value is AcceptanceGate {
  return (
    isJsonObject(value) &&
    hasExactOwnKeys(value, [
      "gateId",
      "kind",
      "commandId",
      "mandatory",
      "timeoutSeconds",
      "evidenceLimitBytes",
    ]) &&
    isIdentifier(value["gateId"]) &&
    gateCommandByKind[String(value["kind"])] === value["commandId"] &&
    typeof value["mandatory"] === "boolean" &&
    isPositiveInteger(value["timeoutSeconds"]) &&
    Number(value["timeoutSeconds"]) <= 3600 &&
    isNonNegativeInteger(value["evidenceLimitBytes"]) &&
    Number(value["evidenceLimitBytes"]) <= 1_048_576
  );
}

export function calculateGateSetDigest(
  gates: readonly AcceptanceGate[],
): Digest {
  return {
    algorithm: "sha256",
    value: createHash("sha256")
      .update(canonicalizeJson(canonicalGates(gates)))
      .digest("hex"),
  };
}

function canonicalGates(
  gates: readonly AcceptanceGate[],
): readonly AcceptanceGate[] {
  return [...gates].sort((left, right) =>
    left.gateId < right.gateId ? -1 : left.gateId > right.gateId ? 1 : 0,
  );
}

function isBinding(value: unknown): value is VerificationBinding {
  return (
    isJsonObject(value) &&
    hasExactOwnKeys(value, [
      "missionId",
      "missionRevision",
      "startingRevision",
      "artifactDigest",
      "gateSetDigest",
    ]) &&
    isIdentifier(value["missionId"]) &&
    isPositiveInteger(value["missionRevision"]) &&
    isBoundedText(value["startingRevision"], 256) &&
    isDigest(value["artifactDigest"]) &&
    isDigest(value["gateSetDigest"])
  );
}

function isStartSeed(value: unknown): value is StartVerificationSeed {
  if (
    !isJsonObject(value) ||
    !hasExactOwnKeys(value, [
      "commandId",
      "commandType",
      "schemaVersion",
      "issuedAt",
      "issuer",
      "recipient",
      "subjectId",
      "correlationId",
      "causationId",
      "data",
    ]) ||
    !isIdentifier(value["commandId"]) ||
    value["commandType"] !== "verification.start-verification.v1" ||
    value["schemaVersion"] !== 1 ||
    !isTimestamp(value["issuedAt"]) ||
    value["issuer"] !== "mission-control" ||
    value["recipient"] !== "verification-and-review" ||
    !isIdentifier(value["subjectId"]) ||
    !isIdentifier(value["correlationId"]) ||
    !isIdentifier(value["causationId"]) ||
    !isJsonObject(value["data"]) ||
    !hasExactOwnKeys(value["data"], [
      "verificationRunId",
      "attemptId",
      "producingRunnerId",
      "binding",
      "artifact",
      "acceptanceGates",
    ]) ||
    !isIdentifier(value["data"]["verificationRunId"]) ||
    value["subjectId"] !== value["data"]["verificationRunId"] ||
    !isIdentifier(value["data"]["attemptId"]) ||
    !isIdentifier(value["data"]["producingRunnerId"]) ||
    !isBinding(value["data"]["binding"]) ||
    !isArtifact(value["data"]["artifact"]) ||
    !isDenseJsonArray(value["data"]["acceptanceGates"]) ||
    value["data"]["acceptanceGates"].length < 1 ||
    !value["data"]["acceptanceGates"].every(isAcceptanceGate) ||
    new Set(value["data"]["acceptanceGates"].map((gate) => gate.gateId))
      .size !== value["data"]["acceptanceGates"].length ||
    !hasJsonTopology(value)
  )
    return false;
  const binding = value["data"]["binding"];
  return (
    sameDigest(binding.artifactDigest, value["data"]["artifact"].digest) &&
    sameDigest(
      binding.gateSetDigest,
      calculateGateSetDigest(value["data"]["acceptanceGates"]),
    )
  );
}

function normalizeSeed(seed: StartVerificationSeed): StartVerificationSeed {
  return deepFreezeCopy({
    ...seed,
    data: {
      ...seed.data,
      acceptanceGates: canonicalGates(seed.data.acceptanceGates),
    },
  });
}

function semanticContent(seed: StartVerificationSeed): unknown {
  return {
    commandType: seed.commandType,
    schemaVersion: seed.schemaVersion,
    issuer: seed.issuer,
    recipient: seed.recipient,
    subjectId: seed.subjectId,
    correlationId: seed.correlationId,
    causationId: seed.causationId,
    data: seed.data,
  };
}

export function verificationSemanticFingerprint(
  seed: StartVerificationSeed,
): string {
  if (!isStartSeed(seed))
    throw new TypeError("Verification start seed is invalid.");
  return jsonFingerprint(semanticContent(normalizeSeed(seed)));
}

function checkpointKey(runId: string, gateId: string): string {
  return `checkpoint:${createHash("sha256")
    .update(canonicalizeJson([runId, gateId]))
    .digest("hex")}`;
}

function privateIdentity(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is PrivateIdentity {
  return (
    isJsonObject(value) &&
    hasExactOwnKeys(value, required, optional) &&
    isIdentifier(value["requestId"]) &&
    isTimestamp(value["at"]) &&
    hasJsonTopology(value)
  );
}

function eventMetadata(
  seed: StartVerificationSeed,
  kind: VerificationDomainEvent["kind"],
  occurredAt: string,
): EventMetadata {
  return deepFreezeCopy({
    eventId: `event:${createHash("sha256").update(`${seed.commandId}:${kind}`).digest("hex")}`,
    occurredAt,
    correlationId: seed.correlationId,
    causationId: seed.commandId,
  });
}

function isEventMetadata(value: unknown): value is EventMetadata {
  return (
    isJsonObject(value) &&
    hasExactOwnKeys(value, [
      "eventId",
      "occurredAt",
      "correlationId",
      "causationId",
    ]) &&
    isIdentifier(value["eventId"]) &&
    isTimestamp(value["occurredAt"]) &&
    isIdentifier(value["correlationId"]) &&
    isIdentifier(value["causationId"])
  );
}

function isCheckResult(
  value: unknown,
  gate: AcceptanceGate,
): value is CheckResult {
  if (
    !isJsonObject(value) ||
    !hasExactOwnKeys(value, [
      "gateId",
      "commandId",
      "status",
      "exitCode",
      "durationMs",
      "evidenceDigest",
      "evidenceBytes",
    ]) ||
    value["gateId"] !== gate.gateId ||
    value["commandId"] !== gate.commandId ||
    !isNonNegativeInteger(value["durationMs"]) ||
    !isDigest(value["evidenceDigest"]) ||
    !isNonNegativeInteger(value["evidenceBytes"]) ||
    Number(value["evidenceBytes"]) > gate.evidenceLimitBytes ||
    !hasJsonTopology(value)
  )
    return false;
  const durationMs = Number(value["durationMs"]);
  const timeoutMs = gate.timeoutSeconds * 1000;
  switch (value["status"]) {
    case "PASS":
      return value["exitCode"] === 0 && durationMs < timeoutMs;
    case "FAIL":
      return (
        Number.isSafeInteger(value["exitCode"]) &&
        Number(value["exitCode"]) !== 0 &&
        durationMs < timeoutMs
      );
    case "TIMEOUT":
      return value["exitCode"] === null && durationMs >= timeoutMs;
    default:
      return false;
  }
}

function isAbortRetryabilityValid(
  reason: AbortReason,
  retryable: boolean,
): boolean {
  return reason !== "MISSION_CANCELLED" || retryable === false;
}

function makeAbortEvent(
  seed: StartVerificationSeed,
  verifierId: string,
  identity: PrivateIdentity,
  reason: AbortReason,
  retryable: boolean,
  evidence?: Readonly<{ evidenceBundleDigest?: Digest; detail?: string }>,
): VerificationDomainEvent {
  return deepFreezeCopy({
    kind: "VERIFICATION_ABORTED" as const,
    metadata: eventMetadata(seed, "VERIFICATION_ABORTED", identity.at),
    verificationRunId: seed.data.verificationRunId,
    attemptId: seed.data.attemptId,
    binding: seed.data.binding,
    verifierId,
    outcome: "ABORTED" as const,
    reason,
    retryable,
    ...(evidence?.evidenceBundleDigest
      ? { evidenceBundleDigest: evidence.evidenceBundleDigest }
      : {}),
    ...(evidence?.detail ? { detail: evidence.detail } : {}),
  });
}

export class VerificationRun {
  readonly #state: MutableState;

  private constructor(state: MutableState) {
    this.#state = state;
  }

  static start(
    seed: StartVerificationSeed,
  ): VerificationResult<VerificationRun> {
    if (!isStartSeed(seed))
      return failure("INVALID_START", "Start-verification seed is invalid.");
    const normalized = normalizeSeed(seed);
    const gates = deepFreezeCopy(normalized.data.acceptanceGates);
    const run = new VerificationRun({
      status: "REQUESTED",
      seed: normalized,
      semanticFingerprint: jsonFingerprint(semanticContent(normalized)),
      canonicalGates: gates,
      checkpoints: gates.map((gate) =>
        deepFreezeCopy({
          gateId: gate.gateId,
          checkpointKey: checkpointKey(
            normalized.data.verificationRunId,
            gate.gateId,
          ),
        }),
      ),
    });
    return success("applied", run);
  }

  compareStart(candidate: StartVerificationSeed): StartComparison {
    if (!isStartSeed(candidate)) return "INVALID";
    const normalized = normalizeSeed(candidate);
    if (
      normalized.data.verificationRunId !==
      this.#state.seed.data.verificationRunId
    )
      return "RUN_ID_CONFLICT";
    if (normalized.commandId === this.#state.seed.commandId)
      return canonicalizeJson(normalized) === canonicalizeJson(this.#state.seed)
        ? "EXACT_DELIVERY_DUPLICATE"
        : "MESSAGE_ID_CONFLICT";
    return jsonFingerprint(semanticContent(normalized)) ===
      this.#state.semanticFingerprint
      ? "SEMANTIC_DUPLICATE"
      : "RUN_ID_CONFLICT";
  }

  get snapshot(): VerificationSnapshot {
    const next = this.#state.checkpoints.find((entry) => !entry.result);
    return deepFreezeCopy({
      verificationRunId: this.#state.seed.data.verificationRunId,
      attemptId: this.#state.seed.data.attemptId,
      producingRunnerId: this.#state.seed.data.producingRunnerId,
      status: this.#state.status,
      binding: this.#state.seed.data.binding,
      gates: this.#state.canonicalGates,
      ...(this.#state.assignment
        ? { verifierId: this.#state.assignment.verifierId }
        : {}),
      ...(next
        ? { nextGateId: next.gateId, nextCheckpointKey: next.checkpointKey }
        : {}),
      completedGateCount: this.#state.checkpoints.filter(
        (entry) => entry.result,
      ).length,
      totalGateCount: this.#state.checkpoints.length,
      results: this.#state.checkpoints.flatMap((entry) =>
        entry.result ? [entry.result] : [],
      ),
      ...(this.#state.evidenceBundleDigest
        ? { evidenceBundleDigest: this.#state.evidenceBundleDigest }
        : {}),
      ...(this.#state.terminalOutcome
        ? { terminalOutcome: this.#state.terminalOutcome }
        : {}),
    });
  }

  get resumeState(): Readonly<{
    nextGate?: AcceptanceGate;
    checkpointKey?: string;
    results: readonly CheckResult[];
  }> {
    const nextIndex = this.#state.checkpoints.findIndex(
      (entry) => !entry.result,
    );
    return deepFreezeCopy({
      ...(nextIndex >= 0
        ? {
            nextGate: this.#state.canonicalGates[nextIndex] as AcceptanceGate,
            checkpointKey: (
              this.#state.checkpoints[nextIndex] as CheckpointRecord
            ).checkpointKey,
          }
        : {}),
      results: this.#state.checkpoints.flatMap((entry) =>
        entry.result ? [entry.result] : [],
      ),
    });
  }

  checkpointKeyFor(gateId: string): string | undefined {
    return this.#state.checkpoints.find((entry) => entry.gateId === gateId)
      ?.checkpointKey;
  }

  assign(input: AssignVerifier): VerificationResult<VerificationSnapshot> {
    if (
      !privateIdentity(
        input,
        ["requestId", "at", "verifierId", "availability"],
        ["retryable"],
      ) ||
      !isIdentifier(input.verifierId) ||
      (input.availability !== "AVAILABLE" &&
        input.availability !== "UNAVAILABLE") ||
      (input.retryable !== undefined && typeof input.retryable !== "boolean")
    )
      return failure("INVALID_ASSIGNMENT", "Verifier assignment is invalid.");
    if (this.#state.status !== "REQUESTED")
      return this.#terminalOrUnsupported(
        "Only a requested run may be assigned.",
      );
    const identityError = this.#validateNextIdentity(input);
    if (identityError) return identityError;
    const self = input.verifierId === this.#state.seed.data.producingRunnerId;
    if (
      (!self &&
        input.availability === "UNAVAILABLE" &&
        typeof input.retryable !== "boolean") ||
      (!self &&
        input.availability === "AVAILABLE" &&
        input.retryable !== undefined) ||
      (self && input.retryable !== true)
    )
      return failure(
        "INVALID_ASSIGNMENT",
        "Verifier retryability does not match the assignment outcome.",
      );
    const outcome: AssignmentRecord["outcome"] = self
      ? "SELF_REJECTED"
      : input.availability === "UNAVAILABLE"
        ? "UNAVAILABLE"
        : "ASSIGNED";
    if (
      outcome !== "ASSIGNED" &&
      this.#eventIdentityConflicts(input.requestId, "VERIFICATION_ABORTED")
    )
      return failure(
        "MESSAGE_ID_CONFLICT",
        "Abort event identity collides with a recorded identity.",
      );
    this.#state.assignment = deepFreezeCopy({
      requestId: input.requestId,
      at: input.at,
      verifierId: input.verifierId,
      outcome,
    });
    if (outcome === "ASSIGNED") {
      this.#state.status = "RUNNING";
      return success("applied", this.snapshot);
    }
    return this.#applyAbort(
      { requestId: input.requestId, at: input.at },
      "VERIFIER_UNAVAILABLE",
      self ? true : (input.retryable as boolean),
    );
  }

  recordCheckResult(
    input: RecordCheckResult,
  ): VerificationResult<VerificationSnapshot> {
    if (
      !privateIdentity(input, ["requestId", "at", "checkpointKey", "result"]) ||
      !isIdentifier(input.checkpointKey) ||
      !isJsonObject(input.result) ||
      !isIdentifier(input.result["gateId"])
    )
      return failure("INVALID_CHECK_RESULT", "Check result input is invalid.");
    const namedGate = this.#state.canonicalGates.find(
      (gate) => gate.gateId === input.result.gateId,
    );
    if (!namedGate || !isCheckResult(input.result, namedGate))
      return failure(
        "INVALID_CHECK_RESULT",
        "Check result does not match the immutable gate contract.",
      );
    const existing = this.#state.checkpoints.find(
      (entry) => entry.gateId === input.result.gateId && entry.result,
    );
    if (existing) {
      if (
        existing.checkpointKey !== input.checkpointKey ||
        canonicalizeJson(existing.result) !== canonicalizeJson(input.result)
      )
        return failure(
          "CHECK_RESULT_CONFLICT",
          "A different result is already committed for this gate.",
        );
      if (
        input.requestId !== existing.recordedRequestId &&
        this.#recordedIdentities().includes(input.requestId)
      )
        return failure(
          "MESSAGE_ID_CONFLICT",
          "A duplicate result cannot reuse another recorded identity.",
        );
      return success("idempotent", this.snapshot);
    }
    if (this.#state.status !== "RUNNING")
      return this.#terminalOrUnsupported(
        "Only a running verification may record checks.",
      );
    const nextIndex = this.#state.checkpoints.findIndex(
      (entry) => !entry.result,
    );
    const next = this.#state.checkpoints[nextIndex];
    const gate = this.#state.canonicalGates[nextIndex];
    if (
      !next ||
      !gate ||
      input.result.gateId !== next.gateId ||
      input.checkpointKey !== next.checkpointKey
    )
      return failure(
        "CHECKPOINT_OUT_OF_ORDER",
        "Only the first missing gate checkpoint may be recorded.",
      );
    const identityError = this.#validateNextIdentity(input);
    if (identityError) return identityError;
    this.#state.checkpoints[nextIndex] = deepFreezeCopy({
      gateId: gate.gateId,
      checkpointKey: next.checkpointKey,
      recordedRequestId: input.requestId,
      recordedAt: input.at,
      result: input.result,
    });
    return success("applied", this.snapshot);
  }

  complete(
    input: CompleteVerification,
  ): VerificationResult<VerificationSnapshot> {
    if (
      !privateIdentity(input, ["requestId", "at", "evidenceBundleDigest"]) ||
      !isDigest(input.evidenceBundleDigest)
    )
      return failure("INVALID_COMPLETION", "Completion input is invalid.");
    if (this.#state.status !== "RUNNING")
      return this.#terminalOrUnsupported(
        "Only a running verification may complete.",
      );
    if (this.#state.checkpoints.some((entry) => !entry.result))
      return failure(
        "CHECKS_INCOMPLETE",
        "All gate results must be committed before completion.",
      );
    const identityError = this.#validateNextIdentity(input);
    if (identityError) return identityError;
    const failedGateIds = this.#state.canonicalGates.flatMap((gate, index) => {
      const result = this.#state.checkpoints[index]?.result;
      return gate.mandatory && result?.status !== "PASS" ? [gate.gateId] : [];
    });
    const verdict = failedGateIds.length === 0 ? "PASSED" : "FAILED";
    const eventKind =
      verdict === "PASSED"
        ? ("VERIFICATION_PASSED" as const)
        : ("VERIFICATION_FAILED" as const);
    if (this.#eventIdentityConflicts(input.requestId, eventKind))
      return failure(
        "MESSAGE_ID_CONFLICT",
        "Verdict event identity collides with a recorded identity.",
      );
    const assignment = this.#state.assignment;
    if (!assignment)
      return failure("UNSUPPORTED_TRANSITION", "A verifier must be assigned.");
    const common = {
      verificationRunId: this.#state.seed.data.verificationRunId,
      attemptId: this.#state.seed.data.attemptId,
      binding: this.#state.seed.data.binding,
      verifierId: assignment.verifierId,
      checkCount: this.#state.checkpoints.length,
      evidenceBundleDigest: input.evidenceBundleDigest,
    };
    const event: VerificationVerdictEvent = deepFreezeCopy(
      verdict === "PASSED"
        ? {
            kind: "VERIFICATION_PASSED" as const,
            metadata: eventMetadata(
              this.#state.seed,
              "VERIFICATION_PASSED",
              input.at,
            ),
            ...common,
            verdict,
          }
        : {
            kind: "VERIFICATION_FAILED" as const,
            metadata: eventMetadata(
              this.#state.seed,
              "VERIFICATION_FAILED",
              input.at,
            ),
            ...common,
            verdict,
            failedGateIds,
          },
    );
    this.#state.status = verdict;
    this.#state.evidenceBundleDigest = deepFreezeCopy(
      input.evidenceBundleDigest,
    );
    this.#state.terminalAction = deepFreezeCopy({
      requestId: input.requestId,
      at: input.at,
    });
    this.#state.terminalOutcome = deepFreezeCopy({
      kind: "VERDICT" as const,
      verdict,
      checkCount: this.#state.checkpoints.length,
      failedGateIds,
    });
    this.#state.terminalEvent = event;
    return success("applied", this.snapshot, [event]);
  }

  abort(input: AbortVerification): VerificationResult<VerificationSnapshot> {
    if (
      !privateIdentity(
        input,
        ["requestId", "at", "reason", "retryable"],
        ["evidenceBundleDigest", "detail"],
      ) ||
      ![
        "VERIFIER_UNAVAILABLE",
        "WORKSPACE_UNAVAILABLE",
        "EXECUTION_INFRASTRUCTURE_FAILURE",
        "MISSION_CANCELLED",
      ].includes(String(input.reason)) ||
      typeof input.retryable !== "boolean" ||
      !isAbortRetryabilityValid(input.reason, input.retryable) ||
      (input.evidenceBundleDigest !== undefined &&
        !isDigest(input.evidenceBundleDigest)) ||
      (input.detail !== undefined && !isBoundedText(input.detail, 2000))
    )
      return failure("INVALID_ABORT", "Abort input is invalid.");
    if (this.#state.status !== "RUNNING" || !this.#state.assignment)
      return this.#terminalOrUnsupported(
        "Only a run with a known verifier may abort.",
      );
    const identityError = this.#validateNextIdentity(input);
    if (identityError) return identityError;
    if (this.#eventIdentityConflicts(input.requestId, "VERIFICATION_ABORTED"))
      return failure(
        "MESSAGE_ID_CONFLICT",
        "Abort event identity collides with a recorded identity.",
      );
    return this.#applyAbort(input, input.reason, input.retryable, {
      ...(input.evidenceBundleDigest
        ? { evidenceBundleDigest: input.evidenceBundleDigest }
        : {}),
      ...(input.detail ? { detail: input.detail } : {}),
    });
  }

  #applyAbort(
    identity: PrivateIdentity,
    reason: AbortReason,
    retryable: boolean,
    evidence?: Readonly<{ evidenceBundleDigest?: Digest; detail?: string }>,
  ): VerificationResult<VerificationSnapshot> {
    const assignment = this.#state.assignment;
    if (!assignment)
      return failure(
        "UNSUPPORTED_TRANSITION",
        "An abort requires a known verifier.",
      );
    const materialEvidence =
      evidence?.evidenceBundleDigest !== undefined ||
      evidence?.detail !== undefined
        ? evidence
        : undefined;
    const event = makeAbortEvent(
      this.#state.seed,
      assignment.verifierId,
      identity,
      reason,
      retryable,
      materialEvidence,
    );
    this.#state.status = "ABORTED";
    this.#state.abortEvidence = materialEvidence
      ? deepFreezeCopy(materialEvidence)
      : undefined;
    this.#state.terminalAction = deepFreezeCopy({
      requestId: identity.requestId,
      at: identity.at,
    });
    this.#state.terminalOutcome = deepFreezeCopy({
      kind: "ABORT" as const,
      reason,
      retryable,
    });
    this.#state.terminalEvent = event;
    return success("applied", this.snapshot, [event]);
  }

  #terminalOrUnsupported(message: string): VerificationResult<never> {
    return this.#state.status === "PASSED" ||
      this.#state.status === "FAILED" ||
      this.#state.status === "ABORTED"
      ? failure("RUN_TERMINAL", "A terminal verification run is immutable.")
      : failure("UNSUPPORTED_TRANSITION", message);
  }

  #validateNextIdentity(
    identity: PrivateIdentity,
  ): VerificationResult<never> | undefined {
    const identities = this.#recordedIdentities();
    if (identities.includes(identity.requestId))
      return failure(
        "MESSAGE_ID_CONFLICT",
        "Private request and event IDs must be unique.",
      );
    const latestAt =
      this.#state.terminalAction?.at ??
      this.#state.checkpoints.filter((entry) => entry.recordedAt).at(-1)
        ?.recordedAt ??
      this.#state.assignment?.at ??
      this.#state.seed.issuedAt;
    if (Date.parse(identity.at) < Date.parse(latestAt))
      return failure(
        "TRANSITION_CHRONOLOGY_INVALID",
        "Verification time cannot move backwards.",
      );
    return undefined;
  }

  #recordedIdentities(): string[] {
    return [
      this.#state.seed.commandId,
      ...(this.#state.assignment ? [this.#state.assignment.requestId] : []),
      ...this.#state.checkpoints.flatMap((entry) =>
        entry.recordedRequestId ? [entry.recordedRequestId] : [],
      ),
      ...(this.#state.terminalAction
        ? [this.#state.terminalAction.requestId]
        : []),
      ...(this.#state.terminalEvent
        ? [this.#state.terminalEvent.metadata.eventId]
        : []),
    ];
  }

  #eventIdentityConflicts(
    requestId: string,
    kind: VerificationDomainEvent["kind"],
  ): boolean {
    const eventId = eventMetadata(
      this.#state.seed,
      kind,
      this.#state.seed.issuedAt,
    ).eventId;
    return (
      eventId === requestId || this.#recordedIdentities().includes(eventId)
    );
  }

  toMemento(): VerificationRunMementoV1 {
    const executionCount = this.#state.checkpoints.filter(
      (entry) => entry.result,
    ).length;
    return deepFreezeCopy({
      mementoType: "patchquest.verification-run" as const,
      mementoVersion: 1 as const,
      status: this.#state.status,
      seed: this.#state.seed,
      semanticFingerprint: this.#state.semanticFingerprint,
      canonicalGates: this.#state.canonicalGates,
      checkpoints: this.#state.checkpoints,
      executionCount,
      nextCheckpointIndex: executionCount,
      ...(this.#state.assignment ? { assignment: this.#state.assignment } : {}),
      ...(this.#state.evidenceBundleDigest
        ? { evidenceBundleDigest: this.#state.evidenceBundleDigest }
        : {}),
      ...(this.#state.abortEvidence
        ? { abortEvidence: this.#state.abortEvidence }
        : {}),
      ...(this.#state.terminalAction
        ? { terminalAction: this.#state.terminalAction }
        : {}),
      ...(this.#state.terminalOutcome
        ? { terminalOutcome: this.#state.terminalOutcome }
        : {}),
      ...(this.#state.terminalEvent
        ? { terminalEvent: this.#state.terminalEvent }
        : {}),
    });
  }

  static rehydrate(value: unknown): VerificationResult<VerificationRun> {
    if (!isJsonObject(value) || !hasJsonTopology(value))
      return failure(
        "PERSISTENCE_MEMENTO_INVALID",
        "Verification memento topology is invalid.",
      );
    if (
      value["mementoType"] !== "patchquest.verification-run" ||
      value["mementoVersion"] !== 1
    )
      return failure(
        "PERSISTENCE_VERSION_UNSUPPORTED",
        "Verification memento version is unsupported.",
      );
    if (
      !hasExactOwnKeys(
        value,
        [
          "mementoType",
          "mementoVersion",
          "status",
          "seed",
          "semanticFingerprint",
          "canonicalGates",
          "checkpoints",
          "executionCount",
          "nextCheckpointIndex",
        ],
        [
          "assignment",
          "evidenceBundleDigest",
          "abortEvidence",
          "terminalAction",
          "terminalOutcome",
          "terminalEvent",
        ],
      ) ||
      !isStartSeed(value["seed"]) ||
      typeof value["semanticFingerprint"] !== "string" ||
      !fingerprintPattern.test(value["semanticFingerprint"]) ||
      !isDenseJsonArray(value["canonicalGates"]) ||
      !value["canonicalGates"].every(isAcceptanceGate) ||
      !isDenseJsonArray(value["checkpoints"]) ||
      !isNonNegativeInteger(value["executionCount"]) ||
      !isNonNegativeInteger(value["nextCheckpointIndex"])
    )
      return failure(
        "PERSISTENCE_MEMENTO_INVALID",
        "Verification memento shape is invalid.",
      );
    const started = VerificationRun.start(value["seed"]);
    if (!started.ok)
      return failure(
        "PERSISTENCE_MEMENTO_INVALID",
        "Verification seed cannot be replayed.",
      );
    const run = started.value;
    const assignment = value["assignment"];
    if (assignment !== undefined) {
      if (!isAssignmentRecord(assignment))
        return failure(
          "PERSISTENCE_MEMENTO_INVALID",
          "Verification assignment is invalid.",
        );
      const assigned = run.assign({
        requestId: assignment.requestId,
        at: assignment.at,
        verifierId: assignment.verifierId,
        availability:
          assignment.outcome === "UNAVAILABLE" ? "UNAVAILABLE" : "AVAILABLE",
        ...(assignment.outcome === "SELF_REJECTED"
          ? { retryable: true }
          : assignment.outcome === "UNAVAILABLE" &&
              isTerminalOutcome(value["terminalOutcome"]) &&
              value["terminalOutcome"].kind === "ABORT"
            ? {
                retryable: value["terminalOutcome"].retryable,
              }
            : {}),
      });
      if (!assigned.ok)
        return failure(
          "PERSISTENCE_MEMENTO_INVALID",
          "Verification assignment cannot be replayed.",
        );
    }
    for (const checkpoint of value["checkpoints"]) {
      if (!isCheckpointRecord(checkpoint))
        return failure(
          "PERSISTENCE_MEMENTO_INVALID",
          "Verification checkpoint is invalid.",
        );
      if (checkpoint.result) {
        const recorded = run.recordCheckResult({
          requestId: checkpoint.recordedRequestId as string,
          at: checkpoint.recordedAt as string,
          checkpointKey: checkpoint.checkpointKey,
          result: checkpoint.result,
        });
        if (!recorded.ok)
          return failure(
            "PERSISTENCE_MEMENTO_INVALID",
            "Verification checkpoint cannot be replayed.",
          );
      }
    }
    const terminalAction = value["terminalAction"];
    const terminalOutcome = value["terminalOutcome"];
    if (terminalAction !== undefined || terminalOutcome !== undefined) {
      if (
        !isPrivateIdentityRecord(terminalAction) ||
        !isTerminalOutcome(terminalOutcome)
      )
        return failure(
          "PERSISTENCE_MEMENTO_INVALID",
          "Verification terminal fields are invalid.",
        );
      let terminal: VerificationResult<VerificationSnapshot>;
      if (terminalOutcome.kind === "VERDICT") {
        if (!isDigest(value["evidenceBundleDigest"]))
          return failure(
            "PERSISTENCE_MEMENTO_INVALID",
            "Verdict evidence is invalid.",
          );
        terminal = run.complete({
          ...terminalAction,
          evidenceBundleDigest: value["evidenceBundleDigest"],
        });
      } else {
        const abortEvidence = value["abortEvidence"];
        if (abortEvidence !== undefined && !isAbortEvidence(abortEvidence))
          return failure(
            "PERSISTENCE_MEMENTO_INVALID",
            "Abort evidence is invalid.",
          );
        if (run.snapshot.status !== "ABORTED")
          terminal = run.abort({
            ...terminalAction,
            reason: terminalOutcome.reason,
            retryable: terminalOutcome.retryable,
            ...(abortEvidence?.evidenceBundleDigest
              ? { evidenceBundleDigest: abortEvidence.evidenceBundleDigest }
              : {}),
            ...(abortEvidence?.detail ? { detail: abortEvidence.detail } : {}),
          });
        else terminal = success("idempotent", run.snapshot);
      }
      if (!terminal.ok)
        return failure(
          "PERSISTENCE_MEMENTO_INVALID",
          "Verification terminal state cannot be replayed.",
        );
    }
    if (canonicalizeJson(run.toMemento()) !== canonicalizeJson(value))
      return failure(
        "PERSISTENCE_MEMENTO_INVALID",
        "Verification memento does not replay exactly.",
      );
    return success("applied", run);
  }
}

function isPrivateIdentityRecord(value: unknown): value is PrivateIdentity {
  return privateIdentity(value, ["requestId", "at"]);
}

function isAssignmentRecord(value: unknown): value is AssignmentRecord {
  return (
    isJsonObject(value) &&
    hasExactOwnKeys(value, ["requestId", "at", "verifierId", "outcome"]) &&
    isIdentifier(value["requestId"]) &&
    isTimestamp(value["at"]) &&
    isIdentifier(value["verifierId"]) &&
    ["ASSIGNED", "SELF_REJECTED", "UNAVAILABLE"].includes(
      String(value["outcome"]),
    )
  );
}

function isCheckpointRecord(value: unknown): value is CheckpointRecord {
  return (
    isJsonObject(value) &&
    hasExactOwnKeys(
      value,
      ["gateId", "checkpointKey"],
      ["recordedRequestId", "recordedAt", "result"],
    ) &&
    isIdentifier(value["gateId"]) &&
    isIdentifier(value["checkpointKey"]) &&
    ((value["result"] === undefined &&
      value["recordedRequestId"] === undefined &&
      value["recordedAt"] === undefined) ||
      (value["result"] !== undefined &&
        isIdentifier(value["recordedRequestId"]) &&
        isTimestamp(value["recordedAt"])))
  );
}

function isAbortEvidence(value: unknown): value is Readonly<{
  evidenceBundleDigest?: Digest;
  detail?: string;
}> {
  return (
    isJsonObject(value) &&
    hasExactOwnKeys(value, [], ["evidenceBundleDigest", "detail"]) &&
    Reflect.ownKeys(value).length >= 1 &&
    (value["evidenceBundleDigest"] === undefined ||
      isDigest(value["evidenceBundleDigest"])) &&
    (value["detail"] === undefined || isBoundedText(value["detail"], 2000))
  );
}

function isTerminalOutcome(value: unknown): value is TerminalOutcome {
  if (!isJsonObject(value)) return false;
  if (value["kind"] === "ABORT")
    return (
      hasExactOwnKeys(value, ["kind", "reason", "retryable"]) &&
      [
        "VERIFIER_UNAVAILABLE",
        "WORKSPACE_UNAVAILABLE",
        "EXECUTION_INFRASTRUCTURE_FAILURE",
        "MISSION_CANCELLED",
      ].includes(String(value["reason"])) &&
      typeof value["retryable"] === "boolean" &&
      isAbortRetryabilityValid(
        value["reason"] as AbortReason,
        value["retryable"],
      )
    );
  return (
    value["kind"] === "VERDICT" &&
    hasExactOwnKeys(value, [
      "kind",
      "verdict",
      "checkCount",
      "failedGateIds",
    ]) &&
    (value["verdict"] === "PASSED" || value["verdict"] === "FAILED") &&
    isPositiveInteger(value["checkCount"]) &&
    isDenseJsonArray(value["failedGateIds"]) &&
    value["failedGateIds"].every(isIdentifier)
  );
}

export function isVerificationVerdictEvent(
  value: unknown,
): value is VerificationVerdictEvent {
  if (
    !isJsonObject(value) ||
    !hasJsonTopology(value) ||
    !isEventMetadata(value["metadata"]) ||
    !isIdentifier(value["verificationRunId"]) ||
    !isIdentifier(value["attemptId"]) ||
    !isBinding(value["binding"]) ||
    !isIdentifier(value["verifierId"]) ||
    !isPositiveInteger(value["checkCount"]) ||
    !isDigest(value["evidenceBundleDigest"])
  )
    return false;
  const expectedEventId = `event:${createHash("sha256")
    .update(`${value["metadata"].causationId}:${String(value["kind"])}`)
    .digest("hex")}`;
  if (value["metadata"].eventId !== expectedEventId) return false;
  if (value["kind"] === "VERIFICATION_PASSED")
    return (
      hasExactOwnKeys(value, [
        "kind",
        "metadata",
        "verificationRunId",
        "attemptId",
        "binding",
        "verifierId",
        "verdict",
        "checkCount",
        "evidenceBundleDigest",
      ]) && value["verdict"] === "PASSED"
    );
  const failedGateIds = value["failedGateIds"];
  return (
    value["kind"] === "VERIFICATION_FAILED" &&
    hasExactOwnKeys(value, [
      "kind",
      "metadata",
      "verificationRunId",
      "attemptId",
      "binding",
      "verifierId",
      "verdict",
      "checkCount",
      "failedGateIds",
      "evidenceBundleDigest",
    ]) &&
    value["verdict"] === "FAILED" &&
    isDenseJsonArray(failedGateIds) &&
    failedGateIds.length >= 1 &&
    failedGateIds.every(isIdentifier) &&
    new Set(failedGateIds).size === failedGateIds.length &&
    failedGateIds.every(
      (gateId, index) =>
        index === 0 || String(failedGateIds[index - 1]) < gateId,
    )
  );
}
