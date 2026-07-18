import type {
  Artifact,
  Digest,
  MissionCancelledV1,
  MissionCompletedV1,
  MissionOpenedV1,
  MissionRetryAuthorizedV1,
  ReviewRecommendationIssuedV1,
  VerificationAbortedV1,
  VerificationBinding,
  VerificationFailedV1,
  VerificationPassedV1,
  WorkshopArtifactSubmittedV1,
  WorkshopAttemptEndedV1,
  WorkshopAttemptLeasedV1,
  WorkshopAttemptReadyV1,
} from "@patchquest/contracts";
import {
  isMissionWorkContract,
  MISSION_RETRY_REASONS,
  type MissionDomainEvent,
  type RecordArtifactSubmitted,
  type RecordAttemptEnded,
  type RecordAttemptLeased,
  type RecordReviewRecommendation,
  type RecordVerificationAborted,
  type RecordVerificationVerdict,
} from "../domain/mission.js";
import {
  hasExactKeys,
  hasJsonContentTopology,
  isBoundedText,
  isDenseJsonArray,
  isMessageIdentifier,
  isPlainRecord,
  isRfc3339DateTime,
  isSha256Digest,
} from "./message-validation.js";
import { finalizeMissionPublicEvent } from "./outgoing-message-factory.js";

export interface EventMetadata {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
}

export type MissionPublicEvent =
  | MissionOpenedV1
  | MissionRetryAuthorizedV1
  | MissionCancelledV1
  | MissionCompletedV1;

export type MissionControlInboundEvent =
  | WorkshopAttemptReadyV1
  | WorkshopAttemptLeasedV1
  | WorkshopArtifactSubmittedV1
  | WorkshopAttemptEndedV1
  | VerificationPassedV1
  | VerificationFailedV1
  | VerificationAbortedV1
  | ReviewRecommendationIssuedV1;

export type MissionAggregateInboundEvent = Exclude<
  MissionControlInboundEvent,
  WorkshopAttemptReadyV1
>;

export type MissionPrivateFact =
  | Readonly<{ kind: "RECORD_ATTEMPT_LEASED"; fact: RecordAttemptLeased }>
  | Readonly<{ kind: "RECORD_ATTEMPT_ENDED"; fact: RecordAttemptEnded }>
  | Readonly<{
      kind: "RECORD_ARTIFACT_SUBMITTED";
      fact: RecordArtifactSubmitted;
    }>
  | Readonly<{
      kind: "RECORD_VERIFICATION_VERDICT";
      fact: RecordVerificationVerdict;
    }>
  | Readonly<{
      kind: "RECORD_VERIFICATION_ABORTED";
      fact: RecordVerificationAborted;
    }>
  | Readonly<{
      kind: "RECORD_REVIEW_RECOMMENDATION";
      fact: RecordReviewRecommendation;
    }>;

export interface MissionFactContext {
  readonly missionRevision: number;
  readonly currentAttemptNumber: number;
}

export type TranslationResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | {
      readonly ok: false;
      readonly error: Readonly<{
        code: "CONTRACT_INVALID" | "UNSUPPORTED_MESSAGE";
        message: string;
      }>;
    };

export function translateMissionDomainEvent(
  event: MissionDomainEvent,
  metadata: EventMetadata,
): TranslationResult<MissionPublicEvent> {
  if (!isMissionDomainEventInput(event) || !isEventMetadata(metadata))
    return invalid(
      "Mission event or metadata is invalid or has an open-ended topology.",
    );
  const finalized = finalizeMissionPublicEvent(
    missionDomainEventCandidate(event, metadata),
  );
  return finalized.ok
    ? { ok: true, value: finalized.value }
    : {
        ok: false,
        error: {
          code: "CONTRACT_INVALID",
          message: finalized.error.message,
        },
      };
}

