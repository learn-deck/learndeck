/** Transport-only TypeScript view of the normative PatchQuest v1 contracts. */

export type Identifier = string;
export type Revision = string;

export interface Digest {
  readonly algorithm: "sha256";
  readonly value: string;
}

export interface AllowedScope {
  readonly pathPatterns: readonly string[];
}

export type GateKind = "ALLOWED_SCOPE" | "LINT" | "TYPECHECK" | "TEST";
export type GateCommandId =
  "check-allowed-scope" | "check-lint" | "check-typecheck" | "check-tests";

export interface AcceptanceGate {
  readonly gateId: Identifier;
  readonly kind: GateKind;
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
  readonly missionId: Identifier;
  readonly missionRevision: number;
  readonly startingRevision: Revision;
  readonly artifactDigest: Digest;
  readonly gateSetDigest: Digest;
}

interface CommandEnvelope<
  Type extends string,
  Recipient extends "workshop" | "verification-and-review",
  Data,
> {
  readonly commandId: Identifier;
  readonly commandType: Type;
  readonly schemaVersion: 1;
  readonly issuedAt: string;
  readonly issuer: "mission-control";
  readonly recipient: Recipient;
  readonly subjectId: Identifier;
  readonly correlationId: Identifier;
  readonly causationId: Identifier;
  readonly data: Data;
}

interface EventEnvelope<
  Type extends string,
  Producer extends "mission-control" | "workshop" | "verification-and-review",
  Data,
> {
  readonly eventId: Identifier;
  readonly eventType: Type;
  readonly schemaVersion: 1;
  readonly occurredAt: string;
  readonly producer: Producer;
  readonly subjectId: Identifier;
  readonly correlationId: Identifier;
  readonly causationId: Identifier;
  readonly data: Data;
}

export type WorkshopCreateAttemptV1 = CommandEnvelope<
  "workshop.create-attempt.v1",
  "workshop",
  {
    readonly missionId: Identifier;
    readonly missionRevision: number;
    readonly objective: string;
    readonly startingRevision: Revision;
    readonly workspaceReference: string;
    readonly allowedScope: AllowedScope;
    readonly requestedCapabilities: readonly Identifier[];
    readonly acceptanceGates: readonly AcceptanceGate[];
    readonly gateSetDigest: Digest;
    readonly attemptId: Identifier;
    readonly attemptNumber: number;
    readonly attemptBudget: number;
  }
>;

export type VerificationStartVerificationV1 = CommandEnvelope<
  "verification.start-verification.v1",
  "verification-and-review",
  {
    readonly verificationRunId: Identifier;
    readonly attemptId: Identifier;
    readonly producingRunnerId: Identifier;
    readonly binding: VerificationBinding;
    readonly artifact: Artifact;
    readonly acceptanceGates: readonly AcceptanceGate[];
  }
>;

export type WorkshopRevokeAttemptV1 = CommandEnvelope<
  "workshop.revoke-attempt.v1",
  "workshop",
  {
    readonly missionId: Identifier;
    readonly missionRevision: number;
    readonly attemptId: Identifier;
    readonly reason: "MISSION_CANCELLED";
  }
>;

export type PublicCommandV1 =
  | WorkshopCreateAttemptV1
  | VerificationStartVerificationV1
  | WorkshopRevokeAttemptV1;

export type MissionOpenedV1 = EventEnvelope<
  "mission.opened.v1",
  "mission-control",
  {
    readonly missionId: Identifier;
    readonly missionRevision: number;
    readonly objective: string;
    readonly startingRevision: Revision;
    readonly allowedScope: AllowedScope;
    readonly requestedCapabilities: readonly Identifier[];
    readonly acceptanceGates: readonly AcceptanceGate[];
    readonly gateSetDigest: Digest;
    readonly attemptBudget: number;
  }
>;

export type MissionRetryReason =
  | "ATTEMPT_EXPIRED"
  | "ATTEMPT_FAILED"
  | "REVISION_REQUESTED"
  | "HUMAN_AUTHORIZED"
  | "VERIFICATION_ABORTED";

export type MissionRetryAuthorizedV1 = EventEnvelope<
  "mission.retry-authorized.v1",
  "mission-control",
  {
    readonly missionId: Identifier;
    readonly missionRevision: number;
    readonly nextAttemptNumber: number;
    readonly attemptBudget: number;
    readonly reason: MissionRetryReason;
    readonly feedback?: string;
  }
>;

export type MissionCancelledV1 = EventEnvelope<
  "mission.cancelled.v1",
  "mission-control",
  {
    readonly missionId: Identifier;
    readonly missionRevision: number;
    readonly cancelledBy: Identifier;
    readonly reason: string;
  }
>;

export type MissionCompletedV1 = EventEnvelope<
  "mission.completed.v1",
  "mission-control",
  {
    readonly missionId: Identifier;
    readonly missionRevision: number;
    readonly completionReviewId: Identifier;
    readonly recommendation: "APPROVE";
    readonly verificationRunId: Identifier;
    readonly artifactDigest: Digest;
    readonly gateSetDigest: Digest;
    readonly evidenceBundleDigest: Digest;
    readonly approvedBy: Identifier;
  }
>;

