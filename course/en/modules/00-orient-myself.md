# 00 · Orient myself

## I am building this loop

```text
I define the task → a Runner proposes a patch → the verifier produces evidence
       ↑                                               ↓
       └───────────── I approve or reject ─────────────┘
```

The **Runner** is the domain role that produces the patch. The local guide is
only the teaching agent. The Runner never grades its own work, and verification
never makes the human decision.

## Retrieval before review

Prompt `00-loop-separation`: study the loop briefly, close this page, then
explain what the Runner produces, what the verifier checks, and what the human
decides. Why would combining roles weaken the result? Include confidence from
0–100 and predict whether your answer is accurate, partial, or incorrect.

If I am new, I may ask for the frame “The Runner ___; the verifier ___; the
human ___.” The guide removes that frame once I can explain the loop.

## Bounded action

Work through these catalogued activities one at a time:

1. `00-repository-orientation` — Read the root `README.md` and
   `docs/en/domain/overview.md`, then find the three bounded contexts without
   opening implementation files.
2. `00-clone-verification` — Use `node/.nvmrc`, confirm Node 24.11.0 and npm
   11.6.1, then run `cd node && npm ci` followed by the catalogued gate
   `cd node && npm run verify` for check `complete-verify`.
3. `00-role-explanation` — Explain in first person why the human decision is
   separate from verification and cite one source or check.

## Self-evaluation

Score each criterion before the guide evaluates it: 0 = not yet, 1 = cued or
incomplete evidence, 2 = independent and evidence-backed.

| Criterion              | 0–2 evidence question                                                   |
| ---------------------- | ----------------------------------------------------------------------- |
| `00-role-separation`   | Can I distinguish Runner, verifier, and human decision without looking? |
| `00-risk-reasoning`    | Can I explain the risk of combining roles rather than only naming them? |
| `00-repository-health` | Can I cite the exact complete gate and its actual result?               |

Correct any gap, then retrieve the explanation once more without the source.

## Mastery retrieval after proof

After the bounded activities and recorded `complete-verify` run, close the
source. Prompt `00-mastery-loop`: explain the Runner, verifier, and human
decision in first person and connect each role to the evidence you just
produced. Include confidence, predicted outcome, every rubric score, and the
recorded check ID. A partial answer remains current until its evaluated
revision is accurate.

## Delayed retrieval

Queue prompt `00-delayed-loop`: from a blank page, redraw the loop and diagnose
what is wrong with “the verifier passed it, so the mission is approved.” After
initial fluency in module 03, mix this only with technical failure versus human
decision.

## Checkpoint

I can say: **“I can explain the PatchQuest loop, and I proved this clone passes
its complete verification gate.”**
