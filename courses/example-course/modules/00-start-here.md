---
id: start
title: Separate the course from the workspace
goal: State what a course pack owns, what the learner's workspace owns, and what visible evidence connects them.
action: Create the directory skeleton for a new pack — course.md, modules/, notes/ — next to (not inside) the workspace the course will teach in, and write one sentence in course.md's description that names the evidence a learner will produce.
sources:
  - ./00-start-here.md
  - ../notes/format-checklist.md
questions:
  - id: start-boundary
    kind: diagnostic
    prompt: In your own words, what belongs in the course pack, what belongs in the learner's workspace, and where does learner progress live?
    reference: ../notes/format-checklist.md
    rubric:
      - Places instructional Markdown in the pack and working code in the learner's workspace.
      - States that answers, evidence, and progress stay in the learner's local database, not in the pack.
  - id: start-evidence
    kind: exit
    prompt: Show the skeleton you created and name the observable evidence your course will ask learners to produce.
    reference: ./00-start-here.md
    rubric:
      - Shows a pack directory with course.md and a modules/ directory outside the learner workspace.
      - Names evidence a guide could actually see, such as command output or a committed file, rather than a feeling of progress.
---

# 00 · Separate the course from the workspace

A LearnDeck course draws one boundary before anything else: the **pack** holds
instruction, and the **workspace** holds the learner's own work. The pack is
Markdown that anyone can read and version. The workspace is code, notes, or
exercises that only the learner touches. Progress — answers, feedback,
evidence — lives in neither; it stays in the learner's local database.

That boundary is why a course can be updated, forked, or synced from GitHub
without ever touching what a learner has built or claimed.

## Build it

1. Create the pack skeleton:

   ```text
   my-course-pack/
     course.md
     modules/
     notes/
   ```

2. Fill in `course.md` front matter. Every field in this pack's own
   [course.md](../course.md) is required by the loader except `tags` and the
   per-path `serverCommand`, `testCommand`, and `workspaceHint` — though the
   public catalogue expects at least one fully specified path.

3. In `description`, write the sentence that names the evidence learners will
   produce. If you cannot name evidence, the course promise is not yet
   concrete enough.

## Outcome

You can explain which files belong where, and your `course.md` makes a
promise a guide could verify.
