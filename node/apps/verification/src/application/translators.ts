import type { VerificationStartVerificationV1 } from "@patchquest/contracts";
import {
  calculateGateSetDigest,
  type AcceptanceGate,
  type StartVerificationSeed,
  verificationSemanticFingerprint,
} from "../domain/verification-run.js";
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
  jsonFingerprint,
} from "./message-validation.js";

export type TranslationResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: "CONTRACT_INVALID" | "PRIVATE_INPUT_INVALID";
        message: string;
      }>;
    }>;

export interface TranslatedStartVerification {
  readonly dto: VerificationStartVerificationV1;
  readonly seed: StartVerificationSeed;
  readonly deliveryFingerprint: string;
  readonly semanticFingerprint: string;
}

export interface AssignmentRequest {
  readonly requestId: string;
  readonly correlationId: string;
  readonly verificationRunId: string;
}

export type AdvanceVerificationRequest = AssignmentRequest;

export interface AbortVerificationRequest extends AssignmentRequest {
  readonly reason: "MISSION_CANCELLED";
}

function invalid<Value>(
  code: "CONTRACT_INVALID" | "PRIVATE_INPUT_INVALID",
  message: string,
): TranslationResult<Value> {
  return { ok: false, error: { code, message } };
}

const commandByKind = {
  ALLOWED_SCOPE: "check-allowed-scope",
  LINT: "check-lint",
  TYPECHECK: "check-typecheck",
  TEST: "check-tests",
} as const;

function validGate(value: unknown): value is AcceptanceGate {
  return (
    isJsonObject(value) &&
    hasExactKeys(value, [
      "gateId",
      "kind",
      "commandId",
      "mandatory",
      "timeoutSeconds",
      "evidenceLimitBytes",
    ]) &&
    isIdentifier(value["gateId"]) &&
    commandByKind[String(value["kind"]) as keyof typeof commandByKind] ===
      value["commandId"] &&
    typeof value["mandatory"] === "boolean" &&
    isPositiveInteger(value["timeoutSeconds"]) &&
    Number(value["timeoutSeconds"]) <= 3600 &&
    Number.isSafeInteger(value["evidenceLimitBytes"]) &&
    Number(value["evidenceLimitBytes"]) >= 0 &&
    Number(value["evidenceLimitBytes"]) <= 1_048_576
  );
}

