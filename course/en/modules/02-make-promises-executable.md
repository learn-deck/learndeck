# 02 · Make promises executable

## I follow one promise through every boundary

```text
HTTP operation → domain decision → integration message → acceptance evidence
```

## Retrieval before review

Prompt `02-contract-trace`: close the source. Explain why an HTTP declaration
alone does not prove behavior, then distinguish a directed command (“please do
this”) from a published event (“this happened”) with one PatchQuest example of
each. Name later evidence needed. Include confidence from 0–100 and a predicted
outcome.

For worked support, the guide traces one identifier across two boundaries and I
complete the rest. Guidance fades to identifiers, then an unaided trace.

## Bounded action

Work through these catalogued activities one at a time:

1. `02-boundary-trace` — Read `contracts/README.md` and
   `acceptance/README.md`; choose one happy-path OpenAPI operation, find its
   related command/event and schema, then find its scenario evidence.
2. `02-contract-checks` — Run
   `cd node && npm run contract` for `contract-gate`, then
   `cd node && npm run acceptance` for `acceptance-gate`.
3. `02-evidence-explanation` — Explain why each artifact catches a different
   broken promise and why a command is not an event.

## Self-evaluation

Use 0 = not yet, 1 = cued/partial, 2 = independent and evidence-backed.

| Criterion                  | 0–2 evidence question                                        |
| -------------------------- | ------------------------------------------------------------ |
| `02-trace`                 | Can I follow one named behavior through all four boundaries? |
| `02-command-event-meaning` | Can I distinguish a directed command from a published fact?  |
| `02-proof`                 | Can I cite the actual contract and acceptance check results? |

Correct identifiers or causal links explicitly, then retrace without looking.

## Mastery retrieval after proof

After the bounded activities and both recorded checks, close the source. Prompt
`02-mastery-contract`: reconstruct the HTTP → command → event → scenario trace,
explain command versus event meaning, and cite the recorded `contract-gate` and
`acceptance-gate` run IDs. Include confidence, predicted outcome, and every
rubric score. A partial answer remains current until its evaluated revision is
accurate.

## Delayed retrieval

Queue prompt `02-delayed-contract`: without opening the catalog, classify
`workshop.create-attempt.v1` and `workshop.attempt-ready.v1` as command or event
and explain the language cue and ownership consequence. Then predict contract,
payload, and scenario evidence for an unfamiliar operation. After fluency in
module 03, mix this only with contract-valid domain rejection or infrastructure
abort cases.

## Checkpoint

I can say: **“I traced one promise from its public API to its emitted evidence,
and the repository verifies that the pieces still agree.”**
