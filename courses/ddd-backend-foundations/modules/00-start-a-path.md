---
id: start
title: Set up your backend
goal: Confirm one Node.js + TypeScript workspace and make a tiny status route visible.
action: Create src/domain/, src/application/, src/ports/, and src/adapters/ plus one health/status route in your project folder. Run npm run dev yourself when you are ready.
sources:
  - ./00-start-a-path.md
  - ../../../references/language-paths.md
  - ../../../references/progress-database.md
questions:
  - id: start-boundary
    kind: diagnostic
    prompt: Why should LearnDeck and your backend project live in different folders? Name one problem that separation avoids.
    reference: ./00-start-a-path.md
    rubric:
      - Distinguishes LearnDeck's local progress from the learner's application code.
      - Names one concrete risk avoided by separation, such as accidental writes or losing progress when replacing a project.
  - id: start-evidence
    kind: exit
    prompt: Name your project folder, development command, and status route. Why does LearnDeck keep progress tied to this project?
    reference: ./00-start-a-path.md
    rubric:
      - Names a concrete project folder, learner-run development command, and observable status route.
      - Explains that the workspace ties answers and evidence to the backend actually being built.
---

# 00 · Set up your backend

You only need one project for this course: a small Node.js + TypeScript backend.
LearnDeck remembers your answers locally; your project folder holds the code you
will build. Keeping them separate lets you retry, rename, or delete the project
without touching the course itself.

> [!SCENARIO]
> Imagine a booking service with one rule: a room cannot be booked twice for
> the same time. We will grow that small idea into a testable backend, one
> decision at a time.

## Your first visible result

1. Choose an empty or new folder for the backend, separate from LearnDeck.
2. Use the Node.js + TypeScript checks in
   [`language-paths.md`](../../../references/language-paths.md). They only tell
   you what is present; they never install or run anything for you.
3. In your project, create these four areas: `src/domain/`,
   `src/application/`, `src/ports/`, and `src/adapters/`. Empty folders are
   enough today.
4. If the folder is empty, copy this minimal setup. It uses `tsx` to run
   TypeScript directly; run `npm install` yourself. LearnDeck never installs
   packages or starts your server.

`package.json`

```json
{
  "name": "ddd-backend",
  "private": true,
  "type": "module",
  "scripts": { "dev": "tsx --watch src/server.ts" },
  "devDependencies": { "tsx": "latest", "typescript": "latest" }
}
```

`src/server.ts`

```ts
import { createServer } from "node:http";

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  response.writeHead(404);
  response.end();
});

server.listen(3000);
```

Run `npm install`, then `npm run dev`, and check `GET /health`. The expected
response is verbatim: `200 {"status":"ok"}`.

5. When the project is ready, run `npm run dev` yourself and look at the
   endpoint. If a guide is connected, tell it what you ran and observed so it
   can record that evidence; otherwise record it with the evidence form or in
   `NOTES.md` in your workspace.

> [!TIP]
> Do not design the perfect server today. A plain status response is valuable
> because it gives you a known-good starting point for every later change.

```learndeck
type: checklist
id: start-ready
label: Before you continue
items:
  - Node.js and npm are available on my Mac.
  - My backend project folder is separate from LearnDeck.
  - I know the status route I will make visible.
```

## Keep the boundary clear

LearnDeck stores its progress in a local SQLite database, described in
[`progress-database.md`](../../../references/progress-database.md). It records
the project folder so feedback and evidence stay associated with the backend
you actually built. It does not write your application code, start its server,
or collect your project outside the folder you confirm.

When you are ready, answer the question below in your own words. A short,
concrete answer is better than architecture vocabulary.

## Definition of done

Before answering, check that:

- The project contains `src/domain/`, `src/application/`, `src/ports/`, and `src/adapters/`.
- A learner-run development command starts the backend, such as `npm run dev`.
- A visible `GET /health` route returns `200 {"status":"ok"}`.
- You can name the project folder, command, route, and observed response.

After you submit your answer, choose **Mark as self-reviewed and continue** if
you are working without a connected guide. Guide evaluation is optional, not
required; if a guide is connected, you may request feedback instead.