function validArtifact(value: unknown): boolean {
  if (
    !isJsonObject(value) ||
    !hasExactKeys(value, ["reference", "digest", "changedPaths"]) ||
    !isBoundedText(value["reference"], 2048) ||
    !isSha256Digest(value["digest"]) ||
    !isDenseJsonArray(value["changedPaths"]) ||
    value["changedPaths"].length < 1 ||
    !value["changedPaths"].every(
      (path) =>
        typeof path === "string" &&
        path.length >= 1 &&
        path.length <= 512 &&
        !path.startsWith("/") &&
        !/^[A-Za-z]:/u.test(path) &&
        !path.endsWith("/") &&
        !path.includes("\\") &&
        !path.includes("*") &&
        !path.includes("?") &&
        !path.includes("[") &&
        !path.includes("]") &&
        path.normalize("NFC") === path &&
        path
          .split("/")
          .every((part) => part.length > 0 && part !== "." && part !== ".."),
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

function sameDigest(
  left: Readonly<{ algorithm: "sha256"; value: string }>,
  right: Readonly<{ algorithm: "sha256"; value: string }>,
): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

export function translateStartVerification(
  value: unknown,
): TranslationResult<TranslatedStartVerification> {
  // Topology is proven before any semantic property read.
  if (!isJsonObject(value) || !hasJsonTopology(value))
    return invalid(
      "CONTRACT_INVALID",
      "Start-verification command must be dense JSON data.",
    );
  if (
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
    value["commandType"] !== "verification.start-verification.v1" ||
    value["schemaVersion"] !== 1 ||
    value["issuer"] !== "mission-control" ||
    value["recipient"] !== "verification-and-review" ||
    !isIdentifier(value["commandId"]) ||
    !isTimestamp(value["issuedAt"]) ||
    !isIdentifier(value["subjectId"]) ||
    !isIdentifier(value["correlationId"]) ||
    !isIdentifier(value["causationId"]) ||
    !isJsonObject(value["data"])
  )
    return invalid(
      "CONTRACT_INVALID",
      "Start-verification command envelope is invalid.",
    );
  const data = value["data"];
  if (
    !hasExactKeys(data, [
      "verificationRunId",
      "attemptId",
      "producingRunnerId",
      "binding",
      "artifact",
      "acceptanceGates",
    ]) ||
    !isIdentifier(data["verificationRunId"]) ||
    value["subjectId"] !== data["verificationRunId"] ||
    !isIdentifier(data["attemptId"]) ||
    !isIdentifier(data["producingRunnerId"]) ||
    !isJsonObject(data["binding"]) ||
    !hasExactKeys(data["binding"], [
      "missionId",
      "missionRevision",
      "startingRevision",
      "artifactDigest",
      "gateSetDigest",
    ]) ||
    !isIdentifier(data["binding"]["missionId"]) ||
    !isPositiveInteger(data["binding"]["missionRevision"]) ||
    !isBoundedText(data["binding"]["startingRevision"], 256) ||
    !isSha256Digest(data["binding"]["artifactDigest"]) ||
    !isSha256Digest(data["binding"]["gateSetDigest"]) ||
    !validArtifact(data["artifact"]) ||
    !isDenseJsonArray(data["acceptanceGates"]) ||
    data["acceptanceGates"].length < 1 ||
    !data["acceptanceGates"].every(validGate) ||
    new Set(data["acceptanceGates"].map((gate) => gate.gateId)).size !==
      data["acceptanceGates"].length
  )
    return invalid(
      "CONTRACT_INVALID",
      "Start-verification command data is invalid.",
    );
  const binding = data["binding"] as Readonly<{
    artifactDigest: Readonly<{ algorithm: "sha256"; value: string }>;
    gateSetDigest: Readonly<{ algorithm: "sha256"; value: string }>;
  }>;
  const artifact = data["artifact"] as Readonly<{
    digest: Readonly<{ algorithm: "sha256"; value: string }>;
  }>;
  const gates = data["acceptanceGates"] as readonly AcceptanceGate[];
  if (
    !sameDigest(binding["artifactDigest"], artifact.digest) ||
    !sameDigest(binding["gateSetDigest"], calculateGateSetDigest(gates))
  )
    return invalid(
      "CONTRACT_INVALID",
      "Start-verification digests do not bind the payload.",
    );

  // The transport DTO exists only at this boundary; the domain receives its own seed.
  const dto = deepFreezeCopy(
    value,
  ) as unknown as VerificationStartVerificationV1;
  const seed = deepFreezeCopy(value) as unknown as StartVerificationSeed;
  return {
    ok: true,
    value: deepFreezeCopy({
      dto,
      seed,
      deliveryFingerprint: jsonFingerprint(dto),
      semanticFingerprint: verificationSemanticFingerprint(seed),
    }),
  };
}

function translateIdentity(
  value: unknown,
  label: string,
): TranslationResult<AssignmentRequest> {
  if (
    !isJsonObject(value) ||
    !hasJsonTopology(value) ||
    !hasExactKeys(value, ["requestId", "correlationId", "verificationRunId"]) ||
    !isIdentifier(value["requestId"]) ||
    !isIdentifier(value["correlationId"]) ||
    !isIdentifier(value["verificationRunId"])
  )
    return invalid("PRIVATE_INPUT_INVALID", `${label} input is invalid.`);
  return {
    ok: true,
    value: deepFreezeCopy(value) as unknown as AssignmentRequest,
  };
}

export function translateAssignmentRequest(
  value: unknown,
): TranslationResult<AssignmentRequest> {
  return translateIdentity(value, "Verifier-assignment");
}

export function translateAdvanceVerification(
  value: unknown,
): TranslationResult<AdvanceVerificationRequest> {
  return translateIdentity(value, "Advance-verification");
}

export function translateAbortVerification(
  value: unknown,
): TranslationResult<AbortVerificationRequest> {
  if (
    !isJsonObject(value) ||
    !hasJsonTopology(value) ||
    !hasExactKeys(value, [
      "requestId",
      "correlationId",
      "verificationRunId",
      "reason",
    ]) ||
    !isIdentifier(value["requestId"]) ||
    !isIdentifier(value["correlationId"]) ||
    !isIdentifier(value["verificationRunId"]) ||
    value["reason"] !== "MISSION_CANCELLED"
  )
    return invalid(
      "PRIVATE_INPUT_INVALID",
      "Abort-verification input is invalid.",
    );
  return {
    ok: true,
    value: deepFreezeCopy(value) as unknown as AbortVerificationRequest,
  };
}
