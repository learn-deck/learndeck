import type {
  MissionCancelledV1,
  MissionCompletedV1,
  MissionRetryAuthorizedV1,
  PublicCommandV1,
  ReviewRecommendationIssuedV1,
  VerificationAbortedV1,
  VerificationFailedV1,
  VerificationPassedV1,
  WorkshopArtifactSubmittedV1,
  WorkshopAttemptEndedV1,
  WorkshopAttemptLeasedV1,
  WorkshopAttemptReadyV1,
} from "@patchquest/contracts";
import {
  isMissionWorkContract,
  type MissionDigest,
  type MissionProcessSeed,
  type MissionWorkContract,
} from "../domain/mission.js";
import {
  canonicalizeNormalizedContent,
  hasExactKeys,
  isBoundedText,
  isDenseJsonArray,
  isMessageIdentifier,
  isPlainRecord,
  isRfc3339DateTime,
  normalizedContentFingerprint,
} from "./message-validation.js";
import {
  finalizeMissionControlCommand,
  finalizeMissionPublicEvent,
  type OutgoingBuildResult,
} from "./outgoing-message-factory.js";
import { translateMissionControlEvent } from "./translators.js";

export type MissionCompletionProcessState =
  | "ATTEMPT_REQUESTED"
  | "ATTEMPT_ACTIVE"
  | "VERIFICATION_REQUESTED"
  | "VERIFYING"
  | "AWAITING_HUMAN_REVIEW"
  | "RETRY_REQUESTED"
  | "NEEDS_HUMAN_DECISION"
  | "COMPLETED"
  | "CANCELLED";

export interface MissionCompletionProcessSnapshot {
  readonly missionId: string;
  readonly missionRevision: number;
  readonly state: MissionCompletionProcessState;
  readonly correlationId: string;
  readonly attemptBudget: number;
  readonly attemptsAuthorized: number;
  readonly attemptId?: string;
  readonly attemptNumber?: number;
  readonly artifactDigest?: MissionDigest;
  readonly verificationRunId?: string;
  readonly completionReviewId?: string;
  readonly handledMessageIds: readonly string[];
}

export type ProcessErrorCode =
  | "INVALID_PROCESS_FACT"
  | "STALE_FACT"
  | "MESSAGE_ID_CONFLICT"
  | "CONFLICTING_VERIFICATION_FACT"
  | "PERSISTENCE_MEMENTO_INVALID"
  | "PERSISTENCE_VERSION_UNSUPPORTED"
  | "UNSUPPORTED_TRANSITION"
  | "MISSION_TERMINAL";

export interface ProcessError {
  readonly code: ProcessErrorCode;
  readonly message: string;
}

export type ProcessResult =
  | {
      readonly ok: true;
      readonly disposition: "applied" | "idempotent" | "ignored";
      readonly snapshot: MissionCompletionProcessSnapshot;
      readonly commands: readonly PublicCommandV1[];
    }
  | { readonly ok: false; readonly error: ProcessError };

export interface OutgoingCommandMetadata {
  readonly commandId: string;
  readonly issuedAt: string;
  readonly trace?: unknown;
}

export interface OpenProcessMetadata extends OutgoingCommandMetadata {
  readonly openedEventId: string;
  readonly correlationId: string;
}

export interface VerificationDispatch extends OutgoingCommandMetadata {
  readonly verificationRunId: string;
}

export interface RetryDispatch extends OutgoingCommandMetadata {
  readonly authorization: MissionRetryAuthorizedV1;
  readonly attemptId: string;
}

export type ProcessStartResult =
  | {
      readonly ok: true;
      readonly process: MissionCompletionProcess;
      readonly result: Extract<ProcessResult, { ok: true }>;
    }
  | { readonly ok: false; readonly error: ProcessError };

type Artifact = WorkshopArtifactSubmittedV1["data"]["artifact"];
type VerificationOutcomeEvent =
  VerificationPassedV1 | VerificationFailedV1 | VerificationAbortedV1;

type ProcessAuditKind =
  | "START"
  | "ATTEMPT_READY"
  | "ATTEMPT_LEASED"
  | "ARTIFACT_SUBMITTED"
  | "VERIFICATION_DISPATCHED"
  | "ATTEMPT_ENDED"
  | "VERDICT"
  | "ABORTED"
  | "RECOMMENDATION"
  | "HUMAN_REJECTION"
  | "CANCELLED"
  | "COMPLETED";

export interface ProcessAuditEntry {
  readonly kind: ProcessAuditKind;
  readonly payload: unknown;
  readonly previousDigest: string;
  readonly entryDigest: string;
}

export interface VerificationDispatchAudit {
  readonly commandId: string;
  readonly verificationRunId: string;
  readonly attemptId: string;
}

export interface OutgoingMessageIdentity {
  readonly messageId: string;
  readonly fingerprint: string;
  readonly kind:
    | "MISSION_OPENED_EVENT"
    | "MISSION_RETRY_AUTHORIZED_EVENT"
    | "MISSION_CANCELLED_EVENT"
    | "MISSION_COMPLETED_EVENT"
    | "WORKSHOP_CREATE_ATTEMPT_COMMAND"
    | "VERIFICATION_START_COMMAND"
    | "WORKSHOP_REVOKE_ATTEMPT_COMMAND";
}

export interface MissionCompletionProcessMementoV1 {
  readonly mementoType: "patchquest.mission-completion-process";
  readonly mementoVersion: 1;
  readonly missionId: string;
  readonly missionRevision: number;
  readonly state: MissionCompletionProcessState;
  readonly correlationId: string;
  readonly workContract: MissionWorkContract;
  readonly attemptBudget: number;
  readonly attemptsAuthorized: number;
  readonly attemptId?: string;
  readonly attemptNumber?: number;
  readonly artifact?: Artifact;
  readonly producingRunnerId?: string;
  readonly verificationRunId?: string;
  readonly completionReviewId?: string;
  readonly latestVerdict?: "PASSED" | "FAILED";
  readonly evidenceBundleDigest?: MissionDigest;
  readonly recommendation?: "APPROVE" | "REQUEST_REVISION";
  readonly recommendationEvent?: ReviewRecommendationIssuedV1;
  readonly terminalOutcome?: VerificationOutcomeEvent;
  readonly expectedAttemptReadyCausationId?: string;
  readonly expectedVerificationCausationId?: string;
  readonly expectedRecommendationCausationId?: string;
  readonly messageFingerprints: readonly (readonly [string, string])[];
  readonly outcomeFingerprintsByRun: readonly (readonly [string, string])[];
  readonly verificationHistory: readonly VerificationOutcomeEvent[];
  readonly authorizedAttemptIds: readonly string[];
  readonly verificationDispatches: readonly VerificationDispatchAudit[];
  readonly verificationAcknowledgements: readonly (readonly [string, string])[];
  readonly outgoingMessageIds: readonly OutgoingMessageIdentity[];
  readonly auditTrail: readonly ProcessAuditEntry[];
}

interface MutableProcessState {
  missionId: string;
  missionRevision: number;
  state: MissionCompletionProcessState;
  correlationId: string;
  workContract: MissionWorkContract;
  attemptBudget: number;
  attemptsAuthorized: number;
  attemptId: string | undefined;
  attemptNumber: number | undefined;
  artifact: Artifact | undefined;
  producingRunnerId: string | undefined;
  verificationRunId: string | undefined;
  completionReviewId: string | undefined;
  latestVerdict: "PASSED" | "FAILED" | undefined;
  evidenceBundleDigest: MissionDigest | undefined;
  recommendation: "APPROVE" | "REQUEST_REVISION" | undefined;
  recommendationEvent: ReviewRecommendationIssuedV1 | undefined;
  terminalOutcome: VerificationOutcomeEvent | undefined;
  expectedAttemptReadyCausationId: string | undefined;
  expectedVerificationCausationId: string | undefined;
  expectedRecommendationCausationId: string | undefined;
  messageFingerprints: Map<string, string>;
  outcomeFingerprintsByRun: Map<string, string>;
  verificationHistory: VerificationOutcomeEvent[];
  authorizedAttemptIds: Set<string>;
  verificationDispatches: Map<string, VerificationDispatchAudit>;
  usedVerificationRunIds: Set<string>;
  verificationAcknowledgements: Map<string, string>;
  outgoingMessageIds: Map<
    string,
    Readonly<{
      kind: OutgoingMessageIdentity["kind"];
      fingerprint: string;
    }>
  >;
  auditTrail: ProcessAuditEntry[];
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const digestPattern = /^[a-f0-9]{64}$/;

function failure(code: ProcessErrorCode, message: string): ProcessResult {
  return { ok: false, error: { code, message } };
}

const canonicalize = canonicalizeNormalizedContent;
const fingerprint = normalizedContentFingerprint;

function sameDigest(left: MissionDigest, right: MissionDigest): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

function copyDigest(value: MissionDigest): MissionDigest {
  return Object.freeze({ algorithm: "sha256", value: value.value });
}

function copyArtifact(value: Artifact): Artifact {
  return Object.freeze({
    reference: value.reference,
    digest: copyDigest(value.digest),
    changedPaths: Object.freeze([...value.changedPaths]),
  });
}

function copyWorkContract(value: MissionWorkContract): MissionWorkContract {
  return Object.freeze({
    objective: value.objective,
    startingRevision: value.startingRevision,
    workspaceReference: value.workspaceReference,
    allowedScope: Object.freeze({
      pathPatterns: Object.freeze([...value.allowedScope.pathPatterns]),
    }),
    requestedCapabilities: Object.freeze([...value.requestedCapabilities]),
    acceptanceGates: Object.freeze(
      value.acceptanceGates.map((gate) => Object.freeze({ ...gate })),
    ),
    gateSetDigest: copyDigest(value.gateSetDigest),
  });
}

function copyEvent<Event extends VerificationOutcomeEvent>(
  event: Event,
): Event {
  return structuredClone(event) as Event;
}

function copyAuditEntry(entry: ProcessAuditEntry): ProcessAuditEntry {
  return Object.freeze({
    kind: entry.kind,
    payload: structuredClone(entry.payload),
    previousDigest: entry.previousDigest,
    entryDigest: entry.entryDigest,
  });
}

function auditEntryDigest(
  kind: ProcessAuditKind,
  payload: unknown,
  previousDigest: string,
): string {
  return fingerprint({ kind, payload, previousDigest });
}

function normalizedVerificationDispatch(
  dispatch: VerificationDispatch,
): VerificationDispatch {
  return {
    commandId: dispatch.commandId,
    verificationRunId: dispatch.verificationRunId,
    issuedAt: dispatch.issuedAt,
  };
}

function normalizedRetryDispatch(dispatch: RetryDispatch): RetryDispatch {
  return {
    commandId: dispatch.commandId,
    issuedAt: dispatch.issuedAt,
    attemptId: dispatch.attemptId,
    authorization: structuredClone(dispatch.authorization),
  };
}

function normalizedOutgoingMetadata(
  metadata: OutgoingCommandMetadata,
): OutgoingCommandMetadata {
  return { commandId: metadata.commandId, issuedAt: metadata.issuedAt };
}

function outcomeFingerprint(event: VerificationOutcomeEvent): string {
  const material = Object.fromEntries(
    Object.entries(event).filter(
      ([key]) => key !== "eventId" && key !== "occurredAt",
    ),
  );
  return fingerprint(material);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return isPlainRecord(value);
}

function isExactJsonRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Readonly<Record<string, unknown>> {
  if (!isRecord(value) || !hasExactKeys(value, required, optional))
    return false;
  try {
    canonicalize(value);
    return true;
  } catch {
    return false;
  }
}

function isMissionProcessSeedInput(
  value: unknown,
): value is MissionProcessSeed {
  return (
    isExactJsonRecord(value, [
      "missionId",
      "missionRevision",
      "workContract",
      "attemptBudget",
      "attemptsAuthorized",
      "attemptId",
      "attemptNumber",
    ]) &&
    isMessageIdentifier(value["missionId"]) &&
    Number.isSafeInteger(value["missionRevision"]) &&
    Number(value["missionRevision"]) >= 1 &&
    isMissionWorkContract(value["workContract"]) &&
    Number.isSafeInteger(value["attemptBudget"]) &&
    Number(value["attemptBudget"]) >= 1 &&
    value["attemptsAuthorized"] === 1 &&
    isMessageIdentifier(value["attemptId"]) &&
    value["attemptNumber"] === 1
  );
}

function isOpenProcessMetadataInput(
  value: unknown,
): value is OpenProcessMetadata {
  return (
    isExactJsonRecord(
      value,
      ["openedEventId", "commandId", "issuedAt", "correlationId"],
      ["trace"],
    ) &&
    isMessageIdentifier(value["openedEventId"]) &&
    isMessageIdentifier(value["commandId"]) &&
    isRfc3339DateTime(value["issuedAt"]) &&
    isMessageIdentifier(value["correlationId"])
  );
}

function isVerificationDispatchInput(
  value: unknown,
): value is VerificationDispatch {
  return (
    isExactJsonRecord(
      value,
      ["commandId", "verificationRunId", "issuedAt"],
      ["trace"],
    ) &&
    isMessageIdentifier(value["commandId"]) &&
    isMessageIdentifier(value["verificationRunId"]) &&
    isRfc3339DateTime(value["issuedAt"])
  );
}

function isRetryDispatchInput(value: unknown): value is RetryDispatch {
  if (
    !isExactJsonRecord(
      value,
      ["commandId", "issuedAt", "authorization", "attemptId"],
      ["trace"],
    ) ||
    !isMessageIdentifier(value["commandId"]) ||
    !isRfc3339DateTime(value["issuedAt"]) ||
    !isMessageIdentifier(value["attemptId"]) ||
    !isRecord(value["authorization"]) ||
    value["authorization"]["eventType"] !== "mission.retry-authorized.v1"
  )
    return false;
  return finalizeMissionPublicEvent(
    value["authorization"] as unknown as MissionRetryAuthorizedV1,
  ).ok;
}

function isOutgoingCommandMetadataInput(
  value: unknown,
): value is OutgoingCommandMetadata {
  return (
    isExactJsonRecord(value, ["commandId", "issuedAt"], ["trace"]) &&
    isMessageIdentifier(value["commandId"]) &&
    isRfc3339DateTime(value["issuedAt"])
  );
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function isDigest(value: unknown): value is MissionDigest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["algorithm", "value"]) &&
    value["algorithm"] === "sha256" &&
    typeof value["value"] === "string" &&
    digestPattern.test(value["value"])
  );
}