function missionDomainEventCandidate(
  event: MissionDomainEvent,
  metadata: EventMetadata,
): MissionPublicEvent {
  switch (event.kind) {
    case "MISSION_OPENED":
      return {
        ...eventEnvelope(metadata, "mission.opened.v1", event.missionId),
        data: {
          missionId: event.missionId,
          missionRevision: event.missionRevision,
          objective: event.workContract.objective,
          startingRevision: event.workContract.startingRevision,
          allowedScope: event.workContract.allowedScope,
          requestedCapabilities: event.workContract.requestedCapabilities,
          acceptanceGates: event.workContract.acceptanceGates,
          gateSetDigest: event.workContract.gateSetDigest,
          attemptBudget: event.attemptBudget,
        },
      };
    case "MISSION_RETRY_AUTHORIZED":
      return {
        ...eventEnvelope(
          metadata,
          "mission.retry-authorized.v1",
          event.missionId,
        ),
        data: {
          missionId: event.missionId,
          missionRevision: event.missionRevision,
          nextAttemptNumber: event.nextAttemptNumber,
          attemptBudget: event.attemptBudget,
          reason: event.reason,
          ...(event.feedback ? { feedback: event.feedback } : {}),
        },
      };
    case "MISSION_CANCELLED":
      return {
        ...eventEnvelope(metadata, "mission.cancelled.v1", event.missionId),
        data: {
          missionId: event.missionId,
          missionRevision: event.missionRevision,
          cancelledBy: event.cancelledBy,
          reason: event.reason,
        },
      };
    case "MISSION_COMPLETED":
      return {
        ...eventEnvelope(metadata, "mission.completed.v1", event.missionId),
        data: {
          missionId: event.missionId,
          missionRevision: event.missionRevision,
          completionReviewId: event.binding.completionReviewId,
          recommendation: "APPROVE",
          verificationRunId: event.binding.verificationRunId,
          artifactDigest: event.binding.artifactDigest,
          gateSetDigest: event.binding.gateSetDigest,
          evidenceBundleDigest: event.binding.evidenceBundleDigest,
          approvedBy: event.approvedBy,
        },
      };
  }
}

function isEventMetadata(value: unknown): value is EventMetadata {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, [
      "eventId",
      "occurredAt",
      "correlationId",
      "causationId",
    ]) &&
    isMessageIdentifier(value["eventId"]) &&
    isRfc3339DateTime(value["occurredAt"]) &&
    isMessageIdentifier(value["correlationId"]) &&
    isMessageIdentifier(value["causationId"])
  );
}

function isPositiveIntegerValue(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function isCompletionBindingInput(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, [
      "missionRevision",
      "completionReviewId",
      "recommendation",
      "verificationRunId",
      "artifactDigest",
      "gateSetDigest",
      "evidenceBundleDigest",
    ]) &&
    isPositiveIntegerValue(value["missionRevision"]) &&
    isMessageIdentifier(value["completionReviewId"]) &&
    value["recommendation"] === "APPROVE" &&
    isMessageIdentifier(value["verificationRunId"]) &&
    isSha256Digest(value["artifactDigest"]) &&
    isSha256Digest(value["gateSetDigest"]) &&
    isSha256Digest(value["evidenceBundleDigest"])
  );
}

function isMissionDomainEventInput(
  value: unknown,
): value is MissionDomainEvent {
  if (!isPlainRecord(value) || !hasJsonContentTopology(value)) return false;
  switch (value["kind"]) {
    case "MISSION_OPENED":
      return (
        hasExactKeys(value, [
          "kind",
          "missionId",
          "missionRevision",
          "workContract",
          "attemptBudget",
        ]) &&
        isMessageIdentifier(value["missionId"]) &&
        isPositiveIntegerValue(value["missionRevision"]) &&
        isMissionWorkContract(value["workContract"]) &&
        isPositiveIntegerValue(value["attemptBudget"])
      );
    case "MISSION_RETRY_AUTHORIZED":
      return (
        hasExactKeys(
          value,
          [
            "kind",
            "missionId",
            "missionRevision",
            "nextAttemptNumber",
            "attemptBudget",
            "reason",
          ],
          ["feedback"],
        ) &&
        isMessageIdentifier(value["missionId"]) &&
        isPositiveIntegerValue(value["missionRevision"]) &&
        isPositiveIntegerValue(value["nextAttemptNumber"]) &&
        isPositiveIntegerValue(value["attemptBudget"]) &&
        MISSION_RETRY_REASONS.includes(
          value["reason"] as (typeof MISSION_RETRY_REASONS)[number],
        ) &&
        (value["feedback"] === undefined ||
          isBoundedText(value["feedback"], 2000))
      );
    case "MISSION_CANCELLED":
      return (
        hasExactKeys(value, [
          "kind",
          "missionId",
          "missionRevision",
          "cancelledBy",
          "reason",
        ]) &&
        isMessageIdentifier(value["missionId"]) &&
        isPositiveIntegerValue(value["missionRevision"]) &&
        isMessageIdentifier(value["cancelledBy"]) &&
        isBoundedText(value["reason"], 1000)
      );
    case "MISSION_COMPLETED":
      return (
        hasExactKeys(value, [
          "kind",
          "missionId",
          "missionRevision",
          "binding",
          "approvedBy",
        ]) &&
        isMessageIdentifier(value["missionId"]) &&
        isPositiveIntegerValue(value["missionRevision"]) &&
        isCompletionBindingInput(value["binding"]) &&
        isMessageIdentifier(value["approvedBy"])
      );
    default:
      return false;
  }
}

