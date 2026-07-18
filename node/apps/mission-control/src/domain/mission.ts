import {
  canonicalizeJsonContent,
  hasExactOwnKeys,
  hasJsonContentTopology,
  isDenseJsonArray,
  isJsonObject,
  jsonContentFingerprint,
} from "./json-topology.js";

export type MissionStatus =
  | "DRAFT"
  | "OPEN"
  | "ATTEMPT_RUNNING"
  | "VERIFICATION_RUNNING"
  | "COMPLETION_REVIEW"
  | "NEEDS_HUMAN_DECISION"
  | "COMPLETED"
  | "CANCELLED";

export type PublicMissionStatus = Exclude<MissionStatus, "DRAFT">;

export interface MissionDigest {
  readonly algorithm: "sha256";
  readonly value: string;
}

export interface MissionAcceptanceGate {
  readonly gateId: string;
  readonly kind: "ALLOWED_SCOPE" | "LINT" | "TYPECHECK" | "TEST";
  readonly commandId:
    "check-allowed-scope" | "check-lint" | "check-typecheck" | "check-tests";
  readonly mandatory: boolean;
  readonly timeoutSeconds: number;
  readonly evidenceLimitBytes: number;
}

export interface MissionWorkContract {
  readonly objective: string;
  readonly startingRevision: string;
  readonly workspaceReference: string;
  readonly allowedScope: Readonly<{ pathPatterns: readonly string[] }>;
  readonly requestedCapabilities: readonly string[];
  readonly acceptanceGates: readonly MissionAcceptanceGate[];
  readonly gateSetDigest: MissionDigest;
}

export interface CompletionBinding {
  readonly missionRevision: number;
  readonly completionReviewId: string;
  readonly recommendation: "APPROVE" | "REQUEST_REVISION";
  readonly verificationRunId: string;
  readonly artifactDigest: MissionDigest;
  readonly gateSetDigest: MissionDigest;
  readonly evidenceBundleDigest: MissionDigest;
}

export type MissionErrorCode =
  | "INVALID_MISSION"
  | "GATE_SET_DIGEST_MISMATCH"
  | "DUPLICATE_GATE"
  | "REQUIREMENTS_IMMUTABLE"
  | "MISSION_TERMINAL"
  | "ATTEMPT_BUDGET_EXHAUSTED"
  | "STALE_MISSION_REVISION"
  | "STALE_COMPLETION_BINDING"
  | "VERIFICATION_NOT_PASSED"
  | "COMPLETION_REVIEW_ALREADY_DECIDED"
  | "CONFLICTING_VERIFICATION_FACT"
  | "PERSISTENCE_MEMENTO_INVALID"
  | "PERSISTENCE_VERSION_UNSUPPORTED"
  | "UNSUPPORTED_TRANSITION";

export interface MissionError {
  readonly code: MissionErrorCode;
  readonly message: string;
}

export type MissionResult<Value> =
  | {
      readonly ok: true;
      readonly disposition: "applied" | "idempotent" | "ignored";
      readonly value: Value;
      readonly events: readonly MissionDomainEvent[];
    }
  | { readonly ok: false; readonly error: MissionError };

export type MissionRetryReason =
  | "ATTEMPT_EXPIRED"
  | "ATTEMPT_FAILED"
  | "REVISION_REQUESTED"
  | "HUMAN_AUTHORIZED"
  | "VERIFICATION_ABORTED";

export type MissionDomainEvent =
  | {
      readonly kind: "MISSION_OPENED";
      readonly missionId: string;
      readonly missionRevision: number;
      readonly workContract: MissionWorkContract;
      readonly attemptBudget: number;
    }
  | {
      readonly kind: "MISSION_RETRY_AUTHORIZED";
      readonly missionId: string;
      readonly missionRevision: number;
      readonly nextAttemptNumber: number;
      readonly attemptBudget: number;
      readonly reason: MissionRetryReason;
      readonly feedback?: string;
    }
  | {
      readonly kind: "MISSION_CANCELLED";
      readonly missionId: string;
      readonly missionRevision: number;
      readonly cancelledBy: string;
      readonly reason: string;
    }
  | {
      readonly kind: "MISSION_COMPLETED";
      readonly missionId: string;
      readonly missionRevision: number;
      readonly binding: CompletionBinding & {
        readonly recommendation: "APPROVE";
      };
      readonly approvedBy: string;
    };

export interface MissionProcessSeed {
  readonly missionId: string;
  readonly missionRevision: number;
  readonly workContract: MissionWorkContract;
  readonly attemptBudget: number;
  readonly attemptsAuthorized: 1;
  readonly attemptId: string;
  readonly attemptNumber: 1;
}

export interface MissionOpenedResult {
  readonly snapshot: MissionSnapshot;
  readonly processSeed: MissionProcessSeed;
}

export interface MissionSnapshot {
  readonly missionId: string;
  readonly missionRevision: number;
  readonly status: MissionStatus;
  readonly attemptBudget: number;
  readonly attemptsAuthorized: number;
  readonly workContract?: MissionWorkContract;
  readonly latestAttemptId?: string;
  readonly latestAttemptNumber?: number;
  readonly latestArtifactDigest?: MissionDigest;
  readonly latestVerificationRunId?: string;
  readonly latestVerdict?: "PASSED" | "FAILED";
  readonly latestEvidenceBundleDigest?: MissionDigest;
  readonly completionBinding?: CompletionBinding;
  readonly humanDecision?: "APPROVED" | "REJECTED";
  readonly decisionReason?: string;
  readonly cancellation?: Readonly<{ cancelledBy: string; reason: string }>;
  readonly cycleHistory: readonly MissionCycleAudit[];
}

export type VerificationOutcome =
  | Readonly<{
      kind: "VERDICT";
      attemptId: string;
      verificationRunId: string;
      binding: VerificationFactBinding;
      verdict: "PASSED" | "FAILED";
      evidenceBundleDigest: MissionDigest;
    }>
  | Readonly<{
      kind: "ABORTED";
      attemptId: string;
      verificationRunId: string;
      binding: VerificationFactBinding;
      reason:
        | "VERIFIER_UNAVAILABLE"
        | "WORKSPACE_UNAVAILABLE"
        | "EXECUTION_INFRASTRUCTURE_FAILURE"
        | "MISSION_CANCELLED";
      retryable: boolean;
    }>;

export interface MissionCycleAudit {
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly artifactDigest?: MissionDigest;
  readonly verificationOutcome?: VerificationOutcome;
  readonly completionBinding?: CompletionBinding;
  readonly humanDecision?: "APPROVED" | "REJECTED";
  readonly decisionReason?: string;
  readonly retryReason?: MissionRetryReason;
}

export interface MissionMementoV1 {
  readonly mementoType: "patchquest.mission";
  readonly mementoVersion: 1;
  readonly missionId: string;
  readonly missionRevision: number;
  readonly status: MissionStatus;
  readonly attemptBudget: number;
  readonly attemptsAuthorized: number;
  readonly draft: Omit<
    MissionWorkContract,
    "acceptanceGates" | "gateSetDigest"
  >;
  readonly workContract?: MissionWorkContract;
  readonly latestAttemptId?: string;
  readonly latestAttemptNumber?: number;
  readonly latestArtifactDigest?: MissionDigest;
  readonly verificationOutcome?: VerificationOutcome;
  readonly completionBinding?: CompletionBinding;
  readonly humanDecision?: "APPROVED" | "REJECTED";
  readonly decisionReason?: string;
  readonly cancellation?: Readonly<{ cancelledBy: string; reason: string }>;
  readonly retryEligibility?: MissionRetryReason;
  readonly authorizedAttemptIds: readonly string[];
  readonly cycleHistory: readonly MissionCycleAudit[];
}

export interface DraftMission {
  readonly missionId: string;
  readonly missionRevision: number;
  readonly objective: string;
  readonly startingRevision: string;
  readonly workspaceReference: string;
  readonly allowedScope: Readonly<{ pathPatterns: readonly string[] }>;
  readonly requestedCapabilities: readonly string[];
  readonly attemptBudget: number;
}

export interface DefineAcceptanceGates {
  readonly acceptanceGates: readonly MissionAcceptanceGate[];
  readonly gateSetDigest: MissionDigest;
}

export interface OpenMission {
  readonly attemptId: string;
}

export interface AuthorizeAnotherAttempt {
  readonly attemptId: string;
  readonly reason: MissionRetryReason;
  readonly feedback?: string;
}

export interface ApproveMissionCompletion extends CompletionBinding {
  readonly decidedBy: string;
}

export interface RejectMissionCompletion extends CompletionBinding {
  readonly decidedBy: string;
  readonly reason: string;
  readonly authorizeAnotherAttempt: boolean;
  readonly nextAttemptId?: string;
}

export interface CancelMission {
  readonly missionRevision: number;
  readonly cancelledBy: string;
  readonly reason: string;
}

export interface RecordAttemptLeased {
  readonly missionRevision: number;
  readonly attemptId: string;
  readonly attemptNumber: number;
}

export interface RecordAttemptEnded {
  readonly missionRevision: number;
  readonly attemptId: string;
  readonly outcome:
    "ARTIFACT_SUBMITTED" | "ABANDONED" | "FAILED" | "LEASE_EXPIRED" | "REVOKED";
}

export interface RecordArtifactSubmitted {
  readonly missionRevision: number;
  readonly attemptId: string;
  readonly startingRevision: string;
  readonly artifactDigest: MissionDigest;
  readonly gateSetDigest: MissionDigest;
}

export interface VerificationFactBinding {
  readonly missionId: string;
  readonly missionRevision: number;
  readonly startingRevision: string;
  readonly artifactDigest: MissionDigest;
  readonly gateSetDigest: MissionDigest;
}

export interface RecordVerificationVerdict {
  readonly attemptId: string;
  readonly verificationRunId: string;
  readonly binding: VerificationFactBinding;
  readonly verdict: "PASSED" | "FAILED";
  readonly evidenceBundleDigest: MissionDigest;
}

export interface RecordVerificationAborted {
  readonly attemptId: string;
  readonly verificationRunId: string;
  readonly binding: VerificationFactBinding;
  readonly reason:
    | "VERIFIER_UNAVAILABLE"
    | "WORKSPACE_UNAVAILABLE"
    | "EXECUTION_INFRASTRUCTURE_FAILURE"
    | "MISSION_CANCELLED";
  readonly retryable: boolean;
}

export interface RecordReviewRecommendation {
  readonly completionReviewId: string;
  readonly verificationRunId: string;
  readonly binding: VerificationFactBinding;
  readonly verdict: "PASSED" | "FAILED";
  readonly evidenceBundleDigest: MissionDigest;
  readonly recommendation: "APPROVE" | "REQUEST_REVISION";
}

