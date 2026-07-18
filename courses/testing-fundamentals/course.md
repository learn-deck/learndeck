---
schemaVersion: 1
id: testing-fundamentals
title: "Testing Fundamentals"
description: "Build a small parcel-pricing service and learn to make its tests focused, honest, and useful."
category: Engineering practice
tags:
  - Testing
  - TypeScript
  - Node.js
  - Vitest
overview:
  duration: 5–7 hours
  sessionLength: 45–60 minutes per module
  level: Early-career backend developers
  outcomes:
    - Write focused tests that state one parcel-pricing behaviour clearly.
    - Choose a useful unit or HTTP boundary without mocking away the behaviour under test.
    - Exercise boundaries, options, and failure paths with readable test cases.
    - Refactor a small service under a green suite and explain what the suite does not prove.
  prerequisites:
    - Node.js 20 or newer, npm, and a TypeScript-capable editor.
    - Basic TypeScript functions, objects, and arrays.
    - Basic familiarity with HTTP requests and JSON.
    - A workspace you control for one small backend project.
paths:
  - id: node-typescript-vitest
    label: Node.js + TypeScript with Vitest
    serverCommand: npm run dev
    testCommand: npm test
    workspaceHint: ../parcel-pricing
---

# Testing Fundamentals

You will build a small parcel-pricing service. It prices a shipment from its
weight, destination zone, and delivery options, then exposes that decision
through one HTTP edge. The project is intentionally small: the point is to
learn what a test proves, where to put it, and how to keep confidence honest.

LearnDeck holds your learning record. Your confirmed workspace holds the
service, tests, commands, and final evidence. You will run commands yourself.
If a guide is connected, it can help you interpret what you observe; guide
evaluation is optional. Without a connected guide, answer the visible question,
review your own evidence, and use the app's **Mark as self-reviewed and
continue** action.

The course follows one parcel through seven short sessions: first a failing
test, then focused behaviour tests, boundary choices, honest test doubles,
deliberate edge cases, a refactor under green, and a final evidence review.