function artifactShape(value: unknown): value is Artifact {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["reference", "digest", "changedPaths"]) ||
    !isBoundedText(value["reference"], 2048) ||
    !isDigest(value["digest"]) ||
    !isDenseJsonArray(value["changedPaths"]) ||
    value["changedPaths"].length < 1 ||
    !value["changedPaths"].every(
      (path) =>
        typeof path === "string" && path.length >= 1 && path.length <= 512,
    ) ||
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

function verificationEventShape(
  value: unknown,
): value is VerificationOutcomeEvent {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "eventId",
      "eventType",
      "schemaVersion",
      "occurredAt",
      "producer",
      "subjectId",
      "correlationId",
      "causationId",
      "data",
    ]) ||
    !isMessageIdentifier(value["eventId"]) ||
    !isRfc3339DateTime(value["occurredAt"]) ||
    value["producer"] !== "verification-and-review" ||
    !isMessageIdentifier(value["subjectId"]) ||
    !isMessageIdentifier(value["correlationId"]) ||
    !isMessageIdentifier(value["causationId"]) ||
    value["schemaVersion"] !== 1 ||
    !isRecord(value["data"])
  )
    return false;
  const data = value["data"];
  if (
    !isMessageIdentifier(data["verificationRunId"]) ||
    value["subjectId"] !== data["verificationRunId"] ||
    !isMessageIdentifier(data["attemptId"]) ||
    !isMessageIdentifier(data["verifierId"]) ||
    !isRecord(data["binding"]) ||
    !hasExactKeys(data["binding"], [
      "missionId",
      "missionRevision",
      "startingRevision",
      "artifactDigest",
      "gateSetDigest",
    ]) ||
    !isMessageIdentifier(data["binding"]["missionId"]) ||
    typeof data["binding"]["missionRevision"] !== "number" ||
    !Number.isSafeInteger(data["binding"]["missionRevision"]) ||
    !isBoundedText(data["binding"]["startingRevision"], 256) ||
    !isDigest(data["binding"]["artifactDigest"]) ||
    !isDigest(data["binding"]["gateSetDigest"])
  )
    return false;
  if (value["eventType"] === "verification.aborted.v1")
    return (
      hasExactKeys(
        data,
        [
          "verificationRunId",
          "attemptId",
          "binding",
          "verifierId",
          "outcome",
          "reason",
          "retryable",
        ],
        ["evidenceBundleDigest", "detail"],
      ) &&
      data["outcome"] === "ABORTED" &&
      [
        "VERIFIER_UNAVAILABLE",
        "WORKSPACE_UNAVAILABLE",
        "EXECUTION_INFRASTRUCTURE_FAILURE",
        "MISSION_CANCELLED",
      ].includes(String(data["reason"])) &&
      typeof data["retryable"] === "boolean" &&
      !(data["reason"] === "MISSION_CANCELLED" && data["retryable"]) &&
      (data["evidenceBundleDigest"] === undefined ||
        isDigest(data["evidenceBundleDigest"])) &&
      (data["detail"] === undefined || isBoundedText(data["detail"], 2000))
    );
  if (
    !isDigest(data["evidenceBundleDigest"]) ||
    typeof data["checkCount"] !== "number" ||
    !Number.isSafeInteger(data["checkCount"]) ||
    data["checkCount"] < 1
  )
    return false;
  if (value["eventType"] === "verification.passed.v1")
    return (
      hasExactKeys(data, [
        "verificationRunId",
        "attemptId",
        "binding",
        "verifierId",
        "verdict",
        "checkCount",
        "evidenceBundleDigest",
      ]) && data["verdict"] === "PASSED"
    );
  return (
    value["eventType"] === "verification.failed.v1" &&
    hasExactKeys(data, [
      "verificationRunId",
      "attemptId",
      "binding",
      "verifierId",
      "verdict",
      "checkCount",
      "failedGateIds",
      "evidenceBundleDigest",
    ]) &&
    data["verdict"] === "FAILED" &&
    isDenseJsonArray(data["failedGateIds"]) &&
    data["failedGateIds"].length >= 1 &&
    data["failedGateIds"].every(isMessageIdentifier) &&
    new Set(data["failedGateIds"]).size === data["failedGateIds"].length
  );
}

function recommendationEventShape(
  value: unknown,
): value is ReviewRecommendationIssuedV1 {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "eventId",
      "eventType",
      "schemaVersion",
      "occurredAt",
      "producer",
      "subjectId",
      "correlationId",
      "causationId",
      "data",
    ]) &&
    value["eventType"] === "review.recommendation-issued.v1" &&
    value["schemaVersion"] === 1 &&
    value["producer"] === "verification-and-review" &&
    isMessageIdentifier(value["eventId"]) &&
    isRfc3339DateTime(value["occurredAt"]) &&
    isMessageIdentifier(value["subjectId"]) &&
    isMessageIdentifier(value["correlationId"]) &&
    isMessageIdentifier(value["causationId"]) &&
    isRecord(value["data"]) &&
    hasExactKeys(
      value["data"],
      [
        "completionReviewId",
        "verificationRunId",
        "binding",
        "verdict",
        "evidenceBundleDigest",
        "recommendation",
      ],
      ["reason"],
    ) &&
    isMessageIdentifier(value["data"]["completionReviewId"]) &&
    value["subjectId"] === value["data"]["completionReviewId"] &&
    isMessageIdentifier(value["data"]["verificationRunId"]) &&
    isRecord(value["data"]["binding"]) &&
    hasExactKeys(value["data"]["binding"], [
      "missionId",
      "missionRevision",
      "startingRevision",
      "artifactDigest",
      "gateSetDigest",
    ]) &&
    isMessageIdentifier(value["data"]["binding"]["missionId"]) &&
    Number.isSafeInteger(value["data"]["binding"]["missionRevision"]) &&
    Number(value["data"]["binding"]["missionRevision"]) >= 1 &&
    isBoundedText(value["data"]["binding"]["startingRevision"], 256) &&
    isDigest(value["data"]["binding"]["artifactDigest"]) &&
    isDigest(value["data"]["binding"]["gateSetDigest"]) &&
    (value["data"]["verdict"] === "PASSED" ||
      value["data"]["verdict"] === "FAILED") &&
    (value["data"]["recommendation"] === "APPROVE" ||
      value["data"]["recommendation"] === "REQUEST_REVISION") &&
    isDigest(value["data"]["evidenceBundleDigest"]) &&
    (value["data"]["reason"] === undefined ||
      isBoundedText(value["data"]["reason"], 2000))
  );
}

function missionCancelledEventShape(
  value: unknown,
): value is MissionCancelledV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "eventId",
      "eventType",
      "schemaVersion",
      "occurredAt",
      "producer",
      "subjectId",
      "correlationId",
      "causationId",
      "data",
    ]) ||
    value["eventType"] !== "mission.cancelled.v1" ||
    value["schemaVersion"] !== 1 ||
    value["producer"] !== "mission-control" ||
    !isMessageIdentifier(value["eventId"]) ||
    !isRfc3339DateTime(value["occurredAt"]) ||
    !isMessageIdentifier(value["subjectId"]) ||
    !isMessageIdentifier(value["correlationId"]) ||
    !isMessageIdentifier(value["causationId"]) ||
    !isRecord(value["data"]) ||
    !hasExactKeys(value["data"], [
      "missionId",
      "missionRevision",
      "cancelledBy",
      "reason",
    ])
  )
    return false;
  const data = value["data"];
  return (
    isMessageIdentifier(data["missionId"]) &&
    data["missionId"] === value["subjectId"] &&
    Number.isSafeInteger(data["missionRevision"]) &&
    Number(data["missionRevision"]) >= 1 &&
    isMessageIdentifier(data["cancelledBy"]) &&
    isBoundedText(data["reason"], 1000)
  );
}

