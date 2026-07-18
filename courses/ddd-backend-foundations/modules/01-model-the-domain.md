---
id: domain
title: Model the domain
goal: Protect one business invariant before choosing routes or tables.
action: Write a short ubiquitous-language note and implement one domain type or aggregate with no framework or database import.
sources:
  - ./01-model-the-domain.md
  - ../../../references/source-index.md#ddd
  - ../../../references/source-index.md#hexagonal
questions:
  - id: domain-diagnostic
    kind: diagnostic
    prompt: What is the difference between a business invariant and HTTP input validation? Give one example of each.
    reference: ./01-model-the-domain.md
    rubric:
      - Distinguishes an always-true domain rule from malformed or incomplete transport input.
      - Gives one concrete example of each for the chosen workflow.
  - id: domain-exit
    kind: exit
    prompt: Name one invariant your domain owns, one transport validation rule, and why they are different responsibilities.
    reference: ./01-model-the-domain.md
    rubric:
      - Names a specific invariant owned by the domain and a distinct HTTP/transport validation rule.
      - Explains why the two rules belong at different boundaries.
---

# 01 · Model the domain

## Outcome

I can describe a small backend problem in domain language, identify invariants,
and name use cases before choosing tables or routes.

## Diagnostic question

What is the difference between a business invariant and an HTTP validation
rule? Give one example of each for a small task or booking service.

## Build

> [!SCENARIO]
> A booking is not just a row with dates. The business statement is: “a room
> cannot be booked twice for the same time.” That sentence is the invariant
> your domain must protect—even when tomorrow's client is not HTTP.

1. Choose a deliberately small problem: task tracking, booking, inventory
   reservation, or another bounded workflow. Record the choice in your answer
   or in `NOTES.md` in your workspace.
2. Write a short domain note in your workspace: nouns, verbs, state changes,
   and what must always be true.
3. Define one use case in application language: input, successful outcome, and
   expected domain failures.
4. Create a domain type or aggregate that protects one invariant without
   importing an HTTP framework, database client, or logger. In DDD terms, an
   aggregate is the consistency boundary: everything the invariant needs to
   stay true is checked inside it, in one operation. A small value object—an
   immutable type compared by its values, such as a `TimeRange` that refuses
   `endsAt <= startsAt`—is often the cheapest first guard.
5. If a guide is connected, ask it to record the domain-note and code paths;
   otherwise record those paths in the evidence form or in `NOTES.md` in your
   workspace. Then explain the invariant in your own words.

## Worked example: protect the overlap rule

Here is one small domain decision fully worked for the booking service:

```ts
type Booking = {
  roomId: string;
  startsAt: number;
  endsAt: number;
};

export function overlaps(existing: Booking, candidate: Booking): boolean {
  return existing.roomId === candidate.roomId
    && existing.startsAt < candidate.endsAt
    && candidate.startsAt < existing.endsAt;
}
```

Times here are epoch milliseconds and each booking is a half-open interval
`[startsAt, endsAt)`, so a booking that starts exactly when another ends does
not overlap. Writing that convention down in your domain note is itself a
ubiquitous-language decision: everyone, including your tests, now means the
same thing by "overlap".

Your next analogous decision: decide what your domain operation should return
when `overlaps` is true. Write the result type and one expectation for a second
booking attempt; keep HTTP and database concerns out of it.

Why this decision? The predicate compares the same room and intersecting time
intervals, so it protects the booking invariant independently of how a request
or row is represented. Its small boundary lets the application turn `true`
into a domain rejection without asking the domain to know about status codes or
SQL.

Use [Vaughn Vernon's aggregate guidance](../../../references/source-index.md#ddd)
and [the hexagonal architecture reference](../../../references/source-index.md#hexagonal)
as anchors; do not copy their examples as your product model.

## Exit question

Name one invariant your domain code owns, one input error the HTTP adapter can
reject first, and explain why they are not the same responsibility.

## Later review

Given a new route, decide whether its rule belongs in the adapter, application
use case, or domain model—and say why.

## Definition of done

Before answering, check that:

- A domain note names the booking or other workflow's nouns, verbs, state changes, and invariant.
- One domain type or aggregate protects that invariant without HTTP, database, or logger imports.
- One use case names its input, successful outcome, and expected domain failure.
- You can distinguish the domain invariant from one transport validation rule.

After you submit your answer, choose **Mark as self-reviewed and continue** if
you are working without a connected guide. Guide evaluation is optional, not
required; if a guide is connected, you may request feedback instead.
