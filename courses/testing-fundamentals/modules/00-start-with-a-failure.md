---
id: start-with-a-failure
title: Start with a failing test
goal: Create a small Vitest workspace and make one parcel-pricing behaviour fail before it passes.
action: Create the parcel-pricing project at the documented paths, write one failing pricing test, implement the smallest behaviour that makes it pass, and record both test outputs.
sources:
  - ./00-start-with-a-failure.md
  - ../notes/testing-principles.md
questions:
  - id: start-failure-diagnostic
    kind: diagnostic
    prompt: What would a failing test tell you here that a green test written after the implementation might not?
    reference: ./00-start-with-a-failure.md
    rubric:
      - Distinguishes a test that demonstrates a missing behaviour from a test that only confirms an implementation already written.
      - Names an observable part of the failure, such as the expected parcel price or the failing test name.
  - id: start-failure-exit
    kind: exit
    prompt: Describe the parcel input you tested, the expected price, the failure you first saw, and the evidence that the corrected test now passes.
    reference: ../notes/testing-principles.md
    rubric:
      - Names concrete weight, zone, options, and expected total from the shared scenario.
      - Distinguishes the first failing run from the later passing run and names visible test output as evidence.
---

# 00 · Start with a failing test

## Outcome

You can point to a real test that failed for a useful reason and then passed
after the smallest implementation change.

## The parcel you are pricing

> [!SCENARIO]
> A 2 kg parcel going to zone B with no options costs €10: €8 for the zone and
> €2 for the weight band. This is a small enough decision to test before you
> design a larger service.

Choose a separate project folder for the service. The project belongs to you;
LearnDeck does not create it, install its dependencies, or run its commands.
Use a Node.js + TypeScript project with Vitest. The minimal bootstrap below
creates the exact files and learner-run commands needed by this course. It is
deliberately one source file; later modules may separate the HTTP adapter.

## Copyable empty-folder setup

From the parent directory of your project, choose the folder name
`parcel-pricing`, then run:

```sh
mkdir -p parcel-pricing/src parcel-pricing/test
cd parcel-pricing
```

Create `package.json` with this content:

```json
{
  "name": "parcel-pricing",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/parcel-pricing.ts",
    "test": "vitest run --reporter=verbose"
  }
}
```

Install the learner-run tools yourself:

```sh
npm install --save-dev vitest tsx typescript @types/node @vitest/coverage-v8
```

Create `tsconfig.json` so the editor and TypeScript agree on modern modules and
Node types; without it, `import.meta` and the `node:` imports show false errors:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

Create `test/parcel-pricing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { priceParcel } from "../src/parcel-pricing";

describe("parcel pricing", () => {
  it("prices a 2 kg zone B parcel at €10", () => {
    const result = priceParcel({ weightKg: 2, zone: "B", options: [] });

    expect(result.total).toBe(10);
  });
});
```

Create `src/parcel-pricing.ts` with this temporary implementation first:

```ts
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

export type Parcel = {
  weightKg: number;
  zone: "A" | "B" | "C";
  options: string[];
};

export type ParcelPrice = { total: number };

export function priceParcel(_parcel: Parcel): ParcelPrice {
  throw new Error("priceParcel is not implemented");
}

function startServer() {
  createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  }).listen(3000, "127.0.0.1", () => {
    console.log("Parcel-pricing server listening at http://127.0.0.1:3000");
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) startServer();
```

Run the first test before implementing the behaviour:

```sh
npm test
```

The exact useful output is one named failure and this summary:

```text
❯ test/parcel-pricing.test.ts > parcel pricing > prices a 2 kg zone B parcel at €10
   → Error: priceParcel is not implemented
Test Files  1 failed (1)
Tests       1 failed (1)
```

Now replace only `priceParcel` in `src/parcel-pricing.ts` with:

```ts
export function priceParcel(parcel: Parcel): ParcelPrice {
  const baseRates: Record<Parcel["zone"], number> = { A: 5, B: 8, C: 12 };
  const weightSurcharge = parcel.weightKg > 1 ? 2 : 0;

  return { total: baseRates[parcel.zone] + weightSurcharge };
}
```

> [!TIP]
> Strictly, the smallest change that makes this one test pass is
> `return { total: 10 };`. Hard-coding the answer and letting the next failing
> test force real logic is a legitimate TDD move. We jump straight to the small
> zone table because module 01 immediately adds cases that would force it, but
> notice what the honest claim is either way: one green test proves only the
> 2 kg zone B example, not the whole pricing rule.

Run `npm test` again. The exact useful output is now:

```text
✓ test/parcel-pricing.test.ts > parcel pricing > prices a 2 kg zone B parcel at €10
Test Files  1 passed (1)
Tests       1 passed (1)
```

Vitest may add its version, timing, colours, and stack-location lines around
these stable lines. The required evidence is the named failure followed by the
named pass; do not replace either assertion with a weaker one.

The front-matter commands are now executable: `npm test` runs the test above,
and `npm run dev` starts the status server from `src/parcel-pricing.ts`. Verify
the second command yourself with:

```sh
npm run dev
curl http://127.0.0.1:3000/health
```

The terminal must print
`Parcel-pricing server listening at http://127.0.0.1:3000`, and `curl` must
return exactly `{"status":"ok"}`. Stop the server after checking it.

```learndeck
type: checklist
id: start-failure-ready
label: Before you build
items:
  - Node.js 20 or newer and npm are available on my machine.
  - The parcel-pricing folder is separate from LearnDeck.
  - I saw the named test fail before I implemented the behaviour.
```

## Build

1. Create the project at `package.json`, `tsconfig.json`,
   `src/parcel-pricing.ts`, and `test/parcel-pricing.test.ts`. Keep the
   production code and tests easy to find; do not create an architecture
   catalogue.
2. Write a test for the 2 kg, zone B, no-options example. Write the expected
   €10 before implementing the pricing behaviour.
3. Run `npm test` and keep the visible failure: the test name and the mismatch
   are useful evidence.
4. Implement only enough pricing logic to make that test pass. Run `npm test`
   again and record the green output.
5. Verify that `npm run dev` starts the server and that `GET /health` returns
   `200 {"status":"ok"}`. The HTTP pricing edge comes in module 02; do not
   build it now.

The output for this module is not “I have tests”. It is a before-and-after
record at `test/parcel-pricing.test.ts`: one named behaviour, one meaningful
failure, one meaningful pass, and the health check response above. If a guide
is connected, you may tell it the command and output so it can optionally
review the evidence. If no guide is connected, write the same record in your
own notes, answer the question, and select **Mark as self-reviewed and
continue** in the app.

## Definition of done

- A separate parcel-pricing workspace contains `package.json`,
  `tsconfig.json`, `src/parcel-pricing.ts`, and `test/parcel-pricing.test.ts`;
  the test runs with Vitest.
- The 2 kg, zone B, no-options behaviour failed before its implementation existed.
- The same test passes after the smallest implementation change.
- `npm run dev` returns `200 {"status":"ok"}` from `GET /health`.
- You recorded the `npm test` command and the visible failing and passing results.
