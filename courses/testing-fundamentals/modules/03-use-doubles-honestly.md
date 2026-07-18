---
id: use-doubles-honestly
title: Use test doubles honestly
goal: Choose a small fake for replaceable data and recognise when a mock or spy can make a test pass without proving the outcome.
action: Put one deterministic rate fake at `test/fixtures/zone-rates.ts`, use it at a real pricing seam, and assert the resulting price or failure in `test/parcel-pricing.test.ts`.
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
  - id: doubles-review
    kind: review
    prompt: A suite stays green while customers see wrong totals. Its pricing test asserts only that the rate lookup was called once with "B". Which test-double mistake is this, and what assertion is missing?
    reference: ../notes/testing-principles.md
    rubric:
      - Identifies interaction-only verification standing in for an outcome check.
      - Names the missing assertion on the observable total the caller receives.
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
invent an external service. Open a small seam instead: accept a rate source as
a parameter with the production table as its default, so every existing test
keeps passing unchanged. In `src/parcel-pricing.ts`:

```ts
export type RateSource = { getBase(zone: Parcel["zone"]): number };

export const defaultRates: RateSource = {
  getBase(zone) {
    return { A: 5, B: 8, C: 12 }[zone];
  },
};

const optionPrices: Record<string, number> = { express: 6, fragile: 3 };

export function priceParcel(parcel: Parcel, rates: RateSource = defaultRates): ParcelPrice {
  const weightSurcharge = parcel.weightKg > 1 ? 2 : 0;
  const optionSurcharge = parcel.options.reduce(
    (sum, option) => sum + (optionPrices[option] ?? 0),
    0,
  );

  return { total: rates.getBase(parcel.zone) + weightSurcharge + optionSurcharge };
}
```

Your module 01 surcharge code may look different; keep it. The only required
change is the `rates` parameter and reading the base through
`rates.getBase(parcel.zone)`.

Give the fake deliberately different numbers from production. If the fake
returned the same €8 for zone B, a green test could not tell you whether the
substitute was actually used. In `test/fixtures/zone-rates.ts`:

```ts
import type { RateSource } from "../../src/parcel-pricing";

export const zoneRateFake: RateSource = {
  getBase(zone) {
    return { A: 1, B: 2, C: 3 }[zone];
  },
};
```

The important assertion is still the parcel outcome. A 2 kg zone B parcel
priced through the fake costs €4: fake base €2 plus the €2 weight surcharge.
That single number proves the zone flowed through the seam and the surcharge
logic ran. A test that only says `getBase` was called with `"B"` can pass even
if the result is ignored or a wrong surcharge is added.

```ts
import { zoneRateFake } from "./fixtures/zone-rates";

it("prices zone B through the in-memory rate fake", () => {
  const result = priceParcel({ weightKg: 2, zone: "B", options: [] }, zoneRateFake);

  expect(result.total).toBe(4);
});
```

## Build

1. Identify one replaceable input in `src/parcel-pricing.ts`: a zone-rate
   lookup, a clock, or another small dependency that genuinely exists.
2. Create the deterministic in-memory fake in
   `test/fixtures/zone-rates.ts`. Keep its behaviour obvious and its numbers
   deliberately different from production; do not reproduce the whole
   production implementation.
3. Write or revise one test in `test/parcel-pricing.test.ts` so it checks the
   resulting parcel price or the deliberate failure, not only the fake's call
   history. Name it, for example, `prices zone B through the in-memory rate fake`,
   and make sure you can explain its expected total from the fake's numbers.
4. Run `npm test` and inspect that case name plus the passing `Test Files` and
   `Tests` summaries. If you keep a spy, say what contract the interaction
   itself protects; otherwise remove it.

## What this is NOT

It is not a test where every collaborator is a mock and every assertion checks
call count. That style can report green while the price a caller receives is
wrong. A fake is not automatically better either: use it because it isolates a
real boundary while preserving a meaningful outcome.

## Definition of done

- One test uses a deterministic fake or fixture at a real seam in the project.
- The fake is at `test/fixtures/zone-rates.ts` and the outcome assertion is in
  `test/parcel-pricing.test.ts`.
- The fake is smaller than the production dependency and has believable behaviour.
- The test asserts a parcel price or deliberate failure, not only an interaction.
- `npm test` passes and your explanation names when a spy would be misleading.
