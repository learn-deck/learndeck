import type {
  ReviewRecommendationIssuedV1,
  VerificationAbortedV1,
  VerificationFailedV1,
  VerificationPassedV1,
} from "@patchquest/contracts";
import type { ReviewRecommendationEvent } from "../domain/completion-review.js";
import type { VerificationDomainEvent } from "../domain/verification-run.js";
import {
  deepFreezeCopy,
  hasExactKeys,
  hasJsonTopology,
  isBoundedText,
  isDenseJsonArray,
  isIdentifier,
  isJsonObject,
  isPositiveInteger,
  isSha256Digest,
  isTimestamp,
} from "./message-validation.js";

export type VerificationPublicEvent =
  | VerificationPassedV1
  | VerificationFailedV1
  | VerificationAbortedV1
  | ReviewRecommendationIssuedV1;

export type OutgoingBuildResult =
  | Readonly<{ ok: true; value: VerificationPublicEvent }>
  | Readonly<{
      ok: false;
      error: Readonly<{ code: "OUTGOING_MESSAGE_INVALID"; message: string }>;
    }>;

function invalid(message: string): OutgoingBuildResult {
  return { ok: false, error: { code: "OUTGOING_MESSAGE_INVALID", message } };
}

export function createVerificationPublicEvent(
  event: VerificationDomainEvent | ReviewRecommendationEvent,
): OutgoingBuildResult {
  if (!validMetadata(event.metadata))
    return invalid("Verification event metadata is invalid.");
  const envelope = {
    eventId: event.metadata.eventId,
    schemaVersion: 1 as const,
    occurredAt: event.metadata.occurredAt,
    producer: "verification-and-review" as const,
    subjectId:
      event.kind === "REVIEW_RECOMMENDATION_ISSUED"
        ? event.completionReviewId
        : event.verificationRunId,
    correlationId: event.metadata.correlationId,
    causationId: event.metadata.causationId,
  };
  let candidate: VerificationPublicEvent;
  switch (event.kind) {
    case "VERIFICATION_PASSED":
      candidate = {
        ...envelope,
        eventType: "verification.passed.v1",
        data: {
          verificationRunId: event.verificationRunId,
          attemptId: event.attemptId,
          binding: event.binding,
          verifierId: event.verifierId,
          verdict: event.verdict,
          checkCount: event.checkCount,
          evidenceBundleDigest: event.evidenceBundleDigest,
        },
      };
      break;
    case "VERIFICATION_FAILED":
      candidate = {
        ...envelope,
        eventType: "verification.failed.v1",
        data: {
          verificationRunId: event.verificationRunId,
          attemptId: event.attemptId,
          binding: event.binding,
          verifierId: event.verifierId,
          verdict: event.verdict,
          checkCount: event.checkCount,
          failedGateIds: event.failedGateIds,
          evidenceBundleDigest: event.evidenceBundleDigest,
        },
      };
      break;
    case "VERIFICATION_ABORTED":
      candidate = {
        ...envelope,
        eventType: "verification.aborted.v1",
        data: {
          verificationRunId: event.verificationRunId,
          attemptId: event.attemptId,
          binding: event.binding,
          verifierId: event.verifierId,
          outcome: event.outcome,
          reason: event.reason,
          retryable: event.retryable,
          ...(event.evidenceBundleDigest
            ? { evidenceBundleDigest: event.evidenceBundleDigest }
            : {}),
          ...(event.detail ? { detail: event.detail } : {}),
        },
      };
      break;
    case "REVIEW_RECOMMENDATION_ISSUED":
      candidate = {
        ...envelope,
        eventType: "review.recommendation-issued.v1",
        data: {
          completionReviewId: event.completionReviewId,
          verificationRunId: event.verificationRunId,
          binding: event.binding,
          verdict: event.verdict,
          evidenceBundleDigest: event.evidenceBundleDigest,
          recommendation: event.recommendation,
          ...(event.reason ? { reason: event.reason } : {}),
        },
      };
      break;
  }
  return finalizeVerificationPublicEvent(candidate);
}

