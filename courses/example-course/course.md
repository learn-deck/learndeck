---
schemaVersion: 1
id: example-course
title: "Course Format Example"
description: "A two-module reference pack that documents the LearnDeck course format by being one. Real courses live in the public catalogue at github.com/learn-deck/courses."
category: Documentation
tags:
  - Authoring
  - Reference
overview:
  duration: 1–2 hours
  sessionLength: 30–45 minutes
  level: Course authors
  outcomes:
    - Explain every required field of a LearnDeck course pack.
    - Draft one module with source-backed questions and observable rubrics.
  prerequisites:
    - A clone of a course repository you can edit.
    - A text editor.
paths:
  - id: default
    label: Author a course pack
    serverCommand: bun run app
    testCommand: bun test test/course-pack.test.ts
    workspaceHint: ../my-course-pack
---

# Course Format Example

This bundled pack exists for documentation: it demonstrates the LearnDeck
course format by using every part of it. Read it alongside
[course authoring](../../docs/course-authoring.md).

Real, learner-facing courses are not bundled with the app. They live in the
public catalogue at [learn-deck/courses](https://github.com/learn-deck/courses)
and sync into LearnDeck when `LEARNDECK_COURSE_REPOSITORY` is configured.

A pack is one directory:

```text
courses/<course-id>/
  course.md        # identity, overview, and workspace paths (this file)
  modules/*.md     # ordered learning sessions with questions and rubrics
  notes/*.md       # optional shared reference material
```

`course.md` owns identity and paths. Modules own the learning. Nothing in a
pack stores learner state: answers, evidence, and progress stay in the
learner's local database.