export type WorkshopAttemptReadyV1 = EventEnvelope<
  "workshop.attempt-ready.v1",
  "workshop",
  {
    readonly attemptId: Identifier;
    readonly missionId: Identifier;
    readonly missionRevision: number;
    readonly startingRevision: Revision;
    readonly attemptNumber: number;
    readonly requestedCapabilities: readonly Identifier[];
  }
>;

export type WorkshopAttemptLeasedV1 = EventEnvelope<
  "workshop.attempt-leased.v1",
  "workshop",
  {
    readonly attemptId: Identifier;
    readonly runnerId: Identifier;
    readonly leaseId: Identifier;
    readonly runnerCapabilities: readonly Identifier[];
    readonly expiresAt: string;
  }
>;

export type WorkshopArtifactSubmittedV1 = EventEnvelope<
  "workshop.artifact-submitted.v1",
  "workshop",
  {
    readonly attemptId: Identifier;
    readonly missionId: Identifier;
    readonly missionRevision: number;
    readonly startingRevision: Revision;
    readonly runnerId: Identifier;
    readonly artifact: Artifact;
    readonly gateSetDigest: Digest;
  }
>;

export type AttemptOutcome =
  "ARTIFACT_SUBMITTED" | "ABANDONED" | "FAILED" | "LEASE_EXPIRED" | "REVOKED";

export type WorkshopAttemptEndedV1 = EventEnvelope<
  "workshop.attempt-ended.v1",
  "workshop",
  {
    readonly attemptId: Identifier;
    readonly missionId: Identifier;
    readonly missionRevision: number;
    readonly outcome: AttemptOutcome;
    readonly reason?: string;
  }
>;

export type VerificationPassedV1 = EventEnvelope<
  "verification.passed.v1",
  "verification-and-review",
  {
    readonly verificationRunId: Identifier;
    readonly attemptId: Identifier;
    readonly binding: VerificationBinding;
    readonly verifierId: Identifier;
    readonly verdict: "PASSED";
    readonly checkCount: number;
    readonly evidenceBundleDigest: Digest;
  }
>;

export type VerificationFailedV1 = EventEnvelope<
  "verification.failed.v1",
  "verification-and-review",
  {
    readonly verificationRunId: Identifier;
    readonly attemptId: Identifier;
    readonly binding: VerificationBinding;
    readonly verifierId: Identifier;
    readonly verdict: "FAILED";
    readonly checkCount: number;
    readonly failedGateIds: readonly Identifier[];
    readonly evidenceBundleDigest: Digest;
  }
>;

export type VerificationAbortReason =
  | "VERIFIER_UNAVAILABLE"
  | "WORKSPACE_UNAVAILABLE"
  | "EXECUTION_INFRASTRUCTURE_FAILURE"
  | "MISSION_CANCELLED";

export type VerificationAbortedV1 = EventEnvelope<
  "verification.aborted.v1",
  "verification-and-review",
  {
    readonly verificationRunId: Identifier;
    readonly attemptId: Identifier;
    readonly binding: VerificationBinding;
    readonly verifierId: Identifier;
    readonly outcome: "ABORTED";
    readonly reason: VerificationAbortReason;
    readonly retryable: boolean;
    readonly evidenceBundleDigest?: Digest;
    readonly detail?: string;
  }
>;

export type ReviewRecommendationIssuedV1 = EventEnvelope<
  "review.recommendation-issued.v1",
  "verification-and-review",
  {
    readonly completionReviewId: Identifier;
    readonly verificationRunId: Identifier;
    readonly binding: VerificationBinding;
    readonly verdict: "PASSED" | "FAILED";
    readonly evidenceBundleDigest: Digest;
    readonly recommendation: "APPROVE" | "REQUEST_REVISION";
    readonly reason?: string;
  }
>;

export type PublicEventV1 =
  | MissionOpenedV1
  | MissionRetryAuthorizedV1
  | MissionCancelledV1
  | MissionCompletedV1
  | WorkshopAttemptReadyV1
  | WorkshopAttemptLeasedV1
  | WorkshopArtifactSubmittedV1
  | WorkshopAttemptEndedV1
  | VerificationPassedV1
  | VerificationFailedV1
  | VerificationAbortedV1
  | ReviewRecommendationIssuedV1;

export type PublicIntegrationMessageV1 = PublicCommandV1 | PublicEventV1;

export const PUBLIC_COMMAND_TYPES_V1 = Object.freeze([
  "workshop.create-attempt.v1",
  "verification.start-verification.v1",
  "workshop.revoke-attempt.v1",
] as const satisfies readonly PublicCommandV1["commandType"][]);

export const PUBLIC_EVENT_TYPES_V1 = Object.freeze([
  "mission.opened.v1",
  "mission.retry-authorized.v1",
  "mission.cancelled.v1",
  "mission.completed.v1",
  "workshop.attempt-ready.v1",
  "workshop.attempt-leased.v1",
  "workshop.artifact-submitted.v1",
  "workshop.attempt-ended.v1",
  "verification.passed.v1",
  "verification.failed.v1",
  "verification.aborted.v1",
  "review.recommendation-issued.v1",
] as const satisfies readonly PublicEventV1["eventType"][]);

export const MISSION_RETRY_REASONS_V1 = Object.freeze([
  "ATTEMPT_EXPIRED",
  "ATTEMPT_FAILED",
  "REVISION_REQUESTED",
  "HUMAN_AUTHORIZED",
  "VERIFICATION_ABORTED",
] as const satisfies readonly MissionRetryReason[]);
