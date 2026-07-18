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
4. Decide and document the transaction boundary for one use case. A useful
   rule of thumb from Vernon's aggregate guidance: one transaction changes one
   aggregate; anything wider deserves a written justification.
5. Run the relevant tests and your status route. Record the evidence and any
   persistence-specific failures.

## Worked example: map storage at the edge

Here is one small persistence decision fully worked for a booking row:

```ts
type Booking = { roomId: string; startsAt: number; endsAt: number };
type BookingRow = { room_id: string; starts_at: number; ends_at: number };

function toDomain(row: BookingRow): Booking {
  return {
    roomId: row.room_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  };
}
```

Your next analogous decision: write the `toRow` function for saving a booking
and decide which identity and time fields must survive a round trip. Keep the
row type and database naming outside the port signature.

Why this decision? `toDomain` reconstructs the object the booking rule
understands before it reaches inner code. SQL names and storage types stay in the
adapter, so replacing the store does not force a change to the invariant.

> [!TIP]
> Be honest about concurrency: "find overlapping, then save" is two steps, so
> two simultaneous requests can both pass the check and double-book the room.
> This is exactly why the transaction boundary you document in step 4 matters.
> Run the check and the insert inside one transaction, or back the invariant
> with a database uniqueness/exclusion constraint at the adapter edge. The
> domain still owns the rule; the transaction is how persistence keeps it true
> under concurrent writes.

## What this is NOT

This port leaks infrastructure details into the inside:

```ts
// wrong
import type { Pool } from "pg";
type BookingRow = { room_id: string; starts_at: number; ends_at: number };

interface BookingRepository {
  findOne(db: Pool, tableName: string, sql: string): Promise<BookingRow | null>;
}
```

This port exposes the capability the booking use case actually needs:

```ts
// right
type Booking = { roomId: string; startsAt: number; endsAt: number };

interface BookingRepository {
  findOverlapping(roomId: string, startsAt: number, endsAt: number): Promise<Booking | null>;
}
```

The wrong version makes callers know a driver, table name, SQL, and row shape;
it is an infrastructure API disguised as a port. The right version speaks in
booking terms, while the adapter owns SQL and maps rows at the edge.

Use [Fowler's Repository pattern](../../../references/source-index.md#persistence)
as a vocabulary reference, while keeping the port shaped by your use case.

## Exit question

Which layer knows SQL or the database library in your project? Which layer
defines what it needs from persistence, and how does that protect a domain
invariant?

## Later review

If an adapter returns a duplicate-key error, which layer should translate it
into the application's language before it reaches HTTP?

## Definition of done

Before answering, check that:

- The existing repository port still expresses only the operations this use case needs.
- A persistence adapter maps storage rows to domain objects at its edge.
- One transaction boundary is written down for a booking use case.
- Tests and the status route were run, with persistence-specific results recorded honestly.

After you submit your answer, choose **Mark as self-reviewed and continue** if
you are working without a connected guide. Guide evaluation is optional, not
required; if a guide is connected, you may request feedback instead.
