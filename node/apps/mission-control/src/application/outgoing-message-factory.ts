import type {
  MissionCancelledV1,
  MissionCompletedV1,
  MissionOpenedV1,
  MissionRetryAuthorizedV1,
  PublicCommandV1,
} from "@patchquest/contracts";
import {
  calculateGateSetDigest,
  isMissionAcceptanceGate,
  isMissionWorkContract,
  type MissionDigest,
} from "../domain/mission.js";
import {
  deepFreezeCopy,
  hasExactKeys,
  hasJsonContentTopology,
  isBoundedText,
  isDenseJsonArray,
  isMessageIdentifier,
  isPlainRecord,
  isRfc3339DateTime,
  isSha256Digest,
} from "./message-validation.js";

export type MissionOwnedPublicEvent =
  | MissionOpenedV1
  | MissionRetryAuthorizedV1
  | MissionCancelledV1
  | MissionCompletedV1;

export type OutgoingBuildResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | {
      readonly ok: false;
      readonly error: Readonly<{
        code: "OUTGOING_MESSAGE_INVALID";
        message: string;
      }>;
    };

function invalid<Value>(message: string): OutgoingBuildResult<Value> {
  return { ok: false, error: { code: "OUTGOING_MESSAGE_INVALID", message } };
}

function sameDigest(left: MissionDigest, right: MissionDigest): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

function validEnvelope(
  value: Readonly<{
    messageId: unknown;
    timestamp: unknown;
    subjectId: unknown;
    correlationId: unknown;
    causationId: unknown;
  }>,
): boolean {
  return (
    isMessageIdentifier(value.messageId) &&
    isRfc3339DateTime(value.timestamp) &&
    isMessageIdentifier(value.subjectId) &&
    isMessageIdentifier(value.correlationId) &&
    isMessageIdentifier(value.causationId)
  );
}

function validArtifact(value: unknown): boolean {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ["reference", "digest", "changedPaths"]) ||
    !isBoundedText(value["reference"], 2048) ||
    !isSha256Digest(value["digest"]) ||
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

function validBinding(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, [
      "missionId",
      "missionRevision",
      "startingRevision",
      "artifactDigest",
      "gateSetDigest",
    ]) &&
    isMessageIdentifier(value["missionId"]) &&
    typeof value["missionRevision"] === "number" &&
    Number.isSafeInteger(value["missionRevision"]) &&
    value["missionRevision"] >= 1 &&
    isBoundedText(value["startingRevision"], 256) &&
    isSha256Digest(value["artifactDigest"]) &&
    isSha256Digest(value["gateSetDigest"])
  );
}

function validGateList(value: unknown, digest: MissionDigest): boolean {
  return (
    isDenseJsonArray(value) &&
    value.length >= 1 &&
    value.every(isMissionAcceptanceGate) &&
    new Set(value.map((gate) => gate.gateId)).size === value.length &&
    sameDigest(calculateGateSetDigest(value), digest)
  );
}

export function finalizeMissionControlCommand(
  value: PublicCommandV1,
): OutgoingBuildResult<PublicCommandV1> {
  if (
    !hasJsonContentTopology(value) ||
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
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
    !validEnvelope({
      messageId: value.commandId,
      timestamp: value.issuedAt,
      subjectId: value.subjectId,
      correlationId: value.correlationId,
      causationId: value.causationId,
    }) ||
    value.schemaVersion !== 1 ||
    value.issuer !== "mission-control" ||
    !isPlainRecord(value.data)
  )
    return invalid("Outgoing command envelope is invalid.");
  switch (value.commandType) {
    case "workshop.create-attempt.v1": {
      const data = value.data;
      const contract = {
        objective: data.objective,
        startingRevision: data.startingRevision,
        workspaceReference: data.workspaceReference,
        allowedScope: data.allowedScope,
        requestedCapabilities: data.requestedCapabilities,
        acceptanceGates: data.acceptanceGates,
        gateSetDigest: data.gateSetDigest,
      };
      if (
        value.recipient !== "workshop" ||
        !isPlainRecord(data) ||
        !hasExactKeys(data, [
          "missionId",
          "missionRevision",
          "objective",
          "startingRevision",
          "workspaceReference",
          "allowedScope",
          "requestedCapabilities",
          "acceptanceGates",
          "gateSetDigest",
          "attemptId",
          "attemptNumber",
          "attemptBudget",
        ]) ||
        !isMissionWorkContract(contract) ||
        !isMessageIdentifier(data.missionId) ||
        !isMessageIdentifier(data.attemptId) ||
        value.subjectId !== data.attemptId ||
        !Number.isSafeInteger(data.missionRevision) ||
        data.missionRevision < 1 ||
        !Number.isSafeInteger(data.attemptNumber) ||
        data.attemptNumber < 1 ||
        !Number.isSafeInteger(data.attemptBudget) ||
        data.attemptBudget < data.attemptNumber
      )
        return invalid("Create-attempt command data is invalid.");
      break;
    }
    case "verification.start-verification.v1": {
      const data = value.data;
      if (
        value.recipient !== "verification-and-review" ||
        !isPlainRecord(data) ||
        !hasExactKeys(data, [
          "verificationRunId",
          "attemptId",
          "producingRunnerId",
          "binding",
          "artifact",
          "acceptanceGates",
        ]) ||
        !isMessageIdentifier(data.verificationRunId) ||
        !isMessageIdentifier(data.attemptId) ||
        !isMessageIdentifier(data.producingRunnerId) ||
        value.subjectId !== data.verificationRunId ||
        !validBinding(data.binding) ||
        !validArtifact(data.artifact) ||
        !sameDigest(data.binding.artifactDigest, data.artifact.digest) ||
        !validGateList(data.acceptanceGates, data.binding.gateSetDigest)
      )
        return invalid("Start-verification command data is invalid.");
      break;
    }
    case "workshop.revoke-attempt.v1": {
      const data = value.data;
      if (
        value.recipient !== "workshop" ||
        !isPlainRecord(data) ||
        !hasExactKeys(data, [
          "missionId",
          "missionRevision",
          "attemptId",
          "reason",
        ]) ||
        !isMessageIdentifier(data.missionId) ||
        !Number.isSafeInteger(data.missionRevision) ||
        data.missionRevision < 1 ||
        !isMessageIdentifier(data.attemptId) ||
        value.subjectId !== data.attemptId ||
        data.reason !== "MISSION_CANCELLED"
      )
        return invalid("Revoke-attempt command data is invalid.");
      break;
    }
    default:
      return invalid("Outgoing command type is unsupported.");
  }
  return { ok: true, value: deepFreezeCopy(value) };
}

