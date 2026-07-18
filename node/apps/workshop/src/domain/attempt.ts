import { createHash, timingSafeEqual } from "node:crypto";
import {
  canonicalizeJson,
  deepFreezeCopy,
  hasExactOwnKeys,
  hasJsonTopology,
  isDenseJsonArray,
  isJsonObject,
} from "./json-topology.js";

export type AttemptStatus =
  | "READY"
  | "LEASED"
  | "ARTIFACT_SUBMITTED"
  | "ABANDONED"
  | "FAILED"
  | "LEASE_EXPIRED"
  | "REVOKED";

export type AttemptOutcome = Exclude<AttemptStatus, "READY" | "LEASED">;

export interface Digest {
  readonly algorithm: "sha256";
  readonly value: string;
}

export interface AcceptanceGate {
  readonly gateId: string;
  readonly kind: "ALLOWED_SCOPE" | "LINT" | "TYPECHECK" | "TEST";
  readonly commandId:
    "check-allowed-scope" | "check-lint" | "check-typecheck" | "check-tests";
  readonly mandatory: boolean;
  readonly timeoutSeconds: number;
  readonly evidenceLimitBytes: number;
}

export interface AttemptWorkContract {
  readonly objective: string;
  readonly startingRevision: string;
  readonly workspaceReference: string;
  readonly allowedScope: Readonly<{ pathPatterns: readonly string[] }>;
  readonly requestedCapabilities: readonly string[];
  readonly acceptanceGates: readonly AcceptanceGate[];
  readonly gateSetDigest: Digest;
}

export interface MessageIdentity {
  readonly messageId: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly at: string;
}

export interface CreateAttempt extends MessageIdentity {
  readonly missionId: string;
  readonly missionRevision: number;
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly attemptBudget: number;
  readonly workContract: AttemptWorkContract;
}

export interface LeaseAttempt extends MessageIdentity {
  readonly runnerId: string;
  readonly runnerCapabilities: readonly string[];
  readonly requestedLeaseSeconds: number;
  readonly leaseId: string;
  readonly leaseToken: string;
}

export interface LeaseOwnerCommand extends MessageIdentity {
  readonly runnerId: string;
  readonly leaseToken: string;
}

export interface Artifact {
  readonly reference: string;
  readonly digest: Digest;
  readonly changedPaths: readonly string[];
}

export interface SubmitArtifact extends LeaseOwnerCommand {
  readonly missionId: string;
  readonly missionRevision: number;
  readonly attemptId: string;
  readonly startingRevision: string;
  readonly artifact: Artifact;
  readonly gateSetDigest: Digest;
}

export interface EndOwnedAttempt extends LeaseOwnerCommand {
  readonly reason: string;
}

export type ExpireLease = MessageIdentity;

export interface RevokeAttempt extends MessageIdentity {
  readonly missionId: string;
  readonly missionRevision: number;
  readonly attemptId: string;
  readonly reason: "MISSION_CANCELLED";
}

export interface LeaseTokenVerifier {
  readonly algorithm: "sha256";
  readonly digest: string;
}

export interface RunnerLeaseState {
  readonly leaseId: string;
  readonly runnerId: string;
  readonly runnerCapabilities: readonly string[];
  readonly originalDurationSeconds: number;
  readonly leasedAt: string;
  readonly lastHeartbeatAt: string;
  readonly expiresAt: string;
  readonly tokenVerifier: LeaseTokenVerifier;
}

export interface ArtifactSubmissionReceipt {
  readonly attemptId: string;
  readonly artifactDigest: Digest;
  readonly outcome: "ARTIFACT_SUBMITTED";
  readonly recordedAt: string;
}

export interface AttemptEventMetadata {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
}

export type AttemptDomainEvent =
  | Readonly<{ kind: "ATTEMPT_READY"; metadata: AttemptEventMetadata }>
  | Readonly<{
      kind: "ATTEMPT_LEASED";
      metadata: AttemptEventMetadata;
      leaseId: string;
      runnerId: string;
      runnerCapabilities: readonly string[];
      expiresAt: string;
    }>
  | Readonly<{
      kind: "ARTIFACT_SUBMITTED";
      metadata: AttemptEventMetadata;
      runnerId: string;
      artifact: Artifact;
    }>
  | Readonly<{
      kind: "ATTEMPT_ENDED";
      metadata: AttemptEventMetadata;
      outcome: AttemptOutcome;
      reason?: string;
    }>;

export type AttemptErrorCode =
  | "INVALID_ATTEMPT"
  | "ATTEMPT_ALREADY_EXISTS"
  | "ATTEMPT_NOT_FOUND"
  | "UNSUPPORTED_TRANSITION"
  | "ATTEMPT_TERMINAL"
  | "CAPABILITIES_INSUFFICIENT"
  | "LEASE_DURATION_INVALID"
  | "LEASE_AUTHORIZATION_FAILED"
  | "LEASE_EXPIRED"
  | "LEASE_NOT_EXPIRED"
  | "ARTIFACT_BINDING_MISMATCH"
  | "ARTIFACT_DIGEST_CONFLICT"
  | "MESSAGE_ID_CONFLICT"
  | "TRANSITION_PROVENANCE_INVALID"
  | "TRANSITION_CHRONOLOGY_INVALID"
  | "PERSISTENCE_MEMENTO_INVALID"
  | "PERSISTENCE_VERSION_UNSUPPORTED";

export type AttemptResult<Value> =
  | Readonly<{
      ok: true;
      disposition: "applied" | "idempotent";
      value: Value;
      events: readonly AttemptDomainEvent[];
    }>
  | Readonly<{
      ok: false;
      error: Readonly<{ code: AttemptErrorCode; message: string }>;
    }>;

export interface AttemptSnapshot {
  readonly attemptId: string;
  readonly missionId: string;
  readonly missionRevision: number;
  readonly attemptNumber: number;
  readonly attemptBudget: number;
  readonly status: AttemptStatus;
  readonly workContract: AttemptWorkContract;
  readonly lease?: Omit<RunnerLeaseState, "tokenVerifier">;
  readonly artifact?: Artifact;
  readonly receipt?: ArtifactSubmissionReceipt;
  readonly outcome?: AttemptOutcome;
  readonly outcomeReason?: string;
}

type AttemptTransition =
  | Readonly<{
      kind: "CREATED";
      identity: MessageIdentity;
      events: readonly AttemptDomainEvent[];
    }>
  | Readonly<{
      kind: "LEASED";
      identity: MessageIdentity;
      events: readonly AttemptDomainEvent[];
      leaseId: string;
      runnerId: string;
      runnerCapabilities: readonly string[];
      originalDurationSeconds: number;
      expiresAt: string;
    }>
  | Readonly<{
      kind: "HEARTBEAT";
      identity: MessageIdentity;
      events: readonly AttemptDomainEvent[];
      expiresAt: string;
    }>
  | Readonly<{
      kind: "TERMINATED";
      identity: MessageIdentity;
      events: readonly AttemptDomainEvent[];
      outcome: AttemptOutcome;
      reason?: string;
    }>;