function isMissionFactContextInput(
  value: unknown,
): value is MissionFactContext {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, ["missionRevision", "currentAttemptNumber"]) &&
    hasJsonContentTopology(value) &&
    Number.isSafeInteger(value["missionRevision"]) &&
    Number(value["missionRevision"]) >= 1 &&
    Number.isSafeInteger(value["currentAttemptNumber"]) &&
    Number(value["currentAttemptNumber"]) >= 1
  );
}

export function translateMissionFact(
  event: MissionAggregateInboundEvent,
  context: MissionFactContext,
): MissionPrivateFact | undefined {
  if (!isMissionFactContextInput(context)) return undefined;
  const translated = translateMissionControlEvent(event);
  if (
    !translated.ok ||
    translated.value.eventType === "workshop.attempt-ready.v1"
  )
    return undefined;
  const normalized = translated.value;
  switch (normalized.eventType) {
    case "workshop.attempt-leased.v1":
      return {
        kind: "RECORD_ATTEMPT_LEASED",
        fact: {
          missionRevision: context["missionRevision"],
          attemptId: normalized.data.attemptId,
          attemptNumber: context["currentAttemptNumber"],
        },
      };
    case "workshop.attempt-ended.v1":
      return {
        kind: "RECORD_ATTEMPT_ENDED",
        fact: {
          missionRevision: normalized.data.missionRevision,
          attemptId: normalized.data.attemptId,
          outcome: normalized.data.outcome,
        },
      };
    case "workshop.artifact-submitted.v1":
      return {
        kind: "RECORD_ARTIFACT_SUBMITTED",
        fact: {
          missionRevision: normalized.data.missionRevision,
          attemptId: normalized.data.attemptId,
          startingRevision: normalized.data.startingRevision,
          artifactDigest: normalized.data.artifact.digest,
          gateSetDigest: normalized.data.gateSetDigest,
        },
      };
    case "verification.passed.v1":
    case "verification.failed.v1":
      return {
        kind: "RECORD_VERIFICATION_VERDICT",
        fact: {
          attemptId: normalized.data.attemptId,
          verificationRunId: normalized.data.verificationRunId,
          binding: normalized.data.binding,
          verdict: normalized.data.verdict,
          evidenceBundleDigest: normalized.data.evidenceBundleDigest,
        },
      };
    case "verification.aborted.v1":
      return {
        kind: "RECORD_VERIFICATION_ABORTED",
        fact: {
          attemptId: normalized.data.attemptId,
          verificationRunId: normalized.data.verificationRunId,
          binding: normalized.data.binding,
          reason: normalized.data.reason,
          retryable: normalized.data.retryable,
        },
      };
    case "review.recommendation-issued.v1":
      return {
        kind: "RECORD_REVIEW_RECOMMENDATION",
        fact: {
          completionReviewId: normalized.data.completionReviewId,
          verificationRunId: normalized.data.verificationRunId,
          binding: normalized.data.binding,
          verdict: normalized.data.verdict,
          evidenceBundleDigest: normalized.data.evidenceBundleDigest,
          recommendation: normalized.data.recommendation,
        },
      };
  }
}

function eventEnvelope<Type extends MissionPublicEvent["eventType"]>(
  metadata: EventMetadata,
  eventType: Type,
  subjectId: string,
): {
  readonly eventId: string;
  readonly eventType: Type;
  readonly schemaVersion: 1;
  readonly occurredAt: string;
  readonly producer: "mission-control";
  readonly subjectId: string;
  readonly correlationId: string;
  readonly causationId: string;
} {
  return {
    eventId: metadata.eventId,
    eventType,
    schemaVersion: 1,
    occurredAt: metadata.occurredAt,
    producer: "mission-control",
    subjectId,
    correlationId: metadata.correlationId,
    causationId: metadata.causationId,
  };
}