export function finalizeMissionPublicEvent(
  value: MissionOwnedPublicEvent,
): OutgoingBuildResult<MissionOwnedPublicEvent> {
  if (
    !hasJsonContentTopology(value) ||
    !isPlainRecord(value) ||
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
    !validEnvelope({
      messageId: value.eventId,
      timestamp: value.occurredAt,
      subjectId: value.subjectId,
      correlationId: value.correlationId,
      causationId: value.causationId,
    }) ||
    value.schemaVersion !== 1 ||
    value.producer !== "mission-control" ||
    !isPlainRecord(value.data)
  )
    return invalid("Outgoing event envelope is invalid.");
  if (
    !isMessageIdentifier(value.data.missionId) ||
    value.subjectId !== value.data.missionId
  )
    return invalid("Outgoing event mission identity is invalid.");
  switch (value.eventType) {
    case "mission.opened.v1": {
      const data = value.data;
      const contract = {
        objective: data.objective,
        startingRevision: data.startingRevision,
        workspaceReference: "urn:patchquest:public-event",
        allowedScope: data.allowedScope,
        requestedCapabilities: data.requestedCapabilities,
        acceptanceGates: data.acceptanceGates,
        gateSetDigest: data.gateSetDigest,
      };
      if (
        !isPlainRecord(data) ||
        !hasExactKeys(data, [
          "missionId",
          "missionRevision",
          "objective",
          "startingRevision",
          "allowedScope",
          "requestedCapabilities",
          "acceptanceGates",
          "gateSetDigest",
          "attemptBudget",
        ]) ||
        !isMissionWorkContract(contract) ||
        !Number.isSafeInteger(data.missionRevision) ||
        data.missionRevision < 1 ||
        !Number.isSafeInteger(data.attemptBudget) ||
        data.attemptBudget < 1
      )
        return invalid("Mission-opened event data is invalid.");
      break;
    }
    case "mission.retry-authorized.v1": {
      const data = value.data;
      if (
        !isPlainRecord(data) ||
        !hasExactKeys(
          data,
          [
            "missionId",
            "missionRevision",
            "nextAttemptNumber",
            "attemptBudget",
            "reason",
          ],
          ["feedback"],
        ) ||
        !Number.isSafeInteger(data.missionRevision) ||
        data.missionRevision < 1 ||
        !Number.isSafeInteger(data.nextAttemptNumber) ||
        data.nextAttemptNumber < 2 ||
        !Number.isSafeInteger(data.attemptBudget) ||
        data.attemptBudget < data.nextAttemptNumber ||
        ![
          "ATTEMPT_EXPIRED",
          "ATTEMPT_FAILED",
          "REVISION_REQUESTED",
          "HUMAN_AUTHORIZED",
          "VERIFICATION_ABORTED",
        ].includes(data.reason) ||
        (data.feedback !== undefined && !isBoundedText(data.feedback, 2000))
      )
        return invalid("Mission-retry event data is invalid.");
      break;
    }
    case "mission.cancelled.v1": {
      const data = value.data;
      if (
        !isPlainRecord(data) ||
        !hasExactKeys(data, [
          "missionId",
          "missionRevision",
          "cancelledBy",
          "reason",
        ]) ||
        !Number.isSafeInteger(data.missionRevision) ||
        data.missionRevision < 1 ||
        !isMessageIdentifier(data.cancelledBy) ||
        !isBoundedText(data.reason, 1000)
      )
        return invalid("Mission-cancelled event data is invalid.");
      break;
    }
    case "mission.completed.v1": {
      const data = value.data;
      if (
        !isPlainRecord(data) ||
        !hasExactKeys(data, [
          "missionId",
          "missionRevision",
          "completionReviewId",
          "recommendation",
          "verificationRunId",
          "artifactDigest",
          "gateSetDigest",
          "evidenceBundleDigest",
          "approvedBy",
        ]) ||
        !Number.isSafeInteger(data.missionRevision) ||
        data.missionRevision < 1 ||
        !isMessageIdentifier(data.completionReviewId) ||
        data.recommendation !== "APPROVE" ||
        !isMessageIdentifier(data.verificationRunId) ||
        !isSha256Digest(data.artifactDigest) ||
        !isSha256Digest(data.gateSetDigest) ||
        !isSha256Digest(data.evidenceBundleDigest) ||
        !isMessageIdentifier(data.approvedBy)
      )
        return invalid("Mission-completed event data is invalid.");
      break;
    }
    default:
      return invalid("Outgoing event type is unsupported.");
  }
  return { ok: true, value: deepFreezeCopy(value) };
}
