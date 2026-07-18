---
id: operate
title: Observe and ship
goal: Make the small backend diagnosable and explainable to another developer.
action: Add minimal structured logging, keep a health route separate from correctness, and write a short runbook in the workspace.
sources:
  - ./07-observe-and-ship.md
  - ../../../references/source-index.md#observability-and-operations
questions:
  - id: operate-diagnostic
    kind: diagnostic
    prompt: Why can logging every request body be both unhelpful and unsafe?
    reference: ./07-observe-and-ship.md
    rubric:
      - Explains that full bodies create noisy, low-signal logs.
      - Names a privacy, security, or secret-exposure risk.
  - id: operate-exit
    kind: exit
    prompt: Name one diagnostic signal, one value you intentionally do not log, and one condition a health route cannot prove.
    reference: ./07-observe-and-ship.md
    rubric:
      - Names a useful signal such as an operation ID, outcome, or duration and one deliberately excluded sensitive value.
      - States a business-correctness or dependency condition that a health route alone cannot prove.
---

# 07 · Observe and ship

## Outcome

I can make the small backend diagnosable and describe what must be checked
before another person can run it.

## Diagnostic question

Why are logs that expose every request body both hard to use and potentially
unsafe?

## Build

> [!SCENARIO]
> When a booking fails, an operation ID, outcome, and duration make a useful
> trail. A full request body can expose private data without helping you find
> the problem.

1. Add structured, minimally useful logs around one use case boundary. Include
   a request or operation identifier, outcome, and duration where meaningful;
   exclude secrets and unnecessary personal data.

   A structured line can be this small and still be useful:

   ```ts
   // adapters/http/bookings.ts — after the use case returns
   console.log(JSON.stringify({
     event: "booking.create",
     operationId,
     outcome: result.kind, // "created" | "rejected"
     durationMs: Date.now() - startedAt,
   }));
   ```

   Note what is absent: no request body, no guest names, no credentials. The
   outcome and duration answer "did it work, and was it slow?"; the operation
   ID lets you find the one request that failed.

2. Keep the health/status route separate from business correctness. `GET
   /health` proves the process is up and responding; it does not prove
   bookings are correct, the database is reachable, or data is intact.
3. Write a short runbook in your workspace: dependencies, development command,
   test command, configuration required, and one expected failure signal.
4. Run the server and test suite yourself; record the commands and outcomes.
5. If a guide is connected, ask it for an evidence review limited to this
   course's boundaries, tests, failure decision, and runbook; otherwise keep
   that review in the evidence form or in `NOTES.md` in your workspace.

## Final evidence

Finish this course with four concrete items:

- A small, honest repository containing only the code and documentation you can explain.
- A runnable status route, with the command and observed response recorded.
- A passing test suite, with its command and scope stated honestly.
- A short architecture explanation in your own words covering the domain, ports, adapters, and one trade-off.

This is **not production readiness**. It is a bounded learning project with
evidence that another developer can inspect and run; it does not prove scale,
security, reliability, or operational readiness.

Use [OpenTelemetry's observability overview](../../../references/source-index.md#observability-and-operations)
and [The Twelve-Factor App](../../../references/source-index.md#observability-and-operations) as
practical references, not as a claim that one small course service is operated
at scale.

## Exit question

Name one signal that helps diagnose a failure, one value you intentionally do
not log, and one condition your health route cannot prove.

## Later review

From a cold checkout of your workspace, what minimum instructions let another
developer run tests and the development server safely?

## Definition of done

Before answering, check that:

- Structured logs include a useful operation signal while omitting secrets and unnecessary personal data.
- A status route runs separately from a business-correctness check.
- A workspace runbook names dependencies, development and test commands, configuration, and one failure signal.
- The final evidence list contains a small repository, runnable status route, passing suite, and your own architecture explanation.

After you submit your answer, choose **Mark as self-reviewed and continue** if
you are working without a connected guide. Guide evaluation is optional, not
required; if a guide is connected, you may request feedback instead.
