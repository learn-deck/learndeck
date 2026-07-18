---
id: choose-a-boundary
title: Choose a useful test boundary
goal: Keep pure pricing decisions fast and use one HTTP integration test to prove the transport translation.
action: Keep a direct pricing test and add one test that sends a valid parcel through the real POST /price edge, recording the distinction in the test output.
sources:
  - ./02-choose-a-boundary.md
  - ../notes/testing-principles.md
questions:
  - id: boundary-diagnostic
    kind: diagnostic
    prompt: Which part of parcel pricing should be tested without starting a server, and which part is worth crossing the HTTP boundary to test?
    reference: ../notes/testing-principles.md
    rubric:
      - Places the pure price decision in a fast isolated test and the JSON/request/response translation at the HTTP boundary.
      - Explains why a boundary test can catch a translation mistake that a direct function test cannot.
  - id: boundary-exit
    kind: exit
    prompt: Trace your valid POST /price test from request to response. What does it prove, and what important behaviour does it intentionally leave to the unit tests?
    reference: ./02-choose-a-boundary.md
    rubric:
      - Names the request shape, HTTP edge, and observable response that the integration test exercises.
      - Separates transport translation from the full set of pricing rules and names a behaviour left to direct tests.
---

# 02 · Choose a useful test boundary

## Outcome

You can choose a boundary because it protects a behaviour, not because a test
taxonomy says every file needs its own test.

## The parcel edge

> [!SCENARIO]
> A direct pricing test can prove that 2 kg in zone B costs €10. It cannot
> prove that `POST /price` reads `weightKg` from JSON, passes the right value to
> the pricing decision, and returns the result in the response. One HTTP test
> can prove that translation without turning every rule into a slow end-to-end
> test.

Use the smallest useful split:

- A unit test calls the pricing decision directly with an ordinary parcel,
  option, or invalid input.
- An integration test crosses your own HTTP edge with a real `Request`/`Response`
  or a locally running server and checks the response status and body.
- Do not mock the pricing function inside the test that claims to prove the
  `/price` behaviour. That would prove only that the handler called a mock.

## Build

1. Keep one direct test for the shared parcel-pricing rule.
2. Add one valid `POST /price` test for a parcel with a visible expected total.
   Use the real HTTP adapter. If your test harness starts the local server,
   use `fetch`; if it invokes the adapter in-process, still construct a real
   request and inspect its real response.
3. Run the unit and integration tests with `npm test`. Give the boundary case
   a name that makes the transport behaviour visible in the output.
4. Write down one transport failure you will test later, such as malformed JSON
   returning 400-level output, and one domain failure such as an invalid weight
   returning a distinct 4xx response.

## What this is NOT

It is not “unit test every line and mock everything else.” A unit test is
useful when it isolates a decision; a boundary test is useful when it protects
the translation at that boundary. Neither is a score for how many test files
you created.

## Definition of done

- A direct pricing test and an HTTP-edge test both run with the same test command.
- The HTTP test sends a valid parcel through `POST /price` and checks an observable response.
- The HTTP test does not replace the pricing decision with a mock.
- Your answer names one transport failure and one domain failure that deserve distinct tests.