function missionCompletedEventShape(
  value: unknown,
): value is MissionCompletedV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "eventId",
      "eventType",
      "schemaVersion",
      "occurredAt",
      "producer",
      "subjectId",
      "correlationId",
      "causationId",
      "data",
    ]) ||
    value["eventType"] !== "mission.completed.v1" ||
    value["schemaVersion"] !== 1 ||
    value["producer"] !== "mission-control" ||
    !isMessageIdentifier(value["eventId"]) ||
    !isRfc3339DateTime(value["occurredAt"]) ||
    !isMessageIdentifier(value["subjectId"]) ||
    !isMessageIdentifier(value["correlationId"]) ||
    !isMessageIdentifier(value["causationId"]) ||
    !isRecord(value["data"]) ||
    !hasExactKeys(value["data"], [
      "missionId",
      "missionRevision",
      "completionReviewId",
      "recommendation",
      "verificationRunId",
      "artifactDigest",
      "gateSetDigest",
      "evidenceBundleDigest",
      "approvedBy",
    ])
  )
    return false;
  const data = value["data"];
  return (
    isMessageIdentifier(data["missionId"]) &&
    data["missionId"] === value["subjectId"] &&
    Number.isSafeInteger(data["missionRevision"]) &&
    Number(data["missionRevision"]) >= 1 &&
    isMessageIdentifier(data["completionReviewId"]) &&
    data["recommendation"] === "APPROVE" &&
    isMessageIdentifier(data["verificationRunId"]) &&
    isDigest(data["artifactDigest"]) &&
    isDigest(data["gateSetDigest"]) &&
    isDigest(data["evidenceBundleDigest"]) &&
    isMessageIdentifier(data["approvedBy"])
  );
}

function processMementoInvariant(
  memento: MissionCompletionProcessMementoV1,
): boolean {
  if (
    memento.authorizedAttemptIds.length !== memento.attemptsAuthorized ||
    memento.attemptId !==
      memento.authorizedAttemptIds[memento.attemptsAuthorized - 1] ||
    memento.attemptNumber !== memento.attemptsAuthorized ||
    !memento.expectedAttemptReadyCausationId ||
    !isMessageIdentifier(memento.expectedAttemptReadyCausationId)
  )
    return false;
  const hasArtifact = memento.artifact !== undefined;
  if (
    hasArtifact !== (memento.producingRunnerId !== undefined) ||
    hasArtifact !== (memento.verificationRunId !== undefined) ||
    hasArtifact !== (memento.expectedVerificationCausationId !== undefined) ||
    (memento.latestVerdict !== undefined) !==
      (memento.evidenceBundleDigest !== undefined) ||
    (memento.completionReviewId !== undefined) !==
      (memento.recommendation !== undefined) ||
    (memento.recommendation !== undefined) !==
      (memento.recommendationEvent !== undefined)
  )
    return false;
  const terminal = memento.terminalOutcome;
  if (terminal) {
    if (
      !hasArtifact ||
      terminal.data.verificationRunId !== memento.verificationRunId ||
      terminal.data.attemptId !== memento.attemptId ||
      terminal.correlationId !== memento.correlationId ||
      terminal.causationId !== memento.expectedVerificationCausationId ||
      terminal.data.binding.missionId !== memento.missionId ||
      terminal.data.binding.missionRevision !== memento.missionRevision ||
      terminal.data.binding.startingRevision !==
        memento.workContract.startingRevision ||
      !memento.artifact ||
      !sameDigest(
        terminal.data.binding.artifactDigest,
        memento.artifact.digest,
      ) ||
      !sameDigest(
        terminal.data.binding.gateSetDigest,
        memento.workContract.gateSetDigest,
      )
    )
      return false;
    if (terminal.eventType === "verification.aborted.v1") {
      if (
        memento.latestVerdict ||
        memento.evidenceBundleDigest ||
        memento.expectedRecommendationCausationId ||
        memento.recommendation
      )
        return false;
    } else if (
      memento.latestVerdict !== terminal.data.verdict ||
      !memento.evidenceBundleDigest ||
      !sameDigest(
        memento.evidenceBundleDigest,
        terminal.data.evidenceBundleDigest,
      ) ||
      memento.expectedRecommendationCausationId !== terminal.eventId
    )
      return false;
  } else if (
    memento.latestVerdict ||
    memento.evidenceBundleDigest ||
    memento.expectedRecommendationCausationId ||
    memento.recommendation
  )
    return false;
  if (memento.recommendationEvent) {
    const event = memento.recommendationEvent;
    if (
      !terminal ||
      terminal.eventType === "verification.aborted.v1" ||
      event.causationId !== terminal.eventId ||
      event.correlationId !== memento.correlationId ||
      event.data.completionReviewId !== memento.completionReviewId ||
      event.data.verificationRunId !== memento.verificationRunId ||
      event.data.verdict !== memento.latestVerdict ||
      event.data.recommendation !== memento.recommendation ||
      event.data.binding.missionId !== terminal.data.binding.missionId ||
      event.data.binding.missionRevision !==
        terminal.data.binding.missionRevision ||
      event.data.binding.startingRevision !==
        terminal.data.binding.startingRevision ||
      !sameDigest(
        event.data.binding.artifactDigest,
        terminal.data.binding.artifactDigest,
      ) ||
      !sameDigest(
        event.data.binding.gateSetDigest,
        terminal.data.binding.gateSetDigest,
      ) ||
      !memento.evidenceBundleDigest ||
      !sameDigest(event.data.evidenceBundleDigest, memento.evidenceBundleDigest)
    )
      return false;
  }
  const clearVerification =
    !hasArtifact && !terminal && !memento.recommendation;
  switch (memento.state) {
    case "ATTEMPT_REQUESTED":
    case "ATTEMPT_ACTIVE":
    case "RETRY_REQUESTED":
      if (!clearVerification) return false;
      break;
    case "VERIFICATION_REQUESTED":
      if (!hasArtifact || terminal) return false;
      break;
    case "VERIFYING":
      if (!hasArtifact || memento.recommendation) return false;
      break;
    case "AWAITING_HUMAN_REVIEW":
    case "COMPLETED":
      if (
        terminal?.eventType !== "verification.passed.v1" ||
        memento.recommendation !== "APPROVE"
      )
        return false;
      break;
    case "NEEDS_HUMAN_DECISION": {
      const attemptEnded = clearVerification;
      const aborted = terminal?.eventType === "verification.aborted.v1";
      const revision =
        terminal?.eventType === "verification.failed.v1" &&
        memento.recommendation === "REQUEST_REVISION";
      const rejected =
        terminal?.eventType === "verification.passed.v1" &&
        memento.recommendation === "APPROVE";
      if (!attemptEnded && !aborted && !revision && !rejected) return false;
      break;
    }
    case "CANCELLED":
      if (
        terminal?.eventType === "verification.aborted.v1" &&
        terminal.data.reason !== "MISSION_CANCELLED"
      )
        return false;
      break;
  }
  if (
    memento.verificationHistory.length !==
      memento.outcomeFingerprintsByRun.length ||
    new Set(
      memento.verificationHistory.map((event) => event.data.verificationRunId),
    ).size !== memento.verificationHistory.length
  )
    return false;
  for (const event of memento.verificationHistory) {
    const runId = event.data.verificationRunId;
    if (
      memento.outcomeFingerprintsByRun.find(([id]) => id === runId)?.[1] !==
        outcomeFingerprint(event) ||
      memento.messageFingerprints.find(([id]) => id === event.eventId)?.[1] !==
        fingerprint(event)
    )
      return false;
  }
  if (
    terminal &&
    canonicalize(terminal) !== canonicalize(memento.verificationHistory.at(-1))
  )
    return false;
  if (
    memento.recommendationEvent &&
    memento.messageFingerprints.find(
      ([id]) => id === memento.recommendationEvent?.eventId,
    )?.[1] !== fingerprint(memento.recommendationEvent)
  )
    return false;
  return true;
}

export class MissionCompletionProcess {
  readonly #state: MutableProcessState;

  private constructor(state: MutableProcessState) {
    this.#state = state;
  }

