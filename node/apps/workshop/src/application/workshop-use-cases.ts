import {
  Attempt,
  type ArtifactSubmissionReceipt,
  type AttemptDomainEvent,
  type AttemptErrorCode,
  type AttemptSnapshot,
} from "../domain/attempt.js";
import {
  createWorkshopPublicEvent,
  type WorkshopPublicEvent,
} from "./outgoing-message-factory.js";
import type {
  AuthoritativeClock,
  LeaseTokenGenerator,
  PrivateLeaseResponse,
  WorkshopIdGenerator,
  WorkshopTransaction,
  WorkshopUnitOfWork,
} from "./ports.js";
import { normalizedContentFingerprint } from "./message-validation.js";
import {
  translateAbandonAttempt,
  translateCreateAttempt,
  translateExpireLease,
  translateFailAttempt,
  translateHeartbeat,
  translateLeaseAttempt,
  translateRevokeAttempt,
  translateSubmitArtifact,
  type PrivateRequestIdentity,
  type TranslationResult,
} from "./translators.js";

export type WorkshopApplicationErrorCode =
  | AttemptErrorCode
  | "CONTRACT_INVALID"
  | "PRIVATE_INPUT_INVALID"
  | "UNSUPPORTED_MESSAGE"
  | "MESSAGE_ID_CONFLICT"
  | "OUTGOING_MESSAGE_INVALID";

export type WorkshopApplicationResult<Value = undefined> =
  | Readonly<{
      ok: true;
      disposition: "applied" | "idempotent";
      value: Value;
      events: readonly WorkshopPublicEvent[];
    }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: WorkshopApplicationErrorCode;
        message: string;
      }>;
    }>;

function failed<Value>(
  code: WorkshopApplicationErrorCode,
  message: string,
): WorkshopApplicationResult<Value> {
  return { ok: false, error: { code, message } };
}

function translatedFailure<Value>(
  translation: Extract<TranslationResult<unknown>, { ok: false }>,
): WorkshopApplicationResult<Value> {
  return failed(translation.error.code, translation.error.message);
}

export class WorkshopUseCases {
  readonly #unitOfWork: WorkshopUnitOfWork;
  readonly #clock: AuthoritativeClock;
  readonly #ids: WorkshopIdGenerator;
  readonly #tokens: LeaseTokenGenerator;

  constructor(
    dependencies: Readonly<{
      unitOfWork: WorkshopUnitOfWork;
      clock: AuthoritativeClock;
      ids: WorkshopIdGenerator;
      tokens: LeaseTokenGenerator;
    }>,
  ) {
    this.#unitOfWork = dependencies.unitOfWork;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#tokens = dependencies.tokens;
  }

