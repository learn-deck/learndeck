# 06 · Handle failure deliberately

## Outcome

I can distinguish expected domain rejection, transient infrastructure failure,
duplicate delivery, and an unsafe retry.

## Diagnostic question

Why is “catch everything and retry” unsafe for a backend that can charge money,
reserve inventory, or send a message?

## Build

1. List three failure cases for your use case: one rejected by the domain, one
   transient adapter failure, and one duplicate request/message.
2. Make the expected domain failure explicit in the application result rather
   than hiding it as a generic exception.
3. Choose an idempotency key or deduplication boundary for one side effect.
4. Define which failures are safe to retry, the limit, and what evidence is
   recorded. Do not add background retries just to satisfy the exercise.
5. Add one test for the duplicate or retry decision and record the result.

Use [AWS's retry and backoff guidance](../../references/source-index.md#reliability)
and [the Transactional Outbox pattern](../../references/source-index.md#reliability)
to reason about failure modes, not to claim exactly-once delivery.

## Exit question

Classify one failure in your project as domain rejection, transient failure, or
duplicate. Is a retry safe? State the precondition that makes your answer true.

## Later review

Explain why an idempotency key changes the effect of a retry but does not make
all work automatically safe to repeat.
