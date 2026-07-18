---
id: read-confidence-honestly
title: Read confidence honestly
goal: Finish with a test and evidence report that separates executed coverage from confidence about untested behaviour.
action: Run the Vitest suite and its configured coverage command, then write a short TEST-EVIDENCE.md report listing tested behaviours, observed output, and limits.
sources:
  - ./06-read-confidence-honestly.md
  - ../notes/testing-principles.md
questions:
  - id: confidence-diagnostic
    kind: diagnostic
    prompt: What can a coverage percentage tell you about the parcel-pricing suite, and what can it not tell you?
    reference: ../notes/testing-principles.md
    rubric:
      - States that coverage reports which code was executed by the selected tests.
      - Names a missing guarantee, such as correct assertions, untested boundaries, HTTP translation, dependencies, or production traffic.
  - id: confidence-exit
    kind: exit
    prompt: "Give your final evidence list: commands and outcomes, important parcel cases, one HTTP observation, and two things your suite does not prove."
    reference: ./06-read-confidence-honestly.md
    rubric:
      - Names learner-run commands with observed pass or coverage output and identifies important behaviour cases.
      - Includes an HTTP observation and two specific limits instead of treating coverage or a green suite as production proof.
---

# 06 · Read confidence honestly

## Outcome

You can hand another developer a compact record of what you tested, what you
saw, and what remains outside the claim.

## Coverage is a map, not a verdict

> [!SCENARIO]
> A high line percentage might mean that a happy-path test executed every
> branch while never checking whether the HTTP adapter maps an invalid parcel
> correctly. A lower percentage can still accompany a thoughtful suite if the
> important boundaries and outcomes are covered. Read the report alongside
> the cases, not instead of them.

## Build

1. Run `npm test` and record the command and result.
2. Run the coverage command configured by your Vitest project, commonly
   `npm test -- --coverage`. If your project reports that no coverage provider
   is configured, record that honestly and follow the project's documented
   learner-run setup before trying again; do not invent a percentage.
3. Read the report for the pricing decision and HTTP edge. Note which important
   cases executed and which behaviours remain untested.
4. In your project workspace, write `TEST-EVIDENCE.md` with the commands,
   observed outputs, the boundary and edge cases covered, one health or
   `POST /price` observation, and at least two limits on the confidence claim.
5. Ask the guide to review the evidence, not to certify the project. Your
   final record should be explainable from the repository and your observations.

## Final evidence

Finish with four concrete items:

- a small parcel-pricing repository you can explain;
- a passing Vitest command and the important behaviours it exercises;
- one observed HTTP-edge result, including the status route or price request;
- `TEST-EVIDENCE.md` with an honest coverage reading and explicit limits.

This is **not production readiness**. The course does not prove scale,
security, resilience, financial correctness, or every possible parcel input.
It proves that you built and inspected a bounded suite with enough evidence to
discuss its strengths and gaps.

## Definition of done

- `npm test` passes and its command and output are recorded.
- Coverage is reported when configured, or its absence is recorded without a made-up number.
- `TEST-EVIDENCE.md` lists important pricing, failure, and HTTP observations.
- The final report names at least two behaviours or conditions the suite does not prove.