interface ParsedEnvelope {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly producer: string;
  readonly subjectId: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly data: Readonly<Record<string, unknown>>;
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const digestPattern = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return isPlainRecord(value);
}

function identifier(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && identifierPattern.test(candidate)
    ? candidate
    : undefined;
}

function text(
  value: Readonly<Record<string, unknown>>,
  key: string,
  maximum: number,
): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" &&
    candidate.length >= 1 &&
    candidate.length <= maximum
    ? candidate
    : undefined;
}

function positiveInteger(
  value: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const candidate = value[key];
  return typeof candidate === "number" &&
    Number.isSafeInteger(candidate) &&
    candidate >= 1
    ? candidate
    : undefined;
}

function constrainedStringList(
  value: unknown,
  predicate: (candidate: string) => boolean,
): readonly string[] | undefined {
  if (!isDenseJsonArray(value) || value.length === 0) return undefined;
  const result: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string" || !predicate(candidate))
      return undefined;
    result.push(candidate);
  }
  return new Set(result).size === result.length
    ? Object.freeze(result)
    : undefined;
}

function identifierList(value: unknown): readonly string[] | undefined {
  return constrainedStringList(value, (candidate) =>
    identifierPattern.test(candidate),
  );
}

function pathList(value: unknown): readonly string[] | undefined {
  return constrainedStringList(
    value,
    (candidate) => candidate.length >= 1 && candidate.length <= 512,
  );
}

function digest(value: unknown): Digest | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["algorithm", "value"]) ||
    value["algorithm"] !== "sha256" ||
    typeof value["value"] !== "string" ||
    !digestPattern.test(value["value"])
  )
    return undefined;
  return { algorithm: "sha256", value: value["value"] };
}

function binding(value: unknown): VerificationBinding | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "missionId",
      "missionRevision",
      "startingRevision",
      "artifactDigest",
      "gateSetDigest",
    ])
  )
    return undefined;
  const missionId = identifier(value, "missionId");
  const missionRevision = positiveInteger(value, "missionRevision");
  const startingRevision = text(value, "startingRevision", 256);
  const artifactDigest = digest(value["artifactDigest"]);
  const gateSetDigest = digest(value["gateSetDigest"]);
  return missionId &&
    missionRevision &&
    startingRevision &&
    artifactDigest &&
    gateSetDigest
    ? {
        missionId,
        missionRevision,
        startingRevision,
        artifactDigest,
        gateSetDigest,
      }
    : undefined;
}

function artifact(value: unknown): Artifact | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["reference", "digest", "changedPaths"])
  )
    return undefined;
  const reference = text(value, "reference", 2048);
  const artifactDigest = digest(value["digest"]);
  const changedPaths = pathList(value["changedPaths"]);
  if (!reference || !artifactDigest || !changedPaths) return undefined;
  try {
    new URL(reference);
  } catch {
    return undefined;
  }
  return { reference, digest: artifactDigest, changedPaths };
}

function parseEnvelope(value: unknown): ParsedEnvelope | undefined {
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
    value["schemaVersion"] !== 1 ||
    !isRecord(value["data"])
  )
    return undefined;
  const eventId = identifier(value, "eventId");
  const eventType = text(value, "eventType", 128);
  const occurredAt = text(value, "occurredAt", 64);
  const producer = text(value, "producer", 64);
  const subjectId = identifier(value, "subjectId");
  const correlationId = identifier(value, "correlationId");
  const causationId = identifier(value, "causationId");
  if (
    !eventId ||
    !eventType ||
    !occurredAt ||
    !producer ||
    !subjectId ||
    !correlationId ||
    !causationId ||
    !isRfc3339DateTime(occurredAt)
  )
    return undefined;
  return {
    eventId,
    eventType,
    occurredAt,
    producer,
    subjectId,
    correlationId,
    causationId,
    data: value["data"],
  };
}

function base(envelope: ParsedEnvelope): {
  readonly eventId: string;
  readonly schemaVersion: 1;
  readonly occurredAt: string;
  readonly subjectId: string;
  readonly correlationId: string;
  readonly causationId: string;
} {
  return {
    eventId: envelope.eventId,
    schemaVersion: 1,
    occurredAt: envelope.occurredAt,
    subjectId: envelope.subjectId,
    correlationId: envelope.correlationId,
    causationId: envelope.causationId,
  };
}

