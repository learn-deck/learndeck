import type {
  MissionCancelledV1,
  MissionCompletedV1,
  MissionOpenedV1,
  MissionRetryAuthorizedV1,
  PublicCommandV1,
} from "@patchquest/contracts";
import type { MissionMementoV1 } from "../domain/mission.js";
import type { MissionCompletionProcessMementoV1 } from "./mission-completion-process.js";

export type MissionControlOutboxMessage =
  | PublicCommandV1
  | MissionOpenedV1
  | MissionRetryAuthorizedV1
  | MissionCancelledV1
  | MissionCompletedV1;

export interface MissionRepository {
  load(missionId: string): Promise<MissionMementoV1 | undefined>;
  save(memento: MissionMementoV1): Promise<void>;
}

export interface MissionCompletionProcessRepository {
  load(
    missionId: string,
  ): Promise<MissionCompletionProcessMementoV1 | undefined>;
  save(memento: MissionCompletionProcessMementoV1): Promise<void>;
}

export interface InboxPort {
  /**
   * Declares the classification a future durable adapter must perform inside
   * its real unit-of-work transaction without marking the message processed.
   * Phase 4A provides this interface, not a transactional implementation.
   */
  classify(
    messageId: string,
    normalizedFingerprint: string,
  ): Promise<"UNSEEN" | "EXACT_REDELIVERY" | "MESSAGE_ID_CONFLICT">;

  /** Called only after business state and outgoing intent have been accepted. */
  recordProcessed(
    messageId: string,
    normalizedFingerprint: string,
  ): Promise<void>;
}

export interface OutboxPort {
  append(message: MissionControlOutboxMessage): Promise<void>;
}

export interface IdGenerator {
  nextId(
    kind: "mission" | "attempt" | "verification" | "event" | "command",
  ): string;
}

export interface ApplicationClock {
  now(): Date;
}

export interface MissionControlTransaction {
  readonly missions: MissionRepository;
  readonly processes: MissionCompletionProcessRepository;
  readonly inbox: InboxPort;
  readonly outbox: OutboxPort;
}

export interface MissionControlUnitOfWork {
  execute<Result>(
    operation: (transaction: MissionControlTransaction) => Promise<Result>,
  ): Promise<Result>;
}
