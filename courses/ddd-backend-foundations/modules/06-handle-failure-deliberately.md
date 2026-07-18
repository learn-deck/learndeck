---
id: failure
title: Handle failure deliberately
goal: Differentiate rejection, transient failure, duplicate delivery, and unsafe retries.
action: Model one expected rejection, choose an idempotency boundary for one side effect, and test a retry or duplicate decision.
sources:
  - ./06-handle-failure-deliberately.md
  - ../../../references/source-index.md#reliability
questions:
  - id: failure-diagnostic
    kind: diagnostic
    prompt: Why is catch-everything-and-retry unsafe for a backend with external side effects?
    reference: ./06-handle-failure-deliberately.md
    rubric:
      - Names a duplicate or harmful external effect such as a repeat charge, reservation, or message.
      - Explains that retry safety depends on the failure class and a deliberate idempotency or deduplication boundary.
  - id: failure-exit
    kind: exit
    prompt: Classify one failure as domain rejection, transient failure, or duplicate. Is a retry safe, and what makes it safe?
    reference: ./06-handle-failure-deliberately.md
    rubric:
      - Correctly classifies one concrete failure in the learner's project.
      - States whether a retry is safe and the precondition, such as an idempotency key or no side effect, that makes it safe.
---

# 06 · Handle failure deliberately

## Outcome

I can distinguish expected domain rejection, transient infrastructure failure,
duplicate delivery, and an unsafe retry.

## Diagnostic question

Why is “catch everything and retry” unsafe for a backend that can charge money,
reserve inventory, or send a message?

## Build

> [!SCENARIO]
> A client retries `POST /bookings` after losing the response. An idempotency
> key lets you recognise the same request; it does not make an unrelated
> network or payment failure safe to repeat.

1. List three failure cases for your use case: one rejected by the domain, one
   transient adapter failure, and one duplicate request/message.
2. Make the expected domain failure explicit in the application result rather
   than hiding it as a generic exception.
3. Choose an idempotency key or deduplication boundary for one side effect.
4. Define which failures are safe to retry, the limit, and what evidence is
   recorded. Do not add background retries just to satisfy the exercise.
5. Add one test for the duplicate or retry decision and record the result.

## Worked example: name the expected failure, let the unexpected one surface

Here is one small failure decision fully worked for `CreateBooking`:

```ts
type Booking = { roomId: string; startsAt: number; endsAt: number };

export type CreateBookingResult =
  | { kind: "created"; booking: Booking }
  | { kind: "rejected"; reason: "room-already-booked" };
```

Why this decision? A double booking is not an accident—it is the domain doing
its job—so it belongs in the result type where every caller must handle it,
and where module 03's adapter turned it into a stable `409`. A transient
adapter failure (the database is briefly unreachable) is deliberately *not* a
result variant: the adapter throws, the failure surfaces, and whether a retry
is safe depends on what side effects already happened—which is why you choose
an idempotency boundary next, instead of wrapping everything in a retry loop.

Your next analogous decision: for the duplicate case, decide what a retried
`POST /bookings` carrying the same idempotency key should return—the original
outcome, replayed, not a second booking.

Use [AWS's retry and backoff guidance](../../../references/source-index.md#reliability)
and [the Transactional Outbox pattern](../../../references/source-index.md#reliability)
to reason about failure modes, not to claim exactly-once delivery.

## Exit question

Classify one failure in your project as domain rejection, transient failure, or
duplicate. Is a retry safe? State the precondition that makes your answer true.

## Later review

Explain why an idempotency key changes the effect of a retry but does not make
all work automatically safe to repeat.

## Definition of done

Before answering, check that:

- Three failures are classified as domain rejection, transient adapter failure, and duplicate delivery.
- One expected domain failure is explicit in the application result.
- One side effect has a named idempotency or deduplication boundary and retry rule.
- A duplicate or retry decision has a test and recorded result.

After you submit your answer, choose **Mark as self-reviewed and continue** if
you are working without a connected guide. Guide evaluation is optional, not
required; if a guide is connected, you may request feedback instead.
