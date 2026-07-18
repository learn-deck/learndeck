import {
  canonicalizeJson,
  deepFreezeCopy,
  hasExactOwnKeys,
  hasJsonTopology,
  isJsonObject,
} from "./json-topology.js";
import {
  type Digest,
  type EventMetadata,
  type PrivateIdentity,
  type VerificationBinding,
  type VerificationVerdictEvent,
  isCanonicalVerificationInstant,
  isVerificationVerdictEvent,
} from "./verification-run.js";
import { createHash } from "node:crypto";

export type ReviewRecommendation = "APPROVE" | "REQUEST_REVISION";
export type CompletionReviewStatus = "OPEN" | "RECOMMENDED";

export interface OpenCompletionReview {
  readonly completionReviewId: string;
  readonly verdictEvent: VerificationVerdictEvent;
}

export interface IssueReviewRecommendation extends PrivateIdentity {
  readonly reason?: string;
}

export interface ReviewRecommendationEvent {
  readonly kind: "REVIEW_RECOMMENDATION_ISSUED";
  readonly metadata: EventMetadata;
  readonly completionReviewId: string;
  readonly verificationRunId: string;
  readonly binding: VerificationBinding;
  readonly verdict: "PASSED" | "FAILED";
  readonly evidenceBundleDigest: Digest;
  readonly recommendation: ReviewRecommendation;
  readonly reason?: string;
}

export type CompletionReviewErrorCode =
  | "INVALID_REVIEW"
  | "INVALID_RECOMMENDATION"
  | "RECOMMENDATION_CONFLICT"
  | "REVIEW_TERMINAL"
  | "TRANSITION_CHRONOLOGY_INVALID"
  | "MESSAGE_ID_CONFLICT"
  | "PERSISTENCE_MEMENTO_INVALID"
  | "PERSISTENCE_VERSION_UNSUPPORTED";

export type CompletionReviewResult<Value> =
  | Readonly<{
      ok: true;
      disposition: "applied" | "idempotent";
      value: Value;
      events: readonly ReviewRecommendationEvent[];
    }>
  | Readonly<{
      ok: false;
      error: Readonly<{ code: CompletionReviewErrorCode; message: string }>;
    }>;

export interface CompletionReviewMementoV1 {
  readonly mementoType: "patchquest.completion-review";
  readonly mementoVersion: 1;
  readonly status: CompletionReviewStatus;
  readonly seed: OpenCompletionReview;
  readonly recommendation: ReviewRecommendation;
  readonly issue?: IssueReviewRecommendation;
  readonly recommendationEvent?: ReviewRecommendationEvent;
}

export interface CompletionReviewSnapshot {
  readonly completionReviewId: string;
  readonly status: CompletionReviewStatus;
  readonly verificationRunId: string;
  readonly attemptId: string;
  readonly binding: VerificationBinding;
  readonly verdict: "PASSED" | "FAILED";
  readonly evidenceBundleDigest: Digest;
  readonly recommendation: ReviewRecommendation;
  readonly reason?: string;
}

