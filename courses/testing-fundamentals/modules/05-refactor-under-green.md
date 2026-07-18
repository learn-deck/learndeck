---
id: refactor-under-green
title: Refactor under green
goal: Change internal structure while a behaviour-focused suite protects the parcel-pricing contract.
action: Make one internal refactor with the suite green before and after, then replace one implementation-detail assertion with an observable outcome assertion.
sources:
  - ./05-refactor-under-green.md
  - ../notes/testing-principles.md
questions:
  - id: refactor-diagnostic
    kind: diagnostic
    prompt: What makes a test a safety net during a refactor, and what kind of assertion makes that net brittle?
    reference: ../notes/testing-principles.md
    rubric:
      - Explains that a passing behaviour test gives evidence that an observable contract stayed intact across an internal change.
      - Distinguishes a brittle assertion about private calls, order, or structure from an assertion about a parcel outcome.
  - id: refactor-exit
    kind: exit
    prompt: What did you change internally, what stayed observable, and which test result gives you confidence without claiming that every possible implementation is safe?
    reference: ./05-refactor-under-green.md
    rubric:
      - Names one internal refactor and one unchanged parcel-pricing or HTTP behaviour.
      - Uses passing test evidence while stating a limit, such as untested inputs, dependencies, or production conditions.
---

# 05 · Refactor under green

## Outcome

You can change names, helpers, or internal structure while preserving the
behaviour a caller relies on.

## Protect the outcome, not the shape

> [!SCENARIO]
> You can replace nested weight `if` statements with a small band table, or
> extract a `weightSurcharge` helper. If the parcel totals and deliberate
> failures stay the same, the refactor should not require a new customer-facing
> contract.

## Worked example 2 — fade from an interaction to an outcome

Here is the brittle decision a test author might make:

```ts
expect(rateLookup.getBase).toHaveBeenCalledWith("B");
expect(rateLookup.getBase).toHaveBeenCalledTimes(1);
```

Your turn: rewrite the meaningful part of this test so it proves what the
caller receives for a 2 kg zone B parcel. Keep an interaction assertion only if
the lookup call itself is a documented contract.

The stronger default is an outcome such as `expect(result.total).toBe(10)`,
with the parcel input visible in arrange. The implementation may later cache,
batch, or replace the lookup without changing the price contract. A call-order
assertion is useful only when ordering is observable and required, not because
the spy makes it easy to inspect.

## Build

1. Run `npm test` and note the green baseline before editing internals.
2. Make one refactor that should not change the parcel-pricing contract: name
   a helper, extract a weight-band table, or simplify a branch.
3. Replace one assertion about a private call, order, or helper with an
   observable price, response, or deliberate failure assertion.
4. Run `npm test` again. If it fails, use the failure to decide whether you
   found a real behaviour change or a test coupled to the old implementation.
5. Record the before-and-after commands and the refactor in your evidence.

## What this is NOT

It is not “green means production-ready,” and it is not “never assert an
interaction.” Green means only that the exercised contracts held for the cases
you wrote. Assert a call when the call is itself the contract; otherwise prefer
the outcome a parcel-pricing caller can observe.

## Definition of done

- The suite was green before and after one internal refactor.
- At least one brittle implementation-detail assertion became a behaviour assertion.
- The changed code still covers a parcel total or deliberate failure that a caller can observe.
- Your evidence states what the green suite does not prove.