interface MutableMissionState {
  missionId: string;
  missionRevision: number;
  status: MissionStatus;
  attemptBudget: number;
  attemptsAuthorized: number;
  draft: Omit<MissionWorkContract, "acceptanceGates" | "gateSetDigest">;
  workContract?: MissionWorkContract | undefined;
  latestAttemptId?: string | undefined;
  latestAttemptNumber?: number | undefined;
  latestArtifactDigest?: MissionDigest | undefined;
  latestVerificationRunId?: string | undefined;
  latestVerdict?: "PASSED" | "FAILED" | undefined;
  latestEvidenceBundleDigest?: MissionDigest | undefined;
  verificationOutcome?: VerificationOutcome | undefined;
  completionBinding?: CompletionBinding | undefined;
  humanDecision?: "APPROVED" | "REJECTED" | undefined;
  decisionReason?: string | undefined;
  cancellation?: { cancelledBy: string; reason: string } | undefined;
  retryEligibility?: MissionRetryReason | undefined;
  authorizedAttemptIds: Set<string>;
  cycleHistory: MissionCycleAudit[];
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const digestPattern = /^[a-f0-9]{64}$/;
export const MISSION_RETRY_REASONS = Object.freeze([
  "ATTEMPT_EXPIRED",
  "ATTEMPT_FAILED",
  "REVISION_REQUESTED",
  "HUMAN_AUTHORIZED",
  "VERIFICATION_ABORTED",
] as const);
export const ATTEMPT_OUTCOMES = Object.freeze([
  "ARTIFACT_SUBMITTED",
  "ABANDONED",
  "FAILED",
  "LEASE_EXPIRED",
  "REVOKED",
] as const);
export const VERIFICATION_VERDICTS = Object.freeze([
  "PASSED",
  "FAILED",
] as const);
export const VERIFICATION_ABORT_REASONS = Object.freeze([
  "VERIFIER_UNAVAILABLE",
  "WORKSPACE_UNAVAILABLE",
  "EXECUTION_INFRASTRUCTURE_FAILURE",
  "MISSION_CANCELLED",
] as const);
export const REVIEW_RECOMMENDATIONS = Object.freeze([
  "APPROVE",
  "REQUEST_REVISION",
] as const);

function error(code: MissionErrorCode, message: string): MissionResult<never> {
  return { ok: false, error: { code, message } };
}

function applied<Value>(
  value: Value,
  events: readonly MissionDomainEvent[] = [],
): MissionResult<Value> {
  return {
    ok: true,
    disposition: "applied",
    value,
    events: Object.freeze([...events]),
  };
}

function idempotent<Value>(value: Value): MissionResult<Value> {
  return { ok: true, disposition: "idempotent", value, events: [] };
}

function ignored<Value>(value: Value): MissionResult<Value> {
  return { ok: true, disposition: "ignored", value, events: [] };
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 128 &&
    identifierPattern.test(value)
  );
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

function sameDigest(left: MissionDigest, right: MissionDigest): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

const canonicalize = canonicalizeJsonContent;

export function calculateGateSetDigest(
  gates: readonly MissionAcceptanceGate[],
): MissionDigest {
  if (
    !isDenseJsonArray(gates) ||
    gates.length < 1 ||
    !gates.every((gate) => isJsonObject(gate) && hasJsonContentTopology(gate))
  )
    throw new TypeError(
      "Gate-set digest requires a dense array of ordinary JSON gate records.",
    );
  const sorted = [...gates].sort((left, right) =>
    left.gateId < right.gateId ? -1 : left.gateId > right.gateId ? 1 : 0,
  );
  return {
    algorithm: "sha256",
    value: jsonContentFingerprint(sorted),
  };
}

function copyDigest(value: MissionDigest): MissionDigest {
  return Object.freeze({ algorithm: "sha256", value: value.value });
}

function copyVerificationBinding(
  value: VerificationFactBinding,
): VerificationFactBinding {
  return Object.freeze({
    missionId: value.missionId,
    missionRevision: value.missionRevision,
    startingRevision: value.startingRevision,
    artifactDigest: copyDigest(value.artifactDigest),
    gateSetDigest: copyDigest(value.gateSetDigest),
  });
}

function copyCompletionBinding(value: CompletionBinding): CompletionBinding {
  return Object.freeze({
    missionRevision: value.missionRevision,
    completionReviewId: value.completionReviewId,
    recommendation: value.recommendation,
    verificationRunId: value.verificationRunId,
    artifactDigest: copyDigest(value.artifactDigest),
    gateSetDigest: copyDigest(value.gateSetDigest),
    evidenceBundleDigest: copyDigest(value.evidenceBundleDigest),
  });
}

function copyVerificationOutcome(
  value: VerificationOutcome,
): VerificationOutcome {
  if (value.kind === "VERDICT")
    return Object.freeze({
      kind: "VERDICT",
      attemptId: value.attemptId,
      verificationRunId: value.verificationRunId,
      binding: copyVerificationBinding(value.binding),
      verdict: value.verdict,
      evidenceBundleDigest: copyDigest(value.evidenceBundleDigest),
    });
  return Object.freeze({
    kind: "ABORTED",
    attemptId: value.attemptId,
    verificationRunId: value.verificationRunId,
    binding: copyVerificationBinding(value.binding),
    reason: value.reason,
    retryable: value.retryable,
  });
}

function copyCycleAudit(value: MissionCycleAudit): MissionCycleAudit {
  return Object.freeze({
    attemptId: value.attemptId,
    attemptNumber: value.attemptNumber,
    ...(value.artifactDigest
      ? { artifactDigest: copyDigest(value.artifactDigest) }
      : {}),
    ...(value.verificationOutcome
      ? {
          verificationOutcome: copyVerificationOutcome(
            value.verificationOutcome,
          ),
        }
      : {}),
    ...(value.completionBinding
      ? { completionBinding: copyCompletionBinding(value.completionBinding) }
      : {}),
    ...(value.humanDecision ? { humanDecision: value.humanDecision } : {}),
    ...(value.decisionReason ? { decisionReason: value.decisionReason } : {}),
    ...(value.retryReason ? { retryReason: value.retryReason } : {}),
  });
}

function freezeGate(gate: MissionAcceptanceGate): MissionAcceptanceGate {
  return Object.freeze({ ...gate });
}

function freezeWorkContract(
  contract: MissionWorkContract,
): MissionWorkContract {
  return Object.freeze({
    objective: contract.objective,
    startingRevision: contract.startingRevision,
    workspaceReference: contract.workspaceReference,
    allowedScope: Object.freeze({
      pathPatterns: Object.freeze([...contract.allowedScope.pathPatterns]),
    }),
    requestedCapabilities: Object.freeze([...contract.requestedCapabilities]),
    acceptanceGates: Object.freeze(contract.acceptanceGates.map(freezeGate)),
    gateSetDigest: copyDigest(contract.gateSetDigest),
  });
}

function sameBinding(
  left: CompletionBinding,
  right: CompletionBinding,
): boolean {
  return (
    left.missionRevision === right.missionRevision &&
    left.completionReviewId === right.completionReviewId &&
    left.recommendation === right.recommendation &&
    left.verificationRunId === right.verificationRunId &&
    sameDigest(left.artifactDigest, right.artifactDigest) &&
    sameDigest(left.gateSetDigest, right.gateSetDigest) &&
    sameDigest(left.evidenceBundleDigest, right.evidenceBundleDigest)
  );
}

function sameVerificationBinding(
  left: VerificationFactBinding,
  right: VerificationFactBinding,
): boolean {
  return (
    left.missionId === right.missionId &&
    left.missionRevision === right.missionRevision &&
    left.startingRevision === right.startingRevision &&
    sameDigest(left.artifactDigest, right.artifactDigest) &&
    sameDigest(left.gateSetDigest, right.gateSetDigest)
  );
}

function sameVerificationOutcome(
  left: VerificationOutcome,
  right: VerificationOutcome,
): boolean {
  if (
    left.kind !== right.kind ||
    left.attemptId !== right.attemptId ||
    left.verificationRunId !== right.verificationRunId ||
    !sameVerificationBinding(left.binding, right.binding)
  )
    return false;
  if (left.kind === "VERDICT" && right.kind === "VERDICT")
    return (
      left.verdict === right.verdict &&
      sameDigest(left.evidenceBundleDigest, right.evidenceBundleDigest)
    );
  return (
    left.kind === "ABORTED" &&
    right.kind === "ABORTED" &&
    left.reason === right.reason &&
    left.retryable === right.retryable
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return isJsonObject(value) && hasJsonContentTopology(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  return hasExactOwnKeys(value, required, optional);
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    isDenseJsonArray(value) && value.every((item) => typeof item === "string")
  );
}

function isBoundedString(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function isDraftMission(value: unknown): value is DraftMission {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "missionId",
      "missionRevision",
      "objective",
      "startingRevision",
      "workspaceReference",
      "allowedScope",
      "requestedCapabilities",
      "attemptBudget",
    ]) ||
    !isRecord(value["allowedScope"]) ||
    !hasExactKeys(value["allowedScope"], ["pathPatterns"]) ||
    !isStringArray(value["allowedScope"]["pathPatterns"]) ||
    !isStringArray(value["requestedCapabilities"])
  )
    return false;
  const paths = value["allowedScope"]["pathPatterns"];
  const capabilities = value["requestedCapabilities"];
  return (
    isIdentifier(value["missionId"]) &&
    isPositiveInteger(value["missionRevision"]) &&
    isBoundedString(value["objective"], 1, 2000) &&
    isBoundedString(value["startingRevision"], 1, 256) &&
    isBoundedString(value["workspaceReference"], 1, 2048) &&
    paths.length >= 1 &&
    new Set(paths).size === paths.length &&
    paths.every((path) => isBoundedString(path, 1, 512)) &&
    capabilities.length >= 1 &&
    new Set(capabilities).size === capabilities.length &&
    capabilities.every(isIdentifier) &&
    isPositiveInteger(value["attemptBudget"])
  );
}

function isDefineAcceptanceGates(
  value: unknown,
): value is DefineAcceptanceGates {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["acceptanceGates", "gateSetDigest"]) &&
    isDenseJsonArray(value["acceptanceGates"]) &&
    value["acceptanceGates"].length >= 1 &&
    value["acceptanceGates"].every(isMissionAcceptanceGate) &&
    isDigest(value["gateSetDigest"])
  );
}

function isOpenMission(value: unknown): value is OpenMission {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["attemptId"]) &&
    isIdentifier(value["attemptId"])
  );
}

function isAuthorizeAnotherAttempt(
  value: unknown,
): value is AuthorizeAnotherAttempt {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["attemptId", "reason"], ["feedback"]) &&
    isIdentifier(value["attemptId"]) &&
    MISSION_RETRY_REASONS.includes(value["reason"] as MissionRetryReason) &&
    (value["feedback"] === undefined ||
      isBoundedString(value["feedback"], 1, 2000))
  );
}

function completionBindingFrom(value: Readonly<Record<string, unknown>>) {
  return {
    missionRevision: value["missionRevision"],
    completionReviewId: value["completionReviewId"],
    recommendation: value["recommendation"],
    verificationRunId: value["verificationRunId"],
    artifactDigest: value["artifactDigest"],
    gateSetDigest: value["gateSetDigest"],
    evidenceBundleDigest: value["evidenceBundleDigest"],
  };
}