function invalid(message: string): TranslationResult<never> {
  return { ok: false, error: { code: "CONTRACT_INVALID", message } };
}

export function translateMissionControlEvent(
  value: unknown,
): TranslationResult<MissionControlInboundEvent> {
  if (!hasJsonContentTopology(value))
    return invalid("Event topology is not faithful JSON.");
  const envelope = parseEnvelope(value);
  if (!envelope) return invalid("Event envelope is invalid or open-ended.");
  const data = envelope.data;
  switch (envelope.eventType) {
    case "workshop.attempt-ready.v1": {
      if (
        envelope.producer !== "workshop" ||
        !hasExactKeys(data, [
          "attemptId",
          "missionId",
          "missionRevision",
          "startingRevision",
          "attemptNumber",
          "requestedCapabilities",
        ])
      )
        return invalid("Attempt-ready payload is invalid.");
      const attemptId = identifier(data, "attemptId");
      const missionId = identifier(data, "missionId");
      const missionRevision = positiveInteger(data, "missionRevision");
      const startingRevision = text(data, "startingRevision", 256);
      const attemptNumber = positiveInteger(data, "attemptNumber");
      const requestedCapabilities = identifierList(
        data["requestedCapabilities"],
      );
      if (
        !attemptId ||
        !missionId ||
        !missionRevision ||
        !startingRevision ||
        !attemptNumber ||
        !requestedCapabilities
      )
        return invalid("Attempt-ready fields are invalid.");
      return {
        ok: true,
        value: {
          ...base(envelope),
          eventType: "workshop.attempt-ready.v1",
          producer: "workshop",
          data: {
            attemptId,
            missionId,
            missionRevision,
            startingRevision,
            attemptNumber,
            requestedCapabilities,
          },
        },
      };
    }
    case "workshop.attempt-leased.v1": {
      if (
        envelope.producer !== "workshop" ||
        !hasExactKeys(data, [
          "attemptId",
          "runnerId",
          "leaseId",
          "runnerCapabilities",
          "expiresAt",
        ])
      )
        return invalid("Attempt-leased payload is invalid.");
      const attemptId = identifier(data, "attemptId");
      const runnerId = identifier(data, "runnerId");
      const leaseId = identifier(data, "leaseId");
      const runnerCapabilities = identifierList(data["runnerCapabilities"]);
      const expiresAt = text(data, "expiresAt", 64);
      if (
        !attemptId ||
        !runnerId ||
        !leaseId ||
        !runnerCapabilities ||
        !expiresAt ||
        !isRfc3339DateTime(expiresAt)
      )
        return invalid("Attempt-leased fields are invalid.");
      return {
        ok: true,
        value: {
          ...base(envelope),
          eventType: "workshop.attempt-leased.v1",
          producer: "workshop",
          data: { attemptId, runnerId, leaseId, runnerCapabilities, expiresAt },
        },
      };
    }
    case "workshop.artifact-submitted.v1": {
      if (
        envelope.producer !== "workshop" ||
        !hasExactKeys(data, [
          "attemptId",
          "missionId",
          "missionRevision",
          "startingRevision",
          "runnerId",
          "artifact",
          "gateSetDigest",
        ])
      )
        return invalid("Artifact-submitted payload is invalid.");
      const attemptId = identifier(data, "attemptId");
      const missionId = identifier(data, "missionId");
      const missionRevision = positiveInteger(data, "missionRevision");
      const startingRevision = text(data, "startingRevision", 256);
      const runnerId = identifier(data, "runnerId");
      const submittedArtifact = artifact(data["artifact"]);
      const gateSetDigest = digest(data["gateSetDigest"]);
      if (
        !attemptId ||
        !missionId ||
        !missionRevision ||
        !startingRevision ||
        !runnerId ||
        !submittedArtifact ||
        !gateSetDigest
      )
        return invalid("Artifact-submitted fields are invalid.");
      return {
        ok: true,
        value: {
          ...base(envelope),
          eventType: "workshop.artifact-submitted.v1",
          producer: "workshop",
          data: {
            attemptId,
            missionId,
            missionRevision,
            startingRevision,
            runnerId,
            artifact: submittedArtifact,
            gateSetDigest,
          },
        },
      };
    }
    case "workshop.attempt-ended.v1": {
      if (
        envelope.producer !== "workshop" ||
        !hasExactKeys(
          data,
          ["attemptId", "missionId", "missionRevision", "outcome"],
          ["reason"],
        )
      )
        return invalid("Attempt-ended payload is invalid.");
      const attemptId = identifier(data, "attemptId");
      const missionId = identifier(data, "missionId");
      const missionRevision = positiveInteger(data, "missionRevision");
      const outcome = data["outcome"];
      const reason = data["reason"];
      const outcomes = [
        "ARTIFACT_SUBMITTED",
        "ABANDONED",
        "FAILED",
        "LEASE_EXPIRED",
        "REVOKED",
      ];
      if (
        !attemptId ||
        !missionId ||
        !missionRevision ||
        typeof outcome !== "string" ||
        !outcomes.includes(outcome) ||
        (reason !== undefined &&
          (typeof reason !== "string" ||
            reason.length < 1 ||
            reason.length > 1000))
      )
        return invalid("Attempt-ended fields are invalid.");
      if (
        outcome !== "ARTIFACT_SUBMITTED" &&
        outcome !== "ABANDONED" &&
        outcome !== "FAILED" &&
        outcome !== "LEASE_EXPIRED" &&
        outcome !== "REVOKED"
      )
        return invalid("Attempt outcome is unsupported.");
      return {
        ok: true,
        value: {
          ...base(envelope),
          eventType: "workshop.attempt-ended.v1",
          producer: "workshop",
          data: {
            attemptId,
            missionId,
            missionRevision,
            outcome,
            ...(typeof reason === "string" ? { reason } : {}),
          },
        },
      };
    }
    case "verification.passed.v1":
    case "verification.failed.v1":
      return translateVerdict(envelope);
    case "verification.aborted.v1":
      return translateAbort(envelope);
    case "review.recommendation-issued.v1":
      return translateRecommendation(envelope);
    default:
      return {
        ok: false,
        error: {
          code: "UNSUPPORTED_MESSAGE",
          message: `Mission Control does not consume ${envelope.eventType}.`,
        },
      };
  }
}