export function finalizeVerificationPublicEvent(
  value: unknown,
): OutgoingBuildResult {
  if (
    !isJsonObject(value) ||
    !hasJsonTopology(value) ||
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
    !validMetadata({
      eventId: value["eventId"],
      occurredAt: value["occurredAt"],
      correlationId: value["correlationId"],
      causationId: value["causationId"],
    }) ||
    value["schemaVersion"] !== 1 ||
    value["producer"] !== "verification-and-review" ||
    !isIdentifier(value["subjectId"]) ||
    !isJsonObject(value["data"])
  )
    return invalid("Verification event envelope is invalid.");
  const data = value["data"];
  switch (value["eventType"]) {
    case "verification.passed.v1":
      if (
        value["subjectId"] !== data["verificationRunId"] ||
        !validVerdictData(data, "PASSED") ||
        !hasExactKeys(data, [
          "verificationRunId",
          "attemptId",
          "binding",
          "verifierId",
          "verdict",
          "checkCount",
          "evidenceBundleDigest",
        ])
      )
        return invalid("Verification-passed event data is invalid.");
      break;
    case "verification.failed.v1":
      if (
        value["subjectId"] !== data["verificationRunId"] ||
        !validVerdictData(data, "FAILED") ||
        !hasExactKeys(data, [
          "verificationRunId",
          "attemptId",
          "binding",
          "verifierId",
          "verdict",
          "checkCount",
          "failedGateIds",
          "evidenceBundleDigest",
        ]) ||
        !isDenseJsonArray(data["failedGateIds"]) ||
        data["failedGateIds"].length < 1 ||
        !data["failedGateIds"].every(isIdentifier) ||
        new Set(data["failedGateIds"]).size !== data["failedGateIds"].length
      )
        return invalid("Verification-failed event data is invalid.");
      break;
    case "verification.aborted.v1":
      if (
        value["subjectId"] !== data["verificationRunId"] ||
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
        ) ||
        !isIdentifier(data["verificationRunId"]) ||
        !isIdentifier(data["attemptId"]) ||
        !validBinding(data["binding"]) ||
        !isIdentifier(data["verifierId"]) ||
        data["outcome"] !== "ABORTED" ||
        ![
          "VERIFIER_UNAVAILABLE",
          "WORKSPACE_UNAVAILABLE",
          "EXECUTION_INFRASTRUCTURE_FAILURE",
          "MISSION_CANCELLED",
        ].includes(String(data["reason"])) ||
        typeof data["retryable"] !== "boolean" ||
        (data["reason"] === "MISSION_CANCELLED" &&
          data["retryable"] !== false) ||
        (data["evidenceBundleDigest"] !== undefined &&
          !isSha256Digest(data["evidenceBundleDigest"])) ||
        (data["detail"] !== undefined && !isBoundedText(data["detail"], 2000))
      )
        return invalid("Verification-aborted event data is invalid.");
      break;
    case "review.recommendation-issued.v1":
      if (
        value["subjectId"] !== data["completionReviewId"] ||
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
        ) ||
        !isIdentifier(data["completionReviewId"]) ||
        !isIdentifier(data["verificationRunId"]) ||
        !validBinding(data["binding"]) ||
        !isSha256Digest(data["evidenceBundleDigest"]) ||
        !(
          (data["verdict"] === "PASSED" &&
            data["recommendation"] === "APPROVE") ||
          (data["verdict"] === "FAILED" &&
            data["recommendation"] === "REQUEST_REVISION")
        ) ||
        (data["reason"] !== undefined && !isBoundedText(data["reason"], 2000))
      )
        return invalid("Recommendation event data is invalid.");
      break;
    default:
      return invalid("Verification event type is unsupported.");
  }
  return {
    ok: true,
    value: deepFreezeCopy(value) as unknown as VerificationPublicEvent,
  };
}

function validMetadata(value: unknown): boolean {
  return (
    isJsonObject(value) &&
    hasExactKeys(value, [
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

function validBinding(value: unknown): boolean {
  return (
    isJsonObject(value) &&
    hasExactKeys(value, [
      "missionId",
      "missionRevision",
      "startingRevision",
      "artifactDigest",
      "gateSetDigest",
    ]) &&
    isIdentifier(value["missionId"]) &&
    isPositiveInteger(value["missionRevision"]) &&
    isBoundedText(value["startingRevision"], 256) &&
    isSha256Digest(value["artifactDigest"]) &&
    isSha256Digest(value["gateSetDigest"])
  );
}

function validVerdictData(
  value: Readonly<Record<string, unknown>>,
  verdict: "PASSED" | "FAILED",
): boolean {
  return (
    isIdentifier(value["verificationRunId"]) &&
    isIdentifier(value["attemptId"]) &&
    validBinding(value["binding"]) &&
    isIdentifier(value["verifierId"]) &&
    value["verdict"] === verdict &&
    isPositiveInteger(value["checkCount"]) &&
    isSha256Digest(value["evidenceBundleDigest"])
  );
}
