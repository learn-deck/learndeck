import {
  isArtifact,
  isAttemptWorkContract,
  type Artifact,
  type AttemptWorkContract,
  type Digest,
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

export type TranslationResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code:
          "CONTRACT_INVALID" | "PRIVATE_INPUT_INVALID" | "UNSUPPORTED_MESSAGE";
        message: string;
      }>;
    }>;

export interface CreateAttemptInput {
  readonly messageId: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly issuedAt: string;
  readonly missionId: string;
  readonly missionRevision: number;
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly attemptBudget: number;
  readonly workContract: AttemptWorkContract;
}

export interface RevokeAttemptInput {
  readonly messageId: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly issuedAt: string;
  readonly missionId: string;
  readonly missionRevision: number;
  readonly attemptId: string;
  readonly reason: "MISSION_CANCELLED";
}

export interface PrivateRequestIdentity {
  readonly requestId: string;
  readonly correlationId: string;
}

export interface LeaseAttemptInput extends PrivateRequestIdentity {
  readonly attemptId: string;
  readonly runnerId: string;
  readonly runnerCapabilities: readonly string[];
  readonly requestedLeaseSeconds: number;
}

export interface LeaseOwnerInput extends PrivateRequestIdentity {
  readonly attemptId: string;
  readonly runnerId: string;
  readonly leaseToken: string;
}

export interface SubmitArtifactInput extends LeaseOwnerInput {
  readonly missionId: string;
  readonly missionRevision: number;
  readonly startingRevision: string;
  readonly artifact: Artifact;
  readonly gateSetDigest: Digest;
}

export interface EndAttemptInput extends LeaseOwnerInput {
  readonly reason: string;
}

export interface ExpireLeaseInput extends PrivateRequestIdentity {
  readonly attemptId: string;
}

function invalid<Value>(
  code: "CONTRACT_INVALID" | "PRIVATE_INPUT_INVALID" | "UNSUPPORTED_MESSAGE",
  message: string,
): TranslationResult<Value> {
  return { ok: false, error: { code, message } };
}

function validPublicEnvelope(
  value: Readonly<Record<string, unknown>>,
  commandType: string,
): boolean {
  return (
    hasExactKeys(value, [
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
    ]) &&
    value["commandType"] === commandType &&
    value["schemaVersion"] === 1 &&
    value["issuer"] === "mission-control" &&
    value["recipient"] === "workshop" &&
    isIdentifier(value["commandId"]) &&
    isTimestamp(value["issuedAt"]) &&
    isIdentifier(value["subjectId"]) &&
    isIdentifier(value["correlationId"]) &&
    isIdentifier(value["causationId"])
  );
}

export function translateCreateAttempt(
  value: unknown,
): TranslationResult<CreateAttemptInput> {
  if (
    !isJsonObject(value) ||
    !hasJsonTopology(value) ||
    !validPublicEnvelope(value, "workshop.create-attempt.v1") ||
    !isJsonObject(value["data"])
  )
    return invalid(
      "CONTRACT_INVALID",
      "Create-attempt command envelope is invalid.",
    );
  const data = value["data"];
  if (
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
    !isIdentifier(data["missionId"]) ||
    !isPositiveInteger(data["missionRevision"]) ||
    !isIdentifier(data["attemptId"]) ||
    value["subjectId"] !== data["attemptId"] ||
    !isPositiveInteger(data["attemptNumber"]) ||
    !isPositiveInteger(data["attemptBudget"]) ||
    Number(data["attemptNumber"]) > Number(data["attemptBudget"])
  )
    return invalid(
      "CONTRACT_INVALID",
      "Create-attempt command data is invalid.",
    );
  const workContract = {
    objective: data["objective"],
    startingRevision: data["startingRevision"],
    workspaceReference: data["workspaceReference"],
    allowedScope: data["allowedScope"],
    requestedCapabilities: data["requestedCapabilities"],
    acceptanceGates: data["acceptanceGates"],
    gateSetDigest: data["gateSetDigest"],
  };
  if (!isAttemptWorkContract(workContract))
    return invalid(
      "CONTRACT_INVALID",
      "Create-attempt work contract is invalid.",
    );
  return {
    ok: true,
    value: deepFreezeCopy({
      messageId: value["commandId"] as string,
      correlationId: value["correlationId"] as string,
      causationId: value["causationId"] as string,
      issuedAt: value["issuedAt"] as string,
      missionId: data["missionId"],
      missionRevision: data["missionRevision"],
      attemptId: data["attemptId"],
      attemptNumber: data["attemptNumber"],
      attemptBudget: data["attemptBudget"],
      workContract,
    }),
  };
}

