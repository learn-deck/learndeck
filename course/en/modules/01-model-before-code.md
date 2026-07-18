# 01 · Model before code

## I separate responsibilities before choosing frameworks

```mermaid
flowchart LR
  H["I define success"] --> MC[Mission Control]
  MC --> W[Workshop]
  W --> VR[Verification & Review]
  VR --> H
```

## Retrieval before review

Prompt `01-boundaries`: close the context map and assign these decisions to an
owner: mission completion, attempt lease, verification verdict, and human
approval. Explain the ownership rule. Include confidence from 0–100 and a
predicted outcome.

For worked support, classify one example. For faded support, use only context
names. For independent work, add one decision that belongs in no aggregate.

## Bounded action

Work through these catalogued activities one at a time:

1. `01-own-and-not-own` — Read `docs/en/domain/bounded-contexts.md` and
   `context-map.md`; for each context, write one thing it owns and one thing it
   must not decide.
2. `01-process-manager-trace` — Trace `MissionCompletionProcess` through the
   context map.
3. `01-everyday-explanation` — Explain the everyday responsibility problem
   first, then name the DDD concept.

## Self-evaluation

Use 0 = not yet, 1 = cued/partial, 2 = independent and evidence-backed.

| Criterion              | 0–2 evidence question                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `01-ownership`         | Can I place decisions by responsibility instead of technical layer?                          |
| `01-negative-boundary` | Can I name one decision each context must not make?                                          |
| `01-coordination`      | Can I explain why `MissionCompletionProcess` belongs to Mission Control's application layer? |

After feedback, state the corrected ownership rule without reopening the map.

## Mastery retrieval after proof

After the three bounded activities are recorded, close the source. Prompt
`01-mastery-boundaries`: name what each context owns, one thing it must not own,
and why the process manager belongs in Mission Control. Include confidence,
predicted outcome, and every rubric score. A partial answer remains current
until its evaluated revision is accurate.

## Delayed retrieval

Queue prompt `01-delayed-boundaries`: given a retry requirement, decide which
context owns policy, which owns attempt state, and where coordination lives.
After fluency in module 04, mix this only with domain ownership versus code
dependency boundaries.

## Checkpoint

I can say: **“I can defend these three boundaries by responsibility, not by
technical layer or framework.”**