function translateVerdict(
  envelope: ParsedEnvelope,
): TranslationResult<VerificationPassedV1 | VerificationFailedV1> {
  const data = envelope.data;
  const failed = envelope.eventType === "verification.failed.v1";
  const required = [
    "verificationRunId",
    "attemptId",
    "binding",
    "verifierId",
    "verdict",
    "checkCount",
    ...(failed ? ["failedGateIds"] : []),
    "evidenceBundleDigest",
  ];
  if (
    envelope.producer !== "verification-and-review" ||
    !hasExactKeys(data, required)
  )
    return invalid("Verification verdict payload is invalid.");
  const verificationRunId = identifier(data, "verificationRunId");
  const attemptId = identifier(data, "attemptId");
  const exactBinding = binding(data["binding"]);
  const verifierId = identifier(data, "verifierId");
  const checkCount = positiveInteger(data, "checkCount");
  const evidenceBundleDigest = digest(data["evidenceBundleDigest"]);
  if (
    !verificationRunId ||
    !attemptId ||
    !exactBinding ||
    !verifierId ||
    !checkCount ||
    !evidenceBundleDigest
  )
    return invalid("Verification verdict fields are invalid.");
  if (!failed && data["verdict"] === "PASSED") {
    return {
      ok: true,
      value: {
        ...base(envelope),
        eventType: "verification.passed.v1",
        producer: "verification-and-review",
        data: {
          verificationRunId,
          attemptId,
          binding: exactBinding,
          verifierId,
          verdict: "PASSED",
          checkCount,
          evidenceBundleDigest,
        },
      },
    };
  }
  const failedGateIds = identifierList(data["failedGateIds"]);
  if (!failed || data["verdict"] !== "FAILED" || !failedGateIds)
    return invalid("Failed verdict fields are invalid.");
  return {
    ok: true,
    value: {
      ...base(envelope),
      eventType: "verification.failed.v1",
      producer: "verification-and-review",
      data: {
        verificationRunId,
        attemptId,
        binding: exactBinding,
        verifierId,
        verdict: "FAILED",
        checkCount,
        failedGateIds,
        evidenceBundleDigest,
      },
    },
  };
}