const completionBindingKeys = [
  "missionRevision",
  "completionReviewId",
  "recommendation",
  "verificationRunId",
  "artifactDigest",
  "gateSetDigest",
  "evidenceBundleDigest",
] as const;

function isApproveMissionCompletion(
  value: unknown,
): value is ApproveMissionCompletion {
  return (
    isRecord(value) &&
    hasExactKeys(value, [...completionBindingKeys, "decidedBy"]) &&
    isCompletionBinding(completionBindingFrom(value)) &&
    isIdentifier(value["decidedBy"])
  );
}

function isRejectMissionCompletion(
  value: unknown,
): value is RejectMissionCompletion {
  return (
    isRecord(value) &&
    hasExactKeys(
      value,
      [
        ...completionBindingKeys,
        "decidedBy",
        "reason",
        "authorizeAnotherAttempt",
      ],
      ["nextAttemptId"],
    ) &&
    isCompletionBinding(completionBindingFrom(value)) &&
    isIdentifier(value["decidedBy"]) &&
    isBoundedString(value["reason"], 1, 2000) &&
    typeof value["authorizeAnotherAttempt"] === "boolean" &&
    (value["nextAttemptId"] === undefined ||
      isIdentifier(value["nextAttemptId"]))
  );
}

function isCancelMission(value: unknown): value is CancelMission {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["missionRevision", "cancelledBy", "reason"]) &&
    isPositiveInteger(value["missionRevision"]) &&
    isIdentifier(value["cancelledBy"]) &&
    isBoundedString(value["reason"], 1, 1000)
  );
}

function isRecordAttemptLeased(value: unknown): value is RecordAttemptLeased {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["missionRevision", "attemptId", "attemptNumber"]) &&
    isPositiveInteger(value["missionRevision"]) &&
    isIdentifier(value["attemptId"]) &&
    isPositiveInteger(value["attemptNumber"])
  );
}

function isRecordAttemptEnded(value: unknown): value is RecordAttemptEnded {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["missionRevision", "attemptId", "outcome"]) &&
    isPositiveInteger(value["missionRevision"]) &&
    isIdentifier(value["attemptId"]) &&
    ATTEMPT_OUTCOMES.includes(value["outcome"] as RecordAttemptEnded["outcome"])
  );
}

function isRecordArtifactSubmitted(
  value: unknown,
): value is RecordArtifactSubmitted {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "missionRevision",
      "attemptId",
      "startingRevision",
      "artifactDigest",
      "gateSetDigest",
    ]) &&
    isPositiveInteger(value["missionRevision"]) &&
    isIdentifier(value["attemptId"]) &&
    isBoundedString(value["startingRevision"], 1, 256) &&
    isDigest(value["artifactDigest"]) &&
    isDigest(value["gateSetDigest"])
  );
}

function isRecordVerificationVerdict(
  value: unknown,
): value is RecordVerificationVerdict {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "attemptId",
      "verificationRunId",
      "binding",
      "verdict",
      "evidenceBundleDigest",
    ]) &&
    isIdentifier(value["attemptId"]) &&
    isIdentifier(value["verificationRunId"]) &&
    isVerificationBinding(value["binding"]) &&
    VERIFICATION_VERDICTS.includes(
      value["verdict"] as RecordVerificationVerdict["verdict"],
    ) &&
    isDigest(value["evidenceBundleDigest"])
  );
}

function isRecordVerificationAborted(
  value: unknown,
): value is RecordVerificationAborted {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "attemptId",
      "verificationRunId",
      "binding",
      "reason",
      "retryable",
    ]) ||
    !isIdentifier(value["attemptId"]) ||
    !isIdentifier(value["verificationRunId"]) ||
    !isVerificationBinding(value["binding"]) ||
    !VERIFICATION_ABORT_REASONS.includes(
      value["reason"] as RecordVerificationAborted["reason"],
    ) ||
    typeof value["retryable"] !== "boolean"
  )
    return false;
  return value["reason"] !== "MISSION_CANCELLED" || !value["retryable"];
}

function isRecordReviewRecommendation(
  value: unknown,
): value is RecordReviewRecommendation {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "completionReviewId",
      "verificationRunId",
      "binding",
      "verdict",
      "evidenceBundleDigest",
      "recommendation",
    ]) &&
    isIdentifier(value["completionReviewId"]) &&
    isIdentifier(value["verificationRunId"]) &&
    isVerificationBinding(value["binding"]) &&
    VERIFICATION_VERDICTS.includes(
      value["verdict"] as RecordReviewRecommendation["verdict"],
    ) &&
    isDigest(value["evidenceBundleDigest"]) &&
    REVIEW_RECOMMENDATIONS.includes(
      value["recommendation"] as RecordReviewRecommendation["recommendation"],
    )
  );
}

export function isMissionAcceptanceGate(
  value: unknown,
): value is MissionAcceptanceGate {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "gateId",
      "kind",
      "commandId",
      "mandatory",
      "timeoutSeconds",
      "evidenceLimitBytes",
    ])
  )
    return false;
  const registeredCommandByKind: Readonly<Record<string, string>> = {
    ALLOWED_SCOPE: "check-allowed-scope",
    LINT: "check-lint",
    TYPECHECK: "check-typecheck",
    TEST: "check-tests",
  };
  return (
    typeof value["gateId"] === "string" &&
    isIdentifier(value["gateId"]) &&
    typeof value["kind"] === "string" &&
    ["ALLOWED_SCOPE", "LINT", "TYPECHECK", "TEST"].includes(value["kind"]) &&
    typeof value["commandId"] === "string" &&
    [
      "check-allowed-scope",
      "check-lint",
      "check-typecheck",
      "check-tests",
    ].includes(value["commandId"]) &&
    registeredCommandByKind[value["kind"]] === value["commandId"] &&
    typeof value["mandatory"] === "boolean" &&
    Number.isSafeInteger(value["timeoutSeconds"]) &&
    Number(value["timeoutSeconds"]) >= 1 &&
    Number(value["timeoutSeconds"]) <= 3600 &&
    Number.isSafeInteger(value["evidenceLimitBytes"]) &&
    Number(value["evidenceLimitBytes"]) >= 0 &&
    Number(value["evidenceLimitBytes"]) <= 1_048_576
  );
}

function isMissionDigest(value: unknown): value is MissionDigest {
  return isDigest(value);
}

export function isMissionWorkContract(
  value: unknown,
): value is MissionWorkContract {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "objective",
      "startingRevision",
      "workspaceReference",
      "allowedScope",
      "requestedCapabilities",
      "acceptanceGates",
      "gateSetDigest",
    ]) ||
    !isRecord(value["allowedScope"]) ||
    !hasExactKeys(value["allowedScope"], ["pathPatterns"])
  )
    return false;
  const scope = value["allowedScope"];
  const valid =
    typeof value["objective"] === "string" &&
    value["objective"].length >= 1 &&
    value["objective"].length <= 2000 &&
    typeof value["startingRevision"] === "string" &&
    value["startingRevision"].length >= 1 &&
    value["startingRevision"].length <= 256 &&
    typeof value["workspaceReference"] === "string" &&
    value["workspaceReference"].length >= 1 &&
    value["workspaceReference"].length <= 2048 &&
    isStringArray(scope["pathPatterns"]) &&
    scope["pathPatterns"].length >= 1 &&
    scope["pathPatterns"].every(
      (path) => path.length >= 1 && path.length <= 512,
    ) &&
    new Set(scope["pathPatterns"]).size === scope["pathPatterns"].length &&
    isStringArray(value["requestedCapabilities"]) &&
    value["requestedCapabilities"].length >= 1 &&
    value["requestedCapabilities"].every(isIdentifier) &&
    new Set(value["requestedCapabilities"]).size ===
      value["requestedCapabilities"].length &&
    isDenseJsonArray(value["acceptanceGates"]) &&
    value["acceptanceGates"].length >= 1 &&
    value["acceptanceGates"].every(isMissionAcceptanceGate) &&
    new Set(
      value["acceptanceGates"].map(
        (gate: MissionAcceptanceGate) => gate.gateId,
      ),
    ).size === value["acceptanceGates"].length &&
    isMissionDigest(value["gateSetDigest"]);
  if (!valid) return false;
  const contract = value as unknown as MissionWorkContract;
  try {
    new URL(contract.workspaceReference);
  } catch {
    return false;
  }
  return sameDigest(
    calculateGateSetDigest(contract.acceptanceGates),
    contract.gateSetDigest,
  );
}

function isVerificationBinding(
  value: unknown,
): value is VerificationFactBinding {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "missionId",
      "missionRevision",
      "startingRevision",
      "artifactDigest",
      "gateSetDigest",
    ]) &&
    typeof value["missionId"] === "string" &&
    isIdentifier(value["missionId"]) &&
    Number.isSafeInteger(value["missionRevision"]) &&
    Number(value["missionRevision"]) >= 1 &&
    typeof value["startingRevision"] === "string" &&
    value["startingRevision"].length >= 1 &&
    value["startingRevision"].length <= 256 &&
    isMissionDigest(value["artifactDigest"]) &&
    isMissionDigest(value["gateSetDigest"])
  );
}

function isVerificationOutcome(value: unknown): value is VerificationOutcome {
  if (
    !isRecord(value) ||
    typeof value["attemptId"] !== "string" ||
    typeof value["verificationRunId"] !== "string" ||
    !isVerificationBinding(value["binding"])
  )
    return false;
  if (value["kind"] === "VERDICT")
    return (
      hasExactKeys(value, [
        "kind",
        "attemptId",
        "verificationRunId",
        "binding",
        "verdict",
        "evidenceBundleDigest",
      ]) &&
      isIdentifier(value["attemptId"]) &&
      isIdentifier(value["verificationRunId"]) &&
      (value["verdict"] === "PASSED" || value["verdict"] === "FAILED") &&
      isMissionDigest(value["evidenceBundleDigest"])
    );
  return (
    value["kind"] === "ABORTED" &&
    hasExactKeys(value, [
      "kind",
      "attemptId",
      "verificationRunId",
      "binding",
      "reason",
      "retryable",
    ]) &&
    isIdentifier(value["attemptId"]) &&
    isIdentifier(value["verificationRunId"]) &&
    [
      "VERIFIER_UNAVAILABLE",
      "WORKSPACE_UNAVAILABLE",
      "EXECUTION_INFRASTRUCTURE_FAILURE",
      "MISSION_CANCELLED",
    ].includes(String(value["reason"])) &&
    typeof value["retryable"] === "boolean" &&
    !(value["reason"] === "MISSION_CANCELLED" && value["retryable"])
  );
}

function isCompletionBinding(value: unknown): value is CompletionBinding {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "missionRevision",
      "completionReviewId",
      "recommendation",
      "verificationRunId",
      "artifactDigest",
      "gateSetDigest",
      "evidenceBundleDigest",
    ]) &&
    Number.isSafeInteger(value["missionRevision"]) &&
    Number(value["missionRevision"]) >= 1 &&
    typeof value["completionReviewId"] === "string" &&
    isIdentifier(value["completionReviewId"]) &&
    (value["recommendation"] === "APPROVE" ||
      value["recommendation"] === "REQUEST_REVISION") &&
    typeof value["verificationRunId"] === "string" &&
    isIdentifier(value["verificationRunId"]) &&
    isMissionDigest(value["artifactDigest"]) &&
    isMissionDigest(value["gateSetDigest"]) &&
    isMissionDigest(value["evidenceBundleDigest"])
  );
}

