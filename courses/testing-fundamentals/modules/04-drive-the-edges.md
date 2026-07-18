---
id: drive-the-edges
title: Drive the edges deliberately
goal: Use table-driven cases to make pricing boundaries, options, and failure paths visible.
action: Add a table to `test/parcel-pricing.test.ts` covering both sides of at least two pricing boundaries plus deliberate invalid-input cases, extend `priceParcel` until they pass, add the promised 400 and 422 cases to `test/http-price.test.ts`, then run the suite and inspect the named cases.
sources:
  - ./04-drive-the-edges.md
  - ../notes/testing-principles.md
questions:
  - id: edges-diagnostic
    kind: diagnostic
    prompt: Which values around the 1 kg, 5 kg, and 10 kg thresholds are more useful than a single typical parcel, and why?
    reference: ../notes/testing-principles.md
    rubric:
      - Names values on both sides of at least one threshold, including the threshold itself where the rule includes it.
      - Explains that adjacent values can reveal an incorrect comparison or band assignment.
  - id: edges-exit
    kind: exit
    prompt: Choose one table case and one failure case. What rule does each protect, and what would a vague “it throws” assertion fail to tell you?
    reference: ./04-drive-the-edges.md
    rubric:
      - Connects the table case to a specific pricing boundary, option, or expected total.
      - Names the invalid input and the promised error distinction rather than only saying that an exception occurred.
---

# 04 · Drive the edges deliberately

## Outcome

You can choose cases because they protect a rule, not because a test generator
produced a large number of examples.

## Make the boundaries visible

> [!SCENARIO]
> The 1 kg band includes 1 kg, but 1.01 kg moves to the next surcharge. The
> same question exists at 5 kg and 10 kg. A table keeps those decisions in one
> readable place and gives each case a useful name.

Start with a small table like this, then add the invalid inputs that matter to
your service:

| Case name | Weight | Zone | Options | Expected |
| --- | ---: | :---: | :--- | ---: |
| `one-kg-is-in-first-band` | 1.00 | A | none | €5 |
| `just-over-one-kg-adds-surcharge` | 1.01 | A | none | €7 |
| `five-kg-stays-in-second-band` | 5.00 | B | none | €10 |
| `just-over-five-kg-uses-third-band` | 5.01 | B | none | €13 |
| `ten-kg-stays-in-third-band` | 10.00 | C | none | €17 |
| `just-over-ten-kg-uses-fourth-band` | 10.01 | C | none | €21 |

Add at least one case for `express` or `fragile`, an invalid weight, and an
unknown zone or option. For failures, assert the stable distinction your
caller needs: an error category, status, or documented message fragment. Do
not make the test depend on a private stack trace.

In Vitest, `it.each` turns the table into named cases. Typing the rows as
`Parcel` plus expectations keeps the zone literals narrow:

```ts
import { priceParcel, type Parcel } from "../src/parcel-pricing";

type PricingCase = Parcel & { name: string; total: number };

const boundaryCases: PricingCase[] = [
  { name: "one-kg-is-in-first-band", weightKg: 1, zone: "A", options: [], total: 5 },
  { name: "just-over-one-kg-adds-surcharge", weightKg: 1.01, zone: "A", options: [], total: 7 },
  // ...the remaining rows from the table above
];

it.each(boundaryCases)("$name", ({ name, total, ...parcel }) => {
  expect(priceParcel(parcel).total).toBe(total);
});
```

Expect red before green: your implementation so far has only the single €2
surcharge from module 00, so the 5.01 kg and 10.01 kg rows must fail first.
That failure is the instruction to extend `priceParcel` to the full shared
scenario — weight bands at 1, 5, 10, and 20 kg, and rejection of invalid
weights, zones, and options.

## Build

1. Put related pricing examples in a Vitest table or equivalent data-driven
   structure in `test/parcel-pricing.test.ts`. Give each row a case name that
   will appear in test output, including the six names shown above.
2. Include values at and immediately beside at least two thresholds. Let the
   failing rows drive the band table into `src/parcel-pricing.ts`; do not edit
   the expectations to match the old behaviour.
3. Add deliberate failure cases for invalid input, for example
   `expect(() => priceParcel({ weightKg: 0, zone: "B", options: [] })).toThrowError(/weight/)`
   if you chose a thrown error with a documented message. These cases exercise
   the pricing rule itself.
4. Now keep module 02's promise at the HTTP edge in `test/http-price.test.ts`:
   malformed JSON must return `400`, and a well-formed request whose parcel
   breaks a pricing rule must return the distinct `422` from the adapter.
5. Run `npm test`. Read the six boundary case names, the option case, and the
   invalid-input cases—not only the final count. The output must end with
   passing `Test Files` and `Tests` summaries. If a boundary fails, decide
   whether the rule or the test expectation is wrong before changing either.

## Definition of done

- A readable table covers both sides of at least two pricing thresholds.
- The table is in `test/parcel-pricing.test.ts` and its important case names
  appear in `npm test` output.
- `src/parcel-pricing.ts` now implements the full weight bands and rejects
  invalid weights, zones, and options, driven there by failing cases.
- Options have a focused case and invalid input has a deliberate failure case.
- `test/http-price.test.ts` proves the 400 malformed-JSON and 422 invalid-parcel
  responses promised in module 02.
- Failure assertions identify a useful distinction beyond “something threw”.
- `npm test` passes and the output exposes the names of the important cases.