  async createAttempt(
    message: unknown,
  ): Promise<WorkshopApplicationResult<AttemptSnapshot | undefined>> {
    const translated = translateCreateAttempt(message);
    if (!translated.ok) return translatedFailure(translated);
    const input = translated.value;
    const fingerprint = normalizedContentFingerprint(input);
    return this.#unitOfWork.execute(async (transaction) => {
      const duplicate = await this.#classify<AttemptSnapshot>(
        transaction,
        input.messageId,
        fingerprint,
      );
      if (duplicate) return duplicate;
      if (await transaction.attempts.load(input.attemptId))
        return failed("ATTEMPT_ALREADY_EXISTS", "The attempt already exists.");
      const created = Attempt.create({
        messageId: input.messageId,
        correlationId: input.correlationId,
        causationId: input.causationId,
        at: input.issuedAt,
        missionId: input.missionId,
        missionRevision: input.missionRevision,
        attemptId: input.attemptId,
        attemptNumber: input.attemptNumber,
        attemptBudget: input.attemptBudget,
        workContract: input.workContract,
      });
      if (!created.ok) return failed(created.error.code, created.error.message);
      const outgoing = this.#buildEvents(
        created.events,
        created.value.snapshot,
      );
      if (!outgoing.ok) return outgoing;
      await this.#commit(
        transaction,
        created.value,
        outgoing.value,
        input.messageId,
        fingerprint,
      );
      return {
        ok: true,
        disposition: "applied",
        value: created.value.snapshot,
        events: outgoing.value,
      };
    });
  }

  async revokeAttempt(
    message: unknown,
  ): Promise<WorkshopApplicationResult<AttemptSnapshot | undefined>> {
    const translated = translateRevokeAttempt(message);
    if (!translated.ok) return translatedFailure(translated);
    const input = translated.value;
    const fingerprint = normalizedContentFingerprint(input);
    return this.#unitOfWork.execute(async (transaction) => {
      const duplicate = await this.#classify<AttemptSnapshot>(
        transaction,
        input.messageId,
        fingerprint,
      );
      if (duplicate) return duplicate;
      const loaded = await this.#load(transaction, input.attemptId);
      if (!loaded.ok) return loaded;
      const occurredAt = this.#now();
      const result = loaded.value.revoke({
        messageId: input.messageId,
        correlationId: input.correlationId,
        causationId: input.causationId,
        at: occurredAt,
        missionId: input.missionId,
        missionRevision: input.missionRevision,
        attemptId: input.attemptId,
        reason: input.reason,
      });
      if (!result.ok) return failed(result.error.code, result.error.message);
      const outgoing = this.#buildEvents(result.events, result.value);
      if (!outgoing.ok) return outgoing;
      await this.#commit(
        transaction,
        loaded.value,
        outgoing.value,
        input.messageId,
        fingerprint,
      );
      return {
        ok: true,
        disposition: result.disposition,
        value: result.value,
        events: outgoing.value,
      };
    });
  }

  async leaseAttempt(
    message: unknown,
  ): Promise<WorkshopApplicationResult<PrivateLeaseResponse | undefined>> {
    const translated = translateLeaseAttempt(message);
    if (!translated.ok) return translatedFailure(translated);
    const input = translated.value;
    const fingerprint = normalizedContentFingerprint(input);
    return this.#unitOfWork.execute(async (transaction) => {
      const classification = await transaction.inbox.classify(
        input.requestId,
        fingerprint,
      );
      if (classification === "MESSAGE_ID_CONFLICT")
        return failed(
          "MESSAGE_ID_CONFLICT",
          "A message ID was reused with different normalized content.",
        );
      if (classification === "EXACT_REDELIVERY") {
        const replay = await transaction.leaseResponses.load(
          input.requestId,
          fingerprint,
        );
        return replay
          ? {
              ok: true,
              disposition: "idempotent",
              value: replay.response,
              events: [],
            }
          : failed(
              "PERSISTENCE_MEMENTO_INVALID",
              "Committed lease response replay is missing.",
            );
      }
      const loaded = await this.#load(transaction, input.attemptId);
      if (!loaded.ok) return loaded;
      const occurredAt = this.#now();
      const result = loaded.value.lease({
        messageId: input.requestId,
        correlationId: input.correlationId,
        causationId: input.requestId,
        at: occurredAt,
        runnerId: input.runnerId,
        runnerCapabilities: input.runnerCapabilities,
        requestedLeaseSeconds: input.requestedLeaseSeconds,
        leaseId: this.#ids.nextId("lease"),
        leaseToken: this.#tokens.nextToken(),
      });
      if (!result.ok) return failed(result.error.code, result.error.message);
      const outgoing = this.#buildEvents(result.events, loaded.value.snapshot);
      if (!outgoing.ok) return outgoing;
      await this.#commit(
        transaction,
        loaded.value,
        outgoing.value,
        input.requestId,
        fingerprint,
        result.value,
      );
      return {
        ok: true,
        disposition: "applied",
        value: result.value,
        events: outgoing.value,
      };
    });
  }

  async heartbeatAttempt(
    message: unknown,
  ): Promise<WorkshopApplicationResult<AttemptSnapshot | undefined>> {
    const translated = translateHeartbeat(message);
    if (!translated.ok) return translatedFailure(translated);
    const input = translated.value;
    return this.#runPrivate(input, async (attempt, occurredAt) =>
      attempt.heartbeat({
        messageId: input.requestId,
        correlationId: input.correlationId,
        causationId: input.requestId,
        at: occurredAt,
        runnerId: input.runnerId,
        leaseToken: input.leaseToken,
      }),
    );
  }

  async submitArtifact(
    message: unknown,
  ): Promise<WorkshopApplicationResult<ArtifactSubmissionReceipt | undefined>> {
    const translated = translateSubmitArtifact(message);
    if (!translated.ok) return translatedFailure(translated);
    const input = translated.value;
    return this.#runPrivate(input, async (attempt, occurredAt) =>
      attempt.submit({
        messageId: input.requestId,
        correlationId: input.correlationId,
        causationId: input.requestId,
        at: occurredAt,
        runnerId: input.runnerId,
        leaseToken: input.leaseToken,
        missionId: input.missionId,
        missionRevision: input.missionRevision,
        attemptId: input.attemptId,
        startingRevision: input.startingRevision,
        artifact: input.artifact,
        gateSetDigest: input.gateSetDigest,
      }),
    );
  }

  async abandonAttempt(
    message: unknown,
  ): Promise<WorkshopApplicationResult<AttemptSnapshot | undefined>> {
    const translated = translateAbandonAttempt(message);
    if (!translated.ok) return translatedFailure(translated);
    const input = translated.value;
    return this.#runPrivate(input, async (attempt, occurredAt) =>
      attempt.abandon({
        messageId: input.requestId,
        correlationId: input.correlationId,
        causationId: input.requestId,
        at: occurredAt,
        runnerId: input.runnerId,
        leaseToken: input.leaseToken,
        reason: input.reason,
      }),
    );
  }

  async failAttempt(
    message: unknown,
  ): Promise<WorkshopApplicationResult<AttemptSnapshot | undefined>> {
    const translated = translateFailAttempt(message);
    if (!translated.ok) return translatedFailure(translated);
    const input = translated.value;
    return this.#runPrivate(input, async (attempt, occurredAt) =>
      attempt.fail({
        messageId: input.requestId,
        correlationId: input.correlationId,
        causationId: input.requestId,
        at: occurredAt,
        runnerId: input.runnerId,
        leaseToken: input.leaseToken,
        reason: input.reason,
      }),
    );
  }

  async expireLease(
    message: unknown,
  ): Promise<WorkshopApplicationResult<AttemptSnapshot | undefined>> {
    const translated = translateExpireLease(message);
    if (!translated.ok) return translatedFailure(translated);
    const input = translated.value;
    return this.#runPrivate(input, async (attempt, occurredAt) =>
      attempt.expire({
        messageId: input.requestId,
        correlationId: input.correlationId,
        causationId: input.requestId,
        at: occurredAt,
      }),
    );
  }

  async #runPrivate<Value>(
    input: PrivateRequestIdentity & Readonly<{ attemptId: string }>,
    action: (
      attempt: Attempt,
      occurredAt: string,
    ) => Promise<
      | Readonly<{
          ok: true;
          disposition: "applied" | "idempotent";
          value: Value;
          events: readonly AttemptDomainEvent[];
        }>
      | Readonly<{
          ok: false;
          error: Readonly<{ code: AttemptErrorCode; message: string }>;
        }>
    >,
  ): Promise<WorkshopApplicationResult<Value | undefined>> {
    const fingerprint = normalizedContentFingerprint(input);
    return this.#unitOfWork.execute(async (transaction) => {
      const duplicate = await this.#classify<Value>(
        transaction,
        input.requestId,
        fingerprint,
      );
      if (duplicate) return duplicate;
      const loaded = await this.#load(transaction, input.attemptId);
      if (!loaded.ok) return loaded;
      const occurredAt = this.#now();
      const result = await action(loaded.value, occurredAt);
      if (!result.ok) return failed(result.error.code, result.error.message);
      const outgoing = this.#buildEvents(result.events, loaded.value.snapshot);
      if (!outgoing.ok) return outgoing;
      if (result.disposition === "applied")
        await this.#commit(
          transaction,
          loaded.value,
          outgoing.value,
          input.requestId,
          fingerprint,
        );
      else
        await transaction.inbox.recordProcessed(input.requestId, fingerprint);
      return {
        ok: true,
        disposition: result.disposition,
        value: result.value,
        events: outgoing.value,
      };
    });
  }

  async #load(
    transaction: WorkshopTransaction,
    attemptId: string,
  ): Promise<WorkshopApplicationResult<Attempt>> {
    const memento = await transaction.attempts.load(attemptId);
    if (!memento)
      return failed("ATTEMPT_NOT_FOUND", "The attempt does not exist.");
    const restored = Attempt.rehydrate(memento);
    return restored.ok
      ? { ok: true, disposition: "applied", value: restored.value, events: [] }
      : failed(restored.error.code, restored.error.message);
  }

  async #classify<Value>(
    transaction: WorkshopTransaction,
    messageId: string,
    fingerprint: string,
  ): Promise<WorkshopApplicationResult<Value | undefined> | undefined> {
    const classification = await transaction.inbox.classify(
      messageId,
      fingerprint,
    );
    if (classification === "MESSAGE_ID_CONFLICT")
      return failed(
        "MESSAGE_ID_CONFLICT",
        "A message ID was reused with different normalized content.",
      );
    if (classification === "EXACT_REDELIVERY")
      return {
        ok: true,
        disposition: "idempotent",
        value: undefined,
        events: [],
      };
    return undefined;
  }

  #buildEvents(
    events: readonly AttemptDomainEvent[],
    snapshot: AttemptSnapshot,
  ): WorkshopApplicationResult<readonly WorkshopPublicEvent[]> {
    const outgoing: WorkshopPublicEvent[] = [];
    for (const event of events) {
      const created = createWorkshopPublicEvent(event, snapshot);
      if (!created.ok) return failed(created.error.code, created.error.message);
      outgoing.push(created.value);
    }
    return {
      ok: true,
      disposition: "applied",
      value: Object.freeze(outgoing),
      events: [],
    };
  }

  async #commit(
    transaction: WorkshopTransaction,
    attempt: Attempt,
    events: readonly WorkshopPublicEvent[],
    messageId: string,
    fingerprint: string,
    leaseResponse?: PrivateLeaseResponse,
  ): Promise<void> {
    for (const event of events) await transaction.outbox.append(event);
    await transaction.attempts.save(attempt.toMemento());
    if (leaseResponse)
      await transaction.leaseResponses.save({
        requestId: messageId,
        normalizedFingerprint: fingerprint,
        response: leaseResponse,
      });
    await transaction.inbox.recordProcessed(messageId, fingerprint);
  }

  #now(): string {
    return this.#clock.now().toISOString();
  }
}
