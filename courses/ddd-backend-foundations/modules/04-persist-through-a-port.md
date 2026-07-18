---
id: persistence
title: Persist through a port
goal: Swap an in-memory repository for persistence without leaking storage into domain code.
action: Implement one persistence adapter, map data at its edge, and document a transaction boundary for one use case.
sources:
  - ./04-persist-through-a-port.md
  - ../../../references/source-index.md#persistence
questions:
  - id: persistence-diagnostic
    kind: diagnostic
    prompt: How can a domain identity differ from a database primary key, even when both happen to use the same value?
    reference: ./04-persist-through-a-port.md
    rubric:
      - Distinguishes the model's business identity from a storage mechanism's primary key.
      - Explains why matching values do not make the domain dependent on the database representation.
  - id: persistence-exit
    kind: exit
    prompt: Which layer knows the database library, which layer defines the persistence need, and how does that protect an invariant?
    reference: ./04-persist-through-a-port.md
    rubric:
      - Places database-library knowledge in an outer persistence adapter and the need in the inner port/use case.
      - Explains how this protects the domain from storage concerns while preserving its invariant.
---

# 04 · Persist through a port

## Outcome

I can replace an in-memory repository with persistence without moving storage
concerns into domain code.

## Diagnostic question

What is the difference between a domain identity and a database primary key?
When might they be the same value, and why should the model not depend on that?

## Build

> [!SCENARIO]
> Your `CreateBooking` use case still calls the same repository port. Only the
> outer adapter changes: an in-memory collection becomes a SQLite or other
> local store, with mapping contained at that edge.

1. List the operations your existing repository port really needs; delete
   speculative CRUD operations.
2. Choose one local persistence adapter for this Node.js project and record
   its location and configuration boundary.
3. Map persisted data at the adapter edge. Reconstruct the domain object before
   handing it to inner code.
4. Decide and document the transaction boundary for one use case.
5. Run the relevant tests and your status route. Record the evidence and any
   persistence-specific failures.

Use [Fowler's Repository pattern](../../../references/source-index.md#persistence)
as a vocabulary reference, while keeping the port shaped by your use case.

## Exit question

Which layer knows SQL or the database library in your project? Which layer
defines what it needs from persistence, and how does that protect a domain
invariant?

## Later review

If an adapter returns a duplicate-key error, which layer should translate it
into the application's language before it reaches HTTP?
