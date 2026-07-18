---
id: proof
title: Prove behaviour
goal: Use fast tests to protect domain rules and a small number of boundaries.
action: Add one domain test, one use-case test with an in-memory adapter, and one HTTP boundary test. Run the suite yourself.
sources:
  - ./05-prove-behaviour.md
  - ../../../references/source-index.md#testing
questions:
  - id: proof-diagnostic
    kind: diagnostic
    prompt: What can a fast domain test prove that a route-level test might obscure?
    reference: ./05-prove-behaviour.md
    rubric:
      - Names the business invariant or domain behaviour a fast test can state directly.
      - Explains why HTTP, database, or other boundary details can obscure that claim in a route-level test.
  - id: proof-exit
    kind: exit
    prompt: For your domain, use-case, and HTTP test, state one behaviour each proves and one thing it does not prove.
    reference: ./05-prove-behaviour.md
    rubric:
      - States one honest behaviour and one explicit limitation for each of the domain, use-case, and HTTP tests.
      - Explains why an in-memory adapter or test double is acceptable at the port boundary.
---

# 05 · Prove behaviour

## Outcome

I can use tests to protect a business rule and a boundary without making the
test suite depend on a running production stack.

## Diagnostic question

What would a fast test of an invariant prove that a route-level test alone
might obscure?

## Build

> [!SCENARIO]
> A fast domain test can say “the second booking for this room and time is
> rejected.” It does not need an HTTP server or database to make that business
> promise easy to understand.

1. Write one domain-level test for the invariant from step 01.
2. Write one use-case test using the in-memory adapter from step 02.
3. Add one HTTP boundary test for a deliberate input or error mapping.
4. Run the project test command, `npm test`, yourself.
5. Record test paths, command output summary, and what each test is allowed to
   prove. Do not label a passing test as proof of every production concern.

## What this is NOT

The wrong test asserts private implementation details and call order:

```ts
// wrong
it("checks before saving", async () => {
  const find = vi.spyOn(repo, "findOverlapping");
  const save = vi.spyOn(repo, "save");
  await createBooking(input, repo);
  expect(find.mock.invocationCallOrder[0]).toBeLessThan(save.mock.invocationCallOrder[0]);
});
```

The right test asserts the booking behaviour a learner or caller can observe:

```ts
// right
it("rejects an overlapping booking", async () => {
  const result = await createBooking(input, repoWithExistingBooking);
  expect(result).toEqual({ kind: "rejected", reason: "room-already-booked" });
});
```

The wrong version can fail after a harmless refactor even when the booking rule
still works, because it prescribes internals and order. The right version stays
valuable when the implementation changes because it checks the observable
rejection of a second booking.

Use [Google's testing guidance](../../../references/source-index.md#testing) for
test-value trade-offs, not as a mandated testing pyramid.

## Exit question

For each of your three tests, name the behaviour it proves and one thing it
does not prove. Why is a test double acceptable at the port boundary here?

## Later review

Given a slow flaky integration test, decide whether it belongs in a fast inner
loop, a boundary suite, or a separate environment check.

## Definition of done

Before answering, check that:

- A fast domain test rejects a second booking for the same room and time.
- A use-case test runs through the in-memory adapter.
- An HTTP boundary test covers one deliberate input or error mapping.
- `npm test` was run and each test's evidence and limitation are recorded.
