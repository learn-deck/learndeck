---
id: start-with-a-failure
title: Start with a failing test
goal: Create a small Vitest workspace and make one parcel-pricing behaviour fail before it passes.
action: Create the parcel-pricing project, write one failing pricing test, implement the smallest behaviour that makes it pass, and record both test outputs.
sources:
  - ./00-start-with-a-failure.md
  - ../notes/testing-principles.md
questions:
  - id: start-failure-diagnostic
    kind: diagnostic
    prompt: What would a failing test tell you here that a green test written after the implementation might not?
    reference: ./00-start-with-a-failure.md
    rubric:
      - Distinguishes a test that demonstrates a missing behaviour from a test that only confirms an implementation already written.
      - Names an observable part of the failure, such as the expected parcel price or the failing test name.
  - id: start-failure-exit
    kind: exit
    prompt: Describe the parcel input you tested, the expected price, the failure you first saw, and the evidence that the corrected test now passes.
    reference: ../notes/testing-principles.md
    rubric:
      - Names concrete weight, zone, options, and expected total from the shared scenario.
      - Distinguishes the first failing run from the later passing run and names visible test output as evidence.
---

# 00 · Start with a failing test

## Outcome

You can point to a real test that failed for a useful reason and then passed
after the smallest implementation change.

## The parcel you are pricing

> [!SCENARIO]
> A 2 kg parcel going to zone B with no options costs €10: €8 for the zone and
> €2 for the weight band. This is a small enough decision to test before you
> design a larger service.

Choose a separate project folder for the service. The project belongs to you;
LearnDeck does not create it, install its dependencies, or run its commands.
Use a Node.js + TypeScript project with Vitest and make sure it has the learner-
run commands `npm run dev` and `npm test` by the time the course needs them.

## Build

1. Create the project and its first test file. Keep the production code and
   tests easy to find; do not create an architecture catalogue.
2. Write a test for the 2 kg, zone B, no-options example. Write the expected
   €10 before implementing the pricing behaviour.
3. Run `npm test` and keep the visible failure: the test name and the mismatch
   are useful evidence.
4. Implement only enough pricing logic to make that test pass. Run `npm test`
   again and record the green output.
5. If you have not made the development command yet, add a tiny server with a
   `GET /health` response and make `npm run dev` start it. The HTTP pricing edge
   comes in module 02; do not build it now.

The output for this module is not “I have tests”. It is a before-and-after
record: one named behaviour, one meaningful failure, and one meaningful pass.

## Definition of done

- A separate parcel-pricing workspace contains a TypeScript test that runs with Vitest.
- The 2 kg, zone B, no-options behaviour failed before its implementation existed.
- The same test passes after the smallest implementation change.
- You recorded the test command and the visible failing and passing results.

