---
id: author-a-module
title: Author a module with observable rubrics
goal: Write one module whose questions an AI guide can evaluate against visible evidence, not vibes.
action: Draft one modules/NN-name.md file in your pack with a goal, an action, one source, and at least a diagnostic and an exit question whose rubric lines each name something observable.
sources:
  - ./01-author-a-module.md
  - ../notes/format-checklist.md
questions:
  - id: author-a-module-review
    kind: review
    prompt: A rubric line reads "understands the topic deeply." Rewrite it so a guide could check it against something the learner shows, and explain what you changed.
    reference: ../notes/format-checklist.md
    rubric:
      - Rewrites the line to reference visible evidence, such as a named file, command output, or a stated decision.
      - Explains that a guide can only evaluate what the learner makes visible.
  - id: author-a-module-exit
    kind: exit
    prompt: Paste your drafted module's front matter and point out which rubric line is the most observable and which still needs work.
    reference: ./01-author-a-module.md
    rubric:
      - Front matter parses with id, title, goal, action, sources, and at least one diagnostic and one exit question.
      - Judges their own rubric lines by whether a guide could verify them from shown evidence.
---

# 01 · Author a module with observable rubrics

Modules are the unit of learning. Filenames determine order (`00-`, `01-`, …),
and the front matter `id` is the stable identity that learner progress
attaches to — rename the file freely, but never reuse an `id` for different
content.

Each module needs:

- **goal** — the outcome of one 30–60 minute session, stated as ability.
- **action** — one observable activity in the learner's own workspace.
- **sources** — local Markdown the questions can cite. Keep sources inside
  the pack (`./this-module.md`, `../notes/…`) so the course works offline.
- **questions** — each with a `kind`, a `prompt`, a `reference`, and a
  `rubric`.

## Question kinds

| Kind | When the guide asks it | What it does |
| --- | --- | --- |
| `diagnostic` | Entering a module | Surfaces what the learner already knows; never gates progress. |
| `review` | Revisiting earlier material | Checks that a distinction still holds after time has passed. |
| `exit` | Leaving a module | The only kind whose correct evaluation completes the section. |

## Rubrics are the contract

A rubric line is a claim a guide can check against what the learner shows.
"Names the boundary between pack and workspace" is checkable; "understands
the architecture" is not. Write every line so that a stranger reading only
the learner's visible answer could say yes or no.

## Outcome

Your pack has one complete module, and every rubric line in it names
something a guide could actually see.