export function translateRevokeAttempt(
  value: unknown,
): TranslationResult<RevokeAttemptInput> {
  if (
    !isJsonObject(value) ||
    !hasJsonTopology(value) ||
    !validPublicEnvelope(value, "workshop.revoke-attempt.v1") ||
    !isJsonObject(value["data"])
  )
    return invalid(
      "CONTRACT_INVALID",
      "Revoke-attempt command envelope is invalid.",
    );
  const data = value["data"];
  if (
    !hasExactKeys(data, [
      "missionId",
      "missionRevision",
      "attemptId",
      "reason",
    ]) ||
    !isIdentifier(data["missionId"]) ||
    !isPositiveInteger(data["missionRevision"]) ||
    !isIdentifier(data["attemptId"]) ||
    data["reason"] !== "MISSION_CANCELLED" ||
    value["subjectId"] !== data["attemptId"]
  )
    return invalid(
      "CONTRACT_INVALID",
      "Revoke-attempt command data is invalid.",
    );
  return {
    ok: true,
    value: deepFreezeCopy({
      messageId: value["commandId"] as string,
      correlationId: value["correlationId"] as string,
      causationId: value["causationId"] as string,
      issuedAt: value["issuedAt"] as string,
      missionId: data["missionId"],
      missionRevision: data["missionRevision"],
      attemptId: data["attemptId"],
      reason: "MISSION_CANCELLED",
    }),
  };
}

export function translateWorkshopCommand(
  value: unknown,
): TranslationResult<CreateAttemptInput | RevokeAttemptInput> {
  if (!isJsonObject(value))
    return invalid(
      "CONTRACT_INVALID",
      "Workshop command must be a strict record.",
    );
  if (value["commandType"] === "workshop.create-attempt.v1")
    return translateCreateAttempt(value);
  if (value["commandType"] === "workshop.revoke-attempt.v1")
    return translateRevokeAttempt(value);
  return invalid(
    "UNSUPPORTED_MESSAGE",
    "Workshop command type is unsupported.",
  );
}

