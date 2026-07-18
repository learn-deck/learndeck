---
id: use-doubles-honestly
title: Use test doubles honestly
goal: Choose a small fake for replaceable data and recognise when a mock or spy can make a test pass without proving the outcome.
action: Replace one interaction-heavy parcel-pricing test with a small in-memory fake or fixture and assert the resulting price or failure.
sources:
  - ./03-use-doubles-honestly.md
  - ../notes/testing-principles.md
questions:
  - id: doubles-diagnostic
    kind: diagnostic
    prompt: What is the difference between a fake, a mock, and a spy in the parcel-pricing scenario, and which one would you start with for zone rates?
    reference: ../notes/testing-principles.md
    rubric:
      - Distinguishes a working substitute, scripted or interaction-checked substitute, and call-recording wrapper.
      - Chooses an in-memory fake for zone rates and explains that it keeps the price outcome meaningful.
  - id: doubles-exit
    kind: exit
    prompt: Show how your test double lets you make a pricing decision, then explain one way a spy or mock assertion could pass while the customer-facing price is wrong.
    reference: ./03-use-doubles-honestly.md
    rubric:
      - Describes a small fake or fixture with believable zone-rate behaviour and an asserted parcel outcome.
      - Gives a concrete interaction-only failure, such as verifying a lookup call while never checking the returned total.
---

# 03 · Use test doubles honestly

## Outcome

You can substitute a dependency without pretending that an interaction proves
the parcel price.

## A small seam, not a new architecture

> [!SCENARIO]
> Imagine that zone base prices come from a rate lookup. For this course, an
> in-memory rate table is enough. It lets you test the pricing decision without
> a network, database, or “mock everything” setup. The service should still
> return the right total for the parcel.

If your current implementation has the zone rates inline, you do not need to
invent an external service. You can pass a small rates object or fixture into
the pricing function, or keep the fixture at the unit boundary. The point is to
make the substitute believable and small.

For example, the shape might be as simple as this:

```ts
const rates = {
  getBase(zone: "A" | "B" | "C") {
    return { A: 5, B: 8, C: 12 }[zone];
  },
};
```

The important assertion is the parcel outcome: a 2 kg zone B parcel still
costs €10. A test that only says `getBase` was called with `"B"` can pass even
if the result is ignored or a wrong surcharge is added.

## Build

1. Identify one replaceable input in your implementation: a zone-rate lookup,
   a clock, or another small dependency that genuinely exists.
2. Create a deterministic in-memory fake or fixture for it. Keep the fake
   behaviour obvious; do not reproduce the whole production implementation.
3. Write or revise one test so it checks the resulting parcel price or the
   deliberate failure, not only the fake's call history.
4. Run `npm test` and inspect the test name and result. If you keep a spy, say
   what contract the interaction itself protects; otherwise remove it.

## What this is NOT

It is not a test where every collaborator is a mock and every assertion checks
call count. That style can report green while the price a caller receives is
wrong. A fake is not automatically better either: use it because it isolates a
real boundary while preserving a meaningful outcome.

## Definition of done

- One test uses a deterministic fake or fixture at a real seam in the project.
- The fake is smaller than the production dependency and has believable behaviour.
- The test asserts a parcel price or deliberate failure, not only an interaction.
- `npm test` passes and your explanation names when a spy would be misleading.

