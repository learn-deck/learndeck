import type {
  AcceptanceGate,
  Artifact,
  CheckResult,
  Digest,
  VerificationBinding,
  VerificationRunMementoV1,
} from "../domain/verification-run.js";
import type { CompletionReviewMementoV1 } from "../domain/completion-review.js";
import type { VerificationPublicEvent } from "./outgoing-message-factory.js";

export interface VerificationRunRepository {
  load(
    verificationRunId: string,
  ): Promise<VerificationRunMementoV1 | undefined>;
  save(memento: VerificationRunMementoV1): Promise<void>;
}

export interface CompletionReviewRepository {
  load(
    completionReviewId: string,
  ): Promise<CompletionReviewMementoV1 | undefined>;
  /** Creates a review identity that must not already exist. */
  create(memento: CompletionReviewMementoV1): Promise<void>;
}

export type InboxClassification =
  | "UNSEEN"
  | "EXACT_REDELIVERY"
  | "MESSAGE_ID_CONFLICT"
  | "SEMANTIC_RUN_DUPLICATE"
  | "SEMANTIC_RUN_CONFLICT";

export interface InboxPort {
  classify(
    messageId: string,
    normalizedFingerprint: string,
    semanticRun?: Readonly<{
      verificationRunId: string;
      semanticFingerprint: string;
    }>,
  ): Promise<InboxClassification>;
  recordProcessed(
    messageId: string,
    normalizedFingerprint: string,
    semanticRun?: Readonly<{
      verificationRunId: string;
      semanticFingerprint: string;
    }>,
  ): Promise<void>;
}

export interface OutboxPort {
  append(message: VerificationPublicEvent): Promise<void>;
}

export interface VerificationTransaction {
  readonly runs: VerificationRunRepository;
  readonly reviews: CompletionReviewRepository;
  readonly inbox: InboxPort;
  readonly outbox: OutboxPort;
  readonly evidence: EvidenceStorePort;
  readonly bundles: EvidenceBundlePort;
}

export interface VerificationUnitOfWork {
  execute<Result>(
    operation: (transaction: VerificationTransaction) => Promise<Result>,
  ): Promise<Result>;
}

export interface AuthoritativeClock {
  now(): Date;
}

export interface VerificationIdGenerator {
  nextId(
    kind:
      | "assignment"
      | "check-result"
      | "abort"
      | "complete"
      | "completion-review"
      | "recommendation",
  ): string;
}

export type VerifierAssignment =
  | Readonly<{ kind: "ASSIGNED"; verifierId: string }>
  | Readonly<{
      kind: "UNAVAILABLE";
      verifierId: string;
      retryable: boolean;
    }>
  | Readonly<{ kind: "UNIDENTIFIED_FAILURE" }>;

export interface VerifierAssignmentPort {
  assign(
    request: Readonly<{
      verificationRunId: string;
      attemptId: string;
      producingRunnerId: string;
    }>,
  ): Promise<VerifierAssignment>;
}

export interface TrustedWorkspaceHandle {
  readonly workspaceHandleId: string;
}

export type WorkspaceMaterialization =
  | Readonly<{ kind: "AVAILABLE"; workspace: TrustedWorkspaceHandle }>
  | Readonly<{
      kind: "UNAVAILABLE";
      retryable: boolean;
      detail?: string;
      diagnostic?: string;
    }>;

/**
 * Trusted adapter seam. The application supplies only the immutable binding and
 * artifact; it never accepts a caller-selected path, checkout, or command.
 */
export interface WorkspaceMaterializerPort {
  materialize(
    request: Readonly<{ binding: VerificationBinding; artifact: Artifact }>,
  ): Promise<WorkspaceMaterialization>;
}

export type GateExecutionOutcome =
  | Readonly<{
      kind: "COMPLETED";
      status: "PASS" | "FAIL" | "TIMEOUT";
      exitCode: number | null;
      durationMs: number;
      evidence: string;
    }>
  | Readonly<{
      kind: "VERIFIER_UNAVAILABLE" | "INFRASTRUCTURE_FAILURE";
      retryable: boolean;
      detail?: string;
      diagnostic?: string;
    }>;

export interface GateExecutorPort {
  execute(
    request: Readonly<{
      verificationRunId: string;
      verifierId: string;
      workspace: TrustedWorkspaceHandle;
      gate: AcceptanceGate;
      commandId: AcceptanceGate["commandId"];
      idempotencyKey: string;
    }>,
  ): Promise<GateExecutionOutcome>;
}

export interface EvidenceStorePort {
  store(
    request: Readonly<{
      verificationRunId: string;
      gateId: string;
      checkpointKey: string;
      content: string;
      limitBytes: number;
    }>,
  ): Promise<Readonly<{ digest: Digest; bytes: number }>>;
}

export type EvidenceBundleInput =
  | Readonly<{
      kind: "VERIFICATION";
      verificationRunId: string;
      binding: VerificationBinding;
      artifact: Artifact;
      verifierId: string;
      results: readonly CheckResult[];
    }>
  | Readonly<{
      kind: "ABORT";
      verificationRunId: string;
      binding: VerificationBinding;
      artifact: Artifact;
      verifierId: string;
      reason:
        | "VERIFIER_UNAVAILABLE"
        | "WORKSPACE_UNAVAILABLE"
        | "EXECUTION_INFRASTRUCTURE_FAILURE";
      diagnostic: string;
    }>;

export interface EvidenceBundlePort {
  build(input: EvidenceBundleInput): Promise<Digest>;
}