export interface AttemptMementoV1 {
  readonly mementoType: "patchquest.workshop-attempt";
  readonly mementoVersion: 1;
  readonly status: AttemptStatus;
  readonly seed: CreateAttempt;
  readonly lease?: RunnerLeaseState;
  readonly artifact?: Artifact;
  readonly receipt?: ArtifactSubmissionReceipt;
  readonly outcome?: AttemptOutcome;
  readonly outcomeReason?: string;
  readonly transitions: readonly AttemptTransition[];
}

interface MutableState {
  status: AttemptStatus;
  seed: CreateAttempt;
  lease?: RunnerLeaseState | undefined;
  artifact?: Artifact | undefined;
  receipt?: ArtifactSubmissionReceipt | undefined;
  outcome?: AttemptOutcome | undefined;
  outcomeReason?: string | undefined;
  transitions: AttemptTransition[];
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const terminalStatuses = new Set<AttemptStatus>([
  "ARTIFACT_SUBMITTED",
  "ABANDONED",
  "FAILED",
  "LEASE_EXPIRED",
  "REVOKED",
]);

function failure<Value>(
  code: AttemptErrorCode,
  message: string,
): AttemptResult<Value> {
  return { ok: false, error: { code, message } };
}

function success<Value>(
  disposition: "applied" | "idempotent",
  value: Value,
  events: readonly AttemptDomainEvent[] = [],
): AttemptResult<Value> {
  return {
    ok: true,
    disposition,
    value,
    events: Object.freeze([...events]),
  };
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" && value.length >= 1 && value.length <= maximum
  );
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4})-(\d\d)-(\d\d)[Tt](\d\d):(\d\d):(\d\d(?:\.\d+)?)([Zz]|([+-])(\d\d):(\d\d))$/.exec(
      value,
    );
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const timezoneHour = Number(match[9] ?? 0);
  const timezoneMinute = Number(match[10] ?? 0);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (days[month] ?? 0) &&
    hour <= 23 &&
    minute <= 59 &&
    second < 60 &&
    timezoneHour <= 23 &&
    timezoneMinute <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}

function timestampMilliseconds(value: string): number {
  return Date.parse(value);
}

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

function isMessageIdentity(value: unknown): value is MessageIdentity {
  return (
    isJsonObject(value) &&
    hasExactOwnKeys(value, [
      "messageId",
      "correlationId",
      "causationId",
      "at",
    ]) &&
    isIdentifier(value["messageId"]) &&
    isIdentifier(value["correlationId"]) &&
    isIdentifier(value["causationId"]) &&
    isTimestamp(value["at"])
  );
}

export function isScopePattern(value: unknown): value is string {
  if (
    !isBoundedText(value, 512) ||
    value.startsWith("/") ||
    /^[A-Za-z]:/u.test(value) ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value.normalize("NFC") !== value
  )
    return false;
  return value
    .split("/")
    .every((part) => part.length > 0 && part !== "." && part !== "..");
}

export function isRepositoryPath(value: unknown): value is string {
  return (
    isScopePattern(value) &&
    !value.includes("*") &&
    !value.includes("?") &&
    !value.includes("[") &&
    !value.includes("]")
  );
}

function isAcceptanceGate(value: unknown): value is AcceptanceGate {
  const commandByKind: Readonly<Record<string, string>> = {
    ALLOWED_SCOPE: "check-allowed-scope",
    LINT: "check-lint",
    TYPECHECK: "check-typecheck",
    TEST: "check-tests",
  };
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
    commandByKind[String(value["kind"])] === value["commandId"] &&
    typeof value["mandatory"] === "boolean" &&
    isPositiveInteger(value["timeoutSeconds"]) &&
    Number(value["timeoutSeconds"]) <= 3600 &&
    Number.isSafeInteger(value["evidenceLimitBytes"]) &&
    Number(value["evidenceLimitBytes"]) >= 0 &&
    Number(value["evidenceLimitBytes"]) <= 1_048_576
  );
}

export function calculateGateSetDigest(
  gates: readonly AcceptanceGate[],
): Digest {
  const sorted = [...gates].sort((left, right) =>
    left.gateId < right.gateId ? -1 : left.gateId > right.gateId ? 1 : 0,
  );
  return {
    algorithm: "sha256",
    value: createHash("sha256").update(canonicalizeJson(sorted)).digest("hex"),
  };
}

export function isAttemptWorkContract(
  value: unknown,
): value is AttemptWorkContract {
  if (
    !isJsonObject(value) ||
    !hasExactOwnKeys(value, [
      "objective",
      "startingRevision",
      "workspaceReference",
      "allowedScope",
      "requestedCapabilities",
      "acceptanceGates",
      "gateSetDigest",
    ]) ||
    !isBoundedText(value["objective"], 2000) ||
    !isBoundedText(value["startingRevision"], 256) ||
    !isBoundedText(value["workspaceReference"], 2048) ||
    !isJsonObject(value["allowedScope"]) ||
    !hasExactOwnKeys(value["allowedScope"], ["pathPatterns"]) ||
    !isDenseJsonArray(value["allowedScope"]["pathPatterns"]) ||
    value["allowedScope"]["pathPatterns"].length < 1 ||
    !value["allowedScope"]["pathPatterns"].every(isScopePattern) ||
    new Set(value["allowedScope"]["pathPatterns"]).size !==
      value["allowedScope"]["pathPatterns"].length ||
    !isDenseJsonArray(value["requestedCapabilities"]) ||
    value["requestedCapabilities"].length < 1 ||
    !value["requestedCapabilities"].every(isIdentifier) ||
    new Set(value["requestedCapabilities"]).size !==
      value["requestedCapabilities"].length ||
    !isDenseJsonArray(value["acceptanceGates"]) ||
    value["acceptanceGates"].length < 1 ||
    !value["acceptanceGates"].every(isAcceptanceGate) ||
    new Set(value["acceptanceGates"].map((gate) => gate.gateId)).size !==
      value["acceptanceGates"].length ||
    !isDigest(value["gateSetDigest"])
  )
    return false;
  try {
    new URL(value["workspaceReference"]);
    return sameDigest(
      calculateGateSetDigest(value["acceptanceGates"]),
      value["gateSetDigest"],
    );
  } catch {
    return false;
  }
}

