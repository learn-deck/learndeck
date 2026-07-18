---
id: hexagon
title: Draw the hexagon
goal: Make dependency direction visible through domain, application, ports, and adapters.
action: Create one use case, one port owned by the inner layer, and one in-memory adapter. Wire them together at the outer composition point.
sources:
  - ./02-draw-the-hexagon.md
  - ../../../references/source-index.md#hexagonal
questions:
  - id: hexagon-diagnostic
    kind: diagnostic
    prompt: What dependency direction is reversed when a domain object imports a database client, and why is that costly?
    reference: ./02-draw-the-hexagon.md
    rubric:
      - States that inner domain/application code now depends directly on an outer infrastructure detail.
      - Names a concrete cost to testing, replacement, or changing the database technology.
  - id: hexagon-exit
    kind: exit
    prompt: For one dependency, name the caller, port owner, and adapter. Why is the port shaped by the inside need?
    reference: ./02-draw-the-hexagon.md
    rubric:
      - Maps one real dependency to a caller, inner port owner, and outer adapter.
      - Explains that the port describes the capability the use case needs rather than a vendor API.
---

# 02 · Draw the hexagon

## Outcome

I can keep domain rules independent of frameworks and connect them through
application use cases, ports, and adapters.

## Diagnostic question

If a domain object imports a PostgreSQL client to save itself, what dependency
direction has been reversed? What makes that costly to change or test?

## Build

> [!SCENARIO]
> `CreateBooking` needs to ask whether a room is free. It owns a small
> `BookingRepository` port. An in-memory collection can answer today; SQLite
> can answer later. The use case should not need to know which one it uses.

1. Draw four named areas for your workspace: domain, application, ports, and
   adapters. Record the chosen paths before creating files.
2. Move or create one use case that receives an input and invokes a domain
   operation.
3. Define a repository or clock port owned by the application/domain boundary.
   It should describe the capability needed, not a vendor API.
4. Implement one in-memory adapter behind that port and wire it at the outer
   application composition point.
5. Confirm that the inner code has no imports of the web framework, SQL driver,
   or environment package.

## Worked example: let the inside name the port

Here is one small dependency decision fully worked for `CreateBooking`:

```ts
type Booking = { roomId: string; startsAt: number; endsAt: number };

export interface BookingRepository {
  findOverlapping(roomId: string, startsAt: number, endsAt: number): Promise<Booking | null>;
}

export class InMemoryBookingRepository implements BookingRepository {
  constructor(private readonly bookings: Booking[]) {}

  async findOverlapping(roomId: string, startsAt: number, endsAt: number) {
    return this.bookings.find((booking) =>
      booking.roomId === roomId && booking.startsAt < endsAt && startsAt < booking.endsAt,
    ) ?? null;
  }
}
```

Your next analogous decision: choose the next capability this use case needs,
such as saving a new booking. Write its port signature and the in-memory method,
keeping the operation named after booking behaviour rather than SQL.

Why this decision? The use case asks whether the room and time are available,
so the port exposes exactly that capability. The in-memory adapter implements
the same inside-facing contract; a database adapter can replace it at the edge
without changing the booking decision.

## What this is NOT

The wrong direction makes the domain depend on the HTTP framework:

```ts
// domain/booking.ts — wrong
import type { Request } from "express";

export function canBook(request: Request): boolean {
  return request.body.roomId !== undefined;
}
```

The correct direction translates HTTP at the edge and keeps the domain plain:

```ts
// domain/booking.ts — right
type BookingCommand = { roomId: string; startsAt: number; endsAt: number };

export function canBook(command: BookingCommand, existing: readonly Booking[]) {
  return existing.every((booking) =>
    booking.roomId !== command.roomId || booking.endsAt <= command.startsAt || command.endsAt <= booking.startsAt,
  );
}
```

The wrong version lets Express's request shape reach a domain decision, so the
rule depends on transport. The right version accepts domain data; an outer
adapter translates the request and the inner code remains callable without
Express.

Use the original [Ports and Adapters article](../../../references/source-index.md#hexagonal)
for the direction, not as a folder-name ritual.

## Exit question

For one dependency in your project, name the caller, the port owner, and the
adapter. Why should the port be shaped by the inside need rather than the
database's API?

## Later review

Classify each as a port or adapter: `TaskRepository`, PostgreSQL query client,
system clock, and Fastify handler.

## Definition of done

Before answering, check that:

- One use case calls a port owned by the inner application/domain boundary.
- One in-memory adapter implements that port and is wired at the outer composition point.
- The inner code has no web framework, SQL driver, or environment-package imports.
- You can name the caller, port owner, adapter, and dependency direction for one booking decision.