  static start(
    seed: MissionProcessSeed,
    metadata: OpenProcessMetadata,
  ): ProcessStartResult {
    if (
      !isMissionProcessSeedInput(seed) ||
      !isOpenProcessMetadataInput(metadata) ||
      metadata.openedEventId === metadata.commandId ||
      seed.attemptBudget < seed.attemptsAuthorized
    )
      return {
        ok: false,
        error: {
          code: "INVALID_PROCESS_FACT",
          message: "Process seed or opening command metadata is invalid.",
        },
      };
    const process = new MissionCompletionProcess({
      missionId: seed.missionId,
      missionRevision: seed.missionRevision,
      state: "ATTEMPT_REQUESTED",
      correlationId: metadata.correlationId,
      workContract: copyWorkContract(seed.workContract),
      attemptBudget: seed.attemptBudget,
      attemptsAuthorized: seed.attemptsAuthorized,
      attemptId: seed.attemptId,
      attemptNumber: seed.attemptNumber,
      artifact: undefined,
      producingRunnerId: undefined,
      verificationRunId: undefined,
      completionReviewId: undefined,
      latestVerdict: undefined,
      evidenceBundleDigest: undefined,
      recommendation: undefined,
      recommendationEvent: undefined,
      terminalOutcome: undefined,
      expectedAttemptReadyCausationId: metadata.commandId,
      expectedVerificationCausationId: undefined,
      expectedRecommendationCausationId: undefined,
      messageFingerprints: new Map(),
      outcomeFingerprintsByRun: new Map(),
      verificationHistory: [],
      authorizedAttemptIds: new Set([seed.attemptId]),
      verificationDispatches: new Map(),
      usedVerificationRunIds: new Set(),
      verificationAcknowledgements: new Map(),
      outgoingMessageIds: new Map(),
      auditTrail: [],
    });
    process.#audit("START", {
      seed: {
        missionId: seed.missionId,
        missionRevision: seed.missionRevision,
        workContract: copyWorkContract(seed.workContract),
        attemptBudget: seed.attemptBudget,
        attemptsAuthorized: 1,
        attemptId: seed.attemptId,
        attemptNumber: 1,
      },
      metadata: {
        openedEventId: metadata.openedEventId,
        commandId: metadata.commandId,
        issuedAt: metadata.issuedAt,
        correlationId: metadata.correlationId,
      },
    });
    const command = process.#createAttemptCommand(
      metadata.commandId,
      metadata.issuedAt,
      metadata.openedEventId,
    );
    if (!command.ok)
      return {
        ok: false,
        error: {
          code: "INVALID_PROCESS_FACT",
          message: command.error.message,
        },
      };
    if (
      !process.#reserveOutgoing(
        metadata.openedEventId,
        "MISSION_OPENED_EVENT",
        {
          kind: "MISSION_OPENED",
          missionId: seed.missionId,
          missionRevision: seed.missionRevision,
          correlationId: metadata.correlationId,
        },
      ) ||
      !process.#reserveOutgoing(
        metadata.commandId,
        "WORKSHOP_CREATE_ATTEMPT_COMMAND",
        command.value,
      )
    )
      return {
        ok: false,
        error: {
          code: "INVALID_PROCESS_FACT",
          message: "Opening message identities collide.",
        },
      };
    const result = process.#success("applied", [command.value]);
    if (!result.ok) return result;
    return { ok: true, process, result };
  }

  get snapshot(): MissionCompletionProcessSnapshot {
    return Object.freeze({
      missionId: this.#state.missionId,
      missionRevision: this.#state.missionRevision,
      state: this.#state.state,
      correlationId: this.#state.correlationId,
      attemptBudget: this.#state.attemptBudget,
      attemptsAuthorized: this.#state.attemptsAuthorized,
      ...(this.#state.attemptId ? { attemptId: this.#state.attemptId } : {}),
      ...(this.#state.attemptNumber
        ? { attemptNumber: this.#state.attemptNumber }
        : {}),
      ...(this.#state.artifact
        ? { artifactDigest: copyDigest(this.#state.artifact.digest) }
        : {}),
      ...(this.#state.verificationRunId
        ? { verificationRunId: this.#state.verificationRunId }
        : {}),
      ...(this.#state.completionReviewId
        ? { completionReviewId: this.#state.completionReviewId }
        : {}),
      handledMessageIds: Object.freeze(
        [...this.#state.messageFingerprints.keys()].sort(),
      ),
    });
  }

  recordAttemptReady(event: WorkshopAttemptReadyV1): ProcessResult {
    if (
      !translateMissionControlEvent(event).ok ||
      event.subjectId !== event.data.attemptId
    )
      return failure("INVALID_PROCESS_FACT", "Attempt-ready fact is invalid.");
    const duplicate = this.#duplicate(event.eventId, event);
    if (duplicate) return duplicate;
    if (!this.#incomingIdentityValid(event.eventId, event.causationId))
      return failure(
        "MESSAGE_ID_CONFLICT",
        "Attempt-ready identity collides with an outgoing message.",
      );
    if (
      this.#commonStale(
        event.data.missionId,
        event.data.missionRevision,
        event.correlationId,
      ) ||
      event.data.attemptId !== this.#state.attemptId ||
      event.data.attemptNumber !== this.#state.attemptNumber
    )
      return this.#ignored();
    if (!["ATTEMPT_REQUESTED", "RETRY_REQUESTED"].includes(this.#state.state))
      return failure(
        "UNSUPPORTED_TRANSITION",
        "Attempt-ready is not expected.",
      );
    if (event.causationId !== this.#state.expectedAttemptReadyCausationId)
      return failure(
        "STALE_FACT",
        "Attempt-ready does not directly follow create-attempt.",
      );
    this.#state.state = "ATTEMPT_REQUESTED";
    this.#handled(event.eventId, event);
    this.#audit("ATTEMPT_READY", { event });
    return this.#success("applied");
  }

  recordAttemptLeased(event: WorkshopAttemptLeasedV1): ProcessResult {
    if (
      !translateMissionControlEvent(event).ok ||
      event.subjectId !== event.data.attemptId
    )
      return failure("INVALID_PROCESS_FACT", "Attempt lease fact is invalid.");
    const duplicate = this.#duplicate(event.eventId, event);
    if (duplicate) return duplicate;
    if (!this.#incomingIdentityValid(event.eventId, event.causationId))
      return failure(
        "MESSAGE_ID_CONFLICT",
        "Attempt-lease identity collides with an outgoing message.",
      );
    if (
      event.correlationId !== this.#state.correlationId ||
      event.data.attemptId !== this.#state.attemptId
    )
      return this.#ignored();
    if (this.#state.state !== "ATTEMPT_REQUESTED")
      return failure(
        "UNSUPPORTED_TRANSITION",
        "Attempt lease is not expected.",
      );
    this.#state.state = "ATTEMPT_ACTIVE";
    this.#handled(event.eventId, event);
    this.#audit("ATTEMPT_LEASED", { event });
    return this.#success("applied");
  }

  recordArtifactSubmitted(
    event: WorkshopArtifactSubmittedV1,
    dispatch: VerificationDispatch,
  ): ProcessResult {
    if (!isVerificationDispatchInput(dispatch))
      return failure(
        "INVALID_PROCESS_FACT",
        "Verification dispatch identity is invalid.",
      );
    if (
      !translateMissionControlEvent(event).ok ||
      event.subjectId !== event.data.attemptId
    )
      return failure(
        "INVALID_PROCESS_FACT",
        "Artifact-submitted fact is invalid.",
      );
    const duplicate = this.#duplicate(event.eventId, event);
    if (duplicate) return duplicate;
    if (!this.#incomingIdentityValid(event.eventId, event.causationId))
      return failure(
        "MESSAGE_ID_CONFLICT",
        "Artifact identity collides with an outgoing message.",
      );
    if (
      this.#commonStale(
        event.data.missionId,
        event.data.missionRevision,
        event.correlationId,
      ) ||
      event.data.attemptId !== this.#state.attemptId ||
      event.data.startingRevision !==
        this.#state.workContract.startingRevision ||
      !sameDigest(
        event.data.gateSetDigest,
        this.#state.workContract.gateSetDigest,
      )
    )
      return this.#ignored();
    if (!["ATTEMPT_REQUESTED", "ATTEMPT_ACTIVE"].includes(this.#state.state))
      return failure(
        "UNSUPPORTED_TRANSITION",
        "Artifact submission is not expected.",
      );
    if (
      dispatch.commandId === event.eventId ||
      this.#state.usedVerificationRunIds.has(dispatch.verificationRunId) ||
      this.#state.verificationDispatches.has(dispatch.commandId) ||
      this.#state.messageFingerprints.has(dispatch.commandId) ||
      this.#state.outgoingMessageIds.has(dispatch.commandId)
    )
      return failure(
        "INVALID_PROCESS_FACT",
        "Verification dispatch identity is invalid.",
      );
    const command = finalizeMissionControlCommand({
      commandId: dispatch.commandId,
      commandType: "verification.start-verification.v1",
      schemaVersion: 1,
      issuedAt: dispatch.issuedAt,
      issuer: "mission-control",
      recipient: "verification-and-review",
      subjectId: dispatch.verificationRunId,
      correlationId: this.#state.correlationId,
      causationId: event.eventId,
      data: {
        verificationRunId: dispatch.verificationRunId,
        attemptId: event.data.attemptId,
        producingRunnerId: event.data.runnerId,
        binding: {
          missionId: this.#state.missionId,
          missionRevision: this.#state.missionRevision,
          startingRevision: this.#state.workContract.startingRevision,
          artifactDigest: copyDigest(event.data.artifact.digest),
          gateSetDigest: copyDigest(this.#state.workContract.gateSetDigest),
        },
        artifact: copyArtifact(event.data.artifact),
        acceptanceGates: this.#state.workContract.acceptanceGates,
      },
    });
    if (!command.ok)
      return failure("INVALID_PROCESS_FACT", command.error.message);
    if (
      !this.#reserveOutgoing(
        dispatch.commandId,
        "VERIFICATION_START_COMMAND",
        command.value,
      )
    )
      return failure(
        "MESSAGE_ID_CONFLICT",
        "Verification command identity was already reserved.",
      );
    this.#state.artifact = copyArtifact(event.data.artifact);
    this.#state.producingRunnerId = event.data.runnerId;
    this.#state.verificationRunId = dispatch.verificationRunId;
    this.#state.expectedVerificationCausationId = dispatch.commandId;
    const dispatchAudit = Object.freeze({
      commandId: dispatch.commandId,
      verificationRunId: dispatch.verificationRunId,
      attemptId: event.data.attemptId,
    });
    this.#state.verificationDispatches.set(dispatch.commandId, dispatchAudit);
    this.#state.usedVerificationRunIds.add(dispatch.verificationRunId);
    this.#state.state = "VERIFICATION_REQUESTED";
    this.#handled(event.eventId, event);
    this.#audit("ARTIFACT_SUBMITTED", {
      event,
      dispatch: normalizedVerificationDispatch(dispatch),
    });
    return this.#success("applied", [command.value]);
  }

  markVerificationDispatched(commandId: string): ProcessResult {
    const marker = { kind: "VERIFICATION_DISPATCHED", commandId };
    if (!isMessageIdentifier(commandId))
      return failure(
        "INVALID_PROCESS_FACT",
        "Verification dispatch command ID is invalid.",
      );
    const acknowledgementFingerprint = fingerprint(marker);
    const acknowledged =
      this.#state.verificationAcknowledgements.get(commandId);
    if (acknowledged)
      return acknowledged === acknowledgementFingerprint
        ? this.#success("idempotent")
        : failure(
            "MESSAGE_ID_CONFLICT",
            "Verification acknowledgement conflicts with the recorded acknowledgement.",
          );
    const dispatch = this.#state.verificationDispatches.get(commandId);
    if (
      !dispatch ||
      this.#state.outgoingMessageIds.get(commandId)?.kind !==
        "VERIFICATION_START_COMMAND"
    )
      return failure(
        "MESSAGE_ID_CONFLICT",
        "Verification dispatch acknowledgement names a different command.",
      );
    if (
      commandId !== this.#state.expectedVerificationCausationId ||
      dispatch.verificationRunId !== this.#state.verificationRunId
    ) {
      this.#state.verificationAcknowledgements.set(
        commandId,
        acknowledgementFingerprint,
      );
      this.#audit("VERIFICATION_DISPATCHED", { commandId });
      return this.#success("idempotent");
    }
    if (
      this.#state.verificationRunId &&
      [
        "VERIFYING",
        "AWAITING_HUMAN_REVIEW",
        "NEEDS_HUMAN_DECISION",
        "COMPLETED",
        "CANCELLED",
      ].includes(this.#state.state)
    ) {
      this.#state.verificationAcknowledgements.set(
        commandId,
        acknowledgementFingerprint,
      );
      this.#audit("VERIFICATION_DISPATCHED", { commandId });
      return this.#success("idempotent");
    }
    if (
      this.#state.state !== "VERIFICATION_REQUESTED" ||
      !this.#state.verificationRunId
    )
      return failure(
        "UNSUPPORTED_TRANSITION",
        "No matching verification request is awaiting dispatch.",
      );
    this.#state.state = "VERIFYING";
    this.#state.verificationAcknowledgements.set(
      commandId,
      acknowledgementFingerprint,
    );
    this.#audit("VERIFICATION_DISPATCHED", { commandId });
    return this.#success("applied");
  }

  recordAttemptEnded(
    event: WorkshopAttemptEndedV1,
    retry?: RetryDispatch,
  ): ProcessResult {
    if (retry !== undefined && !isRetryDispatchInput(retry))
      return failure("INVALID_PROCESS_FACT", "Retry dispatch is invalid.");
    if (
      !translateMissionControlEvent(event).ok ||
      event.subjectId !== event.data.attemptId
    )
      return failure("INVALID_PROCESS_FACT", "Attempt-ended fact is invalid.");
    const duplicate = this.#duplicate(event.eventId, event);
    if (duplicate) return duplicate;
    if (!this.#incomingIdentityValid(event.eventId, event.causationId))
      return failure(
        "MESSAGE_ID_CONFLICT",
        "Attempt-end identity collides with an outgoing message.",
      );
    if (
      this.#commonStale(
        event.data.missionId,
        event.data.missionRevision,
        event.correlationId,
      ) ||
      event.data.attemptId !== this.#state.attemptId
    )
      return this.#ignored();
    if (event.data.outcome === "ARTIFACT_SUBMITTED") {
      this.#handled(event.eventId, event);
      this.#audit("ATTEMPT_ENDED", { event });
      return this.#success("applied");
    }
    if (event.data.outcome === "REVOKED" && this.#state.state === "CANCELLED") {
      this.#handled(event.eventId, event);
      this.#audit("ATTEMPT_ENDED", { event });
      return this.#success("applied");
    }
    if (!["ATTEMPT_REQUESTED", "ATTEMPT_ACTIVE"].includes(this.#state.state))
      return failure("UNSUPPORTED_TRANSITION", "Attempt end is not expected.");
    if (!retry) {
      this.#handled(event.eventId, event);
      this.#state.state = "NEEDS_HUMAN_DECISION";
      this.#audit("ATTEMPT_ENDED", { event });
      return this.#success("applied");
    }
    const result = this.#applyRetry(
      retry,
      event.data.outcome === "LEASE_EXPIRED"
        ? "ATTEMPT_EXPIRED"
        : "ATTEMPT_FAILED",
      event.eventId,
      event,
    );
    if (result.ok)
      this.#audit("ATTEMPT_ENDED", {
        event,
        retry: normalizedRetryDispatch(retry),
      });
    return result;
  }

  recordVerificationVerdict(
    event: VerificationPassedV1 | VerificationFailedV1,
  ): ProcessResult {
    if (
      !verificationEventShape(event) ||
      !translateMissionControlEvent(event).ok
    )
      return failure(
        "INVALID_PROCESS_FACT",
        "Verification verdict is invalid.",
      );
    const duplicate = this.#duplicate(event.eventId, event);
    if (duplicate) return duplicate;
    if (!this.#incomingIdentityValid(event.eventId, event.causationId))
      return failure(
        "MESSAGE_ID_CONFLICT",
        "Verdict identity collides with an outgoing message.",
      );
    const existing = this.#state.outcomeFingerprintsByRun.get(
      event.data.verificationRunId,
    );
    const candidate = outcomeFingerprint(event);
    if (existing) {
      if (existing !== candidate)
        return failure(
          "CONFLICTING_VERIFICATION_FACT",
          "A different terminal outcome already won for this verification run.",
        );
      this.#handled(event.eventId, event);
      this.#audit("VERDICT", { event });
      return this.#success("idempotent");
    }
    if (this.#verificationStale(event)) return this.#ignored();
    if (!["VERIFICATION_REQUESTED", "VERIFYING"].includes(this.#state.state))
      return failure(
        "UNSUPPORTED_TRANSITION",
        "Verification verdict is not expected.",
      );
    if (event.causationId !== this.#state.expectedVerificationCausationId)
      return failure(
        "STALE_FACT",
        "Verdict does not directly follow verification dispatch.",
      );
    this.#state.terminalOutcome = copyEvent(event);
    this.#state.outcomeFingerprintsByRun.set(
      event.data.verificationRunId,
      candidate,
    );
    this.#state.verificationHistory.push(copyEvent(event));
    this.#state.latestVerdict = event.data.verdict;
    this.#state.evidenceBundleDigest = copyDigest(
      event.data.evidenceBundleDigest,
    );
    this.#state.expectedRecommendationCausationId = event.eventId;
    this.#state.state = "VERIFYING";
    this.#handled(event.eventId, event);
    this.#audit("VERDICT", { event });
    return this.#success("applied");
  }

  recordVerificationAborted(
    event: VerificationAbortedV1,
    retry?: RetryDispatch,
  ): ProcessResult {
    if (retry !== undefined && !isRetryDispatchInput(retry))
      return failure("INVALID_PROCESS_FACT", "Retry dispatch is invalid.");
    if (
      !verificationEventShape(event) ||
      !translateMissionControlEvent(event).ok
    )
      return failure("INVALID_PROCESS_FACT", "Verification abort is invalid.");
    const duplicate = this.#duplicate(event.eventId, event);
    if (duplicate) return duplicate;
    if (!this.#incomingIdentityValid(event.eventId, event.causationId))
      return failure(
        "MESSAGE_ID_CONFLICT",
        "Abort identity collides with an outgoing message.",
      );
    const existing = this.#state.outcomeFingerprintsByRun.get(
      event.data.verificationRunId,
    );
    const candidate = outcomeFingerprint(event);
    if (existing) {
      if (existing !== candidate)
        return failure(
          "CONFLICTING_VERIFICATION_FACT",
          "A different terminal outcome already won for this verification run.",
        );
      this.#handled(event.eventId, event);
      this.#audit("ABORTED", { event });
      return this.#success("idempotent");
    }
    if (this.#verificationStale(event)) return this.#ignored();
    if (this.#state.state === "CANCELLED") {
      if (
        event.causationId !== this.#state.expectedVerificationCausationId ||
        event.data.reason !== "MISSION_CANCELLED" ||
        event.data.retryable
      )
        return failure(
          "CONFLICTING_VERIFICATION_FACT",
          "Cancelled verification only accepts the bound non-retryable cancellation abort.",
        );
      this.#state.terminalOutcome = copyEvent(event);
      this.#state.outcomeFingerprintsByRun.set(
        event.data.verificationRunId,
        candidate,
      );
      this.#state.verificationHistory.push(copyEvent(event));
      this.#handled(event.eventId, event);
      this.#audit("ABORTED", { event });
      return this.#success("applied");
    }
    if (!["VERIFICATION_REQUESTED", "VERIFYING"].includes(this.#state.state))
      return failure(
        "UNSUPPORTED_TRANSITION",
        "Verification abort is not expected.",
      );
    if (event.causationId !== this.#state.expectedVerificationCausationId)
      return failure(
        "STALE_FACT",
        "Abort does not directly follow verification dispatch.",
      );
    if (event.data.reason === "MISSION_CANCELLED") {
      if (event.data.retryable)
        return failure(
          "CONFLICTING_VERIFICATION_FACT",
          "Cancellation abort cannot be retryable.",
        );
      this.#state.terminalOutcome = copyEvent(event);
      this.#state.outcomeFingerprintsByRun.set(
        event.data.verificationRunId,
        candidate,
      );
      this.#state.verificationHistory.push(copyEvent(event));
      this.#handled(event.eventId, event);
      this.#state.state = "CANCELLED";
      this.#audit("ABORTED", { event });
      return this.#success("applied");
    }
    if (!event.data.retryable || !retry) {
      this.#state.terminalOutcome = copyEvent(event);
      this.#state.outcomeFingerprintsByRun.set(
        event.data.verificationRunId,
        candidate,
      );
      this.#state.verificationHistory.push(copyEvent(event));
      this.#handled(event.eventId, event);
      this.#state.state = "NEEDS_HUMAN_DECISION";
      this.#audit("ABORTED", { event });
      return this.#success("applied");
    }
    const result = this.#applyRetry(
      retry,
      "VERIFICATION_ABORTED",
      event.eventId,
      event,
    );
    if (result.ok) {
      this.#state.outcomeFingerprintsByRun.set(
        event.data.verificationRunId,
        candidate,
      );
      this.#state.verificationHistory.push(copyEvent(event));
      this.#audit("ABORTED", {
        event,
        retry: normalizedRetryDispatch(retry),
      });
    }
    return result;
  }

  recordReviewRecommendation(
    event: ReviewRecommendationIssuedV1,
  ): ProcessResult {
    if (
      !recommendationEventShape(event) ||
      !translateMissionControlEvent(event).ok
    )
      return failure(
        "INVALID_PROCESS_FACT",
        "Review recommendation is invalid.",
      );
    const duplicate = this.#duplicate(event.eventId, event);
    if (duplicate) return duplicate;
    if (!this.#incomingIdentityValid(event.eventId, event.causationId))
      return failure(
        "MESSAGE_ID_CONFLICT",
        "Recommendation identity collides with an outgoing message.",
      );
    if (this.#verificationStale(event)) return this.#ignored();
    if (
      this.#state.state !== "VERIFYING" ||
      event.causationId !== this.#state.expectedRecommendationCausationId ||
      event.data.verdict !== this.#state.latestVerdict ||
      !this.#state.evidenceBundleDigest ||
      !sameDigest(
        event.data.evidenceBundleDigest,
        this.#state.evidenceBundleDigest,
      ) ||
      (event.data.verdict === "PASSED" &&
        event.data.recommendation !== "APPROVE") ||
      (event.data.verdict === "FAILED" &&
        event.data.recommendation !== "REQUEST_REVISION")
    )
      return failure(
        "UNSUPPORTED_TRANSITION",
        "Recommendation does not directly bind the winning verdict.",
      );
    this.#state.completionReviewId = event.data.completionReviewId;
    this.#state.recommendation = event.data.recommendation;
    this.#state.recommendationEvent = structuredClone(event);
    this.#state.state =
      event.data.recommendation === "APPROVE"
        ? "AWAITING_HUMAN_REVIEW"
        : "NEEDS_HUMAN_DECISION";
    this.#handled(event.eventId, event);
    this.#audit("RECOMMENDATION", { event });
    return this.#success("applied");
  }

  recordHumanRejection(
    decisionId: string,
    retry?: RetryDispatch,
  ): ProcessResult {
    if (retry !== undefined && !isRetryDispatchInput(retry))
      return failure("INVALID_PROCESS_FACT", "Retry dispatch is invalid.");
    if (!isMessageIdentifier(decisionId))
      return failure("INVALID_PROCESS_FACT", "Human decision ID is invalid.");
    const normalizedRetry = retry ? normalizedRetryDispatch(retry) : undefined;
    const decision = {
      kind: "HUMAN_REJECTION",
      decisionId,
      ...(normalizedRetry ? { retry: normalizedRetry } : {}),
    };
    const duplicate = this.#duplicate(decisionId, decision);
    if (duplicate) return duplicate;
    if (this.#state.outgoingMessageIds.has(decisionId))
      return failure(
        "MESSAGE_ID_CONFLICT",
        "Human decision identity collides with an outgoing message.",
      );
    if (
      !["AWAITING_HUMAN_REVIEW", "NEEDS_HUMAN_DECISION"].includes(
        this.#state.state,
      )
    )
      return failure(
        "UNSUPPORTED_TRANSITION",
        "Human rejection is not expected.",
      );
    if (!retry) {
      this.#handled(decisionId, decision);
      this.#state.state = "NEEDS_HUMAN_DECISION";
      this.#audit("HUMAN_REJECTION", { decisionId });
      return this.#success("applied");
    }
    const result = this.#applyRetry(
      retry,
      "HUMAN_AUTHORIZED",
      decisionId,
      decision,
    );
    if (result.ok)
      this.#audit("HUMAN_REJECTION", {
        decisionId,
        retry: normalizedRetryDispatch(retry),
      });
    return result;
  }

  cancel(
    event: MissionCancelledV1,
    dispatch?: OutgoingCommandMetadata,
  ): ProcessResult {
    if (dispatch !== undefined && !isOutgoingCommandMetadataInput(dispatch))
      return failure(
        "INVALID_PROCESS_FACT",
        "Cancellation dispatch metadata is invalid.",
      );
    if (!missionCancelledEventShape(event))
      return failure("INVALID_PROCESS_FACT", "Cancellation fact is invalid.");
    const duplicate = this.#outgoingDuplicate(event.eventId, event);
    if (duplicate) return duplicate;
    if (
      event.eventId === event.causationId ||
      this.#state.messageFingerprints.has(event.eventId) ||
      this.#state.outgoingMessageIds.has(event.eventId)
    )
      return failure(
        "MESSAGE_ID_CONFLICT",
        "Cancellation event identity collides with another message.",
      );
    if (
      this.#commonStale(
        event.data.missionId,
        event.data.missionRevision,
        event.correlationId,
      )
    )
      return this.#ignored();
    if (this.#state.state === "COMPLETED")
      return failure(
        "MISSION_TERMINAL",
        "Completed process cannot be cancelled.",
      );
    const shouldRevoke = [
      "ATTEMPT_REQUESTED",
      "ATTEMPT_ACTIVE",
      "RETRY_REQUESTED",
    ].includes(this.#state.state);
    const attemptId = this.#state.attemptId;
    if (shouldRevoke && attemptId && !dispatch)
      return failure(
        "INVALID_PROCESS_FACT",
        "Cancellation of active work requires revoke command metadata.",
      );
    let revokeCommand: PublicCommandV1 | undefined;
    if (shouldRevoke && attemptId && dispatch) {
      if (
        dispatch.commandId === event.eventId ||
        this.#state.outgoingMessageIds.has(dispatch.commandId) ||
        this.#state.messageFingerprints.has(dispatch.commandId)
      )
        return failure(
          "INVALID_PROCESS_FACT",
          "Cancellation dispatch metadata is invalid.",
        );
      const built = finalizeMissionControlCommand({
        commandId: dispatch.commandId,
        commandType: "workshop.revoke-attempt.v1",
        schemaVersion: 1,
        issuedAt: dispatch.issuedAt,
        issuer: "mission-control",
        recipient: "workshop",
        subjectId: attemptId,
        correlationId: this.#state.correlationId,
        causationId: event.eventId,
        data: {
          missionId: this.#state.missionId,
          missionRevision: this.#state.missionRevision,
          attemptId,
          reason: "MISSION_CANCELLED",
        },
      });
      if (!built.ok)
        return failure("INVALID_PROCESS_FACT", built.error.message);
      revokeCommand = built.value;
    }
    if (
      !this.#reserveOutgoing(event.eventId, "MISSION_CANCELLED_EVENT", event) ||
      (revokeCommand &&
        dispatch &&
        !this.#reserveOutgoing(
          dispatch.commandId,
          "WORKSHOP_REVOKE_ATTEMPT_COMMAND",
          revokeCommand,
        ))
    )
      return failure(
        "MESSAGE_ID_CONFLICT",
        "Cancellation message identity was already reserved.",
      );
    this.#state.state = "CANCELLED";
    this.#audit("CANCELLED", {
      event,
      ...(dispatch ? { dispatch: normalizedOutgoingMetadata(dispatch) } : {}),
    });
    if (!shouldRevoke || !attemptId || !revokeCommand)
      return this.#success("applied");
    return this.#success("applied", [revokeCommand]);
  }

  complete(event: MissionCompletedV1): ProcessResult {
    if (!missionCompletedEventShape(event))
      return failure("INVALID_PROCESS_FACT", "Completion fact is invalid.");
    const duplicate = this.#outgoingDuplicate(event.eventId, event);
    if (duplicate) return duplicate;
    if (
      event.eventId === event.causationId ||
      this.#state.messageFingerprints.has(event.eventId) ||
      this.#state.outgoingMessageIds.has(event.eventId)
    )
      return failure(
        "MESSAGE_ID_CONFLICT",
        "Completion event identity collides with another message.",
      );
    if (
      this.#commonStale(
        event.data.missionId,
        event.data.missionRevision,
        event.correlationId,
      )
    )
      return this.#ignored();
    if (
      this.#state.state !== "AWAITING_HUMAN_REVIEW" ||
      event.data.completionReviewId !== this.#state.completionReviewId ||
      event.data.verificationRunId !== this.#state.verificationRunId ||
      event.data.recommendation !== this.#state.recommendation ||
      !this.#state.artifact ||
      !sameDigest(event.data.artifactDigest, this.#state.artifact.digest) ||
      !sameDigest(
        event.data.gateSetDigest,
        this.#state.workContract.gateSetDigest,
      ) ||
      !this.#state.evidenceBundleDigest ||
      !sameDigest(
        event.data.evidenceBundleDigest,
        this.#state.evidenceBundleDigest,
      )
    )
      return failure(
        "UNSUPPORTED_TRANSITION",
        "Completion does not bind current review.",
      );
    if (!this.#reserveOutgoing(event.eventId, "MISSION_COMPLETED_EVENT", event))
      return failure(
        "MESSAGE_ID_CONFLICT",
        "Completion event identity was already reserved.",
      );
    this.#state.state = "COMPLETED";
    this.#audit("COMPLETED", { event });
    return this.#success("applied");
  }

  toMemento(): MissionCompletionProcessMementoV1 {
    return Object.freeze({
      mementoType: "patchquest.mission-completion-process",
      mementoVersion: 1,
      missionId: this.#state.missionId,
      missionRevision: this.#state.missionRevision,
      state: this.#state.state,
      correlationId: this.#state.correlationId,
      workContract: copyWorkContract(this.#state.workContract),
      attemptBudget: this.#state.attemptBudget,
      attemptsAuthorized: this.#state.attemptsAuthorized,
      ...(this.#state.attemptId ? { attemptId: this.#state.attemptId } : {}),
      ...(this.#state.attemptNumber
        ? { attemptNumber: this.#state.attemptNumber }
        : {}),
      ...(this.#state.artifact
        ? { artifact: copyArtifact(this.#state.artifact) }
        : {}),
      ...(this.#state.producingRunnerId
        ? { producingRunnerId: this.#state.producingRunnerId }
        : {}),
      ...(this.#state.verificationRunId
        ? { verificationRunId: this.#state.verificationRunId }
        : {}),
      ...(this.#state.completionReviewId
        ? { completionReviewId: this.#state.completionReviewId }
        : {}),
      ...(this.#state.latestVerdict
        ? { latestVerdict: this.#state.latestVerdict }
        : {}),
      ...(this.#state.evidenceBundleDigest
        ? { evidenceBundleDigest: copyDigest(this.#state.evidenceBundleDigest) }
        : {}),
      ...(this.#state.recommendation
        ? { recommendation: this.#state.recommendation }
        : {}),
      ...(this.#state.recommendationEvent
        ? {
            recommendationEvent: structuredClone(
              this.#state.recommendationEvent,
            ),
          }
        : {}),
      ...(this.#state.terminalOutcome
        ? { terminalOutcome: copyEvent(this.#state.terminalOutcome) }
        : {}),
      ...(this.#state.expectedAttemptReadyCausationId
        ? {
            expectedAttemptReadyCausationId:
              this.#state.expectedAttemptReadyCausationId,
          }
        : {}),
      ...(this.#state.expectedVerificationCausationId
        ? {
            expectedVerificationCausationId:
              this.#state.expectedVerificationCausationId,
          }
        : {}),
      ...(this.#state.expectedRecommendationCausationId
        ? {
            expectedRecommendationCausationId:
              this.#state.expectedRecommendationCausationId,
          }
        : {}),
      messageFingerprints: Object.freeze(
        [...this.#state.messageFingerprints.entries()].map(
          (entry) => Object.freeze(entry) as readonly [string, string],
        ),
      ),
      outcomeFingerprintsByRun: Object.freeze(
        [...this.#state.outcomeFingerprintsByRun.entries()].map(
          (entry) => Object.freeze(entry) as readonly [string, string],
        ),
      ),
      verificationHistory: Object.freeze(
        this.#state.verificationHistory.map((event) => copyEvent(event)),
      ),
      authorizedAttemptIds: Object.freeze([
        ...this.#state.authorizedAttemptIds,
      ]),
      verificationDispatches: Object.freeze(
        [...this.#state.verificationDispatches.values()].map((entry) =>
          Object.freeze({ ...entry }),
        ),
      ),
      verificationAcknowledgements: Object.freeze(
        [...this.#state.verificationAcknowledgements.entries()].map(
          (entry) => Object.freeze(entry) as readonly [string, string],
        ),
      ),
      outgoingMessageIds: Object.freeze(
        [...this.#state.outgoingMessageIds.entries()].map(
          ([messageId, identity]) => Object.freeze({ messageId, ...identity }),
        ),
      ),
      auditTrail: Object.freeze(
        this.#state.auditTrail.map((entry) => copyAuditEntry(entry)),
      ),
    });
  }

  static rehydrate(
    value: unknown,
  ):
    | { readonly ok: true; readonly process: MissionCompletionProcess }
    | { readonly ok: false; readonly error: ProcessError } {
    if (
      !isExactJsonRecord(
        value,
        [
          "mementoType",
          "mementoVersion",
          "missionId",
          "missionRevision",
          "state",
          "correlationId",
          "workContract",
          "attemptBudget",
          "attemptsAuthorized",
          "messageFingerprints",
          "outcomeFingerprintsByRun",
          "verificationHistory",
          "authorizedAttemptIds",
          "verificationDispatches",
          "verificationAcknowledgements",
          "outgoingMessageIds",
          "auditTrail",
        ],
        [
          "attemptId",
          "attemptNumber",
          "artifact",
          "producingRunnerId",
          "verificationRunId",
          "completionReviewId",
          "latestVerdict",
          "evidenceBundleDigest",
          "recommendation",
          "recommendationEvent",
          "terminalOutcome",
          "expectedAttemptReadyCausationId",
          "expectedVerificationCausationId",
          "expectedRecommendationCausationId",
        ],
      ) ||
      value["mementoType"] !== "patchquest.mission-completion-process"
    )
      return {
        ok: false,
        error: {
          code: "PERSISTENCE_MEMENTO_INVALID",
          message: "Process memento type is invalid.",
        },
      };
    if (value["mementoVersion"] !== 1)
      return {
        ok: false,
        error: {
          code: "PERSISTENCE_VERSION_UNSUPPORTED",
          message: "Process memento version is unsupported.",
        },
      };
    const memento = value as unknown as MissionCompletionProcessMementoV1;
    const states: readonly MissionCompletionProcessState[] = [
      "ATTEMPT_REQUESTED",
      "ATTEMPT_ACTIVE",
      "VERIFICATION_REQUESTED",
      "VERIFYING",
      "AWAITING_HUMAN_REVIEW",
      "RETRY_REQUESTED",
      "NEEDS_HUMAN_DECISION",
      "COMPLETED",
      "CANCELLED",
    ];
    const pairsValid = (
      pairs: unknown,
    ): pairs is readonly (readonly [string, string])[] =>
      isDenseJsonArray(pairs) &&
      pairs.every(
        (pair) =>
          isDenseJsonArray(pair) &&
          pair.length === 2 &&
          isIdentifier(pair[0]) &&
          typeof pair[1] === "string" &&
          digestPattern.test(pair[1]),
      );
    if (
      !isIdentifier(memento.missionId) ||
      !Number.isSafeInteger(memento.missionRevision) ||
      memento.missionRevision < 1 ||
      !states.includes(memento.state) ||
      !isIdentifier(memento.correlationId) ||
      !isMissionWorkContract(memento.workContract) ||
      !Number.isSafeInteger(memento.attemptBudget) ||
      memento.attemptBudget < 1 ||
      !Number.isSafeInteger(memento.attemptsAuthorized) ||
      memento.attemptsAuthorized < 1 ||
      memento.attemptsAuthorized > memento.attemptBudget ||
      !isDenseJsonArray(memento.authorizedAttemptIds) ||
      memento.authorizedAttemptIds.length !== memento.attemptsAuthorized ||
      !memento.authorizedAttemptIds.every(isIdentifier) ||
      new Set(memento.authorizedAttemptIds).size !==
        memento.authorizedAttemptIds.length ||
      !memento.attemptId ||
      !memento.authorizedAttemptIds.includes(memento.attemptId) ||
      memento.attemptNumber !== memento.attemptsAuthorized ||
      (memento.producingRunnerId !== undefined &&
        !isIdentifier(memento.producingRunnerId)) ||
      (memento.verificationRunId !== undefined &&
        !isIdentifier(memento.verificationRunId)) ||
      (memento.completionReviewId !== undefined &&
        !isIdentifier(memento.completionReviewId)) ||
      (memento.expectedAttemptReadyCausationId !== undefined &&
        !isIdentifier(memento.expectedAttemptReadyCausationId)) ||
      (memento.expectedVerificationCausationId !== undefined &&
        !isIdentifier(memento.expectedVerificationCausationId)) ||
      (memento.expectedRecommendationCausationId !== undefined &&
        !isIdentifier(memento.expectedRecommendationCausationId)) ||
      (memento.latestVerdict !== undefined &&
        memento.latestVerdict !== "PASSED" &&
        memento.latestVerdict !== "FAILED") ||
      (memento.recommendation !== undefined &&
        memento.recommendation !== "APPROVE" &&
        memento.recommendation !== "REQUEST_REVISION") ||
      (memento.recommendationEvent !== undefined &&
        !recommendationEventShape(memento.recommendationEvent)) ||
      !pairsValid(memento.messageFingerprints) ||
      !pairsValid(memento.outcomeFingerprintsByRun) ||
      new Set(memento.messageFingerprints.map(([id]) => id)).size !==
        memento.messageFingerprints.length ||
      new Set(memento.outcomeFingerprintsByRun.map(([id]) => id)).size !==
        memento.outcomeFingerprintsByRun.length ||
      !isDenseJsonArray(memento.verificationHistory) ||
      !memento.verificationHistory.every(verificationEventShape) ||
      !isDenseJsonArray(memento.verificationDispatches) ||
      !memento.verificationDispatches.every(
        (entry) =>
          isRecord(entry) &&
          hasExactKeys(entry, [
            "commandId",
            "verificationRunId",
            "attemptId",
          ]) &&
          isMessageIdentifier(entry["commandId"]) &&
          isMessageIdentifier(entry["verificationRunId"]) &&
          isMessageIdentifier(entry["attemptId"]),
      ) ||
      new Set(memento.verificationDispatches.map(({ commandId }) => commandId))
        .size !== memento.verificationDispatches.length ||
      new Set(
        memento.verificationDispatches.map(
          ({ verificationRunId }) => verificationRunId,
        ),
      ).size !== memento.verificationDispatches.length ||
      !pairsValid(memento.verificationAcknowledgements) ||
      new Set(
        memento.verificationAcknowledgements.map(([commandId]) => commandId),
      ).size !== memento.verificationAcknowledgements.length ||
      !memento.verificationAcknowledgements.every(([commandId]) =>
        memento.verificationDispatches.some(
          (dispatch) => dispatch.commandId === commandId,
        ),
      ) ||
      !isDenseJsonArray(memento.outgoingMessageIds) ||
      !memento.outgoingMessageIds.every(
        (entry) =>
          isRecord(entry) &&
          hasExactKeys(entry, ["messageId", "kind", "fingerprint"]) &&
          isMessageIdentifier(entry["messageId"]) &&
          typeof entry["fingerprint"] === "string" &&
          digestPattern.test(entry["fingerprint"]) &&
          [
            "MISSION_OPENED_EVENT",
            "MISSION_RETRY_AUTHORIZED_EVENT",
            "MISSION_CANCELLED_EVENT",
            "MISSION_COMPLETED_EVENT",
            "WORKSHOP_CREATE_ATTEMPT_COMMAND",
            "VERIFICATION_START_COMMAND",
            "WORKSHOP_REVOKE_ATTEMPT_COMMAND",
          ].includes(String(entry["kind"])),
      ) ||
      new Set(memento.outgoingMessageIds.map(({ messageId }) => messageId))
        .size !== memento.outgoingMessageIds.length ||
      !isDenseJsonArray(memento.auditTrail) ||
      memento.auditTrail.length < 1 ||
      !memento.auditTrail.every(
        (entry) =>
          isRecord(entry) &&
          hasExactKeys(entry, [
            "kind",
            "payload",
            "previousDigest",
            "entryDigest",
          ]) &&
          [
            "START",
            "ATTEMPT_READY",
            "ATTEMPT_LEASED",
            "ARTIFACT_SUBMITTED",
            "VERIFICATION_DISPATCHED",
            "ATTEMPT_ENDED",
            "VERDICT",
            "ABORTED",
            "RECOMMENDATION",
            "HUMAN_REJECTION",
            "CANCELLED",
            "COMPLETED",
          ].includes(String(entry["kind"])) &&
          isRecord(entry["payload"]) &&
          typeof entry["previousDigest"] === "string" &&
          digestPattern.test(entry["previousDigest"]) &&
          typeof entry["entryDigest"] === "string" &&
          digestPattern.test(entry["entryDigest"]),
      ) ||
      memento.auditTrail[0]?.kind !== "START" ||
      !memento.auditTrail.every((entry, index) => {
        const expectedPrevious =
          index === 0
            ? "0".repeat(64)
            : memento.auditTrail[index - 1]?.entryDigest;
        return (
          entry.previousDigest === expectedPrevious &&
          entry.entryDigest ===
            auditEntryDigest(entry.kind, entry.payload, entry.previousDigest)
        );
      }) ||
      (memento.artifact !== undefined && !artifactShape(memento.artifact)) ||
      (memento.evidenceBundleDigest !== undefined &&
        !isDigest(memento.evidenceBundleDigest)) ||
      (memento.latestVerdict === undefined) !==
        (memento.evidenceBundleDigest === undefined) ||
      (memento.artifact !== undefined &&
        (memento.verificationRunId === undefined ||
          memento.expectedVerificationCausationId === undefined)) ||
      ([
        "VERIFICATION_REQUESTED",
        "VERIFYING",
        "AWAITING_HUMAN_REVIEW",
      ].includes(memento.state) &&
        (!memento.artifact || !memento.verificationRunId)) ||
      (memento.terminalOutcome !== undefined &&
        !verificationEventShape(memento.terminalOutcome)) ||
      !processMementoInvariant(memento)
    )
      return {
        ok: false,
        error: {
          code: "PERSISTENCE_MEMENTO_INVALID",
          message: "Process memento is inconsistent.",
        },
      };
    try {
      const process = MissionCompletionProcess.#replayMemento(memento);
      if (!process)
        return {
          ok: false,
          error: {
            code: "PERSISTENCE_MEMENTO_INVALID",
            message: "Process memento provenance cannot be replayed.",
          },
        };
      return { ok: true, process };
    } catch {
      return {
        ok: false,
        error: {
          code: "PERSISTENCE_MEMENTO_INVALID",
          message: "Process memento contains malformed nested state.",
        },
      };
    }
  }

  static #replayMemento(
    memento: MissionCompletionProcessMementoV1,
  ): MissionCompletionProcess | undefined {
    const startEntry = memento.auditTrail[0];
    if (!startEntry || !isRecord(startEntry.payload)) return undefined;
    const startPayload = startEntry.payload;
    if (
      !hasExactKeys(startPayload, ["seed", "metadata"]) ||
      !isRecord(startPayload["seed"]) ||
      !isRecord(startPayload["metadata"])
    )
      return undefined;
    const auditedSeed = startPayload["seed"];
    const auditedMetadata = startPayload["metadata"];
    if (
      !hasExactKeys(auditedSeed, [
        "missionId",
        "missionRevision",
        "workContract",
        "attemptBudget",
        "attemptsAuthorized",
        "attemptId",
        "attemptNumber",
      ]) ||
      !isMessageIdentifier(auditedSeed["missionId"]) ||
      !Number.isSafeInteger(auditedSeed["missionRevision"]) ||
      Number(auditedSeed["missionRevision"]) < 1 ||
      !isMissionWorkContract(auditedSeed["workContract"]) ||
      !Number.isSafeInteger(auditedSeed["attemptBudget"]) ||
      Number(auditedSeed["attemptBudget"]) < 1 ||
      auditedSeed["attemptsAuthorized"] !== 1 ||
      !isMessageIdentifier(auditedSeed["attemptId"]) ||
      auditedSeed["attemptNumber"] !== 1 ||
      !hasExactKeys(auditedMetadata, [
        "openedEventId",
        "commandId",
        "issuedAt",
        "correlationId",
      ]) ||
      !isMessageIdentifier(auditedMetadata["openedEventId"]) ||
      !isMessageIdentifier(auditedMetadata["commandId"]) ||
      !isRfc3339DateTime(auditedMetadata["issuedAt"]) ||
      !isMessageIdentifier(auditedMetadata["correlationId"])
    )
      return undefined;
    const started = MissionCompletionProcess.start(
      {
        missionId: auditedSeed["missionId"],
        missionRevision: Number(auditedSeed["missionRevision"]),
        workContract: auditedSeed["workContract"],
        attemptBudget: Number(auditedSeed["attemptBudget"]),
        attemptsAuthorized: 1,
        attemptId: auditedSeed["attemptId"],
        attemptNumber: 1,
      },
      {
        openedEventId: auditedMetadata["openedEventId"],
        commandId: auditedMetadata["commandId"],
        issuedAt: auditedMetadata["issuedAt"],
        correlationId: auditedMetadata["correlationId"],
      },
    );
    if (!started.ok) return undefined;
    const process = started.process;
    for (const entry of memento.auditTrail.slice(1)) {
      if (!isRecord(entry.payload)) return undefined;
      const payload = entry.payload;
      let result: ProcessResult;
      switch (entry.kind) {
        case "START":
          return undefined;
        case "ATTEMPT_READY":
          if (!hasExactKeys(payload, ["event"])) return undefined;
          result = process.recordAttemptReady(
            payload["event"] as WorkshopAttemptReadyV1,
          );
          break;
        case "ATTEMPT_LEASED":
          if (!hasExactKeys(payload, ["event"])) return undefined;
          result = process.recordAttemptLeased(
            payload["event"] as WorkshopAttemptLeasedV1,
          );
          break;
        case "ARTIFACT_SUBMITTED":
          if (!hasExactKeys(payload, ["event", "dispatch"])) return undefined;
          result = process.recordArtifactSubmitted(
            payload["event"] as WorkshopArtifactSubmittedV1,
            payload["dispatch"] as VerificationDispatch,
          );
          break;
        case "VERIFICATION_DISPATCHED":
          if (
            !hasExactKeys(payload, ["commandId"]) ||
            !isMessageIdentifier(payload["commandId"])
          )
            return undefined;
          result = process.markVerificationDispatched(payload["commandId"]);
          break;
        case "ATTEMPT_ENDED":
          if (!hasExactKeys(payload, ["event"], ["retry"])) return undefined;
          result = process.recordAttemptEnded(
            payload["event"] as WorkshopAttemptEndedV1,
            payload["retry"] as RetryDispatch | undefined,
          );
          break;
        case "VERDICT":
          if (!hasExactKeys(payload, ["event"])) return undefined;
          result = process.recordVerificationVerdict(
            payload["event"] as VerificationPassedV1 | VerificationFailedV1,
          );
          break;
        case "ABORTED":
          if (!hasExactKeys(payload, ["event"], ["retry"])) return undefined;
          result = process.recordVerificationAborted(
            payload["event"] as VerificationAbortedV1,
            payload["retry"] as RetryDispatch | undefined,
          );
          break;
        case "RECOMMENDATION":
          if (!hasExactKeys(payload, ["event"])) return undefined;
          result = process.recordReviewRecommendation(
            payload["event"] as ReviewRecommendationIssuedV1,
          );
          break;
        case "HUMAN_REJECTION":
          if (
            !hasExactKeys(payload, ["decisionId"], ["retry"]) ||
            !isMessageIdentifier(payload["decisionId"])
          )
            return undefined;
          result = process.recordHumanRejection(
            payload["decisionId"],
            payload["retry"] as RetryDispatch | undefined,
          );
          break;
        case "CANCELLED":
          if (!hasExactKeys(payload, ["event"], ["dispatch"])) return undefined;
          result = process.cancel(
            payload["event"] as MissionCancelledV1,
            payload["dispatch"] as OutgoingCommandMetadata | undefined,
          );
          break;
        case "COMPLETED":
          if (!hasExactKeys(payload, ["event"])) return undefined;
          result = process.complete(payload["event"] as MissionCompletedV1);
          break;
      }
      if (!result.ok || result.disposition === "ignored") return undefined;
    }
    return canonicalize(process.toMemento()) === canonicalize(memento)
      ? process
      : undefined;
  }

  #applyRetry(
    retry: RetryDispatch,
    expectedReason: MissionRetryAuthorizedV1["data"]["reason"],
    expectedCausationId: string,
    triggeringFact: unknown,
  ): ProcessResult {
    const authorization = retry.authorization;
    if (
      !isRecord(authorization) ||
      !hasExactKeys(authorization, [
        "eventId",
        "eventType",
        "schemaVersion",
        "occurredAt",
        "producer",
        "subjectId",
        "correlationId",
        "causationId",
        "data",
      ]) ||
      !isRecord(authorization.data) ||
      !hasExactKeys(
        authorization.data,
        [
          "missionId",
          "missionRevision",
          "nextAttemptNumber",
          "attemptBudget",
          "reason",
        ],
        ["feedback"],
      ) ||
      authorization.eventType !== "mission.retry-authorized.v1" ||
      authorization.schemaVersion !== 1 ||
      authorization.producer !== "mission-control" ||
      !isMessageIdentifier(authorization.eventId) ||
      !isRfc3339DateTime(authorization.occurredAt) ||
      !isMessageIdentifier(authorization.subjectId) ||
      authorization.subjectId !== this.#state.missionId ||
      !isMessageIdentifier(authorization.correlationId) ||
      !isMessageIdentifier(authorization.causationId) ||
      authorization.eventId === authorization.causationId ||
      authorization.correlationId !== this.#state.correlationId ||
      authorization.data.missionId !== this.#state.missionId ||
      authorization.data.missionRevision !== this.#state.missionRevision ||
      authorization.data.reason !== expectedReason ||
      authorization.causationId !== expectedCausationId ||
      authorization.data.attemptBudget !== this.#state.attemptBudget ||
      authorization.data.nextAttemptNumber !==
        this.#state.attemptsAuthorized + 1 ||
      authorization.data.nextAttemptNumber > this.#state.attemptBudget ||
      !isIdentifier(retry.attemptId) ||
      this.#state.authorizedAttemptIds.has(retry.attemptId) ||
      !isMessageIdentifier(retry.commandId) ||
      !isRfc3339DateTime(retry.issuedAt) ||
      retry.commandId === authorization.eventId ||
      retry.commandId === expectedCausationId ||
      this.#state.outgoingMessageIds.has(authorization.eventId) ||
      this.#state.outgoingMessageIds.has(retry.commandId) ||
      this.#state.messageFingerprints.has(authorization.eventId) ||
      this.#state.messageFingerprints.has(retry.commandId) ||
      (authorization.data.feedback !== undefined &&
        !isBoundedText(authorization.data.feedback, 2000))
    )
      return failure("INVALID_PROCESS_FACT", "Retry authorization is stale.");
    const command = this.#createAttemptCommand(
      retry.commandId,
      retry.issuedAt,
      authorization.eventId,
      retry.attemptId,
      authorization.data.nextAttemptNumber,
    );
    if (!command.ok)
      return failure("INVALID_PROCESS_FACT", command.error.message);
    if (
      !this.#reserveOutgoing(
        authorization.eventId,
        "MISSION_RETRY_AUTHORIZED_EVENT",
        authorization,
      ) ||
      !this.#reserveOutgoing(
        retry.commandId,
        "WORKSHOP_CREATE_ATTEMPT_COMMAND",
        command.value,
      )
    )
      return failure(
        "MESSAGE_ID_CONFLICT",
        "Retry message identity was already reserved.",
      );
    this.#handled(expectedCausationId, triggeringFact);
    this.#state.attemptsAuthorized = authorization.data.nextAttemptNumber;
    this.#state.attemptNumber = authorization.data.nextAttemptNumber;
    this.#state.attemptId = retry.attemptId;
    this.#state.authorizedAttemptIds.add(retry.attemptId);
    this.#state.artifact = undefined;
    this.#state.producingRunnerId = undefined;
    this.#state.verificationRunId = undefined;
    this.#state.completionReviewId = undefined;
    this.#state.latestVerdict = undefined;
    this.#state.evidenceBundleDigest = undefined;
    this.#state.recommendation = undefined;
    this.#state.recommendationEvent = undefined;
    this.#state.terminalOutcome = undefined;
    this.#state.expectedAttemptReadyCausationId = retry.commandId;
    this.#state.expectedVerificationCausationId = undefined;
    this.#state.expectedRecommendationCausationId = undefined;
    this.#state.state = "RETRY_REQUESTED";
    return this.#success("applied", [command.value]);
  }

  #createAttemptCommand(
    commandId: string,
    issuedAt: string,
    causationId: string,
    attemptId = this.#state.attemptId,
    attemptNumber = this.#state.attemptNumber,
  ): OutgoingBuildResult<PublicCommandV1> {
    if (!attemptId || !attemptNumber)
      return {
        ok: false,
        error: {
          code: "OUTGOING_MESSAGE_INVALID",
          message: "Attempt identity is required by process state.",
        },
      };
    return finalizeMissionControlCommand({
      commandId,
      commandType: "workshop.create-attempt.v1",
      schemaVersion: 1,
      issuedAt,
      issuer: "mission-control",
      recipient: "workshop",
      subjectId: attemptId,
      correlationId: this.#state.correlationId,
      causationId,
      data: {
        missionId: this.#state.missionId,
        missionRevision: this.#state.missionRevision,
        objective: this.#state.workContract.objective,
        startingRevision: this.#state.workContract.startingRevision,
        workspaceReference: this.#state.workContract.workspaceReference,
        allowedScope: this.#state.workContract.allowedScope,
        requestedCapabilities: this.#state.workContract.requestedCapabilities,
        acceptanceGates: this.#state.workContract.acceptanceGates,
        gateSetDigest: this.#state.workContract.gateSetDigest,
        attemptId,
        attemptNumber,
        attemptBudget: this.#state.attemptBudget,
      },
    });
  }

  #verificationStale(
    event:
      | VerificationPassedV1
      | VerificationFailedV1
      | VerificationAbortedV1
      | ReviewRecommendationIssuedV1,
  ): boolean {
    const binding = event.data.binding;
    return (
      event.correlationId !== this.#state.correlationId ||
      event.data.verificationRunId !== this.#state.verificationRunId ||
      ("attemptId" in event.data &&
        event.data.attemptId !== this.#state.attemptId) ||
      binding.missionId !== this.#state.missionId ||
      binding.missionRevision !== this.#state.missionRevision ||
      binding.startingRevision !== this.#state.workContract.startingRevision ||
      !this.#state.artifact ||
      !sameDigest(binding.artifactDigest, this.#state.artifact.digest) ||
      !sameDigest(binding.gateSetDigest, this.#state.workContract.gateSetDigest)
    );
  }

  #commonStale(
    missionId: string,
    missionRevision: number,
    correlationId: string,
  ): boolean {
    return (
      missionId !== this.#state.missionId ||
      missionRevision !== this.#state.missionRevision ||
      correlationId !== this.#state.correlationId
    );
  }

  #duplicate(messageId: string, payload: unknown): ProcessResult | undefined {
    const existing = this.#state.messageFingerprints.get(messageId);
    if (!existing) return undefined;
    return existing === fingerprint(payload)
      ? this.#success("idempotent")
      : failure(
          "MESSAGE_ID_CONFLICT",
          "A message ID was reused with a different payload.",
        );
  }

  #handled(messageId: string, payload: unknown): void {
    this.#state.messageFingerprints.set(messageId, fingerprint(payload));
  }

  #audit(kind: ProcessAuditKind, payload: unknown): void {
    const previousDigest =
      this.#state.auditTrail.at(-1)?.entryDigest ?? "0".repeat(64);
    this.#state.auditTrail.push(
      copyAuditEntry({
        kind,
        payload,
        previousDigest,
        entryDigest: auditEntryDigest(kind, payload, previousDigest),
      }),
    );
  }

  #reserveOutgoing(
    messageId: string,
    kind: OutgoingMessageIdentity["kind"],
    payload: unknown,
  ): boolean {
    if (
      !isMessageIdentifier(messageId) ||
      this.#state.outgoingMessageIds.has(messageId) ||
      this.#state.messageFingerprints.has(messageId)
    )
      return false;
    this.#state.outgoingMessageIds.set(
      messageId,
      Object.freeze({ kind, fingerprint: fingerprint(payload) }),
    );
    return true;
  }

  #outgoingDuplicate(
    messageId: string,
    payload: unknown,
  ): ProcessResult | undefined {
    const existing = this.#state.outgoingMessageIds.get(messageId);
    if (!existing) return undefined;
    return existing.fingerprint === fingerprint(payload)
      ? this.#success("idempotent")
      : failure(
          "MESSAGE_ID_CONFLICT",
          "An outgoing message ID was reused with different normalized content.",
        );
  }

  #incomingIdentityValid(eventId: string, causationId: string): boolean {
    return (
      eventId !== causationId && !this.#state.outgoingMessageIds.has(eventId)
    );
  }

  #ignored(): ProcessResult {
    return this.#success("ignored");
  }

  #success(
    disposition: "applied" | "idempotent" | "ignored",
    commands: readonly PublicCommandV1[] = [],
  ): ProcessResult {
    return { ok: true, disposition, snapshot: this.snapshot, commands };
  }
}
