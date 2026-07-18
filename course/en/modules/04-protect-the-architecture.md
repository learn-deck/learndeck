# 04 · Protect the architecture

## I make the boundary executable

```text
domain ← application ← adapters/infrastructure
  no framework imports      no cross-context application imports
```

## Retrieval before review

Prompt `04-boundary-prediction`: close the architecture test and predict
whether domain → Fastify, application → its domain, and one context application
→ another should pass. Explain each rule. Include confidence from 0–100 and a
predicted outcome.

For worked support, the guide walks through one import. Next I complete a
partial classification, then predict an unseen mutation independently.

## Bounded action

Work through these catalogued activities one at a time:

1. `04-architecture-check` — Read `node/README.md` and the dependency-direction
   test, predict rejected imports, then run `cd node && npm run architecture`
   for check `architecture-gate`.
2. `04-forbidden-import-mutation` — Inspect and record the target's existing
   diff, persist the recovery action, make one bounded forbidden import, and
   observe the expected failure.
3. `04-recovery-and-verify` — Reverse only that edit, prove the target matches
   its pre-exercise diff, run `cd node && npm run verify` for check
   `complete-verify`, and explain why
   executable evidence is stronger than a diagram.

## Self-evaluation

Use 0 = not yet, 1 = cued/partial, 2 = independent and evidence-backed.

| Criterion               | 0–2 evidence question                                                    |
| ----------------------- | ------------------------------------------------------------------------ |
| `04-prediction`         | Did I predict dependency outcomes before executing the test?             |
| `04-mechanism`          | Can I explain inward dependency and context isolation separately?        |
| `04-proof-and-recovery` | Did I observe failure, restore only my edit, and pass the complete gate? |

Correct a mistaken dependency direction, then classify it again without source.

## Mastery retrieval after proof

After the guarded mutation is restored and both required checks are recorded,
close the source. Prompt `04-mastery-boundary`: classify inward dependency,
framework leakage, and cross-context application imports; explain the
mechanism; and cite the recorded `architecture-gate` and `complete-verify` run
IDs. Include confidence, predicted outcome, and every rubric score. A partial
answer remains current until its evaluated revision is accurate.

## Delayed retrieval

Queue prompt `04-delayed-boundary`: classify a new import and name its rule
before verification. After fluency in module 01, mix this only with deciding
whether a split is a domain boundary, dependency rule, or both.

## Checkpoint

I can say: **“I broke an architectural rule deliberately, saw the executable
boundary reject it, and restored a fully green repository.”**