function completionMatchesOutcome(
  completion: CompletionBinding,
  outcome: Extract<VerificationOutcome, { kind: "VERDICT" }>,
  artifactDigest: MissionDigest,
  gateSetDigest: MissionDigest,
  missionRevision: number,
): boolean {
  return (
    completion.missionRevision === missionRevision &&
    completion.verificationRunId === outcome.verificationRunId &&
    completion.recommendation ===
      (outcome.verdict === "PASSED" ? "APPROVE" : "REQUEST_REVISION") &&
    sameDigest(completion.artifactDigest, artifactDigest) &&
    sameDigest(completion.gateSetDigest, gateSetDigest) &&
    sameDigest(completion.evidenceBundleDigest, outcome.evidenceBundleDigest)
  );
}

function cycleChainValid(
  cycle: MissionCycleAudit,
  memento: MissionMementoV1,
): boolean {
  const artifact = cycle.artifactDigest;
  const outcome = cycle.verificationOutcome;
  const completion = cycle.completionBinding;
  if ((outcome !== undefined || completion !== undefined) && !artifact)
    return false;
  if (outcome) {
    if (
      outcome.attemptId !== cycle.attemptId ||
      outcome.binding.missionId !== memento.missionId ||
      outcome.binding.missionRevision !== memento.missionRevision ||
      outcome.binding.startingRevision !== memento.draft.startingRevision ||
      !artifact ||
      !sameDigest(outcome.binding.artifactDigest, artifact) ||
      !memento.workContract ||
      !sameDigest(
        outcome.binding.gateSetDigest,
        memento.workContract.gateSetDigest,
      )
    )
      return false;
  }
  if (
    completion &&
    (!outcome ||
      outcome.kind !== "VERDICT" ||
      !artifact ||
      !memento.workContract ||
      !completionMatchesOutcome(
        completion,
        outcome,
        artifact,
        memento.workContract.gateSetDigest,
        memento.missionRevision,
      ))
  )
    return false;
  if (
    (cycle.humanDecision !== undefined) !==
      (cycle.decisionReason !== undefined) ||
    (cycle.humanDecision !== undefined && !completion) ||
    (cycle.decisionReason !== undefined &&
      (cycle.decisionReason.length < 1 || cycle.decisionReason.length > 2000))
  )
    return false;
  switch (cycle.retryReason) {
    case "ATTEMPT_EXPIRED":
    case "ATTEMPT_FAILED":
      return !artifact && !outcome && !completion && !cycle.humanDecision;
    case "VERIFICATION_ABORTED":
      return (
        outcome?.kind === "ABORTED" &&
        outcome.retryable &&
        outcome.reason !== "MISSION_CANCELLED" &&
        !completion &&
        !cycle.humanDecision
      );
    case "REVISION_REQUESTED":
      return (
        outcome?.kind === "VERDICT" &&
        outcome.verdict === "FAILED" &&
        completion?.recommendation === "REQUEST_REVISION" &&
        !cycle.humanDecision
      );
    case "HUMAN_AUTHORIZED":
      return cycle.humanDecision === "REJECTED" && completion !== undefined;
    case undefined:
      return (
        cycle.humanDecision === "APPROVED" &&
        outcome?.kind === "VERDICT" &&
        outcome.verdict === "PASSED" &&
        completion?.recommendation === "APPROVE"
      );
  }
  return false;
}

function missionMementoInvariant(memento: MissionMementoV1): boolean {
  const noCurrentWork =
    memento.latestArtifactDigest === undefined &&
    memento.verificationOutcome === undefined &&
    memento.completionBinding === undefined &&
    memento.humanDecision === undefined &&
    memento.decisionReason === undefined &&
    memento.retryEligibility === undefined;
  if (memento.status === "DRAFT")
    return (
      memento.attemptsAuthorized === 0 &&
      memento.authorizedAttemptIds.length === 0 &&
      memento.latestAttemptId === undefined &&
      memento.latestAttemptNumber === undefined &&
      memento.cancellation === undefined &&
      memento.cycleHistory.length === 0 &&
      noCurrentWork
    );
  if (
    !memento.workContract ||
    memento.attemptsAuthorized < 1 ||
    memento.attemptsAuthorized > memento.attemptBudget ||
    memento.authorizedAttemptIds.length !== memento.attemptsAuthorized ||
    memento.latestAttemptNumber !== memento.attemptsAuthorized ||
    memento.latestAttemptId !==
      memento.authorizedAttemptIds[memento.attemptsAuthorized - 1] ||
    (memento.humanDecision !== undefined) !==
      (memento.decisionReason !== undefined) ||
    (memento.decisionReason !== undefined &&
      (memento.decisionReason.length < 1 ||
        memento.decisionReason.length > 2000)) ||
    (memento.status === "CANCELLED") !== (memento.cancellation !== undefined) ||
    (memento.status !== "NEEDS_HUMAN_DECISION" &&
      memento.retryEligibility !== undefined)
  )
    return false;
  const currentCycle: MissionCycleAudit = {
    attemptId: memento.latestAttemptId!,
    attemptNumber: memento.latestAttemptNumber!,
    ...(memento.latestArtifactDigest
      ? { artifactDigest: memento.latestArtifactDigest }
      : {}),
    ...(memento.verificationOutcome
      ? { verificationOutcome: memento.verificationOutcome }
      : {}),
    ...(memento.completionBinding
      ? { completionBinding: memento.completionBinding }
      : {}),
    ...(memento.humanDecision ? { humanDecision: memento.humanDecision } : {}),
    ...(memento.decisionReason
      ? { decisionReason: memento.decisionReason }
      : {}),
    ...(memento.retryEligibility
      ? { retryReason: memento.retryEligibility }
      : {}),
  };
  const artifact = memento.latestArtifactDigest;
  const outcome = memento.verificationOutcome;
  const completion = memento.completionBinding;
  if (
    ((outcome !== undefined || completion !== undefined) && !artifact) ||
    (outcome !== undefined &&
      (outcome.attemptId !== memento.latestAttemptId ||
        outcome.binding.missionId !== memento.missionId ||
        outcome.binding.missionRevision !== memento.missionRevision ||
        outcome.binding.startingRevision !== memento.draft.startingRevision ||
        !artifact ||
        !sameDigest(outcome.binding.artifactDigest, artifact) ||
        !sameDigest(
          outcome.binding.gateSetDigest,
          memento.workContract.gateSetDigest,
        ))) ||
    (completion !== undefined &&
      (!outcome ||
        outcome.kind !== "VERDICT" ||
        !artifact ||
        !completionMatchesOutcome(
          completion,
          outcome,
          artifact,
          memento.workContract.gateSetDigest,
          memento.missionRevision,
        )))
  )
    return false;
  switch (memento.status) {
    case "OPEN":
    case "ATTEMPT_RUNNING":
      if (!noCurrentWork) return false;
      break;
    case "VERIFICATION_RUNNING":
      if (
        !artifact ||
        completion ||
        memento.humanDecision ||
        memento.decisionReason ||
        memento.retryEligibility ||
        outcome?.kind === "ABORTED"
      )
        return false;
      break;
    case "COMPLETION_REVIEW":
      if (
        !artifact ||
        outcome?.kind !== "VERDICT" ||
        outcome.verdict !== "PASSED" ||
        completion?.recommendation !== "APPROVE" ||
        memento.humanDecision ||
        memento.decisionReason ||
        memento.retryEligibility
      )
        return false;
      break;
    case "NEEDS_HUMAN_DECISION": {
      const attemptFailure =
        !artifact &&
        !outcome &&
        !completion &&
        !memento.humanDecision &&
        (memento.retryEligibility === "ATTEMPT_EXPIRED" ||
          memento.retryEligibility === "ATTEMPT_FAILED");
      const aborted =
        artifact !== undefined &&
        outcome?.kind === "ABORTED" &&
        !completion &&
        !memento.humanDecision &&
        (outcome.retryable && outcome.reason !== "MISSION_CANCELLED"
          ? memento.retryEligibility === "VERIFICATION_ABORTED"
          : memento.retryEligibility === undefined);
      const revision =
        outcome?.kind === "VERDICT" &&
        outcome.verdict === "FAILED" &&
        completion?.recommendation === "REQUEST_REVISION" &&
        !memento.humanDecision &&
        memento.retryEligibility === "REVISION_REQUESTED";
      const rejected =
        outcome?.kind === "VERDICT" &&
        completion !== undefined &&
        memento.humanDecision === "REJECTED" &&
        memento.retryEligibility === "HUMAN_AUTHORIZED";
      if (!attemptFailure && !aborted && !revision && !rejected) return false;
      break;
    }
    case "COMPLETED":
      if (
        !artifact ||
        outcome?.kind !== "VERDICT" ||
        outcome.verdict !== "PASSED" ||
        completion?.recommendation !== "APPROVE" ||
        memento.humanDecision !== "APPROVED" ||
        !memento.decisionReason ||
        memento.retryEligibility
      )
        return false;
      break;
    case "CANCELLED":
      if (
        memento.humanDecision === "APPROVED" ||
        (memento.humanDecision !== undefined && !completion) ||
        (memento.decisionReason !== undefined && !completion)
      )
        return false;
      break;
  }
  const expectedHistoryLength =
    memento.status === "COMPLETED"
      ? memento.attemptsAuthorized
      : memento.attemptsAuthorized - 1;
  if (memento.cycleHistory.length !== expectedHistoryLength) return false;
  const runIds = new Set<string>();
  for (let index = 0; index < memento.cycleHistory.length; index += 1) {
    const cycle = memento.cycleHistory[index]!;
    if (
      cycle.attemptNumber !== index + 1 ||
      cycle.attemptId !== memento.authorizedAttemptIds[index] ||
      !cycleChainValid(cycle, memento)
    )
      return false;
    if (cycle.verificationOutcome) {
      if (runIds.has(cycle.verificationOutcome.verificationRunId)) return false;
      runIds.add(cycle.verificationOutcome.verificationRunId);
    }
  }
  if (
    outcome &&
    memento.status !== "COMPLETED" &&
    runIds.has(outcome.verificationRunId)
  )
    return false;
  if (
    memento.status === "COMPLETED" &&
    canonicalize(memento.cycleHistory.at(-1)) !== canonicalize(currentCycle)
  )
    return false;
  return true;
}

export class Mission {
  readonly #state: MutableMissionState;

  private constructor(state: MutableMissionState) {
    this.#state = state;
  }

