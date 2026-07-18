import type {
  ArtifactSubmissionReceipt,
  AttemptMementoV1,
  AttemptSnapshot,
  AttemptWorkContract,
} from "../domain/attempt.js";
import type { WorkshopPublicEvent } from "./outgoing-message-factory.js";

export interface AttemptRepository {
  load(attemptId: string): Promise<AttemptMementoV1 | undefined>;
  save(memento: AttemptMementoV1): Promise<void>;
}

export interface InboxPort {
  classify(
    messageId: string,
    normalizedFingerprint: string,
  ): Promise<"UNSEEN" | "EXACT_REDELIVERY" | "MESSAGE_ID_CONFLICT">;
  recordProcessed(
    messageId: string,
    normalizedFingerprint: string,
  ): Promise<void>;
}

export interface OutboxPort {
  append(message: WorkshopPublicEvent): Promise<void>;
}

export interface PrivateLeaseResponse {
  readonly snapshot: AttemptSnapshot;
  readonly leaseToken: string;
}

export interface LeaseResponseReplayRecord {
  readonly requestId: string;
  readonly normalizedFingerprint: string;
  readonly response: PrivateLeaseResponse;
}

/**
 * Confidential application seam. Durable adapters must encrypt and
 * access-control these records and must never log or publish the raw token.
 */
export interface LeaseResponseReplayPort {
  load(
    requestId: string,
    normalizedFingerprint: string,
  ): Promise<LeaseResponseReplayRecord | undefined>;
  save(record: LeaseResponseReplayRecord): Promise<void>;
}

export interface WorkshopTransaction {
  readonly attempts: AttemptRepository;
  readonly inbox: InboxPort;
  readonly leaseResponses: LeaseResponseReplayPort;
  readonly outbox: OutboxPort;
}

export interface WorkshopUnitOfWork {
  execute<Result>(
    operation: (transaction: WorkshopTransaction) => Promise<Result>,
  ): Promise<Result>;
}

export interface AuthoritativeClock {
  now(): Date;
}

export interface WorkshopIdGenerator {
  nextId(kind: "lease"): string;
}

export interface LeaseTokenGenerator {
  nextToken(): string;
}

/** Provider-neutral seam. No runner or model SDK type crosses this port. */
export interface RunnerPort {
  prepareLease(
    request: Readonly<{
      attemptId: string;
      leaseId: string;
      runnerId: string;
      expiresAt: string;
      workContract: AttemptWorkContract;
    }>,
  ): Promise<void>;
  recordTerminalOutcome(
    request: Readonly<{
      attempt: AttemptSnapshot;
      receipt?: ArtifactSubmissionReceipt;
    }>,
  ): Promise<void>;
}