function translateAbort(
  envelope: ParsedEnvelope,
): TranslationResult<VerificationAbortedV1> {
  const data = envelope.data;
  if (
    envelope.producer !== "verification-and-review" ||
    !hasExactKeys(
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
    )
  )
    return invalid("Verification-aborted payload is invalid.");
  const verificationRunId = identifier(data, "verificationRunId");
  const attemptId = identifier(data, "attemptId");
  const exactBinding = binding(data["binding"]);
  const verifierId = identifier(data, "verifierId");
  const reason = data["reason"];
  const retryable = data["retryable"];
  const reasons = [
    "VERIFIER_UNAVAILABLE",
    "WORKSPACE_UNAVAILABLE",
    "EXECUTION_INFRASTRUCTURE_FAILURE",
    "MISSION_CANCELLED",
  ];
  const evidenceBundleDigest =
    data["evidenceBundleDigest"] === undefined
      ? undefined
      : digest(data["evidenceBundleDigest"]);
  const detail = data["detail"];
  if (
    !verificationRunId ||
    !attemptId ||
    !exactBinding ||
    !verifierId ||
    data["outcome"] !== "ABORTED" ||
    typeof reason !== "string" ||
    !reasons.includes(reason) ||
    typeof retryable !== "boolean" ||
    (reason === "MISSION_CANCELLED" && retryable) ||
    (data["evidenceBundleDigest"] !== undefined && !evidenceBundleDigest) ||
    (detail !== undefined &&
      (typeof detail !== "string" || detail.length < 1 || detail.length > 2000))
  )
    return invalid("Verification-aborted fields are invalid.");
  if (
    reason !== "VERIFIER_UNAVAILABLE" &&
    reason !== "WORKSPACE_UNAVAILABLE" &&
    reason !== "EXECUTION_INFRASTRUCTURE_FAILURE" &&
    reason !== "MISSION_CANCELLED"
  )
    return invalid("Verification abort reason is unsupported.");
  return {
    ok: true,
    value: {
      ...base(envelope),
      eventType: "verification.aborted.v1",
      producer: "verification-and-review",
      data: {
        verificationRunId,
        attemptId,
        binding: exactBinding,
        verifierId,
        outcome: "ABORTED",
        reason,
        retryable,
        ...(evidenceBundleDigest ? { evidenceBundleDigest } : {}),
        ...(typeof detail === "string" ? { detail } : {}),
      },
    },
  };
}

function translateRecommendation(
  envelope: ParsedEnvelope,
): TranslationResult<ReviewRecommendationIssuedV1> {
  const data = envelope.data;
  if (
    envelope.producer !== "verification-and-review" ||
    !hasExactKeys(
      data,
      [
        "completionReviewId",
        "verificationRunId",
        "binding",
        "verdict",
        "evidenceBundleDigest",
        "recommendation",
      ],
      ["reason"],
    )
  )
    return invalid("Review-recommendation payload is invalid.");
  const completionReviewId = identifier(data, "completionReviewId");
  const verificationRunId = identifier(data, "verificationRunId");
  const exactBinding = binding(data["binding"]);
  const evidenceBundleDigest = digest(data["evidenceBundleDigest"]);
  const verdict = data["verdict"];
  const recommendation = data["recommendation"];
  const reason = data["reason"];
  if (
    !completionReviewId ||
    !verificationRunId ||
    !exactBinding ||
    !evidenceBundleDigest ||
    (verdict !== "PASSED" && verdict !== "FAILED") ||
    (recommendation !== "APPROVE" && recommendation !== "REQUEST_REVISION") ||
    (verdict === "PASSED" && recommendation !== "APPROVE") ||
    (verdict === "FAILED" && recommendation !== "REQUEST_REVISION") ||
    (reason !== undefined &&
      (typeof reason !== "string" || reason.length < 1 || reason.length > 2000))
  )
    return invalid("Review-recommendation fields are invalid.");
  return {
    ok: true,
    value: {
      ...base(envelope),
      eventType: "review.recommendation-issued.v1",
      producer: "verification-and-review",
      data: {
        completionReviewId,
        verificationRunId,
        binding: exactBinding,
        verdict,
        evidenceBundleDigest,
        recommendation,
        ...(typeof reason === "string" ? { reason } : {}),
      },
    },
  };
}
