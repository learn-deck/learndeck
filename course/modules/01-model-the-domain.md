# 01 · Model the domain

## Outcome

I can describe a small backend problem in domain language, identify invariants,
and name use cases before choosing tables or routes.

## Diagnostic question

What is the difference between a business invariant and an HTTP validation
rule? Give one example of each for a small task or booking service.

## Build

1. Choose a deliberately small problem: task tracking, booking, inventory
   reservation, or another bounded workflow. Record the choice in progress.
2. Write a short domain note in your workspace: nouns, verbs, state changes,
   and what must always be true.
3. Define one use case in application language: input, successful outcome, and
   expected domain failures.
4. Create a domain type or aggregate that protects one invariant without
   importing an HTTP framework, database client, or logger.
5. Ask the agent to record the domain-note and code paths. Then explain the
   invariant in your own words.

Use [Vaughn Vernon's aggregate guidance](../../references/source-index.md#ddd)
and [the hexagonal architecture reference](../../references/source-index.md#hexagonal)
as anchors; do not copy their examples as your product model.

## Exit question

Name one invariant your domain code owns, one input error the HTTP adapter can
reject first, and explain why they are not the same responsibility.

## Later review

Given a new route, decide whether its rule belongs in the adapter, application
use case, or domain model—and say why.
