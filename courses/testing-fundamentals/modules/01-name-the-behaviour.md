---
id: name-the-behaviour
title: Name what a test proves
goal: Turn a passing example into focused arrange–act–assert tests that each describe one parcel-pricing behaviour.
action: Add focused cases in `test/parcel-pricing.test.ts` for ordinary pricing and one option, with test names that state the behaviour and output that shows the cases separately.
sources:
  - ./01-name-the-behaviour.md
  - ../notes/testing-principles.md
questions:
  - id: behaviour-aaa-diagnostic
    kind: diagnostic
    prompt: In a parcel-pricing test, what belongs in arrange, act, and assert, and why does that shape help a future reader?
    reference: ../notes/testing-principles.md
    rubric:
      - Places the parcel input and any dependency setup in arrange, one pricing call in act, and observable price or failure checks in assert.
      - Explains that the shape makes the behaviour and the reason for the assertions readable.
  - id: behaviour-aaa-exit
    kind: exit
    prompt: Choose one of your tests and state the single behaviour it proves. What would be a different test rather than another assertion in this one?
    reference: ./01-name-the-behaviour.md
    rubric:
      - States one specific parcel-pricing behaviour and connects it to the test's input and outcome.
      - Gives a plausible separate behaviour, such as an option surcharge or an invalid zone, instead of splitting an inseparable outcome mechanically.
---

# 01 · Name what a test proves

## Outcome

You can read a test title and its arrange–act–assert sections and say exactly
what behaviour the test proves.

## Keep the scenario concrete

> [!SCENARIO]
> The 2 kg zone B parcel costs €10 without options. The same parcel with
> `express` costs €16. Those are related examples, but they answer different
> questions: the base-and-weight rule, and whether the express option changes
> the outcome correctly.

One behaviour per test is a naming tool, not a ban on useful assertions. Keep
assertions together when they explain one outcome; split the test when a
failure would leave a reader unsure which behaviour broke.

## Worked example 1 — make one decision, then fade it

Here is a complete decision for the express option:

```ts
it("adds the express surcharge to the parcel price", () => {
  // arrange
  const parcel = { weightKg: 2, zone: "B", options: ["express"] };

  // act
  const result = priceParcel(parcel);

  // assert
  expect(result.total).toBe(16);
});
```

Pause before reading on. Write the next focused test yourself for the same
parcel with the `fragile` option. What should its total be, and which part of
the test should change?

The answer is €13: zone B €8, the 2 kg surcharge €2, and fragile €3. Keep the
arrange–act–assert shape, change the option and expected outcome, and give the
test a name about fragile pricing. The test should not also decide whether the
HTTP endpoint parses JSON; that is a different boundary and a later module.

## Build

1. Rename the first test so its title states the behaviour rather than the
   function name alone. Keep it in `test/parcel-pricing.test.ts`.
2. Add focused tests for an ordinary zone-and-weight price and one option in
   that file. Use names such as `prices a 2 kg zone B parcel at €10` and
   `adds the express surcharge to a 2 kg zone B parcel`. Keep the input visible
   in arrange, one pricing call in act, and the price or deliberate failure in
   assert.
3. Run `npm test`. The visible output must list those two case names separately
   and end with `Test Files  1 passed` and `Tests  2 passed`. If
   a test fails, fix the behaviour or its stated expectation deliberately;
   do not weaken the assertion just to get green.
4. Ask yourself whether each test could fail for a different reason. If the
   answer is yes, split it and make the new behaviour explicit.

## Definition of done

- Tests use a visible arrange–act–assert shape for parcel-pricing decisions.
- The focused cases live in `test/parcel-pricing.test.ts` and their names are
  visible in `npm test` output.
- Each test name states one behaviour a learner can explain in one sentence.
- At least one base price and one option price have separate observable cases.
- `npm test` passes and its output makes the focused cases visible.
