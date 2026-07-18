# 04 · Persist through a port

## Outcome

I can replace an in-memory repository with persistence without moving storage
concerns into domain code.

## Diagnostic question

What is the difference between a domain identity and a database primary key?
When might they be the same value, and why should the model not depend on that?

## Build

1. List the operations your existing repository port really needs; delete
   speculative CRUD operations.
2. Choose a local persistence adapter appropriate to your path and record its
   location and configuration boundary.
3. Map persisted data at the adapter edge. Reconstruct the domain object before
   handing it to inner code.
4. Decide and document the transaction boundary for one use case.
5. Run the relevant tests and your status route. Record the evidence and any
   persistence-specific failures.

Use [Fowler's Repository pattern](../../references/source-index.md#persistence)
as a vocabulary reference, while keeping the port shaped by your use case.

## Exit question

Which layer knows SQL or the database library in your project? Which layer
defines what it needs from persistence, and how does that protect a domain
invariant?

## Later review

If an adapter returns a duplicate-key error, which layer should translate it
into the application's language before it reaches HTTP?