function isCreateAttempt(value: unknown): value is CreateAttempt {
  return (
    isJsonObject(value) &&
    hasExactOwnKeys(value, [
      "messageId",
      "correlationId",
      "causationId",
      "at",
      "missionId",
      "missionRevision",
      "attemptId",
      "attemptNumber",
      "attemptBudget",
      "workContract",
    ]) &&
    isMessageIdentity({
      messageId: value["messageId"],
      correlationId: value["correlationId"],
      causationId: value["causationId"],
      at: value["at"],
    }) &&
    isIdentifier(value["missionId"]) &&
    isPositiveInteger(value["missionRevision"]) &&
    isIdentifier(value["attemptId"]) &&
    isPositiveInteger(value["attemptNumber"]) &&
    isPositiveInteger(value["attemptBudget"]) &&
    Number(value["attemptNumber"]) <= Number(value["attemptBudget"]) &&
    isAttemptWorkContract(value["workContract"]) &&
    hasJsonTopology(value)
  );
}

function copyIdentity(value: MessageIdentity): MessageIdentity {
  return Object.freeze({
    messageId: value.messageId,
    correlationId: value.correlationId,
    causationId: value.causationId,
    at: value.at,
  });
}

function eventMetadata(
  identity: MessageIdentity,
  eventKind: AttemptDomainEvent["kind"],
  causationId = identity.messageId,
): AttemptEventMetadata {
  return deepFreezeCopy({
    eventId: `event:${createHash("sha256")
      .update(`${identity.messageId}:${eventKind}`)
      .digest("hex")}`,
    occurredAt: identity.at,
    correlationId: identity.correlationId,
    causationId,
  });
}

