---
id: drive-the-edges
title: Drive the edges deliberately
goal: Use table-driven cases to make pricing boundaries, options, and failure paths visible.
action: Add a table of parcel cases covering both sides of at least two pricing boundaries plus deliberate invalid-input cases, then run the suite and inspect the named cases.
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

## Build

1. Put related pricing examples in a Vitest table or equivalent data-driven
   structure. Give each row a case name that will appear in test output.
2. Include values at and immediately beside at least two thresholds.
3. Add deliberate failure cases for invalid input. Keep transport failures in
   the HTTP test; these cases exercise the pricing rule itself.
4. Run `npm test`. Read the case names, not only the final count. If a boundary
   fails, decide whether the rule or the test expectation is wrong before
   changing either.

## Definition of done

- A readable table covers both sides of at least two pricing thresholds.
- Options have a focused case and invalid input has a deliberate failure case.
- Failure assertions identify a useful distinction beyond “something threw”.
- `npm test` passes and the output exposes the names of the important cases.

