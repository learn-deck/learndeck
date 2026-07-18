---
schemaVersion: 1
id: ddd-backend-foundations
title: "DDD Backend Foundations with Node.js and TypeScript"
description: "Build one small, well-shaped backend. Learn to name the domain, keep business rules independent, expose a useful HTTP boundary, and prove the behaviour with tests."
category: Backend engineering
tags:
  - TypeScript
  - Node.js
  - Domain-driven design
  - Hexagonal architecture
overview:
  duration: 6–8 hours
  sessionLength: 45–60 minutes per module
  level: Early-career backend developers
  outcomes:
    - Model a small business rule in TypeScript before choosing tables or routes.
    - Organise a Node.js backend around domain, application, ports, and adapters.
    - Deliver one HTTP workflow, persistence boundary, and test suite with confidence.
    - Explain the trade-offs in your own words instead of copying a folder structure.
  prerequisites:
    - Node.js 22 or newer and npm.
    - Basic TypeScript syntax and a code editor.
    - A quiet workspace for one small backend project.
paths:
  - id: node-typescript
    label: Node.js + TypeScript
    serverCommand: npm run dev
    testCommand: npm test
    workspaceHint: ../ddd-backend
---

# DDD Backend Foundations

This is LearnDeck's reference course pack. It is deliberately one path: Node.js
and TypeScript. Each module asks for one visible change, one short explanation,
and one piece of learner-owned evidence. You will build a small backend, not a
generic architecture diagram.