function isEventMetadata(value: unknown): value is AttemptEventMetadata {
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

function isDomainEvent(value: unknown): value is AttemptDomainEvent {
  if (
    !isJsonObject(value) ||
    !hasJsonTopology(value) ||
    !isEventMetadata(value["metadata"])
  )
    return false;
  switch (value["kind"]) {
    case "ATTEMPT_READY":
      return hasExactOwnKeys(value, ["kind", "metadata"]);
    case "ATTEMPT_LEASED":
      return (
        hasExactOwnKeys(value, [
          "kind",
          "metadata",
          "leaseId",
          "runnerId",
          "runnerCapabilities",
          "expiresAt",
        ]) &&
        isIdentifier(value["leaseId"]) &&
        isIdentifier(value["runnerId"]) &&
        isDenseJsonArray(value["runnerCapabilities"]) &&
        value["runnerCapabilities"].length >= 1 &&
        value["runnerCapabilities"].every(isIdentifier) &&
        new Set(value["runnerCapabilities"]).size ===
          value["runnerCapabilities"].length &&
        isTimestamp(value["expiresAt"])
      );
    case "ARTIFACT_SUBMITTED":
      return (
        hasExactOwnKeys(value, ["kind", "metadata", "runnerId", "artifact"]) &&
        isIdentifier(value["runnerId"]) &&
        isArtifact(value["artifact"])
      );
    case "ATTEMPT_ENDED":
      return (
        hasExactOwnKeys(value, ["kind", "metadata", "outcome"], ["reason"]) &&
        terminalStatuses.has(value["outcome"] as AttemptStatus) &&
        (value["reason"] === undefined || isBoundedText(value["reason"], 1000))
      );
    default:
      return false;
  }
}

function isEventList(value: unknown): value is readonly AttemptDomainEvent[] {
  return isDenseJsonArray(value) && value.every(isDomainEvent);
}

function tokenVerifier(token: string): LeaseTokenVerifier {
  return Object.freeze({
    algorithm: "sha256",
    digest: createHash("sha256").update(token).digest("hex"),
  });
}

function validLeaseToken(token: unknown): token is string {
  return typeof token === "string" && token.length >= 32 && token.length <= 512;
}

function tokenMatches(token: string, verifier: LeaseTokenVerifier): boolean {
  const presented = Buffer.from(tokenVerifier(token).digest, "hex");
  const expected = Buffer.from(verifier.digest, "hex");
  return (
    presented.length === expected.length && timingSafeEqual(presented, expected)
  );
}

function isLeaseTokenVerifier(value: unknown): value is LeaseTokenVerifier {
  return (
    isJsonObject(value) &&
    hasExactOwnKeys(value, ["algorithm", "digest"]) &&
    value["algorithm"] === "sha256" &&
    typeof value["digest"] === "string" &&
    digestPattern.test(value["digest"])
  );
}

export function isArtifact(value: unknown): value is Artifact {
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

function isLeaseOwnerCommand(
  value: unknown,
  required: readonly string[],
): value is LeaseOwnerCommand {
  return (
    isJsonObject(value) &&
    hasExactOwnKeys(value, [...required]) &&
    isIdentifier(value["messageId"]) &&
    isIdentifier(value["correlationId"]) &&
    isIdentifier(value["causationId"]) &&
    isTimestamp(value["at"]) &&
    isIdentifier(value["runnerId"]) &&
    validLeaseToken(value["leaseToken"]) &&
    hasJsonTopology(value)
  );
}

function isTransition(value: unknown): value is AttemptTransition {
  if (!isJsonObject(value) || !hasJsonTopology(value)) return false;
  switch (value["kind"]) {
    case "CREATED":
      return (
        hasExactOwnKeys(value, ["kind", "identity", "events"]) &&
        isMessageIdentity(value["identity"]) &&
        isEventList(value["events"])
      );
    case "LEASED":
      return (
        hasExactOwnKeys(value, [
          "kind",
          "identity",
          "events",
          "leaseId",
          "runnerId",
          "runnerCapabilities",
          "originalDurationSeconds",
          "expiresAt",
        ]) &&
        isMessageIdentity(value["identity"]) &&
        isEventList(value["events"]) &&
        isIdentifier(value["leaseId"]) &&
        isIdentifier(value["runnerId"]) &&
        isDenseJsonArray(value["runnerCapabilities"]) &&
        value["runnerCapabilities"].length >= 1 &&
        value["runnerCapabilities"].every(isIdentifier) &&
        new Set(value["runnerCapabilities"]).size ===
          value["runnerCapabilities"].length &&
        isPositiveInteger(value["originalDurationSeconds"]) &&
        Number(value["originalDurationSeconds"]) <= 3600 &&
        isTimestamp(value["expiresAt"])
      );
    case "HEARTBEAT":
      return (
        hasExactOwnKeys(value, ["kind", "identity", "events", "expiresAt"]) &&
        isMessageIdentity(value["identity"]) &&
        isEventList(value["events"]) &&
        isTimestamp(value["expiresAt"])
      );
    case "TERMINATED":
      return (
        hasExactOwnKeys(
          value,
          ["kind", "identity", "events", "outcome"],
          ["reason"],
        ) &&
        isMessageIdentity(value["identity"]) &&
        isEventList(value["events"]) &&
        terminalStatuses.has(value["outcome"] as AttemptStatus) &&
        (value["reason"] === undefined || isBoundedText(value["reason"], 1000))
      );
    default:
      return false;
  }
}

export class Attempt {
  readonly #state: MutableState;

  private constructor(state: MutableState) {
    this.#state = state;
  }

  static create(command: CreateAttempt): AttemptResult<Attempt> {
    if (!isCreateAttempt(command))
      return failure("INVALID_ATTEMPT", "Create-attempt input is invalid.");
    const seed = deepFreezeCopy(command);
    const readyEvent: AttemptDomainEvent = deepFreezeCopy({
      kind: "ATTEMPT_READY",
      metadata: eventMetadata(seed, "ATTEMPT_READY"),
    });
    const attempt = new Attempt({
      status: "READY",
      seed,
      transitions: [
        deepFreezeCopy({
          kind: "CREATED",
          identity: copyIdentity(seed),
          events: [readyEvent],
        }),
      ],
    });
    return success("applied", attempt, [readyEvent]);
  }

  get snapshot(): AttemptSnapshot {
    const { seed } = this.#state;
    return deepFreezeCopy({
      attemptId: seed.attemptId,
      missionId: seed.missionId,
      missionRevision: seed.missionRevision,
      attemptNumber: seed.attemptNumber,
      attemptBudget: seed.attemptBudget,
      status: this.#state.status,
      workContract: seed.workContract,
      ...(this.#state.lease
        ? {
            lease: {
              leaseId: this.#state.lease.leaseId,
              runnerId: this.#state.lease.runnerId,
              runnerCapabilities: this.#state.lease.runnerCapabilities,
              originalDurationSeconds:
                this.#state.lease.originalDurationSeconds,
              leasedAt: this.#state.lease.leasedAt,
              lastHeartbeatAt: this.#state.lease.lastHeartbeatAt,
              expiresAt: this.#state.lease.expiresAt,
            },
          }
        : {}),
      ...(this.#state.artifact ? { artifact: this.#state.artifact } : {}),
      ...(this.#state.receipt ? { receipt: this.#state.receipt } : {}),
      ...(this.#state.outcome ? { outcome: this.#state.outcome } : {}),
      ...(this.#state.outcomeReason
        ? { outcomeReason: this.#state.outcomeReason }
        : {}),
    });
  }

  lease(
    command: LeaseAttempt,
  ): AttemptResult<
    Readonly<{ snapshot: AttemptSnapshot; leaseToken: string }>
  > {
    if (
      !isJsonObject(command) ||
      !hasExactOwnKeys(command, [
        "messageId",
        "correlationId",
        "causationId",
        "at",
        "runnerId",
        "runnerCapabilities",
        "requestedLeaseSeconds",
        "leaseId",
        "leaseToken",
      ]) ||
      !isMessageIdentity({
        messageId: command["messageId"],
        correlationId: command["correlationId"],
        causationId: command["causationId"],
        at: command["at"],
      }) ||
      !isIdentifier(command["runnerId"]) ||
      !isDenseJsonArray(command["runnerCapabilities"]) ||
      command["runnerCapabilities"].length < 1 ||
      !command["runnerCapabilities"].every(isIdentifier) ||
      new Set(command["runnerCapabilities"]).size !==
        command["runnerCapabilities"].length ||
      !isIdentifier(command["leaseId"]) ||
      !validLeaseToken(command["leaseToken"]) ||
      !Number.isSafeInteger(command["requestedLeaseSeconds"]) ||
      !hasJsonTopology(command)
    )
      return failure("INVALID_ATTEMPT", "Lease input is invalid.");
    if (terminalStatuses.has(this.#state.status))
      return failure("ATTEMPT_TERMINAL", "A terminal attempt is immutable.");
    if (this.#state.status !== "READY")
      return failure(
        "UNSUPPORTED_TRANSITION",
        "Only a ready attempt may be leased.",
      );
    if (
      command.requestedLeaseSeconds < 1 ||
      command.requestedLeaseSeconds > 3600
    )
      return failure(
        "LEASE_DURATION_INVALID",
        "Lease duration must be between 1 and 3600 seconds.",
      );
    const capabilities = new Set(command.runnerCapabilities);
    if (
      !this.#state.seed.workContract.requestedCapabilities.every((capability) =>
        capabilities.has(capability),
      )
    )
      return failure(
        "CAPABILITIES_INSUFFICIENT",
        "Runner capabilities do not cover the work contract.",
      );
    const identityError = this.#validateNextIdentity(command, "PRIVATE", [
      "ATTEMPT_LEASED",
    ]);
    if (identityError) return identityError;
    const expiresAt = new Date(
      timestampMilliseconds(command.at) + command.requestedLeaseSeconds * 1000,
    ).toISOString();
    this.#state.lease = deepFreezeCopy({
      leaseId: command.leaseId,
      runnerId: command.runnerId,
      runnerCapabilities: command.runnerCapabilities,
      originalDurationSeconds: command.requestedLeaseSeconds,
      leasedAt: command.at,
      lastHeartbeatAt: command.at,
      expiresAt,
      tokenVerifier: tokenVerifier(command.leaseToken),
    });
    this.#state.status = "LEASED";
    const event: AttemptDomainEvent = deepFreezeCopy({
      kind: "ATTEMPT_LEASED",
      metadata: eventMetadata(command, "ATTEMPT_LEASED"),
      leaseId: command.leaseId,
      runnerId: command.runnerId,
      runnerCapabilities: deepFreezeCopy(command.runnerCapabilities),
      expiresAt,
    });
    this.#state.transitions.push(
      deepFreezeCopy({
        kind: "LEASED",
        identity: copyIdentity(command),
        events: [event],
        leaseId: command.leaseId,
        runnerId: command.runnerId,
        runnerCapabilities: command.runnerCapabilities,
        originalDurationSeconds: command.requestedLeaseSeconds,
        expiresAt,
      }),
    );
    return success(
      "applied",
      Object.freeze({
        snapshot: this.snapshot,
        leaseToken: command.leaseToken,
      }),
      [event],
    );
  }

  heartbeat(command: LeaseOwnerCommand): AttemptResult<AttemptSnapshot> {
    if (
      !isLeaseOwnerCommand(command, [
        "messageId",
        "correlationId",
        "causationId",
        "at",
        "runnerId",
        "leaseToken",
      ])
    )
      return failure("INVALID_ATTEMPT", "Heartbeat input is invalid.");
    const authorized = this.#authorizeOwner(command, true);
    if (authorized) return authorized;
    const lease = this.#state.lease as RunnerLeaseState;
    const expiresAt = new Date(
      timestampMilliseconds(command.at) + lease.originalDurationSeconds * 1000,
    ).toISOString();
    this.#state.lease = deepFreezeCopy({
      ...lease,
      lastHeartbeatAt: command.at,
      expiresAt,
    });
    this.#state.transitions.push(
      deepFreezeCopy({
        kind: "HEARTBEAT",
        identity: copyIdentity(command),
        events: [],
        expiresAt,
      }),
    );
    return success("applied", this.snapshot);
  }

  submit(command: SubmitArtifact): AttemptResult<ArtifactSubmissionReceipt> {
    if (
      !isLeaseOwnerCommand(command, [
        "messageId",
        "correlationId",
        "causationId",
        "at",
        "runnerId",
        "leaseToken",
        "missionId",
        "missionRevision",
        "attemptId",
        "startingRevision",
        "artifact",
        "gateSetDigest",
      ]) ||
      !isIdentifier(command.missionId) ||
      !isPositiveInteger(command.missionRevision) ||
      !isIdentifier(command.attemptId) ||
      !isBoundedText(command.startingRevision, 256) ||
      !isArtifact(command.artifact) ||
      !isDigest(command.gateSetDigest)
    )
      return failure(
        "INVALID_ATTEMPT",
        "Artifact submission input is invalid.",
      );
    const lease = this.#state.lease;
    if (
      !lease ||
      lease.runnerId !== command.runnerId ||
      !tokenMatches(command.leaseToken, lease.tokenVerifier)
    )
      return failure(
        "LEASE_AUTHORIZATION_FAILED",
        "The runner does not own the lease.",
      );
    const seed = this.#state.seed;
    if (
      command.missionId !== seed.missionId ||
      command.missionRevision !== seed.missionRevision ||
      command.attemptId !== seed.attemptId ||
      command.startingRevision !== seed.workContract.startingRevision ||
      !sameDigest(command.gateSetDigest, seed.workContract.gateSetDigest)
    )
      return failure(
        "ARTIFACT_BINDING_MISMATCH",
        "Artifact submission does not match the immutable attempt binding.",
      );
    const provenanceError = this.#validateIdentityProvenance(
      command,
      "PRIVATE",
    );
    if (provenanceError) return provenanceError;
    if (
      this.#state.status === "ARTIFACT_SUBMITTED" &&
      this.#state.receipt &&
      this.#state.artifact
    ) {
      return sameDigest(command.artifact.digest, this.#state.artifact.digest)
        ? success("idempotent", this.#state.receipt)
        : failure(
            "ARTIFACT_DIGEST_CONFLICT",
            "A different artifact digest cannot replace the recorded artifact.",
          );
    }
    if (terminalStatuses.has(this.#state.status))
      return failure("ATTEMPT_TERMINAL", "A terminal attempt is immutable.");
    if (this.#state.status !== "LEASED")
      return failure(
        "UNSUPPORTED_TRANSITION",
        "Only a leased attempt may submit an artifact.",
      );
    const identityError = this.#validateNextIdentity(command, "PRIVATE", [
      "ARTIFACT_SUBMITTED",
      "ATTEMPT_ENDED",
    ]);
    if (identityError) return identityError;
    if (
      timestampMilliseconds(command.at) >=
      timestampMilliseconds(lease.expiresAt)
    )
      return failure("LEASE_EXPIRED", "The lease is expired.");
    const artifact = deepFreezeCopy(command.artifact);
    const receipt = deepFreezeCopy({
      attemptId: seed.attemptId,
      artifactDigest: artifact.digest,
      outcome: "ARTIFACT_SUBMITTED" as const,
      recordedAt: command.at,
    });
    this.#state.status = "ARTIFACT_SUBMITTED";
    this.#state.artifact = artifact;
    this.#state.receipt = receipt;
    this.#state.outcome = "ARTIFACT_SUBMITTED";
    const artifactEvent: AttemptDomainEvent = deepFreezeCopy({
      kind: "ARTIFACT_SUBMITTED",
      metadata: eventMetadata(command, "ARTIFACT_SUBMITTED"),
      runnerId: command.runnerId,
      artifact,
    });
    const endedEvent: AttemptDomainEvent = deepFreezeCopy({
      kind: "ATTEMPT_ENDED",
      metadata: eventMetadata(
        command,
        "ATTEMPT_ENDED",
        artifactEvent.metadata.eventId,
      ),
      outcome: "ARTIFACT_SUBMITTED",
    });
    this.#state.transitions.push(
      deepFreezeCopy({
        kind: "TERMINATED",
        identity: copyIdentity(command),
        events: [artifactEvent, endedEvent],
        outcome: "ARTIFACT_SUBMITTED",
      }),
    );
    return success("applied", receipt, [artifactEvent, endedEvent]);
  }

  abandon(command: EndOwnedAttempt): AttemptResult<AttemptSnapshot> {
    return this.#endOwned(command, "ABANDONED");
  }

  fail(command: EndOwnedAttempt): AttemptResult<AttemptSnapshot> {
    return this.#endOwned(command, "FAILED");
  }

  expire(command: ExpireLease): AttemptResult<AttemptSnapshot> {
    if (!isMessageIdentity(command) || !hasJsonTopology(command))
      return failure("INVALID_ATTEMPT", "Expire-lease input is invalid.");
    if (terminalStatuses.has(this.#state.status))
      return failure("ATTEMPT_TERMINAL", "A terminal attempt is immutable.");
    if (this.#state.status !== "LEASED" || !this.#state.lease)
      return failure(
        "UNSUPPORTED_TRANSITION",
        "Only a leased attempt may expire.",
      );
    const identityError = this.#validateNextIdentity(command, "PRIVATE", [
      "ATTEMPT_ENDED",
    ]);
    if (identityError) return identityError;
    if (
      timestampMilliseconds(command.at) <
      timestampMilliseconds(this.#state.lease.expiresAt)
    )
      return failure("LEASE_NOT_EXPIRED", "The lease has not expired.");
    return this.#terminate(command, "LEASE_EXPIRED", "Lease expired.");
  }

  revoke(command: RevokeAttempt): AttemptResult<AttemptSnapshot> {
    if (
      !isJsonObject(command) ||
      !hasExactOwnKeys(command, [
        "messageId",
        "correlationId",
        "causationId",
        "at",
        "missionId",
        "missionRevision",
        "attemptId",
        "reason",
      ]) ||
      !isMessageIdentity({
        messageId: command["messageId"],
        correlationId: command["correlationId"],
        causationId: command["causationId"],
        at: command["at"],
      }) ||
      !isIdentifier(command["missionId"]) ||
      !isPositiveInteger(command["missionRevision"]) ||
      !isIdentifier(command["attemptId"]) ||
      command["reason"] !== "MISSION_CANCELLED" ||
      !hasJsonTopology(command)
    )
      return failure("INVALID_ATTEMPT", "Revoke-attempt input is invalid.");
    if (
      command.missionId !== this.#state.seed.missionId ||
      command.missionRevision !== this.#state.seed.missionRevision ||
      command.attemptId !== this.#state.seed.attemptId
    )
      return failure(
        "ARTIFACT_BINDING_MISMATCH",
        "Revocation does not match the immutable attempt binding.",
      );
    if (terminalStatuses.has(this.#state.status))
      return failure("ATTEMPT_TERMINAL", "A terminal attempt is immutable.");
    if (this.#state.status !== "READY" && this.#state.status !== "LEASED")
      return failure(
        "UNSUPPORTED_TRANSITION",
        "Only a ready or leased attempt may be revoked.",
      );
    const identityError = this.#validateNextIdentity(command, "PUBLIC", [
      "ATTEMPT_ENDED",
    ]);
    if (identityError) return identityError;
    return this.#terminate(command, "REVOKED", command.reason);
  }

  #authorizeOwner(
    command: LeaseOwnerCommand,
    requireUnexpired: boolean,
    eventKinds: readonly AttemptDomainEvent["kind"][] = [],
  ): AttemptResult<never> | undefined {
    if (terminalStatuses.has(this.#state.status))
      return failure("ATTEMPT_TERMINAL", "A terminal attempt is immutable.");
    if (this.#state.status !== "LEASED" || !this.#state.lease)
      return failure(
        "UNSUPPORTED_TRANSITION",
        "The attempt has no active lease.",
      );
    if (
      this.#state.lease.runnerId !== command.runnerId ||
      !tokenMatches(command.leaseToken, this.#state.lease.tokenVerifier)
    )
      return failure(
        "LEASE_AUTHORIZATION_FAILED",
        "The runner does not own the lease.",
      );
    const identityError = this.#validateNextIdentity(
      command,
      "PRIVATE",
      eventKinds,
    );
    if (identityError) return identityError;
    if (
      requireUnexpired &&
      timestampMilliseconds(command.at) >=
        timestampMilliseconds(this.#state.lease.expiresAt)
    )
      return failure("LEASE_EXPIRED", "The lease is expired.");
    return undefined;
  }

  #validateNextIdentity(
    identity: MessageIdentity,
    source: "PRIVATE" | "PUBLIC",
    eventKinds: readonly AttemptDomainEvent["kind"][] = [],
  ): AttemptResult<never> | undefined {
    const provenanceError = this.#validateIdentityProvenance(identity, source);
    if (provenanceError) return provenanceError;
    const recordedIds = new Set(
      this.#state.transitions.flatMap((transition) => [
        transition.identity.messageId,
        ...transition.events.map((event) => event.metadata.eventId),
      ]),
    );
    const eventIds = eventKinds.map(
      (eventKind) => eventMetadata(identity, eventKind).eventId,
    );
    if (
      recordedIds.has(identity.messageId) ||
      eventIds.some((eventId) => recordedIds.has(eventId)) ||
      new Set([identity.messageId, ...eventIds]).size !== eventIds.length + 1
    )
      return failure(
        "MESSAGE_ID_CONFLICT",
        "Transition message and event IDs must be unique for this attempt.",
      );
    const latest = this.#state.transitions.at(-1);
    if (
      latest &&
      timestampMilliseconds(identity.at) <
        timestampMilliseconds(latest.identity.at)
    )
      return failure(
        "TRANSITION_CHRONOLOGY_INVALID",
        "Attempt transitions cannot move authoritative time backwards.",
      );
    return undefined;
  }

  #validateIdentityProvenance(
    identity: MessageIdentity,
    source: "PRIVATE" | "PUBLIC",
  ): AttemptResult<never> | undefined {
    if (identity.correlationId !== this.#state.seed.correlationId)
      return failure(
        "TRANSITION_PROVENANCE_INVALID",
        "Transition correlation must match the attempt seed.",
      );
    if (source === "PRIVATE" && identity.causationId !== identity.messageId)
      return failure(
        "TRANSITION_PROVENANCE_INVALID",
        "Private transition causation must equal its request ID.",
      );
    return undefined;
  }

  #endOwned(
    command: EndOwnedAttempt,
    outcome: "ABANDONED" | "FAILED",
  ): AttemptResult<AttemptSnapshot> {
    if (
      !isLeaseOwnerCommand(command, [
        "messageId",
        "correlationId",
        "causationId",
        "at",
        "runnerId",
        "leaseToken",
        "reason",
      ]) ||
      !isBoundedText(command.reason, 1000)
    )
      return failure("INVALID_ATTEMPT", "Owner terminal input is invalid.");
    const authorized = this.#authorizeOwner(command, true, ["ATTEMPT_ENDED"]);
    if (authorized) return authorized;
    return this.#terminate(command, outcome, command.reason);
  }

  #terminate(
    identity: MessageIdentity,
    outcome: AttemptOutcome,
    reason?: string,
  ): AttemptResult<AttemptSnapshot> {
    this.#state.status = outcome;
    this.#state.outcome = outcome;
    this.#state.outcomeReason = reason;
    const event: AttemptDomainEvent = deepFreezeCopy({
      kind: "ATTEMPT_ENDED",
      metadata: eventMetadata(identity, "ATTEMPT_ENDED"),
      outcome,
      ...(reason ? { reason } : {}),
    });
    this.#state.transitions.push(
      deepFreezeCopy({
        kind: "TERMINATED",
        identity: copyIdentity(identity),
        events: [event],
        outcome,
        ...(reason ? { reason } : {}),
      }),
    );
    return success("applied", this.snapshot, [event]);
  }

  toMemento(): AttemptMementoV1 {
    return deepFreezeCopy({
      mementoType: "patchquest.workshop-attempt" as const,
      mementoVersion: 1 as const,
      status: this.#state.status,
      seed: this.#state.seed,
      ...(this.#state.lease ? { lease: this.#state.lease } : {}),
      ...(this.#state.artifact ? { artifact: this.#state.artifact } : {}),
      ...(this.#state.receipt ? { receipt: this.#state.receipt } : {}),
      ...(this.#state.outcome ? { outcome: this.#state.outcome } : {}),
      ...(this.#state.outcomeReason
        ? { outcomeReason: this.#state.outcomeReason }
        : {}),
      transitions: this.#state.transitions,
    });
  }

  static rehydrate(value: unknown): AttemptResult<Attempt> {
    if (!isJsonObject(value) || !hasJsonTopology(value))
      return failure(
        "PERSISTENCE_MEMENTO_INVALID",
        "Attempt memento topology is invalid.",
      );
    if (
      value["mementoType"] !== "patchquest.workshop-attempt" ||
      value["mementoVersion"] !== 1
    )
      return failure(
        "PERSISTENCE_VERSION_UNSUPPORTED",
        "Attempt memento version is unsupported.",
      );
    if (
      !hasExactOwnKeys(
        value,
        ["mementoType", "mementoVersion", "status", "seed", "transitions"],
        ["lease", "artifact", "receipt", "outcome", "outcomeReason"],
      ) ||
      !isCreateAttempt(value["seed"]) ||
      (!terminalStatuses.has(value["status"] as AttemptStatus) &&
        value["status"] !== "READY" &&
        value["status"] !== "LEASED") ||
      !isDenseJsonArray(value["transitions"]) ||
      value["transitions"].length < 1 ||
      !value["transitions"].every(isTransition)
    )
      return failure(
        "PERSISTENCE_MEMENTO_INVALID",
        "Attempt memento shape is invalid.",
      );
    const seed = value["seed"];
    const transitions = value["transitions"];
    const first = transitions[0];
    if (
      !first ||
      first.kind !== "CREATED" ||
      canonicalizeJson(first.identity) !==
        canonicalizeJson({
          messageId: seed.messageId,
          correlationId: seed.correlationId,
          causationId: seed.causationId,
          at: seed.at,
        })
    )
      return failure(
        "PERSISTENCE_MEMENTO_INVALID",
        "Attempt memento creation provenance is invalid.",
      );
    const lease = value["lease"];
    if (lease !== undefined && !isRunnerLeaseState(lease))
      return failure(
        "PERSISTENCE_MEMENTO_INVALID",
        "Attempt memento lease is invalid.",
      );
    const artifact = value["artifact"];
    if (artifact !== undefined && !isArtifact(artifact))
      return failure(
        "PERSISTENCE_MEMENTO_INVALID",
        "Attempt memento artifact is invalid.",
      );
    const receipt = value["receipt"];
    if (receipt !== undefined && !isReceipt(receipt))
      return failure(
        "PERSISTENCE_MEMENTO_INVALID",
        "Attempt memento receipt is invalid.",
      );
    const status = value["status"] as AttemptStatus;
    const outcome = value["outcome"] as AttemptOutcome | undefined;
    const outcomeReason = value["outcomeReason"] as string | undefined;
    if (
      !mementoCrossFieldsValid(
        status,
        seed,
        lease,
        artifact,
        receipt,
        outcome,
        outcomeReason,
        transitions,
      )
    )
      return failure(
        "PERSISTENCE_MEMENTO_INVALID",
        "Attempt memento fields are inconsistent.",
      );
    const replayed = replayAttemptState(
      seed,
      transitions,
      lease,
      artifact,
      receipt,
      outcomeReason,
    );
    if (!replayed)
      return failure(
        "PERSISTENCE_MEMENTO_INVALID",
        "Attempt memento transition history cannot be replayed.",
      );
    const attempt = new Attempt(replayed);
    if (canonicalizeJson(attempt.toMemento()) !== canonicalizeJson(value))
      return failure(
        "PERSISTENCE_MEMENTO_INVALID",
        "Attempt memento does not round-trip canonically.",
      );
    return success("applied", attempt);
  }
}

function replayAttemptState(
  seed: CreateAttempt,
  transitions: readonly AttemptTransition[],
  projectedLease: RunnerLeaseState | undefined,
  projectedArtifact: Artifact | undefined,
  projectedReceipt: ArtifactSubmissionReceipt | undefined,
  projectedReason: string | undefined,
): MutableState | undefined {
  const state: MutableState = {
    status: "READY",
    seed: deepFreezeCopy(seed),
    transitions: transitions.map((transition) => deepFreezeCopy(transition)),
  };
  for (const transition of transitions.slice(1)) {
    switch (transition.kind) {
      case "CREATED":
        return undefined;
      case "LEASED":
        if (state.status !== "READY" || !projectedLease) return undefined;
        state.status = "LEASED";
        state.lease = deepFreezeCopy({
          leaseId: transition.leaseId,
          runnerId: transition.runnerId,
          runnerCapabilities: transition.runnerCapabilities,
          originalDurationSeconds: transition.originalDurationSeconds,
          leasedAt: transition.identity.at,
          lastHeartbeatAt: transition.identity.at,
          expiresAt: transition.expiresAt,
          tokenVerifier: projectedLease.tokenVerifier,
        });
        break;
      case "HEARTBEAT":
        if (state.status !== "LEASED" || !state.lease) return undefined;
        state.lease = deepFreezeCopy({
          ...state.lease,
          lastHeartbeatAt: transition.identity.at,
          expiresAt: transition.expiresAt,
        });
        break;
      case "TERMINATED":
        if (state.status !== "READY" && state.status !== "LEASED")
          return undefined;
        state.status = transition.outcome;
        state.outcome = transition.outcome;
        if (projectedReason !== undefined)
          state.outcomeReason = projectedReason;
        if (transition.outcome === "ARTIFACT_SUBMITTED") {
          if (!projectedArtifact || !projectedReceipt) return undefined;
          state.artifact = deepFreezeCopy(projectedArtifact);
          state.receipt = deepFreezeCopy(projectedReceipt);
        }
        break;
    }
  }
  return state;
}

function isRunnerLeaseState(value: unknown): value is RunnerLeaseState {
  return (
    isJsonObject(value) &&
    hasExactOwnKeys(value, [
      "leaseId",
      "runnerId",
      "runnerCapabilities",
      "originalDurationSeconds",
      "leasedAt",
      "lastHeartbeatAt",
      "expiresAt",
      "tokenVerifier",
    ]) &&
    isIdentifier(value["leaseId"]) &&
    isIdentifier(value["runnerId"]) &&
    isDenseJsonArray(value["runnerCapabilities"]) &&
    value["runnerCapabilities"].length >= 1 &&
    value["runnerCapabilities"].every(isIdentifier) &&
    new Set(value["runnerCapabilities"]).size ===
      value["runnerCapabilities"].length &&
    isPositiveInteger(value["originalDurationSeconds"]) &&
    Number(value["originalDurationSeconds"]) <= 3600 &&
    isTimestamp(value["leasedAt"]) &&
    isTimestamp(value["lastHeartbeatAt"]) &&
    isTimestamp(value["expiresAt"]) &&
    isLeaseTokenVerifier(value["tokenVerifier"])
  );
}

function isReceipt(value: unknown): value is ArtifactSubmissionReceipt {
  return (
    isJsonObject(value) &&
    hasExactOwnKeys(value, [
      "attemptId",
      "artifactDigest",
      "outcome",
      "recordedAt",
    ]) &&
    isIdentifier(value["attemptId"]) &&
    isDigest(value["artifactDigest"]) &&
    value["outcome"] === "ARTIFACT_SUBMITTED" &&
    isTimestamp(value["recordedAt"])
  );
}

function mementoCrossFieldsValid(
  status: AttemptStatus,
  seed: CreateAttempt,
  lease: RunnerLeaseState | undefined,
  artifact: Artifact | undefined,
  receipt: ArtifactSubmissionReceipt | undefined,
  outcome: AttemptOutcome | undefined,
  outcomeReason: string | undefined,
  transitions: readonly AttemptTransition[],
): boolean {
  const leasedTransition = transitions.find(
    (transition) => transition.kind === "LEASED",
  );
  const leasedTransitions = transitions.filter(
    (transition) => transition.kind === "LEASED",
  );
  const heartbeatTransitions = transitions.filter(
    (transition) => transition.kind === "HEARTBEAT",
  );
  const terminalTransitions = transitions.filter(
    (transition) => transition.kind === "TERMINATED",
  );
  if (
    transitions.filter((transition) => transition.kind === "CREATED").length !==
      1 ||
    transitions[0]?.kind !== "CREATED"
  )
    return false;
  const messageIds = transitions.map(
    (transition) => transition.identity.messageId,
  );
  const eventIds = transitions.flatMap((transition) =>
    transition.events.map((event) => event.metadata.eventId),
  );
  if (
    new Set([...messageIds, ...eventIds]).size !==
      messageIds.length + eventIds.length ||
    !transitions.every(
      (transition) =>
        transition.identity.correlationId === seed.correlationId &&
        transition.events.every(
          (event) =>
            event.metadata.correlationId === seed.correlationId &&
            event.metadata.occurredAt === transition.identity.at &&
            event.metadata.eventId ===
              eventMetadata(transition.identity, event.kind).eventId,
        ),
    )
  )
    return false;
  for (const transition of transitions) {
    const direct = transition.events[0];
    if (direct && direct.metadata.causationId !== transition.identity.messageId)
      return false;
    if (
      transition.kind !== "CREATED" &&
      !(transition.kind === "TERMINATED" && transition.outcome === "REVOKED") &&
      transition.identity.causationId !== transition.identity.messageId
    )
      return false;
    switch (transition.kind) {
      case "CREATED":
        if (
          transition.events.length !== 1 ||
          direct?.kind !== "ATTEMPT_READY" ||
          direct.metadata.eventId !==
            eventMetadata(seed, "ATTEMPT_READY").eventId
        )
          return false;
        break;
      case "LEASED":
        if (
          transition.events.length !== 1 ||
          direct?.kind !== "ATTEMPT_LEASED" ||
          direct.leaseId !== transition.leaseId ||
          direct.runnerId !== transition.runnerId ||
          canonicalizeJson(direct.runnerCapabilities) !==
            canonicalizeJson(transition.runnerCapabilities) ||
          direct.expiresAt !== transition.expiresAt
        )
          return false;
        break;
      case "HEARTBEAT":
        if (transition.events.length !== 0) return false;
        break;
      case "TERMINATED":
        if (transition.outcome === "ARTIFACT_SUBMITTED") {
          const artifactEvent = transition.events[0];
          const endedEvent = transition.events[1];
          if (
            transition.events.length !== 2 ||
            artifactEvent?.kind !== "ARTIFACT_SUBMITTED" ||
            endedEvent?.kind !== "ATTEMPT_ENDED" ||
            endedEvent.outcome !== transition.outcome ||
            endedEvent.reason !== transition.reason ||
            endedEvent.metadata.causationId !==
              artifactEvent.metadata.eventId ||
            !artifact ||
            canonicalizeJson(artifactEvent.artifact) !==
              canonicalizeJson(artifact) ||
            artifactEvent.runnerId !== lease?.runnerId
          )
            return false;
        } else if (
          transition.events.length !== 1 ||
          direct?.kind !== "ATTEMPT_ENDED" ||
          direct.outcome !== transition.outcome ||
          direct.reason !== transition.reason
        )
          return false;
        break;
    }
  }
  if (lease) {
    if (
      !leasedTransition ||
      leasedTransitions.length !== 1 ||
      transitions[1]?.kind !== "LEASED" ||
      timestampMilliseconds(leasedTransition.identity.at) <
        timestampMilliseconds(seed.at) ||
      !seed.workContract.requestedCapabilities.every((capability) =>
        lease.runnerCapabilities.includes(capability),
      )
    )
      return false;
    if (
      leasedTransition.leaseId !== lease.leaseId ||
      leasedTransition.runnerId !== lease.runnerId ||
      canonicalizeJson(leasedTransition.runnerCapabilities) !==
        canonicalizeJson(lease.runnerCapabilities) ||
      leasedTransition.originalDurationSeconds !==
        lease.originalDurationSeconds ||
      leasedTransition.identity.at !== lease.leasedAt ||
      timestampMilliseconds(leasedTransition.expiresAt) !==
        timestampMilliseconds(lease.leasedAt) +
          lease.originalDurationSeconds * 1000
    )
      return false;
    let expectedExpiry = leasedTransition.expiresAt;
    let lastAt = lease.leasedAt;
    for (const heartbeat of heartbeatTransitions) {
      if (
        timestampMilliseconds(heartbeat.identity.at) <
          timestampMilliseconds(lastAt) ||
        timestampMilliseconds(heartbeat.identity.at) >=
          timestampMilliseconds(expectedExpiry)
      )
        return false;
      expectedExpiry = new Date(
        timestampMilliseconds(heartbeat.identity.at) +
          lease.originalDurationSeconds * 1000,
      ).toISOString();
      if (heartbeat.expiresAt !== expectedExpiry) return false;
      lastAt = heartbeat.identity.at;
    }
    if (lease.lastHeartbeatAt !== lastAt || lease.expiresAt !== expectedExpiry)
      return false;
  } else if (leasedTransition || heartbeatTransitions.length > 0) return false;
  if (status === "READY")
    return (
      !lease &&
      !artifact &&
      !receipt &&
      !outcome &&
      !outcomeReason &&
      transitions.length === 1
    );
  if (status === "LEASED")
    return Boolean(
      lease &&
      !artifact &&
      !receipt &&
      !outcome &&
      !outcomeReason &&
      terminalTransitions.length === 0,
    );
  if (
    terminalTransitions.length !== 1 ||
    transitions.at(-1)?.kind !== "TERMINATED" ||
    outcome !== status
  )
    return false;
  const terminal = terminalTransitions[0];
  if (
    !terminal ||
    terminal.outcome !== outcome ||
    terminal.reason !== outcomeReason
  )
    return false;
  const expectedMiddle = transitions.slice(
    lease ? 2 : 1,
    transitions.length - 1,
  );
  if (!expectedMiddle.every((transition) => transition.kind === "HEARTBEAT"))
    return false;
  const latestAppliedAt = lease?.lastHeartbeatAt ?? seed.at;
  if (
    timestampMilliseconds(terminal.identity.at) <
    timestampMilliseconds(latestAppliedAt)
  )
    return false;
  if (status === "REVOKED")
    return !artifact && !receipt && outcomeReason === "MISSION_CANCELLED";
  if (!lease) return false;
  if (status === "ARTIFACT_SUBMITTED")
    return Boolean(
      artifact &&
      receipt &&
      !outcomeReason &&
      receipt.attemptId === seed.attemptId &&
      sameDigest(receipt.artifactDigest, artifact.digest) &&
      receipt.recordedAt === terminal.identity.at &&
      timestampMilliseconds(terminal.identity.at) <
        timestampMilliseconds(lease.expiresAt),
    );
  if (status === "LEASE_EXPIRED")
    return (
      !artifact &&
      !receipt &&
      isBoundedText(outcomeReason, 1000) &&
      timestampMilliseconds(terminal.identity.at) >=
        timestampMilliseconds(lease.expiresAt)
    );
  return (
    !artifact &&
    !receipt &&
    isBoundedText(outcomeReason, 1000) &&
    timestampMilliseconds(terminal.identity.at) <
      timestampMilliseconds(lease.expiresAt)
  );
}
