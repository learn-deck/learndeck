---
id: choose-a-boundary
title: Choose a useful test boundary
goal: Keep pure pricing decisions fast and use one HTTP integration test to prove the transport translation.
action: Keep the direct pricing test in `test/parcel-pricing.test.ts` and add one real HTTP test in `test/http-price.test.ts` for `POST /price`, recording the distinction in the test output.
sources:
  - ./02-choose-a-boundary.md
  - ../notes/testing-principles.md
questions:
  - id: boundary-diagnostic
    kind: diagnostic
    prompt: Which part of parcel pricing should be tested without starting a server, and which part is worth crossing the HTTP boundary to test?
    reference: ../notes/testing-principles.md
    rubric:
      - Places the pure price decision in a fast isolated test and the JSON/request/response translation at the HTTP boundary.
      - Explains why a boundary test can catch a translation mistake that a direct function test cannot.
  - id: boundary-exit
    kind: exit
    prompt: Trace your valid POST /price test from request to response. What does it prove, and what important behaviour does it intentionally leave to the unit tests?
    reference: ./02-choose-a-boundary.md
    rubric:
      - Names the request shape, HTTP edge, and observable response that the integration test exercises.
      - Separates transport translation from the full set of pricing rules and names a behaviour left to direct tests.
---

# 02 · Choose a useful test boundary

## Outcome

You can choose a boundary because it protects a behaviour, not because a test
taxonomy says every file needs its own test.

## The parcel edge

> [!SCENARIO]
> A direct pricing test can prove that 2 kg in zone B costs €10. It cannot
> prove that `POST /price` reads `weightKg` from JSON, passes the right value to
> the pricing decision, and returns the result in the response. One HTTP test
> can prove that translation without turning every rule into a slow end-to-end
> test.

Use the smallest useful split:

- A unit test calls the pricing decision directly with an ordinary parcel,
  option, or invalid input.
- Add the adapter at `src/server.ts`, keep `priceParcel` in
  `src/parcel-pricing.ts`, and change `package.json` so `npm run dev` starts
  `src/server.ts`.
- An integration test in `test/http-price.test.ts` starts the real adapter on
  an ephemeral port and checks the response status and body. For the shared
  case, send `POST /price` with `{"weightKg":2,"zone":"B","options":[]}` and
  expect `200` with a JSON body whose `total` is `10`.
- Do not mock the pricing function inside the test that claims to prove the
  `/price` behaviour. That would prove only that the handler called a mock.

## A minimal adapter you can test for real

The HTTP plumbing is not this module's learning goal, so here is a complete
adapter. Move the server out of `src/parcel-pricing.ts` (delete `startServer`
and its imports there) and create `src/server.ts`:

```ts
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { priceParcel, type Parcel } from "./parcel-pricing";

export function createPricingServer(): Server {
  return createServer((request, response) => {
    const respond = (status: number, payload: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    };

    if (request.method === "GET" && request.url === "/health") {
      respond(200, { status: "ok" });
      return;
    }

    if (request.method === "POST" && request.url === "/price") {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        let parcel: Parcel;
        try {
          parcel = JSON.parse(body) as Parcel;
        } catch {
          respond(400, { error: "malformed JSON" });
          return;
        }
        try {
          respond(200, priceParcel(parcel));
        } catch (error) {
          respond(422, { error: error instanceof Error ? error.message : "invalid parcel" });
        }
      });
      return;
    }

    respond(404, { error: "not found" });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createPricingServer().listen(3000, "127.0.0.1", () => {
    console.log("Parcel-pricing server listening at http://127.0.0.1:3000");
  });
}
```

Update the `dev` script to `"tsx src/server.ts"` so `npm run dev` and the
`/health` check from module 00 keep working. The 400 branch stops malformed
transport input at the boundary now. The 422 branch stays dormant until
module 04 adds domain validation to `priceParcel` — that is a recorded promise,
not a tested behaviour yet.

The integration test starts the same adapter on port 0 (an ephemeral port) and
crosses the boundary with a real request. Create `test/http-price.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createPricingServer } from "../src/server";

describe("POST /price", () => {
  const server = createPricingServer();
  let baseUrl = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it("translates a valid POST /price request into a €10 response", async () => {
    const response = await fetch(`${baseUrl}/price`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ weightKg: 2, zone: "B", options: [] }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 10 });
  });
});
```

## Build

1. Keep one direct test for the shared parcel-pricing rule in
   `test/parcel-pricing.test.ts`.
2. Add `src/server.ts` and the valid `POST /price` test in
   `test/http-price.test.ts` as shown above, and point `npm run dev` at the new
   adapter. The test must exercise the real adapter, not a mocked pricing
   function.
3. Run `npm test`. The case name
   `translates a valid POST /price request into a €10 response` must be visible
   alongside `Test Files  2 passed` and a passing `Tests` summary.
4. Write down one transport failure you will test in module 04, such as
   malformed JSON returning a 400 response, and one domain failure such as an
   invalid weight returning a distinct 422 response. Keep those as separate
   promises.

## What this is NOT

It is not “unit test every line and mock everything else.” A unit test is
useful when it isolates a decision; a boundary test is useful when it protects
the translation at that boundary. Neither is a score for how many test files
you created.

## Definition of done

- A direct pricing test and an HTTP-edge test both run with the same test command.
- `test/http-price.test.ts` sends the documented JSON through `POST /price` and
  checks `200` plus a response `total` of `10`.
- The HTTP test does not replace the pricing decision with a mock.
- `npm run dev` now starts `src/server.ts` and the `/health` check from
  module 00 still returns `{"status":"ok"}`.
- Your answer names one transport failure and one domain failure that deserve distinct tests.