  static draft(command: DraftMission): MissionResult<Mission> {
    if (!isDraftMission(command))
      return error("INVALID_MISSION", "Mission draft is invalid.");
    try {
      new URL(command.workspaceReference);
    } catch {
      return error("INVALID_MISSION", "Workspace reference must be a URI.");
    }
    return applied(
      new Mission({
        missionId: command.missionId,
        missionRevision: command.missionRevision,
        status: "DRAFT",
        attemptBudget: command.attemptBudget,
        attemptsAuthorized: 0,
        draft: {
          objective: command.objective,
          startingRevision: command.startingRevision,
          workspaceReference: command.workspaceReference,
          allowedScope: Object.freeze({
            pathPatterns: Object.freeze([...command.allowedScope.pathPatterns]),
          }),
          requestedCapabilities: Object.freeze([
            ...command.requestedCapabilities,
          ]),
        },
        authorizedAttemptIds: new Set(),
        cycleHistory: [],
      }),
    );
  }

  get snapshot(): MissionSnapshot {
    const snapshot: MissionSnapshot = {
      missionId: this.#state.missionId,
      missionRevision: this.#state.missionRevision,
      status: this.#state.status,
      attemptBudget: this.#state.attemptBudget,
      attemptsAuthorized: this.#state.attemptsAuthorized,
      ...(this.#state.workContract
        ? { workContract: this.#state.workContract }
        : {}),
      ...(this.#state.latestAttemptId
        ? { latestAttemptId: this.#state.latestAttemptId }
        : {}),
      ...(this.#state.latestAttemptNumber
        ? { latestAttemptNumber: this.#state.latestAttemptNumber }
        : {}),
      ...(this.#state.latestArtifactDigest
        ? { latestArtifactDigest: copyDigest(this.#state.latestArtifactDigest) }
        : {}),
      ...(this.#state.latestVerificationRunId
        ? { latestVerificationRunId: this.#state.latestVerificationRunId }
        : {}),
      ...(this.#state.latestVerdict
        ? { latestVerdict: this.#state.latestVerdict }
        : {}),
      ...(this.#state.latestEvidenceBundleDigest
        ? {
            latestEvidenceBundleDigest: copyDigest(
              this.#state.latestEvidenceBundleDigest,
            ),
          }
        : {}),
      ...(this.#state.completionBinding
        ? { completionBinding: this.#state.completionBinding }
        : {}),
      ...(this.#state.humanDecision
        ? { humanDecision: this.#state.humanDecision }
        : {}),
      ...(this.#state.decisionReason
        ? { decisionReason: this.#state.decisionReason }
        : {}),
      ...(this.#state.cancellation
        ? { cancellation: Object.freeze({ ...this.#state.cancellation }) }
        : {}),
      cycleHistory: Object.freeze(this.#state.cycleHistory.map(copyCycleAudit)),
    };
    return Object.freeze(snapshot);
  }

  defineAcceptanceGates(
    command: DefineAcceptanceGates,
  ): MissionResult<MissionSnapshot> {
    if (!isDefineAcceptanceGates(command))
      return error("INVALID_MISSION", "At least one valid gate is required.");
    if (this.#state.status !== "DRAFT" || this.#state.workContract)
      return error(
        "REQUIREMENTS_IMMUTABLE",
        "Acceptance gates cannot change after they are defined.",
      );
    const ids = command.acceptanceGates.map((gate) => gate.gateId);
    if (new Set(ids).size !== ids.length)
      return error("DUPLICATE_GATE", "Gate IDs must be unique.");
    const derived = calculateGateSetDigest(command.acceptanceGates);
    if (!sameDigest(derived, command.gateSetDigest))
      return error(
        "GATE_SET_DIGEST_MISMATCH",
        "Gate-set digest does not bind the supplied gates.",
      );
    this.#state.workContract = freezeWorkContract({
      ...this.#state.draft,
      acceptanceGates: command.acceptanceGates,
      gateSetDigest: command.gateSetDigest,
    });
    return applied(this.snapshot);
  }

  open(command: OpenMission): MissionResult<MissionOpenedResult> {
    if (!isOpenMission(command))
      return error("INVALID_MISSION", "Attempt identity is invalid.");
    if (this.#state.status !== "DRAFT")
      return error("UNSUPPORTED_TRANSITION", "Only a draft can be opened.");
    if (!this.#state.workContract || !isIdentifier(command.attemptId))
      return error(
        "INVALID_MISSION",
        "A complete mission and attempt ID are required.",
      );
    this.#state.status = "OPEN";
    this.#state.attemptsAuthorized = 1;
    this.#state.latestAttemptId = command.attemptId;
    this.#state.latestAttemptNumber = 1;
    this.#state.authorizedAttemptIds.add(command.attemptId);
    const event: MissionDomainEvent = Object.freeze({
      kind: "MISSION_OPENED",
      missionId: this.#state.missionId,
      missionRevision: this.#state.missionRevision,
      workContract: this.#state.workContract,
      attemptBudget: this.#state.attemptBudget,
    });
    return applied(
      {
        snapshot: this.snapshot,
        processSeed: Object.freeze({
          missionId: this.#state.missionId,
          missionRevision: this.#state.missionRevision,
          workContract: this.#state.workContract,
          attemptBudget: this.#state.attemptBudget,
          attemptsAuthorized: 1,
          attemptId: command.attemptId,
          attemptNumber: 1,
        }),
      },
      [event],
    );
  }

  authorizeAnotherAttempt(
    command: AuthorizeAnotherAttempt,
  ): MissionResult<MissionSnapshot> {
    if (!isAuthorizeAnotherAttempt(command))
      return error("INVALID_MISSION", "Retry authorization is invalid.");
    const terminal = this.#terminalError();
    if (terminal) return terminal;
    if (this.#state.status !== "NEEDS_HUMAN_DECISION")
      return error(
        "UNSUPPORTED_TRANSITION",
        "Only an explicitly retry-eligible mission can authorize another attempt.",
      );
    if (!isIdentifier(command.attemptId))
      return error("INVALID_MISSION", "Attempt ID is invalid.");
    if (
      command.feedback !== undefined &&
      (command.feedback.length < 1 || command.feedback.length > 2000)
    )
      return error("INVALID_MISSION", "Retry feedback is invalid.");
    if (this.#state.authorizedAttemptIds.has(command.attemptId))
      return error(
        "UNSUPPORTED_TRANSITION",
        "Attempt ID was already authorized.",
      );
    if (
      !this.#state.retryEligibility ||
      command.reason !== this.#state.retryEligibility
    )
      return error(
        "UNSUPPORTED_TRANSITION",
        "Retry reason does not match the recorded retry eligibility.",
      );
    if (this.#state.attemptsAuthorized >= this.#state.attemptBudget) {
      return error("ATTEMPT_BUDGET_EXHAUSTED", "No bounded attempt remains.");
    }
    const nextAttemptNumber = this.#state.attemptsAuthorized + 1;
    this.#archiveCurrentCycle();
    this.#resetCurrentCycle();
    this.#state.attemptsAuthorized = nextAttemptNumber;
    this.#state.latestAttemptId = command.attemptId;
    this.#state.latestAttemptNumber = nextAttemptNumber;
    this.#state.authorizedAttemptIds.add(command.attemptId);
    this.#state.status = "OPEN";
    const event: MissionDomainEvent = Object.freeze({
      kind: "MISSION_RETRY_AUTHORIZED",
      missionId: this.#state.missionId,
      missionRevision: this.#state.missionRevision,
      nextAttemptNumber,
      attemptBudget: this.#state.attemptBudget,
      reason: command.reason,
      ...(command.feedback ? { feedback: command.feedback } : {}),
    });
    return applied(this.snapshot, [event]);
  }

  approveCompletion(
    command: ApproveMissionCompletion,
  ): MissionResult<MissionSnapshot> {
    if (!isApproveMissionCompletion(command))
      return error("INVALID_MISSION", "Completion approval is invalid.");
    const terminal = this.#terminalError();
    if (terminal) return terminal;
    if (!isIdentifier(command.decidedBy))
      return error("INVALID_MISSION", "Approving actor ID is invalid.");
    const bindingError = this.#completionBindingError(command);
    if (bindingError) return bindingError;
    if (this.#state.humanDecision)
      return error(
        "COMPLETION_REVIEW_ALREADY_DECIDED",
        "Completion review already has a human decision.",
      );
    if (
      this.#state.status !== "COMPLETION_REVIEW" ||
      this.#state.latestVerdict !== "PASSED" ||
      command.recommendation !== "APPROVE"
    )
      return error(
        "VERIFICATION_NOT_PASSED",
        "Approval requires the exact passing APPROVE review.",
      );
    const exactBinding = copyCompletionBinding(this.#state.completionBinding!);
    this.#state.status = "COMPLETED";
    this.#state.humanDecision = "APPROVED";
    this.#state.decisionReason = `Approved by ${command.decidedBy}`;
    this.#archiveCurrentCycle();
    const event: MissionDomainEvent = Object.freeze({
      kind: "MISSION_COMPLETED",
      missionId: this.#state.missionId,
      missionRevision: this.#state.missionRevision,
      binding: Object.freeze({ ...exactBinding, recommendation: "APPROVE" }),
      approvedBy: command.decidedBy,
    });
    return applied(this.snapshot, [event]);
  }

  rejectCompletion(
    command: RejectMissionCompletion,
  ): MissionResult<MissionSnapshot> {
    if (!isRejectMissionCompletion(command))
      return error("INVALID_MISSION", "Completion rejection is invalid.");
    const terminal = this.#terminalError();
    if (terminal) return terminal;
    if (!isIdentifier(command.decidedBy))
      return error("INVALID_MISSION", "Rejecting actor ID is invalid.");
    const bindingError = this.#completionBindingError(command);
    if (bindingError) return bindingError;
    if (this.#state.humanDecision)
      return error(
        "COMPLETION_REVIEW_ALREADY_DECIDED",
        "Completion review already has a human decision.",
      );
    if (command.reason.length === 0 || command.reason.length > 2000)
      return error(
        "INVALID_MISSION",
        "A bounded rejection reason is required.",
      );
    if (command.authorizeAnotherAttempt) {
      if (!command.nextAttemptId || !isIdentifier(command.nextAttemptId))
        return error("INVALID_MISSION", "The next attempt ID is required.");
      if (this.#state.attemptsAuthorized >= this.#state.attemptBudget)
        return error(
          "ATTEMPT_BUDGET_EXHAUSTED",
          "Rejection cannot exceed the attempt budget.",
        );
      if (this.#state.authorizedAttemptIds.has(command.nextAttemptId))
        return error(
          "UNSUPPORTED_TRANSITION",
          "The next attempt ID was already authorized.",
        );
    }
    this.#state.humanDecision = "REJECTED";
    this.#state.decisionReason = command.reason;
    if (!command.authorizeAnotherAttempt) {
      this.#state.status = "NEEDS_HUMAN_DECISION";
      this.#state.retryEligibility = "HUMAN_AUTHORIZED";
      return applied(this.snapshot);
    }
    const nextAttemptNumber = this.#state.attemptsAuthorized + 1;
    const nextAttemptId = command.nextAttemptId;
    if (!nextAttemptId)
      return error("INVALID_MISSION", "The next attempt ID is required.");
    this.#state.retryEligibility = "HUMAN_AUTHORIZED";
    this.#archiveCurrentCycle();
    this.#resetCurrentCycle();
    this.#state.attemptsAuthorized = nextAttemptNumber;
    this.#state.latestAttemptId = nextAttemptId;
    this.#state.latestAttemptNumber = nextAttemptNumber;
    this.#state.authorizedAttemptIds.add(nextAttemptId);
    this.#state.status = "OPEN";
    const event: MissionDomainEvent = Object.freeze({
      kind: "MISSION_RETRY_AUTHORIZED",
      missionId: this.#state.missionId,
      missionRevision: this.#state.missionRevision,
      nextAttemptNumber,
      attemptBudget: this.#state.attemptBudget,
      reason: "HUMAN_AUTHORIZED",
      feedback: command.reason,
    });
    return applied(this.snapshot, [event]);
  }

  cancel(command: CancelMission): MissionResult<MissionSnapshot> {
    if (!isCancelMission(command))
      return error("INVALID_MISSION", "Cancellation is invalid.");
    if (command.missionRevision !== this.#state.missionRevision)
      return error("STALE_MISSION_REVISION", "Mission revision is stale.");
    const terminal = this.#terminalError();
    if (terminal) return terminal;
    if (this.#state.status === "DRAFT")
      return error(
        "UNSUPPORTED_TRANSITION",
        "A draft mission cannot be cancelled before it is opened.",
      );
    if (
      !isIdentifier(command.cancelledBy) ||
      command.reason.length === 0 ||
      command.reason.length > 1000
    )
      return error("INVALID_MISSION", "Cancellation is invalid.");
    this.#state.status = "CANCELLED";
    this.#state.retryEligibility = undefined;
    this.#state.cancellation = {
      cancelledBy: command.cancelledBy,
      reason: command.reason,
    };
    const event: MissionDomainEvent = Object.freeze({
      kind: "MISSION_CANCELLED",
      missionId: this.#state.missionId,
      missionRevision: this.#state.missionRevision,
      cancelledBy: command.cancelledBy,
      reason: command.reason,
    });
    return applied(this.snapshot, [event]);
  }

  recordAttemptLeased(
    fact: RecordAttemptLeased,
  ): MissionResult<MissionSnapshot> {
    if (!isRecordAttemptLeased(fact))
      return error("INVALID_MISSION", "Attempt lease fact is invalid.");
    const revisionError = this.#revisionError(fact.missionRevision);
    if (revisionError) return revisionError;
    const terminal = this.#terminalError();
    if (terminal) return terminal;
    if (
      fact.attemptId === this.#state.latestAttemptId &&
      fact.attemptNumber === this.#state.latestAttemptNumber &&
      this.#state.status === "ATTEMPT_RUNNING"
    )
      return idempotent(this.snapshot);
    if (
      this.#state.status !== "OPEN" ||
      fact.attemptId !== this.#state.latestAttemptId ||
      fact.attemptNumber !== this.#state.latestAttemptNumber
    )
      return error(
        "UNSUPPORTED_TRANSITION",
        "Attempt lease is stale or unexpected.",
      );
    this.#state.status = "ATTEMPT_RUNNING";
    return applied(this.snapshot);
  }

  recordAttemptEnded(fact: RecordAttemptEnded): MissionResult<MissionSnapshot> {
    if (!isRecordAttemptEnded(fact))
      return error("INVALID_MISSION", "Attempt outcome fact is invalid.");
    const revisionError = this.#revisionError(fact.missionRevision);
    if (revisionError) return revisionError;
    if (
      this.#state.status === "CANCELLED" &&
      fact.outcome === "REVOKED" &&
      fact.attemptId === this.#state.latestAttemptId
    )
      return idempotent(this.snapshot);
    const terminal = this.#terminalError();
    if (terminal) return terminal;
    if (fact.attemptId !== this.#state.latestAttemptId)
      return ignored(this.snapshot);
    if (fact.outcome === "ARTIFACT_SUBMITTED") return idempotent(this.snapshot);
    if (
      this.#state.status !== "ATTEMPT_RUNNING" &&
      this.#state.status !== "OPEN"
    )
      return error("UNSUPPORTED_TRANSITION", "Attempt outcome is unexpected.");
    this.#state.status = "NEEDS_HUMAN_DECISION";
    this.#state.retryEligibility =
      fact.outcome === "LEASE_EXPIRED" ? "ATTEMPT_EXPIRED" : "ATTEMPT_FAILED";
    return applied(this.snapshot);
  }

  recordArtifactSubmitted(
    fact: RecordArtifactSubmitted,
  ): MissionResult<MissionSnapshot> {
    if (!isRecordArtifactSubmitted(fact))
      return error("INVALID_MISSION", "Artifact fact is invalid.");
    const revisionError = this.#revisionError(fact.missionRevision);
    if (revisionError) return revisionError;
    const bindingError = this.#workBindingError(
      fact.startingRevision,
      fact.gateSetDigest,
    );
    if (bindingError) return bindingError;
    const terminal = this.#terminalError();
    if (terminal) return terminal;
    if (
      fact.attemptId === this.#state.latestAttemptId &&
      this.#state.latestArtifactDigest
    ) {
      if (sameDigest(fact.artifactDigest, this.#state.latestArtifactDigest))
        return idempotent(this.snapshot);
      return error(
        "UNSUPPORTED_TRANSITION",
        "A different artifact is already bound to this attempt.",
      );
    }
    if (
      fact.attemptId !== this.#state.latestAttemptId ||
      !["OPEN", "ATTEMPT_RUNNING"].includes(this.#state.status)
    )
      return error("UNSUPPORTED_TRANSITION", "Artifact submission is stale.");
    if (!isDigest(fact.artifactDigest))
      return error("INVALID_MISSION", "Artifact digest is invalid.");
    this.#state.latestArtifactDigest = copyDigest(fact.artifactDigest);
    this.#state.retryEligibility = undefined;
    this.#state.status = "VERIFICATION_RUNNING";
    return applied(this.snapshot);
  }

  recordVerificationVerdict(
    fact: RecordVerificationVerdict,
  ): MissionResult<MissionSnapshot> {
    if (!isRecordVerificationVerdict(fact))
      return error("INVALID_MISSION", "Verification verdict is invalid.");
    const candidate: VerificationOutcome = Object.freeze({
      kind: "VERDICT",
      attemptId: fact.attemptId,
      verificationRunId: fact.verificationRunId,
      binding: copyVerificationBinding(fact.binding),
      verdict: fact.verdict,
      evidenceBundleDigest: copyDigest(fact.evidenceBundleDigest),
    });
    const recorded = this.#verificationOutcomeForRun(fact.verificationRunId);
    if (recorded)
      return sameVerificationOutcome(recorded, candidate)
        ? idempotent(this.snapshot)
        : error(
            "CONFLICTING_VERIFICATION_FACT",
            "A terminal verification outcome is already bound to this cycle.",
          );
    if (this.#state.verificationOutcome)
      return error(
        "CONFLICTING_VERIFICATION_FACT",
        "A terminal verification outcome is already bound to this cycle.",
      );
    const bindingError = this.#verificationBindingError(fact.binding);
    if (bindingError) return bindingError;
    const terminal = this.#terminalError();
    if (terminal) return terminal;
    if (
      this.#state.status !== "VERIFICATION_RUNNING" ||
      fact.attemptId !== this.#state.latestAttemptId ||
      !isIdentifier(fact.verificationRunId) ||
      !isDigest(fact.evidenceBundleDigest)
    )
      return error(
        "UNSUPPORTED_TRANSITION",
        "Verification verdict is unexpected.",
      );
    this.#state.latestVerificationRunId = fact.verificationRunId;
    this.#state.latestVerdict = fact.verdict;
    this.#state.latestEvidenceBundleDigest = copyDigest(
      fact.evidenceBundleDigest,
    );
    this.#state.verificationOutcome = candidate;
    return applied(this.snapshot);
  }

  recordVerificationAborted(
    fact: RecordVerificationAborted,
  ): MissionResult<MissionSnapshot> {
    if (!isRecordVerificationAborted(fact))
      return error("INVALID_MISSION", "Verification abort is invalid.");
    const candidate: VerificationOutcome = Object.freeze({
      kind: "ABORTED",
      attemptId: fact.attemptId,
      verificationRunId: fact.verificationRunId,
      binding: copyVerificationBinding(fact.binding),
      reason: fact.reason,
      retryable: fact.retryable,
    });
    const recorded = this.#verificationOutcomeForRun(fact.verificationRunId);
    if (recorded)
      return sameVerificationOutcome(recorded, candidate)
        ? idempotent(this.snapshot)
        : error(
            "CONFLICTING_VERIFICATION_FACT",
            "A terminal verification outcome is already bound to this cycle.",
          );
    if (this.#state.verificationOutcome)
      return error(
        "CONFLICTING_VERIFICATION_FACT",
        "A terminal verification outcome is already bound to this cycle.",
      );
    const bindingError = this.#verificationBindingError(fact.binding);
    if (bindingError) return bindingError;
    if (this.#state.status === "CANCELLED") {
      if (
        fact.reason !== "MISSION_CANCELLED" ||
        fact.retryable !== false ||
        fact.attemptId !== this.#state.latestAttemptId ||
        !isIdentifier(fact.verificationRunId)
      )
        return error(
          "CONFLICTING_VERIFICATION_FACT",
          "A cancelled mission only accepts its exact bound non-retryable cancellation abort.",
        );
      this.#state.latestVerificationRunId = fact.verificationRunId;
      this.#state.verificationOutcome = candidate;
      return applied(this.snapshot);
    }
    const terminal = this.#terminalError();
    if (terminal) return terminal;
    if (
      this.#state.status !== "VERIFICATION_RUNNING" ||
      fact.attemptId !== this.#state.latestAttemptId
    )
      return error(
        "UNSUPPORTED_TRANSITION",
        "Verification abort is unexpected.",
      );
    if (fact.reason === "MISSION_CANCELLED" && fact.retryable)
      return error(
        "INVALID_MISSION",
        "Cancellation abort cannot be retryable.",
      );
    if (!isIdentifier(fact.verificationRunId))
      return error("INVALID_MISSION", "Verification run ID is invalid.");
    this.#state.latestVerificationRunId = fact.verificationRunId;
    this.#state.verificationOutcome = candidate;
    this.#state.retryEligibility =
      fact.retryable && fact.reason !== "MISSION_CANCELLED"
        ? "VERIFICATION_ABORTED"
        : undefined;
    this.#state.status = "NEEDS_HUMAN_DECISION";
    return applied(this.snapshot);
  }

  recordReviewRecommendation(
    fact: RecordReviewRecommendation,
  ): MissionResult<MissionSnapshot> {
    if (!isRecordReviewRecommendation(fact))
      return error("INVALID_MISSION", "Review recommendation is invalid.");
    if (!isIdentifier(fact.completionReviewId))
      return error("INVALID_MISSION", "Completion review ID is invalid.");
    const bindingError = this.#verificationBindingError(fact.binding);
    if (bindingError) return bindingError;
    const terminal = this.#terminalError();
    if (terminal) return terminal;
    const expectedRecommendation =
      fact.verdict === "PASSED" ? "APPROVE" : "REQUEST_REVISION";
    if (fact.recommendation !== expectedRecommendation)
      return error(
        "UNSUPPORTED_TRANSITION",
        "Recommendation contradicts the recorded verdict.",
      );
    if (
      fact.verificationRunId !== this.#state.latestVerificationRunId ||
      fact.verdict !== this.#state.latestVerdict ||
      !this.#state.latestEvidenceBundleDigest ||
      !sameDigest(
        fact.evidenceBundleDigest,
        this.#state.latestEvidenceBundleDigest,
      )
    )
      return error("STALE_COMPLETION_BINDING", "Review evidence is stale.");
    if (
      !this.#state.verificationOutcome ||
      this.#state.verificationOutcome.kind !== "VERDICT"
    )
      return error(
        "UNSUPPORTED_TRANSITION",
        "A review requires the first recorded verification verdict.",
      );
    const completionBinding: CompletionBinding = Object.freeze({
      missionRevision: this.#state.missionRevision,
      completionReviewId: fact.completionReviewId,
      recommendation: fact.recommendation,
      verificationRunId: fact.verificationRunId,
      artifactDigest: copyDigest(fact.binding.artifactDigest),
      gateSetDigest: copyDigest(fact.binding.gateSetDigest),
      evidenceBundleDigest: copyDigest(fact.evidenceBundleDigest),
    });
    if (
      this.#state.completionBinding &&
      sameBinding(this.#state.completionBinding, completionBinding)
    )
      return idempotent(this.snapshot);
    if (this.#state.completionBinding)
      return error(
        "STALE_COMPLETION_BINDING",
        "A different completion review is already recorded.",
      );
    this.#state.completionBinding = completionBinding;
    this.#state.retryEligibility =
      fact.recommendation === "REQUEST_REVISION"
        ? "REVISION_REQUESTED"
        : undefined;
    this.#state.status =
      fact.recommendation === "APPROVE"
        ? "COMPLETION_REVIEW"
        : "NEEDS_HUMAN_DECISION";
    return applied(this.snapshot);
  }

  toMemento(): MissionMementoV1 {
    const value: MissionMementoV1 = {
      mementoType: "patchquest.mission",
      mementoVersion: 1,
      missionId: this.#state.missionId,
      missionRevision: this.#state.missionRevision,
      status: this.#state.status,
      attemptBudget: this.#state.attemptBudget,
      attemptsAuthorized: this.#state.attemptsAuthorized,
      draft: Object.freeze({
        objective: this.#state.draft.objective,
        startingRevision: this.#state.draft.startingRevision,
        workspaceReference: this.#state.draft.workspaceReference,
        allowedScope: Object.freeze({
          pathPatterns: Object.freeze([
            ...this.#state.draft.allowedScope.pathPatterns,
          ]),
        }),
        requestedCapabilities: Object.freeze([
          ...this.#state.draft.requestedCapabilities,
        ]),
      }),
      ...(this.#state.workContract
        ? { workContract: freezeWorkContract(this.#state.workContract) }
        : {}),
      ...(this.#state.latestAttemptId
        ? { latestAttemptId: this.#state.latestAttemptId }
        : {}),
      ...(this.#state.latestAttemptNumber
        ? { latestAttemptNumber: this.#state.latestAttemptNumber }
        : {}),
      ...(this.#state.latestArtifactDigest
        ? { latestArtifactDigest: copyDigest(this.#state.latestArtifactDigest) }
        : {}),
      ...(this.#state.verificationOutcome
        ? {
            verificationOutcome: copyVerificationOutcome(
              this.#state.verificationOutcome,
            ),
          }
        : {}),
      ...(this.#state.completionBinding
        ? {
            completionBinding: copyCompletionBinding(
              this.#state.completionBinding,
            ),
          }
        : {}),
      ...(this.#state.humanDecision
        ? { humanDecision: this.#state.humanDecision }
        : {}),
      ...(this.#state.decisionReason
        ? { decisionReason: this.#state.decisionReason }
        : {}),
      ...(this.#state.cancellation
        ? { cancellation: Object.freeze({ ...this.#state.cancellation }) }
        : {}),
      ...(this.#state.retryEligibility
        ? { retryEligibility: this.#state.retryEligibility }
        : {}),
      authorizedAttemptIds: Object.freeze([
        ...this.#state.authorizedAttemptIds,
      ]),
      cycleHistory: Object.freeze(this.#state.cycleHistory.map(copyCycleAudit)),
    };
    return Object.freeze(value);
  }

  static rehydrate(value: unknown): MissionResult<Mission> {
    if (
      !isRecord(value) ||
      !hasExactKeys(
        value,
        [
          "mementoType",
          "mementoVersion",
          "missionId",
          "missionRevision",
          "status",
          "attemptBudget",
          "attemptsAuthorized",
          "draft",
          "authorizedAttemptIds",
          "cycleHistory",
        ],
        [
          "workContract",
          "latestAttemptId",
          "latestAttemptNumber",
          "latestArtifactDigest",
          "verificationOutcome",
          "completionBinding",
          "humanDecision",
          "decisionReason",
          "cancellation",
          "retryEligibility",
        ],
      ) ||
      value["mementoType"] !== "patchquest.mission"
    )
      return error(
        "PERSISTENCE_MEMENTO_INVALID",
        "Mission memento type is invalid.",
      );
    if (value["mementoVersion"] !== 1)
      return error(
        "PERSISTENCE_VERSION_UNSUPPORTED",
        "Mission memento version is unsupported.",
      );
    const draft = value["draft"];
    if (
      !isRecord(draft) ||
      !isRecord(draft["allowedScope"]) ||
      !hasExactKeys(draft, [
        "objective",
        "startingRevision",
        "workspaceReference",
        "allowedScope",
        "requestedCapabilities",
      ]) ||
      !hasExactKeys(draft["allowedScope"], ["pathPatterns"]) ||
      typeof value["missionId"] !== "string" ||
      typeof value["missionRevision"] !== "number" ||
      typeof value["attemptBudget"] !== "number" ||
      typeof value["attemptsAuthorized"] !== "number" ||
      typeof draft["objective"] !== "string" ||
      typeof draft["startingRevision"] !== "string" ||
      typeof draft["workspaceReference"] !== "string" ||
      !isStringArray(draft["allowedScope"]["pathPatterns"]) ||
      !isStringArray(draft["requestedCapabilities"])
    )
      return error(
        "PERSISTENCE_MEMENTO_INVALID",
        "Mission memento is malformed.",
      );
    const drafted = Mission.draft({
      missionId: value["missionId"],
      missionRevision: value["missionRevision"],
      objective: draft["objective"],
      startingRevision: draft["startingRevision"],
      workspaceReference: draft["workspaceReference"],
      allowedScope: { pathPatterns: draft["allowedScope"]["pathPatterns"] },
      requestedCapabilities: draft["requestedCapabilities"],
      attemptBudget: value["attemptBudget"],
    });
    if (!drafted.ok)
      return error("PERSISTENCE_MEMENTO_INVALID", drafted.error.message);
    const statuses: readonly MissionStatus[] = [
      "DRAFT",
      "OPEN",
      "ATTEMPT_RUNNING",
      "VERIFICATION_RUNNING",
      "COMPLETION_REVIEW",
      "NEEDS_HUMAN_DECISION",
      "COMPLETED",
      "CANCELLED",
    ];
    const status = value["status"];
    const attemptsAuthorized = value["attemptsAuthorized"];
    const authorizedAttemptIds = value["authorizedAttemptIds"];
    if (
      typeof status !== "string" ||
      !statuses.includes(status as MissionStatus) ||
      !Number.isSafeInteger(attemptsAuthorized) ||
      attemptsAuthorized < 0 ||
      attemptsAuthorized > value["attemptBudget"] ||
      !isStringArray(authorizedAttemptIds) ||
      new Set(authorizedAttemptIds).size !== authorizedAttemptIds.length ||
      authorizedAttemptIds.length !== attemptsAuthorized ||
      !authorizedAttemptIds.every(isIdentifier)
    )
      return error(
        "PERSISTENCE_MEMENTO_INVALID",
        "Mission attempt state is inconsistent.",
      );
    const workContract = value["workContract"];
    if (status !== "DRAFT" && workContract === undefined)
      return error(
        "PERSISTENCE_MEMENTO_INVALID",
        "Mission work contract does not match its status.",
      );
    if (workContract !== undefined) {
      if (!isMissionWorkContract(workContract))
        return error(
          "PERSISTENCE_MEMENTO_INVALID",
          "Mission work contract is malformed.",
        );
      const defined = drafted.value.defineAcceptanceGates({
        acceptanceGates: workContract.acceptanceGates,
        gateSetDigest: workContract.gateSetDigest,
      });
      if (
        !defined.ok ||
        canonicalize(drafted.value.#state.draft) !==
          canonicalize({
            objective: workContract.objective,
            startingRevision: workContract.startingRevision,
            workspaceReference: workContract.workspaceReference,
            allowedScope: workContract.allowedScope,
            requestedCapabilities: workContract.requestedCapabilities,
          })
      )
        return error(
          "PERSISTENCE_MEMENTO_INVALID",
          "Mission work contract is inconsistent.",
        );
    }
    const latestAttemptId = value["latestAttemptId"];
    const latestAttemptNumber = value["latestAttemptNumber"];
    if (
      attemptsAuthorized > 0 &&
      (typeof latestAttemptId !== "string" ||
        !authorizedAttemptIds.includes(latestAttemptId) ||
        latestAttemptNumber !== attemptsAuthorized)
    )
      return error(
        "PERSISTENCE_MEMENTO_INVALID",
        "Mission current attempt is inconsistent.",
      );
    if (
      (attemptsAuthorized === 0 &&
        (status !== "DRAFT" ||
          latestAttemptId !== undefined ||
          latestAttemptNumber !== undefined)) ||
      (status !== "DRAFT" && attemptsAuthorized === 0)
    )
      return error(
        "PERSISTENCE_MEMENTO_INVALID",
        "Mission status and attempt count are inconsistent.",
      );
    const artifactDigest = value["latestArtifactDigest"];
    const outcome = value["verificationOutcome"];
    const completion = value["completionBinding"];
    if (
      (artifactDigest !== undefined && !isMissionDigest(artifactDigest)) ||
      (outcome !== undefined && !isVerificationOutcome(outcome)) ||
      (completion !== undefined && !isCompletionBinding(completion)) ||
      (outcome !== undefined &&
        (outcome.attemptId !== latestAttemptId ||
          outcome.binding.missionId !== value["missionId"] ||
          outcome.binding.missionRevision !== value["missionRevision"] ||
          outcome.binding.startingRevision !== draft["startingRevision"] ||
          !artifactDigest ||
          !sameDigest(outcome.binding.artifactDigest, artifactDigest))) ||
      (completion !== undefined &&
        (!outcome ||
          outcome.kind !== "VERDICT" ||
          completion.missionRevision !== value["missionRevision"] ||
          completion.verificationRunId !== outcome.verificationRunId ||
          !sameDigest(
            completion.evidenceBundleDigest,
            outcome.evidenceBundleDigest,
          ) ||
          !artifactDigest ||
          !sameDigest(completion.artifactDigest, artifactDigest)))
    )
      return error(
        "PERSISTENCE_MEMENTO_INVALID",
        "Mission verification state is inconsistent.",
      );
    const history = value["cycleHistory"];
    if (!isDenseJsonArray(history))
      return error(
        "PERSISTENCE_MEMENTO_INVALID",
        "Mission history is malformed.",
      );
    const retryEligibility = value["retryEligibility"];
    const retries: readonly MissionRetryReason[] = [
      "ATTEMPT_EXPIRED",
      "ATTEMPT_FAILED",
      "REVISION_REQUESTED",
      "HUMAN_AUTHORIZED",
      "VERIFICATION_ABORTED",
    ];
    if (
      retryEligibility !== undefined &&
      (typeof retryEligibility !== "string" ||
        !retries.includes(retryEligibility as MissionRetryReason))
    )
      return error(
        "PERSISTENCE_MEMENTO_INVALID",
        "Retry eligibility is invalid.",
      );
    const humanDecisionValue = value["humanDecision"];
    const decisionReasonValue = value["decisionReason"];
    if (
      decisionReasonValue !== undefined &&
      (typeof decisionReasonValue !== "string" ||
        decisionReasonValue.length < 1 ||
        decisionReasonValue.length > 2000)
    )
      return error(
        "PERSISTENCE_MEMENTO_INVALID",
        "Mission decision reason is invalid.",
      );
    if (
      (status === "COMPLETED" &&
        (humanDecisionValue !== "APPROVED" ||
          !completion ||
          completion.recommendation !== "APPROVE")) ||
      (status === "CANCELLED" && value["cancellation"] === undefined) ||
      (retryEligibility !== undefined && status !== "NEEDS_HUMAN_DECISION")
    )
      return error(
        "PERSISTENCE_MEMENTO_INVALID",
        "Mission terminal or retry state is inconsistent.",
      );
    const mission = drafted.value;
    mission.#state.status = status as MissionStatus;
    mission.#state.attemptsAuthorized = attemptsAuthorized;
    mission.#state.latestAttemptId = latestAttemptId as string | undefined;
    mission.#state.latestAttemptNumber = latestAttemptNumber as
      number | undefined;
    mission.#state.latestArtifactDigest = artifactDigest
      ? copyDigest(artifactDigest as MissionDigest)
      : undefined;
    mission.#state.verificationOutcome = outcome
      ? copyVerificationOutcome(outcome as VerificationOutcome)
      : undefined;
    if (mission.#state.verificationOutcome) {
      mission.#state.latestVerificationRunId =
        mission.#state.verificationOutcome.verificationRunId;
      if (mission.#state.verificationOutcome.kind === "VERDICT") {
        mission.#state.latestVerdict =
          mission.#state.verificationOutcome.verdict;
        mission.#state.latestEvidenceBundleDigest = copyDigest(
          mission.#state.verificationOutcome.evidenceBundleDigest,
        );
      }
    }
    mission.#state.completionBinding = completion
      ? copyCompletionBinding(completion as CompletionBinding)
      : undefined;
    const humanDecision = humanDecisionValue;
    if (
      humanDecision !== undefined &&
      humanDecision !== "APPROVED" &&
      humanDecision !== "REJECTED"
    )
      return error("PERSISTENCE_MEMENTO_INVALID", "Human decision is invalid.");
    mission.#state.humanDecision = humanDecision;
    mission.#state.decisionReason =
      typeof decisionReasonValue === "string" ? decisionReasonValue : undefined;
    const cancellation = value["cancellation"];
    if (cancellation !== undefined) {
      if (
        !isRecord(cancellation) ||
        typeof cancellation["cancelledBy"] !== "string" ||
        !isIdentifier(cancellation["cancelledBy"]) ||
        typeof cancellation["reason"] !== "string" ||
        cancellation["reason"].length < 1 ||
        cancellation["reason"].length > 1000 ||
        !hasExactKeys(cancellation, ["cancelledBy", "reason"])
      )
        return error("PERSISTENCE_MEMENTO_INVALID", "Cancellation is invalid.");
      mission.#state.cancellation = {
        cancelledBy: cancellation["cancelledBy"],
        reason: cancellation["reason"],
      };
    }
    mission.#state.retryEligibility = retryEligibility as
      MissionRetryReason | undefined;
    mission.#state.authorizedAttemptIds = new Set(authorizedAttemptIds);
    const parsedHistory: MissionCycleAudit[] = [];
    for (const item of history) {
      if (
        !isRecord(item) ||
        typeof item["attemptId"] !== "string" ||
        !isIdentifier(item["attemptId"]) ||
        !authorizedAttemptIds.includes(item["attemptId"]) ||
        typeof item["attemptNumber"] !== "number" ||
        !Number.isSafeInteger(item["attemptNumber"]) ||
        item["attemptNumber"] < 1 ||
        (item["artifactDigest"] !== undefined &&
          !isMissionDigest(item["artifactDigest"])) ||
        (item["verificationOutcome"] !== undefined &&
          !isVerificationOutcome(item["verificationOutcome"])) ||
        (item["completionBinding"] !== undefined &&
          !isCompletionBinding(item["completionBinding"])) ||
        (item["humanDecision"] !== undefined &&
          item["humanDecision"] !== "APPROVED" &&
          item["humanDecision"] !== "REJECTED") ||
        (item["decisionReason"] !== undefined &&
          typeof item["decisionReason"] !== "string") ||
        (item["retryReason"] !== undefined &&
          (typeof item["retryReason"] !== "string" ||
            !retries.includes(item["retryReason"] as MissionRetryReason))) ||
        !hasExactKeys(
          item,
          ["attemptId", "attemptNumber"],
          [
            "artifactDigest",
            "verificationOutcome",
            "completionBinding",
            "humanDecision",
            "decisionReason",
            "retryReason",
          ],
        )
      )
        return error(
          "PERSISTENCE_MEMENTO_INVALID",
          "Mission history is invalid.",
        );
      parsedHistory.push(copyCycleAudit(item as unknown as MissionCycleAudit));
    }
    const normalizedMemento: MissionMementoV1 = {
      ...(value as unknown as MissionMementoV1),
      cycleHistory: parsedHistory,
    };
    if (!missionMementoInvariant(normalizedMemento))
      return error(
        "PERSISTENCE_MEMENTO_INVALID",
        "Mission state matrix is inconsistent.",
      );
    mission.#state.cycleHistory = parsedHistory;
    if (canonicalize(mission.toMemento()) !== canonicalize(value))
      return error(
        "PERSISTENCE_MEMENTO_INVALID",
        "Mission memento is not its exact canonical projection.",
      );
    return applied(mission);
  }

  #archiveCurrentCycle(): void {
    if (!this.#state.latestAttemptId || !this.#state.latestAttemptNumber)
      return;
    const candidate: MissionCycleAudit = {
      attemptId: this.#state.latestAttemptId,
      attemptNumber: this.#state.latestAttemptNumber,
      ...(this.#state.latestArtifactDigest
        ? { artifactDigest: this.#state.latestArtifactDigest }
        : {}),
      ...(this.#state.verificationOutcome
        ? { verificationOutcome: this.#state.verificationOutcome }
        : {}),
      ...(this.#state.completionBinding
        ? { completionBinding: this.#state.completionBinding }
        : {}),
      ...(this.#state.humanDecision
        ? { humanDecision: this.#state.humanDecision }
        : {}),
      ...(this.#state.decisionReason
        ? { decisionReason: this.#state.decisionReason }
        : {}),
      ...(this.#state.retryEligibility
        ? { retryReason: this.#state.retryEligibility }
        : {}),
    };
    const existing = this.#state.cycleHistory.findIndex(
      (item) => item.attemptId === candidate.attemptId,
    );
    if (existing >= 0)
      this.#state.cycleHistory[existing] = copyCycleAudit(candidate);
    else this.#state.cycleHistory.push(copyCycleAudit(candidate));
  }

  #verificationOutcomeForRun(
    verificationRunId: string,
  ): VerificationOutcome | undefined {
    if (
      this.#state.verificationOutcome?.verificationRunId === verificationRunId
    )
      return this.#state.verificationOutcome;
    return this.#state.cycleHistory.find(
      (cycle) =>
        cycle.verificationOutcome?.verificationRunId === verificationRunId,
    )?.verificationOutcome;
  }

  #resetCurrentCycle(): void {
    this.#state.latestArtifactDigest = undefined;
    this.#state.latestVerificationRunId = undefined;
    this.#state.latestVerdict = undefined;
    this.#state.latestEvidenceBundleDigest = undefined;
    this.#state.verificationOutcome = undefined;
    this.#state.completionBinding = undefined;
    this.#state.humanDecision = undefined;
    this.#state.decisionReason = undefined;
    this.#state.retryEligibility = undefined;
  }

  #revisionError(revision: number): MissionResult<never> | undefined {
    return revision === this.#state.missionRevision
      ? undefined
      : error("STALE_MISSION_REVISION", "Mission revision is stale.");
  }

  #terminalError(): MissionResult<never> | undefined {
    return this.#state.status === "COMPLETED" ||
      this.#state.status === "CANCELLED"
      ? error("MISSION_TERMINAL", "Mission is terminal.")
      : undefined;
  }

  #workBindingError(
    startingRevision: string,
    gateSetDigest: MissionDigest,
  ): MissionResult<never> | undefined {
    const contract = this.#state.workContract;
    if (
      !contract ||
      startingRevision !== contract.startingRevision ||
      !sameDigest(gateSetDigest, contract.gateSetDigest)
    )
      return error(
        "STALE_COMPLETION_BINDING",
        "Immutable work binding is stale.",
      );
    return undefined;
  }

  #verificationBindingError(
    binding: VerificationFactBinding,
  ): MissionResult<never> | undefined {
    const revisionError = this.#revisionError(binding.missionRevision);
    if (revisionError) return revisionError;
    if (binding.missionId !== this.#state.missionId)
      return error("STALE_COMPLETION_BINDING", "Mission identity is stale.");
    const workError = this.#workBindingError(
      binding.startingRevision,
      binding.gateSetDigest,
    );
    if (workError) return workError;
    if (
      !this.#state.latestArtifactDigest ||
      !sameDigest(binding.artifactDigest, this.#state.latestArtifactDigest)
    )
      return error("STALE_COMPLETION_BINDING", "Artifact identity is stale.");
    return undefined;
  }

  #completionBindingError(
    binding: CompletionBinding,
  ): MissionResult<never> | undefined {
    const revisionError = this.#revisionError(binding.missionRevision);
    if (revisionError)
      return error(
        "STALE_COMPLETION_BINDING",
        "Human decision uses a stale mission revision.",
      );
    if (
      !this.#state.completionBinding ||
      !sameBinding(binding, this.#state.completionBinding)
    )
      return error(
        "STALE_COMPLETION_BINDING",
        "Human decision does not bind the exact completion review.",
      );
    return undefined;
  }
}
