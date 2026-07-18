# Testing Fundamentals: shared scenario and source notes

This file is a compact source for the course's parcel-pricing decisions. The
module that names a claim should still explain it in context; this note keeps
the shared scenario stable across the pack.

## Parcel-pricing behaviour

The service prices one parcel from three inputs:

- `weightKg`, a positive number no greater than 20;
- `zone`, one of `A`, `B`, or `C`; and
- zero or more options, currently `express` and `fragile`.

The base prices are €5 for zone A, €8 for zone B, and €12 for zone C. Add a
weight surcharge of €0 for weight up to and including 1 kg, €2 for weight over
1 kg up to and including 5 kg, €5 for weight over 5 kg up to and including
10 kg, and €9 for weight over 10 kg up to and including 20 kg. Add €6 for
`express` and €3 for `fragile`. The result is an integer euro total and should
also make the chosen inputs visible enough for a caller to explain the price.

Reject a weight that is zero, negative, not numeric, or greater than 20. Reject
an unknown zone and an unknown option. The service should represent these as a
deliberate domain failure; the exact error type or message is the learner's
choice if the observable distinction stays clear.

The first useful examples are:

| Weight | Zone | Options | Expected total |
| ---: | :---: | :--- | ---: |
| 1 kg | A | none | €5 |
| 2 kg | B | none | €10 |
| 2 kg | B | express | €16 |
| 2 kg | B | fragile | €13 |
| 10 kg | C | express, fragile | €26 |

The HTTP edge should accept a JSON `POST /price` request and return a success
response containing the price for valid input. Malformed transport input should
stop at the HTTP boundary with a 400-level response. A well-formed request
whose parcel violates a pricing rule should receive a different deliberate
4xx response. A separate `GET /health` or equivalent status route may prove
that the process is reachable; it cannot prove that pricing is correct.

## Testing decisions

Arrange–act–assert gives a test a readable shape: establish the inputs and
dependencies, perform one meaningful operation, then check the observable
outcome. “One behaviour per test” does not mean one assertion per test. It
means that a reader can name the behaviour and understand why the assertions
belong together.

A unit boundary is useful when it keeps a small decision fast and isolated. An
integration test is useful when it crosses a boundary whose translation could
be wrong, such as JSON input becoming a pricing request or a domain failure
becoming an HTTP response. Tests should not mock away the code whose behaviour
they claim to prove.

Test doubles differ in what they claim. A fake is a small working substitute
with believable behaviour, such as an in-memory rate table. A stub returns
pre-arranged answers so a test can reach the path under study; it makes no
claim about how it was called. A spy additionally records the calls it
receives so a test can inspect them afterwards. A mock is set up in advance
with expected interactions and the test fails verification when those
expectations are not met. Interaction assertions from spies and mocks are only
meaningful when the interaction is itself the contract; a mock-heavy test can
pass while the outcome a caller receives is wrong. Otherwise, assert the
observable result. Giving a fake deliberately different data from production
makes the substitution itself observable in the asserted outcome.

Table-driven cases make a family of related inputs visible. Boundary cases
should include the values on both sides of a rule, not only a typical middle
value. Failure-path tests should name the invalid input and the promised
distinction, rather than merely asserting that “something threw”.

Coverage is a map of executed code, not a certificate of correct behaviour.
It reports which statements, branches, functions, and lines the selected tests
executed; line coverage can be complete while an untaken branch hides a wrong
comparison, and executed code proves nothing if the assertions are weak. High
coverage can coexist with missing boundaries, an untested HTTP translation, or
a suite that exercises only happy paths. The final evidence should state the
command, the result, the important cases, and the limits of the confidence
claim.