interface MutableState {
  status: CompletionReviewStatus;
  seed: OpenCompletionReview;
  recommendation: ReviewRecommendation;
  issue?: IssueReviewRecommendation | undefined;
  recommendationEvent?: ReviewRecommendationEvent | undefined;
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function failure<Value>(
  code: CompletionReviewErrorCode,
  message: string,
): CompletionReviewResult<Value> {
  return { ok: false, error: { code, message } };
}

function success<Value>(
  disposition: "applied" | "idempotent",
  value: Value,
  events: readonly ReviewRecommendationEvent[] = [],
): CompletionReviewResult<Value> {
  return { ok: true, disposition, value, events: Object.freeze([...events]) };
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function isBoundedReason(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 2000;
}

function isIssue(value: unknown): value is IssueReviewRecommendation {
  return (
    isJsonObject(value) &&
    hasExactOwnKeys(value, ["requestId", "at"], ["reason"]) &&
    isIdentifier(value["requestId"]) &&
    isCanonicalVerificationInstant(value["at"]) &&
    (value["reason"] === undefined || isBoundedReason(value["reason"])) &&
    hasJsonTopology(value)
  );
}

function derivedRecommendation(
  verdict: "PASSED" | "FAILED",
): ReviewRecommendation {
  return verdict === "PASSED" ? "APPROVE" : "REQUEST_REVISION";
}

function eventFor(
  state: MutableState,
  issue: IssueReviewRecommendation,
): ReviewRecommendationEvent {
  const verdict = state.seed.verdictEvent;
  return deepFreezeCopy({
    kind: "REVIEW_RECOMMENDATION_ISSUED" as const,
    metadata: {
      eventId: `event:${createHash("sha256")
        .update(`${state.seed.completionReviewId}:REVIEW_RECOMMENDATION_ISSUED`)
        .digest("hex")}`,
      occurredAt: issue.at,
      correlationId: verdict.metadata.correlationId,
      causationId: verdict.metadata.eventId,
    },
    completionReviewId: state.seed.completionReviewId,
    verificationRunId: verdict.verificationRunId,
    binding: verdict.binding,
    verdict: verdict.verdict,
    evidenceBundleDigest: verdict.evidenceBundleDigest,
    recommendation: state.recommendation,
    ...(issue.reason ? { reason: issue.reason } : {}),
  });
}

export class CompletionReview {
  readonly #state: MutableState;

  private constructor(state: MutableState) {
    this.#state = state;
  }

  static open(
    input: OpenCompletionReview,
  ): CompletionReviewResult<CompletionReview> {
    if (
      !isJsonObject(input) ||
      !hasExactOwnKeys(input, ["completionReviewId", "verdictEvent"]) ||
      !isIdentifier(input.completionReviewId) ||
      !isVerificationVerdictEvent(input.verdictEvent) ||
      [
        input.verdictEvent.metadata.eventId,
        input.verdictEvent.verificationRunId,
        input.verdictEvent.attemptId,
      ].includes(input.completionReviewId) ||
      !hasJsonTopology(input)
    )
      return failure(
        "INVALID_REVIEW",
        "Completion review input must contain an exact verdict event.",
      );
    const seed = deepFreezeCopy(input);
    return success(
      "applied",
      new CompletionReview({
        status: "OPEN",
        seed,
        recommendation: derivedRecommendation(seed.verdictEvent.verdict),
      }),
    );
  }

  get snapshot(): CompletionReviewSnapshot {
    const verdict = this.#state.seed.verdictEvent;
    return deepFreezeCopy({
      completionReviewId: this.#state.seed.completionReviewId,
      status: this.#state.status,
      verificationRunId: verdict.verificationRunId,
      attemptId: verdict.attemptId,
      binding: verdict.binding,
      verdict: verdict.verdict,
      evidenceBundleDigest: verdict.evidenceBundleDigest,
      recommendation: this.#state.recommendation,
      ...(this.#state.issue?.reason
        ? { reason: this.#state.issue.reason }
        : {}),
    });
  }

  issue(
    input: IssueReviewRecommendation,
  ): CompletionReviewResult<CompletionReviewSnapshot> {
    if (!isIssue(input))
      return failure(
        "INVALID_RECOMMENDATION",
        "Recommendation input is invalid.",
      );
    if (this.#state.issue && this.#state.recommendationEvent) {
      return canonicalizeJson(input) === canonicalizeJson(this.#state.issue)
        ? success("idempotent", this.snapshot)
        : failure(
            "RECOMMENDATION_CONFLICT",
            "The immutable recommendation already differs.",
          );
    }
    if (this.#state.status !== "OPEN")
      return failure("REVIEW_TERMINAL", "A recommended review is immutable.");
    const verdict = this.#state.seed.verdictEvent;
    if (
      [
        this.#state.seed.completionReviewId,
        verdict.metadata.eventId,
        verdict.verificationRunId,
        verdict.attemptId,
      ].includes(input.requestId)
    )
      return failure(
        "MESSAGE_ID_CONFLICT",
        "Recommendation request and verdict event IDs must differ.",
      );
    if (Date.parse(input.at) < Date.parse(verdict.metadata.occurredAt))
      return failure(
        "TRANSITION_CHRONOLOGY_INVALID",
        "A recommendation cannot predate its verdict.",
      );
    const issue = deepFreezeCopy(input);
    const event = eventFor(this.#state, issue);
    if (input.requestId === event.metadata.eventId)
      return failure(
        "MESSAGE_ID_CONFLICT",
        "Recommendation request and event IDs must differ.",
      );
    this.#state.status = "RECOMMENDED";
    this.#state.issue = issue;
    this.#state.recommendationEvent = event;
    return success("applied", this.snapshot, [event]);
  }

  toMemento(): CompletionReviewMementoV1 {
    return deepFreezeCopy({
      mementoType: "patchquest.completion-review" as const,
      mementoVersion: 1 as const,
      status: this.#state.status,
      seed: this.#state.seed,
      recommendation: this.#state.recommendation,
      ...(this.#state.issue ? { issue: this.#state.issue } : {}),
      ...(this.#state.recommendationEvent
        ? { recommendationEvent: this.#state.recommendationEvent }
        : {}),
    });
  }

  static rehydrate(value: unknown): CompletionReviewResult<CompletionReview> {
    if (!isJsonObject(value) || !hasJsonTopology(value))
      return failure(
        "PERSISTENCE_MEMENTO_INVALID",
        "Completion-review memento topology is invalid.",
      );
    if (
      value["mementoType"] !== "patchquest.completion-review" ||
      value["mementoVersion"] !== 1
    )
      return failure(
        "PERSISTENCE_VERSION_UNSUPPORTED",
        "Completion-review memento version is unsupported.",
      );
    if (
      !hasExactOwnKeys(
        value,
        ["mementoType", "mementoVersion", "status", "seed", "recommendation"],
        ["issue", "recommendationEvent"],
      ) ||
      !isJsonObject(value["seed"]) ||
      !hasExactOwnKeys(value["seed"], ["completionReviewId", "verdictEvent"]) ||
      !isIdentifier(value["seed"]["completionReviewId"]) ||
      !isVerificationVerdictEvent(value["seed"]["verdictEvent"]) ||
      (value["status"] !== "OPEN" && value["status"] !== "RECOMMENDED")
    )
      return failure(
        "PERSISTENCE_MEMENTO_INVALID",
        "Completion-review memento shape is invalid.",
      );
    const opened = CompletionReview.open(
      value["seed"] as unknown as OpenCompletionReview,
    );
    if (!opened.ok)
      return failure(
        "PERSISTENCE_MEMENTO_INVALID",
        "Completion-review seed cannot be replayed.",
      );
    const review = opened.value;
    if (value["issue"] !== undefined) {
      if (!isIssue(value["issue"]))
        return failure(
          "PERSISTENCE_MEMENTO_INVALID",
          "Completion-review issue is invalid.",
        );
      const issued = review.issue(value["issue"]);
      if (!issued.ok)
        return failure(
          "PERSISTENCE_MEMENTO_INVALID",
          "Completion-review recommendation cannot be replayed.",
        );
    }
    if (canonicalizeJson(review.toMemento()) !== canonicalizeJson(value))
      return failure(
        "PERSISTENCE_MEMENTO_INVALID",
        "Completion-review memento does not replay exactly.",
      );
    return success("applied", review);
  }
}