function isPrivateIdentity(value: Readonly<Record<string, unknown>>): boolean {
  return (
    isIdentifier(value["requestId"]) && isIdentifier(value["correlationId"])
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

function validLeaseToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 32 && value.length <= 512;
}

export function translateLeaseAttempt(
  value: unknown,
): TranslationResult<LeaseAttemptInput> {
  if (
    !isJsonObject(value) ||
    !hasJsonTopology(value) ||
    !hasExactKeys(value, [
      "requestId",
      "correlationId",
      "attemptId",
      "runnerId",
      "runnerCapabilities",
      "requestedLeaseSeconds",
    ]) ||
    !isPrivateIdentity(value) ||
    !isIdentifier(value["attemptId"]) ||
    !isIdentifier(value["runnerId"]) ||
    !validCapabilities(value["runnerCapabilities"]) ||
    !isPositiveInteger(value["requestedLeaseSeconds"]) ||
    Number(value["requestedLeaseSeconds"]) > 3600
  )
    return invalid("PRIVATE_INPUT_INVALID", "Lease-attempt input is invalid.");
  return {
    ok: true,
    value: deepFreezeCopy(value) as unknown as LeaseAttemptInput,
  };
}

export function translateHeartbeat(
  value: unknown,
): TranslationResult<LeaseOwnerInput> {
  return translateLeaseOwner(value, "Heartbeat");
}

function translateLeaseOwner(
  value: unknown,
  label: string,
): TranslationResult<LeaseOwnerInput> {
  if (
    !isJsonObject(value) ||
    !hasJsonTopology(value) ||
    !hasExactKeys(value, [
      "requestId",
      "correlationId",
      "attemptId",
      "runnerId",
      "leaseToken",
    ]) ||
    !isPrivateIdentity(value) ||
    !isIdentifier(value["attemptId"]) ||
    !isIdentifier(value["runnerId"]) ||
    !validLeaseToken(value["leaseToken"])
  )
    return invalid("PRIVATE_INPUT_INVALID", `${label} input is invalid.`);
  return {
    ok: true,
    value: deepFreezeCopy(value) as unknown as LeaseOwnerInput,
  };
}

export function translateSubmitArtifact(
  value: unknown,
): TranslationResult<SubmitArtifactInput> {
  if (
    !isJsonObject(value) ||
    !hasJsonTopology(value) ||
    !hasExactKeys(value, [
      "requestId",
      "correlationId",
      "attemptId",
      "runnerId",
      "leaseToken",
      "missionId",
      "missionRevision",
      "startingRevision",
      "artifact",
      "gateSetDigest",
    ]) ||
    !isPrivateIdentity(value) ||
    !isIdentifier(value["attemptId"]) ||
    !isIdentifier(value["runnerId"]) ||
    !validLeaseToken(value["leaseToken"]) ||
    !isIdentifier(value["missionId"]) ||
    !isPositiveInteger(value["missionRevision"]) ||
    !isBoundedText(value["startingRevision"], 256) ||
    !isArtifact(value["artifact"]) ||
    !isSha256Digest(value["gateSetDigest"])
  )
    return invalid(
      "PRIVATE_INPUT_INVALID",
      "Artifact submission input is invalid.",
    );
  return {
    ok: true,
    value: deepFreezeCopy(value) as unknown as SubmitArtifactInput,
  };
}

export function translateAbandonAttempt(
  value: unknown,
): TranslationResult<EndAttemptInput> {
  return translateEndAttempt(value, "Abandon");
}

export function translateFailAttempt(
  value: unknown,
): TranslationResult<EndAttemptInput> {
  return translateEndAttempt(value, "Fail");
}

function translateEndAttempt(
  value: unknown,
  label: string,
): TranslationResult<EndAttemptInput> {
  if (
    !isJsonObject(value) ||
    !hasJsonTopology(value) ||
    !hasExactKeys(value, [
      "requestId",
      "correlationId",
      "attemptId",
      "runnerId",
      "leaseToken",
      "reason",
    ]) ||
    !isPrivateIdentity(value) ||
    !isIdentifier(value["attemptId"]) ||
    !isIdentifier(value["runnerId"]) ||
    !validLeaseToken(value["leaseToken"]) ||
    !isBoundedText(value["reason"], 1000)
  )
    return invalid("PRIVATE_INPUT_INVALID", `${label} input is invalid.`);
  return {
    ok: true,
    value: deepFreezeCopy(value) as unknown as EndAttemptInput,
  };
}

export function translateExpireLease(
  value: unknown,
): TranslationResult<ExpireLeaseInput> {
  if (
    !isJsonObject(value) ||
    !hasJsonTopology(value) ||
    !hasExactKeys(value, ["requestId", "correlationId", "attemptId"]) ||
    !isPrivateIdentity(value) ||
    !isIdentifier(value["attemptId"])
  )
    return invalid("PRIVATE_INPUT_INVALID", "Expire-lease input is invalid.");
  return {
    ok: true,
    value: deepFreezeCopy(value) as unknown as ExpireLeaseInput,
  };
}
