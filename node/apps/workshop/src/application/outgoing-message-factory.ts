import type {
  WorkshopArtifactSubmittedV1,
  WorkshopAttemptEndedV1,
  WorkshopAttemptLeasedV1,
  WorkshopAttemptReadyV1,
} from "@patchquest/contracts";
import {
  isArtifact,
  type AttemptDomainEvent,
  type AttemptSnapshot,
} from "../domain/attempt.js";
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

export type WorkshopPublicEvent =
  | WorkshopAttemptReadyV1
  | WorkshopAttemptLeasedV1
  | WorkshopArtifactSubmittedV1
  | WorkshopAttemptEndedV1;

export type OutgoingBuildResult =
  | Readonly<{ ok: true; value: WorkshopPublicEvent }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: "OUTGOING_MESSAGE_INVALID";
        message: string;
      }>;
    }>;

function invalid(message: string): OutgoingBuildResult {
  return { ok: false, error: { code: "OUTGOING_MESSAGE_INVALID", message } };
}

export function createWorkshopPublicEvent(
  event: AttemptDomainEvent,
  snapshot: AttemptSnapshot,
): OutgoingBuildResult {
  if (!validMetadata(event.metadata))
    return invalid("Workshop event metadata is invalid.");
  const envelope = {
    eventId: event.metadata.eventId,
    schemaVersion: 1 as const,
    occurredAt: event.metadata.occurredAt,
    producer: "workshop" as const,
    subjectId: snapshot.attemptId,
    correlationId: event.metadata.correlationId,
    causationId: event.metadata.causationId,
  };
  let candidate: WorkshopPublicEvent;
  switch (event.kind) {
    case "ATTEMPT_READY":
      candidate = {
        ...envelope,
        eventType: "workshop.attempt-ready.v1",
        data: {
          attemptId: snapshot.attemptId,
          missionId: snapshot.missionId,
          missionRevision: snapshot.missionRevision,
          startingRevision: snapshot.workContract.startingRevision,
          attemptNumber: snapshot.attemptNumber,
          requestedCapabilities: snapshot.workContract.requestedCapabilities,
        },
      };
      break;
    case "ATTEMPT_LEASED":
      candidate = {
        ...envelope,
        eventType: "workshop.attempt-leased.v1",
        data: {
          attemptId: snapshot.attemptId,
          runnerId: event.runnerId,
          leaseId: event.leaseId,
          runnerCapabilities: event.runnerCapabilities,
          expiresAt: event.expiresAt,
        },
      };
      break;
    case "ARTIFACT_SUBMITTED":
      candidate = {
        ...envelope,
        eventType: "workshop.artifact-submitted.v1",
        data: {
          attemptId: snapshot.attemptId,
          missionId: snapshot.missionId,
          missionRevision: snapshot.missionRevision,
          startingRevision: snapshot.workContract.startingRevision,
          runnerId: event.runnerId,
          artifact: event.artifact,
          gateSetDigest: snapshot.workContract.gateSetDigest,
        },
      };
      break;
    case "ATTEMPT_ENDED":
      candidate = {
        ...envelope,
        eventType: "workshop.attempt-ended.v1",
        data: {
          attemptId: snapshot.attemptId,
          missionId: snapshot.missionId,
          missionRevision: snapshot.missionRevision,
          outcome: event.outcome,
          ...(event.reason ? { reason: event.reason } : {}),
        },
      };
      break;
  }
  return finalizeWorkshopPublicEvent(candidate);
}

export function finalizeWorkshopPublicEvent(
  value: WorkshopPublicEvent,
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
    value["producer"] !== "workshop" ||
    !isIdentifier(value["subjectId"]) ||
    !isJsonObject(value["data"]) ||
    value["subjectId"] !== value["data"]["attemptId"]
  )
    return invalid("Workshop event envelope is invalid.");
  const data: Readonly<Record<string, unknown>> = value["data"];
  switch (value["eventType"]) {
    case "workshop.attempt-ready.v1":
      if (
        !hasExactKeys(data, [
          "attemptId",
          "missionId",
          "missionRevision",
          "startingRevision",
          "attemptNumber",
          "requestedCapabilities",
        ]) ||
        !isIdentifier(data["attemptId"]) ||
        !isIdentifier(data["missionId"]) ||
        !isPositiveInteger(data["missionRevision"]) ||
        !isBoundedText(data["startingRevision"], 256) ||
        !isPositiveInteger(data["attemptNumber"]) ||
        !validCapabilities(data["requestedCapabilities"])
      )
        return invalid("Attempt-ready event data is invalid.");
      break;
    case "workshop.attempt-leased.v1":
      if (
        !hasExactKeys(data, [
          "attemptId",
          "runnerId",
          "leaseId",
          "runnerCapabilities",
          "expiresAt",
        ]) ||
        !isIdentifier(data["attemptId"]) ||
        !isIdentifier(data["runnerId"]) ||
        !isIdentifier(data["leaseId"]) ||
        !validCapabilities(data["runnerCapabilities"]) ||
        !isTimestamp(data["expiresAt"])
      )
        return invalid("Attempt-leased event data is invalid.");
      break;
    case "workshop.artifact-submitted.v1":
      if (
        !hasExactKeys(data, [
          "attemptId",
          "missionId",
          "missionRevision",
          "startingRevision",
          "runnerId",
          "artifact",
          "gateSetDigest",
        ]) ||
        !isIdentifier(data["attemptId"]) ||
        !isIdentifier(data["missionId"]) ||
        !isPositiveInteger(data["missionRevision"]) ||
        !isBoundedText(data["startingRevision"], 256) ||
        !isIdentifier(data["runnerId"]) ||
        !validArtifact(data["artifact"]) ||
        !isSha256Digest(data["gateSetDigest"])
      )
        return invalid("Artifact-submitted event data is invalid.");
      break;
    case "workshop.attempt-ended.v1":
      if (
        !hasExactKeys(
          data,
          ["attemptId", "missionId", "missionRevision", "outcome"],
          ["reason"],
        ) ||
        !isIdentifier(data["attemptId"]) ||
        !isIdentifier(data["missionId"]) ||
        !isPositiveInteger(data["missionRevision"]) ||
        ![
          "ARTIFACT_SUBMITTED",
          "ABANDONED",
          "FAILED",
          "LEASE_EXPIRED",
          "REVOKED",
        ].includes(String(data["outcome"])) ||
        (data["reason"] !== undefined && !isBoundedText(data["reason"], 1000))
      )
        return invalid("Attempt-ended event data is invalid.");
      break;
    default:
      return invalid("Workshop event type is unsupported.");
  }
  return { ok: true, value: deepFreezeCopy(value) };
}

function validMetadata(
  value: Readonly<{
    eventId: string;
    occurredAt: string;
    correlationId: string;
    causationId: string;
  }>,
): boolean {
  return (
    isIdentifier(value.eventId) &&
    isTimestamp(value.occurredAt) &&
    isIdentifier(value.correlationId) &&
    isIdentifier(value.causationId)
  );
}

function validCapabilities(value: unknown): value is readonly string[] {
  return (
    isDenseJsonArray(value) &&
    value.length >= 1 &&
    value.every(isIdentifier) &&
    new Set(value).size === value.length
  );
}

function validArtifact(value: unknown): boolean {
  return isArtifact(value);
}
