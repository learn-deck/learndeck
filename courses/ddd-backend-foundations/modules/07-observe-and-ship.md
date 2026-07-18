---
id: operate
title: Observe and ship
goal: Make the small backend diagnosable and explainable to another developer.
action: Add minimal structured logging, keep a health route separate from correctness, and write a short runbook in the workspace.
sources:
  - ./07-observe-and-ship.md
  - ../../../references/source-index.md#observability
  - ../../../references/source-index.md#operations
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
2. Keep the health/status route separate from business correctness.
3. Write a short runbook in your workspace: dependencies, development command,
   test command, configuration required, and one expected failure signal.
4. Run the server and test suite yourself; record the commands and outcomes.
5. Ask the agent for a release-readiness review limited to this course's
   evidence: boundaries, tests, failure decision, and runbook.

Use [OpenTelemetry's observability overview](../../../references/source-index.md#observability)
and [The Twelve-Factor App](../../../references/source-index.md#operations) as
practical references, not as a claim that one small course service is operated
at scale.

## Exit question

Name one signal that helps diagnose a failure, one value you intentionally do
not log, and one condition your health route cannot prove.

## Later review

From a cold checkout of your workspace, what minimum instructions let another
developer run tests and the development server safely?
