# 03 · Design for failure

## I learn the system by making its failures visible

```text
duplicate ≠ second effect     expired lease ≠ current ownership
failed check ≠ approval       infrastructure abort ≠ domain rejection
```

## Retrieval before review

Prompt `03-failure-contrast`: close the failure catalog and explain duplicate
versus conflicting artifact submission, then failed mandatory gate versus
aborted verification. For each, state whether retry is safe and why. Include
confidence from 0–100 and a predicted outcome.

For worked support, compare one scenario pair in a table. Next complete a
partial table, then classify a related failure without cues.

## Bounded action

Work through these catalogued activities one at a time:

1. `03-scenario-contrast` — Read the failure catalog, compare duplicate with
   conflicting artifact submission, then compare failed gate with aborted
   verification.
2. `03-retry-explanation` — Explain the owning context and retry behavior.
3. `03-acceptance-check` — Run `cd node && npm run acceptance` for check
   `acceptance-gate` and record the
   actual result.

## Self-evaluation

Use 0 = not yet, 1 = cued/partial, 2 = independent and evidence-backed.

| Criterion           | 0–2 evidence question                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| `03-classification` | Can I distinguish duplicate, conflict, domain failure, and infrastructure abort? |
| `03-consequence`    | Can I predict retry and business effects for each classification?                |
| `03-evidence`       | Can I point to scenario expectations and the acceptance result?                  |

Name any misconception, compare it with evidence, then retrieve the correction.

## Mastery retrieval after proof

After the bounded activities and recorded `acceptance-gate` run, close the
source. Prompt `03-mastery-failure`: classify duplicate delivery, lease expiry,
budget exhaustion, and infrastructure abort; state the safe consequence of
each; and cite the recorded check ID. Include confidence, predicted outcome,
and every rubric score. A partial answer remains current until its evaluated
revision is accurate.

## Delayed retrieval

Queue prompt `03-delayed-failure`: classify a fresh failure, choose the owning
context, and predict retry before inspecting a scenario. After initial fluency,
mix it only with module 00's verification/approval distinction or module 02's
contract/domain distinction.

## Checkpoint

I can say: **“I can distinguish domain failure from infrastructure failure and
explain how idempotency keeps retries safe.”**
